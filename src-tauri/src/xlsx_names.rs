//! 定义名称（workbook 级 `definedNames`）读出与写回（v0.103）。
//!
//! v0.98 挂账的「定义名称（print 两条之外的）」：用户在 Excel 的名字管理器里给区域或
//! 公式起的名字（如 `税率 = Sheet1!$A$1`），正文公式引用它——写回时名字不在，公式全部
//! 断链成 `#NAME?`。print 的两条（`_xlnm.Print_Area`/`_xlnm.Print_Titles`）由
//! xlsx_print.rs 那条通道管，这里跳过；其余 `_xlnm.*` 是 Excel 的系统影子名
//! （`_FilterDatabase` 等），搬它可能与筛选通道重复，同样跳过——只搬用户名字。
//!
//! Univer 的模型装不下这一层（与打印设置、默认字体同款侧通道）：读侧收进载荷、
//! 前端原样带回、写侧在 workbook.xml 上定点补写。`localSheetId` 是「工作表声明序」的
//! 下标——读侧翻成表名存载荷，写侧按当前表序重算回来；作用域表被删了那条名字就丢，
//! 记账不说谎。crate 的 `define_name` 只认 workbook 级且有自己的名字校验，所以写侧
//! 不走 crate，直接对 workbook.xml 定点插入（crate 写的 print 条目原样活着）。

use quick_xml::events::Event;
use quick_xml::Reader;
use serde::{Deserialize, Serialize};

use crate::xlsx_style::{attr_str, read_entry, sheet_paths};

