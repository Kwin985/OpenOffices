//! 表格三类规则（筛选 / 数据验证 / 条件格式）在 xlsx 与载荷之间的双向换算。
//!
//! 载荷是归一化模型（`src/lib/sheet-rules.ts` 从 Univer 快照里取出来的那一份），这里负责把它
//! 翻译成 OOXML 的形状、再把 OOXML 的形状翻回同一份模型。三处换算各自只记在一处：
//! - 筛选的列条件是**绝对列号**，crate 自己减去 `<autoFilter>` 首列得到 `<filterColumn colId>`；
//! - `dropdown` 与 crate 的 `show_dropdown` 都是界面语义（有下拉箭头），取反成 OOXML 的
//!   `showDropDown="1"`（1 反而是藏起来）由 crate 做；
//! - 条件格式数组顺序即优先级（高在前），crate 按插入顺序编 `priority`，所以这里不颠倒
//!   （Univer 门面那边要倒着插是它自己的存序，与文件无关）。
//!
//! 写不进 xlsx 的东西一律进 `notes`（边界账），由 `write_xlsx` 带回前端显示在状态栏——
//! 静默少给一条规则，用户只会以为规则本来就没生效。

use rust_xlsxwriter::{
    Color, ConditionalFormat, ConditionalFormat2ColorScale, ConditionalFormat3ColorScale,
    ConditionalFormatAverage, ConditionalFormatAverageRule, ConditionalFormatBlank,
    ConditionalFormatCell, ConditionalFormatCellRule, ConditionalFormatCustomIcon,
    ConditionalFormatDataBar, ConditionalFormatDate, ConditionalFormatDateRule,
    ConditionalFormatDuplicate, ConditionalFormatFormula, ConditionalFormatIconSet,
    ConditionalFormatIconType, ConditionalFormatText, ConditionalFormatTextRule,
    ConditionalFormatTop, ConditionalFormatTopRule, ConditionalFormatType,
    ConditionalFormatValue, DataValidation, DataValidationErrorStyle, DataValidationRule,
    FilterCondition, FilterCriteria, Formula, Format, FormatUnderline, Worksheet, XlsxError,
};
use quick_xml::events::Event;
use quick_xml::Reader;
use serde_json::Value;

use crate::xlsx::{
    CondFormatBar, CondFormatBarStop, CondFormatIconLevel, CondFormatPayload, CondFormatStyle,
    CondFormatStop, CustomFilterItem, CustomFilters, DataValidationPayload, FilterColumnPayload,
    RangeRect, SheetFilterPayload, SheetPayload,
};
use crate::xlsx_style::{a1_to_rc, argb_to_hex, attr_str};

/// 写一张表的三类规则，返回写侧的边界账
pub fn write_sheet_rules(ws: &mut Worksheet, sheet: &SheetPayload) -> Vec<String> {
    let mut notes = Vec::new();
    if let Some(f) = &sheet.filter {
        write_filter(ws, f, &mut notes);
    }
    for dv in &sheet.data_validations {
        write_validation(ws, dv, &mut notes);
    }
    for cf in &sheet.cond_formats {
        write_cond_format(ws, cf, &mut notes);
    }
    notes
}

type Rect = (u32, u16, u32, u16);

fn note(notes: &mut Vec<String>, s: &str) {
    notes.push(s.to_string());
}

fn add_cf<T>(ws: &mut Worksheet, r: Rect, f: &T, label: &str, notes: &mut Vec<String>)
where
    T: ConditionalFormat + Send + Sync,
{
    let (r1, c1, r2, c2) = r;
    if ws.add_conditional_format(r1, c1, r2, c2, f).is_err() {
        notes.push(format!("有条{label}规则没能写进 xlsx（区域或档位不合形）"));
    }
}

// ---------------- 公用换算 ----------------

/// 行列换成 crate 的入参形状（列是 u16，不成形或超界即 None）
fn rect_of(r: &RangeRect) -> Option<Rect> {
    let (Ok(c1), Ok(c2)) = (u16::try_from(r.start_column), u16::try_from(r.end_column)) else {
        return None;
    };
    if r.start_row > r.end_row || r.start_column > r.end_column {
        return None;
    }
    Some((r.start_row, c1, r.end_row, c2))
}

fn col_letters(mut c: u32) -> String {
    let mut s = String::new();
    loop {
        s.insert(0, (b'A' + (c % 26) as u8) as char);
        if c < 26 {
            break;
        }
        c = c / 26 - 1;
    }
    s
}

fn a1(r: &RangeRect) -> String {
    format!(
        "{}{}:{}{}",
        col_letters(r.start_column),
        r.start_row + 1,
        col_letters(r.end_column),
        r.end_row + 1
    )
}

/// 全部区域并进同一个 sqref/ref：crate 的 `set_multi_range` 是**整串替换**而不是补在
/// `add_data_validation` 的区域之后（实测：只给"除第一块"会把第一块整个弄丢）
fn all_ranges(ranges: &[RangeRect]) -> String {
    ranges.iter().map(a1).collect::<Vec<_>>().join(" ")
}

fn as_text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn text_of(v: Option<&Value>) -> String {
    v.map(as_text).unwrap_or_default()
}

fn number_of(s: &str) -> Option<f64> {
    let t = s.trim();
    if t.is_empty() {
        return None;
    }
    t.parse::<f64>().ok().filter(|x| x.is_finite())
}

/// `$A$1`、`=$B$2`、`$A$1:$A$3` 这一类是引用而不是字面值：crate 对"取单元格值"另有入口
fn is_ref(s: &str) -> bool {
    let t = s.trim();
    t.starts_with('$') || t.starts_with('=') || t.contains(':')
}

/// 载荷里的日期一律 `YYYY-MM-DD`（前端 normDateValue 收过），OOXML 里是序列号
fn date_serial(s: &str) -> Option<f64> {
    let t = s.trim();
    if let Some(n) = number_of(t) {
        return Some(n);
    }
    let mut parts = t.split('-');
    let mut next = || parts.next().and_then(|x| x.parse::<f64>().ok());
    let (Some(y), Some(m), Some(d)) = (next(), next(), next()) else {
        return None;
    };
    if parts.next().is_some() {
        return None;
    }
    if !(1.0..=12.0).contains(&m) || !(1.0..=31.0).contains(&d) {
        return None;
    }
    Some(civil_days(y, m, d) - civil_days(1899.0, 12.0, 30.0))
}

/// Howard Hinnant 的 civil→days（1970-01-01 为 0），不为此引日期库
fn civil_days(y0: f64, m0: f64, d0: f64) -> f64 {
    let (y, m, d) = (y0 as i64, m0 as i64, d0 as i64);
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    (era * 146097 + doe - 719468) as f64
}

/// 一个值摆成 OOXML 的 `<cfvo>`：数值走数值、公式走公式（纯字符串会被 crate 加引号，装不进档位）
fn cf_value(t: &str, v: Option<&Value>) -> ConditionalFormatValue {
    let raw = text_of(v);
    if t == "formula" {
        return ConditionalFormatValue::from(Formula::new(raw.as_str()));
    }
    match number_of(&raw) {
        Some(n) => ConditionalFormatValue::from(n),
        None => ConditionalFormatValue::from(0.0),
    }
}

/// 载荷里的 cfvo type 用 OOXML 字面；crate 的 Lowest/Highest 落盘就是 min/max
fn cfvo_type(t: &str) -> ConditionalFormatType {
    match t {
        "min" => ConditionalFormatType::Lowest,
        "max" => ConditionalFormatType::Highest,
        "percent" => ConditionalFormatType::Percent,
        "percentile" => ConditionalFormatType::Percentile,
        "formula" => ConditionalFormatType::Formula,
        "auto" => ConditionalFormatType::Automatic,
        _ => ConditionalFormatType::Number,
    }
}

