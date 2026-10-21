//! ODS 条件格式的读与写（v0.128）
//!
//! ODF 把条件格式放在 content.xml 的 `<office:automatic-styles>` 里，形状是：
//! ```xml
//! <table:conditional-format table:target-range-address="数据.A1:数据.B2">
//!   <table:condition table:apply-style-name="ce1" table:test="[.B2]&gt;5"/>
//! </table:conditional-format>
//! ```
//!
//! 与 OOXML 那头的三处不同，决定了这一层只能这么写：
//!
//! 1. **区域是一串地址**（`table:target-range-address` 允许空格分隔的多段），
//!    正好和 OOXML 的 `conditionalFormatting@sqref` 同形，所以直接落成 `Vec<RangeRect>`。
//!    地址带表名前缀（`数据.A1:数据.B2`），前缀要剥——工作表归属由外层容器决定，
//!    带进去只会让后面每一处比较都多一层。
//!
//! 2. **判定只有 `table:test` 一条表达式**，没有 OOXML 那套 type/operator/formula1 家族。
//!    所以读出来一律是 `kind=cell` / `sub=formula`，表达式**原样**留在 `v1`。
//!    为什么不翻译成 xlsx 语法：`[.B2]` 是「相对区域左上角偏移 B2」，与 xlsx 的
//!    「相对公式」不是一回事——`[.B2]` 在 A1 起始的区域里指的是 B2，换到 C3 起始就指 D4。
//!    凭一条表达式翻不过去，硬翻会在写 xlsx 时造出一根指向错格的公式。
//!    原样留住，ODS→ODS 是精确往返；ODS→xlsx 那条路由写侧自己记账说「没写」。
//!
//! 3. **样式走名字而不是下标**：`table:apply-style-name` 指向 automatic-styles 里的一枚
//!    `<style:style>`，不像 OOXML 用 `cfRule@dxfId` 取 dxfs 数组。
//!    所以必须先有「名字 → CellStyle」那张表才认得出样式，认不出就 `fmt=None`——
//!    条件格式的判定还在，只是不带上色。

use quick_xml::events::Event;
use quick_xml::Reader;
use std::collections::HashMap;

use serde_json::Value;

use crate::xlsx::{CellStyle, CondFormatPayload, CondFormatStyle, RangeRect, SheetPayload};
use crate::xlsx_style::attr_str;

/// 一段 `数据.A1:数据.B2` → 矩形。表名前缀剥掉；认不出返回 None（不记账，区域这一档太碎）
fn odf_rect(seg: &str) -> Option<RangeRect> {
    let s = seg.trim();
    if s.is_empty() {
        return None;
    }
    let (a, b) = match s.split_once(':') {
        Some((x, y)) => (x, y),
        // 单格：ODF 允许只写一个格子当区域
        None => (s, s),
    };
    let (c0, r0) = odf_cell(a)?;
    let (c1, r1) = odf_cell(b)?;
    Some(RangeRect {
        start_row: r0.min(r1),
        start_column: c0.min(c1),
        end_row: r0.max(r1),
        end_column: c0.max(c1),
    })
}

/// `数据.A1` / `A1` / `$数据.$A$1` → (列号, 行号)，都是 0 基
fn odf_cell(s: &str) -> Option<(u32, u32)> {
    let s = s.trim();
    // 剥表名前缀：只剥最后一个 '.' 之前的那一段，且那一段不能是列字母本身。
    // ODF 的地址里表名可被引号包住（`数据 2.A1` 会写成 `'数据 2'.A1`），这里一并处理
    let body = strip_sheet(s);
    let mut col = 0u32;
    let mut idx = 0usize;
    let bytes = body.as_bytes();
    while idx < bytes.len() {
        let c = bytes[idx];
        if c == b'$' {
            idx += 1;
            continue;
        }
        if c.is_ascii_alphabetic() {
            col = col * 26 + ((c.to_ascii_uppercase() - b'A') as u32 + 1);
            idx += 1;
            continue;
        }
        break;
    }
    if idx == 0 || col == 0 {
        return None;
    }
    let mut row = 0u32;
    let mut digits = 0usize;
    while idx < bytes.len() {
        let c = bytes[idx];
        if c == b'$' {
            idx += 1;
            continue;
        }
        if c.is_ascii_digit() {
            row = row * 10 + (c - b'0') as u32;
            digits += 1;
            idx += 1;
            continue;
        }
        break;
    }
    if digits == 0 {
        return None;
    }
    // 行号是 1 基，落回 0 基
    Some((col - 1, row.saturating_sub(1)))
}

