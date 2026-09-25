//! 直接解析 xlsx 图表部件：xl/drawings/*.xml（锚点/尺寸）+ xl/charts/chartN.xml（类型/系列引用）。
//! 系列数值按引用从已读入的单元格网格解析（不信文件内缓存），对 Excel/WPS 重存文件稳健。

use std::collections::HashMap;
use std::fs::File;

use quick_xml::events::Event;
use quick_xml::Reader;

use crate::xlsx::{ChartPayload, ChartSeries, RangeRef};
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

fn parse_rels(xml: &str) -> HashMap<String, String> {
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
}

struct ChartCore {
    chart_type: String,
    grouping: String,
    title: String,
    series: Vec<ChartSeries>,
}

/// 解析 chartN.xml；None 表示不支持的类型或无有效系列（radar/scatter/stock 等归此类）
fn parse_chart(xml: &str, host: &str, grids: &HashMap<String, Grid>) -> Option<ChartCore> {
    const TYPES: [&str; 5] = ["barChart", "lineChart", "pieChart", "doughnutChart", "areaChart"];
    let mut ctype = String::new();
    let mut bar_dir = String::new();
    let mut grouping = String::new();
    let mut title = String::new();
    let mut in_title = false;
    let mut in_t = false;
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
                    "barDir" => bar_dir = attr_str(e, "val").unwrap_or_default(),
                    "grouping" if ser.is_none() => {
                        grouping = attr_str(e, "val").unwrap_or_default()
                    }
                    t if TYPES.contains(&t) && matches!(&ev, Event::Start(_)) => {
                        ctype = match t {
                            "lineChart" => "line".into(),
                            "pieChart" => "pie".into(),
                            "doughnutChart" => "doughnut".into(),
                            "areaChart" => "area".into(),
                            _ => "bar".into(), // barChart，barDir 稍后区分 column/bar
                        };
                    }
                    "ser" if matches!(&ev, Event::Start(_)) => {
                        ser = Some(SerParse::default());
                        field = 0;
                    }
                    "tx" if ser.is_some() => field = 1,
                    "cat" if ser.is_some() => field = 2,
                    "val" if ser.is_some() => field = 3,
                    "f" if field > 0 && ser.is_some() => want = 1,
                    "v" if field == 1 => want = 2,
                    _ => {}
                }
            }
            Event::Text(t) => {
                let text = t.as_ref().to_string();
                if in_t {
                    title.push_str(&text);
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
                    "tx" | "cat" | "val" => field = 0,
                    "v" => want = 0,
                    "title" => in_title = false,
                    "t" => in_t = false,
                    _ => {}
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }

    if ctype.is_empty() {
        return None;
    }
    if ctype == "bar" && bar_dir != "bar" {
        ctype = "column".into(); // OOXML：barDir=col 是垂直柱形图
    }
    let mut series: Vec<ChartSeries> = Vec::new();
    for s in sers {
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
        series.push(ChartSeries {
            name,
            cat,
            val,
            cats,
            vals,
        });
    }
    if series.is_empty() {
        return None;
    }
    Some(ChartCore {
        chart_type: ctype,
        grouping,
        title: title.trim().to_string(),
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
                        anchor_row: anchor.row,
                        anchor_col: anchor.col,
                        width: anchor.width.max(120),
                        height: anchor.height.max(90),
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
    fn unsupported_types_and_missing_series_drop() {
        let grid: HashMap<String, Grid> = HashMap::new();
        let radar = r#"<c:chartSpace><c:chart><c:plotArea><c:radarChart><c:ser>
          <c:val><c:numRef><c:f>S!$A$1</c:f></c:numRef></c:val></c:ser></c:radarChart>
        </c:plotArea></c:chart></c:chartSpace>"#;
        assert!(parse_chart(radar, "S", &grid).is_none());
        let noval = r#"<c:chartSpace><c:chart><c:plotArea><c:pieChart><c:ser>
          <c:cat><c:strRef><c:f>S!$A$1</c:f></c:strRef></c:cat></c:ser></c:pieChart>
        </c:plotArea></c:chart></c:chartSpace>"#;
        assert!(parse_chart(noval, "S", &grid).is_none());
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
