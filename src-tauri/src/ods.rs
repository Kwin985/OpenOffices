//! ODS（OpenDocument 电子表格）写出：SheetPayload → zip + 手写 ODF XML。
//! 复用 xlsx 的载荷结构；值/样式（粗斜/字号/字色/底色）/合并区全进 content.xml。
//! 范围：图表与数字格式暂不写入 ODS（xlsx 专属通道）。

use std::collections::HashMap;
use std::io::{Cursor, Write};
use std::path::Path;

use quick_xml::escape::escape;
use quick_xml::events::Event;
use quick_xml::Reader;
use serde_json::Value;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::xlsx::{
    BorderSide, CellBorder, CellLinkPayload, CellNotePayload, CellPayload, CellStyle, DefaultFont,
    Error, MergeRange, SheetPayload, WorkbookPayload,
};
use crate::xlsx_cell_side;
use crate::xlsx_style::{a1_to_rc, attr_str, read_entry, SheetFmt};

fn esc(s: &str) -> String {
    escape(s).to_string()
}

/// quick_xml 的 escape 不动引号；属性里的 " 会截断 XML，必须再转一道
fn esc_attr(s: &str) -> String {
    esc(s).replace('"', "&quot;")
}

/// 边框样式名 → ODF fo:border-* 值的线宽/线型近似（读侧按同表反推）
fn odf_border_line(side: &BorderSide) -> Option<String> {
    let (width, kind) = match side.s.as_deref()? {
        "hair" => ("0.1pt", "solid"),
        "thin" => ("0.5pt", "solid"),
        "medium" => ("1.5pt", "solid"),
        "thick" => ("2.5pt", "solid"),
        "dashed" | "mediumDashed" => ("0.5pt", "dashed"),
        "dotted" => ("0.5pt", "dotted"),
        "double" => ("0.5pt", "double"),
        _ => ("0.5pt", "solid"),
    };
    let color = side.c.clone().unwrap_or_else(|| "#000000".into());
    Some(format!("{width} {kind} {color}"))
}

fn io_err(e: std::io::Error) -> Error {
    Error(format!("ODS 写入失败: {e}"))
}

fn zip_err(e: zip::result::ZipError) -> Error {
    Error(format!("ODS 打包失败: {e}"))
}

