use calamine::{open_workbook_auto, Data, Reader};
use rust_xlsxwriter::{Color, Format, Workbook};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

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

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SheetPayload {
    pub name: String,
    pub cells: Vec<CellPayload>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub merges: Vec<MergeRange>,
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
        });
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
}
