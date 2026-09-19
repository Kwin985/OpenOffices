//! ODS（OpenDocument 电子表格）写出：SheetPayload → zip + 手写 ODF XML。
//! 复用 xlsx 的载荷结构；值/样式（粗斜/字号/字色/底色）/合并区全进 content.xml。
//! 范围：图表与数字格式暂不写入 ODS（xlsx 专属通道）。

use std::collections::HashMap;
use std::io::{Cursor, Write};
use std::path::Path;

use quick_xml::escape::escape;
use serde_json::Value;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::xlsx::{CellStyle, Error, MergeRange, SheetPayload, WorkbookPayload};

fn esc(s: &str) -> String {
    escape(s).to_string()
}

fn io_err(e: std::io::Error) -> Error {
    Error(format!("ODS 写入失败: {e}"))
}

fn zip_err(e: zip::result::ZipError) -> Error {
    Error(format!("ODS 打包失败: {e}"))
}

/// 去重注册单元格样式，返回 (样式名, automatic-styles XML)；无样式返回 None
fn build_styles(sheets: &[SheetPayload]) -> (HashMap<String, String>, String) {
    let mut names: HashMap<String, String> = HashMap::new();
    let mut xml = String::new();
    for sheet in sheets {
        for cell in &sheet.cells {
            let Some(st) = &cell.s else { continue };
            if !st.has_any() {
                continue;
            }
            let key = format!(
                "{}|{}|{}|{}|{}",
                st.bl,
                st.it,
                st.fs.map(|f| f.to_string()).unwrap_or_default(),
                st.cl.clone().unwrap_or_default(),
                st.bg.clone().unwrap_or_default()
            );
            if names.contains_key(&key) {
                continue;
            }
            let name = format!("ce{}", names.len() + 1);
            let mut body = String::new();
            if let Some(bg) = &st.bg {
                body.push_str(&format!(
                    "<style:table-cell-properties fo:background-color=\"{}\"/>",
                    esc(bg)
                ));
            }
            let mut tp = String::new();
            if st.bl {
                tp.push_str(" fo:font-weight=\"bold\"");
            }
            if st.it {
                tp.push_str(" fo:font-style=\"italic\"");
            }
            if let Some(fs) = st.fs {
                tp.push_str(&format!(" fo:font-size=\"{fs}pt\""));
            }
            if let Some(cl) = &st.cl {
                tp.push_str(&format!(" fo:color=\"{}\"", esc(cl)));
            }
            if !tp.is_empty() {
                body.push_str(&format!("<style:text-properties{tp}/>"));
            }
            xml.push_str(&format!(
                "<style:style style:name=\"{name}\" style:family=\"table-cell\" style:parent-style-name=\"Default\">{body}</style:style>"
            ));
            names.insert(key, name);
        }
    }
    (names, xml)
}

fn style_key(s: Option<&CellStyle>) -> Option<String> {
    let st = s?;
    if !st.has_any() {
        return None;
    }
    Some(format!(
        "{}|{}|{}|{}|{}",
        st.bl,
        st.it,
        st.fs.map(|f| f.to_string()).unwrap_or_default(),
        st.cl.clone().unwrap_or_default(),
        st.bg.clone().unwrap_or_default()
    ))
}

/// 值 → (office 类型属性, 内容文本)
fn cell_value_xml(v: &Value) -> (String, String) {
    match v {
        Value::Number(n) => {
            let f = n.as_f64().unwrap_or(0.0);
            let text = if f.fract() == 0.0 && f.abs() < (i64::MAX as f64) {
                format!("{}", f as i64)
            } else {
                f.to_string()
            };
            (
                format!("office:value-type=\"float\" office:value=\"{text}\""),
                text,
            )
        }
        Value::Bool(b) => (
            format!("office:value-type=\"boolean\" office:boolean-value=\"{b}\""),
            if *b { "TRUE".into() } else { "FALSE".into() },
        ),
        Value::String(s) => ("office:value-type=\"string\"".into(), s.clone()),
        other => ("office:value-type=\"string\"".into(), other.to_string()),
    }
}

