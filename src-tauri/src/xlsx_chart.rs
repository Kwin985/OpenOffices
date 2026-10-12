//! 直接解析 xlsx 图表部件：xl/drawings/*.xml（锚点/尺寸）+ xl/charts/chartN.xml（类型/系列引用）。
//! 系列数值按引用从已读入的单元格网格解析（不信文件内缓存），对 Excel/WPS 重存文件稳健。

use std::collections::HashMap;
use std::fs::File;

use quick_xml::events::Event;
use quick_xml::Reader;

use crate::xlsx::{ChartAxis, ChartPayload, ChartSeries, RangeRef};
use crate::xlsx_style::{a1_to_rc, attr_str, read_entry, sheet_paths};
use serde_json::Value;

pub(crate) type Grid = HashMap<(u32, u32), Value>;

pub(crate) fn resolve_rel(base: &str, target: &str) -> String {
    let target = target.trim_start_matches('/');
    if target.starts_with("xl/") {
        return target.to_string();
    }
    let dir = &base[..base.rfind('/').unwrap_or(0)];
    let mut stack: Vec<&str> = dir.split('/').collect();
    for seg in target.split('/') {
        match seg {
            ".." => {
                stack.pop();
            }
            "." | "" => {}
            _ => stack.push(seg),
        }
    }
    stack.join("/")
}

pub(crate) fn rels_of(path: &str) -> String {
    let (dir, file) = path.rsplit_once('/').unwrap_or(("", path));
    format!("{dir}/_rels/{file}.rels")
}

pub(crate) fn parse_rels(xml: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let mut reader = Reader::from_str(xml);
    while let Ok(ev) = reader.read_event() {
        if let Event::Empty(e) | Event::Start(e) = &ev {
            if e.local_name().as_ref() == "Relationship" {
                if let (Some(id), Some(t)) = (attr_str(e, "Id"), attr_str(e, "Target")) {
                    out.insert(id, t);
                }
            }
        }
        if matches!(ev, Event::Eof) {
            break;
        }
    }
    out
}

fn parse_ref(s: &str) -> Option<RangeRef> {
    let (sheet, rng) = match s.rsplit_once('!') {
        Some((a, b)) => (a.trim_matches('\''), b),
        None => ("", s),
    };
    let (a, b) = rng.split_once(':').map(|(x, y)| (x, y)).unwrap_or((rng, rng));
    let (r1, c1) = a1_to_rc(&a.replace('$', ""))?;
    let (r2, c2) = a1_to_rc(&b.replace('$', ""))?;
    Some(RangeRef {
        sheet: sheet.to_string(),
        r1: r1.min(r2),
        c1: c1.min(c2),
        r2: r1.max(r2),
        c2: c1.max(c2),
    })
}

fn cells_in(rf: &RangeRef) -> Vec<(u32, u32)> {
    let mut out = Vec::new();
    if rf.r1 == rf.r2 {
        for c in rf.c1..=rf.c2 {
            out.push((rf.r1, c));
        }
    } else {
        for r in rf.r1..=rf.r2 {
            out.push((r, rf.c1));
        }
    }
    out
}

fn resolve_values(rf: &RangeRef, host: &str, grids: &HashMap<String, Grid>) -> Vec<Value> {
    let sheet = if rf.sheet.is_empty() { host } else { rf.sheet.as_str() };
    let Some(grid) = grids.get(sheet) else {
        return Vec::new();
    };
    cells_in(rf)
        .iter()
        .map(|rc| grid.get(rc).cloned().unwrap_or(Value::Null))
        .collect()
}

fn num_of(v: &Value) -> f64 {
    match v {
        Value::Number(n) => n.as_f64().unwrap_or(0.0),
        Value::String(s) => s.parse().unwrap_or(0.0),
        Value::Bool(b) => (*b as i32) as f64,
        _ => 0.0,
    }
}

#[derive(Default)]
struct SerParse {
    name_ref: Option<String>,
    name_lit: String,
    cat_ref: Option<String>,
    val_ref: Option<String>,
    /// 本系列落在 plotArea 里的第几个 chart 元素上（组合图按它定本系列的图型）
    elem: usize,
}

/// plotArea 里的一个 chart 元素（`<c:barChart>`/`<c:lineChart>`/…）。组合图就是同一 plotArea 里并排放多个
#[derive(Default)]
struct ElemCtx {
    ty: String,
    bar_dir: String,
    grouping: String,
    radar_style: String,
    scatter_style: String,
    /// 本元素引用的轴 id（`<c:axId>`，通常两根：一根类目轴、一根值轴）
    ax_ids: Vec<String>,
    /// 本元素的系列走次值轴（组合图里量纲差得远的那条）
    secondary: bool,
}

impl ElemCtx {
    /// barChart 的 barDir 才分 column/bar（OOXML：barDir=col 是垂直柱形图）
    fn resolved(&self) -> String {
        if self.ty == "bar" {
            return if self.bar_dir == "bar" { "bar".into() } else { "column".into() };
        }
        self.ty.clone()
    }
}

struct ChartCore {
    chart_type: String,
    grouping: String,
    /// 仅 radar 用：<c:radarStyle> 的 standard|marker|filled
    radar_style: String,
    /// 仅 scatter 用：<c:scatterStyle> 的 marker|line|lineMarker|smooth|smoothMarker
    scatter_style: String,
    title: String,
    /// 轴（按 XML 出现次序）：类目轴与值轴混在里面，值轴的第 0 根是主、第 1 根是次
    axes: Vec<ChartAxis>,
    series: Vec<ChartSeries>,
}

