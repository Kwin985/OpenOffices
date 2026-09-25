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
    BorderSide, CellBorder, CellPayload, CellStyle, Error, MergeRange, SheetPayload, WorkbookPayload,
};
use crate::xlsx_style::{attr_str, read_entry, SheetFmt};

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

/// 任何失败退化为空表；键为 sheet 名（与 calamine 的 table:name 一致）
pub fn read_ods_styles(path: &str) -> HashMap<String, SheetFmt> {
    let mut out: HashMap<String, SheetFmt> = HashMap::new();
    let Ok(file) = std::fs::File::open(path) else { return out };
    let Ok(mut zip) = zip::ZipArchive::new(file) else { return out };
    let Some(xml) = read_entry(&mut zip, "content.xml") else { return out };

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
                        table_name = attr_str(e, "name");
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
        // 批注是格子的孩子（office:annotation 里装着作者的 text:p），链接是 text:a
        ("<office:annotation", "ODS 里的单元格批注暂未读入"),
        ("<text:a ", "ODS 里的单元格链接暂未读入"),
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
    // 冻结窗格在 styles.xml 的 ViewSettings/Tables，map-entry 与 content 表序一一对应
    if let Some(sx) = read_entry(&mut zip, "styles.xml") {
        for (i, (rows, cols)) in parse_ods_freezes(&sx).into_iter().enumerate() {
            if rows + cols == 0 {
                continue;
            }
            if let Some(f) = order.get(i).and_then(|n| out.get_mut(n)) {
                f.freeze = Some((rows, cols));
            }
        }
    }
    out
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
        .max()
        .unwrap_or(0);
    let max_col = sheet
        .cells
        .iter()
        .map(|x| x.c)
        .chain(sheet.merges.iter().map(|m| m.end_column))
        .chain(sheet.hidden_cols.iter().copied())
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
                .any(|x| x.r == r && (x.v.is_some() || x.f.is_some() || x.s.is_some()));
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
                let (vt, text, fattr) = top
                    .map(cell_content_attrs)
                    .unwrap_or_else(|| ("office:value-type=\"string\"".into(), String::new(), String::new()));
                let style = style_key(top.and_then(|x| x.s.as_ref()))
                    .and_then(|k| style_names.get(&k))
                    .map(|n| format!(" table:style-name=\"{n}\""))
                    .unwrap_or_default();
                row_buf.push_str(&format!(
                    "<table:table-cell{style} {vt}{fattr} table:number-columns-spanned=\"{col_span}\" table:number-rows-spanned=\"{row_span}\"><text:p>{}</text:p></table:table-cell>",
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
                .map(|x| x.v.is_some() || x.f.is_some() || style_key(x.s.as_ref()).is_some())
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
            let (vt, text, fattr) = cell_content_attrs(x);
            let style = style_key(x.s.as_ref())
                .and_then(|k| style_names.get(&k))
                .map(|n| format!(" table:style-name=\"{n}\""))
                .unwrap_or_default();
            row_buf.push_str(&format!(
                "<table:table-cell{style} {vt}{fattr}><text:p>{}</text:p></table:table-cell>",
                esc(&text)
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
         <office:styles>\
         <style:style style:name=\"Default\" style:family=\"table-cell\"/>\
         </office:styles></office:document-styles>",
        settings_xml(&workbook.sheets).unwrap_or_default()
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
pub async fn write_ods(path: String, workbook: WorkbookPayload) -> Result<(), Error> {
    crate::xlsx::to_blocking(move || write_ods_sync(path, workbook)).await
}

pub fn write_ods_sync(path: String, workbook: WorkbookPayload) -> Result<(), Error> {
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

    #[test]
    fn ods_notes_and_links_report_their_boundaries() {
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
        let (mut content, styles) = ods_xml(&wb);
        // 别人的件长这样：批注是格子的第一个孩子（作者的 text:p 也在里面），链接是格子里的 text:a。
        // 前缀必须声明到位——漏了 xlink/dc 会让整份 XML 解析失败，表现为"没报错但是空表"
        content = content.replace(
            "office:version=\"1.2\"><office:automatic-styles>",
            "xmlns:dc=\"http://purl.org/dc/elements/1.1/\" \
             xmlns:xlink=\"http://www.w3.org/1999/xlink\" \
             office:version=\"1.2\"><office:automatic-styles>",
        );
        content = content.replace(
            "<text:p>月份</text:p>",
            "<office:annotation><dc:creator>张三</dc:creator><text:p>这里要复核</text:p></office:annotation>\
             <text:p>月份</text:p>",
        );
        content = content.replace(
            "<text:p>一月</text:p>",
            "<text:p><text:a xlink:type=\"simple\" xlink:href=\"https://example.com/a?x=1&amp;y=2\">\
             一月</text:a></text:p>",
        );
        let path = std::env::temp_dir()
            .join(format!("openoffices-ods-side-{}.ods", std::process::id()))
            .to_string_lossy()
            .to_string();
        std::fs::write(&path, zip_ods(&content, &styles)).expect("write");
        let back = crate::xlsx::read_xlsx_sync(path.clone()).expect("带批注与链接的 ODS 读回失败");
        std::fs::remove_file(&path).ok();

        let notes = back.warnings.join("|");
        assert!(notes.contains("批注"), "批注账要说得出: {notes}");
        assert!(notes.contains("链接"), "链接账要说得出: {notes}");
        assert_eq!(notes.matches("ODS 里的").count(), 2, "两样各一条: {notes}");
        // 记账不吞值：批注的字不能混进格子（那是正文与气泡的分界），链接的字照常说得出
        let s = &back.sheets[0];
        let at = |r: u32, c: u32| {
            s.cells
                .iter()
                .find(|x| x.r == r && x.c == c)
                .and_then(|x| x.v.clone())
        };
        assert_eq!(at(0, 0), Some(json!("月份")), "批注的字不该渗进正文: {:?}", at(0,0));
        assert_eq!(at(1, 0), Some(json!("一月")), "链接读不懂，字还得照常出");
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
                ..Default::default()
            }],
            ..Default::default()
        };
        write_ods_sync(path.clone(), wb).expect("生成夹具 ods 失败");
        println!("fixture: {path}");
    }
}
