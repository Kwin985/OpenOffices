//! ODF 原生图表：ODS 里图表是**嵌入对象**——主 `content.xml` 只有一枚 `<draw:frame>` +
//! `<draw:object xlink:href="./Object 1">`，真正的图型/系列住在 `Object 1/content.xml` 里。
//!
//! 与 xlsx 那一头同一条契约：系列的**值**按引用从已读入的单元格网格取（不信文件内缓存），
//! 引用本身原样留住。ODF 的类目域住在轴上（`<chart:categories>`），不是每系列一份——
//! 读侧把它摊到每系列的 `cat` 上，写侧再收回成轴上一条，于是往返同形。
//!
//! 尺寸：`draw:frame` 的 `svg:width/svg:height` 是带单位长度，按 96dpi 折成像素，
//! 与 xlsx 锚点的 EMU/9525 同归一处。
//!
//! 明说的弱点：本机没装 LibreOffice（WPS/Office 2010 的 COM 被安全策略拦下），所以这一层的
//! 夹具是按 ODF 1.2 规范手写的，不是真机另存的。契约是「写侧产出能被读侧原样读回」，
//! 不是「LibreOffice 打开零警告」；后者要等真机能跑再验。

use std::collections::HashMap;
use std::fs::File;

use quick_xml::events::Event;
use quick_xml::Reader;

use crate::xlsx::{ChartAxis, ChartPayload, ChartSeries, RangeRef, WorkbookPayload};
use crate::xlsx_chart::{num_of, resolve_values, Grid};
use crate::xlsx_style::{a1_to_rc, attr_str, read_entry};

// ───────────────────────── 读侧 ─────────────────────────

/// `Object N/content.xml` 这类成员的嗅探（不解 XML）：让读侧在没有图表的簿子上省掉整张网格的克隆
pub fn has_ods_charts(path: &str) -> bool {
    let Ok(file) = File::open(path) else {
        return false;
    };
    let Ok(zip) = zip::ZipArchive::new(file) else {
        return false;
    };
    // 收进局部再返回：尾表达式形式会把借 `zip` 的迭代器临时量留到块尾，而 `zip` 先 drop（E0597）
    let hit = zip.file_names().any(is_object_content);
    hit
}

fn is_object_content(n: &str) -> bool {
    n.starts_with("Object ") && n.ends_with("/content.xml")
}

/// `xlink:href` → zip 内目录名。`./Object 1` / `Object 1/` / `Object%201` 三种写法都要认
fn dir_of(href: &str) -> String {
    let h = href.trim().trim_end_matches('/');
    let h = h.strip_prefix("./").unwrap_or(h);
    h.replace("%20", " ")
}

/// ODF 区域地址：`'成绩 表'.$A$1:$B$6` / `Sheet1.A1:B6` / `A1`。不带表名的那一档归 host 表
fn parse_odf_range(s: &str, host: &str) -> Option<RangeRef> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    let (sheet, rng) = split_sheet(s);
    let sheet = sheet.unwrap_or_else(|| host.to_string());
    let (a, b) = rng.split_once(':').unwrap_or((rng, rng));
    let (r1, c1) = a1_to_rc(&a.replace('$', ""))?;
    let (r2, c2) = a1_to_rc(&b.replace('$', ""))?;
    Some(RangeRef {
        sheet,
        r1: r1.min(r2),
        c1: c1.min(c2),
        r2: r1.max(r2),
        c2: c1.max(c2),
    })
}

/// ODF 用**点**分表名与地址（不是 xlsx 的 `!`）；表名含空格/点/引号时整段加单引号，内部引号翻倍
fn split_sheet(s: &str) -> (Option<String>, &str) {
    if let Some(rest) = s.strip_prefix('\'') {
        if let Some(p) = rest.find("'.") {
            return (Some(rest[..p].replace("''", "'")), &rest[p + 2..]);
        }
        return (None, s);
    }
    match s.find('.') {
        Some(p) => (Some(s[..p].to_string()), &s[p + 1..]),
        None => (None, s),
    }
}

/// 主 `content.xml` 里一枚图表框的位置
struct FrameHit {
    sheet: String,
    row: u32,
    col: u32,
    width: u32,
    height: u32,
    dir: String,
    /// false = 锚点取自 `table:end-cell-address`（`table:shapes` 那一档，视觉左上角可能与它错开）
    anchored: bool,
}

