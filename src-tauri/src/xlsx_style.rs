//! 直接解析 xlsx zip 读取单元格样式与合并区（calamine 不公开样式 API）。
//! 值仍由 calamine 提供；本模块只产 per-sheet 的 (r,c)→CellStyle 与 mergeCells。

use std::collections::HashMap;
use std::fs::File;
use std::io::Read;

use quick_xml::events::Event;
use quick_xml::Reader;

use crate::xlsx::{BorderSide, CellBorder, CellStyle, MergeRange};

#[derive(Default, Debug)]
pub struct SheetFmt {
    pub styles: HashMap<(u32, u32), CellStyle>,
    pub merges: Vec<MergeRange>,
    /// 列号 → 宽度像素（与 Univer 快照同单位；xlsx 存字符宽，按 round(w*7+5) 换算）
    pub col_widths: HashMap<u32, f64>,
    /// 行号 → 高度像素（xlsx 存磅，按 4/3 换算）
    pub row_heights: HashMap<u32, f64>,
    pub hidden_rows: Vec<u32>,
    pub hidden_cols: Vec<u32>,
    /// 冻结窗格 (rows, cols)
    pub freeze: Option<(u32, u32)>,
}

/// xlsx 列宽（字符数，MDW=7 + 5px padding）→ 像素
pub(crate) fn chars_to_px(chars: f64) -> f64 {
    (chars * 7.0 + 5.0).round()
}

/// xlsx 行高（磅）→ 像素（96dpi）
pub(crate) fn pt_to_px(pt: f64) -> f64 {
    (pt * 4.0 / 3.0).round()
}

#[derive(Default, Clone)]
struct FontInfo {
    bl: bool,
    it: bool,
    ff: Option<String>,
    fs: Option<f64>,
    cl: Option<String>,
}

#[derive(Default, Clone)]
struct BSide {
    s: Option<String>,
    c: Option<String>,
}

#[derive(Default, Clone)]
struct BorderRec {
    l: BSide,
    r: BSide,
    t: BSide,
    b: BSide,
}

#[derive(Default, Clone)]
struct XfRec {
    font: u32,
    fill: u32,
    border: u32,
    numfmt: u32,
    ho: Option<String>,
    vo: Option<String>,
    wrap: bool,
}

#[derive(Default)]
struct StyleBook {
    fonts: Vec<FontInfo>,
    fills: Vec<Option<String>>,
    xfs: Vec<XfRec>,
    borders: Vec<BorderRec>,
    numfmts: HashMap<u32, String>,
}

pub(crate) fn attr_str(e: &quick_xml::events::BytesStart<'_>, key: &str) -> Option<String> {
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

pub(crate) fn a1_to_rc(s: &str) -> Option<(u32, u32)> {
    let mut col: u32 = 0;
    let mut i = 0usize;
    let b = s.as_bytes();
    while i < b.len() && b[i].is_ascii_alphabetic() {
        col = col.checked_mul(26)?.checked_add((b[i] & 31) as u32)?;
        i += 1;
    }
    if i == 0 || i >= s.len() {
        return None;
    }
    let row: u32 = s[i..].parse().ok()?;
    Some((row.checked_sub(1)?, col.checked_sub(1)?))
}

pub(crate) fn read_entry(zip: &mut zip::ZipArchive<File>, name: &str) -> Option<String> {
    let mut f = zip.by_name(name).ok()?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).ok()?;
    String::from_utf8(buf).ok()
}

/// xl/workbook.xml + rels → [(sheetName, zip 内 sheet 路径)]，按 workbook 声明顺序
pub(crate) fn sheet_paths(zip: &mut zip::ZipArchive<File>) -> Vec<(String, String)> {
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

/// 常用内建数字格式 id → 模式串（日期类 id 不映射：calamine 已把日期转成字符串值）
fn builtin_numfmt(id: u32) -> Option<&'static str> {
    Some(match id {
        1 => "0",
        2 => "0.00",
        3 => "#,##0",
        4 => "#,##0.00",
        9 => "0%",
        10 => "0.00%",
        11 => "0.00E+00",
        39 => "0.00",
        40 => "#,##0.00",
        49 => "@",
        _ => return None,
    })
}

fn xf_from_attrs(e: &quick_xml::events::BytesStart<'_>) -> XfRec {
    XfRec {
        font: attr_str(e, "fontId").and_then(|v| v.parse().ok()).unwrap_or(0),
        fill: attr_str(e, "fillId").and_then(|v| v.parse().ok()).unwrap_or(0),
        border: attr_str(e, "borderId").and_then(|v| v.parse().ok()).unwrap_or(0),
        numfmt: attr_str(e, "numFmtId").and_then(|v| v.parse().ok()).unwrap_or(0),
        ..Default::default()
    }
}