fn cell_in_merge(m: &MergeRange, r: u32, c: u32) -> bool {
    r >= m.start_row && r <= m.end_row && c >= m.start_column && c <= m.end_column
}

fn render_sheet(
    sheet: &SheetPayload,
    style_names: &HashMap<String, String>,
    out: &mut String,
) {
    out.push_str(&format!(
        "<table:table table:name=\"{}\">",
        esc(&sheet.name)
    ));
    let max_row = sheet
        .cells
        .iter()
        .map(|x| x.r)
        .chain(sheet.merges.iter().map(|m| m.end_row))
        .max()
        .unwrap_or(0);
    let max_col = sheet
        .cells
        .iter()
        .map(|x| x.c)
        .chain(sheet.merges.iter().map(|m| m.end_column))
        .max()
        .unwrap_or(0);
    out.push_str(&format!(
        "<table:table-column table:number-columns-repeated=\"{}\"/>",
        max_col + 1
    ));

    let cell_at = |r: u32, c: u32| sheet.cells.iter().find(|x| x.r == r && x.c == c);

    let mut gap = 0u32;
    let mut row_buf = String::new();
    for r in 0..=max_row {
        let row_used = sheet
            .merges
            .iter()
            .any(|m| r >= m.start_row && r <= m.end_row)
            || sheet
                .cells
                .iter()
                .any(|x| x.r == r && (x.v.is_some() || x.s.is_some()));
        if !row_used {
            gap += 1;
            continue;
        }
        if gap > 0 {
            // 空行段：repeated 挂在空行自身（挂到后继行会造成整体错位）
            out.push_str(&format!(
                "<table:table-row table:number-rows-repeated=\"{gap}\"><table:table-cell table:number-columns-repeated=\"{}\"/></table:table-row>",
                max_col + 1
            ));
            gap = 0;
        }
        row_buf.clear();
        let mut c = 0u32;
        let mut pending_empty: u32 = 0;
        let mut pending_covered: Vec<(u32, u32)> = Vec::new(); // (start_col, span)
        let flush_covered = |buf: &mut String, covered: &mut Vec<(u32, u32)>| {
            for (_, span) in covered.drain(..) {
                buf.push_str(&format!(
                    "<table:covered-table-cell table:number-columns-repeated=\"{span}\"/>"
                ));
            }
        };
        while c <= max_col {
            let merge_start = sheet
                .merges
                .iter()
                .find(|m| m.start_row == r && m.start_column == c);
            let covered_by = sheet.merges.iter().find(|m| {
                cell_in_merge(m, r, c) && !(m.start_row == r && m.start_column == c)
            });
            if let Some(m) = merge_start {
                flush_covered(&mut row_buf, &mut pending_covered);
                if pending_empty > 0 {
                    row_buf.push_str(&format!(
                        "<table:table-cell table:number-columns-repeated=\"{pending_empty}\"/>"
                    ));
                    pending_empty = 0;
                }
                let col_span = m.end_column - m.start_column + 1;
                let row_span = m.end_row - m.start_row + 1;
                let top = cell_at(r, c);
                let (vt, text) = top
                    .and_then(|x| x.v.as_ref())
                    .map(cell_value_xml)
                    .unwrap_or_else(|| ("office:value-type=\"string\"".into(), String::new()));
                let style = style_key(top.and_then(|x| x.s.as_ref()))
                    .and_then(|k| style_names.get(&k))
                    .map(|n| format!(" table:style-name=\"{n}\""))
                    .unwrap_or_default();
                row_buf.push_str(&format!(
                    "<table:table-cell{style} {vt} table:number-columns-spanned=\"{col_span}\" table:number-rows-spanned=\"{row_span}\"><text:p>{}</text:p></table:table-cell>",
                    esc(&text)
                ));
                c = m.end_column + 1;
                continue;
            }
            if covered_by.is_some() {
                // 连续 covered 合并为一次 repeated
                let span = match pending_covered.last_mut() {
                    Some(last) if last.0 + last.1 == c => {
                        last.1 += 1;
                        true
                    }
                    _ => false,
                };
                if !span {
                    // 新 covered 段开始前，先把上一段与中间的空格run落盘（列序不能乱）
                    flush_covered(&mut row_buf, &mut pending_covered);
                    if pending_empty > 0 {
                        row_buf.push_str(&format!(
                            "<table:table-cell table:number-columns-repeated=\"{pending_empty}\"/>"
                        ));
                        pending_empty = 0;
                    }
                    pending_covered.push((c, 1));
                }
                c += 1;
                continue;
            }
            let cell = cell_at(r, c);
            let has_content = cell
                .map(|x| x.v.is_some() || style_key(x.s.as_ref()).is_some())
                .unwrap_or(false);
            if !has_content {
                pending_empty += 1;
                c += 1;
                continue;
            }
            flush_covered(&mut row_buf, &mut pending_covered);
            if pending_empty > 0 {
                row_buf.push_str(&format!(
                    "<table:table-cell table:number-columns-repeated=\"{pending_empty}\"/>"
                ));
                pending_empty = 0;
            }
            let x = cell.unwrap();
            let (vt, text) = x
                .v
                .as_ref()
                .map(cell_value_xml)
                .unwrap_or_else(|| ("office:value-type=\"string\"".into(), String::new()));
            let style = style_key(x.s.as_ref())
                .and_then(|k| style_names.get(&k))
                .map(|n| format!(" table:style-name=\"{n}\""))
                .unwrap_or_default();
            row_buf.push_str(&format!(
                "<table:table-cell{style} {vt}><text:p>{}</text:p></table:table-cell>",
                esc(&text)
            ));
            c += 1;
        }
        flush_covered(&mut row_buf, &mut pending_covered);
        // 行尾的普通空格子直接截断不写
        out.push_str(&format!("<table:table-row>{row_buf}</table:table-row>"));
    }
    out.push_str("</table:table>");
}