/// 剥 `表名.` 前缀。策略：从右往左找 '.'，且 '.' 右侧必须以列字母开头——
/// 否则像是 `A1.5` 这种小数被当表名切了（ODF 地址里不会出现，但读别人的件不能假设）
fn strip_sheet(s: &str) -> &str {
    let bytes = s.as_bytes();
    let mut i = bytes.len();
    // 引号里的 '.' 不算分隔符
    let mut in_q = false;
    while i > 0 {
        i -= 1;
        let c = bytes[i];
        if c == b'\'' {
            in_q = !in_q;
            continue;
        }
        if c == b'.' && !in_q {
            let rest = &s[i + 1..];
            let ok = rest
                .trim_start_matches('$')
                .chars()
                .next()
                .map(|ch| ch.is_ascii_alphabetic())
                .unwrap_or(false);
            if ok {
                return rest;
            }
        }
    }
    s
}

/// CellStyle → 条件格式用的那枚样式。只搬条件格式这一族认的字段（底色/字色/粗斜下删/
/// 数字格式）；**边框与对齐在 OOXML 的 dxf 里还有，这一层仍不开口**——开了就得连
/// xlsx 写侧与 Univer 高亮一起改，而屏上那六枚 set* 里没有它们。先落能落的
fn cf_style_of(st: &CellStyle) -> Option<CondFormatStyle> {
    let s = CondFormatStyle {
        bg: st.bg.clone(),
        cl: st.cl.clone(),
        bl: st.bl.then_some(true),
        it: st.it.then_some(true),
        ul: None,
        st: None,
        nf: st.nf.clone(),
    };
    let any = s.bg.is_some()
        || s.cl.is_some()
        || s.bl.is_some()
        || s.it.is_some()
        || s.nf.is_some();
    any.then_some(s)
}