/// 判定值的两种形状：字面量（数值/长度）与引用（走 formula 版入口）。
/// 引用一律 `Formula`——Excel 的 formula1 本来就是"一段文本"，把 `$B$2` 当数字 parse 不通
fn formula_of(s: &str) -> Option<Formula> {
    (!s.trim().is_empty()).then(|| Formula::new(s))
}
fn i32_of(s: &str) -> Option<i32> {
    number_of(s).map(|v| v.trunc() as i32)
}
fn u32_of(s: &str) -> Option<u32> {
    number_of(s).map(|v| v.max(0.0) as u32)
}
fn f64_of(s: &str) -> Option<f64> {
    number_of(s)
}

/// `op + 两个操作数` 摆成一条规则。八种比较符在四种操作数形状下是同一张表，所以按宏铺开
macro_rules! dv_rule_fn {
    ($name:ident, $t:ty, $parse:ident) => {
        fn $name(op: &str, f1: &str, f2: &str) -> Option<DataValidationRule<$t>> {
            let a = $parse(f1)?;
            Some(match op {
                "between" => DataValidationRule::Between(a, $parse(f2)?),
                "notBetween" => DataValidationRule::NotBetween(a, $parse(f2)?),
                "equal" => DataValidationRule::EqualTo(a),
                "notEqual" => DataValidationRule::NotEqualTo(a),
                "greaterThan" => DataValidationRule::GreaterThan(a),
                "greaterThanOrEqual" => DataValidationRule::GreaterThanOrEqualTo(a),
                "lessThan" => DataValidationRule::LessThan(a),
                "lessThanOrEqual" => DataValidationRule::LessThanOrEqualTo(a),
                _ => return None,
            })
        }
    };
}

dv_rule_fn!(formula_rule, Formula, formula_of);
dv_rule_fn!(whole_rule, i32, i32_of);
dv_rule_fn!(decimal_rule, f64, f64_of);
dv_rule_fn!(length_rule, u32, u32_of);

// ---------------- 筛选 ----------------

fn criteria_of(op: Option<&str>) -> Option<FilterCriteria> {
    Some(match op? {
        "equal" => FilterCriteria::EqualTo,
        "notEqual" => FilterCriteria::NotEqualTo,
        "greaterThan" => FilterCriteria::GreaterThan,
        "greaterThanOrEqual" => FilterCriteria::GreaterThanOrEqualTo,
        "lessThan" => FilterCriteria::LessThan,
        "lessThanOrEqual" => FilterCriteria::LessThanOrEqualTo,
        "beginsWith" => FilterCriteria::BeginsWith,
        "notBeginsWith" | "doesNotBeginWith" => FilterCriteria::DoesNotBeginWith,
        "endsWith" => FilterCriteria::EndsWith,
        "notEndsWith" | "doesNotEndWith" => FilterCriteria::DoesNotEndWith,
        "contains" => FilterCriteria::Contains,
        "notContains" | "doesNotContain" => FilterCriteria::DoesNotContain,
        _ => return None,
    })
}

fn write_filter(ws: &mut Worksheet, f: &SheetFilterPayload, notes: &mut Vec<String>) {
    let Some((r1, c1, r2, c2)) = rect_of(&f.range) else {
        note(notes, "有条筛选的区域不成形，没写进 xlsx");
        return;
    };
    if ws.autofilter(r1, c1, r2, c2).is_err() {
        note(notes, "有条筛选没能写进 xlsx（区域超出表格界限）");
        return;
    }
    for fc in &f.columns {
        let Ok(abs) = u16::try_from(fc.col) else { continue };
        let mut cond = FilterCondition::new();
        let mut written = false;
        // 一列在 OOXML 里要么 `<filters>` 要么 `<customFilters>`，两类不能并存
        if let Some(list) = &fc.list {
            for x in list {
                cond = match number_of(x) {
                    Some(n) => cond.add_list_filter(n),
                    None => cond.add_list_filter(x.as_str()),
                };
                written = true;
            }
        }
        if fc.blank.unwrap_or(false) {
            cond = cond.add_list_blanks_filter();
            written = true;
        }
        if let Some(cu) = &fc.custom {
            if written {
                note(notes, "有条筛选同一列既给了候选值又给了自定义条件，xlsx 只装得下候选值那一类");
            } else {
                let mut items = 0usize;
                for item in &cu.items {
                    let Some(criteria) = criteria_of(item.op.as_deref()) else {
                        note(notes, "有条筛选的自定义比较符认不出来，那一条没写");
                        continue;
                    };
                    cond = match number_of(&item.v) {
                        Some(n) => cond.add_custom_filter(criteria, n),
                        None => cond.add_custom_filter(criteria, item.v.as_str()),
                    };
                    items += 1;
                }
                if items > 1 && cu.and == Some(false) {
                    cond = cond.add_custom_boolean_or();
                }
                written = items > 0;
            }
        }
        if !written {
            note(notes, "有条筛选条件既没有候选值也没有自定义比较，没写进 xlsx");
            continue;
        }
        // 列落在筛选区之外时 crate 是 Err 的，所以这条账记得住
        if ws.filter_column(abs, &cond).is_err() {
            note(notes, "有条筛选条件落在筛选区之外，没写进 xlsx");
        }
    }
    // 被筛掉的行不在这里写：crate 在存盘时按 `filter_column` 的条件自己把不匹配的行藏起来
    // （`hide_autofilter_rows`，与 Excel 的"存的就是筛过的样子"同形），所以 `filtered_out`
    // 这份缓存不进文件——抄一份过期的行态进去，只会盖掉条件本来该藏的那些
}

// ---------------- 数据验证 ----------------

const DV_TYPES: [&str; 6] = ["whole", "decimal", "textLength", "list", "date", "custom"];

/// Excel 面板对提示文字有硬上限（标题 32 字、正文 255 字），超限的写法只有"不写这一项并记账"，
/// 而不是把用户的话裁短——裁过的提示语会在别人电脑上变成另一句话
fn put_text(
    v: DataValidation,
    text: &str,
    limit: usize,
    what: &str,
    notes: &mut Vec<String>,
    apply: impl FnOnce(DataValidation) -> Result<DataValidation, XlsxError>,
) -> DataValidation {
    if text.chars().count() > limit {
        notes.push(format!("有条数据验证的{what}超过 Excel 的 {limit} 字上限，那一项没写进 xlsx"));
        return v;
    }
    apply(v.clone()).unwrap_or(v)
}