/// 扫主 content.xml：表内嵌的 `<draw:frame>` 与 `<table:shapes>` 里的都收。
/// 只有 `<draw:object>`（原生 ODF 图表）算数；`<draw:object-ole>` 是二进制 OLE，这一层不认
fn scan_frames(xml: &str) -> Vec<FrameHit> {
    let mut out: Vec<FrameHit> = Vec::new();
    let mut table: Option<String> = None;
    let mut row = 0u32;
    let mut row_repeat = 1u32;
    let mut col = 0u32;
    let mut cur_cell = (0u32, 0u32);
    let mut in_shapes = false;
    let mut frame: Option<FrameHit> = None;

    let mut reader = Reader::from_str(xml);
    while let Ok(ev) = reader.read_event() {
        match &ev {
            Event::Start(e) | Event::Empty(e) => {
                let raw = e.local_name();
                let nm: &str = raw.as_ref();
                match nm {
                    "table" if matches!(ev, Event::Start(_)) => {
                        table = attr_str(e, "name");
                        row = 0;
                        col = 0;
                    }
                    "shapes" if matches!(ev, Event::Start(_)) => in_shapes = true,
                    "table-row" if matches!(ev, Event::Start(_)) => {
                        col = 0;
                        row_repeat = repeat_of(e, "number-rows-repeated");
                    }
                    "table-cell" | "covered-table-cell" => {
                        cur_cell = (row, col);
                        col += repeat_of(e, "number-columns-repeated");
                    }
                    "frame" if matches!(ev, Event::Start(_)) => {
                        let (r, c, anchored) = if in_shapes {
                            // table:shapes 里的框没有"起始格"属性，只有终点格；拿它当锚点并在读侧记账
                            match attr_str(e, "end-cell-address")
                                .and_then(|a| parse_odf_range(&a, ""))
                            {
                                Some(rf) => (rf.r1, rf.c1, false),
                                None => (cur_cell.0, cur_cell.1, false),
                            }
                        } else {
                            (cur_cell.0, cur_cell.1, true)
                        };
                        frame = Some(FrameHit {
                            sheet: table.clone().unwrap_or_default(),
                            row: r,
                            col: c,
                            width: len_px(attr_str(e, "width")),
                            height: len_px(attr_str(e, "height")),
                            dir: String::new(),
                            anchored,
                        });
                    }
                    "object" => {
                        if let Some(f) = frame.as_mut() {
                            if f.dir.is_empty() {
                                if let Some(h) = attr_str(e, "href") {
                                    f.dir = dir_of(&h);
                                }
                            }
                        }
                    }
                    "object-ole" | "object-replace" => {
                        // OLE 图表（Excel 转存常见）：字节里不是 ODF 图表，读不出系列，直接作废这一框
                        frame = None;
                    }
                    _ => {}
                }
            }
            Event::End(e) => {
                let raw = e.local_name();
                let nm: &str = raw.as_ref();
                match nm {
                    "frame" => {
                        if let Some(f) = frame.take() {
                            if !f.dir.is_empty() {
                                out.push(f);
                            }
                        }
                    }
                    "shapes" => in_shapes = false,
                    "table-row" => {
                        row += row_repeat;
                        row_repeat = 1;
                    }
                    "table" => table = None,
                    _ => {}
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    out
}

fn repeat_of(e: &quick_xml::events::BytesStart<'_>, attr: &str) -> u32 {
    attr_str(e, attr)
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(1)
        .max(1)
}

/// ODF 长度 → 像素（96dpi），与 xlsx 锚点那一档同单位
fn len_px(v: Option<String>) -> u32 {
    let Some(v) = v else { return 0 };
    let v = v.trim();
    let Some(cut) = v.find(|c: char| !c.is_ascii_digit() && c != '.' && c != '-' && c != '+') else {
        return 0;
    };
    let Ok(n) = v[..cut].parse::<f64>() else {
        return 0;
    };
    let px = match &v[cut..] {
        "cm" => n * 96.0 / 2.54,
        "mm" => n * 96.0 / 25.4,
        "pt" => n * 96.0 / 72.0,
        "in" => n * 96.0,
        "pc" => n * 96.0 / 6.0,
        "px" => n,
        _ => return 0,
    };
    px.round().max(0.0) as u32
}

/// `Object N/content.xml` 里的一根系列
#[derive(Default)]
struct OdfSeries {
    /// 组合图：本系列自己的 `chart:class`（与主图型不同时才有）
    ty: Option<String>,
    name_ref: Option<RangeRef>,
    name_lit: String,
    val: Option<RangeRef>,
}

#[derive(Default)]
struct OdfChart {
    ty: String,
    title: String,
    /// 类目域：ODF 挂在轴上，全图一份
    cats: Option<RangeRef>,
    series: Vec<OdfSeries>,
    axes: Vec<(String, String)>, // (dimension, name)
}

/// 解析 `Object N/content.xml`。None = 不认识的图型或没有一根能站住的系列
fn parse_odf_chart(xml: &str, host: &str) -> Option<OdfChart> {
    let mut c = OdfChart::default();
    let mut in_title = false;
    let mut in_series = false;
    let mut in_label = false;
    let mut reader = Reader::from_str(xml);
    while let Ok(ev) = reader.read_event() {
        match &ev {
            Event::Start(e) | Event::Empty(e) => {
                let raw = e.local_name();
                let nm: &str = raw.as_ref();
                match nm {
                    "chart" if !in_series => {
                        if let Some(t) = attr_str(e, "class").and_then(|v| odf_class_to_ty(&v)) {
                            c.ty = t;
                        }
                    }
                    "title" if !in_series && matches!(ev, Event::Start(_)) => in_title = true,
                    "axis" => {
                        let dim = attr_str(e, "dimension").unwrap_or_default();
                        let name = attr_str(e, "name").unwrap_or_else(|| dim.clone());
                        if !dim.is_empty() {
                            c.axes.push((dim, name));
                        }
                    }
                    "categories" => {
                        let rf = attr_str(e, "cell-range-address")
                            .and_then(|a| parse_odf_range(&a, host));
                        if rf.is_some() {
                            c.cats = rf;
                        }
                    }
                    "series" => {
                        in_series = true;
                        let mut s = OdfSeries::default();
                        s.ty = attr_str(e, "class").and_then(|v| odf_class_to_ty(&v));
                        s.name_ref = attr_str(e, "label-cell-address")
                            .and_then(|a| parse_odf_range(&a, host));
                        // 值域：LO 有时只给 table:cell-range-address（那时它就是值域），
                        // 规范写法是 chart:values-cell-range-address，两者都认，后者优先
                        let fallback = attr_str(e, "cell-range-address")
                            .and_then(|a| parse_odf_range(&a, host));
                        s.val = attr_str(e, "values-cell-range-address")
                            .and_then(|a| parse_odf_range(&a, host))
                            .or(fallback);
                        c.series.push(s);
                    }
                    "label" if in_series && matches!(ev, Event::Start(_)) => in_label = true,
                    _ => {}
                }
            }
            Event::Text(t) => {
                let s: &str = t.as_ref();
                if in_title && !s.trim().is_empty() {
                    c.title.push_str(s.trim());
                } else if in_label && !s.trim().is_empty() {
                    if let Some(sr) = c.series.last_mut() {
                        sr.name_lit.push_str(s.trim());
                    }
                }
            }
            Event::End(e) => {
                let raw = e.local_name();
                let nm: &str = raw.as_ref();
                match nm {
                    "title" => in_title = false,
                    "label" => in_label = false,
                    "series" => in_series = false,
                    _ => {}
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    if c.ty.is_empty() || c.series.iter().all(|s| s.val.is_none()) {
        return None;
    }
    Some(c)
}

/// ODF `chart:class` → 内部图型名；surface/bubble/gantt 这一层装不下，交回 None（读侧跳过+记账）
fn odf_class_to_ty(v: &str) -> Option<String> {
    let v = v.trim_start_matches("chart:");
    Some(match v {
        "bar" => "column".into(),
        "line" => "line".into(),
        "area" => "area".into(),
        "circle" => "pie".into(),
        "ring" => "doughnut".into(),
        "scatter" => "scatter".into(),
        "radar" | "filled-radar" => "radar".into(),
        "stock" => "stock".into(),
        _ => return None,
    })
}

/// 主入口：表名 → 图表列表。缺 `Object N` 部件（多数簿子没有图表）静默跳过
pub fn read_ods_charts(path: &str, grids: &HashMap<String, Grid>) -> HashMap<String, Vec<ChartPayload>> {
    let mut out: HashMap<String, Vec<ChartPayload>> = HashMap::new();
    let Ok(file) = File::open(path) else {
        return out;
    };
    let Ok(mut zip) = zip::ZipArchive::new(file) else {
        return out;
    };
    let Some(main_xml) = read_entry(&mut zip, "content.xml") else {
        return out;
    };
    for f in scan_frames(&main_xml) {
        let Some(obj_xml) = read_entry(&mut zip, &format!("{}/content.xml", f.dir)) else {
            continue;
        };
        let Some(c) = parse_odf_chart(&obj_xml, &f.sheet) else {
            continue;
        };
        let axes: Vec<ChartAxis> = c
            .axes
            .iter()
            .map(|(dim, name)| ChartAxis {
                id: name.clone(),
                kind: if dim == "y" { "val".into() } else { "cat".into() },
                ..Default::default()
            })
            .collect();
        let mut series: Vec<ChartSeries> = Vec::new();
        for (i, s) in c.series.iter().enumerate() {
            let Some(val) = s.val.clone() else { continue };
            let cats = c
                .cats
                .as_ref()
                .map(|rf| resolve_values(rf, &f.sheet, grids))
                .unwrap_or_default();
            let vals = resolve_values(&val, &f.sheet, grids).iter().map(num_of).collect();
            let name = s
                .name_ref
                .as_ref()
                .and_then(|rf| resolve_values(rf, &f.sheet, grids).into_iter().next())
                .and_then(|v| v.as_str().map(str::to_string))
                .filter(|v| !v.trim().is_empty())
                .or_else(|| {
                    let l = s.name_lit.trim();
                    if l.is_empty() {
                        None
                    } else {
                        Some(l.to_string())
                    }
                })
                .unwrap_or_else(|| format!("系列{}", i + 1));
            // 组合图：系列自己的图型只在与主图型不同时留着（与 xlsx 侧同一分寸）
            let ty = s.ty.clone().filter(|t| t != &c.ty);
            series.push(ChartSeries {
                name,
                cat: c.cats.clone(),
                val,
                cats,
                vals,
                chart_type: ty,
                secondary_axis: false,
            });
        }
        if series.is_empty() {
            continue;
        }
            out.entry(f.sheet.clone()).or_default().push(ChartPayload {
            chart_type: c.ty,
            grouping: "standard".into(),
            title: c.title,
            radar_style: None,
            scatter_style: None,
            anchor_row: f.row,
            anchor_col: f.col,
            width: f.width.max(120),
            height: f.height.max(90),
            axes,
            series,
        });
        // 锚点取自 table:end-cell-address 那一档不在这里记账：read_ods_charts 没有 warnings 的去处，
        // 由 ods_chart_read_accounts 另走一趟说出来（xlsx::read_xlsx_sync 把它并入 workbook.warnings）
        let _ = f.anchored;
    }
    out
}

/// 读侧的边界账：`table:shapes` 那一档锚点与 `Object N` 里的 OLE 图表，装不下的要说得出来
pub fn ods_chart_read_accounts(path: &str) -> Vec<String> {
    let mut out = Vec::new();
    let Ok(file) = File::open(path) else {
        return out;
    };
    let Ok(mut zip) = zip::ZipArchive::new(file) else {
        return out;
    };
    let Some(main_xml) = read_entry(&mut zip, "content.xml") else {
        return out;
    };
    let frames = scan_frames(&main_xml);
    if frames.iter().any(|f| !f.anchored) {
        out.push("ODS 图表锚点取自 table:end-cell-address，屏幕位置可能与文件里的视觉左上角错开一格".into());
    }
    for f in frames {
        match read_entry(&mut zip, &format!("{}/content.xml", f.dir)) {
            None => out.push(format!("ODS 图表对象 {} 不是 ODF 图表（多半是 OLE），未读出系列", f.dir)),
            Some(xml) => {
                if parse_odf_chart(&xml, &f.sheet).is_none() {
                    out.push(format!(
                        "ODS 图表对象 {} 的图型/系列这一层读不出（surface、bubble 之类不在支持表内），打开后不显示",
                        f.dir
                    ));
                }
            }
        }
    }
    out
}

// ───────────────────────── 写侧 ─────────────────────────

fn rc_to_a1(r: u32, c: u32) -> String {
    let mut n = c + 1;
    let mut s = String::new();
    while n > 0 {
        let rem = (n - 1) % 26;
        s.insert(0, (b'A' + rem as u8) as char);
        n = (n - 1) / 26;
    }
    format!("{s}{}", r + 1)
}

fn cell_to_odf(table: &str, r: u32, c: u32) -> String {
    format!("{}.{}", crate::ods::odf_table_ref(table), rc_to_a1(r, c))
}

fn range_to_odf(rf: &RangeRef, host: &str) -> String {
    let sheet = if rf.sheet.is_empty() { host } else { rf.sheet.as_str() };
    // ODF 的 cell-range-address 是 `表名.左上角:右下角`——表名只在左端说一次（§9.2.1），
    // 右端再带一次会让读侧的 split_once(':') 拿到 "Sheet1.B5" 这种认不出的地址
    format!(
        "{}.{}:{}",
        crate::ods::odf_table_ref(sheet),
        rc_to_a1(rf.r1, rf.c1),
        rc_to_a1(rf.r2, rf.c2)
    )
}

fn px_to_cm(px: f64) -> String {
    format!("{:.3}cm", px * 2.54 / 96.0)
}

fn xesc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// 内部图型名 → ODF `chart:class`（不含 `chart:` 前缀）
fn ty_to_odf_class(ty: &str, style: Option<&str>) -> Option<&'static str> {
    Some(match ty {
        "column" | "bar" => "bar",
        "line" => "line",
        "area" => "area",
        "pie" => "circle",
        "doughnut" => "ring",
        "scatter" => "scatter",
        "radar" => {
            if style == Some("filled") {
                return Some("filled-radar");
            }
            "radar"
        }
        "stock" => "stock",
        _ => return None,
    })
}

/// 第 si 张表的第 ci 个图表分到的 `Object N` 目录名——编目录（`write_ods_chart_objects`）
/// 与在表里嵌框（`frame_xml`）必须用同一套编号，否则 href 指空
pub fn object_dir(workbook: &WorkbookPayload, si: usize, ci: usize) -> String {
    let n: usize = workbook
        .sheets
        .iter()
        .take(si)
        .map(|s| s.charts.len())
        .sum::<usize>()
        + ci
        + 1;
    format!("Object {n}")
}

/// 主 `content.xml` 里嵌在锚点格上的那一枚框。`href` 里的空格按 URL 写法折成 %20
pub fn frame_xml(chart: &ChartPayload, table: &str, dir: &str) -> String {
    let w = px_to_cm(chart.width.max(120) as f64);
    let h = px_to_cm(chart.height.max(90) as f64);
    format!(
        "<draw:frame text:anchor-type=\"table\" table:end-cell-address=\"{end}\" \
         svg:x=\"0cm\" svg:y=\"0cm\" svg:width=\"{w}\" svg:height=\"{h}\" draw:z-index=\"0\">\
         <draw:object xlink:href=\"./{href}\" xlink:type=\"simple\" xlink:show=\"embed\" \
         xlink:actuate=\"onLoad\"/></draw:frame>",
        end = cell_to_odf(table, chart.anchor_row, chart.anchor_col),
        href = dir.replace(' ', "%20"),
    )
}

/// 一个图表对象部件的内容（`Object N/content.xml`）
pub fn chart_object_xml(chart: &ChartPayload, table: &str) -> Option<String> {
    let style = if chart.chart_type == "radar" {
        chart.radar_style.as_deref()
    } else if chart.chart_type == "scatter" {
        chart.scatter_style.as_deref()
    } else {
        None
    };
    let class = ty_to_odf_class(&chart.chart_type, style)?;
    let mut props = String::new();
    if chart.chart_type == "bar" {
        props.push_str(" chart:vertical=\"true\"");
    }
    match chart.grouping.as_str() {
        "stacked" => props.push_str(" chart:stacked=\"true\""),
        "percentStacked" => props.push_str(" chart:percentage=\"true\""),
        _ => {}
    }
    let w = px_to_cm(chart.width.max(120) as f64);
    let h = px_to_cm(chart.height.max(90) as f64);
    // 整图的单元格覆盖面：所有系列值域与类目域的并集（ODF 要求 chart 与 plot-area 各说一遍）
    let cover = cover_range(chart, table);
    let mut body = String::new();
    if !chart.title.trim().is_empty() {
        body.push_str(&format!(
            "<chart:title><text:p>{}</text:p></chart:title>",
            xesc(chart.title.trim())
        ));
    }
    // 类目域：ODF 只有一份，挂在 x 轴上；取第一根系列带的 cat（与读侧摊到每系列是同一枚）
    let cats = chart
        .series
        .first()
        .and_then(|s| s.cat.as_ref())
        .map(|rf| format!("<chart:categories table:cell-range-address=\"{}\"/>", range_to_odf(rf, table)))
        .unwrap_or_default();
    let _ = &mut body;
    Some(format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\
         <office:document-content \
         xmlns:office=\"urn:oasis:names:tc:opendocument:xmlns:office:1.0\" \
         xmlns:style=\"urn:oasis:names:tc:opendocument:xmlns:style:1.0\" \
         xmlns:text=\"urn:oasis:names:tc:opendocument:xmlns:text:1.0\" \
         xmlns:table=\"urn:oasis:names:tc:opendocument:xmlns:table:1.0\" \
         xmlns:chart=\"urn:oasis:names:tc:opendocument:xmlns:chart:1.0\" \
         xmlns:svg=\"urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0\" \
         xmlns:number=\"urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0\" \
         office:version=\"1.2\">\
         <office:automatic-styles>\
         <style:style style:name=\"ch1\" style:family=\"chart\">\
         <style:chart-properties{props}/></style:style>\
         </office:automatic-styles>\
         <office:body><office:chart>\
         <chart:chart chart:class=\"chart:{class}\" chart:style-name=\"ch1\" \
         svg:width=\"{w}\" svg:height=\"{h}\" table:cell-range-address=\"{cover}\">\
         {body}\
         <chart:plot-area chart:style-name=\"ch1\" table:cell-range-address=\"{cover}\" \
         svg:x=\"0cm\" svg:y=\"0cm\" svg:width=\"{w}\" svg:height=\"{h}\">\
         <chart:axis chart:dimension=\"x\" chart:name=\"x1\">{cats}</chart:axis>\
         <chart:axis chart:dimension=\"y\" chart:name=\"y1\"/>\
         {series}\
         <chart:wall/>\
         </chart:plot-area>\
         </chart:chart></office:chart></office:body></office:document-content>",
        series = series_xml(chart, table, class),
    ))
}

/// 系列元素得排在 plot-area 里（不是 chart 下），单独拼一次免得上面那串 format 参数打架
fn series_xml(chart: &ChartPayload, table: &str, class: &str) -> String {
    let mut out = String::new();
    for s in &chart.series {
        let sc = s
            .chart_type
            .as_deref()
            .and_then(|t| ty_to_odf_class(t, None))
            .unwrap_or(class);
        let val = range_to_odf(&s.val, table);
        let name = if s.name.trim().is_empty() {
            String::new()
        } else {
            format!("<chart:label><text:p>{}</text:p></chart:label>", xesc(s.name.trim()))
        };
        out.push_str(&format!(
            "<chart:series chart:class=\"chart:{sc}\" chart:style-name=\"ch1\" \
             table:cell-range-address=\"{val}\" chart:values-cell-range-address=\"{val}\">{name}</chart:series>"
        ));
    }
    out
}

/// 图表覆盖的单元格区域：系列值域 ∪ 类目域。ODF 的 `table:cell-range-address` 就填这个
fn cover_range(chart: &ChartPayload, table: &str) -> String {
    let mut rf: Option<RangeRef> = None;
    let mut take = |x: &RangeRef| {
        rf = Some(match rf.take() {
            None => x.clone(),
            Some(a) => RangeRef {
                sheet: if a.sheet.is_empty() { table.to_string() } else { a.sheet },
                r1: a.r1.min(x.r1),
                c1: a.c1.min(x.c1),
                r2: a.r2.max(x.r2),
                c2: a.c2.max(x.c2),
            },
        });
    };
    for s in &chart.series {
        take(&s.val);
        if let Some(c) = s.cat.as_ref() {
            take(c);
        }
    }
    match rf {
        Some(r) => range_to_odf(&r, table),
        None => cell_to_odf(table, chart.anchor_row, chart.anchor_col),
    }
}

/// 写侧的边界账：图型不在支持表内（surface/bubble 之类）的图表，这一趟摆不进 ODS
pub fn ods_chart_write_accounts(workbook: &WorkbookPayload) -> Vec<String> {
    let mut out = Vec::new();
    for s in &workbook.sheets {
        for c in &s.charts {
            let style = if c.chart_type == "radar" {
                c.radar_style.as_deref()
            } else if c.chart_type == "scatter" {
                c.scatter_style.as_deref()
            } else {
                None
            };
            if ty_to_odf_class(&c.chart_type, style).is_none() {
                out.push(format!(
                    "图表「{}」的图型「{}」这一层写不进 ODS（存盘后这一张图不在文件里）",
                    if c.title.trim().is_empty() { "(无标题)" } else { c.title.trim() },
                    c.chart_type
                ));
            }
        }
    }
    out
}

/// 写侧：按表序把所有图表编成 `Object N/content.xml`
pub fn write_ods_chart_objects(workbook: &WorkbookPayload) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for (si, s) in workbook.sheets.iter().enumerate() {
        for (ci, c) in s.charts.iter().enumerate() {
            let Some(xml) = chart_object_xml(c, &s.name) else {
                continue;
            };
                out.push((object_dir(workbook, si, ci), xml));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    // 只有夹具里造 CellPayload 要它：生产路径上一个 serde_json 的值都不经手，
    // 留在文件头会让 `cargo build`（不带 cfg(test)）报一条 unused import
    use serde_json::Value;

    const OBJ: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
 xmlns:chart="urn:oasis:names:tc:opendocument:xmlns:chart:1.0"
 xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
 xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
 xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
 xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0">
 <office:body><office:chart>
  <chart:chart chart:class="chart:bar" svg:width="8cm" svg:height="7cm"
    table:cell-range-address="Sheet1.A1:Sheet1.C5">
   <chart:title><text:p>月考成绩</text:p></chart:title>
   <chart:plot-area table:cell-range-address="Sheet1.A1:Sheet1.C5">
    <chart:axis chart:dimension="x" chart:name="primary-x">
     <chart:categories table:cell-range-address="Sheet1.$A$2:$A$5"/>
    </chart:axis>
    <chart:axis chart:dimension="y" chart:name="primary-y"/>
    <chart:series chart:class="chart:bar" chart:label-cell-address="Sheet1.$B$1"
      chart:values-cell-range-address="Sheet1.$B$2:$B$5"/>
    <chart:series chart:class="chart:line" chart:style-name="s2"
      table:cell-range-address="Sheet1.$C$2:$C$5">
      <chart:label><text:p>平均分</text:p></chart:label>
    </chart:series>
   </chart:plot-area>
  </chart:chart>
 </office:chart></office:body></office:document-content>"#;

    #[test]
    fn ranges_split_and_rejoin() {
        let r = parse_odf_range("'成绩 表'.$A$1:$B$6", "X").unwrap();
        assert_eq!((r.sheet.as_str(), r.r1, r.c1, r.r2, r.c2), ("成绩 表", 0, 0, 5, 1));
        let s = parse_odf_range("Sheet1.A1", "X").unwrap();
        assert_eq!((s.sheet.as_str(), s.r1, s.c1), ("Sheet1", 0, 0));
        let t = parse_odf_range("A1:B2", "X").unwrap();
        assert_eq!(t.sheet.as_str(), "X", "不带表名归 host 表");
        assert!(parse_odf_range("", "X").is_none());
        // 往返：写出的地址能被读侧原样认回（表名含空格要被引号包住）
        let back = parse_odf_range(&range_to_odf(&r, "X"), "Y").unwrap();
        assert_eq!(
            (back.sheet.as_str(), back.r1, back.c1, back.r2, back.c2),
            (r.sheet.as_str(), r.r1, r.c1, r.r2, r.c2)
        );
    }

    #[test]
    fn parses_object_chart() {
        let c = parse_odf_chart(OBJ, "Sheet1").expect("解析出图表");
        assert_eq!(c.ty, "column");
        assert_eq!(c.title, "月考成绩");
        let cats = c.cats.clone().expect("轴上的类目域");
        assert_eq!((cats.r1, cats.c1, cats.r2, cats.c2), (1, 0, 4, 0));
        assert_eq!(c.series.len(), 2);
        assert_eq!(c.series[0].name_ref.as_ref().map(|r| (r.r1, r.c1)), Some((0, 1)));
        assert_eq!(c.series[0].val.as_ref().map(|r| (r.r1, r.r2)), Some((1, 4)));
        // 组合图：第二根系列是 line，与主图型 column 不同
        assert_eq!(c.series[1].ty.as_deref(), Some("line"));
        assert_eq!(c.series[1].name_lit, "平均分");
        // 没有 label-cell-address 时靠 series 自己的 chart:label
        assert!(c.series[1].name_ref.is_none());
        assert_eq!(c.axes.len(), 2);
        assert_eq!(c.axes[0].0, "x");
        assert_eq!(c.axes[1].0, "y");
    }

    #[test]
    fn frames_scan_in_cell_and_shapes() {
        let xml = r#"<office:document-content xmlns:table="t" xmlns:draw="d" xmlns:xlink="x" xmlns:svg="s">
         <office:body><office:spreadsheet>
          <table:table table:name="数据">
           <table:table-row><table:table-cell table:number-columns-repeated="2"/>
             <table:table-cell><draw:frame svg:width="10cm" svg:height="6cm">
               <draw:object xlink:href="./Object 1"/></draw:frame></table:table-cell>
           </table:table-row>
           <table:shapes><draw:frame svg:width="8cm" svg:height="5cm"
             table:end-cell-address="数据.C9"><draw:object xlink:href="./Object%202"/></draw:frame></table:shapes>
          </table:table>
         </office:spreadsheet></office:body></office:document-content>"#;
        let fs = scan_frames(xml);
        assert_eq!(fs.len(), 2);
        assert_eq!((fs[0].sheet.as_str(), fs[0].row, fs[0].col), ("数据", 0, 2), "repeated 后的列索引");
        assert_eq!(fs[0].dir, "Object 1");
        assert_eq!(fs[0].width, 378, "10cm 按 96dpi 折像素");
        assert!(fs[0].anchored);
        assert_eq!((fs[1].row, fs[1].col), (8, 2), "end-cell-address C9 → r8c2");
        assert_eq!(fs[1].dir, "Object 2", "%20 解回空格");
        assert!(!fs[1].anchored, "table:shapes 那一档要记账");
    }

    #[test]
    fn writes_back_readably() {
        // 读 → 写 → 读：图型、标题、系列名与引用逐项对得上
        let c = parse_odf_chart(OBJ, "Sheet1").unwrap();
        let payload = ChartPayload {
            chart_type: c.ty.clone(),
            grouping: "standard".into(),
            title: c.title.clone(),
            radar_style: None,
            scatter_style: None,
            anchor_row: 0,
            anchor_col: 2,
            width: 378,
            height: 283,
            axes: vec![],
            series: c
                .series
                .iter()
                .map(|s| ChartSeries {
                    name: if s.name_lit.is_empty() { "系列1".into() } else { s.name_lit.clone() },
                    cat: c.cats.clone(),
                    val: s.val.clone().unwrap(),
                    cats: vec![],
                    vals: vec![1.0, 2.0, 3.0, 4.0],
                    chart_type: s.ty.clone().filter(|t| t != &c.ty),
                    secondary_axis: false,
                })
                .collect(),
        };
        let xml = chart_object_xml(&payload, "Sheet1").expect("图型可写");
        let back = parse_odf_chart(&xml, "Sheet1").expect("写出的件能被读回");
        assert_eq!(back.ty, "column");
        assert_eq!(back.title, "月考成绩");
        assert_eq!(back.series.len(), 2);
        assert_eq!(back.series[0].name_lit, "系列1");
        assert_eq!(back.series[1].name_lit, "平均分");
        assert_eq!(back.series[1].ty.as_deref(), Some("line"), "组合图的副图型往返");
        let cats = back.cats.expect("类目域回到轴上");
        assert_eq!((cats.r1, cats.c1, cats.r2, cats.c2), (1, 0, 4, 0));
        assert_eq!(back.series[0].val.as_ref().map(|r| (r.r1, r.r2)), Some((1, 4)));
        assert!(xml.contains("chart:values-cell-range-address=\"Sheet1.B2:B5\""));
        assert!(!xml.contains("chart:vertical"), "column 不是 vertical");
    }

    #[test]
    fn bar_and_stacked_are_said() {
        let mut p = ChartPayload {
            chart_type: "bar".into(),
            grouping: "stacked".into(),
            title: String::new(),
            radar_style: None,
            scatter_style: None,
            anchor_row: 1,
            anchor_col: 1,
            width: 200,
            height: 150,
            axes: vec![],
            series: vec![ChartSeries {
                name: "A".into(),
                cat: None,
                val: RangeRef { sheet: "Sheet1".into(), r1: 0, c1: 0, r2: 2, c2: 0 },
                cats: vec![],
                vals: vec![],
                chart_type: None,
                secondary_axis: false,
            }],
        };
        let xml = chart_object_xml(&p, "Sheet1").unwrap();
        assert!(xml.contains("chart:vertical=\"true\""), "bar 靠 vertical 与 column 分");
        assert!(xml.contains("chart:stacked=\"true\""));
        p.chart_type = "surface".into();
        assert!(chart_object_xml(&p, "Sheet1").is_none(), "surface 这一层不写");
    }

    #[test]
    fn object_numbering_is_shared() {
        let mut wb = WorkbookPayload {
            sheets: vec![
                crate::xlsx::SheetPayload {
                    name: "S1".into(),
                    charts: vec![blank(), blank()],
                    ..Default::default()
                },
                crate::xlsx::SheetPayload {
                    name: "S2".into(),
                    charts: vec![blank()],
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        let _ = &mut wb;
        assert_eq!(object_dir(&wb, 0, 0), "Object 1");
        assert_eq!(object_dir(&wb, 0, 1), "Object 2");
        assert_eq!(object_dir(&wb, 1, 0), "Object 3");
        assert_eq!(write_ods_chart_objects(&wb).len(), 3);
    }

    /// 端到端：本应用写出的 ODS 字节流 → 落地成文件 → 读侧认回同一张图。
    /// 这一条把 frame 扫描、Object 编号、chart XML 三件事串起来验，单测里只有它走得到 zip
    #[test]
    fn object_round_trips_through_a_real_ods() {
        use crate::xlsx::{CellPayload, SheetPayload};
        let cells = vec![
            CellPayload { r: 0, c: 0, v: Some(Value::from("月份")), f: None, s: None },
            CellPayload { r: 0, c: 1, v: Some(Value::from("销量")), f: None, s: None },
            CellPayload { r: 1, c: 0, v: Some(Value::from("一月")), f: None, s: None },
            CellPayload { r: 1, c: 1, v: Some(Value::from(10)), f: None, s: None },
            CellPayload { r: 2, c: 0, v: Some(Value::from("二月")), f: None, s: None },
            CellPayload { r: 2, c: 1, v: Some(Value::from(20)), f: None, s: None },
        ];
        let wb = WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "数据".into(),
                cells,
                charts: vec![ChartPayload {
                    chart_type: "column".into(),
                    grouping: "standard".into(),
                    title: "月销量".into(),
                    radar_style: None,
                    scatter_style: None,
                    anchor_row: 4,
                    anchor_col: 3,
                    width: 320,
                    height: 240,
                    axes: vec![],
                    series: vec![ChartSeries {
                        name: "销量".into(),
                        cat: Some(RangeRef { sheet: "数据".into(), r1: 1, c1: 0, r2: 2, c2: 0 }),
                        val: RangeRef { sheet: "数据".into(), r1: 1, c1: 1, r2: 2, c2: 1 },
                        cats: vec![],
                        vals: vec![10.0, 20.0],
                        chart_type: None,
                        secondary_axis: false,
                    }],
                }],
                ..Default::default()
            }],
            ..Default::default()
        };
        let bytes = crate::ods::ods_bytes(&wb).expect("造出 ODS");
        let path = std::env::temp_dir().join(format!("oo_ods_chart_{}.ods", std::process::id()));
        std::fs::write(&path, &bytes).unwrap();
        let p = path.to_string_lossy().replace('\\', "/");
        assert!(has_ods_charts(&p), "产物里该有 Object N");

        let mut grid: Grid = Grid::new();
        for c in &wb.sheets[0].cells {
            if let Some(v) = &c.v {
                grid.insert((c.r, c.c), v.clone());
            }
        }
        let grids = HashMap::from([("数据".to_string(), grid)]);
        let got = read_ods_charts(&p, &grids);
        let cs = got.get("数据").expect("图表按表名对回");
        assert_eq!(cs.len(), 1);
        assert_eq!(cs[0].chart_type, "column");
        assert_eq!(cs[0].title, "月销量");
        assert_eq!((cs[0].anchor_row, cs[0].anchor_col), (4, 3), "锚点格往返");
        assert_eq!(cs[0].series[0].name, "销量");
        assert_eq!(cs[0].series[0].vals, vec![10.0, 20.0], "值按引用从网格取");
        assert_eq!(cs[0].series[0].cats.len(), 2, "类目域从轴上摊回来");
        std::fs::remove_file(&path).ok();
    }

    fn blank() -> ChartPayload {
        ChartPayload {
            chart_type: "column".into(),
            grouping: "standard".into(),
            title: String::new(),
            radar_style: None,
            scatter_style: None,
            anchor_row: 0,
            anchor_col: 0,
            width: 200,
            height: 150,
            axes: vec![],
            series: vec![ChartSeries {
                name: "A".into(),
                cat: None,
                val: RangeRef { sheet: String::new(), r1: 0, c1: 0, r2: 2, c2: 0 },
                cats: vec![],
                vals: vec![],
                chart_type: None,
                secondary_axis: false,
            }],
        }
    }
}