fn apply_alignment(rec: &mut XfRec, e: &quick_xml::events::BytesStart<'_>) {
    rec.ho = attr_str(e, "horizontal").and_then(|h| match h.as_str() {
        "left" | "center" | "right" | "justify" => Some(h),
        _ => None,
    });
    rec.vo = attr_str(e, "vertical").and_then(|v| match v.as_str() {
        "top" => Some("top".to_string()),
        "center" => Some("middle".to_string()),
        "bottom" => Some("bottom".to_string()),
        _ => None,
    });
    rec.wrap = matches!(
        attr_str(e, "wrapText").as_deref(),
        Some("1") | Some("true")
    );
}

fn parse_styles(xml: &str) -> StyleBook {
    let mut book = StyleBook::default();
    let mut cur_font = FontInfo::default();
    let mut cur_fill: Option<String> = None;
    let mut cur_border = BorderRec::default();
    let mut cur_side: Option<(String, BSide)> = None;
    let mut cur_xf: Option<XfRec> = None;
    let mut sec = String::new(); // fonts | fills | borders | cellXfs | numFmts
    let mut reader = Reader::from_str(xml);
    while let Ok(ev) = reader.read_event() {
        match &ev {
            Event::Start(e) => {
                let nm = e.local_name();
                let nm = nm.as_ref();
                match nm {
                    "fonts" | "fills" | "borders" | "cellXfs" | "numFmts" => sec = nm.to_string(),
                    "font" => cur_font = FontInfo::default(),
                    "fill" => cur_fill = None,
                    "border" if sec == "borders" => cur_border = BorderRec::default(),
                    "left" | "right" | "top" | "bottom" if sec == "borders" => {
                        cur_side = Some((
                            nm.to_string(),
                            BSide { s: attr_str(e, "style"), c: None },
                        ));
                    }
                    "xf" if sec == "cellXfs" => cur_xf = Some(xf_from_attrs(e)),
                    _ => {}
                }
            }
            Event::Empty(e) => {
                let nm = e.local_name();
                let nm = nm.as_ref();
                match (sec.as_str(), nm) {
                    ("fonts", "b") => cur_font.bl = bool_attr(e),
                    ("fonts", "i") => cur_font.it = bool_attr(e),
                    ("fonts", "name") => cur_font.ff = attr_str(e, "val"),
                    ("fonts", "sz") => cur_font.fs = attr_str(e, "val").and_then(|v| v.parse().ok()),
                    ("fonts", "color") if cur_font.cl.is_none() => {
                        cur_font.cl = attr_str(e, "rgb").as_deref().and_then(argb_to_hex);
                    }
                    ("fonts", "font") => book.fonts.push(FontInfo::default()),
                    ("fills", "fill") => book.fills.push(None),
                    ("fills", "fgColor") | ("fills", "bgColor") => {
                        if let Some(hex) = attr_str(e, "rgb").as_deref().and_then(argb_to_hex) {
                            if nm == "fgColor" || cur_fill.is_none() {
                                cur_fill = Some(hex);
                            }
                        }
                    }
                    ("borders", "border") => book.borders.push(BorderRec::default()),
                    ("borders", "left" | "right" | "top" | "bottom") => {
                        let side = BSide { s: attr_str(e, "style"), c: None };
                        set_border_side(&mut cur_border, nm, side);
                    }
                    ("borders", "color") => {
                        if let Some((_, side)) = &mut cur_side {
                            side.c = attr_str(e, "rgb").as_deref().and_then(argb_to_hex);
                        }
                    }
                    ("cellXfs", "xf") => book.xfs.push(xf_from_attrs(e)),
                    ("cellXfs", "alignment") => {
                        if let Some(rec) = &mut cur_xf {
                            apply_alignment(rec, e);
                        }
                    }
                    ("numFmts", "numFmt") => {
                        if let (Some(id), Some(code)) = (
                            attr_str(e, "numFmtId").and_then(|v| v.parse().ok()),
                            attr_str(e, "formatCode"),
                        ) {
                            book.numfmts.insert(id, code);
                        }
                    }
                    _ => {}
                }
            }
            Event::End(e) => {
                let nm = e.local_name();
                let nm = nm.as_ref();
                match nm {
                    "font" => book.fonts.push(std::mem::take(&mut cur_font)),
                    "fill" => book.fills.push(cur_fill.take()),
                    "left" | "right" | "top" | "bottom" if sec == "borders" => {
                        if let Some((key, side)) = cur_side.take() {
                            set_border_side(&mut cur_border, &key, side);
                        }
                    }
                    "border" if sec == "borders" => book.borders.push(std::mem::take(&mut cur_border)),
                    "xf" if sec == "cellXfs" => {
                        if let Some(rec) = cur_xf.take() {
                            book.xfs.push(rec);
                        }
                    }
                    "fonts" | "fills" | "borders" | "cellXfs" | "numFmts" => sec.clear(),
                    _ => {}
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    book
}

fn set_border_side(rec: &mut BorderRec, key: &str, side: BSide) {
    match key {
        "left" => rec.l = side,
        "right" => rec.r = side,
        "top" => rec.t = side,
        "bottom" => rec.b = side,
        _ => {}
    }
}

fn bool_attr(e: &quick_xml::events::BytesStart<'_>) -> bool {
    attr_str(e, "val").map(|v| v != "0" && v != "false").unwrap_or(true)
}

fn parse_sheet(xml: &str, book: &StyleBook) -> SheetFmt {
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
                        if let Some(style) = style_for(xf as usize, book) {
                            out.styles.insert((r, c), style);
                        }
                    }
                }
            } else if nm == "mergeCell" {
                if let Some(range) = attr_str(e, "ref").as_deref().and_then(parse_range) {
                    out.merges.push(range);
                }
            } else if nm == "col" {
                // <col min max width customWidth hidden>：Excel/LO 只要显式写了 col 段就视为自定义宽度
                let min = attr_str(e, "min").and_then(|v| v.parse::<u32>().ok()).unwrap_or(1);
                let max = attr_str(e, "max").and_then(|v| v.parse::<u32>().ok()).unwrap_or(min);
                let range = min..=max.max(min).min(min + 2047);
                if matches!(attr_str(e, "hidden").as_deref(), Some("1") | Some("true")) {
                    out.hidden_cols.extend(range.filter(|c| *c >= 1).map(|c| c - 1));
                } else if let Some(w) = attr_str(e, "width").and_then(|v| v.parse::<f64>().ok()) {
                    let px = chars_to_px(w);
                    for c in range {
                        if c >= 1 {
                            out.col_widths.insert(c - 1, px);
                        }
                    }
                }
            } else if nm == "row" {
                if let Some(r) = attr_str(e, "r").and_then(|v| v.parse::<u32>().ok()) {
                    if matches!(attr_str(e, "hidden").as_deref(), Some("1") | Some("true")) {
                        if r >= 1 {
                            out.hidden_rows.push(r - 1);
                        }
                    } else if let Some(ht) =
                        attr_str(e, "ht").and_then(|v| v.parse::<f64>().ok())
                    {
                        if r >= 1 {
                            out.row_heights.insert(r - 1, pt_to_px(ht));
                        }
                    }
                }
            } else if nm == "pane" {
                // <pane xSplit ySplit state="frozen">：仅冻结语义（split 滚动条不算）
                if attr_str(e, "state").as_deref() == Some("frozen") {
                    let rows = attr_str(e, "ySplit").and_then(|v| v.parse::<u32>().ok()).unwrap_or(0);
                    let cols = attr_str(e, "xSplit").and_then(|v| v.parse::<u32>().ok()).unwrap_or(0);
                    if rows > 0 || cols > 0 {
                        out.freeze = Some((rows, cols));
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

fn side_to_payload(side: &BSide) -> Option<BorderSide> {
    if side.s.is_none() && side.c.is_none() {
        return None;
    }
    Some(BorderSide {
        s: side.s.clone().filter(|v| v != "none"),
        c: side.c.clone(),
    })
}

fn style_for(xf: usize, book: &StyleBook) -> Option<CellStyle> {
    let rec = book.xfs.get(xf)?;
    let f = book.fonts.get(rec.font as usize).cloned().unwrap_or_default();
    let bg = book.fills.get(rec.fill as usize).cloned().flatten();
    let bd = book.borders.get(rec.border as usize).and_then(|b| {
        let cell_bd = CellBorder {
            t: side_to_payload(&b.t),
            r: side_to_payload(&b.r),
            b: side_to_payload(&b.b),
            l: side_to_payload(&b.l),
        };
        (!cell_bd.is_empty()).then_some(cell_bd)
    });
    let nf = book
        .numfmts
        .get(&rec.numfmt)
        .cloned()
        .or_else(|| builtin_numfmt(rec.numfmt).map(String::from));
    let style = CellStyle {
        bl: f.bl,
        it: f.it,
        ff: f
            .ff
            .filter(|n| !n.is_empty() && n != "Calibri" && n != "等线"),
        fs: f.fs.filter(|v| *v > 0.0 && (*v - 11.0).abs() > f64::EPSILON),
        cl: f.cl,
        bg,
        bd,
        ho: rec.ho.clone(),
        vo: rec.vo.clone(),
        wb: rec.wrap,
        nf,
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

/// 任何失败都退化为空表（非 xlsx 格式：xls/csv 无样式可读；ods 走 ods.rs 自己的读侧）
pub fn read_xlsx_styles(path: &str) -> HashMap<String, SheetFmt> {
    let mut out = HashMap::new();
    let Ok(file) = File::open(path) else { return out };
    let Ok(mut zip) = zip::ZipArchive::new(file) else { return out };
    let Some(styles_xml) = read_entry(&mut zip, "xl/styles.xml") else {
        return out;
    };
    let book = parse_styles(&styles_xml);
    for (name, p) in sheet_paths(&mut zip) {
        if let Some(xml) = read_entry(&mut zip, &p) {
            out.insert(name, parse_sheet(&xml, &book));
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
          <numFmts count="1"><numFmt numFmtId="164" formatCode="0.0_;-0.0_"/></numFmts>
          <fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>
          <font><b/><i/><sz val="14"/><color rgb="FFFF0000"/></font></fonts>
          <fills count="3"><fill><patternFill patternType="none"/></fill>
          <fill><patternFill patternType="gray125"/></fill>
          <fill><patternFill patternType="solid"><fgColor rgb="FF00FF00"/></patternFill></fill></fills>
          <borders count="2"><border/>
          <border><left style="thin"><color rgb="FF3366CC"/></left><right style="dashed"/>
          <top style="medium"/><bottom style="hair"><color rgb="FF000000"/></bottom></border></borders>
          <cellXfs count="2"><xf fontId="0" fillId="0"/>
          <xf fontId="1" fillId="2" borderId="1" numFmtId="164" applyFont="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs>
        </styleSheet>"#;
        let book = parse_styles(xml);
        assert_eq!(book.fonts.len(), 2);
        assert!(book.fonts[1].bl && book.fonts[1].it);
        assert_eq!(book.fonts[1].cl.as_deref(), Some("#ff0000"));
        assert_eq!(book.fills.len(), 3);
        assert_eq!(book.fills[2].as_deref(), Some("#00ff00"));
        assert_eq!(book.borders.len(), 2);
        assert_eq!(book.borders[1].l.s.as_deref(), Some("thin"));
        assert_eq!(book.borders[1].l.c.as_deref(), Some("#3366cc"));
        assert_eq!(book.borders[1].r.s.as_deref(), Some("dashed"));
        assert_eq!(book.borders[1].b.s.as_deref(), Some("hair"));
        assert_eq!(book.xfs.len(), 2);
        assert_eq!((book.xfs[1].font, book.xfs[1].fill), (1, 2));
        assert_eq!((book.xfs[1].border, book.xfs[1].numfmt), (1, 164));
        assert_eq!(book.xfs[1].ho.as_deref(), Some("center"));
        assert_eq!(book.xfs[1].vo.as_deref(), Some("middle"));
        assert!(book.xfs[1].wrap);
        let st = style_for(1, &book).expect("样式存在");
        assert!(st.bl && st.it && st.wb);
        assert_eq!(st.fs, Some(14.0));
        assert_eq!(st.bg.as_deref(), Some("#00ff00"));
        assert_eq!(st.ho.as_deref(), Some("center"));
        assert_eq!(st.vo.as_deref(), Some("middle"));
        assert_eq!(st.nf.as_deref(), Some("0.0_;-0.0_"), "自定义 numFmt");
        let bd = st.bd.expect("边框存在");
        assert_eq!(bd.l.as_ref().and_then(|x| x.s.as_deref()), Some("thin"));
        assert_eq!(bd.l.as_ref().and_then(|x| x.c.as_deref()), Some("#3366cc"));
        assert_eq!(bd.r.as_ref().and_then(|x| x.s.as_deref()), Some("dashed"));
        assert!(bd.t.as_ref().expect("top").c.is_none(), "未写 color 则无颜色");
        assert!(style_for(0, &book).is_none());
    }

    #[test]
    fn builtin_numfmt_maps() {
        assert_eq!(builtin_numfmt(9), Some("0%"));
        assert_eq!(builtin_numfmt(3), Some("#,##0"));
        assert_eq!(builtin_numfmt(14), None, "日期 id 不映射");
        assert_eq!(builtin_numfmt(0), None);
    }
}