/// 样式去重键：nf（数字格式）ODS 通道暂不支持，不入键
fn style_key_of(st: &CellStyle) -> String {
    let bd = st
        .bd
        .as_ref()
        .map(|b| {
            let side = |x: &Option<BorderSide>| match x {
                Some(s) => format!("{}:{}", s.s.clone().unwrap_or_default(), s.c.clone().unwrap_or_default()),
                None => String::new(),
            };
            format!("{};{};{};{}", side(&b.t), side(&b.r), side(&b.b), side(&b.l))
        })
        .unwrap_or_default();
    format!(
        "{}|{}|{}|{}|{}|{}|{}|{}|{}|{}",
        st.bl,
        st.it,
        st.fs.map(|f| f.to_string()).unwrap_or_default(),
        st.ff.clone().unwrap_or_default(),
        st.cl.clone().unwrap_or_default(),
        st.bg.clone().unwrap_or_default(),
        bd,
        st.ho.clone().unwrap_or_default(),
        st.vo.clone().unwrap_or_default(),
        st.wb,
    )
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
            let key = style_key_of(st);
            if names.contains_key(&key) {
                continue;
            }
            let name = format!("ce{}", names.len() + 1);
            let mut body = String::new();
            let mut tcp = String::new();
            if let Some(bg) = &st.bg {
                tcp.push_str(&format!(" fo:background-color=\"{}\"", esc(bg)));
            }
            if let Some(bd) = &st.bd {
                for (attr, side) in [
                    ("fo:border-left", &bd.l),
                    ("fo:border-right", &bd.r),
                    ("fo:border-top", &bd.t),
                    ("fo:border-bottom", &bd.b),
                ] {
                    if let Some(v) = side.as_ref().and_then(odf_border_line) {
                        tcp.push_str(&format!(" {attr}=\"{}\"", esc(&v)));
                    }
                }
            }
            if let Some(ho) = &st.ho {
                tcp.push_str(&format!(" style:align=\"{}\"", esc(ho)));
            }
            if let Some(vo) = &st.vo {
                tcp.push_str(&format!(" style:vertical-align=\"{}\"", esc(vo)));
            }
            if st.wb {
                tcp.push_str(" style:cell-wrapping=\"wrap\"");
            }
            if !tcp.is_empty() {
                body.push_str(&format!("<style:table-cell-properties{tcp}/>"));
            }
            let mut tp = String::new();
            if st.bl {
                tp.push_str(" fo:font-weight=\"bold\"");
            }
            if st.it {
                tp.push_str(" fo:font-style=\"italic\"");
            }
            if let Some(ff) = &st.ff {
                tp.push_str(&format!(
                    " style:font-name=\"{}\" fo:font-family=\"{}\"",
                    esc(ff),
                    esc(ff)
                ));
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
    Some(style_key_of(st))
}

/// 像素 → ODF 长度（cm，4 位小数；读侧按同式换回并取整）
fn px_to_odf_len(px: f64) -> String {
    format!("{:.4}cm", px * 2.54 / 96.0)
}

/// (宽度像素, 是否隐藏) → 维度样式注册键；无宽度且不隐藏返回 None（用默认样式）
fn dim_key(px: Option<f64>, hidden: bool) -> Option<String> {
    match (px, hidden) {
        (Some(p), false) => Some(format!("{p}|0")),
        (Some(p), true) => Some(format!("{p}|1")),
        (None, true) => Some("h|1".into()),
        (None, false) => None,
    }
}

/// 自定义列宽/行高与隐藏行列注册为 table-column/table-row 自动样式。
/// 返回 (样式 XML, 注册键 → 样式名)；键去重排序保证输出确定性。
fn build_dim_styles(
    sheets: &[SheetPayload],
) -> (String, HashMap<String, String>, HashMap<String, String>) {
    let mut col_keys: Vec<String> = Vec::new();
    let mut row_keys: Vec<String> = Vec::new();
    for s in sheets {
        let hid_c: std::collections::HashSet<u32> = s.hidden_cols.iter().copied().collect();
        let hid_r: std::collections::HashSet<u32> = s.hidden_rows.iter().copied().collect();
        for (c, px) in &s.col_widths {
            if let Some(k) = dim_key(Some(*px), hid_c.contains(c)) {
                col_keys.push(k);
            }
        }
        if hid_c.iter().any(|c| !s.col_widths.contains_key(c)) {
            col_keys.push("h|1".into());
        }
        for (r, px) in &s.row_heights {
            if let Some(k) = dim_key(Some(*px), hid_r.contains(r)) {
                row_keys.push(k);
            }
        }
        if hid_r.iter().any(|r| !s.row_heights.contains_key(r)) {
            row_keys.push("h|1".into());
        }
    }
    col_keys.sort();
    col_keys.dedup();
    row_keys.sort();
    row_keys.dedup();
    let mut xml = String::new();
    let mut cols: HashMap<String, String> = HashMap::new();
    let mut rows: HashMap<String, String> = HashMap::new();
    for (i, k) in col_keys.iter().enumerate() {
        let name = format!("co{}", i + 1);
        let vis = if k.ends_with("|1") { " style:visibility=\"collapse\"" } else { "" };
        let width = if k.starts_with("h|") {
            String::new()
        } else {
            let px: f64 = k.split('|').next().and_then(|s| s.parse().ok()).unwrap_or(0.0);
            format!(" style:column-width=\"{}\"", px_to_odf_len(px))
        };
        xml.push_str(&format!(
            "<style:style style:name=\"{name}\" style:family=\"table-column\"><style:table-column-properties fo:break-before=\"auto\"{width}{vis}/></style:style>"
        ));
        cols.insert(k.clone(), name);
    }
    for (i, k) in row_keys.iter().enumerate() {
        let name = format!("ro{}", i + 1);
        let vis = if k.ends_with("|1") { " style:visibility=\"collapse\"" } else { "" };
        let height = if k.starts_with("h|") {
            String::new()
        } else {
            let px: f64 = k.split('|').next().and_then(|s| s.parse().ok()).unwrap_or(0.0);
            format!("style:row-height=\"{}\"", px_to_odf_len(px))
        };
        xml.push_str(&format!(
            "<style:style style:name=\"{name}\" style:family=\"table-row\"><style:table-row-properties {height} fo:break-before=\"auto\" table:use-optimal-row-height=\"false\"{vis}/></style:style>"
        ));
        rows.insert(k.clone(), name);
    }
    (xml, cols, rows)
}

// ---------- 读侧：直解 content.xml 的 automatic-styles 与表格结构 ----------
// calamine 对 ODS 只提供值通道；样式与合并区由本节补齐（覆盖本应用写出的 ODS
// 以及 LibreOffice 常见输出：线型/底色/对齐/换行/粗斜字号字色 + spanned 合并）。

/// "0.5pt solid #000000" → BorderSide；LibreOffice 细边框常见 0.26pt，归入 thin
fn border_side_from_odf(v: &str) -> Option<BorderSide> {
    let mut tokens = v.split_whitespace();
    let width = tokens.next()?;
    let kind = tokens.next()?;
    let color = tokens.next();
    let w: f64 = width.trim_end_matches("pt").parse().unwrap_or(0.5);
    let name = match kind {
        "dashed" => "dashed",
        "dotted" => "dotted",
        "double" => "double",
        _ if w < 0.2 => "hair",
        _ if w <= 1.0 => "thin",
        _ if w <= 2.0 => "medium",
        _ => "thick",
    };
    let c = color
        .filter(|v| v.starts_with('#') && *v != "transparent")
        .map(|v| v.to_string());
    Some(BorderSide { s: Some(name.to_string()), c })
}

fn color_attr(v: Option<String>) -> Option<String> {
    let v = v?;
    if v == "inherit" || v == "transparent" || !v.starts_with('#') {
        return None;
    }
    Some(v)
}

// 注意：attr_str / local_name 均按**去前缀的局部名**比较（"fo:border-left" → "border-left"）
fn apply_table_cell_props(st: &mut CellStyle, e: &quick_xml::events::BytesStart<'_>) {
    if let Some(bg) = color_attr(attr_str(e, "background-color")) {
        st.bg = Some(bg);
    }
    if let Some(h) = attr_str(e, "align").filter(|v| matches!(v.as_str(), "left" | "center" | "right" | "justify")) {
        st.ho = Some(h);
    }
    if let Some(v) = attr_str(e, "vertical-align").filter(|v| matches!(v.as_str(), "top" | "middle" | "bottom")) {
        st.vo = Some(v);
    }
    let wrap = matches!(attr_str(e, "cell-wrapping").as_deref(), Some("wrap"))
        || matches!(attr_str(e, "wrap-option").as_deref(), Some("wrap"));
    if wrap {
        st.wb = true;
    }
    for (attr, key) in [
        ("border-left", 0),
        ("border-right", 1),
        ("border-top", 2),
        ("border-bottom", 3),
    ] {
        if let Some(v) = attr_str(e, attr) {
            if let Some(side) = border_side_from_odf(&v) {
                let bd = st.bd.get_or_insert_with(CellBorder::default);
                match key {
                    0 => bd.l = Some(side),
                    1 => bd.r = Some(side),
                    2 => bd.t = Some(side),
                    _ => bd.b = Some(side),
                }
            }
        }
    }
}

fn apply_text_props(st: &mut CellStyle, e: &quick_xml::events::BytesStart<'_>) {
    if let Some(w) = attr_str(e, "font-weight") {
        if w == "bold" || w.parse::<f64>().map(|v| v >= 600.0).unwrap_or(false) {
            st.bl = true;
        }
    }
    if attr_str(e, "font-style").as_deref() == Some("italic") {
        st.it = true;
    }
    if let Some(fam) = attr_str(e, "font-name").or_else(|| attr_str(e, "font-family")) {
        if !fam.is_empty() && fam != "Calibri" && fam != "等线" {
            st.ff = Some(fam);
        }
    }
    if let Some(sz) = attr_str(e, "font-size") {
        if let Ok(v) = sz.trim_end_matches("pt").parse::<f64>() {
            st.fs = Some(v);
        }
    }
    if let Some(c) = color_attr(attr_str(e, "color")) {
        st.cl = Some(c);
    }
}

fn clamped_repeat(e: &quick_xml::events::BytesStart<'_>, attr: &str) -> u32 {
    attr_str(e, attr)
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(1)
        .clamp(1, 20000)
}

/// ODF 长度值（"2.26cm"/"12.5pt"/"0.5in"…）→ 像素（96dpi，取整）
fn odf_len_to_px(v: &str) -> Option<f64> {
    let v = v.trim();
    let cut = v.find(|c: char| !c.is_ascii_digit() && c != '.' && c != '-' && c != '+')?;
    let n: f64 = v[..cut].parse().ok()?;
    let px = match &v[cut..] {
        "cm" => n * 96.0 / 2.54,
        "mm" => n * 96.0 / 25.4,
        "pt" => n * 96.0 / 72.0,
        "in" => n * 96.0,
        "pc" => n * 96.0 / 6.0,
        "px" => n,
        _ => return None,
    };
    Some(px.round())
}

/// ODF 的工作簿默认字体 = `styles.xml` 里 `<style:default-style style:family="table-cell">`
/// 那条的 `<style:text-properties>`。这一层与 xlsx 的 `cellXfs[0]` 同一档意思，但形状不同：
/// ODF 靠**样式继承链**表达（我们写出的格级样式都以 `Default` 为父，父层说的字族字号不必再种一遍），
/// 而 OOXML 得在写侧手工 seed。只认 `table-cell` 这一支——同文件里 `table-row`/`table-column` 的
/// default-style 管的是缺省行高与列宽，那是另一层（路线图挂着）。
/// 两头都没说就交回 `None`；0 与负数在这一处不拦，由唯一的消费点兜（与 `default_font_of` 同一分寸）
fn ods_default_font_of(styles_xml: &str) -> Option<DefaultFont> {
    let mut reader = Reader::from_str(styles_xml);
    let mut in_cell_default = false;
    let mut ff: Option<String> = None;
    let mut fs: Option<f64> = None;
    while let Ok(ev) = reader.read_event() {
        match &ev {
            Event::Start(e) if e.local_name().as_ref() == "default-style" => {
                in_cell_default = attr_str(e, "family").as_deref() == Some("table-cell");
            }
            Event::End(e) if e.local_name().as_ref() == "default-style" => {
                in_cell_default = false;
            }
            Event::Start(e) | Event::Empty(e)
                if in_cell_default && e.local_name().as_ref() == "text-properties" =>
            {
                // 两条字族属性取一，与格级同一顺序；**这里不归一化**：格级那条"Calibri/等线 不算说话"
                // 管的是别把通用档当真名，而这一层抹掉就等于换字族（v0.57 立的规矩）
                ff = attr_str(e, "font-name")
                    .or_else(|| attr_str(e, "font-family"))
                    .map(|v| v.trim().to_string())
                    .filter(|v| !v.is_empty());
                fs = attr_str(e, "font-size").as_deref().and_then(odf_font_pt);
            }
            Event::Eof => break,
            _ => {}
        }
    }
    if ff.is_none() && fs.is_none() {
        return None;
    }
    Some(DefaultFont { ff, fs })
}

/// 字长在 ODF 里是长度值，但应用都写磅 ⇒ **磅字面直接取**（过了换算就要在字节上漂一档，
/// 与 v0.60 那条"这一层按字面收着"同一分寸）；只有真不是 pt 的那一档才走长度换算，
/// 那一趟带 `odf_len_to_px` 的取整（±0.5px ≈ 0.375pt）
fn odf_font_pt(v: &str) -> Option<f64> {
    let v = v.trim();
    if let Some(num) = v.strip_suffix("pt") {
        return num.trim().parse::<f64>().ok();
    }
    odf_len_to_px(v).map(|px| px * 72.0 / 96.0)
}

/// 任何失败退化为空表；键为 sheet 名（与 calamine 的 table:name 一致）。
/// 交回的第二个值与工作簿默认字体同源，形状与 `read_xlsx_styles` 一致（一趟开包读两件部件）
pub fn read_ods_styles(path: &str) -> (HashMap<String, SheetFmt>, Option<DefaultFont>) {
    let mut out: HashMap<String, SheetFmt> = HashMap::new();
    let Ok(file) = std::fs::File::open(path) else { return (out, None) };
    let Ok(mut zip) = zip::ZipArchive::new(file) else { return (out, None) };
    let Some(xml) = read_entry(&mut zip, "content.xml") else {
        return (out, None);
    };

    let mut styles: HashMap<String, CellStyle> = HashMap::new();
    let mut col_styles: HashMap<String, f64> = HashMap::new();
    let mut row_styles: HashMap<String, f64> = HashMap::new();
    let mut col_hid_styles: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut row_hid_styles: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut sec = String::new(); // automatic-styles | spreadsheet
    let mut cur_style: Option<String> = None;
    let mut cur_col_style: Option<String> = None;
    let mut cur_row_style: Option<String> = None;
    let mut cur_def = CellStyle::default();
    let mut fmt = SheetFmt::default();
    let mut table_name: Option<String> = None;
    let mut row_idx = 0u32;
    let mut row_repeat = 1u32;
    let mut col_idx = 0u32;
    let mut dim_col = 0u32;
    let mut order: Vec<String> = Vec::new(); // 表序，供 settings.xml 冻结按索引回填

    let mut reader = Reader::from_str(&xml);
    while let Ok(ev) = reader.read_event() {
        match &ev {
            Event::Start(e) | Event::Empty(e) => {
                let ln = e.local_name();
                let nm = ln.as_ref();
                let is_start = matches!(ev, Event::Start(_));
                match nm {
                    "automatic-styles" if is_start => sec = "automatic-styles".into(),
                    "style" if is_start && sec == "automatic-styles" => {
                        let family = attr_str(e, "family").unwrap_or_default();
                        if family == "table-cell" || family == "cell" {
                            cur_style = attr_str(e, "name");
                            cur_def = CellStyle::default();
                        } else if family == "table-column" {
                            cur_col_style = attr_str(e, "name");
                        } else if family == "table-row" {
                            cur_row_style = attr_str(e, "name");
                        }
                    }
                    "table-cell-properties" if cur_style.is_some() => apply_table_cell_props(&mut cur_def, e),
                    "text-properties" if cur_style.is_some() => apply_text_props(&mut cur_def, e),
                    "table-column-properties" if cur_col_style.is_some() => {
                        let n = cur_col_style.clone().unwrap();
                        if let Some(px) =
                            attr_str(e, "column-width").as_deref().and_then(odf_len_to_px)
                        {
                            col_styles.insert(n.clone(), px);
                        }
                        if attr_str(e, "visibility").as_deref() == Some("collapse") {
                            col_hid_styles.insert(n);
                        }
                    }
                    "table-row-properties" if cur_row_style.is_some() => {
                        let n = cur_row_style.clone().unwrap();
                        if let Some(px) =
                            attr_str(e, "row-height").as_deref().and_then(odf_len_to_px)
                        {
                            row_styles.insert(n.clone(), px);
                        }
                        if attr_str(e, "visibility").as_deref() == Some("collapse") {
                            row_hid_styles.insert(n);
                        }
                    }
                    "spreadsheet" if is_start => sec = "spreadsheet".into(),
                    "table" if sec == "spreadsheet" => {
                        // 表名是与 calamine 对账的钥匙，必须落在同一个域里：calamine 交回的是解过实体的
                        // 名字，这里按字面收就等于把 "汇总 & 备注" 这类表名的样式整层丢掉
                        table_name = attr_str(e, "name").map(|v| unesc(&v));
                        fmt = SheetFmt::default();
                        row_idx = 0;
                        dim_col = 0;
                        if !is_start {
                            if let Some(name) = table_name.take() {
                                order.push(name.clone());
                                out.insert(name, std::mem::take(&mut fmt));
                            }
                        }
                    }
                    "table-column" if sec == "spreadsheet" => {
                        let repeat = clamped_repeat(e, "number-columns-repeated");
                        let sty = attr_str(e, "style-name");
                        if let Some(px) =
                            sty.as_deref().and_then(|n| col_styles.get(n)).copied()
                        {
                            for i in 0..repeat.min(2048) {
                                fmt.col_widths.insert(dim_col + i, px);
                            }
                        }
                        if sty.as_deref().map_or(false, |n| col_hid_styles.contains(n)) {
                            for i in 0..repeat.min(2048) {
                                fmt.hidden_cols.push(dim_col + i);
                            }
                        }
                        dim_col += repeat;
                    }
                    "table-row" => {
                        col_idx = 0;
                        row_repeat = clamped_repeat(e, "number-rows-repeated");
                        let sty = attr_str(e, "style-name");
                        if let Some(px) =
                            sty.as_deref().and_then(|n| row_styles.get(n)).copied()
                        {
                            for i in 0..row_repeat.min(2048) {
                                fmt.row_heights.insert(row_idx + i, px);
                            }
                        }
                        if sty.as_deref().map_or(false, |n| row_hid_styles.contains(n)) {
                            for i in 0..row_repeat.min(2048) {
                                fmt.hidden_rows.push(row_idx + i);
                            }
                        }
                        if !is_start {
                            row_idx += row_repeat;
                        }
                    }
                    "table-cell" | "covered-table-cell" => {
                        let covered = nm == "covered-table-cell";
                        let repeat = clamped_repeat(e, "number-columns-repeated");
                        let cs = clamped_repeat(e, "number-columns-spanned");
                        let rs = clamped_repeat(e, "number-rows-spanned");
                        let sty = attr_str(e, "style-name");
                        if !covered {
                            if let Some(name) = sty.as_deref().and_then(|n| styles.get(n)) {
                                for i in 0..repeat.min(1024) {
                                    fmt.styles.insert((row_idx, col_idx + i), name.clone());
                                }
                            }
                            // 公式：table:formula 的 of:= 式换算回 OOXML 约定（不带 '='）
                            if repeat == 1 {
                                if let Some(raw) = attr_str(e, "formula") {
                                    let x = odf_to_xlsx_formula(&raw);
                                    if !x.is_empty() {
                                        fmt.formulas.insert((row_idx, col_idx), x);
                                    }
                                }
                            }
                            if cs > 1 || rs > 1 {
                                fmt.merges.push(MergeRange {
                                    start_row: row_idx,
                                    start_column: col_idx,
                                    end_row: row_idx + rs - 1,
                                    end_column: col_idx + cs - 1,
                                });
                            }
                        }
                        col_idx += repeat;
                    }
                    _ => {}
                }
            }
            Event::End(e) => {
                let ln = e.local_name();
                let nm = ln.as_ref();
                match nm {
                    "automatic-styles" => sec.clear(),
                    "style" => {
                        cur_col_style = None;
                        cur_row_style = None;
                        if let Some(name) = cur_style.take() {
                            if cur_def.has_any() {
                                styles.insert(name, cur_def.clone());
                            }
                        }
                    }
                    "table-row" => row_idx += row_repeat,
                    "table" => {
                        if let Some(name) = table_name.take() {
                            order.push(name.clone());
                            out.insert(name, std::mem::take(&mut fmt));
                        }
                    }
                    _ => {}
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    // ODF 的三类规则住在 content.xml 里（筛选是表内的 table:database-range，数据验证与
    // 条件格式是 automatic-styles 里的容器），LibreOffice 与 Excel 都照这个写法存。
    // 我们暂不读它们，但"文件里确实有"这件事必须说得出——文案说的是整份文件，故账记在首表。
    let mut missed: Vec<String> = Vec::new();
    for (needle, note) in [
        ("<table:database-range", "ODS 里的筛选设置暂未读入（被筛掉的行按隐藏行保留）"),
        ("<table:content-validations", "ODS 里的数据验证暂未读入"),
        ("<table:conditional-format", "ODS 里的条件格式暂未读入"),
        // 批注（office:annotation）与链接（text:a）本轮起真读，见 read_ods_cell_side
    ] {
        if xml.contains(needle) {
            missed.push(note.to_string());
        }
    }
    if !missed.is_empty() {
        if let Some(f) = order.first().and_then(|n| out.get_mut(n)) {
            f.rules.notes.append(&mut missed);
        }
    }
    // styles.xml 一处部件供两件事：冻结窗格在 ViewSettings/Tables，工作簿默认字体在 default-style
    let mut default_font = None;
    if let Some(sx) = read_entry(&mut zip, "styles.xml") {
        default_font = ods_default_font_of(&sx);
        for (i, (rows, cols)) in parse_ods_freezes(&sx).into_iter().enumerate() {
            if rows + cols == 0 {
                continue;
            }
            if let Some(f) = order.get(i).and_then(|n| out.get_mut(n)) {
                f.freeze = Some((rows, cols));
            }
        }
    }
    (out, default_font)
}

/// styles.xml 的 config-item-map-indexed "Tables" → 每表 (rows, cols)，未冻结为 (0,0)
fn parse_ods_freezes(xml: &str) -> Vec<(u32, u32)> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut val = String::new();
    let mut rows = 0u32;
    let mut cols = 0u32;
    let mut frozen = false;
    let mut reader = Reader::from_str(xml);
    while let Ok(ev) = reader.read_event() {
        match &ev {
            Event::Start(e) if e.local_name().as_ref() == "config-item" => {
                cur = attr_str(e, "name").unwrap_or_default();
                val.clear();
            }
            Event::Text(t) if !cur.is_empty() => {
                val = t.as_ref().to_string();
            }
            Event::End(e) => {
                let ln = e.local_name();
                match ln.as_ref() {
                    "config-item" => match cur.as_str() {
                        "Columns" => cols = val.trim().parse().unwrap_or(0),
                        "Rows" => rows = val.trim().parse().unwrap_or(0),
                        "IsFrozen" => frozen = val.trim() == "true",
                        _ => {}
                    },
                    "config-item-map-entry" => {
                        out.push(if frozen { (rows, cols) } else { (0, 0) });
                        rows = 0;
                        cols = 0;
                        frozen = false;
                    }
                    _ => {}
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    out
}

/// 事件流里的正文是原始字节（未解实体），交出去前统一解一次
fn unesc(s: &str) -> String {
    quick_xml::escape::unescape(s)
        .map(|c| c.into_owned())
        .unwrap_or_else(|_| s.to_string())
}

/// quick-xml 0.42 把 `&amp;` 这类实体拆成独立事件（不带 & 与 ;）：补回转义形状，末尾再统一解一次
fn push_entity(buf: &mut String, raw: &str) {
    buf.push('&');
    buf.push_str(raw);
    buf.push(';');
}

/// ODF 内部跳转的住址（§9.2.1）：`#表名.格`，有的应用写 `.#表名.格`；表名含空格、点或撇时
/// 用单引号包起、内部的 ' 翻倍；行列表里的 `$`（绝对引用，§9.2.2）读时剥掉。
/// 认不出「表名.格」这一对就交回 None，由调用处记账而不是凑一个像样的 location
fn ods_internal_target(href: &str) -> Option<String> {
    let rest = href
        .strip_prefix("#.")
        .or_else(|| href.strip_prefix(".#"))
        .or_else(|| href.strip_prefix('#'))?;
    let (name, tail) = split_table_ref(rest)?;
    let cell = tail.split(':').next().unwrap_or(tail).replace('$', "");
    if a1_to_rc(&cell).is_none() {
        return None;
    }
    Some(format!("{name}!{cell}"))
}

/// `xlink:href` 里带协议名的才是外部地址（scheme 形状照 RFC 3986：字母开头，后接字母数字与 + -，
/// 且至少两字母——单字母更像 C: 这类盘符而不是协议）。
/// 既不带 # 又不带协议名的那一档不硬派成 url：那是一条点不开的死链，只记账
fn odf_external_href(h: &str) -> bool {
    let Some((scheme, rest)) = h.split_once(':') else {
        return false;
    };
    !rest.is_empty()
        && scheme.len() >= 2
        && scheme.starts_with(|c: char| c.is_ascii_alphabetic())
        && scheme
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'-')
}

fn split_table_ref(s: &str) -> Option<(String, &str)> {
    if let Some(q) = s.strip_prefix('\'') {
        let bytes = q.as_bytes();
        let mut i = 0usize;
        while i < bytes.len() {
            if bytes[i] == b'\'' {
                if bytes.get(i + 1) == Some(&b'\'') {
                    i += 2;
                    continue;
                }
                let name = q[..i].replace("''", "'");
                return q[i + 1..].strip_prefix('.').map(|r| (name, r));
            }
            i += 1;
        }
        return None; // 引号没闭合
    }
    let (name, tail) = s.split_once('.')?;
    if name.is_empty() || tail.is_empty() {
        return None;
    }
    Some((name.to_string(), tail))
}

/// 一条批注在读侧的中间形状：作者、正文、气泡尺寸与"是否常开"分开收，格子位置由外层记
#[derive(Default)]
struct RawAnnot {
    seen: bool,
    author: String,
    text: String,
    width: Option<f64>,
    height: Option<f64>,
    show: Option<bool>,
}

/// ODS 的批注与超链接都住在 content.xml 的**格子自身**里（xlsx 那一头是独立部件 + rels），
/// 所以一趟扫描就能收齐：批注是格子的第一个孩子（ODF §9.1.4，正文在自家 `text:p` 里、
/// 作者在 `dc:creator`），链接是格内文本外层的 `text:a`。
/// 交回的形状与 `xlsx_cell_side::SideRead` 完全一致，装配侧因此不必知道格式。
pub fn read_ods_cell_side(path: &str) -> xlsx_cell_side::SideRead {
    let mut out = xlsx_cell_side::SideRead::default();
    let Ok(file) = std::fs::File::open(path) else { return out };
    let Ok(mut zip) = zip::ZipArchive::new(file) else { return out };
    let Some(xml) = read_entry(&mut zip, "content.xml") else { return out };

    let mut side = xlsx_cell_side::SheetSide::default();
    let mut table = String::new();
    let (mut row, mut row_repeat, mut col) = (0u32, 1u32, 0u32);
    // 本格左上角；写在重复列上的格是 None（它落在哪一列说不准），批注与链接都别硬派
    let mut cell: Option<(u32, u32)> = None;
    let mut covered = false;
    let mut annot = RawAnnot::default();
    let mut link: Option<CellLinkPayload> = None;
    let mut links_seen = 0usize;
    let mut buf = String::new();
    let (mut in_annot, mut in_creator, mut in_meta) = (false, false, false);

    let mut reader = Reader::from_str(&xml);
    while let Ok(ev) = reader.read_event() {
        let is_start = matches!(ev, Event::Start(_));
        match &ev {
            Event::Start(e) | Event::Empty(e) => {
                let nm = e.local_name();
                match nm.as_ref() {
                    "table" => {
                        flush_table(&mut table, &mut side, &mut out);
                        // 同上：表名要和 calamine 的名字对上，按字面收就接不进 by_sheet
                        table = attr_str(e, "name").map(|v| unesc(&v)).unwrap_or_default();
                        row = 0;
                        row_repeat = 1;
                        col = 0;
                    }
                    "table-row" => {
                        col = 0;
                        row_repeat = clamped_repeat(e, "number-rows-repeated");
                        if !is_start {
                            row += row_repeat;
                        }
                    }
                    "table-cell" | "covered-table-cell" => {
                        let repeat = clamped_repeat(e, "number-columns-repeated");
                        // 合并区里左上那一格横向占几列——不把它算进列位，后继的格子会整体错位
                        let spanned = clamped_repeat(e, "number-columns-spanned");
                        covered = nm.as_ref() == "covered-table-cell";
                        cell = if covered || repeat != 1 {
                            None
                        } else {
                            Some((row, col))
                        };
                        col += repeat * spanned;
                        annot = RawAnnot::default();
                        link = None;
                        links_seen = 0;
                        in_annot = false;
                        in_creator = false;
                        in_meta = false;
                        buf.clear();
                        // 自闭合的格没有孩子：批注与链接都无从谈起，上面的复位已足够
                    }
                    "annotation" => {
                        in_annot = true;
                        annot.seen = true;
                        // 缺席与 false 同一档（ODF 的缺省就是不常开），只在真说了 true 时收
                        annot.show = attr_str(e, "display")
                            .as_deref()
                            .filter(|v| *v == "true")
                            .map(|_| true);
                        annot.width = attr_str(e, "width").as_deref().and_then(odf_len_to_px);
                        annot.height = attr_str(e, "height").as_deref().and_then(odf_len_to_px);
                        if !is_start {
                            in_annot = false;
                        }
                    }
                    "creator" if in_annot => {
                        in_creator = true;
                        buf.clear();
                        if !is_start {
                            in_creator = false;
                        }
                    }
                    "date" | "date-string" | "creator-initials" if in_annot => {
                        in_meta = is_start;
                    }
                    "p" | "h" if in_annot => {
                        // 段落之间留一行：多段正文与 Univer 气泡里的换行同一档
                        if !annot.text.is_empty() && !annot.text.ends_with('\n') {
                            annot.text.push('\n');
                        }
                    }
                    "s" if in_annot => {
                        let n = attr_str(e, "c")
                            .and_then(|v| v.parse::<u32>().ok())
                            .unwrap_or(1)
                            .clamp(1, 1024);
                        for _ in 0..n {
                            annot.text.push(' ');
                        }
                    }
                    "tab" if in_annot => annot.text.push('\t'),
                    "line-break" if in_annot => annot.text.push('\n'),
                    "a" if !in_annot => {
                        let Some((cr, cc)) = cell else {
                            // 落不准确的链接不收：被盖住的格（合并区）与一次重复多列的格都说不清它属于谁
                            side.accounts.push(if covered {
                                format!(
                                    "第 {} 行有链接写在被合并区盖住的格上，说不准它属于哪一格，未收进来",
                                    row + 1
                                )
                            } else {
                                format!(
                                    "第 {} 行的链接写在一次重复多列的格上，说不准它落在哪一列，未收进来",
                                    row + 1
                                )
                            });
                            continue;
                        };
                        links_seen += 1;
                        if links_seen > 1 {
                            side.accounts.push(format!(
                                "第 {} 行第 {} 列写了 {links_seen} 条链接，只收第一条",
                                cr + 1,
                                cc + 1
                            ));
                            continue;
                        }
                        let href = attr_str(e, "href")
                            .map(|v| unesc(v.trim()))
                            .filter(|v| !v.is_empty());
                        let tip = attr_str(e, "title")
                            .map(|v| unesc(v.trim()))
                            .filter(|v| !v.is_empty());
                        let Some(h) = href else {
                            side.accounts.push(format!(
                                "第 {} 行第 {} 列的链接没写它指向哪儿，未收进来",
                                cr + 1,
                                cc + 1
                            ));
                            continue;
                        };
                        // 有协议名（https:/mailto:/tel:…，RFC 3986 的 scheme 形状）才算外部地址；
                        // 带 # 的按内部跳转解；两者都不像就不硬派成 url——那是一条点不开的死链
                        if let Some(loc) = ods_internal_target(&h) {
                            link = Some(CellLinkPayload {
                                r: cr,
                                c: cc,
                                location: Some(loc),
                                tip,
                                ..Default::default()
                            });
                        } else if odf_external_href(&h) {
                            link = Some(CellLinkPayload {
                                r: cr,
                                c: cc,
                                url: Some(h),
                                tip,
                                ..Default::default()
                            });
                        } else {
                            side.accounts.push(format!(
                                "第 {} 行第 {} 列的链接指向「{h}」，位置认不出来，未收进来",
                                cr + 1,
                                cc + 1
                            ));
                        }
                    }
                    _ => {}
                }
            }
            Event::Text(t) => {
                let s = t.as_ref();
                if in_creator {
                    buf.push_str(s);
                } else if in_annot && !in_meta {
                    annot.text.push_str(s);
                }
            }
            Event::GeneralRef(r) => {
                let s = r.as_ref();
                if in_creator {
                    push_entity(&mut buf, s);
                } else if in_annot && !in_meta {
                    push_entity(&mut annot.text, s);
                }
            }
            Event::End(e) => {
                let nm = e.local_name();
                match nm.as_ref() {
                    "table" => flush_table(&mut table, &mut side, &mut out),
                    "table-row" => row += row_repeat,
                    "table-cell" => {
                        let Some((r, c)) = cell else {
                            if annot.seen {
                                side.accounts.push(
                                    "批注写在一次重复多列的格上，说不准它落在哪一列，未收进来"
                                        .to_string(),
                                );
                            }
                            continue;
                        };
                        if annot.seen {
                            let text = unesc(&annot.text);
                            let text = text.trim_matches('\n').to_string();
                            // 空气泡没有可显示的东西，收了反而在界面上多一枚标记
                            if !text.trim().is_empty() {
                                side.notes.push(CellNotePayload {
                                    r,
                                    c,
                                    text,
                                    author: Some(unesc(&annot.author).trim().to_string())
                                        .filter(|a| !a.is_empty()),
                                    width: annot.width,
                                    height: annot.height,
                                    show: annot.show,
                                });
                            }
                        }
                        if let Some(mut l) = link.take() {
                            l.r = r;
                            l.c = c;
                            side.links.push(l);
                        }
                        annot = RawAnnot::default();
                        in_annot = false;
                        in_creator = false;
                        in_meta = false;
                        cell = None;
                    }
                    "covered-table-cell" => {
                        if annot.seen {
                            side.accounts.push(
                                "合并区里的批注写在被盖住的格上，说不准它属于哪一格，未收进来"
                                    .to_string(),
                            );
                        }
                        annot = RawAnnot::default();
                        in_annot = false;
                        cell = None;
                    }
                    "annotation" => in_annot = false,
                    "creator" if in_creator => {
                        annot.author = std::mem::take(&mut buf);
                        in_creator = false;
                    }
                    "date" | "date-string" | "creator-initials" => in_meta = false,
                    _ => {}
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    if !table.is_empty() {
        flush_table(&mut table, &mut side, &mut out);
    }
    out
}

/// 一张表的批注与链接结转到按表名索引的读数里：空的表不占位，表上的账并进全局账
/// （与 `xlsx_cell_side::read_cell_side` 同一分寸：账说的是哪张表缺了什么，但别挂在别的表上）
fn flush_table(
    table: &mut String,
    side: &mut xlsx_cell_side::SheetSide,
    out: &mut xlsx_cell_side::SideRead,
) {
    if table.is_empty() {
        return;
    }
    side.notes.sort_by_key(|n| (n.r, n.c));
    side.links.sort_by_key(|l| (l.r, l.c));
    out.accounts.append(&mut side.accounts);
    if !side.notes.is_empty() || !side.links.is_empty() {
        out.by_sheet
            .insert(std::mem::take(table), std::mem::take(side));
    } else {
        side.notes.clear();
        side.links.clear();
        table.clear();
    }
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

/// 公式属性；无缓存值时补 float 0，保证 LO 打开后有合法显示
fn cell_content_attrs(x: &CellPayload) -> (String, String, String) {
    let (vt, text) = match x.v.as_ref() {
        Some(v) => cell_value_xml(v),
        None if x.f.is_some() => (
            "office:value-type=\"float\" office:value=\"0\"".into(),
            "0".into(),
        ),
        None => ("office:value-type=\"string\"".into(), String::new()),
    };
    let fattr = x
        .f
        .as_deref()
        .map(|t| format!(" table:formula=\"{}\"", esc_attr(&xlsx_to_odf_formula(t))))
        .unwrap_or_default();
    (vt, text, fattr)
}

// ---- 公式语法换算：xlsx A1 式 ⇄ ODF of:= 式（同表 [.A1]/[.A1:.B2]，参数分隔 ; ）----

/// 读侧只需还原成 A1 式；shared/数组细节与跨表绝对引用取最小支持面。
fn is_simple_sheet(name: &str) -> bool {
    !name.is_empty()
        && name.starts_with(|c: char| c.is_ascii_alphabetic() || c == '_')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// 从 i 起解析 A1 引用（可带 $），成功返回 (新位置, "A1")；后接 ( . _ 或字母数字则不算。
fn skip_cellref(src: &[char], i: usize) -> Option<(usize, String)> {
    let mut j = i;
    if src.get(j) == Some(&'$') {
        j += 1;
    }
    let l0 = j;
    while j < src.len() && src[j].is_ascii_alphabetic() && j - l0 < 3 {
        j += 1;
    }
    if j == l0 {
        return None;
    }
    let letters: String = src[l0..j].iter().collect();
    if src.get(j) == Some(&'$') {
        j += 1;
    }
    let d0 = j;
    while j < src.len() && src[j].is_ascii_digit() {
        j += 1;
    }
    if j == d0 {
        return None;
    }
    let digits: String = src[d0..j].iter().collect();
    if let Some(&n) = src.get(j) {
        if n == '(' || n == '.' || n == '_' || n.is_ascii_alphanumeric() {
            return None;
        }
    }
    Some((j, format!("{}{}", letters.to_uppercase(), digits)))
}

/// 从 i 起解析 sheet 限定（标识符 + '.'），返回 (新位置, sheet 名)
fn skip_sheet_prefix(src: &[char], i: usize) -> Option<(usize, String)> {
    let mut j = i;
    if !src.get(j).map_or(false, |c| c.is_ascii_alphabetic() || *c == '_') {
        return None;
    }
    let s0 = j;
    while j < src.len() && (src[j].is_ascii_alphanumeric() || src[j] == '_') {
        j += 1;
    }
    if src.get(j) != Some(&'.') {
        return None;
    }
    Some((j + 1, src[s0..j].iter().collect()))
}

fn odf_ref_side(sheet: Option<&str>, r: &str) -> String {
    match sheet {
        Some(s) if !is_simple_sheet(s) => format!("'{s}.{r}"),
        Some(s) => format!("{s}.{r}"),
        None => r.to_string(),
    }
}

/// xlsx "=SUM(A1:B2,C1)" → "of:=SUM([.A1:.B2];[.C1])"
fn xlsx_to_odf_formula(f: &str) -> String {
    let src: Vec<char> = f.trim_start_matches('=').chars().collect();
    let mut out = String::from("of:=");
    let mut i = 0;
    let mut instr = false;
    while i < src.len() {
        let ch = src[i];
        if instr {
            out.push(ch);
            if ch == '"' {
                instr = false;
            }
            i += 1;
            continue;
        }
        match ch {
            '"' => {
                instr = true;
                out.push(ch);
                i += 1;
            }
            ',' => {
                out.push(';');
                i += 1;
            }
            '$' | 'A'..='Z' | 'a'..='z' => {
                // sheet 限定优先，其次同表引用（含区间），都不中就原样吐一个字符
                let (base, sheet) = match skip_sheet_prefix(&src, i) {
                    Some((j, s)) => (j, Some(s)),
                    None => (i, None),
                };
                if let Some((mut j, a)) = skip_cellref(&src, base) {
                    if let Some((k, b)) = skip_cellref(&src, j + 1).filter(|_| src.get(j) == Some(&':')) {
                        j = k;
                        out.push_str(&format!("[.{}:.{}]", odf_ref_side(sheet.as_deref(), &a), b));
                    } else {
                        out.push_str(&format!("[.{}]", odf_ref_side(sheet.as_deref(), &a)));
                    }
                    i = j;
                    continue;
                }
                out.push(ch);
                i += 1;
            }
            _ => {
                out.push(ch);
                i += 1;
            }
        }
    }
    out
}

/// "of:=SUM([.A1:.A2]);…" → "SUM(A1:A2),…"（不带 '='，落 SheetFmt.formulas 的 OOXML 约定）
fn odf_to_xlsx_formula(f: &str) -> String {
    let t = f.trim();
    let t = match t.strip_prefix("of:=") {
        Some(s) => s,
        None => t.strip_prefix('=').unwrap_or(t),
    };
    let src: Vec<char> = t.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    let mut instr = false;
    while i < src.len() {
        let ch = src[i];
        if instr {
            out.push(ch);
            if ch == '"' {
                instr = false;
            }
            i += 1;
            continue;
        }
        match ch {
            '"' => {
                instr = true;
                out.push(ch);
                i += 1;
            }
            ';' => {
                out.push(',');
                i += 1;
            }
            '[' => {
                let close = src[i + 1..]
                    .iter()
                    .position(|&c| c == ']')
                    .map(|p| p + i + 1)
                    .unwrap_or(src.len());
                let inner: String = src[i + 1..close].iter().filter(|&&c| c != '$').collect();
                let inner = inner.strip_prefix('.').unwrap_or(&inner).to_string();
                let mut sides: Vec<String> = Vec::new();
                for side in inner.split(':') {
                    let side = side.strip_prefix('.').unwrap_or(side);
                    let dot = side.rfind('.');
                    sides.push(match dot {
                        // 写侧把带空格的表名输出成 ['My Sheet.A1]，读回补成 xlsx 的 'My Sheet'.A1
                        Some(p) if p > 0 && side.starts_with('\'') => {
                            format!("'{}'.{}", &side[1..p], &side[p + 1..])
                        }
                        Some(p) if p > 0 => format!("{}.{}", &side[..p], &side[p + 1..]),
                        None => side.to_string(),
                        Some(_) => side.to_string(),
                    });
                }
                out.push_str(&sides.join(":"));
                i = close + 1;
            }
            _ => {
                out.push(ch);
                i += 1;
            }
        }
    }
    out
}


/// 表名进 ODF 内部地址的写法（§9.2.1）：含空格、点或撇的要用单引号包起，内部的 ' 翻倍
fn odf_table_ref(name: &str) -> String {
    if name.chars().any(|c| c == ' ' || c == '.' || c == '\'') {
        format!("'{}'", name.replace('\'', "''"))
    } else {
        name.to_string()
    }
}

/// 载荷的链接 → `xlink:href`。外部地址照字面走；`location`（"表名!A1"）折成 §9.2.1 的 `#表名.格`，
/// 没写表名的那一档用本表补齐。两头都没说就交回 None——这一条链接不落笔
fn odf_href(l: &CellLinkPayload, table: &str) -> Option<String> {
    if let Some(u) = l.url.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
        return Some(u.to_string());
    }
    let loc = l.location.as_deref().map(str::trim).filter(|v| !v.is_empty())?;
    let (name, cell) = match loc.split_once('!') {
        Some((n, c)) => (n, c),
        None => (table, loc),
    };
    if cell.is_empty() {
        return None;
    }
    Some(format!("#{}.{cell}", odf_table_ref(name)))
}

/// 载荷的批注在这一路落不落得下去：没有正文的气泡收了也只是界面上多一枚点不开的标记（与读侧同一分寸）
fn note_writable(n: &CellNotePayload) -> bool {
    !n.text.trim().is_empty()
}

/// 载荷的链接在这一路落不落得下去：两头（外部地址 / 表内跳转）都没说就没有 `xlink:href` 可写
fn link_writable(l: &CellLinkPayload, table: &str) -> bool {
    odf_href(l, table).is_some()
}

/// 这一格是否被合并区盖住（锚格自己不算被盖）。v0.63 的规格腿把这一条的**依据**量准了：往
/// `covered-table-cell` 里塞批注、正文、链接，RelaxNG **三档全部放行**（拦它的不是文法），拦它的是 ODF 正文的
/// 语义——那一格的内容属于锚格，写进去等于凭空多出一份没人会读的正文，读回来还会把这两样派给不该派的地址
/// （与读侧"落不准就不硬派"是同一条分寸）
fn cell_covered(sheet: &SheetPayload, r: u32, c: u32) -> bool {
    sheet
        .merges
        .iter()
        .any(|m| cell_in_merge(m, r, c) && !(m.start_row == r && m.start_column == c))
}

/// 这一枚批注/链接**真会**出现在字节里吗：命名空间、格子渲染与写侧账目三处都读这一条判据，
/// 各写各的就会有一种状态是"账上说没写、字节里却写了"
fn note_written(sheet: &SheetPayload, n: &CellNotePayload) -> bool {
    note_writable(n) && !cell_covered(sheet, n.r, n.c)
}

fn link_written(sheet: &SheetPayload, l: &CellLinkPayload) -> bool {
    link_writable(l, &sheet.name) && !cell_covered(sheet, l.r, l.c)
}

/// 气泡尺寸那一味真会落笔吗：`svg:length` 必须带单位，而 0 与负数换算出来是不成立的尺寸（`px_to_odf_len`
/// 也写不出可读的厘米数）⇒ 与 `annotation_xml` 共用这条判据，否则命名空间会为一条根本不写的属性白声明
fn bubble_dim(px: Option<f64>) -> Option<f64> {
    px.filter(|v| v.is_finite() && *v > 0.0)
}

/// 批注 → `<office:annotation>`，调用处把它排在格子的正文 `<text:p>` **之前**（ODF §9.1.4 的
/// 子元素顺序，写在正文之后就是不合规的件）。没声明的一味整条不写：`office:display` 只在真说了
/// true 时落笔（缺席与 false 同一档，见读侧同一分寸），气泡尺寸只在载荷给了那一味时写——
/// 替文件补一枚尺寸就是替用户决定了气泡多大
fn annotation_xml(n: Option<&CellNotePayload>) -> String {
    let Some(n) = n else { return String::new() };
    let mut attrs = String::new();
    if n.show == Some(true) {
        attrs.push_str(" office:display=\"true\"");
    }
    for (name, v) in [("svg:width", n.width), ("svg:height", n.height)] {
        if let Some(px) = bubble_dim(v) {
            attrs.push_str(&format!(" {name}=\"{}\"", px_to_odf_len(px)));
        }
    }
    let mut body = String::new();
    if let Some(a) = n.author.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
        body.push_str(&format!("<dc:creator>{}</dc:creator>", esc(a)));
    }
    // 一段一行：读侧把多个 text:p 以换行相连，写侧就按换行拆回去
    for line in n.text.split('\n') {
        body.push_str(&format!("<text:p>{}</text:p>", esc(line)));
    }
    format!("<office:annotation{attrs}>{body}</office:annotation>")
}

/// 格子的正文层：有链接时把文字外套一条 `text:a`（ODF 的超链接没有独立部件，就长在正文上）
fn text_p_xml(text: &str, link: Option<&CellLinkPayload>, table: &str) -> String {
    let inner = esc(text);
    let Some(h) = link.and_then(|l| odf_href(l, table)) else {
        return format!("<text:p>{inner}</text:p>");
    };
    let tip = link
        .and_then(|l| l.tip.as_deref())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(|v| format!(" office:title=\"{}\"", esc_attr(v)))
        .unwrap_or_default();
    format!(
        "<text:p><text:a xlink:type=\"simple\" xlink:href=\"{}\"{tip}>{inner}</text:a></text:p>",
        esc_attr(&h)
    )
}

/// 这一份件真用得上的命名空间：作者用 dc、气泡尺寸用 svg（都是 length，单位必带）、链接用 xlink。
/// 只算**真会落笔**的那几枚：落在被盖住的格上的批注根本写不出去，替它声明一趟 `xmlns:dc` 就是多盖一枚戳
#[derive(Default)]
struct OdfNs {
    dc: bool,
    svg: bool,
    xlink: bool,
}

fn used_namespaces(sheets: &[SheetPayload]) -> OdfNs {
    let mut ns = OdfNs::default();
    for s in sheets {
        for n in s.notes.iter().filter(|n| note_written(s, n)) {
            if n.author.as_deref().map_or(false, |a| !a.trim().is_empty()) {
                ns.dc = true;
            }
            if bubble_dim(n.width).is_some() || bubble_dim(n.height).is_some() {
                ns.svg = true;
            }
        }
        if s.links.iter().any(|l| link_written(s, l)) {
            ns.xlink = true;
        }
    }
    ns
}

/// 写侧的边界账：这一趟有哪几枚批注/链接摆不下、要说得出来。
/// 判据与 `render_sheet` 共用同一批函数，所以「报的账」与「字节里少掉的那几枚」是同一批——
/// 少了这条通道就是"读侧有账、写侧无账"：界面上报保存成功，文件里却少了东西
pub(crate) fn ods_side_accounts(sheets: &[SheetPayload]) -> Vec<String> {
    let mut out = Vec::new();
    for s in sheets {
        for n in &s.notes {
            if !note_writable(n) {
                out.push(format!(
                    "第 {} 行第 {} 列的批注没有正文，未写入",
                    n.r + 1,
                    n.c + 1
                ));
            } else if cell_covered(s, n.r, n.c) {
                out.push(format!(
                    "第 {} 行第 {} 列的批注落在合并区里被盖住的那一格，ODF 在那里没有批注通道，未写入",
                    n.r + 1,
                    n.c + 1
                ));
            }
        }
        for l in &s.links {
            if !link_writable(l, &s.name) {
                out.push(format!(
                    "第 {} 行第 {} 列的链接既没有外部地址也没有表内跳转目标，未写入",
                    l.r + 1,
                    l.c + 1
                ));
            } else if cell_covered(s, l.r, l.c) {
                out.push(format!(
                    "第 {} 行第 {} 列的链接落在合并区里被盖住的那一格，ODF 在那里没有正文通道，未写入",
                    l.r + 1,
                    l.c + 1
                ));
            }
        }
        // 同一格只出一枚气泡、一条地址：多出来的那些不硬派成第二条，报出实际条数（按格子序说，稳定可比）
        for (label, dups) in [
            (
                "批注",
                written_dups(s.notes.iter().filter(|n| note_written(s, n)).map(|n| (n.r, n.c))),
            ),
            (
                "链接",
                written_dups(s.links.iter().filter(|l| link_written(s, l)).map(|l| (l.r, l.c))),
            ),
        ] {
            for ((r, c), k) in dups {
                out.push(format!(
                    "第 {} 行第 {} 列写了 {k} 条{label}，只写了第一条",
                    r + 1,
                    c + 1
                ));
            }
        }
    }
    out
}

/// 真落笔的那些格里的重复条目（按格子序）；只有一条的格不报名字
fn written_dups(cells: impl Iterator<Item = (u32, u32)>) -> Vec<((u32, u32), usize)> {
    let mut m: std::collections::BTreeMap<(u32, u32), usize> = std::collections::BTreeMap::new();
    for k in cells {
        *m.entry(k).or_default() += 1;
    }
    m.into_iter().filter(|(_, k)| *k > 1).collect()
}

fn render_sheet(
    sheet: &SheetPayload,
    style_names: &HashMap<String, String>,
    col_reg: &HashMap<String, String>,
    row_reg: &HashMap<String, String>,
    out: &mut String,
) {
    out.push_str(&format!(
        "<table:table table:name=\"{}\">",
        esc(&sheet.name)
    ));
    let hid_c: std::collections::HashSet<u32> = sheet.hidden_cols.iter().copied().collect();
    let hid_r: std::collections::HashSet<u32> = sheet.hidden_rows.iter().copied().collect();
    let max_row = sheet
        .cells
        .iter()
        .map(|x| x.r)
        .chain(sheet.merges.iter().map(|m| m.end_row))
        .chain(sheet.hidden_rows.iter().copied())
        .chain(sheet.notes.iter().map(|n| n.r))
        .chain(sheet.links.iter().map(|l| l.r))
        .max()
        .unwrap_or(0);
    let max_col = sheet
        .cells
        .iter()
        .map(|x| x.c)
        .chain(sheet.merges.iter().map(|m| m.end_column))
        .chain(sheet.hidden_cols.iter().copied())
        .chain(sheet.notes.iter().map(|n| n.c))
        .chain(sheet.links.iter().map(|l| l.c))
        .max()
        .unwrap_or(0);
    let col_style_at = |c: u32| {
        dim_key(sheet.col_widths.get(&c).copied(), hid_c.contains(&c))
            .and_then(|k| col_reg.get(&k).cloned())
    };
    // 列元素：同宽度的连续列合并为一次 repeated
    let mut c = 0u32;
    while c <= max_col {
        let name = col_style_at(c);
        let mut n = 1u32;
        while c + n <= max_col && col_style_at(c + n) == name {
            n += 1;
        }
        let sty = name.map(|x| format!(" table:style-name=\"{x}\"")).unwrap_or_default();
        out.push_str(&format!(
            "<table:table-column{sty} table:number-columns-repeated=\"{n}\"/>"
        ));
        c += n;
    }

    let row_style_at = |r: u32| {
        dim_key(sheet.row_heights.get(&r).copied(), hid_r.contains(&r))
            .and_then(|k| row_reg.get(&k).cloned())
    };
    let cell_at = |r: u32, c: u32| sheet.cells.iter().find(|x| x.r == r && x.c == c);
    // 落得下去的那几枚才落笔：判据与写侧账目同源（空气泡、没目标的地址、被盖住的格都摆不下）
    let note_at = |r: u32, c: u32| {
        sheet
            .notes
            .iter()
            .find(|n| n.r == r && n.c == c && note_written(sheet, n))
    };
    let link_at = |r: u32, c: u32| {
        sheet
            .links
            .iter()
            .find(|l| l.r == r && l.c == c && link_written(sheet, l))
    };
    let side_at = |r: u32, c: u32| note_at(r, c).is_some() || link_at(r, c).is_some();
    let mut gap = 0u32;
    let mut row_buf = String::new();
    for r in 0..=max_row {
        let row_sty = row_style_at(r);
        let row_used = row_sty.is_some()
            || sheet
                .merges
                .iter()
                .any(|m| r >= m.start_row && r <= m.end_row)
            || sheet
                .cells
                .iter()
                .any(|x| x.r == r && (x.v.is_some() || x.f.is_some() || x.s.is_some()))
            || (0..=max_col).any(|c| side_at(r, c));
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
            let covered = cell_covered(sheet, r, c);
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
                let (vt, text, fattr) = top
                    .map(cell_content_attrs)
                    .unwrap_or_else(|| ("office:value-type=\"string\"".into(), String::new(), String::new()));
                let style = style_key(top.and_then(|x| x.s.as_ref()))
                    .and_then(|k| style_names.get(&k))
                    .map(|n| format!(" table:style-name=\"{n}\""))
                    .unwrap_or_default();
                row_buf.push_str(&format!(
                    "<table:table-cell{style} {vt}{fattr} table:number-columns-spanned=\"{col_span}\" table:number-rows-spanned=\"{row_span}\">{}{}</table:table-cell>",
                    annotation_xml(note_at(r, c)),
                    text_p_xml(&text, link_at(r, c), &sheet.name)
                ));
                c = m.end_column + 1;
                continue;
            }
            if covered {
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
                .map(|x| x.v.is_some() || x.f.is_some() || style_key(x.s.as_ref()).is_some())
                .unwrap_or(false)
                || side_at(r, c);
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
            // 只有批注或链接的格没有载荷那一枚：值那一味按"文件没说话"交回空串，格还得占位
            let (vt, text, fattr) = cell
                .map(cell_content_attrs)
                .unwrap_or_else(|| ("office:value-type=\"string\"".into(), String::new(), String::new()));
            let style = cell
                .and_then(|x| style_key(x.s.as_ref()))
                .and_then(|k| style_names.get(&k))
                .map(|n| format!(" table:style-name=\"{n}\""))
                .unwrap_or_default();
            row_buf.push_str(&format!(
                "<table:table-cell{style} {vt}{fattr}>{}{}</table:table-cell>",
                annotation_xml(note_at(r, c)),
                text_p_xml(&text, link_at(r, c), &sheet.name)
            ));
            c += 1;
        }
        flush_covered(&mut row_buf, &mut pending_covered);
        // 行尾的普通空格子直接截断不写；只有自定义行高的空行补占位空格
        let sty = row_sty.map(|x| format!(" table:style-name=\"{x}\"")).unwrap_or_default();
        let body = if row_buf.is_empty() {
            format!("<table:table-cell table:number-columns-repeated=\"{}\"/>", max_col + 1)
        } else {
            std::mem::take(&mut row_buf)
        };
        out.push_str(&format!("<table:table-row{sty}>{body}</table:table-row>"));
    }
    out.push_str("</table:table>");
}

/// 冻结窗格写进 styles.xml 的 office:settings（LibreOffice 的 ViewSettings 结构）；
/// 每表一条 map-entry 保持与 content.xml 表序对齐，无冻结时整节省略。
fn settings_xml(sheets: &[SheetPayload]) -> Option<String> {
    if sheets
        .iter()
        .all(|s| s.freeze.map_or(true, |f| f.rows + f.cols == 0))
    {
        return None;
    }
    let mut s = String::from(
        "<office:settings><config:config-item-set config:name=\"ooo:view-settings\">\
         <config:config-item-map-indexed config:name=\"Tables\">",
    );
    for sheet in sheets {
        let (rows, cols) = sheet.freeze.map(|f| (f.rows, f.cols)).unwrap_or((0, 0));
        let frozen = rows + cols > 0;
        s.push_str(&format!(
            "<config:config-item-map-entry>\
             <config:config-item config:name=\"ActiveCol\" config:type=\"int\">0</config:config-item>\
             <config:config-item config:name=\"ActiveRow\" config:type=\"int\">0</config:config-item>\
             <config:config-item config:name=\"Columns\" config:type=\"int\">{cols}</config:config-item>\
             <config:config-item config:name=\"Rows\" config:type=\"int\">{rows}</config:config-item>\
             <config:config-item config:name=\"IsFrozen\" config:type=\"boolean\">{frozen}</config:config-item>\
             </config:config-item-map-entry>"
        ));
    }
    s.push_str("</config:config-item-map-indexed></config:config-item-set></office:settings>");
    Some(s)
}

pub fn ods_xml(workbook: &WorkbookPayload) -> (String, String) {
    let (style_names, styles_xml) = build_styles(&workbook.sheets);
    let (dim_xml, col_reg, row_reg) = build_dim_styles(&workbook.sheets);
    // 命名空间按这份件真用得上的声明：没有批注与链接的件不该多出三行 xmlns（与 default_style_xml
    // 那条「没声明就不写这一层」同一分寸——凭空声明不改字节里的内容，但也不该改文件的形状）
    let ns = used_namespaces(&workbook.sheets);
    let mut root = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\
         <office:document-content \
         xmlns:office=\"urn:oasis:names:tc:opendocument:xmlns:office:1.0\" \
         xmlns:style=\"urn:oasis:names:tc:opendocument:xmlns:style:1.0\" \
         xmlns:fo=\"urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0\" \
         xmlns:table=\"urn:oasis:names:tc:opendocument:xmlns:table:1.0\" \
         xmlns:text=\"urn:oasis:names:tc:opendocument:xmlns:text:1.0\"",
    );
    if ns.dc {
        root.push_str(" xmlns:dc=\"http://purl.org/dc/elements/1.1/\"");
    }
    if ns.svg {
        root.push_str(" xmlns:svg=\"urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0\"");
    }
    if ns.xlink {
        root.push_str(" xmlns:xlink=\"http://www.w3.org/1999/xlink\"");
    }
    root.push_str(" office:version=\"1.2\"><office:automatic-styles>");
    let mut content = root;
    content.push_str(&styles_xml);
    content.push_str(&dim_xml);
    content.push_str(
        "</office:automatic-styles><office:body><office:spreadsheet>",
    );
    for sheet in &workbook.sheets {
        render_sheet(sheet, &style_names, &col_reg, &row_reg, &mut content);
    }
    content.push_str("</office:spreadsheet></office:body></office:document-content>");

    let styles = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\
         <office:document-styles \
         xmlns:office=\"urn:oasis:names:tc:opendocument:xmlns:office:1.0\" \
         xmlns:config=\"urn:oasis:names:tc:opendocument:xmlns:config:1.0\" \
         xmlns:style=\"urn:oasis:names:tc:opendocument:xmlns:style:1.0\" \
         xmlns:fo=\"urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0\" \
         office:version=\"1.2\">{}\
         <office:styles>{}\
         <style:style style:name=\"Default\" style:family=\"table-cell\"/>\
         </office:styles></office:document-styles>",
        settings_xml(&workbook.sheets).unwrap_or_default(),
        default_style_xml(workbook.default_font.as_ref())
    );
    (content, styles)
}

/// 工作簿默认字体落回 `<style:default-style style:family="table-cell">`（读侧 ods_default_font_of 的镜像）。
/// 载荷没说话就不写这一层——ODF 里没有"我们兜底的那一档"这回事，凭空落笔就是替文件声明了它没说过的字族字号；
/// 而文件说了的（哪怕正好像 Calibri/11）就照写，这里不做 xlsx 那种"与隐式底数同档就省掉"的归一，
/// 因为 ODS 这一路没有 crate 的隐式底数，这一层就是我们唯一的底。
/// 位置有讲究：ODF 的 `office:styles` 里 default-style 排在具名 style 之前
fn default_style_xml(df: Option<&DefaultFont>) -> String {
    let Some(df) = df else { return String::new() };
    let mut props = String::new();
    if let Some(ff) = df.ff.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
        // 双属性照格级同一写法：style:font-name 是 ODF 自家的，fo:font-family 是 XSL-FO 兼容道
        props.push_str(&format!(
            " style:font-name=\"{ff}\" fo:font-family=\"{ff}\"",
            ff = esc_attr(ff)
        ));
    }
    if let Some(fs) = df.fs {
        props.push_str(&format!(" fo:font-size=\"{fs}pt\""));
    }
    if props.is_empty() {
        return String::new();
    }
    format!(
        "<style:default-style style:family=\"table-cell\"><style:text-properties{props}/></style:default-style>"
    )
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
pub async fn write_ods(path: String, workbook: WorkbookPayload) -> Result<Vec<String>, Error> {
    crate::xlsx::to_blocking(move || write_ods_sync(path, workbook)).await
}

/// 存盘并带回写侧的边界账（与 `write_xlsx_sync` 同一条契约）：这一趟摆不下的批注与链接
/// 要在状态栏说得出，不能报"已保存"而让文件里少东西
pub fn write_ods_sync(path: String, workbook: WorkbookPayload) -> Result<Vec<String>, Error> {
    if let Some(parent) = Path::new(&path).parent() {
        if !parent.exists() {
            return Err(Error(format!("目录不存在: {}", parent.display())));
        }
    }
    let accounts = ods_side_accounts(&workbook.sheets);
    let bytes = ods_bytes(&workbook)?;
    std::fs::write(&path, bytes).map_err(io_err)?;
    Ok(accounts)
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
    fn odf_formula_syntax_converts() {
        assert_eq!(
            xlsx_to_odf_formula("=SUM(A1:B2,C1)"),
            "of:=SUM([.A1:.B2];[.C1])"
        );
        assert_eq!(
            xlsx_to_odf_formula("=IF(A1<B2,1,0)"),
            "of:=IF([.A1]<[.B2];1;0)"
        );
        // 字符串字面量内的逗号/引用样文本不换算
        assert_eq!(
            xlsx_to_odf_formula("=CONCAT(A1,\"x,y\")"),
            "of:=CONCAT([.A1];\"x,y\")"
        );
        // 跨表引用（简名）
        assert_eq!(
            xlsx_to_odf_formula("=Sheet2.A1+1"),
            "of:=[.Sheet2.A1]+1"
        );
        assert_eq!(
            odf_to_xlsx_formula("of:=SUM([.A1:.A2];1;0)"),
            "SUM(A1:A2,1,0)"
        );
        assert_eq!(
            odf_to_xlsx_formula("of:=IF([.A1]<[.B2];1;0)"),
            "IF(A1<B2,1,0)"
        );
        assert_eq!(
            odf_to_xlsx_formula("of:=[.Sheet2.A1:.A3]"),
            "Sheet2.A1:A3"
        );
        assert_eq!(
            odf_to_xlsx_formula("of:=[.'My Sheet.A1]"),
            "'My Sheet'.A1"
        );
    }

    #[test]
    fn ods_formula_roundtrip() {
        let wb = WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "算".into(),
                cells: vec![
                    cell(0, 0, json!(10)),
                    cell(1, 0, json!(32)),
                    CellPayload {
                        r: 0,
                        c: 1,
                        v: Some(json!(42)),
                        f: Some("=A1+A2".into()),
                        ..Default::default()
                    },
                    CellPayload {
                        r: 1,
                        c: 1,
                        v: Some(json!(1)),
                        f: Some("=IF(A1<A2,1,0)".into()),
                        ..Default::default()
                    },
                    CellPayload {
                        r: 2,
                        c: 1,
                        v: None,
                        f: Some("=SUM(A1:B1)".into()),
                        ..Default::default()
                    },
                ],
                ..Default::default()
            }],
            ..Default::default()
        };
        let path = std::env::temp_dir()
            .join(format!("openoffices-ods-f-{}.ods", std::process::id()))
            .to_string_lossy()
            .to_string();
        std::fs::write(&path, ods_bytes(&wb).expect("ods bytes")).expect("write");
        let back = crate::xlsx::read_xlsx_sync(path.clone()).expect("读回失败");
        std::fs::remove_file(&path).ok();
        let sheet = &back.sheets[0];
        let find = |r: u32, c: u32| sheet.cells.iter().find(|x| x.r == r && x.c == c);
        assert_eq!(
            find(0, 1).and_then(|x| x.f.as_deref()),
            Some("=A1+A2"),
            "公式往返"
        );
        assert_eq!(find(0, 1).and_then(|x| x.v.as_ref()), Some(&json!(42)), "缓存值");
        assert_eq!(
            find(1, 1).and_then(|x| x.f.as_deref()),
            Some("=IF(A1<A2,1,0)"),
            "含 < 比较式经属性转义往返"
        );
        assert_eq!(
            find(2, 1).and_then(|x| x.f.as_deref()),
            Some("=SUM(A1:B1)"),
            "区间式往返"
        );
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
                ..Default::default()
            }],
            ..Default::default()
        };
        let path = std::env::temp_dir()
            .join(format!("openoffices-ods-{}.ods", std::process::id()))
            .to_string_lossy()
            .to_string();
        let bytes = ods_bytes(&wb).expect("ods bytes");
        std::fs::write(&path, bytes).expect("write");
        let back = crate::xlsx::read_xlsx_sync(path.clone()).expect("calamine 读回失败");
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
    fn ods_hidden_and_freeze_roundtrip() {
        use crate::xlsx::Freeze;
        let wb = WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "隐藏".into(),
                cells: vec![cell(0, 0, json!("标题")), cell(3, 3, json!("数据"))],
                // 列 1 隐藏且带宽度（"{px}|1" 复合样式），列 2 只隐藏（"h|1" 哨兵）
                col_widths: HashMap::from([(1, 140.0)]),
                hidden_cols: vec![1, 2],
                // 行 2 隐藏且带高度，行 3 只隐藏
                row_heights: HashMap::from([(2, 32.0)]),
                hidden_rows: vec![2, 3],
                freeze: Some(Freeze { rows: 1, cols: 0 }),
                ..Default::default()
            }],
            ..Default::default()
        };
        let path = std::env::temp_dir()
            .join(format!("openoffices-ods-hid-{}.ods", std::process::id()))
            .to_string_lossy()
            .to_string();
        std::fs::write(&path, ods_bytes(&wb).expect("ods bytes")).expect("write");
        let back = crate::xlsx::read_xlsx_sync(path.clone()).expect("读回失败");
        std::fs::remove_file(&path).ok();

        let s = &back.sheets[0];
        assert_eq!(s.hidden_cols, vec![1, 2], "隐藏列（含带宽度复合样式）");
        assert_eq!(s.hidden_rows, vec![2, 3], "隐藏行（含带高度复合样式）");
        assert_eq!(s.col_widths.get(&1), Some(&140.0), "隐藏列宽度保留");
        assert_eq!(s.row_heights.get(&2), Some(&32.0), "隐藏行高度保留");
        assert!(
            matches!(s.freeze, Some(f) if f.rows == 1 && f.cols == 0),
            "冻结窗格经 settings.xml 往返"
        );
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
                ..Default::default()
            }],
            ..Default::default()
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
    fn odf_border_values_map_back() {
        let s = border_side_from_odf("0.5pt solid #000000").expect("solid");
        assert_eq!(s.s.as_deref(), Some("thin"));
        assert_eq!(s.c.as_deref(), Some("#000000"));
        assert_eq!(
            border_side_from_odf("0.26pt solid #000000").and_then(|x| x.s),
            Some("thin".into()),
            "LibreOffice 默认细线归入 thin"
        );
        let m = border_side_from_odf("1.5pt solid #3366cc").expect("medium");
        assert_eq!((m.s.as_deref(), m.c.as_deref()), (Some("medium"), Some("#3366cc")));
        let d = border_side_from_odf("0.5pt dashed").expect("dashed");
        assert_eq!((d.s.as_deref(), d.c.as_deref()), (Some("dashed"), None));
        assert_eq!(border_side_from_odf("0.1pt solid").and_then(|x| x.s), Some("hair".into()));
        assert_eq!(border_side_from_odf("0.5pt double #ff0000").and_then(|x| x.s), Some("double".into()));
        assert!(border_side_from_odf("").is_none());
    }

    #[test]
    fn ods_style_merge_readback() {
        let wb = WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "样式".into(),
                cells: vec![
                    CellPayload {
                        r: 0,
                        c: 0,
                        v: Some(json!("边框居中")),
                        s: Some(CellStyle {
                            bd: Some(CellBorder {
                                t: Some(BorderSide { s: Some("thin".into()), c: None }),
                                r: None,
                                b: Some(BorderSide { s: Some("dashed".into()), c: None }),
                                l: Some(BorderSide { s: Some("medium".into()), c: Some("#3366cc".into()) }),
                            }),
                            ho: Some("center".into()),
                            vo: Some("middle".into()),
                            ..Default::default()
                        }),
                        ..Default::default()
                    },
                    CellPayload {
                        r: 1,
                        c: 0,
                        v: Some(json!(7)),
                        s: Some(CellStyle {
                            bl: true,
                            bg: Some("#ffff00".into()),
                            wb: true,
                            ..Default::default()
                        }),
                        ..Default::default()
                    },
                    CellPayload {
                        r: 3,
                        c: 0,
                        v: Some(json!("合并区")),
                        s: Some(CellStyle {
                            it: true,
                            ..Default::default()
                        }),
                        ..Default::default()
                    },
                ],
                merges: vec![MergeRange {
                    start_row: 3,
                    start_column: 0,
                    end_row: 4,
                    end_column: 1,
                }],
                charts: vec![],
                ..Default::default()
            }],
            ..Default::default()
        };
        let path = std::env::temp_dir()
            .join(format!("openoffices-odsfmt-{}.ods", std::process::id()))
            .to_string_lossy()
            .to_string();
        std::fs::write(&path, ods_bytes(&wb).expect("ods bytes")).expect("write");
        let back = crate::xlsx::read_xlsx_sync(path.clone()).expect("read_xlsx 读回失败");
        std::fs::remove_file(&path).ok();

        let sheet = &back.sheets[0];
        let find = |r: u32, c: u32| sheet.cells.iter().find(|x| x.r == r && x.c == c);
        let st0 = find(0, 0).and_then(|x| x.s.clone()).expect("A1 样式读回");
        let bd = st0.bd.expect("A1 边框");
        assert_eq!(bd.t.as_ref().and_then(|x| x.s.as_deref()), Some("thin"));
        assert_eq!(bd.b.as_ref().and_then(|x| x.s.as_deref()), Some("dashed"));
        assert_eq!(bd.l.as_ref().and_then(|x| x.s.as_deref()), Some("medium"));
        assert_eq!(bd.l.as_ref().and_then(|x| x.c.as_deref()), Some("#3366cc"));
        assert_eq!(st0.ho.as_deref(), Some("center"));
        assert_eq!(st0.vo.as_deref(), Some("middle"));
        let st1 = find(1, 0).and_then(|x| x.s.clone()).expect("A2 样式读回");
        assert!(st1.bl && st1.wb);
        assert_eq!(st1.bg.as_deref(), Some("#ffff00"));
        assert_eq!(find(3, 0).and_then(|x| x.s.clone()).map(|s| s.it), Some(true));
        assert_eq!(
            sheet.merges,
            vec![MergeRange { start_row: 3, start_column: 0, end_row: 4, end_column: 1 }],
            "ODS 合并区读回"
        );
    }

    #[test]
    fn odf_len_to_px_converts() {
        assert_eq!(odf_len_to_px("2.26cm"), Some(85.0)); // 85px ≈ 2.26cm
        assert_eq!(odf_len_to_px("12pt"), Some(16.0));
        assert_eq!(odf_len_to_px("1in"), Some(96.0));
        assert_eq!(odf_len_to_px("10mm"), Some(38.0));
        assert_eq!(odf_len_to_px("80px"), Some(80.0));
        assert_eq!(odf_len_to_px("auto"), None);
        assert_eq!(odf_len_to_px("3em"), None);
    }

    #[test]
    fn ods_dimensions_and_font_readback() {
        let wb = WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "尺寸".into(),
                cells: vec![CellPayload {
                    r: 0,
                    c: 1,
                    v: Some(json!("宋体宽列")),
                    s: Some(CellStyle {
                        ff: Some("宋体".into()),
                        ..Default::default()
                    }),
                    ..Default::default()
                }],
                merges: vec![],
                charts: vec![],
                col_widths: [(0u32, 140.0), (1u32, 140.0)].into_iter().collect(),
                row_heights: [(0u32, 32.0)].into_iter().collect(),
                ..Default::default()
            }],
            ..Default::default()
        };
        let path = std::env::temp_dir()
            .join(format!("openoffices-odsdim-{}.ods", std::process::id()))
            .to_string_lossy()
            .to_string();
        std::fs::write(&path, ods_bytes(&wb).expect("ods bytes")).expect("write");
        let back = crate::xlsx::read_xlsx_sync(path.clone()).expect("读回失败");
        std::fs::remove_file(&path).ok();
        let sheet = &back.sheets[0];
        assert_eq!(sheet.col_widths.get(&0), Some(&140.0), "cm 往返列宽");
        assert_eq!(sheet.col_widths.get(&1), Some(&140.0), "同宽列并入 repeated");
        assert_eq!(sheet.row_heights.get(&0), Some(&32.0), "行高往返");
        let ff = sheet
            .cells
            .iter()
            .find(|x| x.r == 0 && x.c == 1)
            .and_then(|x| x.s.as_ref())
            .and_then(|s| s.ff.clone());
        assert_eq!(ff.as_deref(), Some("宋体"), "字体族经 style:font-name 读回");
    }

    /// 从内存里的 ODS 字节取出 styles.xml 的字面（写侧判别用的是字节，不是"读得回来"）
    fn styles_of(bytes: &[u8]) -> String {
        use std::io::Read;
        let mut z = zip::ZipArchive::new(Cursor::new(bytes.to_vec())).expect("zip 可解");
        let mut s = String::new();
        z.by_name("styles.xml")
            .expect("styles.xml")
            .read_to_string(&mut s)
            .expect("读成串");
        s
    }

    /// 从内存里的 ODS 字节取出 content.xml 的字面（批注与链接的判别要看在件里的位置和形状，
    /// 光"读得回来"证明不了顺序合规）
    fn content_of(bytes: &[u8]) -> String {
        use std::io::Read;
        let mut z = zip::ZipArchive::new(Cursor::new(bytes.to_vec())).expect("zip 可解");
        let mut s = String::new();
        z.by_name("content.xml")
            .expect("content.xml")
            .read_to_string(&mut s)
            .expect("读成串");
        s
    }

    /// 把一枚 `<style:default-style>` 摆进真的 styles.xml 骨架里再读（部件级判别，不是属性级）
    fn default_of(family: &str, body: &str) -> Option<DefaultFont> {
        let xml = format!(
            "<office:document-styles><office:styles><style:default-style style:family=\"{family}\">{body}</style:default-style></office:styles></office:document-styles>"
        );
        ods_default_font_of(&xml)
    }

    /// 读侧的判别全部按"形状"来出，而不是按字符串包含：
    /// 只认 table-cell 那一支、字族**不归一化**（格级那把尺子会丢掉 Calibri/等线，这一层丢掉就是换字族）、
    /// 磅字面不漂、非磅的那一档才经长度换算
    #[test]
    fn ods_default_style_reads_only_the_table_cell_branch() {
        assert_eq!(
            default_of(
                "table-cell",
                r#"<style:text-properties style:font-name="宋体" fo:font-family="宋体" fo:font-size="14pt"/>"#
            ),
            Some(DefaultFont { ff: Some("宋体".into()), fs: Some(14.0) }),
            "两条字族属性取一，磅字面直读"
        );
        assert_eq!(
            default_of(
                "text",
                r#"<style:text-properties fo:font-size="14pt"/>"#
            ),
            None,
            "段落那一支的字号不是表格的默认字体"
        );
        assert_eq!(
            default_of("table-cell", ""),
            None,
            "那一支在但什么都没说 = 没说话"
        );
        assert_eq!(
            default_of("table-cell", r#"<style:text-properties fo:font-family="Liberation Sans"/>"#).map(|d| d.ff),
            Some(Some("Liberation Sans".into())),
            "只走 XSL-FO 兼容道也认"
        );
        assert_eq!(
            default_of("table-cell", r#"<style:text-properties fo:font-size="12pt"/>"#).map(|d| d.ff),
            Some(None),
            "只说字号时不许凭空造一层字族"
        );
        for name in ["等线", "Calibri"] {
            assert_eq!(
                default_of(
                    "table-cell",
                    &format!(r#"<style:text-properties style:font-name="{name}" fo:font-size="11pt"/>"#)
                )
                .map(|d| d.ff),
                Some(Some(name.into())),
                "这一层不归一化：格级丢掉这两档是为了别把通用档当真名，这里抹掉就是换字族"
            );
        }
        assert_eq!(
            default_of(
                "table-cell",
                r#"<style:table-cell-properties fo:font-size="20pt" style:font-name="黑体"/>"#
            ),
            None,
            "字号只从 text-properties 取，兄弟元素上的不算"
        );
        assert_eq!(
            ods_default_font_of(
                r#"<office:styles><style:style style:name="Default" style:family="table-cell"><style:text-properties fo:font-size="20pt"/></style:style></office:styles>"#
            ),
            None,
            "具名样式那一层不是工作簿默认（default-style 才算）"
        );
        assert_eq!(
            ods_default_font_of(
                r#"<office:styles><style:default-style style:family="table-cell"/><style:default-style style:family="text"><style:text-properties fo:font-size="20pt"/></style:default-style></office:styles>"#
            ),
            None,
            "自闭合的那一支没有孩子，不许把后面那一支的字号算到它头上"
        );
        assert_eq!(
            default_of("table-cell", r#"<style:text-properties fo:font-size="17.5pt"/>"#).map(|d| d.fs),
            Some(Some(17.5)),
            "磅字面过了换算就要在字节上漂一档，故不换算"
        );
        assert_eq!(
            default_of("table-cell", r#"<style:text-properties fo:font-size="0.42cm"/>"#).map(|d| d.fs),
            Some(Some(12.0)),
            "真不是磅的那一档才走长度换算（0.42cm→16px→12pt）"
        );
        assert_eq!(
            default_of("table-cell", r#"<style:text-properties fo:font-size="0pt"/>"#).map(|d| d.fs),
            Some(Some(0.0)),
            "荒谬值在这一处不拦，由唯一的消费点兜（与 xlsx 那一路同一分寸）"
        );
        assert_eq!(
            ods_default_font_of(
                r#"<office:styles>\
                   <style:default-style style:family="table-row"><style:table-row-properties style:row-height="0.45cm" style:use-optimal-row-height="true"/></style:default-style>\
                   <style:default-style style:family="table-cell"><style:text-properties fo:font-size="14pt"/></style:default-style>\
                 </office:styles>"#
            )
            .map(|d| d.fs),
            Some(Some(14.0)),
            "行高那一支先出现也不许抢这一层（且 row-height 不是字号）"
        );
    }

    /// 写侧落回同一层：载荷说话才写、位置在具名样式之前、存两趟不许丢
    #[test]
    fn ods_default_font_lands_in_styles_and_reads_back() {
        let wb = WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "默认".into(),
                cells: vec![cell(0, 0, json!("正文"))],
                ..Default::default()
            }],
            default_font: Some(DefaultFont {
                ff: Some("宋体".into()),
                fs: Some(14.0),
            }),
            ..Default::default()
        };
        let bytes = ods_bytes(&wb).expect("ods bytes");
        let sx = styles_of(&bytes);
        assert!(
            sx.contains(r#"<style:default-style style:family="table-cell">"#),
            "这一层要落进 styles.xml: {sx}"
        );
        assert!(sx.contains(r#"fo:font-size="14pt""#), "磅字面落纸: {sx}");
        assert!(
            sx.find("style:default-style")
                .zip(sx.find(r#"style:name="Default""#))
                .map(|(d, n)| d < n)
                == Some(true),
            "ODF 的 office:styles 里 default-style 排在具名样式之前"
        );

        let path = std::env::temp_dir()
            .join(format!("openoffices-odsdef-{}.ods", std::process::id()))
            .to_string_lossy()
            .to_string();
        std::fs::write(&path, &bytes).expect("write");
        let back = crate::xlsx::read_xlsx_sync(path.clone()).expect("读回失败");
        assert_eq!(
            back.default_font,
            Some(DefaultFont { ff: Some("宋体".into()), fs: Some(14.0) }),
            "读回来还是文件那一层说的"
        );
        // 第二趟：读回再写，这一层不许在往返里掉
        let again = ods_bytes(&back).expect("第二次写");
        assert!(
            styles_of(&again).contains(r#"fo:font-size="14pt""#),
            "存两趟之后磅字面还在"
        );
        std::fs::remove_file(&path).ok();
    }

    /// 反面守卫：载荷没说就不能造这一层——凭空落笔就是替文件声明了它没说过的字族字号
    #[test]
    fn ods_without_default_font_declares_nothing() {
        let wb = WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "没说话".into(),
                cells: vec![cell(0, 0, json!("值"))],
                ..Default::default()
            }],
            ..Default::default()
        };
        let bytes = ods_bytes(&wb).expect("ods bytes");
        assert!(
            !styles_of(&bytes).contains("default-style"),
            "载荷没给这一层就不许写它"
        );
        let path = std::env::temp_dir()
            .join(format!("openoffices-odsdef-none-{}.ods", std::process::id()))
            .to_string_lossy()
            .to_string();
        std::fs::write(&path, bytes).expect("write");
        let back = crate::xlsx::read_xlsx_sync(path.clone()).expect("读回失败");
        std::fs::remove_file(&path).ok();
        assert_eq!(back.default_font, None, "自产物不该读出一层文件里没有的默认");
    }

    /// 只换 content.xml 的测试件：把 ODF 规则的形状摆进本应用写出的那一份里
    fn zip_ods(content: &str, styles: &str) -> Vec<u8> {
        let mut zw = ZipWriter::new(Cursor::new(Vec::new()));
        let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        let deflated = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        zw.start_file("mimetype", stored).unwrap();
        zw.write_all(b"application/vnd.oasis.opendocument.spreadsheet")
            .unwrap();
        zw.start_file("META-INF/manifest.xml", deflated).unwrap();
        zw.write_all(manifest_xml().as_bytes()).unwrap();
        zw.start_file("content.xml", deflated).unwrap();
        zw.write_all(content.as_bytes()).unwrap();
        zw.start_file("styles.xml", deflated).unwrap();
        zw.write_all(styles.as_bytes()).unwrap();
        zw.finish().unwrap().into_inner()
    }

    #[test]
    fn ods_rule_boundaries_are_accounted() {
        let wb = WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "数据".into(),
                cells: vec![
                    cell(0, 0, json!("月份")),
                    cell(0, 1, json!("销量")),
                    cell(1, 0, json!("一月")),
                    cell(1, 1, json!(10)),
                ],
                ..Default::default()
            }],
            ..Default::default()
        };

        // 对照组：我们自己写出的 ODS 不该凭空记出规则账（每次都记等于把状态栏变成噪音）
        let own = std::env::temp_dir()
            .join(format!("openoffices-ods-own-{}.ods", std::process::id()))
            .to_string_lossy()
            .to_string();
        std::fs::write(&own, ods_bytes(&wb).expect("ods bytes")).expect("write");
        let back = crate::xlsx::read_xlsx_sync(own.clone()).expect("读回失败");
        std::fs::remove_file(&own).ok();
        assert!(back.warnings.is_empty(), "自产物不该有规则账: {:?}", back.warnings);

        // 别人写的件：三样都在，打开这一趟就要逐样说得出，而不是安静地少给
        let (mut content, styles) = ods_xml(&wb);
        content = content.replace(
            "</office:automatic-styles>",
            "<table:conditional-format table:target-sheet=\".\" table:target-range-address=\"数据.A1:数据.B2\">\
             <table:condition table:name=\"c1\" table:apply-style-name=\"ce1\" table:test=\"[.B2]&gt;5\"/>\
             </table:conditional-format>\
             <table:content-validations>\
             <table:content-validation table:name=\"v1\" table:type=\"xs:double\" table:operator=\"top\" table:allow-empty=\"false\" table:formula=\"true()\"/>\
             </table:content-validations></office:automatic-styles>",
        );
        content = content.replace(
            "<table:table table:name=\"数据\">",
            "<table:table table:name=\"数据\"><table:database-ranges>\
             <table:database-range table:name=\"自动筛选0\" table:target-range-address=\"数据.A1:数据.B2\" table:display-filter-buttons=\"true\"/>\
             </table:database-ranges>",
        );
        let path = std::env::temp_dir()
            .join(format!("openoffices-ods-rules-{}.ods", std::process::id()))
            .to_string_lossy()
            .to_string();
        std::fs::write(&path, zip_ods(&content, &styles)).expect("write");
        let back = crate::xlsx::read_xlsx_sync(path.clone()).expect("带规则标签的 ODS 读回失败");
        std::fs::remove_file(&path).ok();

        let notes = back.warnings.join("|");
        assert!(notes.contains("筛选"), "筛选账要说得出: {notes}");
        assert!(notes.contains("数据验证"), "数据验证账要说得出: {notes}");
        assert!(notes.contains("条件格式"), "条件格式账要说得出: {notes}");
        assert_eq!(notes.matches("ODS 里的").count(), 3, "三类各一条，不重复记");
        // 记账不能把值也一并吞掉：规则读不懂，字还得照常出
        let s = &back.sheets[0];
        let at = |r: u32, c: u32| {
            s.cells
                .iter()
                .find(|x| x.r == r && x.c == c)
                .and_then(|x| x.v.clone())
        };
        assert_eq!(at(0, 0), Some(json!("月份")));
        assert_eq!(at(1, 1), Some(json!(10)));
        assert_eq!(s.name, "数据");
    }

    /// 别人写的件：批注与链接都住在格子自身里，读侧要逐味收准——
    /// 位置、作者、多段正文、气泡尺寸与「常开」那一枚开关、外部地址、表内跳转、悬停提示
    #[test]
    fn ods_notes_and_links_read_from_anothers_file() {
        let wb = WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "数据".into(),
                cells: vec![
                    cell(0, 0, json!("月份")),
                    cell(0, 1, json!("销量")),
                    cell(1, 0, json!("一月")),
                    cell(1, 1, json!(10)),
                    cell(2, 0, json!("二月")),
                    cell(2, 1, json!(20)),
                ],
                ..Default::default()
            }],
            ..Default::default()
        };
        let (mut content, styles) = ods_xml(&wb);
        content = content.replace(
            "office:version=\"1.2\"><office:automatic-styles>",
            "xmlns:dc=\"http://purl.org/dc/elements/1.1/\" \
             xmlns:xlink=\"http://www.w3.org/1999/xlink\" \
             xmlns:svg=\"urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0\" \
             office:version=\"1.2\"><office:automatic-styles>",
        );
        // 批注排在正文 <text:p> 之前（这是 ODF 的子元素顺序），作者与日期各住各的层
        content = content.replace(
            "<text:p>月份</text:p>",
            "<office:annotation office:display=\"true\" svg:width=\"2.26cm\" svg:height=\"1.91cm\">\
             <dc:creator>张三</dc:creator><dc:date>2026-09-29T10:00:00</dc:date>\
             <text:p>这里要复核</text:p><text:p>第二行</text:p></office:annotation>\
             <text:p>月份</text:p>",
        );
        // 只有正文的批注：作者、尺寸与常开都缺席。批注里的链接只贡献它自己的显示文字，不算格子链接
        content = content.replace(
            "<text:p>销量</text:p>",
            "<office:annotation><text:p>看<text:a xlink:type=\"simple\" \
             xlink:href=\"https://ok.example/x\">说明</text:a></text:p></office:annotation>\
             <text:p>销量</text:p>",
        );
        // 外部地址：协议名在、& 转义要解一次、悬停提示走 office:title
        content = content.replace(
            "<text:p>一月</text:p>",
            "<text:p><text:a xlink:type=\"simple\" xlink:href=\"https://example.com/a?x=1&amp;y=2\" \
             office:title=\"例子\">一月</text:a></text:p>",
        );
        // 表内跳转的两种真实写法：#表名.格 与 .#表名.$格$（绝对引用的 $ 读时剥掉）
        content = content.replace(
            "<text:p>10</text:p>",
            "<text:p><text:a xlink:type=\"simple\" xlink:href=\"#数据.A1\">10</text:a></text:p>",
        );
        content = content.replace(
            "<text:p>二月</text:p>",
            "<text:p><text:a xlink:type=\"simple\" xlink:href=\".#数据.$B$3\">二月</text:a></text:p>",
        );
        // display="false" 与缺席同一档（ODF 的缺省就是不常开），不许读成一枚说了话的 false
        content = content.replace(
            "<text:p>20</text:p>",
            "<office:annotation office:display=\"false\"><text:p>收起的</text:p></office:annotation>\
             <text:p>20</text:p>",
        );
        let path = std::env::temp_dir()
            .join(format!("openoffices-ods-read-{}.ods", std::process::id()))
            .to_string_lossy()
            .to_string();
        std::fs::write(&path, zip_ods(&content, &styles)).expect("write");
        let back = crate::xlsx::read_xlsx_sync(path.clone()).expect("带批注与链接的 ODS 读回失败");
        std::fs::remove_file(&path).ok();

        let acct = back.warnings.join("|");
        assert!(
            !acct.contains("批注") && !acct.contains("链接"),
            "两样都已真读，旧的两条「暂未读入」必须消失: {acct}"
        );
        assert_eq!(acct.matches("ODS 里的").count(), 0, "这一趟没有账: {acct}");

        let s = &back.sheets[0];
        let note_at = |r: u32, c: u32| s.notes.iter().find(|n| n.r == r && n.c == c);
        let link_at = |r: u32, c: u32| s.links.iter().find(|l| l.r == r && l.c == c);

        let n = note_at(0, 0).expect("(0,0) 的批注要收进来");
        assert_eq!(n.text, "这里要复核\n第二行", "多段正文用换行相连");
        assert_eq!(n.author.as_deref(), Some("张三"));
        assert_eq!(n.width, Some(85.0), "2.26cm 落像素");
        assert_eq!(n.height, Some(72.0), "1.91cm 落像素");
        assert_eq!(n.show, Some(true));
        let n = note_at(0, 1).expect("(0,1) 的批注只有正文也要收");
        assert_eq!(n.text, "看说明", "批注里的链接只贡献它的显示文字");
        assert_eq!(n.author, None, "没写 dc:creator 就不许凭空造一层作者");
        assert_eq!((n.width, n.height, n.show), (None, None, None));
        assert_eq!(
            note_at(2, 1).map(|n| (n.text.as_str(), n.show)),
            Some(("收起的", None)),
            "display=false 该读成缺席"
        );
        assert!(note_at(1, 0).is_none() && note_at(1, 1).is_none() && note_at(2, 0).is_none());

        assert_eq!(s.links.len(), 3, "格子链接只收格内的 text:a: {:?}", s.links);
        assert!(link_at(0, 1).is_none(), "批注里的链接不是格子链接");
        let l = link_at(1, 0).expect("外部地址要收");
        assert_eq!(l.url.as_deref(), Some("https://example.com/a?x=1&y=2"), "实体解一次");
        assert_eq!(l.tip.as_deref(), Some("例子"));
        assert_eq!(l.location, None);
        assert_eq!(link_at(1, 1).and_then(|l| l.location.as_deref()), Some("数据!A1"));
        assert_eq!(
            link_at(2, 0).and_then(|l| l.location.as_deref()),
            Some("数据!B3"),
            ".#表名.$格$ 与绝对引用的 $ 都要认"
        );
        assert_eq!(link_at(1, 1).and_then(|l| l.url.clone()), None, "表内跳转不硬派成 url");

        let at = |r: u32, c: u32| {
            s.cells
                .iter()
                .find(|x| x.r == r && x.c == c)
                .and_then(|x| x.v.clone())
        };
        assert_eq!(at(0, 0), Some(json!("月份")), "批注的字不许渗进正文");
        assert_eq!(at(0, 1), Some(json!("销量")));
        assert_eq!(at(1, 0), Some(json!("一月")), "链接的字照常出");
        assert_eq!(at(1, 1), Some(json!(10)), "批注与链接都不许挪动数值");
        assert_eq!(at(2, 1), Some(json!(20)));
    }

    /// 写侧的字面判别（不只是"读得回来"）：批注长在格子身上且排在正文之前、内部跳转按 §9.2.1
    /// 的 `#表名.格` 落笔、用到的命名空间才声明；然后再走真件那一趟（存 → 读 → 再存），
    /// 确认第二次存盘还在而不是把这一层读丢了
    #[test]
    fn ods_notes_and_links_land_in_content_and_read_back() {
        let wb = WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "数据".into(),
                cells: vec![
                    cell(0, 0, json!("月份")),
                    cell(0, 1, json!("销量")),
                    cell(1, 0, json!("一月")),
                    cell(3, 0, json!("跳转")),
                ],
                notes: vec![CellNotePayload {
                    r: 0,
                    c: 0,
                    text: "这里要复核\n第二行".into(),
                    author: Some("张三".into()),
                    width: Some(128.0),
                    height: Some(74.0),
                    show: Some(true),
                }],
                links: vec![
                    CellLinkPayload {
                        r: 0,
                        c: 1,
                        url: Some("https://example.com/a?x=1&y=2".into()),
                        tip: Some("例子 & 说明".into()),
                        ..Default::default()
                    },
                    CellLinkPayload {
                        r: 3,
                        c: 0,
                        location: Some("数据!B9".into()),
                        ..Default::default()
                    },
                ],
                ..Default::default()
            }],
            ..Default::default()
        };
        let content = content_of(&ods_bytes(&wb).expect("ods bytes"));

        // 顺序：批注必须在格子的开标签之后、正文 <text:p> 之前（ODF 的子元素顺序，写反了就是不合规的件）
        let open = content.find("<table:table-cell").expect("格子");
        let annot = content.find("<office:annotation").expect("批注要落进字节");
        let body = content.find("<text:p>月份</text:p>").expect("正文");
        assert!(
            open < annot && annot < body,
            "批注要排在正文之前: open={open} annot={annot} body={body}"
        );
        assert!(content.contains("office:display=\"true\""), "常开那枚开关要落笔");
        assert!(
            content.contains("<dc:creator>张三</dc:creator>"),
            "作者走 dc:creator"
        );
        assert!(
            content.contains("<text:p>这里要复核</text:p><text:p>第二行</text:p>"),
            "多段正文一段一条 text:p"
        );
        assert!(
            content.contains("svg:width=\"3.3867cm\"") && content.contains("svg:height=\"1.9579cm\""),
            "气泡尺寸按 px→cm 落字节（单位必带）: {content}"
        );
        // 载荷的 "表名!A1" 是我们的约定，件里得写成 ODF 的内部地址
        assert!(
            content.contains("xlink:href=\"#数据.B9\""),
            "location 折成 #表名.格: {content}"
        );
        assert!(
            content.contains("xlink:href=\"https://example.com/a?x=1&amp;y=2\""),
            "地址里的 & 要转义"
        );
        assert!(content.contains("office:title=\"例子 &amp; 说明\""), "提示走 office:title");
        for ns in ["xmlns:dc=", "xmlns:svg=", "xmlns:xlink="] {
            assert!(content.contains(ns), "用到的命名空间得声明: {ns}");
        }

        // 真件那一趟：存 → 读 → 再存，这一层两头都得在
        let first = std::env::temp_dir()
            .join(format!("openoffices-ods-side-{}.ods", std::process::id()))
            .to_string_lossy()
            .to_string();
        std::fs::write(&first, ods_bytes(&wb).expect("ods bytes")).expect("write");
        let back = crate::xlsx::read_xlsx_sync(first.clone()).expect("读回失败");
        std::fs::remove_file(&first).ok();

        assert_eq!(
            back.warnings.iter().filter(|w| w.contains("ODS 里的")).count(),
            0,
            "自家产物不该记出账: {:?}",
            back.warnings
        );
        let s = &back.sheets[0];
        let n = s.notes.iter().find(|x| x.r == 0 && x.c == 0).expect("(0,0) 的批注");
        assert_eq!(n.text, "这里要复核\n第二行");
        assert_eq!(n.author.as_deref(), Some("张三"));
        assert_eq!(
            (n.width, n.height, n.show),
            (Some(128.0), Some(74.0), Some(true)),
            "尺寸往返同一档（cm 四位小数不漂）"
        );
        let l = s.links.iter().find(|x| x.r == 0 && x.c == 1).expect("(0,1) 的链接");
        assert_eq!(l.url.as_deref(), Some("https://example.com/a?x=1&y=2"));
        assert_eq!(l.tip.as_deref(), Some("例子 & 说明"));
        let l = s.links.iter().find(|x| x.r == 3 && x.c == 0).expect("(3,0) 的链接");
        assert_eq!(l.location.as_deref(), Some("数据!B9"));
        assert_eq!(l.url, None, "内部跳转不许读成外部地址");

        let again = content_of(&ods_bytes(&back).expect("第二次存盘"));
        assert_eq!(
            again.matches("<office:annotation").count(),
            1,
            "存两次不许多盖章: {again}"
        );
        assert!(again.contains("xlink:href=\"#数据.B9\""), "第二次存盘还在");
        let second = std::env::temp_dir()
            .join(format!("openoffices-ods-side2-{}.ods", std::process::id()))
            .to_string_lossy()
            .to_string();
        std::fs::write(&second, ods_bytes(&back).expect("ods bytes")).expect("write");
        let twice = crate::xlsx::read_xlsx_sync(second.clone()).expect("二次读回失败");
        std::fs::remove_file(&second).ok();
        let t = &twice.sheets[0];
        assert_eq!(
            (t.notes.len(), t.links.len()),
            (1, 2),
            "往返不收窄: notes={:?} links={:?}",
            t.notes,
            t.links
        );
    }

    /// 反面守卫（v0.58/v0.61 那条「没声明就不写」在这一层同样立着）：空气泡不落笔、
    /// 没有地址的链接整条不写、`show=false` 与缺席同档、用不上的命名空间不声明
    #[test]
    fn ods_undeclared_note_and_link_layers_stay_absent() {
        let wb = WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "数据".into(),
                cells: vec![cell(0, 0, json!("月份")), cell(0, 1, json!("销量"))],
                notes: vec![
                    CellNotePayload {
                        r: 0,
                        c: 0,
                        text: "  ".into(),
                        ..Default::default()
                    },
                    CellNotePayload {
                        r: 0,
                        c: 1,
                        text: "只有一行".into(),
                        show: Some(false),
                        ..Default::default()
                    },
                ],
                links: vec![CellLinkPayload {
                    r: 0,
                    c: 1,
                    tip: Some("没地址".into()),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        };
        let bytes = ods_bytes(&wb).expect("ods bytes");
        let content = content_of(&bytes);
        assert_eq!(
            content.matches("<office:annotation").count(),
            1,
            "只有正文的那格写一条，空气泡不落笔: {content}"
        );
        assert!(!content.contains("office:display"), "false 与缺席同一档，不写它");
        assert!(!content.contains("<dc:creator"), "没说作者就不许凭空造一层");
        assert!(!content.contains("svg:width"), "没说尺寸就不替用户决定气泡多大");
        assert!(
            !content.contains("<text:a "),
            "两头都没地址的链接整条不写: {content}"
        );
        for ns in ["xmlns:dc=", "xmlns:svg=", "xmlns:xlink="] {
            assert!(!content.contains(ns), "用不上的命名空间不声明: {ns}");
        }

        let path = std::env::temp_dir()
            .join(format!("openoffices-ods-side-none-{}.ods", std::process::id()))
            .to_string_lossy()
            .to_string();
        std::fs::write(&path, bytes).expect("write");
        let back = crate::xlsx::read_xlsx_sync(path.clone()).expect("读回失败");
        std::fs::remove_file(&path).ok();
        let s = &back.sheets[0];
        assert_eq!(s.notes.len(), 1, "空气泡不该读回一条: {:?}", s.notes);
        assert_eq!(s.notes[0].r, 0);
        assert_eq!(s.notes[0].c, 1);
        assert_eq!(s.notes[0].show, None);
        assert!(s.links.is_empty(), "没地址的链接不该读回: {:?}", s.links);
    }

    /// 写侧的账必须与字节里少掉的那几枚**同一批**：正文空的批注、落在被盖格上的批注与链接、
    /// 同一格的第二条，都要在保存那趟说得出，而不是报"已保存"却少东西
    #[test]
    fn ods_write_accounts_name_exactly_what_the_bytes_drop() {
        let wb = WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "数据".into(),
                // 合并区 (0,0)-(1,1)：(0,1)、(1,0)、(1,1) 都是被盖住的那几格
                cells: vec![cell(0, 0, json!("甲")), cell(3, 0, json!("丁"))],
                merges: vec![MergeRange {
                    start_row: 0,
                    start_column: 0,
                    end_row: 1,
                    end_column: 1,
                }],
                notes: vec![
                    CellNotePayload {
                        r: 0,
                        c: 0,
                        text: "落在锚格上".into(),
                        ..Default::default()
                    },
                    CellNotePayload {
                        r: 0,
                        c: 1,
                        text: "落在被盖的格".into(),
                        author: Some("张三".into()),
                        width: Some(128.0),
                        height: Some(74.0),
                        ..Default::default()
                    },
                    CellNotePayload {
                        r: 2,
                        c: 0,
                        text: "   ".into(),
                        ..Default::default()
                    },
                    CellNotePayload {
                        r: 3,
                        c: 0,
                        text: "同格第一条".into(),
                        ..Default::default()
                    },
                    CellNotePayload {
                        r: 3,
                        c: 0,
                        text: "同格第二条".into(),
                        ..Default::default()
                    },
                ],
                links: vec![
                    CellLinkPayload {
                        r: 0,
                        c: 0,
                        url: Some("https://example.com/x".into()),
                        ..Default::default()
                    },
                    CellLinkPayload {
                        r: 1,
                        c: 0,
                        url: Some("https://example.com/covered".into()),
                        ..Default::default()
                    },
                    CellLinkPayload {
                        r: 2,
                        c: 2,
                        tip: Some("两头都没说".into()),
                        ..Default::default()
                    },
                    CellLinkPayload {
                        r: 3,
                        c: 0,
                        location: Some("数据!A1".into()),
                        ..Default::default()
                    },
                    CellLinkPayload {
                        r: 3,
                        c: 0,
                        location: Some("数据!B9".into()),
                        ..Default::default()
                    },
                ],
                ..Default::default()
            }],
            ..Default::default()
        };
        let accounts = ods_side_accounts(&wb.sheets);
        let content = content_of(&ods_bytes(&wb).expect("ods bytes"));

        // 报出去的条数与字节里少掉的条数**当场对质**（不是各说各话）：
        // 「未写入」一枚少一枚，「写了 k 条只写第一条」少 k−1 枚——条数从账目的字面里读出来
        assert!(
            !wb.sheets[0].notes.is_empty() && !wb.sheets[0].links.is_empty(),
            "夹具里这两味是空的，等式两边就在测空气"
        );
        let dropped = |label: &str| -> usize {
            let plain = accounts
                .iter()
                .filter(|a| a.contains(label) && a.contains("未写入"))
                .count();
            let dup: usize = accounts
                .iter()
                .filter(|a| a.contains(label) && a.contains("只写了第一条"))
                .map(|a| {
                    let rest = a.split("写了 ").nth(1).unwrap_or("");
                    rest.split(" 条").next().unwrap_or("1").parse().unwrap_or(1)
                })
                .map(|k: usize| k - 1)
                .sum();
            plain + dup
        };
        assert_eq!(
            content.matches("<office:annotation").count(),
            wb.sheets[0].notes.len() - dropped("批注"),
            "批注：报的账与少掉的那几枚对不上: {accounts:?} / {content}"
        );
        assert_eq!(
            content.matches("<text:a ").count(),
            wb.sheets[0].links.len() - dropped("链接"),
            "链接：报的账与少掉的那几枚对不上: {accounts:?} / {content}"
        );
        // 同一格的第二条不写出去，但它不是"未写入"那种整条丢，而是"只写了第一条"
        assert_eq!(
            content.matches("<office:annotation").count(),
            2,
            "锚格一枚 + 同格只出一枚: {content}"
        );
        assert_eq!(
            content.matches("<text:a ").count(),
            2,
            "锚格一枚 + 同格只出一枚: {content}"
        );

        assert_eq!(
            accounts,
            vec![
                "第 1 行第 2 列的批注落在合并区里被盖住的那一格，ODF 在那里没有批注通道，未写入".to_string(),
                "第 3 行第 1 列的批注没有正文，未写入".to_string(),
                "第 2 行第 1 列的链接落在合并区里被盖住的那一格，ODF 在那里没有正文通道，未写入".to_string(),
                "第 3 行第 3 列的链接既没有外部地址也没有表内跳转目标，未写入".to_string(),
                "第 4 行第 1 列写了 2 条批注，只写了第一条".to_string(),
                "第 4 行第 1 列写了 2 条链接，只写了第一条".to_string(),
            ],
            "账目逐条对字面: {accounts:?}"
        );

        // 只有"被丢掉的那些真没落笔"才算按需声明：署名与尺寸都住在没写出去的那枚批注里 ⇒ 整层缺席
        for ns in ["xmlns:dc=", "xmlns:svg="] {
            assert!(
                !content.contains(ns),
                "落笔的那几枚没用到这一层就不许声明: {ns} / {content}"
            );
        }
        assert!(
            content.contains("xmlns:xlink="),
            "真写出去的链接要用 xlink，就得声明"
        );

        // 自家产物读回来：留下的那几枚一格不少，且不因这一趟再记出读侧的账
        let path = std::env::temp_dir()
            .join(format!("openoffices-ods-write-acct-{}.ods", std::process::id()))
            .to_string_lossy()
            .to_string();
        let again = write_ods_sync(path.clone(), wb).expect("存盘失败");
        assert_eq!(again.len(), 6, "第二次存盘报同一批账: {again:?}");
        let back = crate::xlsx::read_xlsx_sync(path.clone()).expect("读回失败");
        std::fs::remove_file(&path).ok();
        assert_eq!(
            back.warnings.iter().filter(|w| w.contains("ODS 里的")).count(),
            0,
            "自家产物不该记出读侧的账: {:?}",
            back.warnings
        );
        let s = &back.sheets[0];
        assert_eq!(s.notes.len(), 2, "留下的批注都在: {:?}", s.notes);
        assert_eq!(s.links.len(), 2, "留下的链接都在: {:?}", s.links);
        assert!(
            s.notes.iter().any(|n| n.text == "同格第一条")
                && !s.notes.iter().any(|n| n.text == "同格第二条"),
            "同格只留第一条: {:?}",
            s.notes
        );
        assert!(
            s.links
                .iter()
                .any(|l| l.location.as_deref() == Some("数据!A1")),
            "写出去的是第一条地址: {:?}",
            s.links
        );
    }

    /// 反面守卫：装得下的那几枚不许凭空记账（否则状态栏每次保存都在说谎）
    #[test]
    fn ods_write_accounts_stay_silent_when_everything_fits() {
        let wb = WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "数据".into(),
                cells: vec![cell(0, 0, json!("甲")), cell(0, 1, json!("乙"))],
                notes: vec![CellNotePayload {
                    r: 0,
                    c: 0,
                    text: "要复核".into(),
                    author: Some("李四".into()),
                    ..Default::default()
                }],
                links: vec![CellLinkPayload {
                    r: 0,
                    c: 1,
                    url: Some("mailto:someone@example.com".into()),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        };
        let path = std::env::temp_dir()
            .join(format!("openoffices-ods-write-silent-{}.ods", std::process::id()))
            .to_string_lossy()
            .to_string();
        let accounts = write_ods_sync(path.clone(), wb).expect("存盘失败");
        std::fs::remove_file(&path).ok();
        assert_eq!(accounts, Vec::<String>::new(), "写侧凭空记了账: {accounts:?}");
    }

    /// 命名空间只为**真会落笔**的属性服务：尺寸说了等于没说（0／负数／NaN）时那一味写不出去，
    /// 于是 `xmlns:svg` 也不许出现——否则就是替一条根本不存在的属性盖章
    #[test]
    fn ods_namespaces_follow_the_bytes_not_the_payload() {
        let dim_note = |v: f64| CellNotePayload {
            r: 0,
            c: 0,
            text: "有正文".into(),
            width: Some(v),
            height: Some(v),
            ..Default::default()
        };
        let wb_with = |note: CellNotePayload| WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "数据".into(),
                cells: vec![cell(0, 0, json!("甲"))],
                notes: vec![note],
                ..Default::default()
            }],
            ..Default::default()
        };
        for v in [0.0, -8.0, f64::NAN] {
            let content = content_of(&ods_bytes(&wb_with(dim_note(v))).expect("ods bytes"));
            assert!(
                !content.contains("xmlns:svg="),
                "尺寸 {v} 落不了笔，就不许为它声明 svg: {content}"
            );
            assert!(
                !content.contains("svg:width=") && !content.contains("svg:height="),
                "命名空间与属性得同进退: {content}"
            );
        }
        // 正控制：真给了尺寸 ⇒ 属性与声明都在
        let content = content_of(&ods_bytes(&wb_with(dim_note(128.0))).expect("ods bytes"));
        assert!(
            content.contains("xmlns:svg=") && content.contains("svg:width=\"3.3867cm\""),
            "真落笔的尺寸得带上声明: {content}"
        );
    }

    /// 落不准位置的批注与链接一律记账而不是硬派——这一条测读侧本身（不经装配），
    /// 因为下面这些形状都不合规，只是别人的件里真可能出现
    #[test]
    fn ods_notes_and_links_account_for_shapes_we_cannot_place() {
        let wb = WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "数据".into(),
                cells: vec![
                    cell(0, 0, json!("甲")),
                    cell(0, 1, json!("乙")),
                    cell(0, 2, json!("丙")),
                    cell(0, 3, json!("丁")),
                    cell(2, 2, json!("戊")),
                    cell(2, 3, json!("己")),
                ],
                merges: vec![MergeRange {
                    start_row: 0,
                    start_column: 0,
                    end_row: 1,
                    end_column: 1,
                }],
                ..Default::default()
            }],
            ..Default::default()
        };
        let (mut content, styles) = ods_xml(&wb);
        content = content.replace(
            "office:version=\"1.2\"><office:automatic-styles>",
            "xmlns:dc=\"http://purl.org/dc/elements/1.1/\" \
             xmlns:xlink=\"http://www.w3.org/1999/xlink\" \
             office:version=\"1.2\"><office:automatic-styles>",
        );
        // 空气泡：正文只有空白，收了反而在界面上多一枚点开没东西的标记
        content = content.replace(
            "<text:p>甲</text:p>",
            "<office:annotation><text:p>  </text:p></office:annotation><text:p>甲</text:p>",
        );
        // 合并区里被盖住的格：真件不会把批注写在这儿，写了也说不准属于哪一格
        content = content.replace(
            "<table:covered-table-cell table:number-columns-repeated=\"2\"/>",
            "<table:covered-table-cell><office:annotation><text:p>盖住的批注</text:p>\
             </office:annotation></table:covered-table-cell>",
        );
        // 一格两条链接：只收第一条并记账（载荷一位只装得下一条）
        content = content.replace(
            "<text:p>丙</text:p>",
            "<text:p><text:a xlink:type=\"simple\" xlink:href=\"https://a.example/1\">丙</text:a>\
             <text:a xlink:type=\"simple\" xlink:href=\"https://b.example/2\">丙</text:a></text:p>",
        );
        content = content.replace(
            "<text:p>丁</text:p>",
            "<text:p><text:a xlink:type=\"simple\">丁</text:a></text:p>",
        );
        // 既不带 # 又不带协议名（含单字母像盘符那一档）：那是点不开的死链，不硬派成 url
        content = content.replace(
            "<text:p>戊</text:p>",
            "<text:p><text:a xlink:type=\"simple\" xlink:href=\"notes/readme.txt\">戊</text:a></text:p>",
        );
        content = content.replace(
            "<text:p>己</text:p>",
            "<text:p><text:a xlink:type=\"simple\" xlink:href=\"C:temp.txt\">己</text:a></text:p>",
        );
        // 一次重复多列的格带着批注与链接：落在哪一列说不准
        content = content.replace(
            "<table:table-cell table:number-columns-repeated=\"2\"/>",
            "<table:table-cell table:number-columns-repeated=\"2\">\
             <office:annotation><text:p>飘着的批注</text:p></office:annotation>\
             <text:p><text:a xlink:type=\"simple\" xlink:href=\"https://x.example/9\">飘</text:a></text:p>\
             </table:table-cell>",
        );
        let path = std::env::temp_dir()
            .join(format!("openoffices-ods-sideacct-{}.ods", std::process::id()))
            .to_string_lossy()
            .to_string();
        std::fs::write(&path, zip_ods(&content, &styles)).expect("write");
        let rd = read_ods_cell_side(&path);
        std::fs::remove_file(&path).ok();

        let acct = rd.accounts.join("|");
        for kw in [
            "被盖住",
            "只收第一条",
            "没写它指向哪儿",
            "位置认不出来",
            "重复多列",
        ] {
            assert!(acct.contains(kw), "账里要说得出「{kw}」: {acct}");
        }
        assert_eq!(rd.accounts.len(), 7, "七处各一条，不重复记: {acct}");
        assert_eq!(acct.matches("未收进来").count(), 6, "落不准的都未收进来: {acct}");

        let s = rd.by_sheet.get("数据").expect("能落准的那条链接要进表");
        assert_eq!(s.links.len(), 1, "只收第一条: {:?}", s.links);
        assert_eq!(s.links[0].r, 0);
        assert_eq!(s.links[0].c, 2);
        assert_eq!(s.links[0].url.as_deref(), Some("https://a.example/1"));
        assert!(
            s.notes.is_empty(),
            "空气泡与落不准位置的批注都不该进载荷: {:?}",
            s.notes
        );
    }

    #[test]
    fn ods_zip_layout() {
        let wb = WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "S".into(),
                cells: vec![cell(0, 0, json!(1))],
                merges: vec![],
                charts: vec![],
                ..Default::default()
            }],
            ..Default::default()
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
                            ff: Some("宋体".into()),
                            bd: Some(CellBorder {
                                t: Some(BorderSide { s: Some("thin".into()), c: Some("#000000".into()) }),
                                r: Some(BorderSide { s: Some("thin".into()), c: Some("#000000".into()) }),
                                b: Some(BorderSide { s: Some("thin".into()), c: Some("#000000".into()) }),
                                l: Some(BorderSide { s: Some("thin".into()), c: Some("#000000".into()) }),
                            }),
                            ho: Some("center".into()),
                            vo: Some("middle".into()),
                            wb: true,
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
                col_widths: [(0u32, 140.0)].into_iter().collect(),
                row_heights: [(0u32, 32.0)].into_iter().collect(),
                notes: vec![CellNotePayload {
                    r: 1,
                    c: 0,
                    text: "这里要复核\n第二行".into(),
                    author: Some("张三".into()),
                    width: Some(128.0),
                    height: Some(74.0),
                    show: Some(true),
                }],
                links: vec![
                    CellLinkPayload {
                        r: 0,
                        c: 1,
                        url: Some("https://example.com/a?x=1&y=2".into()),
                        tip: Some("例子".into()),
                        ..Default::default()
                    },
                    CellLinkPayload {
                        r: 3,
                        c: 1,
                        location: Some("销售!B1".into()),
                        ..Default::default()
                    },
                    // 只有链接没值的一格：写侧要落笔，界面得给它一个落脚点
                    CellLinkPayload {
                        r: 8,
                        c: 0,
                        url: Some("https://example.com/b".into()),
                        ..Default::default()
                    },
                ],
                ..Default::default()
            }],
            ..Default::default()
        };
        write_ods_sync(path.clone(), wb).expect("生成夹具 ods 失败");
        println!("fixture: {path}");
    }
}