/// 读一串 `<table:conditional-format>`。
/// `auto` 是 content.xml automatic-styles 里「名字 → CellStyle」的表（读侧主流程已经建好）。
///
/// 交回 `(目标表名, 载荷)`：条件格式住在 automatic-styles 里，跟哪张表没有结构上的从属关系，
/// 全靠 `table:target-sheet` 那一个属性说。属性缺了或写着 `.`（ODF 的「当前表」）就交回空串，
/// 由装配侧按表名数量决定落到哪（单一表就归它，多表则归首表并记账）。
pub fn read_ods_cond_formats(
    content: &str,
    auto: &HashMap<String, CellStyle>,
) -> Vec<(String, CondFormatPayload)> {
    let mut out: Vec<(String, CondFormatPayload)> = Vec::new();
    let mut reader = Reader::from_str(content);
    let mut buf: Vec<u8> = Vec::new();
    let mut in_cf = false;
    let mut ranges: Vec<RangeRect> = Vec::new();
    let mut target: String = String::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                let nm = e.local_name();
                let nm = nm.as_ref();
                if nm == "conditional-format" {
                    in_cf = true;
                    ranges.clear();
                    let ts = attr_str(&e, "target-sheet").unwrap_or_default();
                    // "." 是 ODF 的「当前表」，等于没说
                    target = if ts == "." { String::new() } else { ts };
                    let addr = attr_str(&e, "target-range-address").unwrap_or_default();
                    // 多段是空格分隔；也见过逗号分隔的写法，一并认
                    for seg in addr.split(|c: char| c == ' ' || c == ',') {
                        if let Some(r) = odf_rect(seg) {
                            ranges.push(r);
                        }
                    }
                } else if nm == "condition" && in_cf {
                    let test = attr_str(&e, "test").unwrap_or_default();
                    if test.is_empty() {
                        continue;
                    }
                    let name = attr_str(&e, "apply-style-name").unwrap_or_default();
                    let fmt = auto.get(&name).and_then(cf_style_of);
                    out.push((
                        target.clone(),
                        CondFormatPayload {
                            ranges: ranges.clone(),
                            kind: "cell".into(),
                            sub: Some("formula".into()),
                            op: None,
                            v1: Some(Value::String(test)),
                            v2: None,
                            fmt,
                            scale: None,
                            bar: None,
                            icon_style: None,
                            icons: None,
                            show_value: None,
                            stop: None,
                        },
                    ));
                }
            }
            Ok(Event::End(e)) => {
                if e.local_name().as_ref() == "conditional-format" {
                    in_cf = false;
                    ranges.clear();
                    target.clear();
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    out
}

/// 这一条落不落得进 ODS。**写手与记账共用同一把尺**（`write_ods_cond_formats` 与
/// `ods_cf_write_accounts` 都调它）——两边各写一份判断，迟早有一天尺说落得下而手落不下，
/// 那就成了静默丢东西：文件里少一条而保存对话框不说
fn cf_writable(cf: &CondFormatPayload) -> bool {
    cf.kind == "cell"
        && cf.sub.as_deref() == Some("formula")
        && cf
            .v1
            .as_ref()
            .and_then(text_of)
            .is_some_and(|t| !t.trim().is_empty())
        && !cf.ranges.is_empty()
        && cf.ranges.iter().all(|r| !rect_to_odf(r).is_empty())
}

/// 写回 `<table:conditional-format>` 一族。返回空串表示没有可落的（调用方就不必插占位）。
///
/// 只落 `kind=cell` 且 `sub=formula` 的那几条：其余（色阶/数据条/图标集）在 ODF 里是
/// 另一套完全不同的写法，这一层没有，落不出来就干脆不落——写侧宁可少给，也不给错的。
/// 落不出的那几条由 `ods_cf_write_accounts` 记账，保存对话框说得出来
pub fn write_ods_cond_formats(cfs: &[CondFormatPayload], sheet: &str) -> String {
    let mut out = String::new();
    for cf in cfs {
        if !cf_writable(cf) {
            continue;
        }
        let v1 = text_of(cf.v1.as_ref().unwrap()).unwrap();
        // 区域带上表名前缀：条件格式住在 automatic-styles，跟表没有结构上的从属关系，
        // 不带前缀就只剩 table:target-sheet 一口话可说，而 LibreOffice 自己也是带前缀存的
        // （`cf_writable` 已担保每枚 rect 都渲染得出非空地址，这里不必再判一次空）
        let addr: Vec<String> = cf
            .ranges
            .iter()
            .map(|r| {
                let a = rect_to_odf(r);
                if a.is_empty() || sheet.is_empty() {
                    a
                } else {
                    format!("{}.{}", quote_sheet(sheet), a)
                }
            })
            .collect();
        // 样式：有就得先有一枚 automatic-style 名字，这里用序号命名，
        // 由调用方把配套的那枚 style 一起塞进 automatic-styles
        out.push_str("<table:conditional-format table:target-range-address=\"");
        out.push_str(&esc(&addr.join(" ")));
        out.push_str("\">");
        out.push_str("<table:condition table:apply-style-name=\"");
        out.push_str(&esc(&cf_style_name(cf)));
        out.push_str("\" table:test=\"");
        out.push_str(&esc(&v1));
        out.push_str("\"/>");
        out.push_str("</table:conditional-format>");
    }
    out
}

/// 写侧的边界账：`cf_writable` 判落不下的那几条，这一趟要说得出——与
/// `ods_chart_write_accounts` 同一条契约（不能报"已保存"而让文件里少东西）。
/// 按**落不下的原因**分三箱计数，不逐条刷屏：一簿子几十条规则时逐条一句没人看
pub fn ods_cf_write_accounts(sheets: &[SheetPayload]) -> Vec<String> {
    let mut out = Vec::new();
    for s in sheets {
        // 色阶/数据条/图标集：ODF 是另一套完全不同的写法（chart:color-scale 那一族）
        let other_kind = s
            .cond_formats
            .iter()
            .filter(|cf| cf.kind != "cell")
            .count();
        if other_kind > 0 {
            out.push(format!(
                "有 {} 条色阶/数据条/图标集条件格式，ODF 是另一套写法，未写入",
                other_kind
            ));
        }
        // 非表达式判定的 cell 规则（大于/小于/前 10 项/重复值…）：ODF 的
        // table:test 只收得下一条表达式，这些型没有等价写法
        let other_sub = s
            .cond_formats
            .iter()
            .filter(|cf| cf.kind == "cell" && cf.sub.as_deref() != Some("formula"))
            .count();
        if other_sub > 0 {
            out.push(format!(
                "有 {} 条非表达式判定的条件格式（大于/前 10 项/重复值这类），ODF 只装得下表达式判定，未写入",
                other_sub
            ));
        }
        // 判定型对但缺判定式或缺区域：载荷自己不完整，写了也是一条空规则
        let broken = s
            .cond_formats
            .iter()
            .filter(|cf| {
                cf.kind == "cell"
                    && cf.sub.as_deref() == Some("formula")
                    && (cf.v1.as_ref().and_then(text_of).is_none_or(|t| t.trim().is_empty())
                        || cf.ranges.is_empty()
                        || cf.ranges.iter().any(|r| rect_to_odf(r).is_empty()))
            })
            .count();
        if broken > 0 {
            out.push(format!(
                "有 {} 条表达式条件格式缺判定式或缺区域，未写入",
                broken
            ));
        }
    }
    out
}

/// 条件格式样式在 automatic-styles 里的名字。按载荷里的样式内容定名，
/// 内容相同的几条复用同一枚（ODF 无所谓，但少写几枚 xml 更干净）
fn cf_style_name(cf: &CondFormatPayload) -> String {
    let Some(f) = cf.fmt.as_ref() else {
        return String::new();
    };
    let mut k = String::from("oo-cf-");
    k.push_str(&f.bg.clone().unwrap_or_default().replace('#', ""));
    k.push('-');
    k.push_str(&f.cl.clone().unwrap_or_default().replace('#', ""));
    if f.bl == Some(true) {
        k.push_str("-b");
    }
    if f.it == Some(true) {
        k.push_str("-i");
    }
    k
}

/// 写出配套的那些 `<style:style>`（条件格式引用的自动样式），并回一份「下标 → 名字」，
/// 让调用方知道该把哪几枚塞进 automatic-styles
pub fn write_ods_cf_styles(cfs: &[CondFormatPayload]) -> String {
    let mut out = String::new();
    let mut seen: Vec<String> = Vec::new();
    for cf in cfs {
        if cf.kind != "cell" || cf.sub.as_deref() != Some("formula") {
            continue;
        }
        let name = cf_style_name(cf);
        if name.is_empty() || seen.contains(&name) {
            continue;
        }
        let Some(f) = cf.fmt.as_ref() else { continue };
        seen.push(name.clone());
        out.push_str("<style:style style:name=\"");
        out.push_str(&esc(&name));
        out.push_str("\" style:family=\"table-cell\" style:parent-style-name=\"Default\">");
        out.push_str("<style:table-cell-properties");
        if let Some(bg) = f.bg.as_deref() {
            out.push_str(" fo:background-color=\"");
            out.push_str(&esc(bg));
            out.push('"');
        }
        out.push_str("/><style:text-properties");
        if let Some(cl) = f.cl.as_deref() {
            out.push_str(" fo:color=\"");
            out.push_str(&esc(cl));
            out.push('"');
        }
        if f.bl == Some(true) {
            out.push_str(" fo:font-weight=\"bold\"");
        }
        if f.it == Some(true) {
            out.push_str(" fo:font-style=\"italic\"");
        }
        out.push_str("/></style:style>");
    }
    out
}

/// 矩形 → `A1:B2`（0 基 → 表格习惯的 1 基字母列）
fn rect_to_odf(r: &RangeRect) -> String {
    let a = cell_name(r.start_column, r.start_row);
    let b = cell_name(r.end_column, r.end_row);
    match (a, b) {
        (Some(a), Some(b)) if a == b => a,
        (Some(a), Some(b)) => format!("{a}:{b}"),
        _ => String::new(),
    }
}

/// 表名里有空格或引号时 ODF 要求 `'数据 2'` 这样包起来，内部的 `'` 写成 `''`
fn quote_sheet(s: &str) -> String {
    if s.chars().any(|c| c == ' ' || c == '\'' || c == '.' || c == '-') {
        format!("'{}'", s.replace('\'', "''"))
    } else {
        s.to_string()
    }
}

fn cell_name(col: u32, row: u32) -> Option<String> {
    if col > 16_383 || row > 1_048_575 {
        return None;
    }
    let mut n = col + 1;
    let mut s = String::new();
    while n > 0 {
        let rem = ((n - 1) % 26) as u8;
        s.insert(0, (b'A' + rem) as char);
        n = (n - 1) / 26;
    }
    s.push_str(&(row + 1).to_string());
    Some(s)
}

fn text_of(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = r#"<office:automatic-styles>\
<table:conditional-format table:target-sheet="." table:target-range-address="数据.A1:数据.B2">\
<table:condition table:name="c1" table:apply-style-name="ce1" table:test="[.B2]&gt;5"/>\
</table:conditional-format>\
</office:automatic-styles>"#;

    #[test]
    fn reads_condition_and_range() {
        let mut auto = HashMap::new();
        auto.insert(
            "ce1".to_string(),
            CellStyle {
                bg: Some("#FF0000".into()),
                ..Default::default()
            },
        );
        let got = read_ods_cond_formats(FIXTURE, &auto);
        assert_eq!(got.len(), 1, "一条条件");
        // 夹具里 target-sheet 是 "."，等于没说表名 → 交回空串让装配侧定夺
        assert_eq!(got[0].0, "");
        let cf = &got[0].1;
        assert_eq!(cf.kind, "cell");
        assert_eq!(cf.sub.as_deref(), Some("formula"));
        // 表达式原样留着，不翻译成 xlsx 语法
        assert_eq!(text_of(cf.v1.as_ref().unwrap()).unwrap(), "[.B2]>5");
        assert_eq!(cf.ranges.len(), 1);
        let r = &cf.ranges[0];
        assert_eq!((r.start_row, r.start_column, r.end_row, r.end_column), (0, 0, 1, 1));
        // 样式名对得上 automatic-styles 里那枚
        assert_eq!(cf.fmt.as_ref().and_then(|f| f.bg.clone()), Some("#FF0000".into()));
    }

    #[test]
    fn round_trips_through_writer() {
        let mut auto = HashMap::new();
        auto.insert(
            "ce1".to_string(),
            CellStyle {
                bg: Some("#FF0000".into()),
                ..Default::default()
            },
        );
        let first: Vec<CondFormatPayload> =
            read_ods_cond_formats(FIXTURE, &auto).into_iter().map(|(_, c)| c).collect();
        // 不带表名的一趟：验证表达式与 A1 记法本身
        let xml = write_ods_cond_formats(&first, "");
        assert!(xml.contains("table:test=\"[.B2]&gt;5\""), "表达式要转义回 &gt;: {xml}");
        assert!(xml.contains("A1:B2"), "区域要落回 A1 记法: {xml}");
        // 带表名的一趟：区域要带前缀，且读回来仍认得出
        let named = write_ods_cond_formats(&first, "数据");
        assert!(named.contains("数据.A1:B2"), "表名前缀要带上: {named}");
        let back = read_ods_cond_formats(&format!("<x>{named}</x>"), &HashMap::new());
        assert_eq!(back.len(), 1, "带前缀的也读得回");
        assert_eq!(
            (back[0].1.ranges[0].start_row, back[0].1.ranges[0].end_column),
            (0, 1),
            "带前缀的区域落回同一个矩形"
        );
        // 写出的件再读一遍，形状不变（这是「往返」这个词的最低要求）
        let second = read_ods_cond_formats(&format!("<x>{xml}</x>"), &HashMap::new());
        assert_eq!(second.len(), first.len(), "条数不变");
        assert_eq!(
            text_of(second[0].1.v1.as_ref().unwrap()).unwrap(),
            "[.B2]>5",
            "表达式往返后不变"
        );
        assert_eq!(second[0].1.ranges[0].start_row, first[0].ranges[0].start_row);
    }

    /// 落得下的那几条不该出声，落不下的按原因分箱——记账尺与写手尺必须是同一把
    /// （`cf_writable` 判 true 的这里必须闭嘴，否则用户会以为丢了一条其实写进去的规则）
    #[test]
    fn write_accounts_split_by_reason() {
        let formula = CondFormatPayload {
            kind: "cell".into(),
            sub: Some("formula".into()),
            v1: Some(Value::String("[.B2]>5".into())),
            ranges: vec![RangeRect {
                start_row: 0,
                start_column: 0,
                end_row: 1,
                end_column: 1,
            }],
            ..Default::default()
        };
        let scale = CondFormatPayload {
            kind: "colorScale".into(),
            ranges: vec![RangeRect::default()],
            ..Default::default()
        };
        let greater = CondFormatPayload {
            kind: "cell".into(),
            sub: Some("number".into()),
            op: Some("greaterThan".into()),
            v1: Some(Value::from(5)),
            ranges: vec![RangeRect::default()],
            ..Default::default()
        };
        let no_test = CondFormatPayload {
            kind: "cell".into(),
            sub: Some("formula".into()),
            v1: Some(Value::String("   ".into())),
            ranges: vec![RangeRect::default()],
            ..Default::default()
        };
        let sheets = vec![SheetPayload {
            name: "数据".into(),
            cond_formats: vec![
                formula.clone(),
                scale,
                greater,
                no_test.clone(),
                no_test,
            ],
            ..Default::default()
        }];
        let got = ods_cf_write_accounts(&sheets);
        assert_eq!(got.len(), 3, "三箱各一句，逐箱点名: {got:?}");
        assert!(got[0].contains("色阶"), "第一箱是图型族: {}", got[0]);
        assert!(got[1].contains("非表达式"), "第二箱是判定族: {}", got[1]);
        assert!(got[2].contains("缺判定式"), "第三箱是残规则: {}", got[2]);
        // 写手与记账两头对同一条公式规则必须同判：尺说写得出，账就一个字都不报
        assert!(cf_writable(&formula), "表达式规则落得下（写手的尺）");
        assert!(
            got[2].contains("2 条"),
            "残规则那一箱只数两条 no_test，那条好的公式规则不算进去: {}",
            got[2]
        );
        // 空簿子不出声：没有规则时一句都不该有
        assert!(
            ods_cf_write_accounts(&[SheetPayload::default()]).is_empty(),
            "没有条件格式的簿子不该有账"
        );
    }

    #[test]
    fn cell_addresses() {        assert_eq!(odf_cell("A1"), Some((0, 0)));
        assert_eq!(odf_cell("B2"), Some((1, 1)));
        assert_eq!(odf_cell("AA10"), Some((26, 9)));
        // 表名前缀要剥掉
        assert_eq!(odf_cell("数据.A1"), Some((0, 0)));
        assert_eq!(odf_cell("$数据.$A$1"), Some((0, 0)));
        assert_eq!(odf_rect("数据.A1:数据.B2"), Some(RangeRect {
            start_row: 0,
            start_column: 0,
            end_row: 1,
            end_column: 1,
        }));
        // 认不出的不该造出半个矩形
        assert_eq!(odf_rect(""), None);
        assert_eq!(odf_rect("不是地址"), None);
    }
}
