//! CSV 读写：Univer 工作簿载荷 ⇄ 纯文本表格
//!
//! calamine 不支持 csv，所以读侧在 `read_xlsx` 里按扩展名分流到本模块，
//! 数值/日期一律以文本进格（CSV 没有类型信息），写侧只导出第一个工作表。
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::Path;

use serde_json::Value;

use crate::xlsx::{CellPayload, Error, SheetPayload, WorkbookPayload};

/// Excel 按逗号切分时会吃掉字段首尾空白，因此带空白的字段必须加引号保住
fn needs_quote(s: &str) -> bool {
    s.contains([',', '"', '\n', '\r']) || s.starts_with(' ') || s.ends_with(' ')
}

fn quote(s: &str) -> String {
    if needs_quote(s) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

/// 单元格显示值：数字去掉 JSON 的多余小数（1 → "1"，不是 "1.0"），布尔转大写
pub fn value_to_text(v: &Value) -> String {
    match v {
        Value::Null => String::new(),
        Value::Bool(b) => b.to_string().to_uppercase(),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                i.to_string()
            } else if let Some(f) = n.as_f64() {
                if f.fract() == 0.0 && f.abs() < 9.0e15 {
                    format!("{f:.0}")
                } else {
                    n.to_string()
                }
            } else {
                n.to_string()
            }
        }
        Value::String(s) => s.clone(),
        Value::Array(_) | Value::Object(_) => v.to_string(),
    }
}

/// 载荷 → CSV 文本（CRLF 行尾）
pub fn to_csv(workbook: &WorkbookPayload) -> String {
    let Some(sheet) = workbook.sheets.first() else {
        return String::new();
    };
    // 稀疏格子先落索引表：逐格在 Vec 里线性找会让大表写成 O(行×列×格子数)
    let mut index: HashMap<(u32, u32), &CellPayload> = HashMap::new();
    let mut max_r = 0u32;
    let mut max_c = 0u32;
    for cell in &sheet.cells {
        index.insert((cell.r, cell.c), cell);
        max_r = max_r.max(cell.r);
        max_c = max_c.max(cell.c);
    }
    let mut out = String::new();
    for r in 0..=max_r {
        let mut line = Vec::with_capacity(max_c as usize + 1);
        for c in 0..=max_c {
            let text = index
                .get(&(r, c))
                .and_then(|cell| cell.v.as_ref())
                .map(value_to_text)
                .unwrap_or_default();
            line.push(quote(&text));
        }
        out.push_str(&line.join(","));
        out.push_str("\r\n");
    }
    out
}

/// CSV 文本 → 单表载荷。RFC4180 语义：双引号包裹、"" 转义、字段内可含换行。
/// 分隔符在 , ; 制表符 三者里按首行出现次数嗅探（欧洲导出常用分号）。
pub fn parse_csv(text: &str, sheet_name: &str) -> WorkbookPayload {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let delim = sniff_delimiter(text);
    let rows = split_rows(text, delim);

    let mut cells = Vec::new();
    let mut max_c = 0usize;
    for (r, row) in rows.iter().enumerate() {
        max_c = max_c.max(row.len());
        for (c, field) in row.iter().enumerate() {
            if field.is_empty() {
                continue;
            }
            cells.push(CellPayload {
                r: r as u32,
                c: c as u32,
                v: Some(Value::String(field.clone())),
                f: None,
                s: None,
            });
        }
    }
    WorkbookPayload {
        sheets: vec![SheetPayload {
            name: sheet_name.to_string(),
            cells,
            ..Default::default()
        }],
    }
}

fn sniff_delimiter(text: &str) -> char {
    let first = text.lines().find(|l| !l.trim().is_empty()).unwrap_or("");
    let mut best = ',';
    let mut best_n = 0;
    for d in [',', ';', '\t'] {
        let n = first.matches(d).count();
        if n > best_n {
            best = d;
            best_n = n;
        }
    }
    best
}

/// 逐字符状态机：引号内的分隔符与换行都属于字段内容
fn split_rows(text: &str, delim: char) -> Vec<Vec<String>> {
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut row: Vec<String> = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if quoted {
            if ch == '"' {
                if chars.peek() == Some(&'"') {
                    field.push('"');
                    chars.next();
                } else {
                    quoted = false;
                }
            } else {
                field.push(ch);
            }
            continue;
        }
        match ch {
            '"' => quoted = true,
            c if c == delim => {
                row.push(std::mem::take(&mut field));
            }
            '\r' => {
                if chars.peek() == Some(&'\n') {
                    chars.next();
                }
                row.push(std::mem::take(&mut field));
                rows.push(std::mem::take(&mut row));
            }
            '\n' => {
                row.push(std::mem::take(&mut field));
                rows.push(std::mem::take(&mut row));
            }
            c => field.push(c),
        }
    }
    if !field.is_empty() || !row.is_empty() || quoted {
        row.push(field);
        rows.push(row);
    }
    // 末尾换行会多出一个空行，去掉它才不把整表撑高一格
    while matches!(rows.last(), Some(r) if r.len() == 1 && r[0].is_empty()) {
        rows.pop();
    }
    rows
}

