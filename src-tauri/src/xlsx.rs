use calamine::{open_workbook_auto, Data, Reader};
use rust_xlsxwriter::Workbook;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellPayload {
    pub r: u32,
    pub c: u32,
    #[serde(default)]
    pub v: Option<Value>,
    #[serde(default)]
    pub f: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetPayload {
    pub name: String,
    pub cells: Vec<CellPayload>,
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
    let mut sheets = Vec::new();
    for name in workbook.sheet_names().to_vec() {
        let range = match workbook.worksheet_range(&name) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let mut cells = Vec::new();
        let (r0, c0) = range.start().unwrap_or((0, 0));
        for (ri, row) in range.rows().enumerate() {
            for (ci, cell) in row.iter().enumerate() {
                if let Some(v) = data_to_value(cell) {
                    cells.push(CellPayload {
                        r: r0 + ri as u32,
                        c: c0 + ci as u32,
                        v: Some(v),
                        f: None,
                    });
                }
            }
        }
        sheets.push(SheetPayload { name, cells });
    }
    Ok(WorkbookPayload { sheets })
}

#[tauri::command]
pub fn write_xlsx(path: String, workbook: WorkbookPayload) -> Result<(), Error> {
    let mut wb = Workbook::new();
    for sheet in &workbook.sheets {
        let ws = wb.add_worksheet();
        ws.set_name(&sheet.name)
            .map_err(|e| Error(format!("工作表命名失败: {e}")))?;
        for cell in &sheet.cells {
            let row = cell.r;
            let Ok(col) = u16::try_from(cell.c) else { continue };
            if let Some(formula) = &cell.f {
                let formula = if formula.starts_with('=') {
                    formula.clone()
                } else {
                    format!("={formula}")
                };
                let _ = ws.write_formula(row, col, formula.as_str());
                continue;
            }
            match &cell.v {
                Some(Value::String(s)) => {
                    let _ = ws.write_string(row, col, s.clone());
                }
                Some(Value::Number(n)) => {
                    if let Some(f) = n.as_f64() {
                        let _ = ws.write_number(row, col, f);
                    }
                }
                Some(Value::Bool(b)) => {
                    let _ = ws.write_boolean(row, col, *b);
                }
                Some(other) => {
                    let _ = ws.write_string(row, col, other.to_string());
                }
                None => {}
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

    #[test]
    fn xlsx_roundtrip() {
        let path = std::env::temp_dir()
            .join(format!("openoffices-test-{}.xlsx", std::process::id()))
            .to_string_lossy()
            .to_string();
        let wb = WorkbookPayload {
            sheets: vec![
                SheetPayload {
                    name: "成绩".into(),
                    cells: vec![
                        CellPayload { r: 0, c: 0, v: Some(json!("姓名")), f: None },
                        CellPayload { r: 0, c: 1, v: Some(json!("分数")), f: None },
                        CellPayload { r: 1, c: 0, v: Some(json!("张三")), f: None },
                        CellPayload { r: 1, c: 1, v: Some(json!(95)), f: None },
                        CellPayload { r: 2, c: 1, v: Some(json!(88.5)), f: None },
                    ],
                },
                SheetPayload {
                    name: "备注".into(),
                    cells: vec![CellPayload { r: 5, c: 3, v: Some(json!("ok")), f: None }],
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
}