fn write_validation(ws: &mut Worksheet, dv: &DataValidationPayload, notes: &mut Vec<String>) {
    let Some(first) = dv.ranges.first() else { return };
    let Some(rect) = rect_of(first) else {
        note(notes, "有条数据验证的区域不成形，没写进 xlsx");
        return;
    };
    let op = dv.op.as_deref().unwrap_or("between");
    let f1 = dv.f1.as_deref().unwrap_or("");
    let f2 = dv.f2.as_deref().unwrap_or("");
    let base = DataValidation::new();
    // 判定值是引用时走 *_formula 入口：crate 对字面量会加引号或按数字校验，引用过去就变了味
    let built: Option<DataValidation> = match dv.dv_type.as_str() {
        "whole" => {
            if is_ref(f1) {
                formula_rule(op, f1, f2).map(|r| base.allow_whole_number_formula(r))
            } else {
                whole_rule(op, f1, f2).map(|r| base.allow_whole_number(r))
            }
        }
        "decimal" => {
            if is_ref(f1) {
                formula_rule(op, f1, f2).map(|r| base.allow_decimal_number_formula(r))
            } else {
                decimal_rule(op, f1, f2).map(|r| base.allow_decimal_number(r))
            }
        }
        "textLength" => {
            if is_ref(f1) {
                formula_rule(op, f1, f2).map(|r| base.allow_text_length_formula(r))
            } else {
                length_rule(op, f1, f2).map(|r| base.allow_text_length(r))
            }
        }
        "list" => {
            if f1.is_empty() {
                None
            } else if is_ref(f1) {
                Some(base.allow_list_formula(Formula::new(f1)))
            } else {
                let items: Vec<&str> = f1.split(',').collect();
                match base.allow_list_strings(&items) {
                    // 255 字符是 Excel 面板的上限而文件格式装得下：改走公式形状把整串带过去，不裁内容
                    Ok(v) => Some(v),
                    Err(_) => Some(DataValidation::new().allow_list_formula(Formula::new(format!("\"{f1}\"").as_str()))),
                }
            }
        }
        // 日期在 OOXML 里就是序列号文本，所以字面量与引用最后都归到 Formula 形状
        "date" => {
            let (a, b) = if is_ref(f1) {
                (f1.to_string(), f2.to_string())
            } else {
                match date_serial(f1) {
                    Some(x) => (x.to_string(), date_serial(f2).map(|y| y.to_string()).unwrap_or_default()),
                    None => (String::new(), String::new()),
                }
            };
            formula_rule(op, &a, &b).map(|r| base.allow_date_formula(r))
        }
        "custom" => {
            if f1.is_empty() {
                None
            } else {
                Some(base.allow_custom(Formula::new(f1)))
            }
        }
        _ => None,
    };
    let Some(built) = built else {
        notes.push(if DV_TYPES.contains(&dv.dv_type.as_str()) {
            format!("有条数据验证（类型 {}）的判定值摆不出 xlsx 的形状，没写", dv.dv_type)
        } else {
            format!("有条数据验证（类型 {}）不是 xlsx 有的类型，没写", dv.dv_type)
        });
        return;
    };
    // 没明说"忽略空值"就写 false：OOXML 里 allowBlank 缺省即 0，写成 1 会让一条本来不许空的
    // 验证在重开后悄悄放过空值（Univer 界面上的勾也跟着多出来）
    let mut v = built.ignore_blank(dv.blank == Some(true));
    if let Some(dropdown) = dv.dropdown {
        v = v.show_dropdown(dropdown);
    }
    if let Some(err) = &dv.err {
        v = v.show_error_message(true);
        v = put_text(v, err, 255, "错误提示文字", notes, |x| x.set_error_message(err));
        if let Some(t) = &dv.err_title {
            v = put_text(v, t, 32, "错误提示标题", notes, |x| x.set_error_title(t));
        }
        v = v.set_error_style(match dv.err_style.as_deref() {
            Some("warning") => DataValidationErrorStyle::Warning,
            Some("information") => DataValidationErrorStyle::Information,
            _ => DataValidationErrorStyle::Stop,
        });
    }
    if let Some(p) = &dv.prompt {
        v = v.show_input_message(true);
        v = put_text(v, p, 255, "输入提示文字", notes, |x| x.set_input_message(p));
        if let Some(t) = &dv.prompt_title {
            v = put_text(v, t, 32, "输入提示标题", notes, |x| x.set_input_title(t));
        }
    }
    let multi = all_ranges(&dv.ranges);
    if !multi.is_empty() {
        v = v.set_multi_range(multi);
    }
    let (r1, c1, r2, c2) = rect;
    if ws.add_data_validation(r1, c1, r2, c2, &v).is_err() {
        note(notes, "有条数据验证没能写进 xlsx（区域超出表格界限）");
    }
}

// ---------------- 条件格式 ----------------

fn write_cond_format(ws: &mut Worksheet, cf: &CondFormatPayload, notes: &mut Vec<String>) {
    let Some(first) = cf.ranges.first() else { return };
    let Some(rect) = rect_of(first) else {
        note(notes, "有条条件格式的区域不成形，没写进 xlsx");
        return;
    };
    let multi = all_ranges(&cf.ranges);
    let stop = cf.stop.unwrap_or(false);
    match cf.kind.as_str() {
        "colorScale" => write_scale(ws, cf, rect, &multi, stop, notes),
        "dataBar" => write_bar(ws, cf, rect, &multi, stop, notes),
        "iconSet" => write_icons(ws, cf, rect, &multi, stop, notes),
        _ => write_cell_rule(ws, cf, rect, &multi, stop, notes),
    }
}

fn write_scale(
    ws: &mut Worksheet,
    cf: &CondFormatPayload,
    rect: Rect,
    multi: &str,
    stop: bool,
    notes: &mut Vec<String>,
) {
    let scale = cf.scale.clone().unwrap_or_default();
    match scale.len() {
        2 => {
            let (min, max) = (&scale[0], &scale[1]);
            let mut f = ConditionalFormat2ColorScale::new()
                .set_minimum(cfvo_type(&min.t), cf_value(&min.t, min.v.as_ref()))
                .set_maximum(cfvo_type(&max.t), cf_value(&max.t, max.v.as_ref()))
                .set_minimum_color(Color::from(min.color.as_str()))
                .set_maximum_color(Color::from(max.color.as_str()));
            if !multi.is_empty() {
                f = f.set_multi_range(multi);
            }
            if stop {
                f = f.set_stop_if_true(true);
            }
            add_cf(ws, rect, &f, "色阶", notes);
        }
        3 => {
            let (min, mid, max) = (&scale[0], &scale[1], &scale[2]);
            let mut f = ConditionalFormat3ColorScale::new()
                .set_minimum(cfvo_type(&min.t), cf_value(&min.t, min.v.as_ref()))
                .set_midpoint(cfvo_type(&mid.t), cf_value(&mid.t, mid.v.as_ref()))
                .set_maximum(cfvo_type(&max.t), cf_value(&max.t, max.v.as_ref()))
                .set_minimum_color(Color::from(min.color.as_str()))
                .set_midpoint_color(Color::from(mid.color.as_str()))
                .set_maximum_color(Color::from(max.color.as_str()));
            if !multi.is_empty() {
                f = f.set_multi_range(multi);
            }
            if stop {
                f = f.set_stop_if_true(true);
            }
            add_cf(ws, rect, &f, "色阶", notes);
        }
        0 => note(notes, "有条色阶没有档位，没写进 xlsx"),
        n => notes.push(format!("有条色阶有 {n} 档，xlsx 只装得下两端或带中间值的三端，没写")),
    }
}

fn write_bar(
    ws: &mut Worksheet,
    cf: &CondFormatPayload,
    rect: Rect,
    multi: &str,
    stop: bool,
    notes: &mut Vec<String>,
) {
    let Some(bar) = &cf.bar else {
        note(notes, "有条数据条缺了两端或颜色，没写进 xlsx");
        return;
    };
    let mut f = ConditionalFormatDataBar::new()
        .set_minimum(cfvo_type(&bar.min.t), cf_value(&bar.min.t, bar.min.v.as_ref()))
        .set_maximum(cfvo_type(&bar.max.t), cf_value(&bar.max.t, bar.max.v.as_ref()))
        .set_fill_color(Color::from(bar.pos.as_str()));
    // crate 的默认负色是 Excel 的默认红条；载荷里没设负色说的是"跟正色同色"（我们的界面上就是
    // 这么画的），所以必须显式把负色压成正色，crate 才会改写 negativeBarColorSameAsPositive="1"
    let neg = bar.neg.as_deref().unwrap_or(bar.pos.as_str());
    f = f.set_negative_fill_color(Color::from(neg));
    if bar.grad == Some(false) {
        f = f.set_solid_fill(true);
    }
    if cf.show_value == Some(false) {
        f = f.set_bar_only(true);
    }
    if !multi.is_empty() {
        f = f.set_multi_range(multi);
    }
    if stop {
        f = f.set_stop_if_true(true);
    }
    add_cf(ws, rect, &f, "数据条", notes);
}

/// OOXML 的图标家族名以档位数字开头，而 crate 要求档位数与家族图标数严格相等
fn icon_count_matches(style: &str, n: usize) -> bool {
    style
        .chars()
        .next()
        .and_then(|c| c.to_digit(10))
        .is_some_and(|d| d as usize == n)
}

/// 逐个问 crate 的 Display 拿 OOXML 名——名字表由 crate 维护，我们不再抄一份
fn icon_type_for(style: &str) -> Option<ConditionalFormatIconType> {
    use ConditionalFormatIconType as I;
    let want = style.trim().to_ascii_lowercase();
    [
        I::ThreeArrows,
        I::ThreeArrowsGray,
        I::ThreeFlags,
        I::ThreeTrafficLights,
        I::ThreeTrafficLightsWithRim,
        I::ThreeSigns,
        I::ThreeSymbolsCircled,
        I::ThreeSymbols,
        I::ThreeStars,
        I::ThreeTriangles,
        I::FourArrows,
        I::FourArrowsGray,
        I::FourRedToBlack,
        I::FourHistograms,
        I::FourTrafficLights,
        I::FiveArrows,
        I::FiveArrowsGray,
        I::FiveBoxes,
        I::FiveHistograms,
        I::FiveQuadrants,
    ]
    .into_iter()
    .find(|t| t.to_string().to_ascii_lowercase() == want)
}

