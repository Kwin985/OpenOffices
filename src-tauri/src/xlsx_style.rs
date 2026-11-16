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
    /// cellXfs 的 `xfId`：指着 `<cellStyleXfs>` 里同名的基样式（cellStyleXfs 自己没这一层）
    xf_id: u32,
    /// 五组 apply* 旗。三态：`None`=属性缺省，`Some(false)`=显式 ="0"/"false" 抑制，
    /// `Some(true)`=显式 ="1"/"true"。cellXfs 里缺省值是 **false**（[MS-OE376] Part 4 §3.8.45），
    /// cellStyleXfs 里缺省值是 **true**——两处相反，合并时分别对待
    apply_font: Option<bool>,
    apply_fill: Option<bool>,
    apply_border: Option<bool>,
    apply_numfmt: Option<bool>,
    apply_alignment: Option<bool>,
}

#[derive(Default)]
struct StyleBook {
    fonts: Vec<FontInfo>,
    fills: Vec<Option<String>>,
    xfs: Vec<XfRec>,
    borders: Vec<BorderRec>,
    numfmts: HashMap<u32, String>,
    /// `<cellStyleXfs>`：命名样式的基样式层（Normal 在第 0 条）。文件没这一段就是空表
    cell_style_xfs: Vec<XfRec>,
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

/// 内建数字格式 id → 模式串。
///
/// 收进来的判据只有一条：**这一格的格式在屏上真的活着**——calamine 得把值当数字交回来，
/// 屏上（Univer 的 `n.pattern`）与纸面（`formatNumberValue`）才吃得进这个模式。实证见
/// `builtin_numfmt_liveness_is_measured_not_assumed`：calamine 对日期/时间格式的单元格
/// 一律交回 `Data::DateTime`（值在 `data_to_value` 里已经字符串化），日期类 id 因此不映射；
/// 分数（12/13）、科学计数（48）与带括号/红色的数值档（37/38）交回 Float，模式是活的。
///
/// 5-8 与 41-44（货币）、14-22（日期）、23-36（会计/日期/分数变体）、45-47（时间）都不收：
/// 前两类嵌 locale 相关符号，后几类值已被 calamine 字符串化。逐 id 的规范串见 ECMA-376 §18.8.30
fn builtin_numfmt(id: u32) -> Option<&'static str> {
    Some(match id {
        1 => "0",
        2 => "0.00",
        3 => "#,##0",
        4 => "#,##0.00",
        9 => "0%",
        10 => "0.00%",
        11 => "0.00E+00",
        12 => "# ?/?",
        13 => "# ??/??",
        37 => "#,##0 ;(#,##0)",
        38 => "#,##0 ;[Red](#,##0)",
        39 => "0.00",
        40 => "#,##0.00",
        48 => "##0.0E+0",
        49 => "@",
        _ => return None,
    })
}

/// apply* 一族的三态读数：缺属性 `None`，"0"/"false" `Some(false)`，其余真值 `Some(true)`。
/// （与 `bool_attr` 不同：那一支把缺属性当 true，是给 `<b/>` 这种"没写 val 就是真"的元素用的）
fn bool_attr_opt(e: &quick_xml::events::BytesStart<'_>, key: &str) -> Option<bool> {
    attr_str(e, key).map(|v| v != "0" && v != "false")
}

