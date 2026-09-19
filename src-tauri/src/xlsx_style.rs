//! 直接解析 xlsx zip 读取单元格样式与合并区（calamine 不公开样式 API）。
//! 值仍由 calamine 提供；本模块只产 per-sheet 的 (r,c)→CellStyle 与 mergeCells。

use std::collections::HashMap;
use std::fs::File;
use std::io::Read;

use quick_xml::events::Event;
use quick_xml::Reader;

use crate::xlsx::{CellStyle, MergeRange};

#[derive(Default)]
pub struct SheetFmt {
    pub styles: HashMap<(u32, u32), CellStyle>,
    pub merges: Vec<MergeRange>,
}

#[derive(Default, Clone)]
struct FontInfo {
    bl: bool,
    it: bool,
    fs: Option<f64>,
    cl: Option<String>,
}

fn attr_str(e: &quick_xml::events::BytesStart<'_>, key: &str) -> Option<String> {
    for a in e.attributes().flatten() {
        if a.key.local_name().as_ref() == key {
            return a
                .normalized_value(quick_xml::XmlVersion::Implicit1_0)
                .ok()
                .map(|v| v.into_owned());
        }
    }
    None
}

fn argb_to_hex(v: &str) -> Option<String> {
    let rgb = match v.len() {
        8 => &v[2..],
        6 => v,
        _ => return None,
    };
    if !rgb.bytes().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    Some(format!("#{}", rgb.to_lowercase()))
}

fn a1_to_rc(s: &str) -> Option<(u32, u32)> {
    let mut col: u32 = 0;
    let mut i = 0usize;
    let b = s.as_bytes();
    while i < b.len() && b[i].is_ascii_alphabetic() {
        col = col * 26 + (b[i] & 31) as u32;
        i += 1;
    }
    if i == 0 || i >= s.len() {
        return None;
    }
    let row: u32 = s[i..].parse().ok()?;
    Some((row.checked_sub(1)?, col.checked_sub(1)?))
}

fn read_entry(zip: &mut zip::ZipArchive<File>, name: &str) -> Option<String> {
    let mut f = zip.by_name(name).ok()?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).ok()?;
    String::from_utf8(buf).ok()
}

/// xl/workbook.xml + rels → [(sheetName, zip 内 sheet 路径)]，按 workbook 声明顺序
fn sheet_paths(zip: &mut zip::ZipArchive<File>) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let Some(wb) = read_entry(zip, "xl/workbook.xml") else {
        return out;
    };
    let Some(rels) = read_entry(zip, "xl/_rels/workbook.xml.rels") else {
        return out;
    };
    let mut rid_map: HashMap<String, String> = HashMap::new();
    let mut reader = Reader::from_str(&rels);
    while let Ok(ev) = reader.read_event() {
        if let Event::Empty(e) | Event::Start(e) = &ev {
            if e.local_name().as_ref() == "Relationship" {
                if let (Some(id), Some(target)) = (attr_str(e, "Id"), attr_str(e, "Target")) {
                    rid_map.insert(id, target);
                }
            }
        }
        if matches!(ev, Event::Eof) {
            break;
        }
    }
    let mut reader = Reader::from_str(&wb);
    while let Ok(ev) = reader.read_event() {
        if let Event::Empty(e) | Event::Start(e) = &ev {
            if e.local_name().as_ref() == "sheet" {
                if let (Some(name), Some(rid)) = (attr_str(e, "name"), attr_str(e, "id")) {
                    if let Some(t) = rid_map.get(&rid) {
                        let clean = t.trim_start_matches('/');
                        let path = if clean.starts_with("xl/") {
                            clean.to_string()
                        } else {
                            format!("xl/{}", clean)
                        };
                        out.push((name, path));
                    }
                }
            }
        }
        if matches!(ev, Event::Eof) {
            break;
        }
    }
    out
}

type StylesTable = (Vec<FontInfo>, Vec<Option<String>>, Vec<(u32, u32)>);