fn write_icons(
    ws: &mut Worksheet,
    cf: &CondFormatPayload,
    rect: Rect,
    multi: &str,
    stop: bool,
    notes: &mut Vec<String>,
) {
    let Some(raw) = cf.icon_style.as_deref() else {
        note(notes, "有条图标集没有家族名，没写进 xlsx");
        return;
    };
    let Some(ty) = icon_type_for(raw) else {
        notes.push(format!("有条图标集（{raw}）不在能写出的家族里，没写"));
        return;
    };
    let levels = cf.icons.clone().unwrap_or_default();
    let mut f = ConditionalFormatIconSet::new().set_icon_type(ty);
    if !levels.is_empty() {
        if !icon_count_matches(raw, levels.len()) {
            notes.push(format!(
                "有条图标集（{raw}）的档位数与家族图标数不符（{}/{}），按默认档位写出",
                levels.len(),
                raw.chars().next().unwrap_or('?')
            ));
        } else {
            // 载荷是高→低，OOXML 的 cfvo 是低→高；set_icons 自己把首档钉成 0%
            let icons: Vec<ConditionalFormatCustomIcon> = levels
                .iter()
                .rev()
                .map(|l| {
                    let mut i = ConditionalFormatCustomIcon::new()
                        .set_rule(cfvo_type(&l.t), cf_value(&l.t, l.v.as_ref()));
                    if l.op == "greaterThan" {
                        i = i.set_greater_than(true);
                    }
                    i
                })
                .collect();
            f = f.set_icons(&icons);
        }
    }
    if cf.show_value == Some(false) {
        f = f.show_icons_only(true);
    }
    if !multi.is_empty() {
        f = f.set_multi_range(multi);
    }
    if stop {
        f = f.set_stop_if_true(true);
    }
    add_cf(ws, rect, &f, "图标集", notes);
}

/// kind=cell：OOXML 的 cellIs / containsText / timePeriod / top10 / aboveAverage /
/// duplicateValues / uniqueValues / expression 都在这里分派
fn write_cell_rule(
    ws: &mut Worksheet,
    cf: &CondFormatPayload,
    rect: Rect,
    multi: &str,
    stop: bool,
    notes: &mut Vec<String>,
) {
    let sub = cf.sub.as_deref().unwrap_or("number");
    let op = cf.op.as_deref().unwrap_or("");
    let v1 = text_of(cf.v1.as_ref());
    let v2 = text_of(cf.v2.as_ref());
    let fmt = dxf_format(cf);
    macro_rules! finish {
        ($f:expr, $label:expr) => {{
            let mut f = $f;
            if let Some(x) = fmt {
                f = f.set_format(x);
            }
            if !multi.is_empty() {
                f = f.set_multi_range(multi);
            }
            if stop {
                f = f.set_stop_if_true(true);
            }
            add_cf(ws, rect, &f, $label, notes);
            return;
        }};
    }
    match sub {
        "number" => match number_cell_rule(op, &v1, &v2) {
            Some(r) => finish!(ConditionalFormatCell::new().set_rule(r), "数值条件"),
            None => notes.push(format!("有条数值条件格式（比较符 {op}）没能写进 xlsx")),
        },
        "text" => {
            // 空/非空在 OOXML 里是独立规则型（containsBlanks / notContainsBlanks）
            if op == "equal" && v1.is_empty() {
                finish!(ConditionalFormatBlank::new(), "空值条件");
            }
            if op == "notEqual" && v1.is_empty() {
                finish!(ConditionalFormatBlank::new().invert(), "非空值条件");
            }
            let text_rule = match op {
                "containsText" => ConditionalFormatTextRule::Contains(v1.clone()),
                "notContains" | "doesNotContain" => {
                    ConditionalFormatTextRule::DoesNotContain(v1.clone())
                }
                "beginsWith" => ConditionalFormatTextRule::BeginsWith(v1.clone()),
                "endsWith" => ConditionalFormatTextRule::EndsWith(v1.clone()),
                // "文本等于"在 OOXML 里没有文本规则型，Excel 自己就写成 cellIs equal
                "equal" => finish!(
                    ConditionalFormatCell::new()
                        .set_rule(ConditionalFormatCellRule::EqualTo(v1.clone())),
                    "文本相等条件"
                ),
                "notEqual" => finish!(
                    ConditionalFormatCell::new()
                        .set_rule(ConditionalFormatCellRule::NotEqualTo(v1.clone())),
                    "文本不等条件"
                ),
                other => {
                    notes.push(format!("有条文本条件格式（比较符 {other}）没能写进 xlsx"));
                    return;
                }
            };
            finish!(
                ConditionalFormatText::new().set_rule(text_rule),
                "文本条件"
            );
        }
        "timePeriod" => match date_rule(op) {
            Some(r) => finish!(ConditionalFormatDate::new().set_rule(r), "日期条件"),
            None => notes.push(format!("有条日期条件格式（时段 {op}）没能写进 xlsx")),
        },
        "rank" => {
            let n = number_of(&v1).unwrap_or(10.0).max(1.0) as u16;
            match op {
                "top" => finish!(
                    ConditionalFormatTop::new().set_rule(ConditionalFormatTopRule::Top(n)),
                    "排名条件"
                ),
                "bottom" => finish!(
                    ConditionalFormatTop::new().set_rule(ConditionalFormatTopRule::Bottom(n)),
                    "排名条件"
                ),
                "topPercent" => finish!(
                    ConditionalFormatTop::new().set_rule(ConditionalFormatTopRule::TopPercent(n)),
                    "排名条件"
                ),
                "bottomPercent" => finish!(
                    ConditionalFormatTop::new()
                        .set_rule(ConditionalFormatTopRule::BottomPercent(n)),
                    "排名条件"
                ),
                other => notes.push(format!("有条排名条件格式（{other}）没能写进 xlsx")),
            }
        }
        "average" => {
            let rule = match op {
                "lessThan" => ConditionalFormatAverageRule::BelowAverage,
                "lessThanOrEqual" => ConditionalFormatAverageRule::EqualOrBelowAverage,
                "greaterThan" => ConditionalFormatAverageRule::AboveAverage,
                "greaterThanOrEqual" => ConditionalFormatAverageRule::EqualOrAboveAverage,
                other => {
                    notes.push(format!("有条均值条件格式（{other}）没能写进 xlsx"));
                    return;
                }
            };
            finish!(
                ConditionalFormatAverage::new().set_rule(rule),
                "均值条件"
            );
        }
        "duplicateValues" => finish!(ConditionalFormatDuplicate::new(), "重复值条件"),
        "uniqueValues" => finish!(ConditionalFormatDuplicate::new().invert(), "唯一值条件"),
        "formula" => {
            if v1.is_empty() {
                note(notes, "有条公式条件格式没有表达式，没写进 xlsx");
                return;
            }
            finish!(
                ConditionalFormatFormula::new().set_rule(Formula::new(v1.as_str())),
                "公式条件"
            );
        }
        other => notes.push(format!("有条条件格式（{other}）是我们认不出的判定型，没写进 xlsx")),
    }
}