fn xf_from_attrs(e: &quick_xml::events::BytesStart<'_>) -> XfRec {
    XfRec {
        font: attr_str(e, "fontId").and_then(|v| v.parse().ok()).unwrap_or(0),
        fill: attr_str(e, "fillId").and_then(|v| v.parse().ok()).unwrap_or(0),
        border: attr_str(e, "borderId").and_then(|v| v.parse().ok()).unwrap_or(0),
        numfmt: attr_str(e, "numFmtId").and_then(|v| v.parse().ok()).unwrap_or(0),
        xf_id: attr_str(e, "xfId").and_then(|v| v.parse().ok()).unwrap_or(0),
        apply_font: bool_attr_opt(e, "applyFont"),
        apply_fill: bool_attr_opt(e, "applyFill"),
        apply_border: bool_attr_opt(e, "applyBorder"),
        apply_numfmt: bool_attr_opt(e, "applyNumberFormat"),
        apply_alignment: bool_attr_opt(e, "applyAlignment"),
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
    let mut cur_style_xf: Option<XfRec> = None;
    let mut sec = String::new(); // fonts | fills | borders | cellStyleXfs | cellXfs | numFmts
    let mut reader = Reader::from_str(xml);
    while let Ok(ev) = reader.read_event() {
        match &ev {
            Event::Start(e) => {
                let nm = e.local_name();
                let nm = nm.as_ref();
                match nm {
                    "fonts" | "fills" | "borders" | "cellStyleXfs" | "cellXfs" | "numFmts" => {
                        sec = nm.to_string()
                    }
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
                    "xf" if sec == "cellStyleXfs" => cur_style_xf = Some(xf_from_attrs(e)),
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
                    ("cellStyleXfs", "xf") => book.cell_style_xfs.push(xf_from_attrs(e)),
                    ("cellXfs", "alignment") => {
                        if let Some(rec) = &mut cur_xf {
                            apply_alignment(rec, e);
                        }
                    }
                    ("cellStyleXfs", "alignment") => {
                        if let Some(rec) = &mut cur_style_xf {
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
                    "xf" if sec == "cellStyleXfs" => {
                        if let Some(rec) = cur_style_xf.take() {
                            book.cell_style_xfs.push(rec);
                        }
                    }
                    "fonts" | "fills" | "borders" | "cellStyleXfs" | "cellXfs" | "numFmts" => {
                        sec.clear()
                    }
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

/// 四组索引槽（font/fill/border/numfmt）的合并。自槽 0 = 常规缺省那一档
/// （fonts[0] 按惯例就是默认字体、fill 0 = 无填充、border 0 = 无边框、numFmtId 0 = General），
/// 生产方（Excel / LibreOffice / rust_xlsxwriter）都把默认字体登记在 fonts[0]
fn merge_slot(own: u32, base: u32, apply: Option<bool>) -> u32 {
    match apply {
        Some(true) => own,
        Some(false) => base,
        // 缺省这一支的口径：[MS-OE376] Part 4 §3.8.45——cellXfs 里 apply* 缺省值是 false，
        // "这一组与基样式连着"；同节的和规条补上可判定的边界——自槽与父样式不同时应写 true，
        // 于是缺省且自槽正是常规缺省值时，取基样式那一组才是 Excel 的行为
        // （MS 支持对 MS-OI29500"只有 cellXfs 定义格式"的补充答复同此：
        // cellXfs 会为"没有自己设置的项"去取 cellStyleXfs 的值）
        None => {
            if own == 0 {
                base
            } else {
                own
            }
        }
    }
}

/// 对齐组的合并。与索引槽不同的判据是"自槽有没有设"：alignment 子元素整枚缺席
/// （ho/vo 全空且不折行）算没设——`<alignment wrapText="0"/>` 这种显式写假的也按没设算，
/// 生产方只在真折行时写 wrapText
fn merge_alignment(rec: &XfRec, base: &XfRec) -> (Option<String>, Option<String>, bool) {
    let own_set = rec.ho.is_some() || rec.vo.is_some() || rec.wrap;
    let apply = rec.apply_alignment;
    match apply {
        Some(true) => (rec.ho.clone(), rec.vo.clone(), rec.wrap),
        Some(false) => (base.ho.clone(), base.vo.clone(), base.wrap),
        None => {
            if own_set {
                (rec.ho.clone(), rec.vo.clone(), rec.wrap)
            } else {
                (base.ho.clone(), base.vo.clone(), base.wrap)
            }
        }
    }
}

/// 把 cellXfs 的一条 xf 与它 `xfId` 指的 cellStyleXfs 基样式按 apply* 语义合成一条有效 xf。
///
/// 两层模型（ECMA-376 §18.8.9/§18.8.10 + [MS-OE376] Part 4 §3.8.45）：
/// - 基样式自己的 apply* 缺省值是 **true**；显式 false 表示命名样式自己不应用那一组，
///   按常规缺省处理（`<cellStyleXfs><xf fontId="5" applyFont="0"/>` 这类怪件）
/// - `xfId` 指到表外（或整段 cellStyleXfs 缺席）⇒ 基样式按空 XfRec 的常规缺省算，
///   自槽该用的值照用——和规文件里 apply* 永远与"自槽是否缺省"一致，两支结论相同，
///   分歧只出现在不和规的件上，那时按"写了什么算什么"处理
fn merged_xf(rec: &XfRec, book: &StyleBook) -> XfRec {
    let base = book
        .cell_style_xfs
        .get(rec.xf_id as usize)
        .cloned()
        .unwrap_or_default();
    let base_font = if base.apply_font == Some(false) { 0 } else { base.font };
    let base_fill = if base.apply_fill == Some(false) { 0 } else { base.fill };
    let base_border = if base.apply_border == Some(false) {
        0
    } else {
        base.border
    };
    let base_numfmt = if base.apply_numfmt == Some(false) {
        0
    } else {
        base.numfmt
    };
    let (ho, vo, wrap) = if base.apply_alignment == Some(false) {
        (None, None, false)
    } else {
        merge_alignment(rec, &base)
    };
    XfRec {
        font: merge_slot(rec.font, base_font, rec.apply_font),
        fill: merge_slot(rec.fill, base_fill, rec.apply_fill),
        border: merge_slot(rec.border, base_border, rec.apply_border),
        numfmt: merge_slot(rec.numfmt, base_numfmt, rec.apply_numfmt),
        ho,
        vo,
        wrap,
        ..Default::default()
    }
}

fn style_for(xf: usize, book: &StyleBook) -> Option<CellStyle> {
    let rec = merged_xf(book.xfs.get(xf)?, book);
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
///
/// `numfmts` 是 styles.xml 顶层的 `<numFmts>`（id≥164 的自定义串）。dxf 的 `<numFmt>` 通常
/// 把串直接内联在块里（dxf 是差分格式，不共享 numFmts 表），但只给 `numFmtId` 的件也见得到：
/// 那时先按 id 查自定义表、再查内置表，两处都没有就留空——不猜。
///
/// 边框与对齐两族也在这里收（v0.139）：`<border>` 四边与 `<alignment>` 三槽都按单元格侧
/// 同一套形状搬进 `CellBorder`/ho/vo/wb。它们屏上不活（Univer 的 CF 高亮没有这两族的槽），
/// 收着只为存盘往返——边框一族写侧写得出去，对齐一族写侧写不出（见 `xlsx_rules.rs` 的账）。
pub(crate) fn parse_dxfs(xml: &str, numfmts: &HashMap<u32, String>) -> Vec<CondFormatStyle> {
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
    let mut in_border = false;
    // 边框的一条边：开标签里只有 style，颜色住在子元素 `<color rgb>` 里（与 cellXfs 的
    // `<borders>` 同形），所以要等边关标签才拼得出完整的一条
    let mut cur_side: Option<(String, BorderSide)> = None;
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
                // 空 `<border/>` 不开标志：没有 End 事件来关它，开了会漏进下一条 dxf
                "border" if matches!(ev, Event::Start(_)) => in_border = true,
                "numFmt" => {
                    let id = attr_str(e, "numFmtId").and_then(|v| v.parse::<u32>().ok());
                    cur.nf = attr_str(e, "formatCode").or_else(|| {
                        id.and_then(|i| numfmts.get(&i).cloned())
                            .or_else(|| id.and_then(builtin_numfmt).map(String::from))
                    });
                }
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
                "left" | "right" | "top" | "bottom" if in_border => {
                    let side = BorderSide {
                        s: attr_str(e, "style"),
                        c: None,
                    };
                    let key = e.local_name().as_ref().to_string();
                    if matches!(ev, Event::Empty(_)) {
                        // 自闭合边：`<right/>` 这种"没边说辞"不进载荷——rust_xlsxwriter 的
                        // 亲笔每回都把没配的边写成空标签，收进来只会让四条边全 Some(空)
                        if !side.is_empty() {
                            set_dxf_side(cur.bd.get_or_insert_with(CellBorder::default), &key, side);
                        }
                    } else {
                        cur_side = Some((key, side));
                    }
                }
                // 边里的颜色子元素：只认 rgb（theme/indexed 那一族与单元格边框同规，不收）
                "color" if in_border => {
                    if let Some((_, side)) = &mut cur_side {
                        side.c = attr_str(e, "rgb").as_deref().and_then(argb_to_hex);
                    }
                }
                // 对齐三槽：水平/垂直按单元格侧同一张白名单收，换行是三态（见 CondFormatStyle.wb）
                "alignment" => {
                    cur.ho = attr_str(e, "horizontal").and_then(|h| match h.as_str() {
                        "left" | "center" | "right" | "justify" => Some(h),
                        _ => None,
                    });
                    cur.vo = attr_str(e, "vertical").and_then(|v| match v.as_str() {
                        "top" => Some("top".to_string()),
                        "center" => Some("middle".to_string()),
                        "bottom" => Some("bottom".to_string()),
                        _ => None,
                    });
                    cur.wb = match attr_str(e, "wrapText").as_deref() {
                        Some("1") | Some("true") => Some(true),
                        Some("0") | Some("false") => Some(false),
                        _ => None,
                    };
                }
                _ => {}
            },
            Event::End(e) => match e.local_name().as_ref() {
                "font" => in_font = false,
                "fill" => in_fill = false,
                "left" | "right" | "top" | "bottom" if in_border => {
                    if let Some((key, side)) = cur_side.take() {
                        if !side.is_empty() {
                            set_dxf_side(cur.bd.get_or_insert_with(CellBorder::default), &key, side);
                        }
                    }
                }
                "border" => {
                    // 关边框时还有没落下的边（缺了 End 的残件）：补一手，别让半条边蒸发
                    if let Some((key, side)) = cur_side.take() {
                        if !side.is_empty() {
                            set_dxf_side(cur.bd.get_or_insert_with(CellBorder::default), &key, side);
                        }
                    }
                    in_border = false;
                }
                "dxf" => out.push(std::mem::take(&mut cur)),
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
    }
    out
}

/// dxf 边框的一条边落进 `CellBorder`（与 cellXfs 侧的 `set_border_side` 同形，只是目标是载荷结构）
fn set_dxf_side(bd: &mut CellBorder, key: &str, side: BorderSide) {
    match key {
        "left" => bd.l = Some(side),
        "right" => bd.r = Some(side),
        "top" => bd.t = Some(side),
        "bottom" => bd.b = Some(side),
        _ => {}
    }
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
    let dxfs = parse_dxfs(&styles_xml, &book.numfmts);
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

/// 工作簿默认字体 = `cellXfs[0]` 与它 `xfId` 指的 cellStyleXfs 基样式合成后的有效字体。
/// 没有 cellXfs 就没有这一层，不凭空造
///
/// 走合成链而不是直接取 `xfs[0].font`：Normal 样式在文件里可以只由 cellStyleXfs[0] 承载
/// （`<xf xfId="0" fontId="0" .../>` 不带 applyFont，自槽是常规缺省），
/// 直接读自槽会读成 fonts[0] 而把真正的默认字体（如宋体 14）丢掉
fn default_font_of(book: &StyleBook) -> Option<DefaultFont> {
    let rec = merged_xf(book.xfs.first()?, book);
    let font = book.fonts.get(rec.font as usize)?;
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

    /// 工作簿默认字体那一层：认的是 `cellXfs[0]` 合成后的有效字体，不是"排在 fonts 第一条"。
    /// 判别件是 `fontId="1"` 那一份——只看位置就会读成等线 11，而文件说的明明是宋体 14。
    /// 合成链的第三条判别件：Normal 只由 cellStyleXfs[0] 承载、cellXfs[0] 自槽全缺省时，
    /// 有效字体要跟到基样式去（直接读自槽会把真正的默认字体读丢）
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

        // 新支：cellXfs[0] 自槽全缺省（fontId=0，不带 applyFont），Normal 的字体只写在
        // cellStyleXfs[0] 里——有效字体要跟到基样式，读成 fonts[0]（等线 11）就错了
        let got = default_font_of(&book(&format!(
            r#"{deng}<cellStyleXfs count="1"><xf fontId="1" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>"#
        )));
        assert_eq!(
            got,
            Some(DefaultFont {
                ff: Some("宋体".into()),
                fs: Some(14.0)
            }),
            "Normal 只由 cellStyleXfs 承载时，默认字体跟到基样式"
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
        // 本轮补收的：分数、带括号/红字的数值档、科学计数——判据是"屏上活着"（下一条测试量出来）
        assert_eq!(builtin_numfmt(12), Some("# ?/?"));
        assert_eq!(builtin_numfmt(13), Some("# ??/??"));
        assert_eq!(builtin_numfmt(37), Some("#,##0 ;(#,##0)"));
        assert_eq!(builtin_numfmt(38), Some("#,##0 ;[Red](#,##0)"));
        assert_eq!(builtin_numfmt(48), Some("##0.0E+0"));
        // 不映射的与理由：
        assert_eq!(builtin_numfmt(5), None, "货币类嵌 locale 符号");
        assert_eq!(builtin_numfmt(41), None, "会计类同");
        assert_eq!(builtin_numfmt(45), None, "时间类：值已被 calamine 字符串化");
        assert_eq!(builtin_numfmt(47), None, "时间类：同上");
        assert_eq!(builtin_numfmt(23), None, "会计变体，locale 相关");
    }

    /// builtin_numfmt 的收录判据不是猜的，是量的：calamine 把日期/时间格式的单元格交回
    /// `Data::DateTime`（值在 `data_to_value` 里字符串化 ⇒ 模式在屏上不活 ⇒ 不收），
    /// 分数与科学计数交回 Float（模式活着 ⇒ 收）。calamine 换大版本若改了这口径，
    /// 这条测试会红——那时该做的是回来重判收录表，不是把断言改成新的现状
    #[test]
    fn builtin_numfmt_liveness_is_measured_not_assumed() {
        use calamine::{Data, Reader as _};
        // (内建 id, 模式串, 样本值)——id 就是收录表要判的那个
        let cases: [(u32, &str, f64); 6] = [
            (45, "mm:ss", 0.52),       // 时间
            (46, "[h]:mm:ss", 0.52),   // 时间
            (47, "mmss.0", 0.52),      // 时间
            (12, "# ?/?", 1.25),       // 分数
            (48, "##0.0E+0", 12345.0), // 科学计数
            (14, "mm-dd-yy", 45000.0), // 日期对照
        ];
        let mut path = std::env::temp_dir();
        path.push("oo_probe_numfmt.xlsx");
        {
            let mut book = rust_xlsxwriter::Workbook::new();
            let sheet = book.add_worksheet();
            for (i, (_, code, v)) in cases.iter().enumerate() {
                let fmt = rust_xlsxwriter::Format::new().set_num_format(*code);
                sheet.write_number_with_format(i as u32, 0, *v, &fmt).unwrap();
            }
            book.save(path.to_str().unwrap()).unwrap();
        }
        let mut wb = calamine::open_workbook_auto(path.to_str().unwrap()).expect("calamine 打开失败");
        let range = wb.worksheet_range_at(0).unwrap().unwrap();
        for (i, (id, code, _)) in cases.iter().enumerate() {
            let cell = range.get_value((i as u32, 0u32)).unwrap();
            let is_num = matches!(cell, Data::Float(_) | Data::Int(_));
            let mapped = builtin_numfmt(*id).is_some();
            assert_eq!(
                is_num,
                mapped,
                "numFmtId {id}（{code}）：calamine 交回 {cell:?}，收录表须与之一致"
            );
        }
    }

    /// cellStyleXfs 两层链的合并语义（[MS-OE376] Part 4 §3.8.45 + 和规条）：
    /// 显式 ="0" 抑制自槽回落基样式；缺省且自槽是常规缺省值时也回落基样式；
    /// 自槽有值就照自槽。三支各自的判别件都在这里
    #[test]
    fn named_style_chain_merges() {
        let book = parse_styles(
            r#"<?xml version="1.0"?><styleSheet xmlns="x">
              <fonts count="3"><font><sz val="11"/><name val="Calibri"/></font>
              <font><sz val="14"/><name val="宋体"/></font>
              <font><b/><sz val="12"/><name val="Arial"/></font></fonts>
              <fills count="2"><fill><patternFill patternType="none"/></fill>
              <fill><patternFill patternType="solid"><fgColor rgb="FF00FF00"/></patternFill></fill></fills>
              <numFmts count="1"><numFmt numFmtId="164" formatCode="0.0_"/></numFmts>
              <cellStyleXfs count="1"><xf numFmtId="164" fontId="1" fillId="0" borderId="0"/></cellStyleXfs>
              <cellXfs count="5">
                <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
                <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
                <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="0"/>
                <xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
                <xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="0"/>
              </cellXfs>
            </styleSheet>"#,
        );
        assert_eq!(book.cell_style_xfs.len(), 1, "cellStyleXfs 段要收进来");
        // ① 全缺省槽 + 无 apply*：numfmt 回落基样式的 164，font 回落基样式的宋体
        let st = style_for(0, &book).expect("xf0");
        assert_eq!(st.nf.as_deref(), Some("0.0_"), "缺省槽跟基样式走（MS-OE376 的缺省 false）");
        assert_eq!(st.ff.as_deref(), Some("宋体"), "font 自槽 0 是常规缺省，回落基样式");
        assert_eq!(st.fs, Some(14.0));
        // ② applyFont="1"：断开链接，用自己那一条（粗体 Arial 12）
        let st = style_for(1, &book).expect("xf1");
        assert_eq!(st.ff.as_deref(), Some("Arial"));
        assert!(st.bl);
        assert_eq!(st.nf.as_deref(), Some("0.0_"), "没说话的那组照旧回落基样式");
        // ③ applyFont="0"：显式抑制，同样回落基样式的宋体（与 ① 殊途同归，路径不同）
        let st = style_for(2, &book).expect("xf2");
        assert_eq!(st.ff.as_deref(), Some("宋体"), "显式 false 也回落基样式");
        // ④ applyNumberFormat="1"：自槽 9（0%）压过基样式的 164
        let st = style_for(3, &book).expect("xf3");
        assert_eq!(st.nf.as_deref(), Some("0%"));
        // ⑤ applyNumberFormat="0"：显式抑制 ⇒ 用基样式的 164（反例：不抑制就会是 0%）
        let st = style_for(4, &book).expect("xf4");
        assert_eq!(st.nf.as_deref(), Some("0.0_"), "显式 0 抑制自槽，回落基样式");
    }

    /// 对齐组跟索引槽不同：判据是"alignment 子元素整枚缺席"而不是某个槽为 0
    #[test]
    fn named_style_alignment_chain() {
        let book = parse_styles(
            r#"<?xml version="1.0"?><styleSheet xmlns="x">
              <fonts count="1"><font><sz val="11"/></font></fonts>
              <cellStyleXfs count="1"><xf fontId="0" fillId="0" borderId="0"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellStyleXfs>
              <cellXfs count="3">
                <xf fontId="0" fillId="0" borderId="0" xfId="0"/>
                <xf fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="right"/></xf>
                <xf fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="0"/>
              </cellXfs>
            </styleSheet>"#,
        );
        // ① 没有 alignment 子元素 ⇒ 整组回落基样式：居中 + 折行都跟来
        let st = style_for(0, &book).expect("xf0");
        assert_eq!(st.ho.as_deref(), Some("center"));
        assert_eq!(st.vo.as_deref(), Some("middle"));
        assert!(st.wb, "折行也随基样式");
        // ② applyAlignment="1"：只用自槽——右对齐，基样式的居中与折行都不跟来
        let st = style_for(1, &book).expect("xf1");
        assert_eq!(st.ho.as_deref(), Some("right"));
        assert_eq!(st.vo, None, "自槽没写 vertical，基样式的不跟来");
        assert!(!st.wb, "折行同");
        // ③ applyAlignment="0"：显式抑制 ⇒ 回落基样式（与 ① 殊途同归）
        let st = style_for(2, &book).expect("xf2");
        assert_eq!(st.ho.as_deref(), Some("center"));
        assert!(st.wb);
    }

    /// 没有 cellStyleXfs 段的件（本应用自己的写件、以及一大批第三方件）：
    /// 基样式是空表，自槽该用的值照用——两层链不改变今天的读数
    #[test]
    fn no_cell_style_xfs_keeps_own_values() {
        let book = parse_styles(
            r#"<?xml version="1.0"?><styleSheet xmlns="x">
              <fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>
              <font><b/><sz val="14"/><color rgb="FFFF0000"/></font></fonts>
              <cellXfs count="2"><xf fontId="0" fillId="0" borderId="0" numFmtId="0"/>
              <xf fontId="1" fillId="0" borderId="0" numFmtId="9"/></cellXfs>
            </styleSheet>"#,
        );
        assert!(book.cell_style_xfs.is_empty());
        let st = style_for(1, &book).expect("xf1");
        assert_eq!(st.nf.as_deref(), Some("0%"));
        assert_eq!(st.fs, Some(14.0));
        assert_eq!(st.cl.as_deref(), Some("#ff0000"));
    }

    /// xfId 指到 cellStyleXfs 表外：基样式按空 XfRec 算，自槽照用，不许慌
    #[test]
    fn xf_id_out_of_range_falls_back_to_own() {
        let book = parse_styles(
            r#"<?xml version="1.0"?><styleSheet xmlns="x">
              <fonts count="2"><font><sz val="11"/></font><font><b/><sz val="16"/></font></fonts>
              <cellStyleXfs count="1"><xf fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
              <cellXfs count="1"><xf fontId="1" fillId="0" borderId="0" xfId="7"/></cellXfs>
            </styleSheet>"#,
        );
        let st = style_for(0, &book).expect("xf0");
        assert_eq!(st.fs, Some(16.0));
        assert!(st.bl);
    }

    /// dxf 的 `<numFmt>`：三种形状各归各位——内联串、按 id 查内置表、按 id 查自定义表
    #[test]
    fn dxf_numfmt_reads_inline_and_both_tables() {
        let xml = r#"<styleSheet xmlns="x"><numFmts count="1">
              <numFmt numFmtId="164" formatCode="0.0_);[Red](0.0\ )"/></numFmts>
            <dxfs count="3">
              <dxf><numFmt numFmtId="165" formatCode="0.0%"/></dxf>
              <dxf><numFmt numFmtId="10"/></dxf>
              <dxf><numFmt numFmtId="164"/></dxf>
            </dxfs></styleSheet>"#;
        let mut numfmts = HashMap::new();
        numfmts.insert(164, "0.0_);[Red](0.0 )".to_string());
        let dxfs = parse_dxfs(xml, &numfmts);
        assert_eq!(dxfs.len(), 3);
        assert_eq!(dxfs[0].nf.as_deref(), Some("0.0%"), "内联 formatCode 直接用");
        assert_eq!(dxfs[1].nf.as_deref(), Some("0.00%"), "只给 id 的按内置表 10 展开");
        assert_eq!(
            dxfs[2].nf.as_deref(),
            Some("0.0_);[Red](0.0 )"),
            "自定义 id 回 styles.xml 顶层的 numFmts 查（dxf 自己不内联时）"
        );
    }

    /// 查不到的 id 留空而不是瞎猜：dxf 里 numFmtId=200 而两处表都没有，就当没配格式
    #[test]
    fn dxf_numfmt_unknown_id_stays_empty() {
        let xml = r#"<styleSheet xmlns="x"><dxfs count="2">
              <dxf><numFmt numFmtId="200"/></dxf>
              <dxf><font><b/></font></dxf>
            </dxfs></styleSheet>"#;
        let dxfs = parse_dxfs(xml, &HashMap::new());
        assert_eq!(dxfs.len(), 2);
        assert!(dxfs[0].nf.is_none(), "两处表都没有 ⇒ 不猜");
        assert!(dxfs[1].nf.is_none(), "没写 numFmt 就没有");
        assert_eq!(dxfs[1].bl, Some(true), "别的字段不受影响");
    }

    /// dxf 的 `<border>`：四边样式 + 颜色子元素，自闭合的"没边"不占位。
    /// 形状照 rust_xlsxwriter 的亲笔（探针实录）：`<left style="thin"><color rgb="FF112233"/></left>`
    /// 与 `<right/>` 混在同一株里
    #[test]
    fn dxf_border_reads_sides_and_colors() {
        let xml = r#"<styleSheet xmlns="x"><dxfs count="2">
              <dxf><border><left style="thin"><color rgb="FF112233"/></left><right/>
                <top/><bottom style="dashed"><color rgb="FF00FF00"/></bottom>
                <vertical/><horizontal/></border></dxf>
              <dxf><border><left/></border></dxf>
            </dxfs></styleSheet>"#;
        let dxfs = parse_dxfs(xml, &HashMap::new());
        assert_eq!(dxfs.len(), 2);
        let bd = dxfs[0].bd.as_ref().expect("第一条有边框");
        let l = bd.l.as_ref().expect("左边");
        assert_eq!(l.s.as_deref(), Some("thin"));
        assert_eq!(l.c.as_deref(), Some("#112233"), "rgb 八位去头成 #rrggbb");
        let b = bd.b.as_ref().expect("下边");
        assert_eq!(b.s.as_deref(), Some("dashed"));
        assert_eq!(b.c.as_deref(), Some("#00ff00"));
        assert!(bd.r.is_none(), "自闭合的没边说辞不进载荷");
        assert!(bd.t.is_none());
        // 整株边框只有空边（`<left/>`）：连 bd 都不该有——判空那侧靠它把
        // "只当判定用"的规则认出来（rust_xlsxwriter 对没配边的 dxf 就写成这样）
        assert!(dxfs[1].bd.is_none(), "四条边全空 ⇒ 视同没有边框");
    }

    /// 边框标志不泄漏：空 `<border/>` 没有 End 事件，若开了标志不关会漏进下一条 dxf
    #[test]
    fn dxf_border_flag_does_not_leak() {
        let xml = r#"<styleSheet xmlns="x"><dxfs count="2">
              <dxf><border/></dxf>
              <dxf><font><b/></font></dxf>
            </dxfs></styleSheet>"#;
        let dxfs = parse_dxfs(xml, &HashMap::new());
        assert_eq!(dxfs.len(), 2);
        assert!(dxfs[0].bd.is_none(), "空 border 不开标志也不落边");
        assert_eq!(dxfs[1].bl, Some(true));
        assert!(dxfs[1].bd.is_none(), "标志没漏到第二条：第二条的 font 不受边框态污染");
    }

    /// dxf 的 `<alignment>`：水平/垂直按单元格侧同一张白名单，center→middle；
    /// 换行三态——"1"/"true" 真、"0"/"false" 假、缺省不说话
    #[test]
    fn dxf_alignment_reads_three_states() {
        let xml = r#"<styleSheet xmlns="x"><dxfs count="3">
              <dxf><alignment horizontal="center" vertical="center" wrapText="1"/></dxf>
              <dxf><alignment horizontal="right" wrapText="0"/></dxf>
              <dxf><alignment horizontal="distributed"/></dxf>
            </dxfs></styleSheet>"#;
        let dxfs = parse_dxfs(xml, &HashMap::new());
        assert_eq!(dxfs.len(), 3);
        assert_eq!(dxfs[0].ho.as_deref(), Some("center"));
        assert_eq!(dxfs[0].vo.as_deref(), Some("middle"), "OOXML 的 center 换算成 middle");
        assert_eq!(dxfs[0].wb, Some(true));
        assert_eq!(dxfs[1].ho.as_deref(), Some("right"));
        assert_eq!(dxfs[1].wb, Some(false), "显式 0 是第三态，不是缺省");
        assert!(dxfs[1].vo.is_none());
        assert!(dxfs[2].ho.is_none(), "白名单外的水平值不收（与单元格侧同规）");
        assert!(dxfs[2].wb.is_none(), "没写 wrapText 就是缺省");
    }
}