/// 一条定义名称。`value` 是元素文本原文（区域 `Sheet1!$A$1:$B$2`、公式 `SUM(Sheet1!$A$1)`
/// 或常量 `3.14`——名字管理器里能写什么这里就是什么），原样搬回不做语法改写。
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DefinedName {
    pub name: String,
    pub value: String,
    /// 工作表作用域的名字带表名；workbook 级的没有
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sheet: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub hidden: bool,
    /// 名字管理器里的备注（`comment` 属性）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

/// 读侧产物：名字清单 + 边界账（localSheetId 指到不存在的表这类）
#[derive(Default)]
pub struct NamesRead {
    pub names: Vec<DefinedName>,
    pub accounts: Vec<String>,
}

/// 一趟 zip 收 workbook.xml 里的用户名字。calamine 不公开这一层（与打印设置同款处境），
/// 直接解 `xl/workbook.xml`；表名序从 `sheet_paths` 拿（localSheetId 就是声明序下标）。
pub fn read_defined_names(path: &str) -> NamesRead {
    let mut out = NamesRead::default();
    let Ok(file) = std::fs::File::open(path) else {
        return out;
    };
    let Ok(mut zip) = zip::ZipArchive::new(std::io::BufReader::new(file)) else {
        return out;
    };
    let names: Vec<String> = sheet_paths(&mut zip).into_iter().map(|(n, _)| n).collect();
    let Some(wb) = read_entry(&mut zip, "xl/workbook.xml") else {
        return out;
    };
    parse_workbook_names(&wb, &names, &mut out);
    out
}

fn parse_workbook_names(xml: &str, sheet_names: &[String], out: &mut NamesRead) {
    let mut reader = Reader::from_str(xml);
    let mut cur: Option<DefinedName> = None;
    let mut cur_idx: Option<usize> = None;
    let mut buf = String::new();
    loop {
        match reader.read_event() {
            // 自闭合 `<definedName .../>`：值就是空串，当场收掉（Start 分支才等 End）
            Ok(Event::Empty(e)) if e.local_name().as_ref() == "definedName" => {
                if let Some(d) = defined_name_of(&e) {
                    let idx = attr_str(&e, "localSheetId").and_then(|v| v.trim().parse::<usize>().ok());
                    push_name(out, d, idx, sheet_names);
                }
            }
            Ok(Event::Start(e)) if e.local_name().as_ref() == "definedName" => {
                if let Some(d) = defined_name_of(&e) {
                    cur_idx = attr_str(&e, "localSheetId").and_then(|v| v.trim().parse::<usize>().ok());
                    buf.clear();
                    cur = Some(d);
                } else {
                    cur = None;
                }
            }
            Ok(Event::Text(t)) => {
                if cur.is_some() {
                    buf.push_str(t.as_ref());
                }
            }
            Ok(Event::GeneralRef(r)) => {
                if cur.is_some() {
                    push_entity(&mut buf, r.as_ref());
                }
            }
            Ok(Event::End(e)) if e.local_name().as_ref() == "definedName" => {
                if let Some(mut d) = cur.take() {
                    d.value = unesc(&std::mem::take(&mut buf));
                    push_name(out, d, cur_idx.take(), sheet_names);
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
}

/// Start/Empty 两臂共用的条目头解析；系统名（`_xlnm.*`）在这里就挡掉——print 两条归
/// 打印通道，其余影子名搬了可能与筛选通道重复
fn defined_name_of(e: &quick_xml::events::BytesStart<'_>) -> Option<DefinedName> {
    let name = attr_str(e, "name").unwrap_or_default();
    if name.is_empty() || name.starts_with("_xlnm.") {
        return None;
    }
    let hidden = attr_str(e, "hidden")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    let comment = attr_str(e, "comment").filter(|s| !s.is_empty());
    Some(DefinedName { name, value: String::new(), sheet: None, hidden, comment })
}

fn push_name(out: &mut NamesRead, mut d: DefinedName, idx: Option<usize>, sheet_names: &[String]) {
    if let Some(i) = idx {
        match sheet_names.get(i) {
            Some(nm) => d.sheet = Some(nm.clone()),
            None => {
                out.accounts
                    .push(format!("定义名称「{}」指向第 {} 张表，这份文件没这张表，没收", d.name, i + 1));
                return;
            }
        }
    }
    out.names.push(d);
}

/// 在 crate 产物上补写用户名字。位置按 schema：`<definedNames>` 在 `<sheets>` 之后、
/// `<calcPr>` 之前——crate 已写 print 两条时块已存在，条目插到块尾；没有块就在
/// `<calcPr>` 前起一块；再没有才退到 `</sheets>` 后。
pub fn patch_workbook_part(xml: &str, names: &[DefinedName], sheet_order: &[String]) -> (String, Vec<String>) {
    let mut notes = Vec::new();
    let mut entries = String::new();
    for d in names {
        match entry_xml(d, sheet_order) {
            Ok(one) => entries.push_str(&one),
            Err(why) => notes.push(why),
        }
    }
    if entries.is_empty() {
        return (xml.to_string(), notes);
    }
    if let Some(i) = xml.find("</definedNames>") {
        return (format!("{}{}{}", &xml[..i], entries, &xml[i..]), notes);
    }
    let block = format!("<definedNames>{entries}</definedNames>");
    if let Some(i) = xml.find("<calcPr") {
        return (format!("{}{}{}", &xml[..i], block, &xml[i..]), notes);
    }
    if let Some(i) = xml.find("</sheets>") {
        let j = i + "</sheets>".len();
        return (format!("{}{}{}", &xml[..j], block, &xml[j..]), notes);
    }
    notes.push("定义名称没写出去：产物里找不到 workbook.xml 的插入点".to_string());
    (xml.to_string(), notes)
}

fn entry_xml(d: &DefinedName, order: &[String]) -> Result<String, String> {
    let mut attrs = format!(" name=\"{}\"", esc(&d.name));
    if let Some(sheet) = &d.sheet {
        match order.iter().position(|x| x == sheet) {
            Some(idx) => attrs.push_str(&format!(" localSheetId=\"{idx}\"")),
            None => {
                return Err(format!(
                    "定义名称「{}」没写出去：它的作用域表「{sheet}」已经不在",
                    d.name
                ));
            }
        }
    }
    if d.hidden {
        attrs.push_str(" hidden=\"1\"");
    }
    if let Some(c) = &d.comment {
        attrs.push_str(&format!(" comment=\"{}\"", esc(c)));
    }
    Ok(format!("<definedName{}>{}</definedName>", attrs, esc(&d.value)))
}

fn esc(s: &str) -> String {
    // 只喂文本内容（definedName 的值是公式文本），`"` 在文本节点里合法原样保留——
    // 与 Excel 产出一致（它也只在属性值里转义引号）
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn push_entity(buf: &mut String, raw: &str) {
    match raw {
        "lt" => buf.push('<'),
        "gt" => buf.push('>'),
        "amp" => buf.push('&'),
        "quot" => buf.push('"'),
        "apos" => buf.push('\''),
        "x20" | "#x20" | "#32" => buf.push(' '),
        // 十六进制数字引用 `&#x...;`（_xlnm.Print_Area 的隐藏字符是这么藏的）
        other => {
            if let Some(hex) = other.strip_prefix("#x").or_else(|| other.strip_prefix("#X")) {
                if let Ok(n) = u32::from_str_radix(hex, 16) {
                    if let Some(ch) = char::from_u32(n) {
                        buf.push(ch);
                        return;
                    }
                }
            }
            if let Some(dec) = other.strip_prefix('#') {
                if let Ok(n) = dec.parse::<u32>() {
                    if let Some(ch) = char::from_u32(n) {
                        buf.push(ch);
                    }
                }
            }
        }
    }
}

fn unesc(s: &str) -> String {
    // 值里只会出现预定义实体（Excel 产出的），逐个替换；没有 `&` 时零拷贝直还
    if !s.contains('&') {
        return s.to_string();
    }
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sheets() -> Vec<String> {
        vec!["Sheet1".into(), "数据".into(), "参数".into()]
    }

    #[test]
    fn parses_user_names_and_skips_system_ones() {
        let xml = r#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheets><sheet name="Sheet1"/><sheet name="数据"/><sheet name="参数"/></sheets>
<definedNames>
<definedName name="税率">参数!$A$1</definedName>
<definedName name="_xlnm.Print_Area" localSheetId="0">Sheet1!$A$1:$E$18</definedName>
<definedName name="_xlnm.Print_Titles" localSheetId="0">Sheet1!$1:$2</definedName>
<definedName name="隐藏名" hidden="1" comment="备注文字" localSheetId="2">数据!$B$2</definedName>
<definedName name="和值">SUM(Sheet1!$B$2:$B$9)</definedName>
</definedNames>
<calcPr calcId="191029"/></workbook>"#;
        let mut out = NamesRead::default();
        parse_workbook_names(xml, &sheets(), &mut out);
        // print 两条与 _xlnm.* 全跳过，用户名字三枚
        assert_eq!(out.names.len(), 3, "只收用户名字（实际 {}）", out.names.len());
        let tax = out.names.iter().find(|d| d.name == "税率").unwrap();
        assert_eq!(tax.value, "参数!$A$1");
        assert_eq!(tax.sheet, None, "workbook 级不带表名");
        let hid = out.names.iter().find(|d| d.name == "隐藏名").unwrap();
        assert!(hid.hidden);
        assert_eq!(hid.comment.as_deref(), Some("备注文字"));
        assert_eq!(hid.sheet.as_deref(), Some("参数"), "localSheetId=2 → 表名「参数」");
        let sum = out.names.iter().find(|d| d.name == "和值").unwrap();
        assert_eq!(sum.value, "SUM(Sheet1!$B$2:$B$9)");
        assert!(out.accounts.is_empty());
    }

    #[test]
    fn bad_local_sheet_id_is_dropped_with_note() {
        let xml = r#"<workbook><definedNames>
<definedName name="坏名字" localSheetId="9">Sheet1!$A$1</definedName>
<definedName name="好名字">Sheet1!$B$2</definedName>
</definedNames></workbook>"#;
        let mut out = NamesRead::default();
        parse_workbook_names(xml, &sheets(), &mut out);
        assert_eq!(out.names.len(), 1);
        assert_eq!(out.names[0].name, "好名字");
        assert_eq!(out.accounts.len(), 1, "越界的 localSheetId 记账不硬收");
    }

    #[test]
    fn entity_in_value_is_resolved() {
        let xml = r#"<workbook><definedNames>
<definedName name="带和号">Sheet1!$A$1&lt;&amp;"文本"</definedName>
</definedNames></workbook>"#;
        let mut out = NamesRead::default();
        parse_workbook_names(xml, &sheets(), &mut out);
        assert_eq!(out.names[0].value, "Sheet1!$A$1<&\"文本\"");
    }

    #[test]
    fn patch_inserts_into_existing_block_and_recomputes_local_sheet_id() {
        // crate 已写了 print 两条：我们的条目插到块尾，crate 的活着
        let xml = r#"<workbook><sheets><sheet name="参数"/><sheet name="数据"/></sheets>
<definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">参数!$A$1:$C$9</definedName></definedNames>
<calcPr calcId="191029"/></workbook>"#;
        let names = vec![
            DefinedName { name: "税率".into(), value: "参数!$A$1".into(), sheet: Some("参数".into()), ..Default::default() },
            DefinedName { name: "全局".into(), value: "3.14".into(), ..Default::default() },
        ];
        let order = vec!["参数".to_string(), "数据".to_string()];
        let (out, notes) = patch_workbook_part(xml, &names, &order);
        assert!(notes.is_empty());
        let block = out.split("<definedNames>").nth(1).unwrap().split("</definedNames>").next().unwrap();
        assert!(block.contains("_xlnm.Print_Area"), "crate 写的 print 条目活着");
        assert!(block.contains(r#"<definedName name="税率" localSheetId="0">参数!$A$1</definedName>"#), "表序重算（参数=0）");
        assert!(block.contains(r#"<definedName name="全局">3.14</definedName>"#), "workbook 级不带 localSheetId");
    }

    #[test]
    fn patch_creates_block_before_calc_pr_when_missing() {
        let xml = r#"<workbook><sheets><sheet name="数据"/></sheets><calcPr calcId="1"/></workbook>"#;
        let names = vec![DefinedName { name: "区间".into(), value: "数据!$A$1:$B$2".into(), sheet: Some("数据".into()), hidden: true, comment: None }];
        let (out, notes) = patch_workbook_part(xml, &names, &["数据".to_string()]);
        assert!(notes.is_empty());
        let (head, tail) = out.split_once("<definedNames>").unwrap();
        assert!(head.contains("</sheets>"), "块起在 sheets 之后");
        assert!(tail.contains("<calcPr"), "块落在 calcPr 之前");
        assert!(tail.contains(r#"hidden="1""#));
    }

    #[test]
    fn scoped_name_on_deleted_sheet_is_dropped_with_note() {
        let xml = r#"<workbook><calcPr calcId="1"/></workbook>"#;
        let names = vec![DefinedName { name: "没了".into(), value: "已删!$A$1".into(), sheet: Some("已删".into()), ..Default::default() }];
        let (out, notes) = patch_workbook_part(xml, &names, &["数据".to_string()]);
        assert_eq!(notes.len(), 1, "作用域表不在的名字丢并记账");
        assert!(!out.contains("没了"));
    }

    #[test]
    fn value_entities_are_escaped_back() {
        let xml = r#"<workbook><calcPr calcId="1"/></workbook>"#;
        let names = vec![DefinedName { name: "带和号".into(), value: "Sheet1!$A$1<&\"文本\"".into(), ..Default::default() }];
        let (out, _) = patch_workbook_part(xml, &names, &[]);
        assert!(out.contains(r#"<definedName name="带和号">Sheet1!$A$1&lt;&amp;"文本"</definedName>"#));
    }

    /// 全环路：crate 造一枚带名字的原件 → 读侧收 → save_workbook_bytes 写新簿 →
    /// 产物 zip 里名字和公式都活着（断链修复的直接证据）
    #[test]
    fn full_loop_name_survives_write_back() {
        let dir = std::env::temp_dir().join(format!("oo-names-leg-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let orig = dir.join("orig.xlsx");
        {
            use rust_xlsxwriter::Workbook;
            let mut wb = Workbook::new();
            wb.add_worksheet().set_name("参数").unwrap().write(0, 0, 0.13).unwrap();
            wb.define_name("税率", "=参数!$A$1").unwrap();
            wb.save(&orig).unwrap();
        }
        let read = read_defined_names(orig.to_str().unwrap());
        assert_eq!(read.names.len(), 1, "原件里那枚名字要收得到");
        assert_eq!(read.names[0].name, "税率");

        let mut wb2 = rust_xlsxwriter::Workbook::new();
        wb2.add_worksheet().set_name("参数").unwrap();
        let (bytes, notes) = crate::xlsx_cell_side::save_workbook_bytes(
            &mut wb2,
            &[],
            &[],
            read.names.as_slice(),
            &["参数".to_string()],
        )
        .unwrap();
        assert!(notes.is_empty(), "全环路不该有账：{notes:?}");

        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(&bytes)).unwrap();
        let wbxml = read_entry(&mut zip, "xl/workbook.xml").expect("产物里有 workbook.xml");
        assert!(wbxml.contains("name=\"税率\""), "名字写进了产物：{wbxml}");
        assert!(wbxml.contains("参数!$A$1"), "公式引用原样保留：{wbxml}");

        let _ = std::fs::remove_file(&orig);
        let _ = std::fs::remove_dir(&dir);
    }
}
