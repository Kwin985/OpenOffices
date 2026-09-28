//! 表格打印设置（页面 / 纸张 / 边距 / 页眉页脚 / 手动分页符 / 打印区域 / 重复标题行）在 xlsx 里的读写。
//!
//! 这一批东西**不住在 `<sheetData>` 里**，也不在 Univer 的模型里：它们散在 worksheet 末尾的
//! `<sheetPr>`·`<printOptions>`·`<pageMargins>`·`<pageSetup>`·`<headerFooter>`·`<rowBreaks>`·`<colBreaks>`
//! 七处，而打印区域与重复标题根本不在表上，是 workbook 级的 `_xlnm.Print_Area` / `_xlnm.Print_Titles`
//! 两条 definedName（靠 `localSheetId` 分表）。所以两头都是纯换算，不走门面（与 v0.48 的批注同形）。
//!
//! 载荷形状照前置实测的 OOXML 字面：枚举收字面（orientation/paperSize 数字）、边距收英寸、
//! 区域收 0 基含端点、分页符**照 `brk@id` 原样收**（0 基，指"这一行/列自己开始新的一页"——
//! 实机腿量过：Excel 在 A11 之前插断点写出 `id=10`，而我们写 `id=3` 时它报 `Location.Row=4`）。
//! 认不出的片段一律记账，不挑个像样的凑数。

use std::collections::HashMap;
use std::fs::File;

use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use rust_xlsxwriter::Worksheet;

use crate::xlsx::{paper_name, PrintHfPayload, PrintMarginsPayload, RangeRect, SheetFormat,
    SheetPayload, SheetPrintPayload};
use crate::xlsx_style::{attr_str, read_entry, sheet_paths};

/// 打印设置在读侧的产物：按表名分家 + 整包级的账
#[derive(Default)]
pub struct PrintRead {
    pub by_sheet: HashMap<String, SheetPrintPayload>,
    pub accounts: Vec<String>,
}

pub fn read_print_setups(path: &str) -> PrintRead {
    let mut out = PrintRead::default();
    let Ok(file) = File::open(path) else {
        return out;
    };
    let Ok(mut zip) = zip::ZipArchive::new(file) else {
        return out;
    };
    // definedName 的 localSheetId 是**工作表声明序**的下标，不是 r:id 也不是表名
    let order = sheet_paths(&mut zip);
    let names: Vec<String> = order.iter().map(|(n, _)| n.clone()).collect();
    if let Some(wb) = read_entry(&mut zip, "xl/workbook.xml") {
        for (idx, kind, text) in read_defined_names(&wb) {
            let Some(name) = names.get(idx) else {
                out.accounts.push(format!(
                    "打印设置里有一条 {kind} 指向第 {} 张表，这份文件没这张表，没收",
                    idx + 1
                ));
                continue;
            };
            let Some(area) = parse_area(&text) else {
                out.accounts.push(format!(
                    "表「{name}」的 {kind} 写的是「{}」，不是能认的区域形状，按整表处理",
                    text.trim()
                ));
                continue;
            };
            let sheet = out.by_sheet.entry(name.clone()).or_default();
            match kind.as_str() {
                "Print_Area" => {
                    if let Some(rect) = area.rect {
                        sheet.print_area = Some(rect);
                    } else {
                        // 整行/整列式的打印区域我们装不下（载荷只收矩形），但它不是"没设打印区域"
                        out.accounts.push(format!(
                            "表「{name}」的打印区域写的是「{}」，这种整行/整列的形状我们装不下，没收",
                            text.trim()
                        ));
                    }
                }
                "Print_Titles" => {
                    // 同一条 definedName 里可能同时给出行与列（`Sheet1!$1:$2,Sheet1!$A:$B`）
                    if area.rows.is_some() {
                        sheet.title_rows = area.rows;
                    }
                    if area.cols.is_some() {
                        sheet.title_cols = area.cols;
                    }
                }
                _ => {}
            }
        }
    }
    for (name, p) in order {
        let Some(xml) = read_entry(&mut zip, &p) else {
            continue;
        };
        if !has_print_setup(&xml) {
            continue;
        }
        let (mut print, mut notes) = read_sheet_print(&xml);
        // definedName 已经先落过一次，这里只补表上那些元素（不会互相覆盖掉有值的那半）
        if let Some(prev) = out.by_sheet.get(&name) {
            merge_defaults(&mut print, prev);
        }
        out.accounts.append(&mut notes);
        // 只剩「默认那一档边距」的不算声明（写侧的 crate 每张表都替我们写下它）
        print.clear_default_only_margins();
        if !print.is_empty() {
            out.by_sheet.insert(name, print);
        }
    }
    out
}

/// `a` 里没值时用 `b`（definedName 先落的那份）填上
fn fill_opt<T: Clone>(x: &mut Option<T>, v: Option<&T>) {
    if x.is_none() {
        *x = v.cloned();
    }
}

/// 把 `a` 里那些还没值的字段从 `b`（definedName 先落的那份）补齐，两边都有值时保留 `a`
fn merge_defaults(a: &mut SheetPrintPayload, b: &SheetPrintPayload) {
    let SheetPrintPayload {
        orientation,
        paper_size,
        scale,
        fit_to_page,
        fit_to_width,
        fit_to_height,
        page_order,
        margins,
        h_centered,
        v_centered,
        grid_lines,
        headings,
        first_page_number,
        odd_even,
        first_differs,
        scale_with_doc,
        align_with_margins,
        header,
        footer,
        print_area,
        title_rows,
        title_cols,
        row_breaks,
        col_breaks,
    } = a;
    fill_opt(orientation, b.orientation.as_ref());
    fill_opt(paper_size, b.paper_size.as_ref());
    fill_opt(scale, b.scale.as_ref());
    if !*fit_to_page {
        *fit_to_page = b.fit_to_page;
    }
    fill_opt(fit_to_width, b.fit_to_width.as_ref());
    fill_opt(fit_to_height, b.fit_to_height.as_ref());
    fill_opt(page_order, b.page_order.as_ref());
    if margins.is_none() {
        *margins = b.margins.clone();
    }
    fill_opt(h_centered, b.h_centered.as_ref());
    fill_opt(v_centered, b.v_centered.as_ref());
    fill_opt(grid_lines, b.grid_lines.as_ref());
    fill_opt(headings, b.headings.as_ref());
    fill_opt(first_page_number, b.first_page_number.as_ref());
    // 这两枚的"没值"说的是"开着"而不是"没读到"：任何一份说了关就是关，所以照 fill_opt 的方向填（Some(false) 赢）
    fill_opt(scale_with_doc, b.scale_with_doc.as_ref());
    fill_opt(align_with_margins, b.align_with_margins.as_ref());
    if !*odd_even {
        *odd_even = b.odd_even;
    }
    if !*first_differs {
        *first_differs = b.first_differs;
    }
    if header.is_none() {
        *header = b.header.clone();
    }
    if footer.is_none() {
        *footer = b.footer.clone();
    }
    if print_area.is_none() {
        *print_area = b.print_area;
    }
    if title_rows.is_none() {
        *title_rows = b.title_rows;
    }
    if title_cols.is_none() {
        *title_cols = b.title_cols;
    }
    if row_breaks.is_empty() {
        row_breaks.extend(b.row_breaks.iter().copied());
    }
    if col_breaks.is_empty() {
        col_breaks.extend(b.col_breaks.iter().copied());
    }
}

/// 常见打印设置元素在不在；绝大多数表一个都没有，省掉一趟事件流
fn has_print_setup(xml: &str) -> bool {
    xml.contains("<pageSetup")
        || xml.contains("<pageMargins")
        || xml.contains("<printOptions")
        || xml.contains("<headerFooter")
        || xml.contains("<rowBreaks")
        || xml.contains("<colBreaks")
        || xml.contains("pageSetUpPr")
}

fn read_defined_names(wb: &str) -> Vec<(usize, String, String)> {
    let mut out = Vec::new();
    let mut reader = Reader::from_str(wb);
    let mut want: Option<(usize, String)> = None;
    let mut buf = String::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) if e.local_name().as_ref() == "definedName" => {
                let nm = attr_str(&e, "name").unwrap_or_default();
                let idx = attr_str(&e, "localSheetId")
                    .and_then(|v| v.trim().parse::<usize>().ok())
                    .unwrap_or(usize::MAX);
                want = Some((idx, nm));
                buf.clear();
            }
            Ok(Event::Text(t)) => {
                if want.is_some() {
                    buf.push_str(t.as_ref());
                }
            }
            Ok(Event::GeneralRef(r)) => {
                if want.is_some() {
                    push_entity(&mut buf, r.as_ref());
                }
            }
            Ok(Event::End(e)) if e.local_name().as_ref() == "definedName" => {
                if let Some((idx, nm)) = want.take() {
                    let kind = nm.strip_prefix("_xlnm.").unwrap_or(&nm).to_string();
                    if kind == "Print_Area" || kind == "Print_Titles" {
                        out.push((idx, kind, unesc(&std::mem::take(&mut buf))));
                    }
                }
                buf.clear();
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    out
}

/// 区域拆出来的三样：矩形（打印区域）、整行标题、整列标题
struct AreaBits {
    rect: Option<RangeRect>,
    rows: Option<[u32; 2]>,
    cols: Option<[u32; 2]>,
}

/// `Sheet1!$A$1:$E$18` / `Sheet1!$1:$2,Sheet1!$A:$B` → 区域 + 行标题 + 列标题
fn parse_area(text: &str) -> Option<AreaBits> {
    let mut rect: Option<RangeRect> = None;
    let mut rows: Option<[u32; 2]> = None;
    let mut cols: Option<[u32; 2]> = None;
    let mut any = false;
    for frag in text.split(',') {
        let f = frag.trim();
        let body = match f.rfind('!') {
            Some(i) => &f[i + 1..],
            None => f,
        };
        if body.is_empty() {
            continue;
        }
        let (a, b) = match body.split_once(':') {
            Some((a, b)) => (a, b),
            // 单个格子也是合法区域（`$A$1`＝一格）
            None => (body, body),
        };
        let (r1, c1) = cell_ref(a)?;
        let (r2, c2) = cell_ref(b)?;
        // 整行（`$1:$2`）＝两端都没有列；整列（`$A:$B`）＝两端都没有行
        if c1.is_none() && c2.is_none() {
            if let (Some(x), Some(y)) = (r1, r2) {
                rows = Some([x.min(y), x.max(y)]);
                any = true;
            }
        } else if r1.is_none() && r2.is_none() {
            if let (Some(x), Some(y)) = (c1, c2) {
                cols = Some([x.min(y), x.max(y)]);
                any = true;
            }
        } else if let (Some(r1), Some(c1), Some(r2), Some(c2)) = (r1, c1, r2, c2) {
            let cur = RangeRect {
                start_row: r1.min(r2),
                start_column: c1.min(c2),
                end_row: r1.max(r2),
                end_column: c1.max(c2),
            };
            rect = Some(match rect {
                Some(old) => RangeRect {
                    start_row: old.start_row.min(cur.start_row),
                    start_column: old.start_column.min(cur.start_column),
                    end_row: old.end_row.max(cur.end_row),
                    end_column: old.end_column.max(cur.end_column),
                },
                None => cur,
            });
            any = true;
        }
    }
    if !any {
        return None;
    }
    Some(AreaBits { rect, rows, cols })
}