fn number_cell_rule(
    op: &str,
    v1: &str,
    v2: &str,
) -> Option<ConditionalFormatCellRule<ConditionalFormatValue>> {
    let a = cell_operand(v1);
    // 「介于」必须有第二个端点，缺了就不能只写一半（半个区间在 Excel 里是另一回事）
    let b = || (!v2.trim().is_empty()).then(|| cell_operand(v2));
    Some(match op {
        "between" => ConditionalFormatCellRule::Between(a, b()?),
        "notBetween" => ConditionalFormatCellRule::NotBetween(a, b()?),
        "equal" => ConditionalFormatCellRule::EqualTo(a),
        "notEqual" => ConditionalFormatCellRule::NotEqualTo(a),
        "greaterThan" => ConditionalFormatCellRule::GreaterThan(a),
        "greaterThanOrEqual" => ConditionalFormatCellRule::GreaterThanOrEqualTo(a),
        "lessThan" => ConditionalFormatCellRule::LessThan(a),
        "lessThanOrEqual" => ConditionalFormatCellRule::LessThanOrEqualTo(a),
        _ => return None,
    })
}

/// 数值判定的操作数：字面量归字面量，`$B$2` 这一类按公式落进 `<formula>`
fn cell_operand(v: &str) -> ConditionalFormatValue {
    if is_ref(v) {
        return ConditionalFormatValue::from(Formula::new(v));
    }
    match number_of(v) {
        Some(n) => ConditionalFormatValue::from(n),
        None => ConditionalFormatValue::from(v),
    }
}

fn date_rule(op: &str) -> Option<ConditionalFormatDateRule> {
    Some(match op {
        "yesterday" => ConditionalFormatDateRule::Yesterday,
        "today" => ConditionalFormatDateRule::Today,
        "tomorrow" => ConditionalFormatDateRule::Tomorrow,
        "last7Days" => ConditionalFormatDateRule::Last7Days,
        "lastWeek" => ConditionalFormatDateRule::LastWeek,
        "thisWeek" => ConditionalFormatDateRule::ThisWeek,
        "nextWeek" => ConditionalFormatDateRule::NextWeek,
        "lastMonth" => ConditionalFormatDateRule::LastMonth,
        "thisMonth" => ConditionalFormatDateRule::ThisMonth,
        "nextMonth" => ConditionalFormatDateRule::NextMonth,
        _ => return None,
    })
}

/// 高亮的 dxf：底纹 + 字色 + 粗斜下划线删除线；什么都没带就不设格式（只当判定用）
fn dxf_format(cf: &CondFormatPayload) -> Option<Format> {
    let s = cf.fmt.as_ref()?;
    let mut f = Format::new();
    let mut any = false;
    if let Some(bg) = &s.bg {
        f = f.set_background_color(Color::from(bg.as_str()));
        any = true;
    }
    if let Some(cl) = &s.cl {
        f = f.set_font_color(Color::from(cl.as_str()));
        any = true;
    }
    if s.bl.unwrap_or(false) {
        f = f.set_bold();
        any = true;
    }
    if s.it.unwrap_or(false) {
        f = f.set_italic();
        any = true;
    }
    if s.ul.unwrap_or(false) {
        f = f.set_underline(FormatUnderline::Single);
        any = true;
    }
    if s.st.unwrap_or(false) {
        f = f.set_font_strikethrough();
        any = true;
    }
    any.then_some(f)
}

// ================= 读侧：xlsx → 规则载荷 =================

#[derive(Default, Debug)]
pub struct SheetRulesRead {
    pub filter: Option<SheetFilterPayload>,
    pub data_validations: Vec<DataValidationPayload>,
    pub cond_formats: Vec<CondFormatPayload>,
    /// 读侧的边界账：格式里有、我们的模型装不下的东西（打开时要说得出，不是静默少给）
    pub notes: Vec<String>,
}

/// `cfRule` 的临时态：判定值与档位住在子元素里，要等元素关闭才拼得出完整载荷
#[derive(Default)]
struct CfCur {
    rule: CondFormatPayload,
    /// OOXML 的 cfRule/@type，决定子元素怎么摆
    ty: String,
    /// 基础规则里的 `<x14:id>`：数据条的负色与渐变只写在表末尾的 x14 扩展里，靠它认回来
    guid: String,
    /// cfvo：(type, 值, 是否"严格大于")
    cfvos: Vec<(String, Option<Value>, bool)>,
    colors: Vec<String>,
    formulas: Vec<String>,
    /// 区域里读不懂的片段（整列引用这类），拼完规则一起记账
    bad: Vec<String>,
}