fn parse_styles(xml: &str) -> StylesTable {
    let mut fonts: Vec<FontInfo> = Vec::new();
    let mut fills: Vec<Option<String>> = Vec::new();
    let mut xfs: Vec<(u32, u32)> = Vec::new();
    let mut cur_font = FontInfo::default();
    let mut cur_fill: Option<String> = None;
    let mut sec = String::new(); // fonts | fills | cellXfs
    let mut reader = Reader::from_str(xml);
    while let Ok(ev) = reader.read_event() {
        match &ev {
            Event::Start(e) => {
                let nm = e.local_name();
                let nm = nm.as_ref();
                match nm {
                    "fonts" | "fills" | "cellXfs" => sec = nm.to_string(),
                    "font" => cur_font = FontInfo::default(),
                    "fill" => cur_fill = None,
                    _ => {}
                }
            }
            Event::Empty(e) => {
                let nm = e.local_name();
                let nm = nm.as_ref();
                match sec.as_str() {
                    "fonts" => match nm {
                        "b" => cur_font.bl = bool_attr(e),
                        "i" => cur_font.it = bool_attr(e),
                        "sz" => cur_font.fs = attr_str(e, "val").and_then(|v| v.parse().ok()),
                        "color" if cur_font.cl.is_none() => {
                            cur_font.cl = attr_str(e, "rgb").as_deref().and_then(argb_to_hex);
                        }
                        _ => {}
                    },
                    "fills" => {
                        if nm == "fgColor" || nm == "bgColor" {
                            if let Some(hex) = attr_str(e, "rgb").as_deref().and_then(argb_to_hex) {
                                if nm == "fgColor" || cur_fill.is_none() {
                                    cur_fill = Some(hex);
                                }
                            }
                        }
                    }
                    "cellXfs" if nm == "xf" => {
                        let font = attr_str(e, "fontId").and_then(|v| v.parse().ok()).unwrap_or(0);
                        let fill = attr_str(e, "fillId").and_then(|v| v.parse().ok()).unwrap_or(0);
                        xfs.push((font, fill));
                    }
                    _ => {}
                }
            }
            Event::End(e) => {
                let nm = e.local_name();
                let nm = nm.as_ref();
                match nm {
                    "font" => fonts.push(std::mem::take(&mut cur_font)),
                    "fill" => fills.push(cur_fill.take()),
                    "fonts" | "fills" | "cellXfs" => sec.clear(),
                    _ => {}
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    (fonts, fills, xfs)
}

fn bool_attr(e: &quick_xml::events::BytesStart<'_>) -> bool {
    attr_str(e, "val").map(|v| v != "0" && v != "false").unwrap_or(true)
}

fn parse_sheet(
    xml: &str,
    fonts: &[FontInfo],
    fills: &[Option<String>],
    xfs: &[(u32, u32)],
) -> SheetFmt {
    let mut out = SheetFmt::default();
    let mut reader = Reader::from_str(xml);
    while let Ok(ev) = reader.read_event() {
        if let Event::Empty(e) | Event::Start(e) = &ev {
            let nm = e.local_name();
            let nm = nm.as_ref();
            if nm == "c" {
                let xf: u32 = attr_str(e, "s").and_then(|v| v.parse().ok()).unwrap_or(0);
                if xf > 0 {
                    if let Some((r, c)) = attr_str(e, "r").as_deref().and_then(a1_to_rc) {
                        if let Some(style) = style_for(xf as usize, fonts, fills, xfs) {
                            out.styles.insert((r, c), style);
                        }
                    }
                }
            } else if nm == "mergeCell" {
                if let Some(range) = attr_str(e, "ref").as_deref().and_then(parse_range) {
                    out.merges.push(range);
                }
            }
        }
        if matches!(ev, Event::Eof) {
            break;
        }
    }
    out
}

fn style_for(
    xf: usize,
    fonts: &[FontInfo],
    fills: &[Option<String>],
    xfs: &[(u32, u32)],
) -> Option<CellStyle> {
    let (font_id, fill_id) = *xfs.get(xf)?;
    let f = fonts.get(font_id as usize).cloned().unwrap_or_default();
    let bg = fills.get(fill_id as usize).cloned().flatten();
    let style = CellStyle {
        bl: f.bl,
        it: f.it,
        fs: f.fs.filter(|v| *v > 0.0 && (*v - 11.0).abs() > f64::EPSILON),
        cl: f.cl,
        bg,
    };
    style.has_any().then_some(style)
}

fn parse_range(s: &str) -> Option<MergeRange> {
    let (a, b) = s.split_once(':')?;
    let (r1, c1) = a1_to_rc(a)?;
    let (r2, c2) = a1_to_rc(b)?;
    Some(MergeRange {
        start_row: r1,
        start_column: c1,
        end_row: r2.max(r1),
        end_column: c2.max(c1),
    })
}

/// 任何失败都退化为空表（非 zip 格式：xls/ods/csv 无样式可读）
pub fn read_xlsx_styles(path: &str) -> HashMap<String, SheetFmt> {
    let mut out = HashMap::new();
    let Ok(file) = File::open(path) else { return out };
    let Ok(mut zip) = zip::ZipArchive::new(file) else { return out };
    let Some(styles_xml) = read_entry(&mut zip, "xl/styles.xml") else {
        return out;
    };
    let (fonts, fills, xfs) = parse_styles(&styles_xml);
    for (name, p) in sheet_paths(&mut zip) {
        if let Some(xml) = read_entry(&mut zip, &p) {
            out.insert(name, parse_sheet(&xml, &fonts, &fills, &xfs));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a1_converts() {
        assert_eq!(a1_to_rc("A1"), Some((0, 0)));
        assert_eq!(a1_to_rc("C3"), Some((2, 2)));
        assert_eq!(a1_to_rc("AA10"), Some((9, 26)));
        assert_eq!(a1_to_rc("A0"), None);
        assert_eq!(a1_to_rc("1"), None);
    }

    #[test]
    fn argb_converts() {
        assert_eq!(argb_to_hex("FFFF0000").as_deref(), Some("#ff0000"));
        assert_eq!(argb_to_hex("112233").as_deref(), Some("#112233"));
        assert_eq!(argb_to_hex("XYZ"), None);
    }

    #[test]
    fn range_parses() {
        let r = parse_range("A1:B3").unwrap();
        assert_eq!(
            (r.start_row, r.start_column, r.end_row, r.end_column),
            (0, 0, 2, 1)
        );
        assert!(parse_range("A1").is_none());
    }

    #[test]
    fn styles_table_parses() {
        let xml = r#"<?xml version="1.0"?><styleSheet xmlns="x">
          <fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>
          <font><b/><i/><sz val="14"/><color rgb="FFFF0000"/></font></fonts>
          <fills count="3"><fill><patternFill patternType="none"/></fill>
          <fill><patternFill patternType="gray125"/></fill>
          <fill><patternFill patternType="solid"><fgColor rgb="FF00FF00"/></patternFill></fill></fills>
          <cellXfs count="2"><xf fontId="0" fillId="0"/><xf fontId="1" fillId="2" applyFont="1"/></cellXfs>
        </styleSheet>"#;
        let (fonts, fills, xfs) = parse_styles(xml);
        assert_eq!(fonts.len(), 2);
        assert!(fonts[1].bl && fonts[1].it);
        assert_eq!(fonts[1].cl.as_deref(), Some("#ff0000"));
        assert_eq!(fills.len(), 3);
        assert_eq!(fills[2].as_deref(), Some("#00ff00"));
        assert_eq!(xfs, vec![(0, 0), (1, 2)]);
        let st = style_for(1, &fonts, &fills, &xfs).expect("样式存在");
        assert!(st.bl && st.it);
        assert_eq!(st.fs, Some(14.0));
        assert_eq!(st.bg.as_deref(), Some("#00ff00"));
        assert!(style_for(0, &fonts, &fills, &xfs).is_none());
    }
}