pub fn ods_xml(workbook: &WorkbookPayload) -> (String, String) {
    let (style_names, styles_xml) = build_styles(&workbook.sheets);
    let mut content = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\
         <office:document-content \
         xmlns:office=\"urn:oasis:names:tc:opendocument:xmlns:office:1.0\" \
         xmlns:style=\"urn:oasis:names:tc:opendocument:xmlns:style:1.0\" \
         xmlns:fo=\"urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0\" \
         xmlns:table=\"urn:oasis:names:tc:opendocument:xmlns:table:1.0\" \
         xmlns:text=\"urn:oasis:names:tc:opendocument:xmlns:text:1.0\" \
         office:version=\"1.2\"><office:automatic-styles>",
    );
    content.push_str(&styles_xml);
    content.push_str(
        "</office:automatic-styles><office:body><office:spreadsheet>",
    );
    for sheet in &workbook.sheets {
        render_sheet(sheet, &style_names, &mut content);
    }
    content.push_str("</office:spreadsheet></office:body></office:document-content>");

    let styles = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\
         <office:document-styles \
         xmlns:office=\"urn:oasis:names:tc:opendocument:xmlns:office:1.0\" \
         xmlns:style=\"urn:oasis:names:tc:opendocument:xmlns:style:1.0\" \
         xmlns:fo=\"urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0\" \
         office:version=\"1.2\"><office:styles>\
         <style:style style:name=\"Default\" style:family=\"table-cell\"/>\
         </office:styles></office:document-styles>",
    );
    (content, styles)
}