/// 读一张表的三类规则。`hidden_rows` 用来把"被筛掉的行"从"手工藏起来的行"里分出来
/// （两者在文件里同形）；`dxfs` 是 styles.xml 的条件格式样式表，`cfRule/@dxfId` 按下标取。
pub fn read_sheet_rules(xml: &str, hidden_rows: &[u32], dxfs: &[CondFormatStyle]) -> SheetRulesRead {
    let mut out = SheetRulesRead::default();
    let mut reader = Reader::from_str(xml);
    let mut af: Option<RangeRect> = None;
    let mut fcols: Vec<FilterColumnPayload> = Vec::new();
    let mut fc: Option<FilterColumnPayload> = None;
    let mut citems: Vec<CustomFilterItem> = Vec::new();
    let mut cand = false;
    let mut dv: Option<DataValidationPayload> = None;
    let mut cur = CfCur::default();
    // `<conditionalFormatting>` 的 sqref 是**一组**规则的公共区域，一个子规则关不掉它，
    // 所以要留到 cfRule 头上再分下去（早先跟着 cur 一起被下一条规则覆盖，结果条条"没有区域"）
    let mut block: (Vec<RangeRect>, Vec<String>) = (Vec::new(), Vec::new());
    // `<ext>` 里是 x14 的复制品，整块跳过，否则同一条规则会读两遍（GUID 除外，它只住在那儿）
    let mut ext = 0usize;
    // 数据条的负色与渐变只写在表末尾的 x14 扩展里：先记下 GUID → 规则下标，第二趟认回来
    let mut bar_ids: Vec<(String, usize)> = Vec::new();
    let mut want = String::new();
    let mut buf = String::new();

    while let Ok(ev) = reader.read_event() {
        match &ev {
            Event::Start(e) | Event::Empty(e) => {
                let nm = owned_name(e.local_name().as_ref());
                let opened = matches!(ev, Event::Start(_));
                if nm == "ext" {
                    if opened {
                        ext += 1;
                    }
                    continue;
                }
                if ext > 0 {
                    if opened && nm == "id" {
                        want = "id".into();
                        buf.clear();
                    }
                    continue;
                }
                match nm.as_str() {
                    "autoFilter" => {
                        let (r, bad) = first_rect(&attr_str(e, "ref").unwrap_or_default());
                        if !bad.is_empty() {
                            note(&mut out.notes, "筛选区里有读不懂的区域片段，按能认的部分收");
                        }
                        af = r;
                        if !opened {
                            close_filter(&mut out, af, std::mem::take(&mut fcols));
                        }
                    }
                    "filterColumn" => {
                        // colId 相对筛选区首列，载荷里是绝对列号
                        let off = attr_str(e, "colId").and_then(|v| v.parse::<u32>().ok()).unwrap_or(0);
                        fc = Some(FilterColumnPayload {
                            col: af.map(|r| r.start_column + off).unwrap_or(off),
                            ..Default::default()
                        });
                        if !opened {
                            if let Some(c) = fc.take() {
                                fcols.push(c);
                            }
                        }
                    }
                    "filters" => {
                        if flag(e, "blank", false) {
                            if let Some(c) = &mut fc {
                                c.blank = Some(true);
                            }
                        }
                    }
                    "filter" if fc.is_some() => {
                        let v = attr_str(e, "val").unwrap_or_default();
                        let Some(c) = &mut fc else { continue };
                        if v.is_empty() {
                            c.blank = Some(true);
                        } else {
                            c.list.get_or_insert_with(Vec::new).push(v);
                        }
                    }
                    "customFilters" => {
                        cand = flag(e, "and", false);
                        citems.clear();
                    }
                    "customFilter" => citems.push(custom_item(
                        attr_str(e, "operator").as_deref(),
                        &attr_str(e, "val").unwrap_or_default(),
                    )),
                    "colorFilters" => note(&mut out.notes, "有条按颜色筛选的条件界面暂不能还原"),
                    "dataValidation" => {
                        dv = Some(dv_from_attrs(e, &mut out.notes));
                        if !opened {
                            close_validation(&mut out, dv.take());
                        }
                    }
                    "formula1" | "formula2" if opened => {
                        want = nm.clone();
                        buf.clear();
                    }
                    "conditionalFormatting" => {
                        block = rects_of(attr_str(e, "sqref").as_deref().unwrap_or(""));
                    }
                    "cfRule" => {
                        cur = cf_start(e, dxfs, &mut out.notes);
                        cur.rule.ranges = block.0.clone();
                        cur.bad = block.1.clone();
                        if !opened {
                            close_cf(&mut out, std::mem::take(&mut cur), &mut bar_ids);
                        }
                    }
                    "formula" if opened && !cur.ty.is_empty() => {
                        want = "formula".into();
                        buf.clear();
                    }
                    "dataBar" | "iconSet" => {
                        // 「只显条不显值」与图标家族名挂在内层元素上，不在 cfRule 头上：
                        // `<cfRule type="dataBar"><dataBar showValue="0">`、`<iconSet iconSet="3Arrows">`
                        if !flag(e, "showValue", true) {
                            cur.rule.show_value = Some(false);
                        }
                        if nm == "iconSet" {
                            if let Some(f) = attr_str(e, "iconSet") {
                                cur.rule.icon_style = Some(f);
                            }
                        }
                    }
                    "cfvo" => {
                        let t = norm_cfvo(attr_str(e, "type").as_deref().unwrap_or("num"));
                        let raw = attr_str(e, "val").unwrap_or_default();
                        // min/max/auto 的 val 是占位（crate 一律写 0），留着只会让界面显示个假数字
                        let v = if matches!(t.as_str(), "min" | "max" | "auto") {
                            None
                        } else {
                            num_or_text(&raw)
                        };
                        cur.cfvos.push((t, v, !flag(e, "gte", true)));
                    }
                    "color" => {
                        if let Some(hex) = attr_str(e, "rgb").as_deref().and_then(argb_to_hex) {
                            cur.colors.push(hex);
                        }
                    }
                    _ => {}
                }
            }
            Event::Text(t) if !want.is_empty() => buf.push_str(t.as_ref()),
            Event::GeneralRef(r) if !want.is_empty() => {
                buf.push('&');
                buf.push_str(r.as_ref());
                buf.push(';');
            }
            Event::End(e) => {
                let nm = owned_name(e.local_name().as_ref());
                // 文本先结算再谈结构：`<x14:id>` 住在 ext 里，按 ext 跳过就永远取不回 GUID
                if !want.is_empty() && want == nm {
                    let text = unescape(&buf);
                    match want.as_str() {
                        "formula1" => {
                            if let Some(d) = &mut dv {
                                d.f1 = Some(text);
                            }
                        }
                        "formula2" => {
                            if let Some(d) = &mut dv {
                                d.f2 = Some(text);
                            }
                        }
                        "id" => cur.guid = text.trim().to_string(),
                        _ => cur.formulas.push(text),
                    }
                    want.clear();
                    buf.clear();
                }
                if nm == "ext" {
                    ext = ext.saturating_sub(1);
                    continue;
                }
                if ext > 0 {
                    continue;
                }
                match nm.as_str() {
                    "autoFilter" => close_filter(&mut out, af, std::mem::take(&mut fcols)),
                    "filterColumn" => {
                        if let Some(c) = fc.take() {
                            fcols.push(c);
                        }
                    }
                    "customFilters" => {
                        if let Some(c) = &mut fc {
                            c.custom = Some(CustomFilters {
                                and: Some(cand),
                                items: std::mem::take(&mut citems),
                            });
                        }
                    }
                    "dataValidation" => close_validation(&mut out, dv.take()),
                    "cfRule" => close_cf(&mut out, std::mem::take(&mut cur), &mut bar_ids),
                    _ => {}
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }

    // 数据条的负色与渐变只在 x14 扩展里出现，第二趟小扫描按 GUID 认回来
    for (guid, grad, neg) in x14_bars(xml) {
        let Some((_, i)) = bar_ids.iter().find(|(g, _)| *g == guid) else { continue };
        let Some(bar) = out.cond_formats[*i].bar.as_mut() else { continue };
        if grad.is_some() {
            bar.grad = grad;
        }
        if neg.is_some() {
            bar.neg = neg;
        }
    }
    if let (Some(r), Some(f)) = (af, out.filter.as_mut()) {
        let hits: Vec<u32> = hidden_rows
            .iter()
            .copied()
            .filter(|x| *x > r.start_row && *x <= r.end_row)
            .collect();
        if !hits.is_empty() {
            f.filtered_out = Some(hits);
        }
    }
    out
}

// ---------------- 读侧：公用换算 ----------------

fn owned_name(b: &str) -> String {
    b.to_string()
}

/// OOXML 的布尔属性：写了即真（除非 val="0"/"false"），没写按 `d` 办
fn flag(e: &quick_xml::events::BytesStart<'_>, key: &str, d: bool) -> bool {
    match attr_str(e, key).as_deref() {
        None => d,
        Some(v) => !(v == "0" || v.eq_ignore_ascii_case("false")),
    }
}

fn unescape(s: &str) -> String {
    quick_xml::escape::unescape(s)
        .map(|c| c.into_owned())
        .unwrap_or_else(|_| s.to_string())
}

/// `A1:B2 C3:D4` 这种多块区域（sqref/ref 的通用形状）。`$` 只是相对/绝对标记，不是列名的一部分。
/// 读不懂的片段（整列引用 `A:A` 这类）原样交回，由调用方记账——不猜一个区域来冒充
fn rects_of(s: &str) -> (Vec<RangeRect>, Vec<String>) {
    let mut rects = Vec::new();
    let mut bad = Vec::new();
    for part in s.split_whitespace() {
        let cleaned = part.replace('$', "");
        let (a, b) = match cleaned.split_once(':') {
            Some((x, y)) => (x, y),
            None => (cleaned.as_str(), cleaned.as_str()),
        };
        match (a1_to_rc(a), a1_to_rc(b)) {
            (Some((r1, c1)), Some((r2, c2))) => rects.push(RangeRect {
                start_row: r1.min(r2),
                start_column: c1.min(c2),
                end_row: r1.max(r2),
                end_column: c1.max(c2),
            }),
            _ => bad.push(part.to_string()),
        }
    }
    (rects, bad)
}

fn first_rect(s: &str) -> (Option<RangeRect>, Vec<String>) {
    let (r, bad) = rects_of(s);
    (r.into_iter().next(), bad)
}

/// 档位值有两种形状：数字与公式文本（Univer 两边都吃原样）
fn num_or_text(s: &str) -> Option<Value> {
    let t = s.trim();
    if t.is_empty() {
        return None;
    }
    if let Ok(n) = t.parse::<f64>() {
        if n.is_finite() {
            return if n.fract() == 0.0 {
                Some(Value::from(n as i64))
            } else {
                serde_json::Number::from_f64(n).map(Value::Number)
            };
        }
    }
    Some(Value::String(t.to_string()))
}

/// crate 的 Lowest/Highest 落盘是 min/max，Automatic 落盘是 autoMin/autoMax——读回来收成一个
fn norm_cfvo(t: &str) -> String {
    match t {
        "autoMin" | "autoMax" | "automatic" => "auto",
        "num" | "percent" | "percentile" | "formula" | "min" | "max" => t,
        _ => "num",
    }
    .to_string()
}

fn is_empty_style(s: &CondFormatStyle) -> bool {
    s.bg.is_none() && s.cl.is_none() && s.bl.is_none() && s.it.is_none() && s.ul.is_none() && s.st.is_none()
}

/// `"甲,乙,丙"` → 裸串（list 的候选值在 OOXML 里是一段带引号的文本，Univer 要的是逗号串）
fn unquote(s: &str) -> String {
    let t = s.trim();
    match t.strip_prefix('"').and_then(|x| x.strip_suffix('"')) {
        Some(inner) => inner.to_string(),
        None => t.to_string(),
    }
}

/// OOXML 的日期序列号 → `YYYY-MM-DD`（写侧 date_serial 的逆；不是数字就原样交回，
/// 别的工具会直接写日期串）
fn serial_to_date(s: &str) -> String {
    let t = s.trim();
    let Some(n) = t.parse::<f64>().ok().filter(|x| x.is_finite()) else {
        return t.to_string();
    };
    // 25569 = 1899-12-30 距 1970-01-01 的天数（序列号的历元），719468 是 Hinnant 算法的年偏移
    let z = (n.floor() as i64) - 25569 + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y0 = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y0 + 1 } else { y0 };
    format!("{y:04}-{m:02}-{d:02}")
}

/// crate 与 Excel 的自定义筛选两种形状都认：通配符装在 val 里、operator 省略即"等于"那一类
fn custom_item(op: Option<&str>, raw: &str) -> CustomFilterItem {
    let star_both = raw.starts_with('*') && raw.ends_with('*') && raw.len() > 1;
    let star_end = !star_both && raw.ends_with('*');
    let star_start = !star_both && raw.starts_with('*');
    let bare = raw.trim_matches('*');
    let known = |o: &str| {
        (
            o.to_string(),
            if matches!(
                o,
                "contains" | "notContains" | "beginsWith" | "notBeginsWith" | "endsWith" | "notEndsWith"
            ) {
                bare.to_string()
            } else {
                raw.to_string()
            },
        )
    };
    let (o, v) = match op.unwrap_or("") {
        "" if star_both => ("contains".into(), bare.into()),
        "" if star_end => ("beginsWith".into(), bare.into()),
        "" if star_start => ("endsWith".into(), bare.into()),
        "" => ("equal".into(), raw.into()),
        "notEqual" if star_both => ("notContains".into(), bare.into()),
        "notEqual" if star_end => ("notBeginsWith".into(), bare.into()),
        "notEqual" if star_start => ("notEndsWith".into(), bare.into()),
        other => known(other),
    };
    CustomFilterItem { op: Some(o), v }
}

// ---------------- 读侧：三类规则的组装 ----------------

fn close_filter(out: &mut SheetRulesRead, af: Option<RangeRect>, cols: Vec<FilterColumnPayload>) {
    let Some(range) = af else { return };
    out.filter = Some(SheetFilterPayload {
        range,
        columns: cols,
        ..Default::default()
    });
}

fn dv_from_attrs(e: &quick_xml::events::BytesStart<'_>, notes: &mut Vec<String>) -> DataValidationPayload {
    let dv_type = attr_str(e, "type").unwrap_or_default();
    if dv_type.is_empty() {
        note(notes, "有条数据验证没写类型，未读入");
    }
    DataValidationPayload {
        ranges: rects_of(attr_str(e, "sqref").as_deref().unwrap_or("")).0,
        dv_type,
        // 比较符缺省是 between（OOXML 就这么定的），list/custom 根本不带它，交回 None 由前端按类型处理
        op: attr_str(e, "operator"),
        blank: flag(e, "allowBlank", false).then_some(true),
        // showDropDown="1" 反而是"没有箭头"，而且只对 list 有意义
        dropdown: (attr_str(e, "type").as_deref() == Some("list")).then(|| !flag(e, "showDropDown", false)),
        err_style: attr_str(e, "errorStyle"),
        err_title: attr_str(e, "errorTitle"),
        err: attr_str(e, "error"),
        prompt_title: attr_str(e, "promptTitle"),
        prompt: attr_str(e, "prompt"),
        ..Default::default()
    }
}

fn close_validation(out: &mut SheetRulesRead, dv: Option<DataValidationPayload>) {
    let Some(mut d) = dv else { return };
    if d.dv_type.is_empty() {
        return;
    }
    if d.ranges.is_empty() {
        note(&mut out.notes, "有条数据验证没有作用区域，未读入");
        return;
    }
    if d.dv_type == "list" {
        d.f1 = d.f1.as_deref().map(unquote);
    }
    if d.dv_type == "date" {
        d.f1 = d.f1.as_deref().map(serial_to_date);
        d.f2 = d.f2.as_deref().map(serial_to_date);
    }
    out.data_validations.push(d);
}

fn cf_start(
    e: &quick_xml::events::BytesStart<'_>,
    dxfs: &[CondFormatStyle],
    notes: &mut Vec<String>,
) -> CfCur {
    let ty = attr_str(e, "type").unwrap_or_default();
    let mut cur = CfCur {
        ty: ty.clone(),
        ..Default::default()
    };
    let mut rule = CondFormatPayload {
        kind: "cell".into(),
        ..Default::default()
    };
    if flag(e, "stopIfTrue", false) {
        rule.stop = Some(true);
    }
    if let Some(f) = attr_str(e, "dxfId")
        .and_then(|v| v.parse::<usize>().ok())
        .and_then(|i| dxfs.get(i).cloned())
        .filter(|f| !is_empty_style(f))
    {
        rule.fmt = Some(f);
    }
    let op = attr_str(e, "operator");
    match ty.as_str() {
        "cellIs" => {
            rule.sub = Some("number".into());
            rule.op = Some(op.unwrap_or_else(|| "between".into()));
        }
        "containsText" | "notContainsText" | "notContains" | "beginsWith" | "notBeginsWith"
        | "endsWith" | "notEndsWith" => {
            rule.sub = Some("text".into());
            rule.op = Some(match ty.as_str() {
                "containsText" => "containsText",
                "notContainsText" | "notContains" => "notContains",
                "beginsWith" => "beginsWith",
                "notBeginsWith" => "notBeginsWith",
                "endsWith" => "endsWith",
                _ => "notEndsWith",
            }
            .into());
            rule.v1 = attr_str(e, "text").map(Value::String);
        }
        "containsBlanks" | "notContainsBlanks" => {
            // 空/非空在界面里就是"文本等于空串"那一档（前端 whenCellEmpty 走的是同一条路）
            rule.sub = Some("text".into());
            rule.op = Some(if ty == "containsBlanks" { "equal" } else { "notEqual" }.into());
            rule.v1 = Some(Value::String(String::new()));
        }
        "timePeriod" => {
            rule.sub = Some("timePeriod".into());
            match attr_str(e, "timePeriod") {
                Some(t) => rule.op = Some(t),
                None => note(notes, "有条日期条件格式没写时段，未读入"),
            }
        }
        "top10" => {
            rule.sub = Some("rank".into());
            let bottom = flag(e, "bottom", false);
            let percent = flag(e, "percent", false);
            rule.op = Some(match (bottom, percent) {
                (false, false) => "top",
                (true, false) => "bottom",
                (false, true) => "topPercent",
                (true, true) => "bottomPercent",
            }
            .into());
            rule.v1 = attr_str(e, "rank").as_deref().and_then(num_or_text);
        }
        "aboveAverage" | "belowAverage" => {
            rule.sub = Some("average".into());
            let above = flag(e, "aboveAverage", ty == "aboveAverage");
            let equal = flag(e, "equalAverage", false);
            rule.op = Some(match (above, equal) {
                (true, true) => "greaterThanOrEqual",
                (true, false) => "greaterThan",
                (false, true) => "lessThanOrEqual",
                (false, false) => "lessThan",
            }
            .into());
        }
        "duplicateValues" => rule.sub = Some("duplicateValues".into()),
        "uniqueValues" => rule.sub = Some("uniqueValues".into()),
        "expression" => rule.sub = Some("formula".into()),
        "colorScale" => rule.kind = "colorScale".into(),
        "dataBar" => rule.kind = "dataBar".into(),
        "iconSet" => {
            rule.kind = "iconSet".into();
            // 家族名的缺省就是三盏灯（OOXML 把缺省值留在规格里，不写进文件），
            // 真写了 `<iconSet iconSet="…">` 由上面那条覆盖
            rule.icon_style = Some("3TrafficLights1".into());
        }
        "containsErrors" | "notContainsErrors" => {
            note(notes, "有条错误值条件格式界面暂不能还原，未读入");
            cur.ty.clear();
        }
        other => {
            notes.push(format!("有条条件格式（{other}）是我们认不出的判定型，未读入"));
            cur.ty.clear();
        }
    }
    if rule.kind == "cell" && rule.sub.is_none() && !cur.ty.is_empty() {
        note(notes, "有条条件格式（cell）没写判定子型，未读入");
        cur.ty.clear();
    }
    cur.rule = rule;
    cur
}

fn close_cf(
    out: &mut SheetRulesRead,
    mut cur: CfCur,
    bar_ids: &mut Vec<(String, usize)>,
) {
    if cur.ty.is_empty() {
        return;
    }
    let mut rule = std::mem::take(&mut cur.rule);
    if !cur.bad.is_empty() {
        out.notes.push(format!(
            "有条条件格式的区域里 {} 段读不懂（整列引用这类），只按能认的部分收",
            cur.bad.len()
        ));
    }
    if rule.ranges.is_empty() {
        note(&mut out.notes, "有条条件格式没有作用区域，未读入");
        return;
    }
    let first_formula = || cur.formulas.first().cloned().unwrap_or_default();
    match cur.ty.as_str() {
        "cellIs" => {
            // 判定值在 formula 里。带引号的串是"文本等于"——OOXML 没有文本等于的规则型，
            // Excel 自己就这么写，所以子型在这里才定得下来
            let a = first_formula();
            match a.strip_prefix('"').and_then(|x| x.strip_suffix('"')) {
                Some(inner) => {
                    rule.sub = Some("text".into());
                    rule.v1 = Some(Value::String(inner.to_string()));
                }
                None => {
                    rule.v1 = num_or_text(&a);
                    rule.v2 = cur.formulas.get(1).and_then(|s| num_or_text(s));
                }
            }
        }
        "expression" => rule.v1 = Some(Value::String(first_formula())),
        "colorScale" => {
            if cur.cfvos.len() < 2 || cur.cfvos.len() != cur.colors.len() {
                note(&mut out.notes, "有条色阶的档位与颜色数不配对，未读入");
                return;
            }
            if cur.cfvos.len() > 3 {
                note(&mut out.notes, "有条色阶超过三档，只收了前三档");
            }
            rule.scale = Some(
                cur.cfvos
                    .iter()
                    .zip(cur.colors.iter())
                    .map(|((t, v, _), c)| CondFormatStop {
                        color: c.clone(),
                        t: t.clone(),
                        v: v.clone(),
                    })
                    .collect(),
            );
        }
        "dataBar" => {
            if cur.cfvos.len() < 2 || cur.colors.is_empty() {
                note(&mut out.notes, "有条数据条缺了两端或颜色，未读入");
                return;
            }
            let edge = |(t, v, _): &(String, Option<Value>, bool)| CondFormatBarStop {
                t: t.clone(),
                v: v.clone(),
            };
            rule.bar = Some(CondFormatBar {
                min: edge(&cur.cfvos[0]),
                max: edge(&cur.cfvos[1]),
                pos: cur.colors[0].clone(),
                neg: None,
                grad: None,
            });
        }
        "iconSet" => {
            if cur.cfvos.len() < 2 {
                note(&mut out.notes, "有条图标集档位不足两档，未读入");
                return;
            }
            // OOXML 的 cfvo 是低→高，载荷与界面都是高→低
            rule.icons = Some(
                cur.cfvos
                    .iter()
                    .rev()
                    .map(|(t, v, gt)| CondFormatIconLevel {
                        op: if *gt { "greaterThan" } else { "greaterThanOrEqual" }.into(),
                        t: t.clone(),
                        v: v.clone(),
                    })
                    .collect(),
            );
        }
        _ => {}
    }
    let idx = out.cond_formats.len();
    out.cond_formats.push(rule);
    if !cur.guid.is_empty() {
        bar_ids.push((cur.guid.clone(), idx));
    }
}

/// 表末尾 `<ext uri="{78C0D931-…}">` 里的 x14 数据条设置：负色与渐变只有这一份。
/// 基础规则里没有这两项，所以按 `<x14:id>` 的 GUID 认回那条 dataBar
fn x14_bars(xml: &str) -> Vec<(String, Option<bool>, Option<String>)> {
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(p) = rest.find("<x14:cfRule") {
        let after = &rest[p..];
        let end = after.find("</x14:cfRule>").unwrap_or(after.len());
        let block = &after[..end];
        let guid = tag_attr(block, "id").unwrap_or_default();
        let grad = tag_attr(block, "gradient").map(|v| v != "0");
        let neg = block
            .find("x14:negativeFillColor")
            .and_then(|i| argb_to_hex(tag_attr(&block[i..], "rgb")?.as_str()).map(Some))
            .unwrap_or(None);
        if !guid.is_empty() && (grad.is_some() || neg.is_some()) {
            out.push((guid, grad, neg));
        }
        rest = &after[end..];
    }
    out
}

/// 从一段 XML 的下一个 `<…>` 里取属性值（只为 x14 那一小块而写，不走 XML 解析器）
fn tag_attr(tag: &str, key: &str) -> Option<String> {
    let pat = format!("{key}=\"");
    let i = tag.find(&pat)? + pat.len();
    let j = tag[i..].find('"')?;
    Some(tag[i..i + j].to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 日期换算得有绝对锚点：只验"写出去再读回来"的话，历元整个偏掉 140 年也照样对得上
    #[test]
    fn date_conversions_have_anchors() {
        assert_eq!(date_serial("2026-01-01"), Some(46023.0));
        assert_eq!(serial_to_date("46023"), "2026-01-01");
        assert_eq!(serial_to_date("36526"), "2000-01-01");
        assert_eq!(serial_to_date("45292"), "2024-01-01");
        assert_eq!(serial_to_date("45351"), "2024-02-29", "闰日");
        assert_eq!(serial_to_date("46023.75"), "2026-01-01", "带时刻的序列号取日历天");
        assert_eq!(
            serial_to_date("2026-01-01"),
            "2026-01-01",
            "别的工具直接写日期串，原样交回而不是解成 1899 年"
        );
    }

    #[test]
    fn sqref_shapes_split_into_rects() {
        let (r, bad) = rects_of("$B$2:$D$6 F8");
        assert_eq!(r, vec![rc(1, 1, 5, 3), rc(7, 5, 7, 5)], "$ 只是绝对标记，单格也算一块");
        assert!(bad.is_empty());
        let (r, bad) = rects_of("A:A C5");
        assert_eq!(r, vec![rc(4, 2, 4, 2)], "整列引用不猜区域");
        assert_eq!(bad, vec!["A:A".to_string()]);
    }

    #[test]
    fn wildcard_custom_filters_fall_back() {
        // crate 的"包含"落盘是 `val="*甲*"` 且不带 operator，读回来要退化成 contains
        assert_eq!(custom_item(None, "*甲*").op.as_deref(), Some("contains"));
        assert_eq!(custom_item(None, "*甲*").v, "甲");
        assert_eq!(custom_item(None, "开*").op.as_deref(), Some("beginsWith"));
        assert_eq!(custom_item(None, "*尾").op.as_deref(), Some("endsWith"));
        assert_eq!(custom_item(Some("notEqual"), "*甲*").op.as_deref(), Some("notContains"));
        assert_eq!(custom_item(None, "等于").op.as_deref(), Some("equal"));
        assert_eq!(custom_item(None, "等于").v, "等于", "没有通配符就别剥字符");
        assert_eq!(custom_item(Some("lessThan"), "5").op.as_deref(), Some("lessThan"));
        assert_eq!(custom_item(Some("lessThan"), "5").v, "5");
    }

    #[test]
    fn cfvo_types_collapse() {
        assert_eq!(norm_cfvo("autoMin"), "auto");
        assert_eq!(norm_cfvo("autoMax"), "auto");
        assert_eq!(norm_cfvo("percentile"), "percentile");
        assert_eq!(norm_cfvo("未知的那种"), "num", "认不出的退成数值档而不是留个野值");
    }

    fn rc(start_row: u32, start_column: u32, end_row: u32, end_column: u32) -> RangeRect {
        RangeRect { start_row, start_column, end_row, end_column }
    }
}
