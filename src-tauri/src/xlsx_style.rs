//! 直接解析 xlsx zip 读取单元格样式与合并区（calamine 不公开样式 API）。
//! 值仍由 calamine 提供；本模块只产 per-sheet 的 (r,c)→CellStyle 与 mergeCells。

use std::collections::HashMap;
use std::fs::File;
use std::io::Read;

use quick_xml::events::Event;
use quick_xml::Reader;

use crate::xlsx::{
    BorderSide, CellBorder, CellStyle, CondFormatStyle, DefaultFont, MergeRange, SheetFormat,
};

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
    /// `<sheetFormatPr>`：没明说行高的那些行的底数（磅字面）。Excel 16.0 实测**不用它排版**，
    /// 但它自己存盘会重写 ⇒ 收进载荷只为存盘时原样落回，界面与纸面都不吃它
    pub sheet_format: Option<SheetFormat>,
    /// (行,列) → 公式文本（OOXML 原生不带 '=' 前缀；shared 从格无文本不落表）
    pub formulas: HashMap<(u32, u32), String>,
    /// 筛选 / 数据验证 / 条件格式，外加"文件里有、模型装不下"的边界账
    pub rules: crate::xlsx_rules::SheetRulesRead,
}

/// crate 与 OOXML 规范共用的那一档缺省行高（磅）。`<sheetFormatPr @defaultRowHeight>` 写的正好是它
/// 时按"没说话"处理：省掉这枚声明与把它写进字节里，对读的人来说同一档
pub(crate) const DEFAULT_SHEET_ROW_HEIGHT_PT: f64 = 15.0;

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

pub(crate) fn argb_to_hex(v: &str) -> Option<String> {
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

pub(crate) fn read_entry<R: std::io::Read + std::io::Seek>(
    zip: &mut zip::ZipArchive<R>,
    name: &str,
) -> Option<String> {
    let mut f = zip.by_name(name).ok()?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).ok()?;
    String::from_utf8(buf).ok()
}

/// 读出部件的原始字节（搬部件用：XML 以外的部件如图片经不起 String 往返）
pub(crate) fn read_entry_bytes<R: std::io::Read + std::io::Seek>(
    zip: &mut zip::ZipArchive<R>,
    name: &str,
) -> Option<Vec<u8>> {
    let mut f = zip.by_name(name).ok()?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).ok()?;
    Some(buf)
}

