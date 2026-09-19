use calamine::{open_workbook_auto, Data, Reader};
use rust_xlsxwriter::{Color, Format, Workbook};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

use crate::xlsx_chart;
use crate::xlsx_style;

fn is_false(v: &bool) -> bool {
    !*v
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CellStyle {
    #[serde(default, skip_serializing_if = "is_false")]
    pub bl: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub it: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fs: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cl: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bg: Option<String>,
}

impl CellStyle {
    pub fn has_any(&self) -> bool {
        self.bl || self.it || self.fs.is_some() || self.cl.is_some() || self.bg.is_some()
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MergeRange {
    pub start_row: u32,
    pub start_column: u32,
    pub end_row: u32,
    pub end_column: u32,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CellPayload {
    pub r: u32,
    pub c: u32,
    #[serde(default)]
    pub v: Option<Value>,
    #[serde(default)]
    pub f: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub s: Option<CellStyle>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RangeRef {
    pub sheet: String,
    pub r1: u32,
    pub c1: u32,
    pub r2: u32,
    pub c2: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChartSeries {
    pub name: String,
    pub cat: Option<RangeRef>,
    pub val: RangeRef,
    pub cats: Vec<Value>,
    pub vals: Vec<f64>,
}

/// 图表载荷：column|bar|line|pie|doughnut|area 六类；grouping 为 standard|stacked|percentStacked
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChartPayload {
    pub chart_type: String,
    #[serde(default)]
    pub grouping: String,
    #[serde(default)]
    pub title: String,
    pub anchor_row: u32,
    pub anchor_col: u32,
    pub width: u32,
    pub height: u32,
    pub series: Vec<ChartSeries>,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SheetPayload {
    pub name: String,
    pub cells: Vec<CellPayload>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub merges: Vec<MergeRange>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub charts: Vec<ChartPayload>,
}

#[derive(Serialize, Deserialize)]
pub struct WorkbookPayload {
    pub sheets: Vec<SheetPayload>,
}

#[derive(Debug)]
pub struct Error(String);

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for Error {}

impl From<Error> for tauri::ipc::InvokeError {
    fn from(e: Error) -> Self {
        Self::from(e.0)
    }
}

fn data_to_value(d: &Data) -> Option<Value> {
    match d {
        Data::Empty => None,
        Data::String(s) => {
            if s.is_empty() {
                None
            } else {
                Some(Value::String(s.clone()))
            }
        }
        Data::Float(v) => {
            if v.fract() == 0.0 && v.abs() < i64::MAX as f64 {
                Some(Value::from(*v as i64))
            } else {
                serde_json::Number::from_f64(*v).map(Value::Number)
            }
        }
        Data::Int(v) => Some(Value::from(*v)),
        Data::Bool(v) => Some(Value::Bool(*v)),
        Data::DateTime(v) => {
            let (y, mo, d, h, mi, s, _) = v.to_ymd_hms_milli();
            if h == 0 && mi == 0 && s == 0 {
                Some(Value::String(format!("{y:04}-{mo:02}-{d:02}")))
            } else {
                Some(Value::String(format!("{y:04}-{mo:02}-{d:02} {h:02}:{mi:02}:{s:02}")))
            }
        }
        Data::DateTimeIso(s) | Data::DurationIso(s) => Some(Value::String(s.clone())),
        Data::Error(_) => Some(Value::String(d.to_string())),
    }
}

#[tauri::command]
pub fn read_xlsx(path: String) -> Result<WorkbookPayload, Error> {
    if !Path::new(&path).exists() {
        return Err(Error(format!("文件不存在: {path}")));
    }
    let mut workbook =
        open_workbook_auto(&path).map_err(|e| Error(format!("无法打开文件: {e}")))?;
    let fmts = xlsx_style::read_xlsx_styles(&path);
    let mut sheets = Vec::new();
    let mut grids: std::collections::HashMap<String, xlsx_chart::Grid> =
        std::collections::HashMap::new();
    for name in workbook.sheet_names().to_vec() {
        let range = match workbook.worksheet_range(&name) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let fmt = fmts.get(&name);
        let mut cells = Vec::new();
        let mut seen: std::collections::HashSet<(u32, u32)> = std::collections::HashSet::new();
        let (r0, c0) = range.start().unwrap_or((0, 0));
        for (ri, row) in range.rows().enumerate() {
            for (ci, cell) in row.iter().enumerate() {
                if let Some(v) = data_to_value(cell) {
                    let (r, c) = (r0 + ri as u32, c0 + ci as u32);
                    seen.insert((r, c));
                    grids.entry(name.clone()).or_default().insert((r, c), v.clone());
                    cells.push(CellPayload {
                        r,
                        c,
                        v: Some(v),
                        f: None,
                        s: fmt.and_then(|f| f.styles.get(&(r, c)).cloned()),
                    });
                }
            }
        }
        // calamine 只吐有值的格子；空但有样式的格子（如合并区底色）从样式表补回来
        if let Some(f) = fmt {
            for (&(r, c), style) in &f.styles {
                if seen.contains(&(r, c)) {
                    continue;
                }
                cells.push(CellPayload {
                    r,
                    c,
                    v: None,
                    f: None,
                    s: Some(style.clone()),
                });
            }
        }
        sheets.push(SheetPayload {
            name,
            cells,
            merges: fmt.map(|f| f.merges.clone()).unwrap_or_default(),
            charts: Vec::new(),
        });
    }
    // 图表部件单独解析：值按引用从上面已建好的网格取
    let charts = xlsx_chart::read_xlsx_charts(&path, &grids);
    for sheet in sheets.iter_mut() {
        if let Some(cs) = charts.get(&sheet.name) {
            sheet.charts = cs.clone();
        }
    }
    Ok(WorkbookPayload { sheets })
}

fn format_for(s: Option<&CellStyle>) -> Format {
    let mut f = Format::new();
    if let Some(st) = s {
        if st.bl {
            f = f.set_bold();
        }
        if st.it {
            f = f.set_italic();
        }
        if let Some(fs) = st.fs {
            f = f.set_font_size(fs);
        }
        if let Some(cl) = &st.cl {
            f = f.set_font_color(Color::from(cl.as_str()));
        }
        if let Some(bg) = &st.bg {
            f = f.set_background_color(Color::from(bg.as_str()));
        }
    }
    f
}

fn cell_text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn chart_type_for(t: &str, grouping: &str) -> Option<rust_xlsxwriter::ChartType> {
    use rust_xlsxwriter::ChartType as C;
    let stacked = grouping == "stacked";
    let percent = grouping == "percentStacked";
    Some(match (t, stacked, percent) {
        ("column", true, _) => C::ColumnStacked,
        ("column", _, true) => C::ColumnPercentStacked,
        ("column", _, _) => C::Column,
        ("bar", true, _) => C::BarStacked,
        ("bar", _, true) => C::BarPercentStacked,
        ("bar", _, _) => C::Bar,
        ("line", true, _) => C::LineStacked,
        ("line", _, true) => C::LinePercentStacked,
        ("line", _, _) => C::Line,
        ("area", true, _) => C::AreaStacked,
        ("area", _, true) => C::AreaPercentStacked,
        ("area", _, _) => C::Area,
        ("pie", _, _) => C::Pie,
        ("doughnut", _, _) => C::Doughnut,
        _ => return None,
    })
}

/// px → 图表尺寸（rust_xlsxwriter 以厘米计）
fn px_to_cm(px: u32) -> u32 {
    ((px as f64) * 2.54 / 96.0).round().max(2.0) as u32
}

#[tauri::command]
pub fn write_xlsx(path: String, workbook: WorkbookPayload) -> Result<(), Error> {
    let mut wb = Workbook::new();
    for sheet in &workbook.sheets {
        let ws = wb.add_worksheet();
        ws.set_name(&sheet.name)
            .map_err(|e| Error(format!("工作表命名失败: {e}")))?;
        // 合并区先写（含左上角值与格式），普通单元格再补齐；被合并覆盖的格子跳过
        let in_merge = |r: u32, c: u32| {
            sheet.merges.iter().any(|m| {
                r >= m.start_row && r <= m.end_row && c >= m.start_column && c <= m.end_column
            })
        };
        for m in &sheet.merges {
            let (Ok(sc), Ok(ec)) = (u16::try_from(m.start_column), u16::try_from(m.end_column))
            else {
                continue;
            };
            let top = sheet
                .cells
                .iter()
                .find(|x| x.r == m.start_row && x.c == m.start_column);
            let text = top.and_then(|x| x.v.as_ref()).map(cell_text).unwrap_or_default();
            let fmt = format_for(top.and_then(|x| x.s.as_ref()));
            let _ = ws.merge_range(m.start_row, sc, m.end_row, ec, text.as_str(), &fmt);
        }
        for cell in &sheet.cells {
            let row = cell.r;
            let Ok(col) = u16::try_from(cell.c) else { continue };
            if in_merge(row, cell.c) {
                continue;
            }
            let fmt = format_for(cell.s.as_ref());
            if let Some(formula) = &cell.f {
                let formula = if formula.starts_with('=') {
                    formula.clone()
                } else {
                    format!("={formula}")
                };
                let _ = ws.write_formula_with_format(row, col, formula.as_str(), &fmt);
                continue;
            }
            match &cell.v {
                Some(Value::String(s)) => {
                    let _ = ws.write_string_with_format(row, col, s.clone(), &fmt);
                }
                Some(Value::Number(n)) => {
                    if let Some(f) = n.as_f64() {
                        let _ = ws.write_number_with_format(row, col, f, &fmt);
                    }
                }
                Some(Value::Bool(b)) => {
                    let _ = ws.write_boolean_with_format(row, col, *b, &fmt);
                }
                Some(other) => {
                    let _ = ws.write_string_with_format(row, col, other.to_string(), &fmt);
                }
                None => {
                    if cell.s.is_some() {
                        let _ = ws.write_string_with_format(row, col, "", &fmt);
                    }
                }
            }
        }
        // 原生图表：系列引用直接映射为单元格区域公式，Excel 打开即活图
        for chart in &sheet.charts {
            let Ok(ctype) = chart_type_for(&chart.chart_type, &chart.grouping).ok_or(()) else {
                continue;
            };
            let Ok(col) = u16::try_from(chart.anchor_col) else { continue };
            let mut ch = rust_xlsxwriter::Chart::new(ctype);
            if !chart.title.is_empty() {
                ch.title().set_name(chart.title.as_str());
            }
            ch.set_width(px_to_cm(chart.width));
            ch.set_height(px_to_cm(chart.height));
            for s in &chart.series {
                let ser = ch.add_series();
                if !s.name.is_empty() {
                    ser.set_name(s.name.as_str());
                }
                let host = if s.val.sheet.is_empty() {
                    sheet.name.as_str()
                } else {
                    s.val.sheet.as_str()
                };
                let v = &s.val;
                ser.set_values((host, v.r1, v.c1 as u16, v.r2, v.c2 as u16));
                if let Some(c) = &s.cat {
                    let csheet = if c.sheet.is_empty() { host } else { c.sheet.as_str() };
                    ser.set_categories((csheet, c.r1, c.c1 as u16, c.r2, c.c2 as u16));
                }
            }
            let _ = ws.insert_chart(chart.anchor_row, col, &ch);
        }
    }
    wb.save(&path).map_err(|e| Error(format!("保存失败: {e}")))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn cell(r: u32, c: u32, v: Value) -> CellPayload {
        CellPayload {
            r,
            c,
            v: Some(v),
            ..Default::default()
        }
    }

    fn tmp_path(tag: &str) -> String {
        std::env::temp_dir()
            .join(format!("openoffices-test-{}-{}.xlsx", tag, std::process::id()))
            .to_string_lossy()
            .to_string()
    }

    #[test]
    fn xlsx_roundtrip() {
        let path = tmp_path("rt");
        let wb = WorkbookPayload {
            sheets: vec![
                SheetPayload {
                    name: "成绩".into(),
                    cells: vec![
                        cell(0, 0, json!("姓名")),
                        cell(0, 1, json!("分数")),
                        cell(1, 0, json!("张三")),
                        cell(1, 1, json!(95)),
                        cell(2, 1, json!(88.5)),
                    ],
                    ..Default::default()
                },
                SheetPayload {
                    name: "备注".into(),
                    cells: vec![cell(5, 3, json!("ok"))],
                    ..Default::default()
                },
            ],
        };
        write_xlsx(path.clone(), wb).expect("write failed");
        let back = read_xlsx(path.clone()).expect("read failed");
        std::fs::remove_file(&path).ok();

        assert_eq!(back.sheets.len(), 2);
        assert_eq!(back.sheets[0].name, "成绩");
        assert_eq!(back.sheets[1].name, "备注");
        let find = |r: u32, c: u32| {
            back.sheets[0]
                .cells
                .iter()
                .find(|x| x.r == r && x.c == c)
                .and_then(|x| x.v.clone())
        };
        assert_eq!(find(0, 0), Some(json!("姓名")));
        assert_eq!(find(1, 0), Some(json!("张三")));
        assert_eq!(find(1, 1), Some(json!(95)));
        assert_eq!(find(2, 1), Some(json!(88.5)));
        let note = back.sheets[1]
            .cells
            .iter()
            .find(|x| x.r == 5 && x.c == 3)
            .and_then(|x| x.v.clone());
        assert_eq!(note, Some(json!("ok")));
    }

    #[test]
    fn style_and_merge_roundtrip() {
        let path = tmp_path("style");
        let wb = WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "样式".into(),
                cells: vec![
                    CellPayload {
                        r: 0,
                        c: 0,
                        v: Some(json!("加粗红字")),
                        s: Some(CellStyle {
                            bl: true,
                            cl: Some("#ff0000".into()),
                            ..Default::default()
                        }),
                        ..Default::default()
                    },
                    CellPayload {
                        r: 1,
                        c: 0,
                        v: Some(json!(123)),
                        s: Some(CellStyle {
                            it: true,
                            fs: Some(14.0),
                            bg: Some("#ffff00".into()),
                            ..Default::default()
                        }),
                        ..Default::default()
                    },
                    CellPayload {
                        r: 0,
                        c: 2,
                        v: Some(json!("合并标题")),
                        s: Some(CellStyle {
                            bl: true,
                            ..Default::default()
                        }),
                        ..Default::default()
                    },
                    cell(3, 3, json!("无样式")),
                    CellPayload {
                        r: 4,
                        c: 5,
                        s: Some(CellStyle {
                            bg: Some("#00ff00".into()),
                            ..Default::default()
                        }),
                        ..Default::default()
                    },
                ],
                merges: vec![MergeRange {
                    start_row: 0,
                    start_column: 2,
                    end_row: 1,
                    end_column: 4,
                }],
                ..Default::default()
            }],
        };
        write_xlsx(path.clone(), wb).expect("write failed");
        let back = read_xlsx(path.clone()).expect("read failed");
        std::fs::remove_file(&path).ok();

        let sheet = &back.sheets[0];
        let find = |r: u32, c: u32| sheet.cells.iter().find(|x| x.r == r && x.c == c);
        let st00 = find(0, 0).and_then(|x| x.s.clone()).expect("A1 样式存在");
        assert!(st00.bl, "A1 加粗");
        assert_eq!(st00.cl.as_deref(), Some("#ff0000"), "A1 字色");
        let st10 = find(1, 0).and_then(|x| x.s.clone()).expect("A2 样式存在");
        assert!(st10.it, "A2 斜体");
        assert_eq!(st10.fs, Some(14.0), "A2 字号");
        assert_eq!(st10.bg.as_deref(), Some("#ffff00"), "A2 底色");
        assert_eq!(find(0, 2).and_then(|x| x.v.clone()), Some(json!("合并标题")));
        assert_eq!(
            sheet.merges,
            vec![MergeRange {
                start_row: 0,
                start_column: 2,
                end_row: 1,
                end_column: 4
            }],
            "合并区往返"
        );
        assert!(find(3, 3).is_some());
        assert_eq!(find(3, 3).and_then(|x| x.s.clone()), None, "无样式格 s 为空");
        let empty_styled = find(4, 5).expect("空值带底色格子应保留");
        assert_eq!(empty_styled.v, None);
        assert_eq!(
            empty_styled.s.as_ref().and_then(|x| x.bg.as_deref()),
            Some("#00ff00"),
            "F5 空格子底色"
        );
    }

    fn rf(sheet: &str, r1: u32, c1: u32, r2: u32, c2: u32) -> RangeRef {
        RangeRef {
            sheet: sheet.into(),
            r1,
            c1,
            r2,
            c2,
        }
    }

    #[test]
    fn chart_roundtrip() {
        let path = tmp_path("chart");
        let mk = |r: u32, c: u32, v: Value| CellPayload {
            r,
            c,
            v: Some(v),
            ..Default::default()
        };
        let wb = WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "图表".into(),
                cells: vec![
                    mk(0, 0, json!("月")),
                    mk(0, 1, json!("销量")),
                    mk(0, 2, json!("利润")),
                    mk(1, 0, json!("一月")),
                    mk(1, 1, json!(10)),
                    mk(1, 2, json!(1)),
                    mk(2, 0, json!("二月")),
                    mk(2, 1, json!(20)),
                    mk(2, 2, json!(2)),
                    mk(3, 0, json!("三月")),
                    mk(3, 1, json!(30)),
                    mk(3, 2, json!(3)),
                ],
                merges: vec![],
                charts: vec![
                    ChartPayload {
                        chart_type: "column".into(),
                        grouping: "standard".into(),
                        title: "季度业绩".into(),
                        anchor_row: 0,
                        anchor_col: 5,
                        width: 480,
                        height: 300,
                        series: vec![
                            ChartSeries {
                                name: "销量".into(),
                                cat: Some(rf("图表", 1, 0, 3, 0)),
                                val: rf("图表", 1, 1, 3, 1),
                                cats: vec![],
                                vals: vec![],
                            },
                            ChartSeries {
                                name: "利润".into(),
                                cat: Some(rf("图表", 1, 0, 3, 0)),
                                val: rf("图表", 1, 2, 3, 2),
                                cats: vec![],
                                vals: vec![],
                            },
                        ],
                    },
                    ChartPayload {
                        chart_type: "pie".into(),
                        grouping: "standard".into(),
                        title: "".into(),
                        anchor_row: 16,
                        anchor_col: 5,
                        width: 400,
                        height: 300,
                        series: vec![ChartSeries {
                            name: "".into(),
                            cat: Some(rf("图表", 1, 0, 3, 0)),
                            val: rf("图表", 1, 1, 3, 1),
                            cats: vec![],
                            vals: vec![],
                        }],
                    },
                ],
            }],
        };
        write_xlsx(path.clone(), wb).expect("write failed");
        let back = read_xlsx(path.clone()).expect("read failed");
        std::fs::remove_file(&path).ok();

        let charts = &back.sheets[0].charts;
        assert_eq!(charts.len(), 2, "两个图表都读回");
        let col = &charts[0];
        assert_eq!(col.chart_type, "column");
        assert_eq!(col.title, "季度业绩");
        assert_eq!((col.anchor_row, col.anchor_col), (0, 5));
        assert!(col.width >= 100 && col.height >= 60, "锚点尺寸往返: {}x{}", col.width, col.height);
        assert_eq!(col.series.len(), 2);
        assert_eq!(col.series[0].name, "销量");
        assert_eq!(col.series[0].vals, vec![10.0, 20.0, 30.0]);
        assert_eq!(col.series[0].cats[0], json!("一月"));
        assert_eq!(col.series[1].vals, vec![1.0, 2.0, 3.0]);
        assert_eq!(col.series[1].val.c1, 2, "第二系列引用 C 列");
        let pie = &charts[1];
        assert_eq!(pie.chart_type, "pie");
        assert_eq!((pie.anchor_row, pie.anchor_col), (16, 5));
        assert_eq!(pie.series[0].vals, vec![10.0, 20.0, 30.0]);
    }

    // CDP 冒烟夹具：手动 `cargo test gen_smoke_fixture -- --ignored` 生成带图表 xlsx
    #[test]
    #[ignore]
    fn gen_smoke_fixture() {
        let path = std::env::var("OO_FIXTURE_PATH").unwrap_or_else(|_| {
            concat!(env!("CARGO_MANIFEST_DIR"), "/../tmp/fixture-chart.xlsx").to_string()
        });
        let mk = |r: u32, c: u32, v: Value| CellPayload {
            r,
            c,
            v: Some(v),
            ..Default::default()
        };
        let wb = WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "销售".into(),
                cells: vec![
                    mk(0, 0, json!("月")),
                    mk(0, 1, json!("销量")),
                    mk(0, 2, json!("利润")),
                    mk(1, 0, json!("一月")),
                    mk(1, 1, json!(10)),
                    mk(1, 2, json!(3)),
                    mk(2, 0, json!("二月")),
                    mk(2, 1, json!(20)),
                    mk(2, 2, json!(7)),
                    mk(3, 0, json!("三月")),
                    mk(3, 1, json!(35)),
                    mk(3, 2, json!(12)),
                    mk(4, 0, json!("四月")),
                    mk(4, 1, json!(28)),
                    mk(4, 2, json!(9)),
                ],
                merges: vec![],
                charts: vec![
                    ChartPayload {
                        chart_type: "column".into(),
                        grouping: "standard".into(),
                        title: "季度业绩".into(),
                        anchor_row: 0,
                        anchor_col: 5,
                        width: 480,
                        height: 300,
                        series: vec![
                            ChartSeries {
                                name: "销量".into(),
                                cat: Some(rf("销售", 1, 0, 4, 0)),
                                val: rf("销售", 1, 1, 4, 1),
                                cats: vec![],
                                vals: vec![],
                            },
                            ChartSeries {
                                name: "利润".into(),
                                cat: Some(rf("销售", 1, 0, 4, 0)),
                                val: rf("销售", 1, 2, 4, 2),
                                cats: vec![],
                                vals: vec![],
                            },
                        ],
                    },
                    ChartPayload {
                        chart_type: "pie".into(),
                        grouping: "standard".into(),
                        title: "".into(),
                        anchor_row: 8,
                        anchor_col: 5,
                        width: 400,
                        height: 300,
                        series: vec![ChartSeries {
                            name: "".into(),
                            cat: Some(rf("销售", 1, 0, 4, 0)),
                            val: rf("销售", 1, 1, 4, 1),
                            cats: vec![],
                            vals: vec![],
                        }],
                    },
                ],
            }],
        };
        write_xlsx(path.clone(), wb).expect("写夹具失败");
        println!("fixture written: {path}");
    }
}