/// `$AB$12` / `A1` / `$5` / `$C` → (行, 列)（0 基；缺的那端 None）
fn cell_ref(s: &str) -> Option<(Option<u32>, Option<u32>)> {
    let s = s.trim().trim_start_matches('$');
    let mut col: u32 = 0;
    let mut i = 0usize;
    let b = s.as_bytes();
    while i < b.len() && b[i].is_ascii_alphabetic() {
        col = col.checked_mul(26)?.checked_add((b[i] & 31) as u32)?;
        i += 1;
    }
    let letters = i > 0;
    let rest = s[i..].trim_start_matches('$');
    let row: Option<u32> = if rest.is_empty() {
        None
    } else {
        Some(rest.parse::<u32>().ok()?.checked_sub(1)?)
    };
    let col = if letters { Some(col.checked_sub(1)?) } else { None };
    if row.is_none() && col.is_none() {
        return None;
    }
    Some((row, col))
}

/// OOXML 布尔属性：没写＝默认，写了才按 1/true 判定。默认值逐个不同，故收 `def`
fn battr(e: &BytesStart<'_>, key: &str) -> Option<bool> {
    attr_str(e, key).map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
}

fn btrue(e: &BytesStart<'_>, key: &str, def: bool) -> bool {
    battr(e, key).unwrap_or(def)
}

/// 「缺省开着」的那类布尔属性：只有明确写 0 才收下来，缺省或写 1 都算没声明
/// （写 1 与不写在这两枚上语义相同，归一回不声明免得存盘时替用户多落一笔字节）
fn off_attr(e: &BytesStart<'_>, key: &str) -> Option<bool> {
    match battr(e, key) {
        Some(false) => Some(false),
        _ => None,
    }
}

fn u32_attr(e: &BytesStart<'_>, key: &str) -> Option<u32> {
    attr_str(e, key).and_then(|v| v.trim().parse::<u32>().ok())
}

fn f64_attr(e: &BytesStart<'_>, key: &str) -> Option<f64> {
    attr_str(e, key).and_then(|v| v.trim().parse::<f64>().ok())
}

/// 正文里把 quick-xml 拆出去的实体重新拼回 `&name;`，交给结算时的 unesc
fn push_entity(buf: &mut String, raw: &str) {
    buf.push('&');
    buf.push_str(raw);
    buf.push(';');
}

fn unesc(s: &str) -> String {
    match quick_xml::escape::unescape(s) {
        Ok(cow) => cow.into_owned(),
        Err(_) => s.to_string(),
    }
}

/// 页眉页脚三槽（odd/even/first），表头表脚各一份
struct HfSlot {
    odd: String,
    even: String,
    first: String,
}

impl HfSlot {
    fn new() -> Self {
        HfSlot {
            odd: String::new(),
            even: String::new(),
            first: String::new(),
        }
    }
    fn put(&mut self, key: &str, text: String) {
        match key {
            "oddHeader" | "oddFooter" => self.odd = text,
            "evenHeader" | "evenFooter" => self.even = text,
            _ => self.first = text,
        }
    }
    fn into_payload(self) -> PrintHfPayload {
        let none_if_empty = |v: String| if v.is_empty() { None } else { Some(v) };
        PrintHfPayload {
            odd: none_if_empty(self.odd),
            even: none_if_empty(self.even),
            first: none_if_empty(self.first),
        }
    }
}