fn manifest_xml() -> String {
    String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\
         <manifest:manifest \
         xmlns:manifest=\"urn:oasis:names:tc:opendocument:xmlns:manifest:1.0\" manifest:version=\"1.2\">\
         <manifest:file-entry manifest:full-path=\"/\" manifest:media-type=\"application/vnd.oasis.opendocument.spreadsheet\"/>\
         <manifest:file-entry manifest:full-path=\"content.xml\" manifest:media-type=\"text/xml\"/>\
         <manifest:file-entry manifest:full-path=\"styles.xml\" manifest:media-type=\"text/xml\"/>\
         </manifest:manifest>",
    )
}

/// 组装 ODS 字节流（mimetype 必须为首条且 STORED 不压缩）
pub fn ods_bytes(workbook: &WorkbookPayload) -> Result<Vec<u8>, Error> {
    let (content, styles) = ods_xml(workbook);
    let buf = Cursor::new(Vec::new());
    let mut zw = ZipWriter::new(buf);
    let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    let deflated = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    zw.start_file("mimetype", stored).map_err(zip_err)?;
    zw.write_all(b"application/vnd.oasis.opendocument.spreadsheet")
        .map_err(io_err)?;
    zw.start_file("META-INF/manifest.xml", deflated)
        .map_err(zip_err)?;
    zw.write_all(manifest_xml().as_bytes()).map_err(io_err)?;
    zw.start_file("content.xml", deflated).map_err(zip_err)?;
    zw.write_all(content.as_bytes()).map_err(io_err)?;
    zw.start_file("styles.xml", deflated).map_err(zip_err)?;
    zw.write_all(styles.as_bytes()).map_err(io_err)?;
    let out = zw.finish().map_err(zip_err)?;
    Ok(out.into_inner())
}