fn stem(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Sheet1")
        .to_string()
}

/// 供 `read_xlsx` 分流调用：读文件（UTF-8 失败退 GBK）并解析为载荷
pub fn read_payload(path: &str) -> Result<WorkbookPayload, Error> {
    let p = Path::new(path);
    let bytes = fs::read(p).map_err(|e| Error(format!("无法读取 {path}: {e}")))?;
    let text = decode_text(&bytes);
    Ok(parse_csv(&text, &stem(p)))
}

/// 中文 Excel 另存的 CSV 常是 GBK，直接按 UTF-8 解码会整表乱码
fn decode_text(bytes: &[u8]) -> String {
    if let Ok(s) = std::str::from_utf8(bytes) {
        return s.to_string();
    }
    encoding_rs::GBK.decode(bytes).0.into_owned()
}

#[tauri::command]
pub async fn write_csv(path: String, workbook: WorkbookPayload) -> Result<(), Error> {
    crate::xlsx::to_blocking(move || write_csv_sync(path, workbook)).await
}

fn write_csv_sync(path: String, workbook: WorkbookPayload) -> Result<(), Error> {
    let text = to_csv(&workbook);
    let mut file = fs::File::create(&path).map_err(|e| Error(format!("无法写入 {path}: {e}")))?;
    // BOM：没有它 Excel 会把 UTF-8 中文按 GBK 猜，整表乱码
    file.write_all(b"\xEF\xBB\xBF")
        .map_err(|e| Error(format!("写入失败: {e}")))?;
    file.write_all(text.as_bytes())
        .map_err(|e| Error(format!("写入失败: {e}")))?;
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
            f: None,
            s: None,
        }
    }

    #[test]
    fn parses_quoted_fields_with_delimiters_and_newlines() {
        let wb = parse_csv("名称,备注\n\"含,逗号\",\"两\n行\"\n普通,短\n", "S");
        let s = &wb.sheets[0];
        let at = |r: u32, c: u32| {
            s.cells
                .iter()
                .find(|x| x.r == r && x.c == c)
                .and_then(|x| x.v.as_ref())
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string()
        };
        assert_eq!(at(1, 0), "含,逗号");
        assert_eq!(at(1, 1), "两\n行");
        assert_eq!(at(2, 1), "短");
        assert_eq!(s.name, "S");
    }

    #[test]
    fn strips_bom_and_sniffs_semicolon() {
        let wb = parse_csv("\u{feff}a;b;c\n1;2;3\n", "S");
        let s = &wb.sheets[0];
        assert_eq!(s.cells.iter().filter(|c| c.r == 1).count(), 3);
        assert_eq!(
            s.cells
                .iter()
                .find(|c| c.r == 0 && c.c == 0)
                .and_then(|c| c.v.as_ref())
                .and_then(|v| v.as_str()),
            Some("a")
        );
    }

    #[test]
    fn writes_number_like_text_verbatim() {
        // 007 原样保留，100 作为数字写出也不掉小数点
        let wb = WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "S".into(),
                cells: vec![
                    cell(0, 0, json!("007")),
                    cell(0, 1, json!(100)),
                    cell(1, 0, json!("a,b")),
                    cell(1, 1, json!(1.5)),
                ],
                ..Default::default()
            }],
        };
        assert_eq!(to_csv(&wb), "007,100\r\n\"a,b\",1.5\r\n");
    }

    #[test]
    fn round_trips_through_parser() {
        let wb = WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "S".into(),
                cells: vec![
                    cell(0, 0, json!("季度")),
                    cell(0, 1, json!(2026)),
                    cell(1, 0, json!("带\"引号\"和\n换行")),
                    cell(1, 1, json!(" 前后空格 ")),
                ],
                ..Default::default()
            }],
        };
        let back = parse_csv(&to_csv(&wb), "S");
        let got: Vec<String> = back.sheets[0]
            .cells
            .iter()
            .map(|c| value_to_text(c.v.as_ref().unwrap()))
            .collect();
        assert_eq!(got, vec!["季度", "2026", "带\"引号\"和\n换行", " 前后空格 "]);
    }

    #[test]
    fn decodes_gbk_bytes() {
        let (gbk, _, _) = encoding_rs::GBK.encode("销售额,合计");
        let wb = parse_csv(&decode_text(&gbk), "S");
        assert_eq!(wb.sheets[0].cells.len(), 2);
    }

    #[test]
    fn empty_payload_writes_empty_text() {
        assert_eq!(to_csv(&WorkbookPayload { sheets: vec![] }), "");
        let wb = parse_csv("", "S");
        assert!(wb.sheets[0].cells.is_empty());
    }
}