/// 解析 chartN.xml；None 表示不支持的类型或无有效系列（surface/bubble 等仍归此类）
fn parse_chart(xml: &str, host: &str, grids: &HashMap<String, Grid>) -> Option<ChartCore> {
    const TYPES: [&str; 8] = [
        "barChart",
        "lineChart",
        "pieChart",
        "doughnutChart",
        "areaChart",
        "radarChart",
        "scatterChart",
        "stockChart",
    ];
    // 同一 plotArea 里可能并排多个 chart 元素（组合图，如 barChart + lineChart）：
    // 每个元素自带 barDir/grouping/样式与若干 ser，所以这些都按元素记，不能像 v0.122 之前那样全局覆盖
    let mut elems: Vec<ElemCtx> = Vec::new();
    // 值轴按出现次序编号：第 0 根是主轴，之后都是次轴（Excel 只认主/次两根值轴，第三根起归到次轴并记账）
    let mut val_ax_ids: Vec<String> = Vec::new();
    // 当前是否在某个轴定义元素里（轴定义内部也有 <c:axId>，那是"声明"，不是 chart 元素的"引用"）
    let mut ax_kind = "";
    // 轴定义按出现次序收集，散在 plotArea 的 chart 元素之后
    let mut axes: Vec<ChartAxis> = Vec::new();
    let mut title = String::new();
    let mut in_title = false;
    let mut in_t = false;
    // 轴自己的标题（<c:valAx><c:title>…），与图表标题是两回事
    let mut ax_title = false;
    let mut in_ax_t = false;
    let mut in_plot = false;
    let mut field = 0u8; // 1=tx 2=cat 3=val
    let mut want = 0u8; // 1=抓 <f> 2=抓 <v>
    let mut ser: Option<SerParse> = None;
    let mut sers: Vec<SerParse> = Vec::new();

    let mut reader = Reader::from_str(xml);
    while let Ok(ev) = reader.read_event() {
        match &ev {
            Event::Start(e) | Event::Empty(e) => {
                let raw = e.local_name();
                let nm: &str = raw.as_ref();
                match nm {
                    "title" if !in_plot && matches!(&ev, Event::Start(_)) => in_title = true,
                    "t" if in_title && matches!(&ev, Event::Start(_)) => in_t = true,
                    "plotArea" => in_plot = true,
                    "valAx" if matches!(&ev, Event::Start(_)) => {
                        ax_kind = "val";
                        axes.push(ChartAxis { kind: "val".into(), ..Default::default() });
                    }
                    "catAx" | "dateAx" if matches!(&ev, Event::Start(_)) => {
                        ax_kind = "cat";
                        axes.push(ChartAxis { kind: "cat".into(), ..Default::default() });
                    }
                    // 轴定义里的是"声明"（记进 val_ax_ids 定序），chart 元素里的是"引用"（记进该元素）
                    "axId" => {
                        let v = attr_str(e, "val").unwrap_or_default();
                        if v.is_empty() {
                        } else if !ax_kind.is_empty() {
                            if let Some(a) = axes.last_mut() {
                                a.id = v.clone();
                            }
                            if ax_kind == "val" {
                                val_ax_ids.push(v)
                            }
                        } else if let Some(cur) = elems.last_mut() {
                            cur.ax_ids.push(v)
                        }
                    }
                    // 轴的刻度：min/max/logBase 住 <c:scaling>，major/minorUnit 直接在轴下
                    "min" | "max" | "logBase" | "majorUnit" | "minorUnit" if !ax_kind.is_empty() => {
                        let v = attr_str(e, "val").and_then(|s| s.trim().parse::<f64>().ok());
                        if let (Some(v), Some(a)) = (v, axes.last_mut()) {
                            match nm {
                                "min" => a.min = Some(v),
                                "max" => a.max = Some(v),
                                "logBase" => a.log_base = Some(v),
                                "majorUnit" => a.major_unit = Some(v),
                                _ => a.minor_unit = Some(v),
                            }
                        }
                    }
                    "delete" if !ax_kind.is_empty() => {
                        if let Some(a) = axes.last_mut() {
                            a.hidden = matches!(attr_str(e, "val").as_deref(), Some("1" | "true"));
                        }
                    }
                    "axPos" if !ax_kind.is_empty() => {
                        if let Some(a) = axes.last_mut() {
                            a.pos = attr_str(e, "val").unwrap_or_default();
                        }
                    }
                    // orientation 只有 maxMin（倒序）与 minMax（默认）两档
                    "orientation" if !ax_kind.is_empty() => {
                        if let Some(a) = axes.last_mut() {
                            a.reverse = attr_str(e, "val").as_deref() == Some("maxMin");
                        }
                    }
                    // sourceLinked=1 是"跟随源数据的格式"，等于这根轴自己没说话
                    "numFmt" if !ax_kind.is_empty() => {
                        let linked = attr_str(e, "sourceLinked").as_deref() == Some("1");
                        if !linked {
                            if let (Some(f), Some(a)) = (attr_str(e, "formatCode"), axes.last_mut())
                            {
                                if !f.is_empty() {
                                    a.num_format = Some(f);
                                }
                            }
                        }
                    }
                    // 显示单位：内置档给的是 thousands 这类词，自定义档给的是 10000 这种数字串
                    "builtInUnit" | "custUnit" if !ax_kind.is_empty() => {
                        if let (Some(u), Some(a)) = (attr_str(e, "val"), axes.last_mut()) {
                            if !u.is_empty() {
                                a.display_unit = Some(u);
                            }
                        }
                    }
                    "title" if !ax_kind.is_empty() && matches!(&ev, Event::Start(_)) => {
                        ax_title = true
                    }
                    "t" if ax_title && matches!(&ev, Event::Start(_)) => in_ax_t = true,
                    "barDir" => {
                        if let Some(cur) = elems.last_mut() {
                            cur.bar_dir = attr_str(e, "val").unwrap_or_default()
                        }
                    }
                    "grouping" if ser.is_none() => {
                        if let Some(cur) = elems.last_mut() {
                            cur.grouping = attr_str(e, "val").unwrap_or_default()
                        }
                    }
                    "radarStyle" if ser.is_none() => {
                        if let Some(cur) = elems.last_mut() {
                            cur.radar_style = attr_str(e, "val").unwrap_or_default()
                        }
                    }
                    "scatterStyle" if ser.is_none() => {
                        if let Some(cur) = elems.last_mut() {
                            cur.scatter_style = attr_str(e, "val").unwrap_or_default()
                        }
                    }
                    t if TYPES.contains(&t) && matches!(&ev, Event::Start(_)) => {
                        elems.push(ElemCtx {
                            ty: match t {
                                "lineChart" => "line".into(),
                                "pieChart" => "pie".into(),
                                "doughnutChart" => "doughnut".into(),
                                "areaChart" => "area".into(),
                                "radarChart" => "radar".into(),
                                "scatterChart" => "scatter".into(),
                                "stockChart" => "stock".into(),
                                _ => "bar".into(), // barChart，barDir 稍后区分 column/bar
                            },
                            ..Default::default()
                        });
                    }
                    "ser" if matches!(&ev, Event::Start(_)) => {
                        let mut s = SerParse::default();
                        s.elem = elems.len().saturating_sub(1);
                        ser = Some(s);
                        field = 0;
                    }
                    "tx" if ser.is_some() => field = 1,
                    "cat" if ser.is_some() => field = 2,
                    "val" if ser.is_some() => field = 3,
                    // scatterChart 的系列用 xVal/yVal（两轴都是数值），分别落进 cat/val 槽
                    "xVal" if ser.is_some() => field = 2,
                    "yVal" if ser.is_some() => field = 3,
                    "f" if field > 0 && ser.is_some() => want = 1,
                    "v" if field == 1 => want = 2,
                    _ => {}
                }
            }
            Event::Text(t) => {
                let text = t.as_ref().to_string();
                if in_t {
                    title.push_str(&text);
                } else if in_ax_t {
                    if let Some(a) = axes.last_mut() {
                        a.title.get_or_insert_with(String::new).push_str(&text);
                    }
                } else if want == 1 {
                    if let Some(s) = ser.as_mut() {
                        match field {
                            1 => s.name_ref = Some(text),
                            2 => s.cat_ref = Some(text),
                            3 => s.val_ref = Some(text),
                            _ => {}
                        }
                    }
                    want = 0;
                } else if want == 2 {
                    if let Some(s) = ser.as_mut() {
                        s.name_lit.push_str(&text);
                    }
                }
            }
            // quick-xml 0.42 把 &amp;/&#x…; 拆成独立事件，手动还原进当前捕获位
            Event::GeneralRef(r) => {
                let resolved = r
                    .resolve_char_ref()
                    .ok()
                    .flatten()
                    .map(|c| c.to_string())
                    .or_else(|| {
                        quick_xml::escape::resolve_predefined_entity(r.as_ref())
                            .map(|s| s.to_string())
                    });
                if let Some(text) = resolved {
                    if in_t {
                        title.push_str(&text);
                    } else if in_ax_t {
                        if let Some(a) = axes.last_mut() {
                            a.title.get_or_insert_with(String::new).push_str(&text);
                        }
                    } else if want == 2 {
                        if let Some(s) = ser.as_mut() {
                            s.name_lit.push_str(&text);
                        }
                    }
                }
            }
            Event::End(e) => {
                let raw = e.local_name();
                let nm: &str = raw.as_ref();
                match nm {
                    "ser" => {
                        if let Some(s) = ser.take() {
                            sers.push(s);
                        }
                        field = 0;
                    }
                    "tx" | "cat" | "val" | "xVal" | "yVal" => field = 0,
                    "valAx" | "catAx" | "dateAx" => ax_kind = "",
                    "v" => want = 0,
                    "title" => {
                        if ax_title {
                            if let Some(a) = axes.last_mut() {
                                let s = a.title.as_deref().unwrap_or("").trim().to_string();
                                a.title = if s.is_empty() { None } else { Some(s) };
                            }
                        }
                        in_title = false;
                        ax_title = false;
                    }
                    "t" => {
                        in_t = false;
                        in_ax_t = false;
                    }
                    _ => {}
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }

    if elems.is_empty() {
        return None;
    }
    // 值轴按出现次序定序后回看每个 chart 元素引用了第几根：第 0 根是主轴，之后皆为次轴
    let val_idx: HashMap<&str, usize> = val_ax_ids
        .iter()
        .enumerate()
        .map(|(i, a)| (a.as_str(), i))
        .collect();
    for e in elems.iter_mut() {
        let hits: Vec<usize> = e
            .ax_ids
            .iter()
            .filter_map(|a| val_idx.get(a.as_str()).copied())
            .collect();
        e.secondary = match hits.as_slice() {
            // 引用的两根都是值轴 ⇒ 散点图（X/Y 皆数值轴），无所谓主次
            [_, _, ..] => false,
            [i] => *i >= 1,
            _ => false,
        };
    }
    // 主图型 = 第一个 chart 元素（Excel 组合图里它承载主轴与共享的类别轴）
    let ctype = elems[0].resolved();
    let mut series: Vec<ChartSeries> = Vec::new();
    for s in sers {
        // 组合图里这一系列可能属于后面的 chart 元素：只有与主图型不同才记（同型就留 None 随主图型）
        let own = elems
            .get(s.elem)
            .map(|e| e.resolved())
            .unwrap_or_else(|| ctype.clone());
        let chart_type = if own == ctype { None } else { Some(own) };
        let val = match s.val_ref.as_deref().and_then(parse_ref) {
            Some(v) => v,
            None => continue,
        };
        let cat = s.cat_ref.as_deref().and_then(parse_ref);
        let vals = resolve_values(&val, host, grids)
            .iter()
            .map(num_of)
            .collect::<Vec<_>>();
        let cats = cat
            .as_ref()
            .map(|c| resolve_values(c, host, grids))
            .unwrap_or_default();
        let name = match s.name_ref.as_deref().and_then(parse_ref) {
            Some(r) => match resolve_values(&r, host, grids).into_iter().next() {
                Some(Value::String(s2)) => s2,
                Some(Value::Null) | None => s.name_lit,
                Some(other) => other.to_string().trim_matches('"').to_string(),
            },
            None => s.name_lit,
        };
        // 次轴随系列走：它和"本系列的图型"一样是由所属的 chart 元素决定的
        let secondary_axis = elems.get(s.elem).map(|e| e.secondary).unwrap_or(false);
        series.push(ChartSeries {
            name,
            cat,
            val,
            cats,
            vals,
            chart_type,
            secondary_axis,
        });
    }
    if series.is_empty() {
        return None;
    }
    Some(ChartCore {
        chart_type: ctype,
        grouping: elems[0].grouping.clone(),
        radar_style: elems[0].radar_style.trim().to_string(),
        scatter_style: elems[0].scatter_style.trim().to_string(),
        title: title.trim().to_string(),
        // 整根轴没说话就不进载荷：朴素图表的载荷与 v0.124 之前逐字同形
        axes: axes.into_iter().filter(|a| a.speaks()).collect(),
        series,
    })
}

#[derive(Default)]
struct Anchor {
    row: u32,
    col: u32,
    width: u32,
    height: u32,
}

/// 解析 drawingN.xml：每个含 c:chart 的锚 → (Anchor, chart relId)
fn parse_drawing(xml: &str) -> Vec<(Anchor, String)> {
    let mut out = Vec::new();
    let mut cur: Option<Anchor> = None;
    let mut in_to = false;
    let mut grab: u8 = 0; // 1=from.col 2=from.row 3=to.col 4=to.row
    let mut to = (0u32, 0u32);
    let mut rid = String::new();
    let mut reader = Reader::from_str(xml);
    while let Ok(ev) = reader.read_event() {
        match &ev {
            Event::Start(e) | Event::Empty(e) => {
                let raw = e.local_name();
                let nm: &str = raw.as_ref();
                match nm {
                    "oneCellAnchor" | "twoCellAnchor" if matches!(&ev, Event::Start(_)) => {
                        cur = Some(Anchor::default());
                        rid.clear();
                        to = (0, 0);
                        in_to = false;
                    }
                    "from" => in_to = false,
                    "to" => in_to = true,
                    "col" if cur.is_some() => grab = if in_to { 3 } else { 1 },
                    "row" if cur.is_some() => grab = if in_to { 4 } else { 2 },
                    "ext" => {
                        if let Some(a) = cur.as_mut() {
                            let cx = attr_str(e, "cx")
                                .and_then(|v| v.parse::<f64>().ok())
                                .unwrap_or(0.0);
                            let cy = attr_str(e, "cy")
                                .and_then(|v| v.parse::<f64>().ok())
                                .unwrap_or(0.0);
                            if cx > 0.0 {
                                a.width = (cx / 9525.0).round() as u32;
                            }
                            if cy > 0.0 {
                                a.height = (cy / 9525.0).round() as u32;
                            }
                        }
                    }
                    "chart" => {
                        if let Some(id) = attr_str(e, "id") {
                            rid = id;
                        }
                    }
                    _ => {}
                }
            }
            Event::Text(t) => {
                if grab > 0 {
                    if let Some(a) = cur.as_mut() {
                        let n: u32 = t
                            .as_ref()
                            .trim()
                            .parse()
                            .unwrap_or(0);
                        match grab {
                            1 => a.col = n,
                            2 => a.row = n,
                            3 => to.0 = n,
                            _ => to.1 = n,
                        }
                    }
                    grab = 0;
                }
            }
            Event::End(e) => {
                let raw = e.local_name();
                let nm: &str = raw.as_ref();
                if nm == "oneCellAnchor" || nm == "twoCellAnchor" {
                    if let Some(mut a) = cur.take() {
                        if a.width == 0 && to.0 > a.col {
                            a.width = (to.0 - a.col) * 64;
                        }
                        if a.height == 0 && to.1 > a.row {
                            a.height = (to.1 - a.row) * 20;
                        }
                        if !rid.is_empty() {
                            out.push((a, rid.clone()));
                        }
                    }
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    out
}

fn map_grouping(g: &str) -> String {
    match g {
        "stacked" => "stacked".into(),
        "percentStacked" => "percentStacked".into(),
        _ => "standard".into(),
    }
}

/// 只做文件名嗅探（不解 XML）：让 `read_xlsx` 在没有图表的簿子上省掉整张网格的克隆
pub fn has_charts(path: &str) -> bool {
    let Ok(file) = File::open(path) else {
        return false;
    };
    match zip::ZipArchive::new(file) {
        Ok(zip) => zip
            .file_names()
            .any(|n| n.starts_with("xl/charts/chart") && n.ends_with(".xml")),
        Err(_) => false,
    }
}

/// 主入口：返回 sheetName → 图表列表；缺部件（多数工作簿没有图表）静默跳过
pub fn read_xlsx_charts(
    path: &str,
    grids: &HashMap<String, Grid>,
) -> HashMap<String, Vec<ChartPayload>> {
    let mut out: HashMap<String, Vec<ChartPayload>> = HashMap::new();
    let Ok(file) = File::open(path) else {
        return out;
    };
    let Ok(mut zip) = zip::ZipArchive::new(file) else {
        return out;
    };
    for (name, sheet_path) in sheet_paths(&mut zip) {
        let Some(sheet_rels) = read_entry(&mut zip, &rels_of(&sheet_path)) else {
            continue;
        };
        let drawings: Vec<String> = parse_rels(&sheet_rels)
            .values()
            .filter(|t| t.contains("drawing"))
            .map(|t| resolve_rel(&sheet_path, t))
            .collect();
        for dw in drawings {
            let Some(dw_xml) = read_entry(&mut zip, &dw) else {
                continue;
            };
            let dw_rels = parse_rels(
                &read_entry(&mut zip, &rels_of(&dw)).unwrap_or_default(),
            );
            for (anchor, rid) in parse_drawing(&dw_xml) {
                let Some(chart_path) = dw_rels.get(&rid).map(|t| resolve_rel(&dw, t)) else {
                    continue;
                };
                let Some(chart_xml) = read_entry(&mut zip, &chart_path) else {
                    continue;
                };
                if let Some(core) = parse_chart(&chart_xml, &name, grids) {
                    out.entry(name.clone()).or_default().push(ChartPayload {
                        chart_type: core.chart_type,
                        grouping: map_grouping(&core.grouping),
                        title: core.title,
                        radar_style: if core.radar_style.is_empty() {
                            None
                        } else {
                            Some(core.radar_style.clone())
                        },
                        scatter_style: if core.scatter_style.is_empty() {
                            None
                        } else {
                            Some(core.scatter_style.clone())
                        },
                        anchor_row: anchor.row,
                        anchor_col: anchor.col,
                        width: anchor.width.max(120),
                        height: anchor.height.max(90),
                        axes: core.axes,
                        series: core.series,
                    });
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rel_paths_resolve() {
        assert_eq!(
            resolve_rel("xl/worksheets/sheet1.xml", "../drawings/drawing1.xml"),
            "xl/drawings/drawing1.xml"
        );
        assert_eq!(
            resolve_rel("xl/drawings/drawing1.xml", "../charts/chart1.xml"),
            "xl/charts/chart1.xml"
        );
        assert_eq!(resolve_rel("xl/x.xml", "/xl/charts/chart2.xml"), "xl/charts/chart2.xml");
        assert_eq!(rels_of("xl/worksheets/sheet1.xml"), "xl/worksheets/_rels/sheet1.xml.rels");
    }

    #[test]
    fn refs_parse() {
        let r = parse_ref("'成绩 表'!$B$2:$B$6").unwrap();
        assert_eq!((r.sheet.as_str(), r.r1, r.c1, r.r2, r.c2), ("成绩 表", 1, 1, 5, 1));
        let s = parse_ref("Sheet1!A1").unwrap();
        assert_eq!((s.sheet.as_str(), s.r1, s.c1, s.r2, s.c2), ("Sheet1", 0, 0, 0, 0));
        assert!(parse_ref("nonsense").is_none());
    }

    #[test]
    fn chart_xml_parses_column_with_title_and_series() {
        let grid: HashMap<String, Grid> = HashMap::from([(
            "S1".to_string(),
            Grid::from([
                ((0, 0), Value::String("月".into())),
                ((0, 1), Value::String("销量".into())),
                ((1, 0), Value::String("一月".into())),
                ((1, 1), Value::from(3)),
                ((2, 0), Value::String("二月".into())),
                ((2, 1), Value::from(5.5)),
            ]),
        )]);
        let xml = r#"<c:chartSpace xmlns:c="c" xmlns:a="a"><c:chart>
          <c:title><c:tx><c:rich><a:p><a:r><a:t>销量&amp;利润图</a:t></a:r></a:p></c:rich></c:tx></c:title>
          <c:plotArea><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>
            <c:ser><c:tx><c:strRef><c:f>S1!$B$1</c:f></c:strRef></c:tx>
              <c:cat><c:strRef><c:f>S1!$A$2:$A$3</c:f><c:strCache><c:pt><c:v>陈旧</c:v></c:pt></c:strCache></c:strRef></c:cat>
              <c:val><c:numRef><c:f>S1!$B$2:$B$3</c:f></c:numRef></c:val>
            </c:ser>
          </c:barChart></c:plotArea></c:chart></c:chartSpace>"#;
        let core = parse_chart(xml, "S1", &grid).expect("column 图表");
        assert_eq!(core.chart_type, "column");
        assert_eq!(core.title, "销量&利润图", "标题实体应解码");
        let s = &core.series[0];
        assert_eq!(s.name, "销量", "系列名从网格取，不信缓存");
        assert_eq!(s.cats, vec![Value::String("一月".into()), Value::String("二月".into())]);
        assert_eq!(s.vals, vec![3.0, 5.5]);
    }

    #[test]
    fn unsupported_and_missing_series_drop() {
        let grid: HashMap<String, Grid> = HashMap::new();
        // surface 不在支持的八型之内 → None
        let surface = r#"<c:chartSpace><c:chart><c:plotArea><c:surfaceChart><c:ser>
          <c:val><c:numRef><c:f>S!$A$1</c:f></c:numRef></c:val></c:ser></c:surfaceChart>
        </c:plotArea></c:chart></c:chartSpace>"#;
        assert!(parse_chart(surface, "S", &grid).is_none());
        // 缺少 val 引用的系列 → None
        let noval = r#"<c:chartSpace><c:chart><c:plotArea><c:pieChart><c:ser>
          <c:cat><c:strRef><c:f>S!$A$1</c:f></c:strRef></c:cat></c:ser></c:pieChart>
        </c:plotArea></c:chart></c:chartSpace>"#;
        assert!(parse_chart(noval, "S", &grid).is_none());
    }

    #[test]
    fn radar_chart_parses_with_style() {
        let grid: HashMap<String, Grid> = HashMap::from([(
            "S".to_string(),
            Grid::from([
                ((0, 0), Value::String("指标".into())),
                ((0, 1), Value::String("A".into())),
                ((1, 0), Value::String("速度".into())),
                ((1, 1), Value::from(3)),
                ((2, 0), Value::String("稳定".into())),
                ((2, 1), Value::from(5.5)),
            ]),
        )]);
        let xml = r#"<c:chartSpace xmlns:c="c"><c:chart>
          <c:title><c:tx><c:rich><a:p><a:r><a:t>雷达图</a:t></a:r></a:p></c:rich></c:tx></c:title>
          <c:plotArea><c:radarChart><c:radarStyle val="filled"/>
            <c:ser><c:tx><c:strRef><c:f>S!$B$1</c:f></c:strRef></c:tx>
              <c:cat><c:strRef><c:f>S!$A$2:$A$3</c:f></c:strRef></c:cat>
              <c:val><c:numRef><c:f>S!$B$2:$B$3</c:f></c:numRef></c:val>
            </c:ser>
          </c:radarChart></c:plotArea></c:chart></c:chartSpace>"#;
        let core = parse_chart(xml, "S", &grid).expect("radar 图表");
        assert_eq!(core.chart_type, "radar");
        assert_eq!(core.radar_style, "filled");
        assert_eq!(core.title, "雷达图");
        let s = &core.series[0];
        assert_eq!(s.name, "A", "系列名从网格取，不信缓存");
        assert_eq!(s.vals, vec![3.0, 5.5]);
    }

    #[test]
    fn scatter_chart_parses_x_y_and_style() {
        let grid: HashMap<String, Grid> = HashMap::from([(
            "S".to_string(),
            Grid::from([
                ((0, 0), Value::String("Y系列".into())),
                ((1, 0), Value::from(1)),
                ((1, 1), Value::from(2.5)),
                ((2, 0), Value::from(2)),
                ((2, 1), Value::from(5.5)),
                ((3, 0), Value::from(3)),
                ((3, 1), Value::from(9)),
            ]),
        )]);
        // A 列是 X 值（xVal）、B 列是 Y 值（yVal）；scatter 两轴都是数值，故没有类别列
        let xml = r#"<c:chartSpace xmlns:c="c"><c:chart>
          <c:plotArea><c:scatterChart><c:scatterStyle val="lineMarker"/>
            <c:ser><c:tx><c:strRef><c:f>S!$B$1</c:f></c:strRef></c:tx>
              <c:xVal><c:numRef><c:f>S!$A$2:$A$4</c:f></c:numRef></c:xVal>
              <c:yVal><c:numRef><c:f>S!$B$2:$B$4</c:f></c:numRef></c:yVal>
            </c:ser>
          </c:scatterChart>
          <c:valAx><c:axId val="11"/><c:axPos val="b"/><c:title><c:tx><c:rich><a:p><a:r><a:t>X 轴</a:t></a:r></a:p></c:rich></c:tx></c:title></c:valAx>
          <c:valAx><c:axId val="22"/><c:axPos val="l"/><c:title><c:tx><c:rich><a:p><a:r><a:t>Y 轴</a:t></a:r></a:p></c:rich></c:tx></c:title></c:valAx>
        </c:plotArea></c:chart></c:chartSpace>"#;
        let core = parse_chart(xml, "S", &grid).expect("scatter 图表");
        assert_eq!(core.chart_type, "scatter");
        assert_eq!(core.scatter_style, "lineMarker");
        assert_eq!(core.radar_style, "", "scatter 不带 radarStyle");
        // 散点两根都是值轴：X/Y 靠 axPos 分，标题各回各的轴
        assert_eq!(core.axes.len(), 2);
        assert_eq!(core.axes[0].pos, "b");
        assert_eq!(core.axes[0].title.as_deref(), Some("X 轴"));
        assert_eq!(core.axes[1].pos, "l");
        assert_eq!(core.axes[1].title.as_deref(), Some("Y 轴"));
        let s = &core.series[0];
        assert_eq!(s.vals, vec![2.5, 5.5, 9.0], "yVal → vals");
        assert_eq!(
            s.cats.iter().map(num_of).collect::<Vec<_>>(),
            vec![1.0, 2.0, 3.0],
            "xVal → cats"
        );
        let cat = s.cat.as_ref().expect("xVal 引用落到 cat");
        assert_eq!((cat.r1, cat.c1, cat.r2, cat.c2), (1, 0, 3, 0));
    }

    #[test]
    fn axes_parse_title_scale_display_unit() {
        let grid: HashMap<String, Grid> = HashMap::from([(("S".to_string(), Grid::from([((1, 1), Value::from(3)), ((2, 1), Value::from(5))])))]);
        let xml = r#"<c:chartSpace xmlns:c="c" xmlns:a="a"><c:chart><c:plotArea>
          <c:barChart><c:barDir val="col"/>
            <c:ser><c:val><c:numRef><c:f>S!$B$2:$B$3</c:f></c:numRef></c:val></c:ser>
          </c:barChart>
          <c:catAx>
            <c:axId val="111"/><c:axPos val="b"/>
            <c:title><c:tx><c:rich><a:p><a:r><a:t>月份</a:t></a:r></a:p></c:rich></c:tx></c:title>
          </c:catAx>
          <c:valAx>
            <c:axId val="222"/><c:axPos val="l"/>
            <c:scaling><c:logBase val="10"/><c:orientation val="maxMin"/><c:max val="100"/><c:min val="1"/></c:scaling>
            <c:delete val="1"/>
            <c:numFmt formatCode="0.0%" sourceLinked="0"/>
            <c:title><c:tx><c:rich><a:p><a:r><a:t>销售额</a:t></a:r></a:p></c:rich></c:tx></c:title>
            <c:dispUnits><c:builtInUnit val="thousands"/></c:dispUnits>
            <c:majorUnit val="20"/><c:minorUnit val="4"/>
          </c:valAx>
        </c:plotArea></c:chart></c:chartSpace>"#;
        let core = parse_chart(xml, "S", &grid).expect("柱状图");
        assert_eq!(core.axes.len(), 2, "两根轴都说了话");
        let cat = &core.axes[0];
        assert_eq!((cat.kind.as_str(), cat.id.as_str(), cat.pos.as_str()), ("cat", "111", "b"));
        assert_eq!(cat.title.as_deref(), Some("月份"), "轴标题取轴内 <c:title> 的文本");
        assert!(!cat.hidden);
        assert_eq!(cat.min, None, "类目轴没有 min/max 那一套");
        let val = &core.axes[1];
        assert_eq!((val.kind.as_str(), val.id.as_str(), val.pos.as_str()), ("val", "222", "l"));
        assert_eq!(val.title.as_deref(), Some("销售额"));
        assert_eq!(val.min, Some(1.0));
        assert_eq!(val.max, Some(100.0));
        assert_eq!(val.log_base, Some(10.0));
        assert_eq!(val.major_unit, Some(20.0));
        assert_eq!(val.minor_unit, Some(4.0));
        assert_eq!(val.display_unit.as_deref(), Some("thousands"));
        assert_eq!(val.num_format.as_deref(), Some("0.0%"));
        assert!(val.reverse, "orientation=maxMin → 刻度倒着走");
        assert!(val.hidden, "delete=1 → 整根轴不显示");
    }

    #[test]
    fn axis_with_no_settings_is_dropped() {
        let grid: HashMap<String, Grid> = HashMap::from([(("S".to_string(), Grid::from([((1, 1), Value::from(3))])))]);
        // 轴定义在（id/pos 都有）但啥都没说 ⇒ 不进载荷，朴素图表的形状与 v0.124 逐字相同
        let xml = r#"<c:chartSpace xmlns:c="c"><c:chart><c:plotArea>
          <c:barChart><c:barDir val="col"/>
            <c:ser><c:val><c:numRef><c:f>S!$B$2</c:f></c:numRef></c:val></c:ser>
          </c:barChart>
          <c:catAx><c:axId val="111"/><c:axPos val="b"/></c:catAx>
          <c:valAx><c:axId val="222"/><c:axPos val="l"/></c:valAx>
        </c:plotArea></c:chart></c:chartSpace>"#;
        let core = parse_chart(xml, "S", &grid).expect("柱状图");
        assert!(core.axes.is_empty(), "没说话的轴不进载荷");
        // sourceLinked=1 的数字格式是"跟随源数据"，同样不算说话
        let xml2 = xml.replace(
            "<c:axId val=\"222\"/>",
            "<c:axId val=\"222\"/><c:numFmt formatCode=\"0\" sourceLinked=\"1\"/>",
        );
        let core2 = parse_chart(&xml2, "S", &grid).expect("柱状图2");
        assert!(core2.axes.is_empty(), "sourceLinked=1 不算轴自己说话");
    }

    #[test]
    fn stock_chart_parses_multi_series_shared_categories() {
        let grid: HashMap<String, Grid> = HashMap::from([(
            "S".to_string(),
            Grid::from([
                ((0, 1), Value::String("开盘".into())),
                ((0, 2), Value::String("收盘".into())),
                ((1, 0), Value::String("1月2日".into())),
                ((1, 1), Value::from(10)),
                ((1, 2), Value::from(12)),
                ((2, 0), Value::String("1月3日".into())),
                ((2, 1), Value::from(12)),
                ((2, 2), Value::from(11)),
            ]),
        )]);
        // 股价图的 ser 结构与折线图同构（cat + val），四段 OHLC 就是四个共享类别的系列
        let xml = r#"<c:chartSpace xmlns:c="c"><c:chart>
          <c:title><c:tx><c:rich><a:p><a:r><a:t>股价</a:t></a:r></a:p></c:rich></c:tx></c:title>
          <c:plotArea><c:stockChart>
            <c:ser><c:tx><c:strRef><c:f>S!$B$1</c:f></c:strRef></c:tx>
              <c:cat><c:strRef><c:f>S!$A$2:$A$3</c:f></c:strRef></c:cat>
              <c:val><c:numRef><c:f>S!$B$2:$B$3</c:f></c:numRef></c:val>
            </c:ser>
            <c:ser><c:tx><c:strRef><c:f>S!$C$1</c:f></c:strRef></c:tx>
              <c:cat><c:strRef><c:f>S!$A$2:$A$3</c:f></c:strRef></c:cat>
              <c:val><c:numRef><c:f>S!$C$2:$C$3</c:f></c:numRef></c:val>
            </c:ser>
            <c:upDownBars><c:gapWidth val="100"/></c:upDownBars>
          </c:stockChart></c:plotArea></c:chart></c:chartSpace>"#;
        let core = parse_chart(xml, "S", &grid).expect("stock 图表");
        assert_eq!(core.chart_type, "stock");
        assert_eq!(core.title, "股价");
        assert_eq!(core.series.len(), 2);
        assert_eq!(core.series[0].name, "开盘");
        assert_eq!(core.series[0].vals, vec![10.0, 12.0]);
        assert_eq!(core.series[1].name, "收盘");
        assert_eq!(core.series[1].vals, vec![12.0, 11.0]);
    }

    #[test]
    fn combo_chart_keeps_per_series_type() {
        let grid: HashMap<String, Grid> = HashMap::from([(
            "S".to_string(),
            Grid::from([
                ((1, 1), Value::from(3)),
                ((2, 1), Value::from(5)),
                ((1, 2), Value::from(7)),
                ((2, 2), Value::from(9)),
                ((1, 3), Value::from(2)),
                ((2, 3), Value::from(4)),
            ]),
        )]);
        // 柱形图（两条系列）+ 折线图（一条）：v0.123 之前只认最后命中的 line，柱形那两条被当成 line
        let xml = r#"<c:chartSpace><c:chart><c:plotArea>
          <c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>
            <c:ser><c:val><c:numRef><c:f>S!$B$2:$B$3</c:f></c:numRef></c:val></c:ser>
            <c:ser><c:val><c:numRef><c:f>S!$C$2:$C$3</c:f></c:numRef></c:val></c:ser>
          </c:barChart>
          <c:lineChart><c:grouping val="standard"/>
            <c:ser><c:val><c:numRef><c:f>S!$D$2:$D$3</c:f></c:numRef></c:val></c:ser>
          </c:lineChart>
        </c:plotArea></c:chart></c:chartSpace>"#;
        let core = parse_chart(xml, "S", &grid).expect("组合图");
        assert_eq!(core.chart_type, "column", "主图型取第一个 chart 元素");
        assert_eq!(core.grouping, "clustered", "grouping 取主元素那一档");
        assert_eq!(core.series.len(), 3, "三个系列一条都不能丢");
        assert_eq!(core.series[0].chart_type, None, "与主图同型的系列不重复记");
        assert_eq!(core.series[1].chart_type, None);
        assert_eq!(core.series[2].chart_type.as_deref(), Some("line"), "副图型落在系列上");
        assert_eq!(core.series[2].vals, vec![2.0, 4.0]);

        // 两个 barChart、barDir 不同：前 col 后 bar ⇒ 后者是真正的副图（同一名却不同型）
        let two = r#"<c:chartSpace><c:chart><c:plotArea>
          <c:barChart><c:barDir val="col"/>
            <c:ser><c:val><c:numRef><c:f>S!$B$2:$B$3</c:f></c:numRef></c:val></c:ser>
          </c:barChart>
          <c:barChart><c:barDir val="bar"/>
            <c:ser><c:val><c:numRef><c:f>S!$C$2:$C$3</c:f></c:numRef></c:val></c:ser>
          </c:barChart>
        </c:plotArea></c:chart></c:chartSpace>"#;
        let c2 = parse_chart(two, "S", &grid).expect("双 barChart");
        assert_eq!(c2.chart_type, "column");
        assert_eq!(c2.series[0].chart_type, None);
        assert_eq!(c2.series[1].chart_type.as_deref(), Some("bar"), "barDir 按元素各判");
    }

    #[test]
    fn combo_chart_secondary_axis_from_ax_id() {
        let grid: HashMap<String, Grid> = HashMap::from([(
            "S".to_string(),
            Grid::from([
                ((1, 1), Value::from(3)),
                ((1, 2), Value::from(7)),
                ((1, 3), Value::from(900)),
            ]),
        )]);
        // 柱形（两系列）+ 折线（一条，量纲差得远）：柱形引用第一根值轴，折线引用第二根 ⇒ 折线走次轴
        let xml = r#"<c:chartSpace><c:chart><c:plotArea>
          <c:barChart><c:barDir val="col"/>
            <c:axId val="111"/><c:axId val="222"/>
            <c:ser><c:val><c:numRef><c:f>S!$B$2</c:f></c:numRef></c:val></c:ser>
            <c:ser><c:val><c:numRef><c:f>S!$C$2</c:f></c:numRef></c:val></c:ser>
          </c:barChart>
          <c:lineChart>
            <c:axId val="111"/><c:axId val="333"/>
            <c:ser><c:val><c:numRef><c:f>S!$D$2</c:f></c:numRef></c:val></c:ser>
          </c:lineChart>
          <c:catAx><c:axId val="111"/><c:crossAx val="222"/></c:catAx>
          <c:valAx><c:axId val="222"/><c:crossAx val="111"/></c:valAx>
          <c:valAx><c:axId val="333"/><c:crossAx val="111"/></c:valAx>
        </c:plotArea></c:chart></c:chartSpace>"#;
        let core = parse_chart(xml, "S", &grid).expect("带次轴的组合图");
        assert_eq!(core.series.len(), 3);
        assert!(!core.series[0].secondary_axis, "柱形走主轴");
        assert!(!core.series[1].secondary_axis, "柱形走主轴");
        assert!(
            core.series[2].secondary_axis,
            "折线引用第二根值轴 ⇒ 次轴"
        );
        assert_eq!(core.series[2].chart_type.as_deref(), Some("line"));

        // 散点图两根都是值轴（X/Y 皆数值），无所谓主次 ⇒ 不能被判成次轴
        let scatter = r#"<c:chartSpace><c:chart><c:plotArea>
          <c:scatterChart><c:scatterStyle val="marker"/>
            <c:axId val="111"/><c:axId val="222"/>
            <c:ser>
              <c:xVal><c:numRef><c:f>S!$B$2</c:f></c:numRef></c:xVal>
              <c:yVal><c:numRef><c:f>S!$C$2</c:f></c:numRef></c:yVal>
            </c:ser>
          </c:scatterChart>
          <c:valAx><c:axId val="111"/></c:valAx>
          <c:valAx><c:axId val="222"/></c:valAx>
        </c:plotArea></c:chart></c:chartSpace>"#;
        let sc = parse_chart(scatter, "S", &grid).expect("散点图");
        assert!(!sc.series[0].secondary_axis, "散点两根值轴无主次");

        // 单一图型（一根值轴）⇒ 系列全是主轴，且载荷与 v0.123 之前同形
        let single = r#"<c:chartSpace><c:chart><c:plotArea>
          <c:barChart><c:barDir val="col"/>
            <c:axId val="111"/><c:axId val="222"/>
            <c:ser><c:val><c:numRef><c:f>S!$B$2</c:f></c:numRef></c:val></c:ser>
          </c:barChart>
          <c:catAx><c:axId val="111"/></c:catAx>
          <c:valAx><c:axId val="222"/></c:valAx>
        </c:plotArea></c:chart></c:chartSpace>"#;
        let sg = parse_chart(single, "S", &grid).expect("单一图型");
        assert!(!sg.series[0].secondary_axis, "单一图型无次轴");
        assert_eq!(sg.series[0].chart_type, None);
    }

    #[test]
    fn combo_chart_primary_is_first_element() {
        let grid: HashMap<String, Grid> = HashMap::from([(
            "S".to_string(),
            Grid::from([((1, 1), Value::from(3)), ((1, 2), Value::from(7))]),
        )]);
        // 顺序反过来：折线在前 ⇒ 主图型是 line，柱形那条才是副图
        let xml = r#"<c:chartSpace><c:chart><c:plotArea>
          <c:lineChart>
            <c:ser><c:val><c:numRef><c:f>S!$B$2</c:f></c:numRef></c:val></c:ser>
          </c:lineChart>
          <c:barChart><c:barDir val="col"/>
            <c:ser><c:val><c:numRef><c:f>S!$C$2</c:f></c:numRef></c:val></c:ser>
          </c:barChart>
        </c:plotArea></c:chart></c:chartSpace>"#;
        let core = parse_chart(xml, "S", &grid).expect("组合图");
        assert_eq!(core.chart_type, "line");
        assert_eq!(core.series[0].chart_type, None);
        assert_eq!(core.series[1].chart_type.as_deref(), Some("column"));
    }

    #[test]
    fn drawing_anchors_parse_chart_refs_and_size() {
        let xml = r#"<xdr:wsDr xmlns:xdr="x" xmlns:c="c" xmlns:r="r">
          <xdr:oneCellAnchor>
            <xdr:from><xdr:col>5</xdr:col><xdr:row>2</xdr:row></xdr:from>
            <xdr:ext cx="4572000" cy="2743200"/>
            <xdr:graphicFrame><a:graphicData><c:chart r:id="rId2"/></a:graphicData></xdr:graphicFrame>
          </xdr:oneCellAnchor>
          <xdr:twoCellAnchor>
            <xdr:from><xdr:col>1</xdr:col><xdr:row>1</xdr:row></xdr:from>
            <xdr:to><xdr:col>9</xdr:col><xdr:row>16</xdr:row></xdr:to>
            <xdr:graphicFrame><a:graphicData><c:chart r:id="rId7"/></a:graphicData></xdr:graphicFrame>
          </xdr:twoCellAnchor>
        </xdr:wsDr>"#;
        let anchors = parse_drawing(xml);
        assert_eq!(anchors.len(), 2);
        assert_eq!((anchors[0].0.col, anchors[0].0.row), (5, 2));
        assert_eq!((anchors[0].0.width, anchors[0].0.height), (480, 288));
        assert_eq!(anchors[0].1, "rId2");
        assert_eq!(anchors[1].0.width, 8 * 64, "twoCellAnchor 无 ext 时按单元格跨度估算");
        assert_eq!(anchors[1].0.height, 15 * 20);
    }
}