/// xl/workbook.xml + rels → [(sheetName, zip 内 sheet 路径)]，按 workbook 声明顺序
pub(crate) fn sheet_paths<R: std::io::Read + std::io::Seek>(
    zip: &mut zip::ZipArchive<R>,
) -> Vec<(String, String)> {
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
    let mut cur_cell: Option<(u32, u32)> = None;
    let mut f_buf: Option<String> = None;
    while let Ok(ev) = reader.read_event() {
        if let Event::Empty(e) | Event::Start(e) = &ev {
            let nm = e.local_name();
            let nm = nm.as_ref();
            if nm == "c" {
                cur_cell = attr_str(e, "r").as_deref().and_then(a1_to_rc);
                let xf: u32 = attr_str(e, "s").and_then(|v| v.parse().ok()).unwrap_or(0);
                if xf > 0 {
                    if let Some((r, c)) = cur_cell {
                        if let Some(style) = style_for(xf as usize, book) {
                            out.styles.insert((r, c), style);
                        }
                    }
                }
            } else if nm == "f" {
                // 仅 Start 收集文本；Empty 的 <f/> 是 shared 从格/无缓存数组式，跳过
                if matches!(ev, Event::Start(_)) {
                    f_buf = Some(String::new());
                }
            } else if nm == "sheetFormatPr" {
                // 缺省行高那一层按**磅字面**收，不换算成像素（换算一趟就在字节上漂一档）。
                // 归一化只有一条：正好 15 且没带 customHeight 视作没说话——crate 落笔就是 15，
                // 省掉这枚声明与把它写进字节里同一档（与 v0.52 那档"只剩默认边距的件视作没声明"同理）
                let pt = attr_str(e, "defaultRowHeight")
                    .as_deref()
                    .and_then(|v| v.parse::<f64>().ok());
                // 0 与负数在这一层就是"没说话"（与 v0.57 那枚 `fs` 同一分寸）
                if let Some(pt) = pt.filter(|v| v.is_finite() && *v > 0.0) {
                    let custom = matches!(attr_str(e, "customHeight").as_deref(), Some("1") | Some("true"));
                    if pt != DEFAULT_SHEET_ROW_HEIGHT_PT || custom {
                        out.sheet_format = Some(SheetFormat {
                            default_row_height: pt,
                            custom_height: custom,
                        });
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
        } else if let Event::Text(t) = &ev {
            if let Some(buf) = f_buf.as_mut() {
                buf.push_str(t.as_ref());
            }
        } else if let Event::GeneralRef(r) = &ev {
            // quick-xml 0.42 把 &lt; 等实体拆成独立事件（不带 &;），还原后再统一 unescape
            if let Some(buf) = f_buf.as_mut() {
                buf.push('&');
                buf.push_str(r.as_ref());
                buf.push(';');
            }
        } else if let Event::End(e) = &ev {
            match e.local_name().as_ref() {
                "f" => {
                    if let Some(buf) = f_buf.take() {
                        let un = match quick_xml::escape::unescape(&buf) {
                            Ok(cow) => cow.into_owned(),
                            Err(_) => buf,
                        };
                        let f = un.trim_start_matches('=').to_string();
                        if !f.is_empty() {
                            if let Some((r, c)) = cur_cell {
                                out.formulas.insert((r, c), f);
                            }
                        }
                    }
                }
                "c" => cur_cell = None,
                _ => {}
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
    // 这一层的归一化仍旧拿常量当尺子（Calibri/等线 与 11 号算"没说话"），本轮不动它：
    // 换成拿文件那一层当尺子会把"与默认同一档"的格子读成空样式，而 Univer 的默认字体是硬编码
    // Arial/11（v0.57 记的侧通道），界面上就会从宋体 14 掉回 11 号——屏幕与纸面得一起搬，见路线图
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

/// styles.xml 的 `<dxfs>` 表：条件格式用 `cfRule/@dxfId` 按下标指过来。
///
/// dxf 与 cellXfs 不是一套东西——它不写 fontId/fillId 索引，粗斜体与颜色直接住在块里，
/// 底纹颜色落在 `bgColor`（cellXfs 的实心填充会被 Excel 反过来写成 fgColor），所以单独扫一趟。
pub(crate) fn parse_dxfs(xml: &str) -> Vec<CondFormatStyle> {
    let mut out = Vec::new();
    let Some(start) = xml.find("<dxfs") else { return out };
    let Some(rel) = xml[start..].find("</dxfs>") else {
        // `<dxfs count="0"/>`：一条也没有，不必往后扫
        return out;
    };
    let body = &xml[start..start + rel];
    let mut cur = CondFormatStyle::default();
    let mut in_font = false;
    let mut in_fill = false;
    let mut reader = Reader::from_str(body);
    while let Ok(ev) = reader.read_event() {
        match &ev {
            Event::Start(e) | Event::Empty(e) => match e.local_name().as_ref() {
                "dxf" => {
                    if matches!(ev, Event::Empty(_)) {
                        out.push(std::mem::take(&mut cur));
                    }
                }
                "font" => in_font = true,
                "fill" => in_fill = true,
                "b" if in_font => cur.bl = Some(bool_attr(e)),
                "i" if in_font => cur.it = Some(bool_attr(e)),
                "strike" if in_font => cur.st = Some(bool_attr(e)),
                "u" if in_font => {
                    cur.ul = Some(attr_str(e, "val").map(|v| v != "none").unwrap_or(true))
                }
                "color" if in_font && cur.cl.is_none() => {
                    cur.cl = attr_str(e, "rgb").as_deref().and_then(argb_to_hex);
                }
                "bgColor" if in_fill => {
                    cur.bg = attr_str(e, "rgb").as_deref().and_then(argb_to_hex)
                }
                "fgColor" if in_fill && cur.bg.is_none() => {
                    cur.bg = attr_str(e, "rgb").as_deref().and_then(argb_to_hex)
                }
                _ => {}
            },
            Event::End(e) => match e.local_name().as_ref() {
                "font" => in_font = false,
                "fill" => in_fill = false,
                "dxf" => out.push(std::mem::take(&mut cur)),
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
    }
    out
}

/// 三类规则的部件在不在文件里。多数表一样都没有，此时不必再跑一遍 XML
fn has_rules(xml: &str) -> bool {
    xml.contains("<autoFilter")
        || xml.contains("<dataValidation")
        || xml.contains("<conditionalFormatting")
}

/// 任何失败都退化为空表（非 xlsx 格式：xls/csv 无样式可读；ods 走 ods.rs 自己的读侧）
/// 回来的第二项是工作簿默认字体（整个文件只有一份，不在 per-sheet 那张表里）
pub fn read_xlsx_styles(path: &str) -> (HashMap<String, SheetFmt>, Option<DefaultFont>) {
    let mut out = HashMap::new();
    let Ok(file) = File::open(path) else { return (out, None) };
    let Ok(mut zip) = zip::ZipArchive::new(file) else { return (out, None) };
    let Some(styles_xml) = read_entry(&mut zip, "xl/styles.xml") else {
        return (out, None);
    };
    let book = parse_styles(&styles_xml);
    let default_font = default_font_of(&book);
    let dxfs = parse_dxfs(&styles_xml);
    for (name, p) in sheet_paths(&mut zip) {
        if let Some(xml) = read_entry(&mut zip, &p) {
            let mut fmt = parse_sheet(&xml, &book);
            if has_rules(&xml) {
                // hidden_rows 先算好再交进去：被筛掉的行与手工藏起来的行在文件里同形
                let rules = crate::xlsx_rules::read_sheet_rules(&xml, &fmt.hidden_rows, &dxfs);
                fmt.rules = rules;
            }
            out.insert(name, fmt);
        }
    }
    (out, default_font)
}

/// 工作簿默认字体 = `cellXfs[0]@fontId` 指到的那一条 font。没有 cellXfs 就没有这一层，不凭空造
fn default_font_of(book: &StyleBook) -> Option<DefaultFont> {
    let font = book.fonts.get(book.xfs.first()?.font as usize)?;
    if font.ff.is_none() && font.fs.is_none() {
        return None;
    }
    Some(DefaultFont {
        ff: font.ff.clone(),
        fs: font.fs,
    })
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

    /// `<sheetFormatPr>` 那一层收的是**磅字面**：17.5 不许在载荷里变成 17.25 或 23px；
    /// 归一化只有"正好 15 且没带 customHeight"这一条（crate 落笔就是 15，省掉它与写进字节同一档）
    #[test]
    fn sheet_format_reads_the_row_height_literal() {
        let read = |attrs: &str| {
            let xml = format!(
                r#"<?xml version="1.0"?><worksheet xmlns="x"><sheetFormatPr {attrs}/><sheetData/></worksheet>"#
            );
            parse_sheet(xml.as_str(), &StyleBook::default()).sheet_format
        };
        assert_eq!(
            read(r#"defaultRowHeight="17.5" x14ac:dyDescent="0.3""#),
            Some(SheetFormat {
                default_row_height: 17.5,
                custom_height: false
            }),
            "Excel 自己重写的那一枚要按字面回来"
        );
        assert_eq!(
            read(r#"defaultRowHeight="30" customHeight="1""#),
            Some(SheetFormat {
                default_row_height: 30.0,
                custom_height: true
            })
        );
        assert_eq!(
            read(r#"defaultRowHeight="15" customHeight="0""#),
            None,
            "写 15 与不写在字节上是同一件事，customHeight=0 也是没声明"
        );
        assert_eq!(read("defaultRowHeight=\"15\""), None, "规范缺省值归一回不声明");
        assert_eq!(
            read(r#"defaultRowHeight="15" customHeight="1""#).map(|f| f.custom_height),
            Some(true),
            "真把缺省行高设成 15 的那一格不许被归一化抹掉"
        );
        assert_eq!(read(""), None, "整枚缺省就是没说话");
        assert_eq!(read(r#"defaultRowHeight="0""#), None, "0 在这一层是没说话");
        assert_eq!(read(r#"defaultRowHeight="-3""#), None, "负数也是");
        assert_eq!(
            read(r#"defaultRowHeight="22.5" baseColWidth="10""#).map(|f| f.default_row_height),
            Some(22.5),
            "旁邻属性不许干扰这一枚的读数"
        );
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

    /// 载荷里"这一格没有样式"有两种来源而分不开：文件里那一格真的不带 `s=`（该继承 Normal），
    /// 和它带了 `s=` 但样式正是常量那一档 Calibri/11（该照自己写）。归一化搬不到文件那一层，
    /// 是因为 Univer 的默认字体硬编码 Arial/11（v0.57 记的侧通道）——屏幕、纸面、这一层得一起搬。
    /// 本轮把这一条**当我说**而不是修掉：写侧从 v0.58 起让不带样式的格继承 Normal，
    /// 于是后一种少见情况从"歪打正着的 Calibri/11"换成"随大流"，量出来记在这里
    #[test]
    fn empty_payload_style_is_ambiguous() {
        let book = parse_styles(
            r#"<?xml version="1.0"?><styleSheet xmlns="x">
              <fonts count="2"><font><sz val="14"/><name val="宋体"/></font><font><sz val="11"/><name val="Calibri"/></font></fonts>
              <cellXfs count="2"><xf fontId="0"/><xf fontId="1"/></cellXfs>
            </styleSheet>"#,
        );
        assert_eq!(
            default_font_of(&book),
            Some(DefaultFont {
                ff: Some("宋体".into()),
                fs: Some(14.0)
            }),
            "文件那一层说的是宋体/14"
        );
        let st = style_for(1, &book);
        assert!(
            st.as_ref().is_none_or(|x| x.ff.is_none() && x.fs.is_none()),
            "明写 Calibri/11 的那一格在载荷里也说不出字族字号：{:?}",
            st
        );
    }

    /// 工作簿默认字体那一层：认的是 `cellXfs[0]@fontId` 指到的那一条，不是"排在 fonts 第一条"。
    /// 判别件是 `fontId="1"` 那一份——只看位置就会读成等线 11，而文件说的明明是宋体 14
    #[test]
    fn workbook_default_font_follows_cell_xfs() {
        let book = |xml: &str| parse_styles(&format!(r#"<?xml version="1.0"?><styleSheet xmlns="x">{xml}</styleSheet>"#, xml = xml));
        let deng = r#"<fonts count="2"><font><sz val="11"/><color theme="1"/><name val="等线"/><family val="2"/><charset val="134"/><scheme val="minor"/></font><font><sz val="14"/><name val="宋体"/></font></fonts>"#;

        let got = default_font_of(&book(&format!(
            r#"{deng}<cellXfs count="2"><xf fontId="0" fillId="0"/><xf fontId="1"/></cellXfs>"#
        )));
        assert_eq!(
            got,
            Some(DefaultFont {
                ff: Some("等线".into()),
                fs: Some(11.0)
            }),
            "中文 Excel 的默认那一条：等线 11（族名照文件原样收，不归一）"
        );

        let got = default_font_of(&book(&format!(
            r#"{deng}<cellXfs count="2"><xf fontId="1" fillId="0"/><xf fontId="0"/></cellXfs>"#
        )));
        assert_eq!(
            got,
            Some(DefaultFont {
                ff: Some("宋体".into()),
                fs: Some(14.0)
            }),
            "默认样式指着第二条 font ⇒ 读的是那一条（按位置读就错）"
        );

        assert_eq!(
            default_font_of(&book(r#"<cellXfs count="1"><xf fontId="0"/></cellXfs>"#)),
            None,
            "没有 fonts 就没有这一层"
        );
        assert_eq!(
            default_font_of(&book(&format!(
                r#"{deng}<cellXfs count="1"><xf fontId="7"/></cellXfs>"#
            ))),
            None,
            "fontId 指到表外 ⇒ 不凭空造一条出来"
        );
        assert_eq!(
            default_font_of(&book(&format!(
                r#"{deng}<cellXfs count="0"/>"#
            ))),
            None,
            "没有 cellXfs（或 count=0）就没有 Normal 这一档，不拿 fonts[0] 顶替"
        );
        assert_eq!(
            default_font_of(&book(
                r#"<fonts count="1"><font><b/></font></fonts><cellXfs count="1"><xf fontId="0"/></cellXfs>"#
            )),
            None,
            "那条 font 既没说族名也没说字号 ⇒ 载荷里不写这一层"
        );
        assert_eq!(
            default_font_of(&book(
                r#"<fonts count="1"><font><sz val="12"/></font></fonts><cellXfs count="1"><xf fontId="0"/></cellXfs>"#
            )),
            Some(DefaultFont {
                ff: None,
                fs: Some(12.0)
            }),
            "只说字号没说族名：字号仍要回来，缺的那半留给用侧兜底"
        );
    }

    #[test]
    fn builtin_numfmt_maps() {
        assert_eq!(builtin_numfmt(9), Some("0%"));
        assert_eq!(builtin_numfmt(3), Some("#,##0"));
        assert_eq!(builtin_numfmt(14), None, "日期 id 不映射");
        assert_eq!(builtin_numfmt(0), None);
    }
}