fn read_sheet_print(xml: &str) -> (SheetPrintPayload, Vec<String>) {
    let mut p = SheetPrintPayload::default();
    let mut notes: Vec<String> = Vec::new();
    let mut reader = Reader::from_str(xml);
    let mut header = HfSlot::new();
    let mut footer = HfSlot::new();
    let mut has_header = false;
    let mut has_footer = false;
    // 当前正在收正文的 headerFooter 子元素名 + 原始缓冲
    let mut slot: Option<(String, String)> = None;
    let mut in_row_breaks = false;
    let mut in_col_breaks = false;
    // <ext> 里是 x14 复制品（pageSetup 那套东西在 x14 也有形状），整块跳过免读两遍
    let mut ext = 0usize;
    loop {
        let ev = match reader.read_event() {
            Ok(e) => e,
            Err(_) => break,
        };
        match &ev {
            Event::Start(e) | Event::Empty(e) => {
                let nm = e.local_name().as_ref().to_string();
                let opened = matches!(ev, Event::Start(_));
                if nm == "ext" {
                    if opened {
                        ext += 1;
                    }
                    continue;
                }
                if ext > 0 {
                    continue;
                }
                match nm.as_str() {
                    // fitToPage 这个开关不住在 pageSetup 上，而在 sheetPr/pageSetUpPr
                    "pageSetUpPr" => p.fit_to_page = btrue(e, "fitToPage", false),
                    "printOptions" => {
                        p.h_centered = battr(e, "horizontalCentered");
                        p.v_centered = battr(e, "verticalCentered");
                        p.headings = battr(e, "headings");
                        p.grid_lines = battr(e, "gridLines");
                    }
                    "pageMargins" => {
                        p.margins = Some(PrintMarginsPayload {
                            top: f64_attr(e, "top"),
                            right: f64_attr(e, "right"),
                            bottom: f64_attr(e, "bottom"),
                            left: f64_attr(e, "left"),
                            header: f64_attr(e, "header"),
                            footer: f64_attr(e, "footer"),
                        });
                    }
                    "pageSetup" => {
                        p.orientation = attr_str(e, "orientation");
                        p.paper_size = u32_attr(e, "paperSize");
                        p.scale = u32_attr(e, "scale");
                        p.fit_to_width = u32_attr(e, "fitToWidth");
                        p.fit_to_height = u32_attr(e, "fitToHeight");
                        p.page_order = attr_str(e, "pageOrder");
                        if btrue(e, "useFirstPageNumber", false) {
                            p.first_page_number = u32_attr(e, "firstPageNumber");
                        }
                        // 纸型只写在数字上：认得出才有名，认不出如实记账（打印时按默认纸）
                        if let Some(code) = p.paper_size {
                            if paper_name(code).is_none() {
                                notes.push(format!(
                                    "页面设置里的纸张编号 {code} 我们不认，打印时按默认纸"
                                ));
                            }
                        }
                    }
                    "headerFooter" => {
                        p.odd_even = btrue(e, "differentOddEven", false);
                        p.first_differs = btrue(e, "differentFirst", false);
                        // 这两枚的缺省是**开着**（Excel 的勾默认打上），所以只有明确写 0 才算声明过；
                        // 显式写 1 与不写字节不同、语义相同，按 v0.52 那条「默认值不算声明」归一回不声明
                        p.scale_with_doc = off_attr(e, "scaleWithDoc");
                        p.align_with_margins = off_attr(e, "alignWithMargins");
                    }
                    "oddHeader" | "evenHeader" | "firstHeader" | "oddFooter" | "evenFooter"
                    | "firstFooter" => {
                        if !opened {
                            continue;
                        }
                        if nm.ends_with("Header") {
                            has_header = true;
                        } else {
                            has_footer = true;
                        }
                        slot = Some((nm.clone(), String::new()));
                    }
                    "rowBreaks" => in_row_breaks = opened,
                    "colBreaks" => in_col_breaks = opened,
                    "brk" => {
                        if !in_row_breaks && !in_col_breaks {
                            continue;
                        }
                        // man 缺省即「手动」（Excel 只为用户插入的分页符写这一带）；显式 man="0" 是引擎自己算的自动分页点，不收
                        if battr(e, "man") == Some(false) {
                            continue;
                        }
                        let Some(id) = u32_attr(e, "id") else { continue };
                        let list = if in_row_breaks { &mut p.row_breaks } else { &mut p.col_breaks };
                        if !list.contains(&id) {
                            list.push(id);
                        }
                    }
                    _ => {}
                }
            }
            Event::Text(t) => {
                if let Some((_, buf)) = slot.as_mut() {
                    buf.push_str(t.as_ref());
                }
            }
            Event::GeneralRef(r) => {
                if let Some((_, buf)) = slot.as_mut() {
                    push_entity(buf, r.as_ref());
                }
            }
            Event::End(e) => {
                let nm = e.local_name().as_ref().to_string();
                match nm.as_str() {
                    "ext" => ext = ext.saturating_sub(1),
                    "rowBreaks" => in_row_breaks = false,
                    "colBreaks" => in_col_breaks = false,
                    "oddHeader" | "evenHeader" | "firstHeader" | "oddFooter" | "evenFooter"
                    | "firstFooter" => {
                        let Some((key, raw)) = slot.take() else { continue };
                        let text = unesc(&raw);
                        if key.ends_with("Header") {
                            header.put(&key, text);
                        } else {
                            footer.put(&key, text);
                        }
                    }
                    _ => {}
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    if has_header {
        p.header = Some(header.into_payload());
    }
    if has_footer {
        p.footer = Some(footer.into_payload());
    }
    p.row_breaks.sort_unstable();
    p.col_breaks.sort_unstable();
    // fitToPage 勾了却没写 fitToWidth/fitToHeight 是**合法**的：OOXML 里那一档缺省就是 1
    // （rust_xlsxwriter 也正是这么写的——它等于 1 时不落属性，Excel 读回来仍是"1×1 页"）。
    // 不归这一档就会"存一次盘，页高那一条自己没了"：写侧按 (1,1) 落盘、读侧当没声明
    if p.fit_to_page {
        if p.fit_to_width.is_none() {
            p.fit_to_width = Some(1);
        }
        if p.fit_to_height.is_none() {
            p.fit_to_height = Some(1);
        }
    }
    (p, notes)
}

// ---------- 写侧 ----------

/// even/first 那两条页眉页脚串与两个开关：crate 只有 odd 通道，剩下的交给存盘时的定点重打包补
#[derive(Default, Clone)]
pub struct HfPatch {
    pub different_odd_even: bool,
    pub different_first: bool,
    pub even_header: Option<String>,
    pub first_header: Option<String>,
    pub even_footer: Option<String>,
    pub first_footer: Option<String>,
}

impl HfPatch {
    fn needed(&self) -> bool {
        self.different_odd_even
            || self.different_first
            || self.even_header.is_some()
            || self.first_header.is_some()
            || self.even_footer.is_some()
            || self.first_footer.is_some()
    }
}

/// write_sheet_print 的产物：写不下的账 + 需要重打包补的那张表的页眉页脚余下半边
pub struct PrintWrite {
    pub notes: Vec<String>,
    pub hf: Option<HfPatch>,
    /// 真的走通了 setter 的起始页码（crate 把它落在了布尔属性上，见 [`PrintPatch`]）
    pub page_number_patch: Option<u32>,
    /// 载荷**没**声明方向：crate 的 `write_page_setup` 只要这张表有 `<pageSetup>` 就一定写
    /// `orientation="portrait"`（默认纵向），所以那一枚属性得在重打包时擦掉，见 [`PrintPatch`]
    pub drop_orientation: bool,
}

/// 把打印设置落回 xlsx。返回写不下的账（与 v0.46/48 同一套：一项摆不进就记一条，不硬凑）
pub fn write_sheet_print(ws: &mut Worksheet, sheet: &SheetPayload) -> PrintWrite {
    let mut notes: Vec<String> = Vec::new();
    let mut hf: Option<HfPatch> = None;
    let mut page_number_patch: Option<u32> = None;
    let Some(p) = sheet.print.as_ref() else {
        return PrintWrite {
            notes,
            hf,
            page_number_patch,
            drop_orientation: false,
        };
    };
    // 「没设过」与「设成纵向」在界面上是两句话：这一枚只有走通了 setter 才算声明过
    let mut drop_orientation = true;
    match p.orientation.as_deref() {
        Some("landscape") => {
            ws.set_landscape();
            drop_orientation = false;
        }
        Some("portrait") => {
            ws.set_portrait();
            drop_orientation = false;
        }
        Some(other) if !other.is_empty() => {
            notes.push(format!("打印设置·方向「{other}」不是 landscape/portrait，没写"))
        }
        _ => {}
    }
    if let Some(code) = p.paper_size {
        if code >= 1 && code <= 255 {
            ws.set_paper_size(code as u8);
        } else {
            notes.push(format!("打印设置·纸张编号 {code} 超出 OOXML 能写的范围，没写"));
        }
    }
    if p.fit_to_page {
        let w = p.fit_to_width.unwrap_or(1);
        let h = p.fit_to_height.unwrap_or(1);
        ws.set_print_fit_to_pages(w as u16, h as u16);
    } else if let Some(s) = p.scale {
        if (10..=400).contains(&s) {
            ws.set_print_scale(s as u16);
        } else {
            notes.push(format!("打印设置·缩放比例 {s}% 不在 10~400 之间，没写"));
        }
    }
    if let Some(m) = &p.margins {
        // crate 的签名是 (left, right, top, bottom, header, footer)
        ws.set_margins(
            m.left.unwrap_or(0.7),
            m.right.unwrap_or(0.7),
            m.top.unwrap_or(0.75),
            m.bottom.unwrap_or(0.75),
            m.header.unwrap_or(0.3),
            m.footer.unwrap_or(0.3),
        );
    }
    if let Some(v) = p.h_centered {
        ws.set_print_center_horizontally(v);
    }
    if let Some(v) = p.v_centered {
        ws.set_print_center_vertically(v);
    }
    if let Some(v) = p.grid_lines {
        ws.set_print_gridlines(v);
    }
    if let Some(v) = p.headings {
        // 行列号在纸上是我们的打印网格自己画的（.sheet-print-heading），
        // 这一枚 printOptions/@headings 管的是「别人打开这个文件时 Excel 印不印」
        ws.set_print_headings(v);
    }
    if let Some(v) = p.first_page_number {
        if v == 0 {
            notes.push("打印设置·起始页码写了 0，OOXML 只能表达「自动」，已按自动处理".into());
        } else if v <= u16::MAX as u32 {
            ws.set_print_first_page_number(v as u16);
            page_number_patch = Some(v);
        } else {
            notes.push(format!("打印设置·起始页码 {v} 超出能写的范围，没写"));
        }
    }
    if let Some(v) = p.page_order.as_deref() {
        match v {
            "overThenDown" => {
                // crate 的参数名是 default_page_order：false 才写 pageOrder="overThenDown"
                ws.set_page_order(false);
            }
            "downThenOver" | "" => {}
            _ => notes.push(format!("打印设置·页面顺序「{v}」认不出来，没写")),
        }
    }
    if let Some(a) = &p.print_area {
        // 列号在 crate 上是 u16（ColNum），区域里的列超出 OOXML 列上限就摆不进去，如实记账
        match (u16::try_from(a.start_column), u16::try_from(a.end_column)) {
            (Ok(sc), Ok(ec)) => {
                if let Err(e) = ws.set_print_area(a.start_row, sc, a.end_row, ec) {
                    notes.push(format!("打印设置·打印区域摆不进去：{e}"));
                }
            }
            _ => notes.push("打印设置·打印区域的列号超出能写的范围，没写".into()),
        }
    }
    if let Some([a, b]) = p.title_rows {
        if let Err(e) = ws.set_repeat_rows(a, b) {
            notes.push(format!("打印设置·重复标题行 {a}~{b} 摆不进去：{e}"));
        }
    }
    if let Some([a, b]) = p.title_cols {
        match (u16::try_from(a), u16::try_from(b)) {
            (Ok(ac), Ok(bc)) => {
                if let Err(e) = ws.set_repeat_columns(ac, bc) {
                    notes.push(format!("打印设置·重复标题列 {a}~{b} 摆不进去：{e}"));
                }
            }
            _ => notes.push("打印设置·重复标题列的列号超出能写的范围，没写".into()),
        }
    }
    if !p.row_breaks.is_empty() {
        if let Err(e) = ws.set_page_breaks(&p.row_breaks) {
            notes.push(format!("打印设置·手动行分页符摆不进去：{e}"));
        }
    }
    if !p.col_breaks.is_empty() {
        if let Err(e) = ws.set_vertical_page_breaks(&p.col_breaks) {
            notes.push(format!("打印设置·手动列分页符摆不进去：{e}"));
        }
    }
    // 页眉页脚：odd 走 crate，even/first 与两个开关带回给存盘重打包
    let odd_header = p.header.as_ref().and_then(|h| h.odd.clone()).unwrap_or_default();
    let odd_footer = p.footer.as_ref().and_then(|f| f.odd.clone()).unwrap_or_default();
    if !odd_header.is_empty() {
        ws.set_header(odd_header.as_str());
    }
    if !odd_footer.is_empty() {
        ws.set_footer(odd_footer.as_str());
    }
    // 这两枚 crate 只在"关掉"时落笔（开着就是缺省、什么字节都不写），所以只有 Some(false) 才走 setter；
    // 走通 setter 顺带把 head_footer_changed 置上，于是"只有开关、一条页眉页脚都没有"的件也长得出元素
    if p.scale_with_doc == Some(false) {
        ws.set_header_footer_scale_with_doc(false);
    }
    if p.align_with_margins == Some(false) {
        ws.set_header_footer_align_with_page(false);
    }
    let patch = HfPatch {
        different_odd_even: p.odd_even,
        different_first: p.first_differs,
        even_header: p.header.as_ref().and_then(|h| h.even.clone()),
        first_header: p.header.as_ref().and_then(|h| h.first.clone()),
        even_footer: p.footer.as_ref().and_then(|f| f.even.clone()),
        first_footer: p.footer.as_ref().and_then(|f| f.first.clone()),
    };
    if patch.needed() {
        hf = Some(patch);
    }
    PrintWrite {
        notes,
        hf,
        page_number_patch,
        drop_orientation,
    }
}

// ---------- 存盘后的定点重打包 ----------

/// 一张表的 worksheet 部件上，crate 写不了的那半边打印设置。
///
/// rust_xlsxwriter 0.99.1 的 `write_header_footer` 只写 oddHeader/oddFooter，`differentOddEven`
/// 与 `differentFirst` 两个属性它一个字都不写；`write_page_setup` 又把起始页码写成
/// `useFirstPageNumber="3"`（OOXML 里那是布尔属性，号码另有 `firstPageNumber`，Excel 自己不这么写）。
/// 所以 odd 交给 crate，剩下的在字节上补一次——只动点名的那张 worksheet 部件，其余原样搬。
pub struct PrintPatch {
    pub sheet_name: String,
    pub hf: Option<HfPatch>,
    /// >0 才要补；crate 把号码落在了布尔属性上
    pub first_page_number: Option<u32>,
    /// 载荷没声明方向：crate 只要写出 `<pageSetup>` 就一定带一枚 `orientation="portrait"`
    /// （`is_portrait` 的默认值就是 true），这一枚要擦掉，否则"没设过"在重开之后变成了"设成纵向"
    pub drop_orientation: bool,
    /// `<sheetFormatPr>` 那一层：crate 只会落它那枚常量 15，文件说的是别的数就得把字节改回来。
    /// 与上面几项同一趟（同一个部件、同一处定点重打包），所以搭在同一枚补丁上
    pub sheet_format: Option<SheetFormat>,
}

impl PrintPatch {
    pub fn noop(&self) -> bool {
        self.hf.is_none()
            && self.first_page_number.filter(|v| *v > 0).is_none()
            && !self.drop_orientation
            && self.sheet_format.is_none()
    }
}

/// 只改这一张表的 worksheet 部件（由 xlsx_cell_side::save_workbook 的重打包那一趟调用）
pub fn patch_part_xml(xml: &str, p: &PrintPatch) -> (String, Vec<String>) {
    let mut accounts = Vec::new();
    let mut out = xml.to_string();
    if let Some(hf) = &p.hf {
        out = patch_header_footer(out, hf, p.sheet_name.as_str(), &mut accounts);
    }
    if let Some(n) = p.first_page_number.filter(|v| *v > 0) {
        out = patch_first_page_number(out, n, p.sheet_name.as_str(), &mut accounts);
    }
    if p.drop_orientation {
        out = patch_orientation(out);
    }
    if let Some(f) = &p.sheet_format {
        out = patch_sheet_format(out, f);
    }
    (out, accounts)
}

/// 擦掉 `<pageSetup>` 上那枚我们没声明过的方向（与 v0.52「只剩默认边距的件归一回不声明」同一条规矩，
/// 所以这里**不记账**）：表格的默认纸是 A4 **横向**，而 crate 写死纵向 ⇒ 留着它，
/// 存一次盘重开就把这张表的纸翻了个面（冒烟里那条 MediaBox 从 [841.9,595] 变成 [595,841.9] 就是这么来的）
fn patch_orientation(xml: String) -> String {
    let Some(el) = find_element(xml.as_str(), "pageSetup") else {
        // 这张表根本没写出 pageSetup（没有方向就没有别的属性要落），自然也没有多出来的属性要擦
        return xml;
    };
    if !el
        .attrs
        .split_whitespace()
        .any(|t| t.starts_with("orientation="))
    {
        return xml;
    }
    let rest = drop_attr(el.attrs, "orientation");
    let attrs = if rest.is_empty() {
        String::new()
    } else {
        format!(" {rest}")
    };
    let element = if el.inner.is_empty() {
        format!("<pageSetup{attrs}/>")
    } else {
        format!("<pageSetup{attrs}>{}</pageSetup>", el.inner)
    };
    format!("{}{element}{}", &xml[..el.start], &xml[el.end..])
}

/// 把 `<sheetFormatPr>` 那一层原样落回字节：只换 `defaultRowHeight` 与 `customHeight` 两枚，
/// 其余属性（`baseColWidth`、`x14ac:dyDescent` 这一类）照搬。
/// 为什么不走 crate：它的 `set_default_row_height` 会把这枚缺省盖成**每一行的显式 `ht`**，
/// 而且内部按整数像素存（17.5pt 存成 17.25）——判别见 `xlsx::tests::crate_default_row_height_setter_stamps_every_row`
fn patch_sheet_format(xml: String, f: &SheetFormat) -> String {
    // 荒谬值在唯一的消费点兜住：0 与负数在这一层就是"没说话"，不许把 `defaultRowHeight="0"` 落到件里
    if !f.default_row_height.is_finite() || f.default_row_height <= 0.0 {
        return xml;
    }
    // 磅字面按 `{}` 出手：17.5 还是 17.5、30.0 写作 30，这一枚不过像素换算，漂不了
    let mut mine = format!(r#"defaultRowHeight="{}""#, f.default_row_height);
    if f.custom_height {
        mine.push_str(r#" customHeight="1""#);
    }
    match find_element(xml.as_str(), "sheetFormatPr") {
        Some(el) => {
            let once = drop_attr(el.attrs, "defaultRowHeight");
            let rest = drop_attr(once.as_str(), "customHeight");
            let keep = if rest.is_empty() {
                String::new()
            } else {
                format!(" {rest}")
            };
            let element = if el.inner.is_empty() {
                format!("<sheetFormatPr {mine}{keep}/>")
            } else {
                format!("<sheetFormatPr {mine}{keep}>{}</sheetFormatPr>", el.inner)
            };
            format!("{}{element}{}", &xml[..el.start], &xml[el.end..])
        }
        // crate 逢表必写这一枚，走到这条支路说明产物形状变了：按 schema 的位置补一枚，别把声明丢了
        None => {
            let at = insert_before(xml.as_str(), &["<cols", "<sheetData"]);
            let (head, tail) = xml.split_at(at);
            format!("{head}<sheetFormatPr {mine}/>{tail}")
        }
    }
}

/// `<headerFooter>` 整块重写：两个开关落属性，even/first 四条串落子元素，
/// odd 那两条**照抄产物里已有的正文**（crate 已经转义过一次，再转就成 `&amp;amp;` 了）
fn patch_header_footer(xml: String, p: &HfPatch, sheet: &str, accounts: &mut Vec<String>) -> String {
    let el = find_element(xml.as_str(), "headerFooter");
    let mut attrs = match el.as_ref() {
        // 开关以载荷为准：上一轮留下的先擦掉，再按这一轮的意思写
        Some(e) => {
            let mut a = drop_attr(e.attrs, "differentOddEven");
            a = drop_attr(a.as_str(), "differentFirst");
            a
        }
        None => String::new(),
    };
    let mut body = String::new();
    if let Some(e) = el.as_ref() {
        // 子元素顺序照 ECMA-376 的 CT_HeaderFooter：odd 在前，even 居中，first 在后
        for t in ["oddHeader", "oddFooter"] {
            let Some(raw) = raw_child(e.inner, t) else {
                continue;
            };
            body.push('<');
            body.push_str(t);
            body.push('>');
            body.push_str(raw);
            body.push_str("</");
            body.push_str(t);
            body.push('>');
        }
    }
    for (tag, text) in [
        ("evenHeader", p.even_header.as_deref()),
        ("evenFooter", p.even_footer.as_deref()),
        ("firstHeader", p.first_header.as_deref()),
        ("firstFooter", p.first_footer.as_deref()),
    ] {
        let Some(text) = text.filter(|v| !v.is_empty()) else {
            continue;
        };
        body.push('<');
        body.push_str(tag);
        body.push('>');
        body.push_str(esc_xml(text).as_str());
        body.push_str("</");
        body.push_str(tag);
        body.push('>');
    }
    if p.different_odd_even {
        attrs.push_str(" differentOddEven=\"1\"");
    }
    if p.different_first {
        attrs.push_str(" differentFirst=\"1\"");
    }
    let attrs = attrs.split_whitespace().collect::<Vec<_>>().join(" ");
    let attrs = if attrs.is_empty() {
        String::new()
    } else {
        format!(" {attrs}")
    };
    match el {
        Some(e) => {
            let element = if body.is_empty() {
                format!("<headerFooter{attrs}/>")
            } else {
                format!("<headerFooter{attrs}>{body}</headerFooter>")
            };
            format!("{}{element}{}", &xml[..e.start], &xml[e.end..])
        }
        // 元素本来不存在（这张表一条页眉页脚都没写出去）：按 OOXML 的子元素顺序插在后面那批之前
        None => {
            if body.is_empty() {
                if attrs.is_empty() {
                    accounts.push(format!("打印设置·{sheet} 的页眉页脚只剩开关，文件里没有可落的位置，没写"));
                }
                return xml;
            }
            let at = insert_before(xml.as_str(), &AFTER_HEADER);
            format!("{}<headerFooter{attrs}>{body}</headerFooter>{}", &xml[..at], &xml[at..])
        }
    }
}

/// `<headerFooter>` 之后才允许出现的兄弟元素（插入位置取其中最靠前的一个）
const AFTER_HEADER: [&str; 9] = [
    "<rowBreaks",
    "<colBreaks",
    "<ignoredErrors",
    "<picture",
    "<oleObjects",
    "<controls",
    "<tableParts",
    "<extLst",
    "</worksheet>",
];

fn patch_first_page_number(xml: String, n: u32, sheet: &str, accounts: &mut Vec<String>) -> String {
    let pat = format!("useFirstPageNumber=\"{n}\"");
    let want = format!("useFirstPageNumber=\"1\" firstPageNumber=\"{n}\"");
    match xml.matches(pat.as_str()).count() {
        1 => xml.replace(pat.as_str(), want.as_str()),
        _ => {
            accounts.push(format!(
                "打印设置·{sheet} 的起始页码 {n} 没能落进文件（产物里那条属性长得不合预期），宁可不动"
            ));
            xml
        }
    }
}

/// 标签片段：属性正文与子元素正文都按字节切好，改动只在 [start,end) 这一段里
struct Element<'a> {
    attrs: &'a str,
    inner: &'a str,
    start: usize,
    end: usize,
}

fn find_element<'a>(xml: &'a str, tag: &str) -> Option<Element<'a>> {
    let open = format!("<{tag}");
    let start = xml.find(open.as_str())?;
    let rest = &xml[start + open.len()..];
    // `<headerFooterFoo` 不算命中，标签名后面只能跟空白、'>' 或 "/>"
    let next = rest.as_bytes().first()?;
    if !(next.is_ascii_whitespace() || *next == b'>' || *next == b'/') {
        return None;
    }
    let gt = find_tag_end(rest)?;
    let head = rest[..gt].trim_end();
    let attrs = head.strip_suffix('/').unwrap_or(head).trim_end();
    let body_start = start + open.len() + gt + 1;
    if head.ends_with('/') {
        return Some(Element {
            attrs,
            inner: "",
            start,
            end: body_start,
        });
    }
    let close = format!("</{tag}>");
    let rel = xml[body_start..].find(close.as_str())?;
    Some(Element {
        attrs,
        inner: &xml[body_start..body_start + rel],
        start,
        end: body_start + rel + close.len(),
    })
}

/// 引号感性地找 start tag 收尾的那个 '>'
fn find_tag_end(s: &str) -> Option<usize> {
    let b = s.as_bytes();
    let mut quote: Option<u8> = None;
    for (i, c) in b.iter().enumerate() {
        match quote {
            Some(q) if *c == q => quote = None,
            Some(_) => {}
            None if *c == b'"' || *c == b'\'' => quote = Some(*c),
            None if *c == b'>' => return Some(i),
            None => {}
        }
    }
    None
}

/// 子元素的原始正文（连转义一起照抄，不再动它）
fn raw_child<'a>(inner: &'a str, tag: &str) -> Option<&'a str> {
    let open = format!("<{tag}>");
    let i = inner.find(open.as_str())? + open.len();
    let rel = inner[i..].find(format!("</{tag}>").as_str())?;
    Some(&inner[i..i + rel])
}

/// 擦掉一个属性（headerFooter 上 crate 只写得出手里这几个不带空格的属性，按空白切 token 就够）
fn drop_attr(attrs: &str, key: &str) -> String {
    let pre = format!("{key}=");
    attrs
        .split_whitespace()
        .filter(|t| !t.starts_with(pre.as_str()))
        .collect::<Vec<_>>()
        .join(" ")
}

fn insert_before(xml: &str, tags: &[&str]) -> usize {
    tags.iter()
        .filter_map(|t| xml.find(t))
        .min()
        .unwrap_or_else(|| xml.rfind("</worksheet>").unwrap_or(xml.len()))
}

/// 只有三条标准转义：页眉页脚串里的 `&` 是格式码（`&P`＝页码），Excel 就是按 `&amp;P` 存的
fn esc_xml(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::xlsx::{read_xlsx_sync, write_xlsx_sync, CellPayload, WorkbookPayload};
    use serde_json::Value as Json;

    fn tmp(tag: &str) -> String {
        std::env::temp_dir()
            .join(format!("openoffices-print-{}-{}.xlsx", tag, std::process::id()))
            .to_string_lossy()
            .to_string()
    }

    fn entry(path: &str, name: &str) -> String {
        let file = File::open(path).expect("打开产物失败");
        let mut zip = zip::ZipArchive::new(file).expect("产物不是 zip");
        read_entry(&mut zip, name).unwrap_or_else(|| panic!("产物里没有 {name}"))
    }

    /// 每一项都挑一个「能在字节里核对」的值：纸张 9＝A4、缩放 85、起始页码 7
    fn setup() -> SheetPrintPayload {
        SheetPrintPayload {
            orientation: Some("landscape".into()),
            paper_size: Some(9),
            scale: Some(85),
            page_order: Some("overThenDown".into()),
            margins: Some(PrintMarginsPayload {
                top: Some(0.4),
                right: Some(0.5),
                bottom: Some(0.6),
                left: Some(0.75),
                header: Some(0.2),
                footer: Some(0.25),
            }),
            h_centered: Some(true),
            headings: Some(true),
            first_page_number: Some(7),
            grid_lines: Some(true),
            odd_even: true,
            first_differs: true,
            header: Some(PrintHfPayload {
                odd: Some("第 &P 页 / 共 &N 页".into()),
                even: Some("偶数页 &A".into()),
                first: Some("首页 &D".into()),
            }),
            footer: Some(PrintHfPayload {
                odd: Some("表脚 &F".into()),
                ..Default::default()
            }),
            print_area: Some(RangeRect {
                start_row: 1,
                start_column: 2,
                end_row: 4,
                end_column: 5,
            }),
            title_rows: Some([0, 1]),
            title_cols: Some([0, 1]),
            row_breaks: vec![3],
            col_breaks: vec![2],
            ..Default::default()
        }
    }

    fn book(print: SheetPrintPayload) -> WorkbookPayload {
        WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "纸样".into(),
                cells: (0..6)
                    .map(|r| CellPayload {
                        r,
                        c: 0,
                        v: Some(Json::String(format!("值{r}"))),
                        ..Default::default()
                    })
                    .collect(),
                print: Some(print),
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    /// 一张从没设置过纸面的表：载荷里没有 print，但写侧的 crate 照样会替它落一档 `<pageMargins>`
    fn book_without_setup() -> WorkbookPayload {
        WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "白纸".into(),
                cells: vec![CellPayload {
                    r: 0,
                    c: 0,
                    v: Some(Json::String("值".into())),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    #[test]
    fn default_page_margins_alone_are_not_a_declaration() {
        // 「清除这张表的设置 → 存盘 → 重开」要真的回到没声明：默认边距冒充声明就是清除没生效
        let path = tmp("no-decl");
        write_xlsx_sync(path.clone(), book_without_setup()).expect("写出失败");
        let ws = entry(&path, "xl/worksheets/sheet1.xml");
        assert!(
            ws.contains("<pageMargins"),
            "写侧没落默认边距，这条测试的前提就变了：\n{ws}"
        );
        assert!(!ws.contains("<pageSetup"), "从没设置过纸面的表不该写出 pageSetup");
        let back = read_xlsx_sync(path).expect("读回失败");
        assert!(
            back.sheets[0].print.is_none(),
            "只有默认边距的表被当成了「声明过纸面」：{:?}",
            back.sheets[0].print
        );
    }

    #[test]
    fn margins_outside_the_default_still_count_as_a_declaration() {
        // 反方向：只设过边距（且不是那一档）的表仍是声明，不能被上一条规则顺手抹掉
        let path = tmp("margins-only");
        let mut only = SheetPrintPayload::default();
        only.margins = Some(PrintMarginsPayload {
            left: Some(1.2),
            ..Default::default()
        });
        write_xlsx_sync(path.clone(), book(only)).expect("写出失败");
        let back = read_xlsx_sync(path).expect("读回失败");
        let p = back.sheets[0]
            .print
            .clone()
            .unwrap_or_else(|| panic!("只设了左边距的表被判成没声明"));
        assert!(
            p.margins.as_ref().is_some_and(|m| !m.is_all_default()),
            "读回来的边距又变回默认那一档：{:?}",
            p.margins
        );
        assert_eq!(p.margins.as_ref().and_then(|m| m.left), Some(1.2));
    }

    #[test]
    fn print_setup_lands_in_the_xml() {
        let path = tmp("land");
        let notes = write_xlsx_sync(path.clone(), book(setup())).expect("写出失败");
        // 每一项都摆得进去，就不该有一条打印设置的账
        assert!(
            notes.iter().all(|n| !n.contains("打印设置")),
            "全摆得进去却记了账：{notes:?}"
        );
        let ws = entry(&path, "xl/worksheets/sheet1.xml");
        for probe in [
            "orientation=\"landscape\"",
            "paperSize=\"9\"",
            "scale=\"85\"",
            "pageOrder=\"overThenDown\"",
            "horizontalCentered=\"1\"",
            "headings=\"1\"",
            "gridLines=\"1\"",
            "left=\"0.75\"",
            "right=\"0.5\"",
            "top=\"0.4\"",
            "bottom=\"0.6\"",
            "header=\"0.2\"",
            "footer=\"0.25\"",
            "<brk id=\"3\" max=\"16383\" man=\"1\"/>",
            "<brk id=\"2\" max=\"1048575\" man=\"1\"/>",
            "<oddHeader>第 &amp;P 页 / 共 &amp;N 页</oddHeader>",
            "<oddFooter>表脚 &amp;F</oddFooter>",
            "<evenHeader>偶数页 &amp;A</evenHeader>",
            "<firstHeader>首页 &amp;D</firstHeader>",
            "differentOddEven=\"1\"",
            "differentFirst=\"1\"",
            // crate 把号码落在了布尔属性上，补过之后才是 Excel 认的形状
            "useFirstPageNumber=\"1\" firstPageNumber=\"7\"",
        ] {
            assert!(ws.contains(probe), "产物里少了「{probe}」：\n{ws}");
        }
        assert!(!ws.contains("useFirstPageNumber=\"7\""), "起始页码仍落在布尔属性上");
        assert!(!ws.contains("&amp;amp;"), "页眉页脚被转义了两次");
        let at = |t: &str| ws.find(t).unwrap_or_else(|| panic!("产物里没有 {t}"));
        // 兄弟元素次序：pageSetup 之后、rowBreaks 之前；CT_HeaderFooter 内部 odd→even→first
        assert!(at("<pageSetup") < at("<headerFooter"));
        assert!(at("<headerFooter") < at("<rowBreaks"));
        assert!(at("<rowBreaks") < at("<colBreaks"));
        assert!(at("<oddHeader>") < at("<oddFooter>"));
        assert!(at("<oddFooter>") < at("<evenHeader>"));
        assert!(at("<evenHeader>") < at("<firstHeader>"));
        let wb = entry(&path, "xl/workbook.xml");
        assert!(
            wb.contains("_xlnm.Print_Area") && wb.contains("$C$2:$F$5"),
            "打印区域没落成 definedName：\n{wb}"
        );
        // 标题行与标题列共用一条 Print_Titles，两个片段都在里头
        let titles = wb
            .split("<definedName")
            .find(|s| s.contains("_xlnm.Print_Titles"))
            .unwrap_or_else(|| panic!("没有 Print_Titles：\n{wb}"));
        assert!(
            titles.contains("$A:$B") && titles.contains("$1:$2"),
            "Print_Titles 片段不全：{titles}"
        );
    }

    #[test]
    fn print_setup_round_trips_through_our_own_file() {
        let path = tmp("rt");
        write_xlsx_sync(path.clone(), book(setup())).expect("写出失败");
        let back = read_xlsx_sync(path).expect("读回失败");
        assert!(
            !back.warnings.iter().any(|w| w.contains("打印") || w.contains("页面设置")),
            "自己写的件不该记出打印账：{:?}",
            back.warnings
        );
        let p = back.sheets[0].print.clone().expect("打印设置整个没读回来");
        let want = setup();
        assert_eq!(p.orientation, want.orientation);
        assert_eq!(p.paper_size, want.paper_size);
        assert_eq!(p.scale, want.scale);
        assert_eq!(p.page_order, want.page_order);
        assert_eq!(p.h_centered, Some(true));
        assert_eq!(p.headings, Some(true));
        assert_eq!(p.grid_lines, Some(true));
        assert_eq!(p.fit_to_page, false);
        assert_eq!(
            p.first_page_number,
            Some(7),
            "起始页码读不回来＝补的那一刀没生效（crate 写在布尔属性上的值我们按 false 收）"
        );
        assert!(p.odd_even && p.first_differs, "两个开关没读回来");
        let m = p.margins.expect("边距没读回来");
        assert_eq!(
            (m.top, m.right, m.bottom, m.left, m.header, m.footer),
            (Some(0.4), Some(0.5), Some(0.6), Some(0.75), Some(0.2), Some(0.25))
        );
        let h = p.header.expect("页眉没读回来");
        // &-码要原样回来：既不能留着 &amp;，也不能把 & 整个吞掉
        assert_eq!(h.odd.as_deref(), Some("第 &P 页 / 共 &N 页"));
        assert_eq!(h.even.as_deref(), Some("偶数页 &A"));
        assert_eq!(h.first.as_deref(), Some("首页 &D"));
        let f = p.footer.expect("页脚没读回来");
        assert_eq!(f.odd.as_deref(), Some("表脚 &F"));
        assert_eq!(f.even, None, "没写过的档不该凭空读出一条");
        assert_eq!(p.print_area, want.print_area);
        assert_eq!(p.title_rows, Some([0, 1]));
        assert_eq!(p.title_cols, Some([0, 1]));
        assert_eq!(p.row_breaks, vec![3]);
        assert_eq!(p.col_breaks, vec![2]);
    }

    #[test]
    fn print_setup_survives_a_second_save() {
        let first = tmp("s2a");
        write_xlsx_sync(first.clone(), book(setup())).expect("第一次写出失败");
        let second = tmp("s2b");
        let again = read_xlsx_sync(first.clone()).expect("读回失败");
        let notes = write_xlsx_sync(second.clone(), again).expect("第二次写出失败");
        assert!(
            notes.iter().all(|n| !n.contains("打印设置")),
            "第二轮冒出打印账：{notes:?}"
        );
        let a = entry(&first, "xl/worksheets/sheet1.xml");
        let b = entry(&second, "xl/worksheets/sheet1.xml");
        for probe in [
            "<oddHeader>第 &amp;P 页 / 共 &amp;N 页</oddHeader>",
            "<evenHeader>偶数页 &amp;A</evenHeader>",
            "<firstHeader>首页 &amp;D</firstHeader>",
            "differentOddEven=\"1\"",
            "useFirstPageNumber=\"1\" firstPageNumber=\"7\"",
            "<printOptions horizontalCentered=\"1\" headings=\"1\" gridLines=\"1\"/>",
        ] {
            assert!(b.contains(probe), "存一次就丢了「{probe}」");
        }
        // 重存是擦掉重写，不是往上叠加
        assert_eq!(b.matches("<headerFooter").count(), a.matches("<headerFooter").count());
        assert_eq!(b.matches("<oddHeader>").count(), 1);
        assert_eq!(b.matches("differentOddEven").count(), 1);
        assert_eq!(b.matches(" firstPageNumber=").count(), 1);
    }

    #[test]
    fn print_ledger_records_what_cant_be_written() {
        let path = tmp("ledger");
        let mut p = setup();
        // 行列号（headings）这一版已经写得回去了，摆不进 OOXML 的是这几样
        p.headings = Some(false);
        p.orientation = Some("sideways".into());
        p.scale = Some(5);
        p.first_page_number = Some(0);
        let notes = write_xlsx_sync(path.clone(), book(p)).expect("写出失败");
        for want in ["方向「sideways」", "缩放比例 5%", "起始页码写了 0"] {
            assert!(
                notes.iter().any(|n| n.contains(want)),
                "没记上「{want}」这一笔：{notes:?}"
            );
        }
        let ws = entry(&path, "xl/worksheets/sheet1.xml");
        // 认不出的方向不许顺手写成 landscape，越界的缩放不许写成 scale="5"
        assert!(!ws.contains("orientation=\"landscape\""), "认不出的方向被冒充成了横向");
        assert!(!ws.contains("scale=\"5\""), "越界的缩放被硬写了进去");
        assert!(
            !ws.contains("headings="),
            "headings=false 却往 printOptions 里写了 headings（crate 只会开不会关，开了就不该写）"
        );
    }

    #[test]
    fn print_setup_inserts_a_missing_header_footer() {
        let path = tmp("insert");
        let mut p = setup();
        // 一条 odd 都没有：crate 连 <headerFooter> 都不写出，even 那半只能靠插
        p.header = Some(PrintHfPayload {
            even: Some("偶数页 &A".into()),
            ..Default::default()
        });
        p.footer = None;
        p.first_differs = false;
        p.first_page_number = Some(3);
        let notes = write_xlsx_sync(path.clone(), book(p)).expect("写出失败");
        assert!(
            notes.iter().all(|n| !n.contains("打印设置")),
            "只剩开关也算摆不下？{notes:?}"
        );
        let ws = entry(&path, "xl/worksheets/sheet1.xml");
        assert!(!ws.contains("<oddHeader>"), "没写 odd 却冒出一条");
        assert!(
            ws.contains("<headerFooter differentOddEven=\"1\"><evenHeader>偶数页 &amp;A</evenHeader></headerFooter>"),
            "插出来的元素长得不合预期：\n{ws}"
        );
        // 插的位置仍在 pageSetup 之后、rowBreaks 之前，兄弟次序不能破
        assert!(ws.find("<pageSetup").unwrap() < ws.find("<headerFooter").unwrap());
        assert!(ws.find("<headerFooter").unwrap() < ws.find("<rowBreaks").unwrap());
        assert!(ws.contains("useFirstPageNumber=\"1\" firstPageNumber=\"3\""));
    }

    #[test]
    fn hf_switch_off_is_written_and_on_is_undeclared() {
        let path = tmp("hf-switch");
        let mut p = setup();
        p.scale_with_doc = Some(false);
        // 开着（Excel 的默认勾）不该往文件里多写一笔：写了就等于替用户声明了他没设过的东西
        p.align_with_margins = Some(true);
        write_xlsx_sync(path.clone(), book(p)).expect("写出失败");
        let ws = entry(&path, "xl/worksheets/sheet1.xml");
        assert!(
            ws.contains("scaleWithDoc=\"0\""),
            "关着的那枚没落进 XML：\n{ws}"
        );
        assert!(
            !ws.contains("alignWithMargins"),
            "开着的一枚被写成了声明：\n{ws}"
        );
        let q = read_xlsx_sync(path)
            .expect("读回失败")
            .sheets[0]
            .print
            .clone()
            .expect("读回时整块纸面设置没了");
        assert_eq!(q.scale_with_doc, Some(false));
        assert_eq!(
            q.align_with_margins, None,
            "Some(true) 存出去就是不声明，读回来不许凭空长出 true"
        );
    }

    #[test]
    fn hf_switches_survive_a_second_save() {
        // 打开 → 原样存一次：补写页眉页脚的那趟只擦自家那两枚开关，crate 写的这两枚得活着
        let path = tmp("hf-switch-again");
        let mut p = setup();
        p.scale_with_doc = Some(false);
        p.align_with_margins = Some(false);
        write_xlsx_sync(path.clone(), book(p.clone())).expect("第一次写出失败");
        let again = read_xlsx_sync(path.clone()).expect("读回失败");
        write_xlsx_sync(path.clone(), again).expect("第二次写出失败");
        let ws = entry(&path, "xl/worksheets/sheet1.xml");
        for want in ["scaleWithDoc=\"0\"", "alignWithMargins=\"0\""] {
            assert!(ws.contains(want), "存了两次以后 {want} 不见了：\n{ws}");
        }
        let q = read_xlsx_sync(path)
            .expect("再读失败")
            .sheets[0]
            .print
            .clone()
            .expect("第二次读回整块没了");
        assert_eq!(q.scale_with_doc, Some(false));
        assert_eq!(q.align_with_margins, Some(false));
    }

    #[test]
    fn hf_switch_written_as_one_is_the_same_as_not_written() {
        // 别的工具写出的件里可能出现显式的 "1"：与不写字节不同、语义相同，归一回不声明
        let (off, _) = read_sheet_print(
            "<worksheet><headerFooter scaleWithDoc=\"0\" alignWithMargins=\"1\"><oddHeader>&amp;A</oddHeader></headerFooter></worksheet>",
        );
        assert_eq!(off.scale_with_doc, Some(false));
        assert_eq!(off.align_with_margins, None);
        let (plain, _) = read_sheet_print(
            "<worksheet><headerFooter><oddHeader>&amp;A</oddHeader></headerFooter></worksheet>",
        );
        assert_eq!(plain.scale_with_doc, None);
        assert_eq!(plain.align_with_margins, None);
    }

    #[test]
    fn print_area_shapes_that_dont_fit_are_accounted_not_guessed() {
        // 整行/整列式的打印区域装不进矩形载荷：parse_area 给不出 rect，调用方记一条而不是当没设
        let rows = parse_area("纸样!$1:$2").expect("整行形状本该认得");
        assert!(rows.rect.is_none(), "整行被当成了矩形");
        assert_eq!(rows.rows, Some([0, 1]));
        let cols = parse_area("纸样!$A:$B").expect("整列形状本该认得");
        assert!(cols.rect.is_none(), "整列被当成了矩形");
        assert_eq!(cols.cols, Some([0, 1]));
        let both = parse_area("纸样!$A:$B,纸样!$1:$2").expect("一条里两个片段");
        assert!(both.rect.is_none() && both.rows == Some([0, 1]) && both.cols == Some([0, 1]));
        let rect = parse_area("纸样!$C$2:$F$5").expect("矩形区域");
        assert_eq!(
            rect.rect,
            Some(RangeRect {
                start_row: 1,
                start_column: 2,
                end_row: 4,
                end_column: 5
            })
        );
        assert!(parse_area("纸样!不是区域").is_none(), "认不出的形状宁可整条不收");
    }

    #[test]
    fn page_number_patch_refuses_when_the_shape_is_not_ours() {
        // 产物里那条属性一次都没有（别人的件，或 crate 改了形状）：记账，不动字节
        let p = PrintPatch {
            sheet_name: "纸样".into(),
            hf: None,
            first_page_number: Some(7),
            drop_orientation: false,
            sheet_format: None,
        };
        let xml = "<worksheet><pageSetup orientation=\"portrait\"/></worksheet>";
        let (out, accounts) = patch_part_xml(xml, &p);
        assert_eq!(out, xml, "数不上却动了字节");
        assert!(
            accounts.iter().any(|a| a.contains("起始页码 7")),
            "没落进去又不记账：{accounts:?}"
        );
        assert!(PrintPatch {
            sheet_name: "纸样".into(),
            hf: None,
            first_page_number: Some(0),
            drop_orientation: false,
            sheet_format: None
        }
        .noop());
    }

    #[test]
    fn undeclared_orientation_does_not_come_back_as_portrait() {
        // crate 给每张有 pageSetup 的表都补一枚 orientation="portrait"：载荷没声明方向就得把它擦掉，
        // 否则"从没设过"存一次盘就变成"设成纵向"，而我们表格的默认纸是 A4 横向
        let p = PrintPatch {
            sheet_name: "纸样".into(),
            hf: None,
            first_page_number: None,
            drop_orientation: true,
            sheet_format: None,
        };
        assert!(!p.noop(), "只欠一次擦除也要走重打包那一趟");
        let xml = "<worksheet><pageSetup paperSize=\"9\" orientation=\"portrait\" scale=\"85\"/></worksheet>";
        let (out, accounts) = patch_part_xml(xml, &p);
        assert!(!out.contains("orientation"), "擦完还留着方向：{out}");
        assert!(
            out.contains("<pageSetup paperSize=\"9\" scale=\"85\"/>"),
            "其余属性得原样还在：{out}"
        );
        assert!(
            accounts.is_empty(),
            "这是一次归一（与默认边距同一条规矩），不是「做不到」：{accounts:?}"
        );
        // 方向是我们自己声明出去的：一个字都不许动
        let bare = "<worksheet><pageSetup orientation=\"portrait\"/></worksheet>";
        let (out, _) = patch_part_xml(bare, &p);
        assert_eq!(out, "<worksheet><pageSetup/></worksheet>");
        // 别人的文件里 pageSetup 压根没有方向（或整块不存在）：不动字节、不记账
        let (out, accounts) = patch_part_xml("<worksheet><pageSetup scale=\"85\"/></worksheet>", &p);
        assert_eq!(out, "<worksheet><pageSetup scale=\"85\"/></worksheet>");
        assert!(accounts.is_empty(), "没擦东西却报了账：{accounts:?}");
        let (out, _) = patch_part_xml("<worksheet><cols/></worksheet>", &p);
        assert_eq!(out, "<worksheet><cols/></worksheet>", "没有 pageSetup 也不许报错");
        let declared = PrintPatch {
            drop_orientation: false,
            ..p
        };
        let (out, _) = patch_part_xml(
            "<worksheet><pageSetup orientation=\"landscape\"/></worksheet>",
            &declared,
        );
        assert!(
            out.contains("orientation=\"landscape\""),
            "声明过的方向被擦了：{out}"
        );
    }

    #[test]
    fn undeclared_orientation_stays_undeclared_through_a_real_save() {
        // 这一条走的是完整链路（crate + 重打包 + 读侧），量的是"面板没碰方向"那张表的纸：
        // 擦除只发生在 patch_part_xml 里，而那一趟只有非 noop 的补丁才会跑
        let mut p = setup();
        p.orientation = None;
        let path = tmp("noorient");
        write_xlsx_sync(path.clone(), book(p)).expect("写出失败");
        let ws = entry(&path, "xl/worksheets/sheet1.xml");
        assert!(ws.contains("<pageSetup"), "这张表有纸张/缩放，pageSetup 该在：{ws}");
        assert!(
            !ws.contains("orientation="),
            "crate 补写的那枚方向没被擦掉，重开就会把横向纸翻成纵向：{ws}"
        );
        let back = read_xlsx_sync(path).expect("读回失败");
        let got = back.sheets[0].print.clone().expect("打印设置整个没读回来");
        assert_eq!(got.orientation, None, "没声明过的方向读回来有了值");
        assert_eq!(got.paper_size, Some(9), "擦方向不许连别的属性一起带走");
        assert_eq!(got.scale, Some(85));
    }

    #[test]
    fn default_row_height_lands_in_the_literal_and_leaves_rows_bare() {
        // 判别：这一层走定点重打包，不吃 crate 的 set_default_row_height——
        // 那枚 setter 会把这一层缺省盖成**每一行的显式 ht**，还把 17.5 磅按整数像素存成 17.25
        // （见 `xlsx::tests::crate_default_row_height_setter_stamps_every_row`）
        let mut wb = book(setup());
        wb.sheets[0].sheet_format = Some(SheetFormat {
            default_row_height: 17.5,
            custom_height: false,
        });
        let path = tmp("drh");
        write_xlsx_sync(path.clone(), wb).expect("写出失败");
        let ws = entry(&path, "xl/worksheets/sheet1.xml");
        let el = find_element(ws.as_str(), "sheetFormatPr").expect("缺省行高那一层整个不见了");
        assert!(
            el.attrs.contains(r#"defaultRowHeight="17.5""#),
            "磅字面被换算漂了：{}",
            el.attrs
        );
        assert!(!ws.contains("17.25"), "又走了 crate 的像素换算：{ws}");
        assert!(
            !el.attrs.contains("customHeight"),
            "载荷没声明 customHeight 却落了一枚：{}",
            el.attrs
        );
        let rows = ws.matches("<row ").count();
        assert_eq!(rows, 6, "夹具的六行没了，下面那条「行没被盖章」就是空断言：{ws}");
        let stamped = ws
            .split("<row")
            .skip(1)
            .filter(|r| r.starts_with(' ') && r.contains(" ht="))
            .count();
        assert_eq!(stamped, 0, "缺省行高被盖成了每一行的显式行高：{ws}");
        let back = read_xlsx_sync(path).expect("读回失败");
        assert_eq!(
            back.sheets[0].sheet_format,
            Some(SheetFormat {
                default_row_height: 17.5,
                custom_height: false
            }),
            "写了却读不回来＝这一趟重打包没生效"
        );
        // 存盘是整包重写：第二次存还得带着这一枚（读得回来只证明了一半）
        let again = SheetFormat {
            default_row_height: 17.5,
            custom_height: false,
        };
        let path3 = tmp("drh2");
        write_xlsx_sync(path3.clone(), back).expect("二次写出失败");
        let ws3 = entry(&path3, "xl/worksheets/sheet1.xml");
        assert!(
            ws3.contains(r#"defaultRowHeight="17.5""#) && !ws3.contains("17.25"),
            "第二次存盘把这一枚丢了或漂了：{ws3}"
        );
        assert_eq!(
            read_xlsx_sync(path3).expect("读回失败").sheets[0].sheet_format,
            Some(again),
            "二次存盘后读不回来"
        );

        // customHeight 只有载荷明说才落，磅字面按 `{}` 出手（30.0 写作 30，不掺换算）
        let mut wb2 = book(setup());
        wb2.sheets[0].sheet_format = Some(SheetFormat {
            default_row_height: 30.0,
            custom_height: true,
        });
        let path2 = tmp("drh30");
        write_xlsx_sync(path2.clone(), wb2).expect("写出失败");
        let ws2 = entry(&path2, "xl/worksheets/sheet1.xml");
        let el2 = find_element(ws2.as_str(), "sheetFormatPr").expect("缺省行高那一层整个不见了");
        assert!(
            el2.attrs.contains(r#"defaultRowHeight="30""#) && el2.attrs.contains(r#"customHeight="1""#),
            "关着的那一枚没跟着落：{}",
            el2.attrs
        );
    }

    #[test]
    fn undeclared_default_row_height_leaves_the_crate_fifteen_alone() {
        // 载荷没说 ⇒ 这一趟不 patch 这一枚，crate 自己那枚 15 原地留着（省声明与写声明是同一份语义：
        // ECMA 的 `@defaultRowHeight` 缺省正是 15，与 v0.52 那枚默认 `<pageMargins>` 同一条归一）
        let path = tmp("drh-silent");
        write_xlsx_sync(path.clone(), book(setup())).expect("写出失败");
        let ws = entry(&path, "xl/worksheets/sheet1.xml");
        let el = find_element(ws.as_str(), "sheetFormatPr").expect("crate 那枚缺省该还在");
        assert!(
            el.attrs.contains(r#"defaultRowHeight="15""#) && !el.attrs.contains("customHeight"),
            "没说却动了字节：{}",
            el.attrs
        );
        assert_eq!(
            read_xlsx_sync(path).expect("读回失败").sheets[0].sheet_format,
            None,
            "15 不带 customHeight 在这一层就是没说话"
        );
        // 反例：只欠这一层的补丁不许算 noop，否则整趟重打包被跳过、这一枚就丢了
        assert!(
            !PrintPatch {
                sheet_name: "纸样".into(),
                hf: None,
                first_page_number: None,
                drop_orientation: false,
                sheet_format: Some(SheetFormat {
                    default_row_height: 17.5,
                    custom_height: false
                })
            }
            .noop(),
            "只带缺省行高的补丁被当成 noop 了"
        );
    }

    #[test]
    fn sheet_format_patch_rewrites_only_its_two_attributes() {
        let p = |h: f64, c: bool| PrintPatch {
            sheet_name: "纸样".into(),
            hf: None,
            first_page_number: None,
            drop_orientation: false,
            sheet_format: Some(SheetFormat {
                default_row_height: h,
                custom_height: c,
            }),
        };
        // 其余属性照搬（`baseColWidth` 这一类是别人文件里带来的），而旧的那枚 customHeight 我们没说时得擦
        let xml = r#"<worksheet><sheetFormatPr defaultRowHeight="15" customHeight="1" baseColWidth="8"/><sheetData/></worksheet>"#;
        let (out, ac) = patch_part_xml(xml, &p(17.5, false));
        assert!(ac.is_empty(), "这是自家的落笔，不是「做不到」：{ac:?}");
        let el = find_element(out.as_str(), "sheetFormatPr").expect("改没了");
        assert!(
            el.attrs.contains(r#"defaultRowHeight="17.5""#) && el.attrs.contains(r#"baseColWidth="8""#),
            "该留的没留或该换的没换：{}",
            el.attrs
        );
        assert!(
            !el.attrs.contains("customHeight"),
            "载荷没说的开关却留着别人那枚 1：{}",
            el.attrs
        );
        let (out2, _) = patch_part_xml(
            r#"<worksheet><sheetFormatPr defaultRowHeight="15"/></worksheet>"#,
            &p(20.0, true),
        );
        assert!(
            out2.contains(r#"<sheetFormatPr defaultRowHeight="20" customHeight="1"/>"#),
            "{out2}"
        );
        // 产物里压根没有这一枚（别人的件）：按 schema 的位置补一枚，别把声明丢了
        let (out3, _) = patch_part_xml(
            r#"<worksheet><sheetData><row r="1"/></sheetData></worksheet>"#,
            &p(22.5, false),
        );
        assert!(
            out3.starts_with(r#"<worksheet><sheetFormatPr defaultRowHeight="22.5"/>"#),
            "补的位置不对：{out3}"
        );
        // 荒谬值在唯一的消费点兜住：0/负数/NaN 都不许落到件里（与 v0.57 那枚 fs 同一分寸）
        for bad in [0.0, -3.0, f64::NAN] {
            let bare = r#"<worksheet><sheetFormatPr defaultRowHeight="15"/></worksheet>"#;
            let (out4, ac4) = patch_part_xml(bare, &p(bad, false));
            assert_eq!(out4, bare, "{bad} 不该动字节");
            assert!(ac4.is_empty(), "不动字节也不报错账：{ac4:?}");
        }
    }

    #[test]
    fn fit_to_page_absent_width_and_height_are_one_not_undeclared() {
        // crate 的 write_page_setup 在 fit_width/fit_height 等于 1 时**不写那一枚**（`!= 1` 才写），
        // 而 OOXML 里缺省正是 1 ⇒ 不归一就是把"缩放到 1 页高"读成了"没缩放到页高"
        let mut p = setup();
        p.scale = None;
        p.fit_to_page = true;
        p.fit_to_width = None;
        p.fit_to_height = Some(2);
        let path = tmp("fit1");
        write_xlsx_sync(path.clone(), book(p.clone())).expect("写出失败");
        let ws = entry(&path, "xl/worksheets/sheet1.xml");
        assert!(
            ws.contains("fitToPage=\"1\"") && !ws.contains("fitToWidth="),
            "页宽那一枚本该被 crate 省掉：{ws}"
        );
        let got = read_xlsx_sync(path.clone())
            .expect("读回失败")
            .sheets[0]
            .print
            .clone()
            .expect("打印设置整个没读回来");
        assert_eq!(got.fit_to_page, true);
        assert_eq!(got.fit_to_width, Some(1), "省掉的页宽读回来该是 1 而不是没有");
        assert_eq!(got.fit_to_height, Some(2));
        // 两枚都省（缩放到 1×1 页）：归一后仍是"1 页宽 1 页高"，而不是"没开这一档"
        let mut both = p.clone();
        both.fit_to_height = None;
        let wide = tmp("fit2");
        write_xlsx_sync(wide.clone(), book(both.clone())).expect("写出失败");
        let ws = entry(&wide, "xl/worksheets/sheet1.xml");
        assert!(!ws.contains("fitToHeight="), "这一档两枚都该被省掉：{ws}");
        let got = read_xlsx_sync(wide)
            .expect("读回失败")
            .sheets[0]
            .print
            .clone()
            .expect("打印设置整个没读回来");
        assert_eq!(
            (got.fit_to_width, got.fit_to_height),
            (Some(1), Some(1)),
            "「缩放到 1 页」与「没开缩放」必须是两句话"
        );
        // 没开 fitToPage 的件不许被归一：那一档的 fitToWidth/Height 在 Excel 里根本不参与说话
        let plain = tmp("fit3");
        let mut off = p.clone();
        off.fit_to_page = false;
        off.fit_to_width = None;
        off.fit_to_height = None;
        write_xlsx_sync(plain.clone(), book(off)).expect("写出失败");
        let got = read_xlsx_sync(plain)
            .expect("读回失败")
            .sheets[0]
            .print
            .clone()
            .expect("打印设置整个没读回来");
        assert_eq!(
            (got.fit_to_page, got.fit_to_width, got.fit_to_height),
            (false, None, None),
            "没开页高档却归一出 1，就是替用户声明了一档缩放"
        );
    }

    // 打印设置的实机腿（Excel 只读 + CDP 冒烟）共用的夹具：    // cargo test gen_print_fixture -- --ignored
    #[test]
    #[ignore]
    fn gen_print_fixture() {
        let path = std::env::var("OO_FIXTURE_PATH")
            .unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/../tmp/fixture-print.xlsx").to_string());
        if let Some(dir) = std::path::Path::new(&path).parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let notes = write_xlsx_sync(path.clone(), book(setup())).expect("夹具写出失败");
        println!("夹具: {path}\n打印设置的账（应为空）: {notes:?}");
    }

    /// 同一趟存盘里的两张表：一张说了方向、一张从没说过。
    ///
    /// 本轮写侧那条修复的见证必须成对看——crate 逢 `<pageSetup>` 必落一枚 orientation，
    /// 「没说」那张全靠存盘后的定点重打包擦干净。分开两份文件核对，第三方腿就会在
    /// 「这份本来就没有 pageSetup」上因错的原因通过；放在一份里，两张部件同出一趟 zip，
    /// 一枚在、一枚不在才说明是**擦的**而不是**没写**。
    /// cargo test gen_orient_fixture -- --ignored
    #[test]
    #[ignore]
    fn gen_orient_fixture() {
        let path = std::env::var("OO_FIXTURE_PATH")
            .unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/../tmp/x53/x53-orient.xlsx").to_string());
        if let Some(dir) = std::path::Path::new(&path).parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        // 两张都开「缩放到 1 页高」，于是两份都有 <pageSetup>；差别只在方向那一枚
        let fit = SheetPrintPayload {
            fit_to_page: true,
            fit_to_height: Some(1),
            v_centered: Some(true),
            first_page_number: Some(7),
            ..Default::default()
        };
        let said = SheetPrintPayload {
            orientation: Some("landscape".into()),
            ..fit.clone()
        };
        let quiet = fit;
        let sheet = |name: &str, print: SheetPrintPayload| SheetPayload {
            name: name.into(),
            cells: (0..4)
                .map(|r| CellPayload {
                    r,
                    c: 0,
                    v: Some(Json::String(format!("{name}{r}"))),
                    ..Default::default()
                })
                .collect(),
            print: Some(print),
            ..Default::default()
        };
        let book = WorkbookPayload {
            sheets: vec![sheet("说了", said), sheet("没说", quiet)],
            ..Default::default()
        };
        let notes = write_xlsx_sync(path.clone(), book).expect("夹具写出失败");
        println!("夹具: {path}\n方向的账（应为空）: {notes:?}");
    }

    /// 页眉页脚三版（奇/偶/首）的实机腿夹具：一张足够高、真能分出四五页的表，
    /// 三版各写满自己的框，另把起始页码设成 7——纸上该还是从 1 数（那一条是"做不到"的对照）。
    ///
    /// 只放一张表是故意的：一趟作业只认一份 @page（多张时由第一张说话），
    /// 而 `:left`/`:right` 吃的是**整份文档的物理页序**，第二张表一进来，
    /// 它的"第一页"落在第几页就成了另一件事，判据就不干净了。
    /// cargo test gen_parity_fixture -- --ignored
    #[test]
    #[ignore]
    fn gen_parity_fixture() {
        let path = std::env::var("OO_FIXTURE_PATH")
            .unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/../tmp/x54/x54-parity.xlsx").to_string());
        if let Some(dir) = std::path::Path::new(&path).parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let print = SheetPrintPayload {
            orientation: Some("landscape".into()),
            paper_size: Some(9),
            margins: Some(PrintMarginsPayload {
                top: Some(0.4),
                right: Some(0.5),
                bottom: Some(0.5),
                left: Some(0.5),
                header: Some(0.2),
                footer: Some(0.2),
            }),
            odd_even: true,
            first_differs: true,
            first_page_number: Some(7),
            header: Some(PrintHfPayload {
                odd: Some("&LL-奇&CC-奇&RR-奇".into()),
                even: Some("&LL-偶&CC-偶".into()),
                first: Some("&CC-首".into()),
            }),
            footer: Some(PrintHfPayload {
                odd: Some("&C脚-奇&P".into()),
                even: Some("&C脚-偶&P".into()),
                first: Some("&C脚-首&P".into()),
            }),
            ..Default::default()
        };
        let sheet = SheetPayload {
            name: "奇偶".into(),
            cells: (0..140u32)
                .flat_map(|r| {
                    (0..3u32).map(move |c| CellPayload {
                        r,
                        c,
                        v: Some(Json::String(format!("R{}C{}", r + 1, c + 1))),
                        ..Default::default()
                    })
                })
                .collect(),
            print: Some(print),
            ..Default::default()
        };
        let book = WorkbookPayload {
            sheets: vec![sheet],
            ..Default::default()
        };
        let notes = write_xlsx_sync(path.clone(), book).expect("夹具写出失败");
        println!("夹具: {path}\n三版页眉页脚的账（应只剩起始页码那一条）: {notes:?}");
    }

    /// `headerFooter/@scaleWithDoc` 与 `@alignWithMargins` 的**语义对照**夹具：三份件各只动一枚开关，
    /// 让 Excel 自己把它们导出成 PDF，我们从产物上量"页眉的字到底跟不跟着缩放""页眉贴的是边距还是纸边"。
    /// 之所以要对照：这两枚的缺省是开着，我们的读侧写侧从前根本不认它们，
    /// 于是"接线"还是"只记账"不能靠猜——得先知道 Excel 那句"随文档缩放"在纸上是什么形状。
    ///
    /// cargo test gen_switch_fixture -- --ignored
    #[test]
    #[ignore]
    fn gen_switch_fixture() {
        let dir = std::env::var("OO_FIXTURE_DIR")
            .unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/../tmp/x55").to_string());
        std::fs::create_dir_all(&dir).expect("夹具目录建不出来");
        let rows = |n: u32| -> Vec<CellPayload> {
            (0..n)
                .flat_map(|r| {
                    (0..3u32).map(move |c| CellPayload {
                        r,
                        c,
                        v: Some(Json::String(format!("R{}C{}", r + 1, c + 1))),
                        ..Default::default()
                    })
                })
                .collect()
        };
        let book_of = |name: &str, print: SheetPrintPayload, cells: Vec<CellPayload>| WorkbookPayload {
            sheets: vec![SheetPayload {
                name: name.into(),
                cells,
                print: Some(print),
                ..Default::default()
            }],
            ..Default::default()
        };
        let base = SheetPrintPayload {
            orientation: Some("landscape".into()),
            paper_size: Some(9),
            header: Some(PrintHfPayload {
                odd: Some("&L{TAG}左&C{TAG}中&R{TAG}右".into()),
                ..Default::default()
            }),
            ..Default::default()
        };
        // ①两枚都按缺省（开着）+ 缩放 50%：这是"我们的 PDF 现在长什么样"的对照，也是 scaleWithDoc 的开档
        let on = SheetPrintPayload {
            scale: Some(50),
            header: base.header.clone(),
            ..base.clone()
        };
        // ②只关 scaleWithDoc：Excel 若真"随文档缩放"，这一份的页眉就该比①大一倍
        let scale_off = SheetPrintPayload {
            scale_with_doc: Some(false),
            ..on.clone()
        };
        // ③只关 alignWithMargins：左右边距故意不等（1in / 2in），
        //   于是"按边距"的中段中心在 333.6pt、"按纸边"的中段中心在 421.6pt，两种说法分得开
        let align_off = SheetPrintPayload {
            scale: Some(100),
            align_with_margins: Some(false),
            margins: Some(PrintMarginsPayload {
                top: Some(0.4),
                right: Some(2.0),
                bottom: Some(0.5),
                left: Some(1.0),
                header: Some(0.2),
                footer: Some(0.2),
            }),
            ..base.clone()
        };
        // ④两枚都按缺省但边距同上（③的对照：同左右边距下"按边距"该落在 144 / 648 一带）
        let align_on = SheetPrintPayload {
            align_with_margins: None,
            ..align_off.clone()
        };
        let cases = [
            ("s-on", on, 60u32),
            ("s-scaleoff", scale_off, 60),
            ("s-alignoff", align_off, 40),
            ("s-alignon", align_on, 40),
        ];
        let mut all: Vec<String> = Vec::new();
        for (tag, mut print, n) in cases {
            // 页眉三段的字面带上件名，PDF 上每段是谁说的就不必猜
            if let Some(h) = print.header.as_mut() {
                h.odd = h.odd.take().map(|v| v.replace("{TAG}", tag));
            }
            let path = format!("{dir}/{tag}.xlsx");
            let mut notes = write_xlsx_sync(path.clone(), book_of("纸面开关", print, rows(n))).expect("夹具写出失败");
            notes.insert(0, format!("{tag} 写出"));
            all.push(notes.join(" | "));
        }
        println!("夹具目录: {dir}\n{}", all.join("\n"));
    }

    /// **「缩放到 N 页宽」挤出来的那一档缩放会不会把页眉一起压**——v0.56 的对照夹具。
    ///
    /// 为什么又要一份：v0.55 量实了 `scaleWithDoc` 认的是"文档缩放"那一档（50% 下页眉 5.5pt、关掉 11pt），
    /// 但**声明的 `@scale` 与"按页宽挤出来的实际缩放"是两回事**——Excel 把后者算出来时才决定要不要连页眉一起算。
    /// 三件套各自要答的问题：`fw-plain`＝100% 的基线（页眉该是 11pt 那一档），
    /// `fw-fit1`＝挤到一页宽（正文会明显变小，页眉跟着小＝接线、不跟＝只能记账），
    /// `fw-fit1-off`＝挤到一页宽而 `scaleWithDoc=0`（若它与 `fw-fit1` 的页眉字高相同，
    /// 就说明压缩压根没走 `scaleWithDoc` 那条通道，那"跟着压"这件事的开关语义得另说）。
    ///
    /// cargo test gen_fitwidth_fixture -- --ignored
    #[test]
    #[ignore]
    fn gen_fitwidth_fixture() {
        let dir = std::env::var("OO_FIXTURE_DIR")
            .unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/../tmp/x56").to_string());
        std::fs::create_dir_all(&dir).expect("夹具目录建不出来");
        // 14 列 × 130px ≈ 1820px ≈ 19 英寸宽，而竖版 A4 的可印宽只有 7.3 英寸：一页宽装不下，必须挤
        let cols = 14u32;
        let rws = 18u32;
        let cells = || -> Vec<CellPayload> {
            (0..rws)
                .flat_map(|r| {
                    (0..cols).map(move |c| CellPayload {
                        r,
                        c,
                        v: Some(Json::String(format!("R{}C{}", r + 1, c + 1))),
                        ..Default::default()
                    })
                })
                .collect()
        };
        let widths = (0..cols).map(|c| (c, 130.0f64)).collect::<HashMap<u32, f64>>();
        let base = SheetPrintPayload {
            orientation: Some("portrait".into()),
            paper_size: Some(9),
            margins: Some(PrintMarginsPayload {
                top: Some(0.6),
                right: Some(0.5),
                bottom: Some(0.6),
                left: Some(0.5),
                header: Some(0.3),
                footer: Some(0.3),
            }),
            header: Some(PrintHfPayload {
                odd: Some("&L{TAG}左&C{TAG}中&R{TAG}右".into()),
                ..Default::default()
            }),
            ..Default::default()
        };
        let plain = SheetPrintPayload {
            scale: Some(100),
            ..base.clone()
        };
        let mut fit = SheetPrintPayload {
            fit_to_page: true,
            fit_to_width: Some(1),
            // 页高不限：0 在 OOXML 里是"多少页都行"，与 Excel 界面上那一格同一说法
            fit_to_height: Some(0),
            ..base.clone()
        };
        fit.scale_with_doc = None;
        let fit_off = SheetPrintPayload {
            scale_with_doc: Some(false),
            ..fit.clone()
        };
        let cases = [("fw-plain", plain), ("fw-fit1", fit), ("fw-fit1-off", fit_off)];
        let mut all: Vec<String> = Vec::new();
        for (tag, mut print) in cases {
            if let Some(h) = print.header.as_mut() {
                h.odd = h.odd.take().map(|v| v.replace("{TAG}", tag));
            }
            let path = format!("{dir}/{tag}.xlsx");
            let book = WorkbookPayload {
                sheets: vec![SheetPayload {
                    name: "挤一页宽".into(),
                    cells: cells(),
                    col_widths: widths.clone(),
                    print: Some(print),
                    ..Default::default()
                }],
                ..Default::default()
            };
            let mut notes = write_xlsx_sync(path.clone(), book).expect("夹具写出失败");
            notes.insert(0, format!("{tag} 写出"));
            all.push(notes.join(" | "));
        }
        println!("夹具目录: {dir}\n{}", all.join("\n"));
    }
}