#[tauri::command]
pub fn write_ods(path: String, workbook: WorkbookPayload) -> Result<(), Error> {
    if let Some(parent) = Path::new(&path).parent() {
        if !parent.exists() {
            return Err(Error(format!("目录不存在: {}", parent.display())));
        }
    }
    let bytes = ods_bytes(&workbook)?;
    std::fs::write(&path, bytes).map_err(io_err)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::xlsx::CellPayload;
    use serde_json::json;

    fn cell(r: u32, c: u32, v: Value) -> CellPayload {
        CellPayload {
            r,
            c,
            v: Some(v),
            ..Default::default()
        }
    }

    #[test]
    fn ods_values_roundtrip_via_calamine() {
        let wb = WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "销售".into(),
                cells: vec![
                    cell(0, 0, json!("月")),
                    cell(0, 1, json!("销量")),
                    cell(1, 0, json!("一月")),
                    cell(1, 1, json!(10)),
                    cell(2, 1, json!(88.5)),
                    cell(2, 2, json!(true)),
                    // 稀疏：第 9 行才有值
                    cell(9, 4, json!("远处<b>&值")),
                ],
                merges: vec![],
                charts: vec![],
            }],
        };
        let path = std::env::temp_dir()
            .join(format!("openoffices-ods-{}.ods", std::process::id()))
            .to_string_lossy()
            .to_string();
        let bytes = ods_bytes(&wb).expect("ods bytes");
        std::fs::write(&path, bytes).expect("write");
        let back = crate::xlsx::read_xlsx(path.clone()).expect("calamine 读回失败");
        std::fs::remove_file(&path).ok();

        let sheet = &back.sheets[0];
        let find = |r: u32, c: u32| {
            sheet
                .cells
                .iter()
                .find(|x| x.r == r && x.c == c)
                .and_then(|x| x.v.clone())
        };
        assert_eq!(find(0, 0), Some(json!("月")));
        assert_eq!(find(1, 1), Some(json!(10)));
        assert_eq!(find(2, 1), Some(json!(88.5)));
        assert_eq!(find(2, 2), Some(json!(true)));
        assert_eq!(find(9, 4), Some(json!("远处<b>&值")), "稀疏行 + XML 转义");
    }

    #[test]
    fn ods_xml_covers_styles_and_merges() {
        let wb = WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "样式".into(),
                cells: vec![
            CellPayload {
                r: 0,
                c: 0,
                v: Some(json!("加粗红")),
                s: Some(CellStyle {
                    bl: true,
                    cl: Some("#ff0000".into()),
                    ..Default::default()
                }),
                ..Default::default()
            },
            CellPayload {
                r: 0,
                c: 1,
                v: Some(json!("合并标题")),
                s: Some(CellStyle {
                    bg: Some("#ffff00".into()),
                    ..Default::default()
                }),
                ..Default::default()
            },
        ],
                merges: vec![MergeRange {
                    start_row: 0,
                    start_column: 1,
                    end_row: 1,
                    end_column: 2,
                }],
                charts: vec![],
            }],
        };
        let (content, _styles) = ods_xml(&wb);
        assert!(content.contains("fo:font-weight=\"bold\""), "加粗样式");
        assert!(content.contains("fo:color=\"#ff0000\""), "字色");
        assert!(content.contains("fo:background-color=\"#ffff00\""), "底色");
        assert!(
            content.contains("table:number-columns-spanned=\"2\" table:number-rows-spanned=\"2\""),
            "合并跨度"
        );
        assert!(
            content.contains("<table:covered-table-cell"),
            "被覆盖格子占位"
        );
        // 同一 style 定义不重复出现
        let cnt = content.matches("fo:font-weight=\"bold\"").count();
        assert_eq!(cnt, 1, "样式去重");
    }

    #[test]
    fn ods_zip_layout() {
        let wb = WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "S".into(),
                cells: vec![cell(0, 0, json!(1))],
                merges: vec![],
                charts: vec![],
            }],
        };
        let bytes = ods_bytes(&wb).expect("ods bytes");
        let cur = Cursor::new(bytes);
        let mut z = zip::ZipArchive::new(cur).expect("zip 可解包");
        let names: Vec<String> = z.file_names().map(|s| s.to_string()).collect();
        assert_eq!(names[0], "mimetype", "mimetype 必须首条");
        assert_eq!(
            z.by_name("mimetype").unwrap().compression(),
            CompressionMethod::Stored,
            "mimetype 不压缩"
        );
        assert!(names.contains(&"META-INF/manifest.xml".to_string()));
        assert!(names.contains(&"content.xml".to_string()));
        assert!(names.contains(&"styles.xml".to_string()));
    }

    // CDP 冒烟夹具：手动 `cargo test gen_smoke_ods -- --ignored` 生成带样式与合并的 ods
    #[test]
    #[ignore]
    fn gen_smoke_ods() {
        let path = std::env::var("OO_FIXTURE_PATH").unwrap_or_else(|_| {
            concat!(env!("CARGO_MANIFEST_DIR"), "/../tmp/fixture-ods.ods").to_string()
        });
        if let Some(parent) = Path::new(&path).parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let wb = WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "销售".into(),
                cells: vec![
                    CellPayload {
                        r: 0,
                        c: 0,
                        v: Some(json!("季度")),
                        s: Some(CellStyle {
                            bl: true,
                            cl: Some("#ff0000".into()),
                            ..Default::default()
                        }),
                        ..Default::default()
                    },
                    cell(0, 1, json!("销量")),
                    cell(1, 0, json!("一月")),
                    cell(1, 1, json!(10)),
                    cell(2, 0, json!("二月")),
                    cell(2, 1, json!(25.5)),
                    cell(3, 0, json!("三月")),
                    cell(3, 1, json!(40)),
                    CellPayload {
                        r: 5,
                        c: 0,
                        v: Some(json!("合并备注")),
                        s: Some(CellStyle {
                            bg: Some("#ffff00".into()),
                            ..Default::default()
                        }),
                        ..Default::default()
                    },
                ],
                merges: vec![MergeRange {
                    start_row: 5,
                    start_column: 0,
                    end_row: 6,
                    end_column: 1,
                }],
                charts: vec![],
            }],
        };
        write_ods(path.clone(), wb).expect("生成夹具 ods 失败");
        println!("fixture: {path}");
    }
}
