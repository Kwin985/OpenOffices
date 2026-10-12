use calamine::{open_workbook_auto, Data, Reader};
use rust_xlsxwriter::{Color, Format, Workbook};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;

use crate::xlsx_cell_side;
use crate::xlsx_chart;
use crate::xlsx_names;
use crate::xlsx_print;
use crate::xlsx_style;

fn is_false(v: &bool) -> bool {
    !*v
}

/// 单元格边框的一条边：s 为 OOXML 样式名（thin/medium/dashed/...），c 为 #rrggbb
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BorderSide {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub s: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub c: Option<String>,
}

impl BorderSide {
    pub(crate) fn is_empty(&self) -> bool {
        self.s.is_none() && self.c.is_none()
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CellBorder {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub t: Option<BorderSide>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r: Option<BorderSide>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub b: Option<BorderSide>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub l: Option<BorderSide>,
}

impl CellBorder {
    pub(crate) fn is_empty(&self) -> bool {
        self.t.as_ref().is_none_or(BorderSide::is_empty)
            && self.r.as_ref().is_none_or(BorderSide::is_empty)
            && self.b.as_ref().is_none_or(BorderSide::is_empty)
            && self.l.as_ref().is_none_or(BorderSide::is_empty)
    }
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
    /// 字体族名（默认 Calibri/等线 不写入，减噪）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ff: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cl: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bg: Option<String>,
    /// 四边边框
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bd: Option<CellBorder>,
    /// 水平对齐：left|center|right|justify
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ho: Option<String>,
    /// 垂直对齐：top|middle|bottom
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vo: Option<String>,
    /// 自动换行
    #[serde(default, skip_serializing_if = "is_false")]
    pub wb: bool,
    /// 数字格式模式串（如 #,##0.00、0.00%、@）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nf: Option<String>,
}

impl CellStyle {
    pub fn has_any(&self) -> bool {
        self.bl
            || self.it
            || self.fs.is_some()
            || self.ff.is_some()
            || self.cl.is_some()
            || self.bg.is_some()
            || self.bd.as_ref().is_some_and(|b| !b.is_empty())
            || self.ho.is_some()
            || self.vo.is_some()
            || self.wb
            || self.nf.is_some()
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
    /// 组合图：本系列自己的图型。仅在**与主图型不同**时填（`None` = 随主图型），
    /// 于是「单一图型」的载荷与 v0.123 之前逐字同形，只有真组合图才多出这个字段
    #[serde(default)]
    pub chart_type: Option<String>,
    /// 组合图次轴：本系列画在右值轴上（量纲差得远的那条）。读侧由 `<c:axId>` 引用的第几根值轴定
    #[serde(default)]
    pub secondary_axis: bool,
}

/// 一根轴（`c:valAx`/`c:catAx`/`c:dateAx`）。只记"说了话"的字段，没说的留给写侧/渲染侧各自的默认
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChartAxis {
    /// `<c:axId>`：与 chart 元素引用的 id 对得上，主/次就是按值轴出现次序定的
    pub id: String,
    /// "cat"（含 dateAx）| "val"
    pub kind: String,
    /// `<c:axPos>`：b|l|r|t。散点图两根都是值轴，靠它分出哪根是 X、哪根是 Y
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub pos: String,
    /// 轴标题（轴自己的 `<c:title>`，不是图表标题）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
    /// `<c:logBase>`，Excel 通常 10；有它就是对数刻度
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub log_base: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub major_unit: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub minor_unit: Option<f64>,
    /// 显示单位：`<c:builtInUnit>` 的 thousands/millions…，或 `<c:custUnit>` 的自定义数字串
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_unit: Option<String>,
    /// `<c:numFmt formatCode>`（sourceLinked=1 时是"跟随源数据"，不算数）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub num_format: Option<String>,
    /// `<c:orientation val="maxMin">`：刻度倒着走
    #[serde(default)]
    pub reverse: bool,
    /// `<c:delete val="1">`：整根轴不显示
    #[serde(default)]
    pub hidden: bool,
}

impl ChartAxis {
    /// 这根轴有没有"说了话"：全默认的轴不进载荷，免得给朴素图表平白多出一串字段
    pub(crate) fn speaks(&self) -> bool {
        self.title.is_some()
            || self.min.is_some()
            || self.max.is_some()
            || self.log_base.is_some()
            || self.major_unit.is_some()
            || self.minor_unit.is_some()
            || self.display_unit.is_some()
            || self.num_format.is_some()
            || self.reverse
            || self.hidden
    }
}

/// 图表载荷：column|bar|line|pie|doughnut|area|radar|scatter|stock 九类；grouping 为 standard|stacked|percentStacked
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChartPayload {
    pub chart_type: String,
    #[serde(default)]
    pub grouping: String,
    #[serde(default)]
    pub title: String,
    /// 仅 radar 用：radarStyle 的 standard|marker|filled（其余类型为 None）
    #[serde(default)]
    pub radar_style: Option<String>,
    /// 仅 scatter 用：scatterStyle 的 marker|line|lineMarker|smooth|smoothMarker（其余类型为 None）
    #[serde(default)]
    pub scatter_style: Option<String>,
    pub anchor_row: u32,
    pub anchor_col: u32,
    pub width: u32,
    pub height: u32,
    /// 轴：类目轴与值轴各按出现次序排（值轴第 0 根是主、之后是次）。整根没说话就不带这一项
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub axes: Vec<ChartAxis>,
    pub series: Vec<ChartSeries>,
}

use crate::xlsx_rules::write_sheet_rules;

/// 冻结窗格：顶部 rows 行 + 左侧 cols 列
#[derive(Serialize, Deserialize, Clone, Copy, Default)]
#[serde(rename_all = "camelCase")]
pub struct Freeze {
    pub rows: u32,
    pub cols: u32,
}

/// 单元格区：0 基、含端点（与前端 RangeRect / Univer IRange 同形，不带 unitId 这类运行时标识）
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RangeRect {
    pub start_row: u32,
    pub start_column: u32,
    pub end_row: u32,
    pub end_column: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct CustomFilterItem {
    /// OOXML 的 customFilter 算子字面（equal/greaterThan/…），不认的原样带过
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub op: Option<String>,
    #[serde(default)]
    pub v: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct CustomFilters {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub and: Option<bool>,
    #[serde(default)]
    pub items: Vec<CustomFilterItem>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct FilterColumnPayload {
    /// 绝对列号（与 Univer 的存法一致）；OOXML 的 filterColumn colId 相对筛选区首列，换算在写侧
    pub col: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blank: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub list: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom: Option<CustomFilters>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct SheetFilterPayload {
    #[serde(rename = "ref")]
    pub range: RangeRect,
    #[serde(default)]
    pub columns: Vec<FilterColumnPayload>,
    /// 当前被筛掉的行号（绝对行）。Univer 按条件现算，只喂打印——OOXML/ODF 里没有这个字段的位置
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filtered_out: Option<Vec<u32>>,
}

/// 数据验证：type/op 直接采用 OOXML 字面（whole/decimal/list/date/textLength/custom + between/equal/…）
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct DataValidationPayload {
    pub ranges: Vec<RangeRect>,
    #[serde(rename = "type")]
    pub dv_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub op: Option<String>,
    /// OOXML formula1：list 存 `"甲,乙,丙"` 或区域引用，custom 存表达式
    #[serde(rename = "f1", default, skip_serializing_if = "Option::is_none")]
    pub f1: Option<String>,
    #[serde(rename = "f2", default, skip_serializing_if = "Option::is_none")]
    pub f2: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blank: Option<bool>,
    /// list 的下拉箭头；OOXML 的 showDropDown="1" 反而是"没有箭头"，换算在写侧
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dropdown: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub err_style: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub err_title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub err: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
}

/// 条件格式的突出显示样式（dxf 的可用子集）
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct CondFormatStyle {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bg: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cl: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bl: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub it: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ul: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub st: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct CondFormatStop {
    pub color: String,
    /// OOXML 的 cfvo type：num/min/max/percent/percentile/formula（第三方件里的未知值原样带过）
    pub t: String,
    #[serde(rename = "v", default, skip_serializing_if = "Option::is_none")]
    pub v: Option<Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct CondFormatBarStop {
    pub t: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub v: Option<Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct CondFormatIconLevel {
    pub op: String,
    pub t: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub v: Option<Value>,
}

/// 条件格式一条规则。数组顺序即优先级（高优先级在前），与 OOXML 的 cfRule 顺序同向
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct CondFormatPayload {
    pub ranges: Vec<RangeRect>,
    /// cell / colorScale / dataBar / iconSet
    pub kind: String,
    /// kind=cell：number/text/timePeriod/rank/average/uniqueValues/duplicateValues/formula
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sub: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub op: Option<String>,
    #[serde(rename = "v1", default, skip_serializing_if = "Option::is_none")]
    pub v1: Option<Value>,
    #[serde(rename = "v2", default, skip_serializing_if = "Option::is_none")]
    pub v2: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fmt: Option<CondFormatStyle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale: Option<Vec<CondFormatStop>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bar: Option<CondFormatBar>,
    /// OOXML 的 iconSet 家族名（3TrafficLights1 / 4Arrows / …）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_style: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icons: Option<Vec<CondFormatIconLevel>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_value: Option<bool>,
    /// OOXML 的 stopIfTrue
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stop: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct CondFormatBar {
    pub min: CondFormatBarStop,
    pub max: CondFormatBarStop,
    /// 正值条颜色
    pub pos: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub neg: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grad: Option<bool>,
}

/// 单元格批注。legacy comments（xl/commentsN.xml）与 threadedComments 归一成同一形状：
/// 作者与正文分开存，不抄 Excel 写在正文里的那行「作者:」前缀
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct CellNotePayload {
    pub r: u32,
    pub c: u32,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    /// 气泡宽高（像素，与 Univer 同单位）；缺省按 Excel 的 128×74
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show: Option<bool>,
}

/// 单元格超链接：url（外部地址）与 location（本簿内跳转 "表名!A1"）二选一，tip 是悬停提示
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct CellLinkPayload {
    pub r: u32,
    pub c: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tip: Option<String>,
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
    /// 列号 → 宽度像素（与 Univer 快照同单位；xlsx 字符宽/pt 在文件边界换算）
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub col_widths: HashMap<u32, f64>,
    /// 行号 → 高度像素
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub row_heights: HashMap<u32, f64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hidden_rows: Vec<u32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hidden_cols: Vec<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub freeze: Option<Freeze>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter: Option<SheetFilterPayload>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub data_validations: Vec<DataValidationPayload>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cond_formats: Vec<CondFormatPayload>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub notes: Vec<CellNotePayload>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub links: Vec<CellLinkPayload>,
    /// 打印设置：页面/纸张/页眉页脚/分页符/打印区域/重复标题行。Univer 模型装不下，两头纯换算
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub print: Option<SheetPrintPayload>,
    /// 工作表格式那一层（`sheetFormatPr`）：Univer 里那一枚 `defaultRowHeight` 是**活口**（喂进去屏幕就按
    /// 一个 Excel 忽略的数排版），所以它照 `print` 走侧通道，只在存盘那趟原样落回字节
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sheet_format: Option<SheetFormat>,
}

/// 页眉/页脚的一条：OOXML 就存一条串，里头用 `&L`/`&C`/`&R` 分左中右三段，
/// `&A` 表名、`&P`/`&N` 页码/总页、`&D` 日期、`&F` 文件名。crate 只有 odd 通道，
/// even/first 与两个开关（differentOddEven/differentFirst）交给存盘时的定点重打包补
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct PrintHfPayload {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub odd: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub even: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first: Option<String>,
}

/// 页面边距（英寸浮点，与 OOXML `<pageMargins>` 同单位；Excel 写出的值常带 0.449999… 这种噪点，原样收）
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct PrintMarginsPayload {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub top: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub right: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bottom: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub left: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub header: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub footer: Option<f64>,
}

/// OOXML 的那一档默认边距（Excel 新建表就是这六个数，rust_xlsxwriter 没人吩咐时也写这一档）
pub const DEFAULT_PRINT_MARGINS: (f64, f64, f64, f64, f64, f64) = (0.7, 0.7, 0.75, 0.75, 0.3, 0.3);

impl PrintMarginsPayload {
    /// 六档全都停在默认值上（或干脆没写）——这种边距不携带任何信息
    pub fn is_all_default(&self) -> bool {
        let (l, r, t, b, h, f) = DEFAULT_PRINT_MARGINS;
        let same = |v: Option<f64>, d: f64| v.is_none_or(|x| (x - d).abs() < 1e-9);
        same(self.left, l)
            && same(self.right, r)
            && same(self.top, t)
            && same(self.bottom, b)
            && same(self.header, h)
            && same(self.footer, f)
    }
}

/// 一张表的打印设置：页面/纸张/边距/页眉页脚/手动分页符/打印区域/重复标题行。
/// 全字段都来自 OOXML 字面（枚举收字面、边距收英寸、区域收 0 基含端点、分页符原样收 `<brk id>`）。
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct SheetPrintPayload {
    /// landscape / portrait
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub orientation: Option<String>,
    /// OOXML paperSize 数字（9 = A4）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paper_size: Option<u32>,
    /// 缩放百分比（10~400），与 fit_to_page 二选一
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale: Option<u32>,
    /// sheetPr/pageSetUpPr@fitToPage：勾了「fit 到 N×M 页」
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub fit_to_page: bool,
    /// 0 在 OOXML 里是「无限」，原样收（不换算）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fit_to_width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fit_to_height: Option<u32>,
    /// downThenOver / overThenDown
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_order: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub margins: Option<PrintMarginsPayload>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub h_centered: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub v_centered: Option<bool>,
    /// 打印网格线（printOptions@gridLines）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grid_lines: Option<bool>,
    /// 打印行列标题（printOptions@headings）——这一版写不回去，只记账
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub headings: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_page_number: Option<u32>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub odd_even: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub first_differs: bool,
    /// `headerFooter/@scaleWithDoc`：页眉页脚字号随不随文档缩放。
    /// **缺省是开着**，所以读侧只把 `0` 收进来（显式写 `1` 与不写语义相同，归一回不声明）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale_with_doc: Option<bool>,
    /// `headerFooter/@alignWithMargins`：页眉页脚按页边距还是按纸张边缘对齐。同样缺省开着
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub align_with_margins: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub header: Option<PrintHfPayload>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub footer: Option<PrintHfPayload>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub print_area: Option<RangeRect>,
    /// 重复标题行 [起, 止]（0 基含端点）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title_rows: Option<[u32; 2]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title_cols: Option<[u32; 2]>,
    /// 手动行分页符：原样收 `<brk id>`——这些行**自己**开始新的一页（0 基）。
    /// 实测两头都对上：Excel 在 A11 之前插断点写出 id=10；我们写 id=3 时 Excel 报 Location.Row=4（1 基）
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub row_breaks: Vec<u32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub col_breaks: Vec<u32>,
}

impl SheetPrintPayload {
    /// 一个字段都没落上（空表不占载荷，也不进 by_sheet）
    pub fn is_empty(&self) -> bool {
        self.orientation.is_none()
            && self.paper_size.is_none()
            && self.scale.is_none()
            && !self.fit_to_page
            && self.fit_to_width.is_none()
            && self.fit_to_height.is_none()
            && self.page_order.is_none()
            && self.margins.is_none()
            && self.h_centered.is_none()
            && self.v_centered.is_none()
            && self.grid_lines.is_none()
            && self.headings.is_none()
            && self.first_page_number.is_none()
            && !self.odd_even
            && !self.first_differs
            && self.header.is_none()
            && self.footer.is_none()
            && self.print_area.is_none()
            && self.title_rows.is_none()
            && self.title_cols.is_none()
            && self.row_breaks.is_empty()
            && self.col_breaks.is_empty()
    }

    /// 除了「停在默认值上的那档边距」什么都没声明时，把边距也抹掉——那一档是写侧工具替每张表
    /// 落下的（rust_xlsxwriter 没人吩咐也写 `<pageMargins>`），留着它等于凭空多出一份纸面声明：
    /// 界面上按了「清除这张表的设置」，存盘重开设置又自己长了回来。
    pub fn clear_default_only_margins(&mut self) {
        let mut probe = self.clone();
        probe.margins = None;
        if probe.is_empty() && self.margins.as_ref().is_some_and(|m| m.is_all_default()) {
            self.margins = None;
        }
    }
}

/// OOXML paperSize 编号 → 纸名。只收常见档；认不出返回 None（如实记账，打印按默认纸）
pub fn paper_name(code: u32) -> Option<&'static str> {
    Some(match code {
        1 => "Letter",
        2 => "Letter Small",
        3 => "Tabloid",
        4 => "Ledger",
        5 => "Legal",
        6 => "Statement",
        7 => "Executive",
        8 => "A3",
        9 => "A4",
        10 => "A4 Small",
        11 => "A5",
        12 => "B4",
        13 => "B5",
        14 => "Folio",
        15 => "Quarto",
        16 => "10x14",
        17 => "11x17",
        18 => "Paper C",
        19 => "Paper D",
        20 => "Paper E",
        21 => "Fan-fold",
        24 => "A4 (rotated)",
        25 => "A4 Small (rotated)",
        26 => "A5 (rotated)",
        27 => "B4 (rotated)",
        28 => "B5 (rotated)",
        _ => return None,
    })
}

/// 工作簿默认字体：`xl/styles.xml` 里 `cellXfs[0]@fontId` 指到的那一条 `fonts[n]`。
/// OOXML 里没有"默认字体"这个元素，它就是 Normal 样式那条字体，未设样式的格子（`<c>` 不带 `s=`）
/// 全走这一层，Excel 的页眉字号也吃它（v0.57 实测：把 Normal 改成宋体 14，页眉从 11.04pt 变 14.04pt）。
/// 这一层不做归一化：`ff` 照文件原样收——把"等线"归一成"不声明"，写侧就会按 crate 的 Calibri 落笔，
/// 存一次盘字体族自己换了家，正是我们在 cell 层归一化躲不掉的那类分叉
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DefaultFont {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ff: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fs: Option<f64>,
}

/// 工作表格式那一层：`xl/worksheets/sheetN.xml` 的 `<sheetFormatPr>`，管的是"这张表里没明说
/// 行高的那些行"的底数。两条实测把它和"排版指令"分开：Excel 16.0 **不用它排版**（声明 30pt、
/// 声明 30pt 带 `customHeight="1"`、以及整枚缺省的五件变体，行高一律报 17.5 = 从工作簿默认字体
/// 算出来的那一档），但它**自己存盘会重写这一枚**（Calibri/11 → 14，宋体/14 → 17.5）
/// ⇒ 载荷按磅字面收着、存盘原样落回，界面与纸面都不吃它。
/// 不吃 crate 的 `set_default_row_height`：那枚 setter 会把缺省行高盖成**每一行的显式 `ht`**
/// （判别见 `crate_default_row_height_setter_stamps_every_row`），而且内部按整数像素存 ⇒ 17.5 存成 17.25
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SheetFormat {
    /// `@defaultRowHeight`（磅，照文件原样收）
    pub default_row_height: f64,
    /// `@customHeight`：只有文件明写 1 才是 true（缺省与写 0 都归一回不声明）
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub custom_height: bool,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookPayload {
    pub sheets: Vec<SheetPayload>,
    /// 读侧的边界账：格式里认出来但界面/模型装不下的东西，打开时要说得出
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
    /// 工作簿默认字体。Univer 的 `IWorkbookData.defaultStyle` 是个死槽（core 里零读取），
    /// 所以它由侧通道留住，供打印那一层当底数用
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_font: Option<DefaultFont>,
    /// 盘上原件的路径（xlsx→xlsx 保存时由前端带上）：保留式写回据此把读侧不认的部件
    /// 按表名映射搬进产物；新建簿/转存其他格式不带，走纯整包重建
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub src_path: Option<String>,
    /// 用户定义名称（v0.103，v0.98 挂账项）：公式引用名字，写回不带名字公式全断链。
    /// Univer 装不下这一层走侧通道——前端原样带回，写侧在 workbook.xml 定点补写
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub defined_names: Vec<xlsx_names::DefinedName>,
}

#[derive(Debug)]
pub struct Error(pub String);

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
pub async fn read_xlsx(path: String) -> Result<WorkbookPayload, Error> {
    // 解压 + 全表解析是 CPU 密集活，放主线程会让窗口整段冻结
    to_blocking(move || read_xlsx_sync(path)).await
}

/// 存 xlsx；返回值是写侧的边界账（有条规则摆不进 OOXML 这类），前端原样显示
#[tauri::command]
pub async fn write_xlsx(path: String, workbook: WorkbookPayload) -> Result<Vec<String>, Error> {
    to_blocking(move || write_xlsx_sync(path, workbook)).await
}

/// 命令的 async 外壳：把同步实现挪到 blocking 线程池，IPC 名仍按原命令对外
pub(crate) async fn to_blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, Error> + Send + 'static,
) -> Result<T, Error> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| Error(format!("后台任务失败: {e}")))?
}

pub fn read_xlsx_sync(path: String) -> Result<WorkbookPayload, Error> {
    if !Path::new(&path).exists() {
        return Err(Error(format!("文件不存在: {path}")));
    }
    // calamine 不认 csv（它按扩展名嗅探文件魔数，csv 只会报 Cannot detect file format），读侧自己分流
    if path.to_ascii_lowercase().ends_with(".csv") {
        return crate::csv::read_payload(&path);
    }
    let mut workbook =
        open_workbook_auto(&path).map_err(|e| Error(format!("无法打开文件: {e}")))?;
    // 样式/合并读侧按格式分流：xlsx 直解 zip；ods 走 content.xml 直解；xls/csv 无样式通道
    // 工作簿默认字体两条路都读得到，只是住处不同：xlsx 在 styles.xml 的 cellXfs[0]，ODS 在同一件
    // styles.xml 的 <style:default-style style:family="table-cell">（v0.61 接上，此前 .ods 硬交回 None）
    let (fmts, default_font) = if path.to_ascii_lowercase().ends_with(".ods") {
        crate::ods::read_ods_styles(&path)
    } else {
        xlsx_style::read_xlsx_styles(&path)
    };
    let mut sheets = Vec::new();
    let mut rule_notes: Vec<String> = Vec::new();
    // 批注与超链接：xlsx 住在独立部件（comments / threadedComments / rels），另开一趟 zip 按表对回来；
    // ODS 的两样都在 content.xml 的格子自身里（office:annotation 与 text:a），也是一趟扫描按表名收齐——
    // 交回同一个 SideRead 形状，所以装配侧不必知道格式。xls/csv 没有这条路
    let mut sides = if path.to_ascii_lowercase().ends_with(".xlsx") {
        xlsx_cell_side::read_cell_side(&path)
    } else if path.to_ascii_lowercase().ends_with(".ods") {
        crate::ods::read_ods_cell_side(&path)
    } else {
        Default::default()
    };
    rule_notes.append(&mut sides.accounts);
    // 打印设置散在 worksheet 末尾七处 + 两条 definedName，也只在 xlsx 这条路上读
    let mut prints = if path.to_ascii_lowercase().ends_with(".xlsx") {
        xlsx_print::read_print_setups(&path)
    } else {
        Default::default()
    };
    rule_notes.append(&mut prints.accounts);
    // 用户定义名称（v0.103）：print 两条之外的名字都在这里，也只走 xlsx 这条路
    let (defined_names, dn_notes) = if path.to_ascii_lowercase().ends_with(".xlsx") {
        let mut r = xlsx_names::read_defined_names(&path);
        let notes = std::mem::take(&mut r.accounts);
        (r.names, notes)
    } else {
        (Vec::new(), Vec::new())
    };
    rule_notes.extend(dn_notes);
    // 一格值同时进 cells 和"图表取数"用的网格；后者只在簿子真含图表时才需要（多数没有）
    let keep_grid = xlsx_chart::has_charts(&path);
    let mut grids: std::collections::HashMap<String, xlsx_chart::Grid> =
        std::collections::HashMap::new();
    for name in workbook.sheet_names().to_vec() {
        let range = match workbook.worksheet_range(&name) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let fmt = fmts.get(&name);
        // 读侧的边界账：文件里有、我们的模型装不下的规则，打开时就得说得出而不是静默少给
        if let Some(f) = fmt {
            rule_notes.extend(f.rules.notes.iter().cloned());
        }
        let mut cells = Vec::new();
        let mut seen: std::collections::HashSet<(u32, u32)> = std::collections::HashSet::new();
        let (r0, c0) = range.start().unwrap_or((0, 0));
        for (ri, row) in range.rows().enumerate() {
            for (ci, cell) in row.iter().enumerate() {
                if let Some(v) = data_to_value(cell) {
                    let (r, c) = (r0 + ri as u32, c0 + ci as u32);
                    seen.insert((r, c));
                    if keep_grid {
                        grids.entry(name.clone()).or_default().insert((r, c), v.clone());
                    }
                    cells.push(CellPayload {
                        r,
                        c,
                        v: Some(v),
                        f: fmt
                            .and_then(|f| f.formulas.get(&(r, c)).cloned())
                            .map(|t| format!("={t}")),
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
                seen.insert((r, c));
                cells.push(CellPayload {
                    r,
                    c,
                    v: None,
                    f: f.formulas.get(&(r, c)).map(|t| format!("={t}")),
                    s: Some(style.clone()),
                });
            }
            // 无缓存值的公式格 calamine 也不吐，按公式表补回
            for (&(r, c), t) in &f.formulas {
                if seen.contains(&(r, c)) {
                    continue;
                }
                seen.insert((r, c));
                cells.push(CellPayload {
                    r,
                    c,
                    v: None,
                    f: Some(format!("={t}")),
                    s: None,
                });
            }
        }
        // 批注与链接：按表名对回独立部件的读数（remove 而不是 get——一张表的读数只该用一次）
        let side = sides.by_sheet.remove(&name);
        let print = prints.by_sheet.remove(&name);
        sheets.push(SheetPayload {
            name,
            cells,
            merges: fmt.map(|f| f.merges.clone()).unwrap_or_default(),
            charts: Vec::new(),
            col_widths: fmt.map(|f| f.col_widths.clone()).unwrap_or_default(),
            row_heights: fmt.map(|f| f.row_heights.clone()).unwrap_or_default(),
            hidden_rows: fmt.map(|f| f.hidden_rows.clone()).unwrap_or_default(),
            hidden_cols: fmt.map(|f| f.hidden_cols.clone()).unwrap_or_default(),
            freeze: fmt.and_then(|f| f.freeze).map(|(rows, cols)| Freeze { rows, cols }),
            sheet_format: fmt.and_then(|f| f.sheet_format.clone()),
            filter: fmt.and_then(|f| f.rules.filter.clone()),
            data_validations: fmt
                .map(|f| f.rules.data_validations.clone())
                .unwrap_or_default(),
            cond_formats: fmt
                .map(|f| f.rules.cond_formats.clone())
                .unwrap_or_default(),
            notes: side.as_ref().map(|s| s.notes.clone()).unwrap_or_default(),
            links: side.as_ref().map(|s| s.links.clone()).unwrap_or_default(),
            print,
            ..Default::default()
        });
    }
    // 图表部件单独解析：值按引用从上面已建好的网格取
    let charts = if keep_grid {
        xlsx_chart::read_xlsx_charts(&path, &grids)
    } else {
        Default::default()
    };
    for sheet in sheets.iter_mut() {
        if let Some(cs) = charts.get(&sheet.name) {
            sheet.charts = cs.clone();
        }
    }
    Ok(WorkbookPayload {
        sheets,
        warnings: rule_notes,
        default_font,
        defined_names,
        ..Default::default()
    })
}

fn border_type(s: &str) -> Option<rust_xlsxwriter::FormatBorder> {
    use rust_xlsxwriter::FormatBorder as B;
    Some(match s {
        "thin" => B::Thin,
        "medium" => B::Medium,
        "dashed" => B::Dashed,
        "dotted" => B::Dotted,
        "double" => B::Double,
        "hair" => B::Hair,
        "thick" => B::Thick,
        "mediumDashed" => B::MediumDashed,
        "dashDot" => B::DashDot,
        "mediumDashDot" => B::MediumDashDot,
        "dashDotDot" => B::DashDotDot,
        "slantDashDot" => B::SlantDashDot,
        _ => return None,
    })
}

/// 文件那一层（工作簿默认字体）里真正需要"种"进格子的那两味。
/// crate 自己的默认就是 Calibri/11，而且带 `<scheme val="minor"/>`（字族跟着主题走）：
/// 实测显式 `set_font_name("Calibri")` 写出来的那一条没有 scheme ⇒ 同一档时一个字都不种
fn seed_font(default: Option<&DefaultFont>) -> (Option<&str>, Option<f64>) {
    let Some(d) = default else { return (None, None) };
    let ff = d
        .ff
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty() && *n != "Calibri");
    let fs = d.fs.filter(|v| *v > 0.0 && (*v - 11.0).abs() > f64::EPSILON);
    (ff, fs)
}

fn format_for(s: Option<&CellStyle>, default: Option<&DefaultFont>) -> Format {
    let st = s.filter(|x| x.has_any());
    let (seed_ff, seed_fs) = seed_font(default);
    let mut f = Format::new();
    if let Some(st) = st {
        if st.bl {
            f = f.set_bold();
        }
        if st.it {
            f = f.set_italic();
        }
    }
    // 正文的底数也归文件那一层说：格子里没写字族/字号时跟工作簿默认字体，不落到常量上
    if let Some(name) = st.and_then(|x| x.ff.as_deref()).or(seed_ff) {
        f = f.set_font_name(name);
    }
    if let Some(size) = st.and_then(|x| x.fs).or(seed_fs) {
        f = f.set_font_size(size);
    }
    if let Some(st) = st {
        if let Some(cl) = &st.cl {
            f = f.set_font_color(Color::from(cl.as_str()));
        }
        if let Some(bg) = &st.bg {
            f = f.set_background_color(Color::from(bg.as_str()));
        }
        if let Some(bd) = &st.bd {
            let sides: [(&Option<BorderSide>, fn(Format, rust_xlsxwriter::FormatBorder) -> Format, fn(Format, Color) -> Format); 4] = [
                (&bd.l, Format::set_border_left, Format::set_border_left_color),
                (&bd.r, Format::set_border_right, Format::set_border_right_color),
                (&bd.t, Format::set_border_top, Format::set_border_top_color),
                (&bd.b, Format::set_border_bottom, Format::set_border_bottom_color),
            ];
            for (line, set_border, set_color) in sides {
                if let Some(line) = line {
                    if let Some(bt) = line.s.as_deref().and_then(border_type) {
                        f = set_border(f, bt);
                    }
                    if let Some(c) = line.c.as_deref() {
                        f = set_color(f, Color::from(c));
                    }
                }
            }
        }
        if let Some(ho) = st.ho.as_deref().and_then(|h| match h {
            "left" => Some(rust_xlsxwriter::FormatAlign::Left),
            "center" => Some(rust_xlsxwriter::FormatAlign::Center),
            "right" => Some(rust_xlsxwriter::FormatAlign::Right),
            "justify" => Some(rust_xlsxwriter::FormatAlign::Justify),
            _ => None,
        }) {
            f = f.set_align(ho);
        }
        if let Some(vo) = st.vo.as_deref().and_then(|v| match v {
            "top" => Some(rust_xlsxwriter::FormatAlign::Top),
            "middle" => Some(rust_xlsxwriter::FormatAlign::VerticalCenter),
            "bottom" => Some(rust_xlsxwriter::FormatAlign::Bottom),
            _ => None,
        }) {
            f = f.set_align(vo);
        }
        if st.wb {
            f = f.set_text_wrap();
        }
        if let Some(nf) = &st.nf {
            f = f.set_num_format(nf.as_str());
        }
    }
    f
}

pub(crate) fn cell_text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

/// 取该图型的「专属样式」：各图型的样式枚举彼此独立，故按 chart_type 分流
/// （radar→radarStyle、scatter→scatterStyle，其余类型没有）
fn chart_style_of(c: &ChartPayload) -> Option<&str> {
    match c.chart_type.as_str() {
        "radar" => c.radar_style.as_deref(),
        "scatter" => c.scatter_style.as_deref(),
        _ => None,
    }
}

/// style 是 chart_style_of 给出的该型专属枚举，None／认不出即取该型的 Excel 默认形态
fn chart_type_for(t: &str, grouping: &str, style: Option<&str>) -> Option<rust_xlsxwriter::ChartType> {
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
        ("stock", _, _) => C::Stock,
        ("radar", _, _) => match style {
            Some("marker") => C::RadarWithMarkers,
            Some("filled") => C::RadarFilled,
            _ => C::Radar,
        },
        ("scatter", _, _) => match style {
            Some("line") => C::ScatterStraight,
            Some("lineMarker") => C::ScatterStraightWithMarkers,
            Some("smooth") => C::ScatterSmooth,
            Some("smoothMarker") => C::ScatterSmoothWithMarkers,
            _ => C::Scatter, // marker（Excel 默认）：只有点、不连线
        },
        _ => return None,
    })
}

/// px → 图表尺寸（rust_xlsxwriter 以厘米计）
fn px_to_cm(px: u32) -> u32 {
    ((px as f64) * 2.54 / 96.0).round().max(2.0) as u32
}

/// 往一个 Chart 上挂一条系列（主图与组合图的副图共用，免得两处跑偏）
fn add_chart_series(ch: &mut rust_xlsxwriter::Chart, s: &ChartSeries, sheet_name: &str) {
    let ser = ch.add_series();
    if !s.name.is_empty() {
        ser.set_name(s.name.as_str());
    }
    let host = if s.val.sheet.is_empty() {
        sheet_name
    } else {
        s.val.sheet.as_str()
    };
    let v = &s.val;
    ser.set_values((host, v.r1, v.c1 as u16, v.r2, v.c2 as u16));
    if let Some(c) = &s.cat {
        let csheet = if c.sheet.is_empty() { host } else { c.sheet.as_str() };
        ser.set_categories((csheet, c.r1, c.c1 as u16, c.r2, c.c2 as u16));
    }
    // 只在真次轴时喊话：默认 false 写不写都一样，省得给非组合图平白多出一份轴定义
    if s.secondary_axis {
        ser.set_secondary_axis(true);
    }
}

/// 显示单位：`<c:builtInUnit>` 的内置十档。`<c:custUnit>` 的自定义数字 crate 没这个枚举 ⇒ 写不进去，记账
fn display_unit_of(s: &str) -> Option<rust_xlsxwriter::ChartAxisDisplayUnitType> {
    use rust_xlsxwriter::ChartAxisDisplayUnitType as U;
    match s.trim() {
        "hundreds" => Some(U::Hundreds),
        "thousands" => Some(U::Thousands),
        "tenThousands" => Some(U::TenThousands),
        "hundredThousands" => Some(U::HundredThousands),
        "millions" => Some(U::Millions),
        "tenMillions" => Some(U::TenMillions),
        "hundredMillions" => Some(U::HundredMillions),
        "billions" => Some(U::Billions),
        "trillions" => Some(U::Trillions),
        _ => None,
    }
}

/// 把一根轴的字段倒进 crate 的轴对象：只喊"说了话"的那几项，没说的留给 crate 自己的默认
fn apply_axis(axis: &mut rust_xlsxwriter::ChartAxis, a: &ChartAxis, notes: &mut Vec<String>) {
    if let Some(t) = a.title.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        axis.set_name(t);
    }
    if let Some(v) = a.min {
        axis.set_min(v);
    }
    if let Some(v) = a.max {
        axis.set_max(v);
    }
    if let Some(b) = a.log_base {
        if b >= 2.0 {
            axis.set_log_base(b.round() as u16);
        } else {
            notes.push(format!("对数底 {b} 小于 2，轴没按对数刻度写"));
        }
    }
    if let Some(v) = a.major_unit {
        axis.set_major_unit(v);
    }
    if let Some(v) = a.minor_unit {
        axis.set_minor_unit(v);
    }
    if let Some(u) = a.display_unit.as_deref() {
        match display_unit_of(u) {
            Some(t) => {
                axis.set_display_unit_type(t);
            }
            None => notes
                .push(format!("显示单位「{u}」crate 只认内置十档，自定义数字没写进去")),
        }
    }
    if let Some(f) = a.num_format.as_deref().filter(|s| !s.is_empty()) {
        axis.set_num_format(f);
    }
    if a.reverse {
        axis.set_reverse();
    }
    if a.hidden {
        axis.set_hidden(true);
    }
}

/// 轴落进图表：类目轴 → x_axis，值轴按出现次序（第 0 根主、第 1 根次）
/// 次值轴要真有系列走次轴才接，否则凭空多一份 `<c:valAx>` 反而把图弄歪
fn apply_chart_axes(
    ch: &mut rust_xlsxwriter::Chart,
    axes: &[ChartAxis],
    has_secondary: bool,
) -> Vec<String> {
    let mut notes = Vec::new();
    let (mut val_seen, mut cat_seen) = (0usize, 0usize);
    for a in axes {
        if a.kind == "val" {
            let i = val_seen;
            val_seen += 1;
            match i {
                0 => apply_axis(ch.y_axis(), a, &mut notes),
                1 if has_secondary => apply_axis(ch.y2_axis(), a, &mut notes),
                1 => notes.push("次值轴有刻度设置，但没有系列走次轴，没写进去".to_string()),
                _ => notes.push(format!(
                    "第 {} 根值轴的刻度设置没写进去：xlsx 只认主/次两根值轴",
                    i + 1
                )),
            }
        } else {
            let i = cat_seen;
            cat_seen += 1;
            match i {
                0 => apply_axis(ch.x_axis(), a, &mut notes),
                _ => notes.push(format!("第 {} 根类目轴的刻度设置没写进去", i + 1)),
            }
        }
    }
    notes
}

pub fn write_xlsx_sync(path: String, workbook: WorkbookPayload) -> Result<Vec<String>, Error> {
    let mut wb = Workbook::new();
    let mut notes = Vec::new();
    // 工作簿默认字体落在 fonts[0]（就是 Normal 那条），crate 只认 add_worksheet 之前的这一笔；
    // 行高/列宽照交回它自己的默认（20 与 64），于是字节上只动字体那一层。
    // 载荷没说话时一个字都不写——今天的输出形状一位不变
    if let Some(df) = workbook.default_font.as_ref() {
        let ff = df.ff.as_deref().map(str::trim).filter(|s| !s.is_empty());
        let fs = df.fs.filter(|v| *v > 0.0);
        // 同一档不重复声明：Calibri/11 正是 crate 自己的默认，写一遍反而把 `<scheme>` 弄丢
        let (seed_ff, seed_fs) = seed_font(Some(df));
        if (ff.is_some() || fs.is_some()) && (seed_ff.is_some() || seed_fs.is_some()) {
            let mut fmt = Format::new();
            if let Some(name) = ff {
                fmt = fmt.set_font_name(name);
            }
            if let Some(size) = fs {
                fmt = fmt.set_font_size(size);
            }
            if let Err(e) = wb.set_default_format(&fmt, 20, 64) {
                notes.push(format!("工作簿默认字体没写进去: {e}"));
            }
        }
    }
    let default_font = workbook.default_font.as_ref();
    // 每张表交回来的作者表（下标即 authorId），存盘时拿它核对产物里的 <authors>
    let mut tables: Vec<Option<xlsx_cell_side::AuthorTable>> = Vec::new();
    // crate 写不了的那半边打印设置，按 worksheet 部件名点名（部件序号＝建表顺序，1 基）
    let mut print_patches: Vec<(String, xlsx_print::PrintPatch)> = Vec::new();
    for (i, sheet) in workbook.sheets.iter().enumerate() {
        let ws = wb.add_worksheet();
        ws.set_name(&sheet.name)
            .map_err(|e| Error(format!("工作表命名失败: {e}")))?;
        // 批注与超链接先写：链接落一格文本，后面的普通格写入只覆盖值与格式，<hyperlink> 元素照旧在
        let side = xlsx_cell_side::write_sheet_side(ws, sheet);
        notes.extend(side.accounts);
        tables.push(side.authors);
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
            let fmt = format_for(top.and_then(|x| x.s.as_ref()), default_font);
            let _ = ws.merge_range(m.start_row, sc, m.end_row, ec, text.as_str(), &fmt);
        }
        for cell in &sheet.cells {
            let row = cell.r;
            let Ok(col) = u16::try_from(cell.c) else { continue };
            if in_merge(row, cell.c) {
                continue;
            }
            let st = cell.s.as_ref().filter(|x| x.has_any());
            let fmt = format_for(st, default_font);
            if let Some(formula) = &cell.f {
                // Formula::new 自剥 '='；缓存值随 <v> 落盘，重开（calamine 不算式）不丢数
                let mut f = rust_xlsxwriter::Formula::new(formula);
                if let Some(Value::Number(n)) = &cell.v {
                    let s = if n.as_f64().map(|v| v.fract() == 0.0 && v.abs() < (i64::MAX as f64)) == Some(true) {
                        format!("{}", n.as_f64().unwrap() as i64)
                    } else {
                        n.to_string()
                    };
                    f = f.set_result(s);
                }
                // 没样式的格走不带 format 的那条写法：实测那样 `<c>` 上没有 `s=`，
                // 字号就回到"继承 Normal"——Excel 原件正是这个形状（盖上 s="1" 等于换成 Calibri/11）
                match st {
                    Some(_) => {
                        let _ = ws.write_formula_with_format(row, col, f, &fmt);
                    }
                    None => {
                        let _ = ws.write_formula(row, col, f);
                    }
                }
                continue;
            }
            match &cell.v {
                Some(Value::String(s)) => match st {
                    Some(_) => {
                        let _ = ws.write_string_with_format(row, col, s.clone(), &fmt);
                    }
                    None => {
                        let _ = ws.write_string(row, col, s.as_str());
                    }
                },
                Some(Value::Number(n)) => {
                    if let Some(f) = n.as_f64() {
                        match st {
                            Some(_) => {
                                let _ = ws.write_number_with_format(row, col, f, &fmt);
                            }
                            None => {
                                let _ = ws.write_number(row, col, f);
                            }
                        }
                    }
                }
                Some(Value::Bool(b)) => match st {
                    Some(_) => {
                        let _ = ws.write_boolean_with_format(row, col, *b, &fmt);
                    }
                    None => {
                        let _ = ws.write_boolean(row, col, *b);
                    }
                },
                Some(other) => match st {
                    Some(_) => {
                        let _ = ws.write_string_with_format(row, col, other.to_string(), &fmt);
                    }
                    None => {
                        let _ = ws.write_string(row, col, other.to_string().as_str());
                    }
                },
                None => {
                    if st.is_some() {
                        let _ = ws.write_string_with_format(row, col, "", &fmt);
                    }
                }
            }
        }
        // 列宽/行高：载荷即像素。crate 序列化按 chars=px/7 不扣 5px 填充，
        // 与读侧 round(chars*7+5) 互为逆运算须先减填充。行高这一路**不是无损的**：
        // `set_row_height_pixels` 只收整数像素，载荷里非整的那一档在 `as u32` 上被截掉
        // （最多 1px＝0.75pt 的字节漂移，路线图里挂着）；缺省行高那一层也因此不走它，见 `SheetFormat`
        for (c, px) in &sheet.col_widths {
            let Ok(col) = u16::try_from(*c) else { continue };
            let _ = ws.set_column_width_pixels(col, (*px - 5.0).round().max(1.0) as u32);
        }
        for (r, px) in &sheet.row_heights {
            let _ = ws.set_row_height_pixels(*r, (*px as u32).max(1));
        }
        // 隐藏行列与冻结窗格（set_freeze_panes 参数即冻结带行列数）
        for r in &sheet.hidden_rows {
            let _ = ws.set_row_hidden(*r);
        }
        for c in &sheet.hidden_cols {
            if let Ok(col) = u16::try_from(*c) {
                let _ = ws.set_column_hidden(col);
            }
        }
        if let Some(fz) = &sheet.freeze {
            if let Ok(cols) = u16::try_from(fz.cols) {
                let _ = ws.set_freeze_panes(fz.rows, cols);
            }
        }
        // 原生图表：系列引用直接映射为单元格区域公式，Excel 打开即活图
        for chart in &sheet.charts {
            let Ok(ctype) = chart_type_for(&chart.chart_type, &chart.grouping, chart_style_of(chart))
                .ok_or(())
            else {
                continue;
            };
            let Ok(col) = u16::try_from(chart.anchor_col) else { continue };
            // 组合图：与主图型不同的系列走「主图 + 一副图」。crate 的 combine 只有一个副图槽位，
            // 所以副图型按首次出现定一种；真出现两种以上副图型时按第一种回写并记账（不静默丢系列）
            let mut subs: Vec<&str> = Vec::new();
            for s in &chart.series {
                if let Some(t) = s.chart_type.as_deref() {
                    if !subs.contains(&t) {
                        subs.push(t);
                    }
                }
            }
            if subs.len() > 1 {
                notes.push(format!(
                    "图表「{}」有 {} 种副图型（{}），xlsx 写侧只支持主图 + 一种副图，其余暂按「{}」回写",
                    if chart.title.is_empty() { "(无标题)" } else { chart.title.as_str() },
                    subs.len(),
                    subs.join("/"),
                    subs[0]
                ));
            }
            let sub_ctype = subs
                .first()
                // 副图的「专属样式」（radar/scatter 那一族）不跨元素继承，故传 None
                .and_then(|t| chart_type_for(t, &chart.grouping, None));
            let mut ch = rust_xlsxwriter::Chart::new(ctype);
            if !chart.title.is_empty() {
                ch.title().set_name(chart.title.as_str());
            }
            ch.set_width(px_to_cm(chart.width));
            ch.set_height(px_to_cm(chart.height));
            let mut sub: Option<rust_xlsxwriter::Chart> = sub_ctype.map(rust_xlsxwriter::Chart::new);
            for s in &chart.series {
                match (s.chart_type.as_deref(), sub.as_mut()) {
                    (Some(_), Some(c2)) => add_chart_series(c2, s, &sheet.name),
                    // 副图型写不进去（如 pie 那类不支持组合的）时退回主图，总比丢一条系列好
                    _ => add_chart_series(&mut ch, s, &sheet.name),
                }
            }
            if let Some(c2) = sub {
                ch.combine(&c2);
            }
            // 轴要在 combine 之后设：combine 会把副图的轴并进来，先设再并有被盖掉的风险
            let has_secondary = chart.series.iter().any(|s| s.secondary_axis);
            notes.extend(apply_chart_axes(&mut ch, &chart.axes, has_secondary));
            let _ = ws.insert_chart(chart.anchor_row, col, &ch);
        }
        // 三类规则（筛选 / 数据验证 / 条件格式）：写不进去的东西带回来记账，不在存盘时静默少给
        notes.extend(write_sheet_rules(ws, sheet));
        // 打印设置：odd 页眉页脚与其余各项走 crate，even/first 与起始页码带回存盘那一趟重打包
        let pw = xlsx_print::write_sheet_print(ws, sheet);
        notes.extend(pw.notes);
        let patch = xlsx_print::PrintPatch {
            sheet_name: sheet.name.clone(),
            hf: pw.hf,
            first_page_number: pw.page_number_patch,
            drop_orientation: pw.drop_orientation,
            // 缺省行高那一层不吃 crate 的 setter（会把缺省盖成每一行的显式 ht），跟这一趟重打包落字节
            sheet_format: sheet.sheet_format.clone(),
        };
        if !patch.noop() {
            // crate 按建表顺序把表写成 xl/worksheets/sheet{1,2,…}.xml
            print_patches.push((format!("xl/worksheets/sheet{}.xml", i + 1), patch));
        }
    }
    // 批注的作者表可能要和产物对一次账（crate 把那张表按名字排序写了，编号却是格子序），
    // 所以对不上时不只是记账——先重排，重排不了的才记账；同一趟里补上打印设置的半边
    // 与用户定义名称（crate 只认 print 两条，名字按当前表序重算 localSheetId 补进 workbook.xml）
    let sheet_order: Vec<String> = workbook.sheets.iter().map(|s| s.name.clone()).collect();
    let (bytes, save_notes) = xlsx_cell_side::save_workbook_bytes(
        &mut wb,
        tables.as_slice(),
        print_patches.as_slice(),
        workbook.defined_names.as_slice(),
        sheet_order.as_slice(),
    )
    .map_err(Error)?;
    notes.extend(save_notes);
    // 保留式写回：原件还是 xlsx（且载荷带了路径）时，把读侧不认的部件（图片、表格……）
    // 按表名映射搬进产物再落盘。守卫不过/原件读不开就记账退回整包重建，不让保存失败
    let mut bytes = bytes;
    if let Some(src) = workbook
        .src_path
        .as_deref()
        .filter(|p| p.to_ascii_lowercase().ends_with(".xlsx"))
    {
        let names: Vec<String> = workbook.sheets.iter().map(|s| s.name.clone()).collect();
        match crate::xlsx_preserve::carry(src, &bytes, &names) {
            Ok(out) => {
                notes.extend(out.notes);
                bytes = out.bytes;
            }
            Err(why) => notes.push(format!("保留式写回没启用：{why}，按整包重写保存")),
        }
    }
    std::fs::write(&path, bytes).map_err(|e| Error(format!("保存失败: {e}")))?;
    Ok(notes)
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
            ..Default::default()
        };
        write_xlsx_sync(path.clone(), wb).expect("write failed");
        let back = read_xlsx_sync(path.clone()).expect("read failed");
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
            ..Default::default()
        };
        write_xlsx_sync(path.clone(), wb).expect("write failed");
        let back = read_xlsx_sync(path.clone()).expect("read failed");
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

    #[test]
    fn border_align_numfmt_roundtrip() {
        let path = tmp_path("fmt");
        let wb = WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "格式".into(),
                cells: vec![
                    CellPayload {
                        r: 0,
                        c: 0,
                        v: Some(json!("边框居中")),
                        s: Some(CellStyle {
                            bd: Some(CellBorder {
                                t: Some(BorderSide { s: Some("thin".into()), c: None }),
                                r: Some(BorderSide { s: Some("medium".into()), c: Some("#3366cc".into()) }),
                                b: Some(BorderSide { s: Some("dashed".into()), c: None }),
                                l: Some(BorderSide { s: Some("thin".into()), c: None }),
                            }),
                            ho: Some("center".into()),
                            vo: Some("middle".into()),
                            ..Default::default()
                        }),
                        ..Default::default()
                    },
                    CellPayload {
                        r: 1,
                        c: 0,
                        v: Some(json!(1234.5)),
                        s: Some(CellStyle {
                            nf: Some("#,##0.00".into()),
                            ..Default::default()
                        }),
                        ..Default::default()
                    },
                    CellPayload {
                        r: 2,
                        c: 0,
                        v: Some(json!(0.25)),
                        s: Some(CellStyle {
                            nf: Some("0.00%".into()),
                            ho: Some("right".into()),
                            wb: true,
                            ..Default::default()
                        }),
                        ..Default::default()
                    },
                ],
                ..Default::default()
            }],
            ..Default::default()
        };
        write_xlsx_sync(path.clone(), wb).expect("write failed");
        let back = read_xlsx_sync(path.clone()).expect("read failed");
        std::fs::remove_file(&path).ok();

        let sheet = &back.sheets[0];
        let find = |r: u32, c: u32| sheet.cells.iter().find(|x| x.r == r && x.c == c);
        let st0 = find(0, 0).and_then(|x| x.s.clone()).expect("A1 样式");
        let bd = st0.bd.expect("A1 边框");
        assert_eq!(bd.t.as_ref().and_then(|x| x.s.as_deref()), Some("thin"));
        assert_eq!(bd.r.as_ref().and_then(|x| x.s.as_deref()), Some("medium"));
        assert_eq!(bd.r.as_ref().and_then(|x| x.c.as_deref()), Some("#3366cc"));
        assert_eq!(bd.b.as_ref().and_then(|x| x.s.as_deref()), Some("dashed"));
        assert_eq!(st0.ho.as_deref(), Some("center"));
        assert_eq!(st0.vo.as_deref(), Some("middle"));
        let st1 = find(1, 0).and_then(|x| x.s.clone()).expect("A2 样式");
        assert_eq!(st1.nf.as_deref(), Some("#,##0.00"), "数字格式往返");
        let st2 = find(2, 0).and_then(|x| x.s.clone()).expect("A3 样式");
        assert_eq!(st2.nf.as_deref(), Some("0.00%"));
        assert_eq!(st2.ho.as_deref(), Some("right"));
        assert!(st2.wb, "自动换行往返");
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
                        radar_style: None,
                        scatter_style: None,
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
                                chart_type: None,
                                secondary_axis: false,
                            },
                            ChartSeries {
                                name: "利润".into(),
                                cat: Some(rf("图表", 1, 0, 3, 0)),
                                val: rf("图表", 1, 2, 3, 2),
                                cats: vec![],
                                vals: vec![],
                                chart_type: None,
                                secondary_axis: false,
                            },
                        ],
                        axes: vec![],
                    },
                    ChartPayload {
                        chart_type: "pie".into(),
                        grouping: "standard".into(),
                        title: "".into(),
                        radar_style: None,
                        scatter_style: None,
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
                            chart_type: None,
                            secondary_axis: false,
                        }],
                        axes: vec![],
                    },
                ],
                ..Default::default()
            }],
            ..Default::default()
        };
        write_xlsx_sync(path.clone(), wb).expect("write failed");
        let back = read_xlsx_sync(path.clone()).expect("read failed");
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

    #[test]
    fn dimensions_and_font_roundtrip() {
        let path = tmp_path("dim");
        let wb = WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "尺寸".into(),
                cells: vec![CellPayload {
                    r: 0,
                    c: 0,
                    v: Some(json!("字族")),
                    s: Some(CellStyle {
                        ff: Some("微软雅黑".into()),
                        ..Default::default()
                    }),
                    ..Default::default()
                }],
                merges: vec![],
                charts: vec![],
                col_widths: [(0u32, 140.0), (2u32, 60.0)].into_iter().collect(),
                row_heights: [(1u32, 36.0)].into_iter().collect(),
                ..Default::default()
            }],
            ..Default::default()
        };
        write_xlsx_sync(path.clone(), wb).expect("write_xlsx");
        let back = read_xlsx_sync(path.clone()).expect("读回失败");
        std::fs::remove_file(&path).ok();
        let sheet = &back.sheets[0];
        assert_eq!(sheet.col_widths.get(&0), Some(&140.0), "列 0 宽 140px");
        assert_eq!(sheet.col_widths.get(&2), Some(&60.0), "列 2 宽 60px");
        assert_eq!(sheet.row_heights.get(&1), Some(&36.0), "行 1 高 36px");
        let ff = sheet
            .cells
            .iter()
            .find(|x| x.r == 0 && x.c == 0)
            .and_then(|x| x.s.as_ref())
            .and_then(|s| s.ff.clone());
        assert_eq!(ff.as_deref(), Some("微软雅黑"), "字体族往返");
    }

    #[test]
    fn hidden_and_freeze_roundtrip() {
        let path = tmp_path("hid");
        let wb = WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "隐藏".into(),
                cells: vec![
                    CellPayload { r: 0, c: 0, v: Some(json!("keep")), ..Default::default() },
                    CellPayload { r: 0, c: 1, v: Some(json!("gone")), ..Default::default() },
                    CellPayload { r: 1, c: 0, v: Some(json!("h")), ..Default::default() },
                ],
                merges: vec![],
                charts: vec![],
                col_widths: HashMap::new(),
                row_heights: HashMap::new(),
                hidden_rows: vec![1],
                hidden_cols: vec![1],
                freeze: Some(Freeze { rows: 1, cols: 0 }),
                ..Default::default()
            }],
            ..Default::default()
        };
        write_xlsx_sync(path.clone(), wb).expect("write_xlsx");
        let back = read_xlsx_sync(path.clone()).expect("读回失败");
        std::fs::remove_file(&path).ok();
        let sheet = &back.sheets[0];
        assert_eq!(sheet.hidden_cols, vec![1], "隐藏列往返");
        assert_eq!(sheet.hidden_rows, vec![1], "隐藏行往返");
        assert_eq!(
            sheet.freeze.map(|f| (f.rows, f.cols)),
            Some((1, 0)),
            "冻结首行往返"
        );
    }

    #[test]
    fn formula_roundtrip_with_cached_value() {
        let path = tmp_path("formula");
        let wb = WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "算".into(),
                cells: vec![
                    CellPayload { r: 0, c: 0, v: Some(json!(10)), ..Default::default() },
                    CellPayload { r: 1, c: 0, v: Some(json!(32)), ..Default::default() },
                    // 带缓存值的公式 + 含 <> 比较（XML 转义回归）
                    CellPayload {
                        r: 0,
                        c: 1,
                        v: Some(json!(42)),
                        f: Some("=A1+A2".into()),
                        ..Default::default()
                    },
                    CellPayload {
                        r: 1,
                        c: 1,
                        v: Some(json!(1)),
                        f: Some("=IF(A1<A2,1,0)".into()),
                        ..Default::default()
                    },
                    // 无缓存值公式格：写侧默认 0，重开至少公式不丢
                    CellPayload {
                        r: 2,
                        c: 1,
                        v: None,
                        f: Some("=SUM(A1:B1)".into()),
                        ..Default::default()
                    },
                ],
                ..Default::default()
            }],
            ..Default::default()
        };
        write_xlsx_sync(path.clone(), wb).expect("write_xlsx");
        let back = read_xlsx_sync(path.clone()).expect("读回失败");
        std::fs::remove_file(&path).ok();
        let sheet = &back.sheets[0];
        let at = |r: u32, c: u32| sheet.cells.iter().find(|x| x.r == r && x.c == c);
        assert_eq!(at(0, 1).and_then(|x| x.f.as_deref()), Some("=A1+A2"), "公式往返");
        assert_eq!(at(0, 1).and_then(|x| x.v.clone()), Some(json!(42)), "缓存值随公式落盘");
        assert_eq!(
            at(1, 1).and_then(|x| x.f.as_deref()),
            Some("=IF(A1<A2,1,0)"),
            "含 < 比较式的公式经 unescape 还原"
        );
        assert_eq!(at(2, 1).and_then(|x| x.f.as_deref()), Some("=SUM(A1:B1)"), "无值公式格补回");
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
        let all_thin = || CellBorder {
            t: Some(BorderSide { s: Some("thin".into()), c: Some("#000000".into()) }),
            r: Some(BorderSide { s: Some("thin".into()), c: Some("#000000".into()) }),
            b: Some(BorderSide { s: Some("thin".into()), c: Some("#000000".into()) }),
            l: Some(BorderSide { s: Some("thin".into()), c: Some("#000000".into()) }),
        };
        let wb = WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "销售".into(),
                cells: vec![
                    CellPayload {
                        r: 0,
                        c: 0,
                        v: Some(json!("月")),
                        s: Some(CellStyle {
                            bl: true,
                            ff: Some("微软雅黑".into()),
                            bd: Some(all_thin()),
                            ho: Some("center".into()),
                            vo: Some("middle".into()),
                            ..Default::default()
                        }),
                        ..Default::default()
                    },
                    CellPayload {
                        r: 0,
                        c: 1,
                        v: Some(json!("销量")),
                        s: Some(CellStyle {
                            bd: Some(all_thin()),
                            ..Default::default()
                        }),
                        ..Default::default()
                    },
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
                    CellPayload {
                        r: 4,
                        c: 1,
                        v: Some(json!(1234.5)),
                        s: Some(CellStyle {
                            nf: Some("#,##0.00".into()),
                            ho: Some("right".into()),
                            wb: true,
                            ..Default::default()
                        }),
                        ..Default::default()
                    },
                    mk(4, 2, json!(9)),
                ],
                merges: vec![],
                charts: vec![
                    ChartPayload {
                        chart_type: "column".into(),
                        grouping: "standard".into(),
                        title: "季度业绩".into(),
                        radar_style: None,
                        scatter_style: None,
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
                                chart_type: None,
                                secondary_axis: false,
                            },
                            ChartSeries {
                                name: "利润".into(),
                                cat: Some(rf("销售", 1, 0, 4, 0)),
                                val: rf("销售", 1, 2, 4, 2),
                                cats: vec![],
                                vals: vec![],
                                chart_type: None,
                                secondary_axis: false,
                            },
                        ],
                        axes: vec![],
                    },
                    ChartPayload {
                        chart_type: "pie".into(),
                        grouping: "standard".into(),
                        title: "".into(),
                        radar_style: None,
                        scatter_style: None,
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
                            chart_type: None,
                            secondary_axis: false,
                        }],
                        axes: vec![],
                    },
                ],
                col_widths: [(0u32, 140.0)].into_iter().collect(),
                row_heights: [(0u32, 32.0)].into_iter().collect(),
                ..Default::default()
            }],
            ..Default::default()
        };
        write_xlsx_sync(path.clone(), wb).expect("写夹具失败");
        println!("fixture written: {path}");
    }

    fn cf_print_cells() -> Vec<CellPayload> {
        let col = |c: u32, vals: &[Value]| -> Vec<CellPayload> {
            vals.iter()
                .enumerate()
                .map(|(r, v)| cell(r as u32, c, v.clone()))
                .collect()
        };
        let mut out = Vec::new();
        out.extend(col(0, &[json!(-1.0), json!(2.0), json!(5.0), json!(8.0), json!(11.0), json!(14.0)]));
        out.extend(col(1, &[json!(3.0), json!(7.0), json!(1.0), json!(9.0), json!(4.0), json!(6.0)]));
        out.extend(col(2, &[json!(2.0), json!(10.0), json!(-5.0), json!(5.0), json!(7.0), json!(1.0)]));
        out.extend(col(3, &[json!("甲"), json!("乙"), json!("甲"), json!("丙"), json!("乙"), json!("甲")]));
        out.extend(col(4, &[json!(10.0), json!(20.0), json!(30.0), json!(40.0), json!(50.0), json!(60.0)]));
        out.extend(col(5, &[json!(5.0), json!(15.0), json!(25.0), json!(35.0), json!(45.0), json!(55.0)]));
        out.extend(col(6, &[json!("报价单"), json!("合同"), json!("报价调整"), json!("发票"), json!("报价"), json!("收据")]));
        out.extend(col(7, &[json!(1.0), json!(2.0), json!(3.0), json!(4.0), json!(5.0), json!(6.0)]));
        out
    }

    fn cf_stop(t: &str, color: &str, v: Option<Value>) -> CondFormatStop {
        CondFormatStop { color: color.into(), t: t.into(), v }
    }

    /// 条件格式打印夹具：每列一种判定型，供「我们打印算出的颜色」与「Excel 自己显示的颜色」对表
    fn cf_print_workbook() -> WorkbookPayload {
        let bg = |bg: &str, cl: &str, bl: bool| CondFormatStyle {
            bg: Some(bg.into()),
            cl: if cl.is_empty() { None } else { Some(cl.into()) },
            bl: bl.then_some(true),
            ..Default::default()
        };
        let row6 = |c: u32| rc(0, c, 5, c);
        WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "条件格式".into(),
                cells: cf_print_cells(),
                // A：数值判定 + 命中即停 / B：三色色阶 / C：实色数据条且藏值 / D：重复值
                // E：前 2 名 / F：高于均值 / G：含"报价" / H：图标集（打印只能记账）
                cond_formats: vec![
                    CondFormatPayload {
                        ranges: vec![row6(0)],
                        kind: "cell".into(),
                        sub: Some("number".into()),
                        op: Some("greaterThan".into()),
                        v1: Some(json!(5)),
                        fmt: Some(bg("#ffc7ce", "#9c0006", true)),
                        stop: Some(true),
                        ..Default::default()
                    },
                    CondFormatPayload {
                        ranges: vec![row6(1)],
                        kind: "colorScale".into(),
                        scale: Some(vec![
                            cf_stop("min", "#ffffff", None),
                            cf_stop("percentile", "#ffeb9c", Some(json!(50))),
                            cf_stop("max", "#63be7b", None),
                        ]),
                        ..Default::default()
                    },
                    CondFormatPayload {
                        ranges: vec![row6(2)],
                        kind: "dataBar".into(),
                        bar: Some(CondFormatBar {
                            min: CondFormatBarStop { t: "min".into(), v: None },
                            max: CondFormatBarStop { t: "max".into(), v: None },
                            pos: "#638ec6".into(),
                            neg: Some("#ff5f5f".into()),
                            grad: Some(false),
                        }),
                        show_value: Some(false),
                        ..Default::default()
                    },
                    CondFormatPayload {
                        ranges: vec![row6(3)],
                        kind: "cell".into(),
                        sub: Some("duplicateValues".into()),
                        fmt: Some(bg("#fff2cc", "", false)),
                        ..Default::default()
                    },
                    CondFormatPayload {
                        ranges: vec![row6(4)],
                        kind: "cell".into(),
                        sub: Some("rank".into()),
                        op: Some("top".into()),
                        v1: Some(json!(2)),
                        fmt: Some(bg("#ddebf3", "#1f4e79", true)),
                        ..Default::default()
                    },
                    CondFormatPayload {
                        ranges: vec![row6(5)],
                        kind: "cell".into(),
                        sub: Some("average".into()),
                        op: Some("greaterThan".into()),
                        fmt: Some(bg("#e2efda", "", false)),
                        ..Default::default()
                    },
                    CondFormatPayload {
                        ranges: vec![row6(6)],
                        kind: "cell".into(),
                        sub: Some("text".into()),
                        op: Some("containsText".into()),
                        v1: Some(json!("报价")),
                        fmt: Some(bg("#fce4d6", "#974706", false)),
                        ..Default::default()
                    },
                    CondFormatPayload {
                        ranges: vec![row6(7)],
                        kind: "iconSet".into(),
                        icon_style: Some("3TrafficLights1".into()),
                        icons: Some(vec![
                            CondFormatIconLevel { op: "greaterThanOrEqual".into(), t: "percentile".into(), v: Some(json!(67)) },
                            CondFormatIconLevel { op: "greaterThanOrEqual".into(), t: "percentile".into(), v: Some(json!(33)) },
                            CondFormatIconLevel { op: "greaterThanOrEqual".into(), t: "num".into(), v: Some(json!(0)) },
                        ]),
                        ..Default::default()
                    },
                ],
                charts: vec![ChartPayload {
                    chart_type: "column".into(),
                    grouping: "standard".into(),
                    title: "色阶与排名".into(),
                    radar_style: None,
                    scatter_style: None,
                    anchor_row: 1,
                    anchor_col: 9,
                    width: 360,
                    height: 240,
                    axes: vec![],
                    series: vec![ChartSeries {
                        name: "E".into(),
                        cat: Some(rf("条件格式", 0, 0, 5, 0)),
                        val: rf("条件格式", 0, 4, 5, 4),
                        cats: vec![],
                        vals: vec![],
                        chart_type: None,
                        secondary_axis: false,
                    }],
                }],
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    /// CDP 与 Excel 对照腿的夹具：写出带八种条件格式与一张图表的 xlsx，并把读回来的载荷一并落成 JSON
    /// （JSON 就是应用打开时看到的那份模型， legs 拿它对表才不是各说各话）
    #[test]
    #[ignore]
    fn gen_cf_print_fixture() {
        let dir = std::env::var("OO_FIXTURE_DIR")
            .unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/../tmp").to_string());
        std::fs::create_dir_all(&dir).ok();
        let path = format!("{dir}/fixture-cf-print.xlsx");
        let notes = write_xlsx_sync(path.clone(), cf_print_workbook()).expect("写夹具失败");
        let back = read_xlsx_sync(path.clone()).expect("读夹具失败");
        std::fs::write(
            format!("{dir}/fixture-cf-print.json"),
            serde_json::to_string_pretty(&back).expect("序列化失败"),
        )
        .ok();
        println!("fixture written: {path}，写侧账目 {notes:?}");
    }

    fn rc(start_row: u32, start_column: u32, end_row: u32, end_column: u32) -> RangeRect {
        RangeRect {
            start_row,
            start_column,
            end_row,
            end_column,
        }
    }

    fn entry(path: &str, name: &str) -> String {
        let file = std::fs::File::open(path).expect("打开产物失败");
        let mut zip = zip::ZipArchive::new(file).expect("产物不是 zip");
        crate::xlsx_style::read_entry(&mut zip, name).unwrap_or_else(|| panic!("产物里没有 {name}"))
    }

    /// 三类规则的形状：写侧结构测试与探针共用同一批字节
    fn rules_workbook() -> WorkbookPayload {
        WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "规则".into(),
                cells: (0..6u32)
                    .map(|r| cell(r, 0, json!(r as f64 * 3.0 - 1.0)))
                    .collect(),
                filter: Some(SheetFilterPayload {
                    range: rc(0, 1, 5, 3),
                    columns: vec![
                        FilterColumnPayload {
                            col: 2,
                            list: Some(vec!["2".into(), "5".into()]),
                            ..Default::default()
                        },
                        FilterColumnPayload {
                            col: 3,
                            custom: Some(CustomFilters {
                                and: Some(false),
                                items: vec![
                                    CustomFilterItem {
                                        op: Some("greaterThan".into()),
                                        v: "3".into(),
                                    },
                                    CustomFilterItem {
                                        op: Some("contains".into()),
                                        v: "甲".into(),
                                    },
                                ],
                            }),
                            ..Default::default()
                        },
                    ],
                    filtered_out: Some(vec![1, 3]),
                }),
                data_validations: vec![
                    DataValidationPayload {
                        ranges: vec![rc(1, 1, 5, 1)],
                        dv_type: "list".into(),
                        f1: Some("甲,乙,丙".into()),
                        dropdown: Some(true),
                        prompt_title: Some("选一个".into()),
                        prompt: Some("只能从这三项里挑".into()),
                        err_style: Some("warning".into()),
                        err_title: Some("不在候选里".into()),
                        err: Some("请改成甲、乙或丙".into()),
                        ..Default::default()
                    },
                    DataValidationPayload {
                        ranges: vec![rc(1, 2, 5, 2), rc(1, 4, 3, 4)],
                        dv_type: "whole".into(),
                        op: Some("between".into()),
                        f1: Some("1".into()),
                        f2: Some("10".into()),
                        dropdown: Some(false),
                        ..Default::default()
                    },
                    DataValidationPayload {
                        ranges: vec![rc(1, 3, 5, 3)],
                        dv_type: "date".into(),
                        op: Some("greaterThanOrEqual".into()),
                        f1: Some("2026-01-01".into()),
                        ..Default::default()
                    },
                ],
                cond_formats: vec![
                    CondFormatPayload {
                        ranges: vec![rc(1, 0, 5, 0)],
                        kind: "cell".into(),
                        sub: Some("number".into()),
                        op: Some("greaterThan".into()),
                        v1: Some(json!(5)),
                        fmt: Some(CondFormatStyle {
                            bg: Some("#ffc7ce".into()),
                            cl: Some("#9c0006".into()),
                            bl: Some(true),
                            ..Default::default()
                        }),
                        stop: Some(true),
                        ..Default::default()
                    },
                    CondFormatPayload {
                        ranges: vec![rc(1, 1, 5, 1)],
                        kind: "colorScale".into(),
                        scale: Some(vec![
                            CondFormatStop {
                                color: "#ffffff".into(),
                                t: "min".into(),
                                v: None,
                            },
                            CondFormatStop {
                                color: "#ffeb9c".into(),
                                t: "percentile".into(),
                                v: Some(json!(50)),
                            },
                            CondFormatStop {
                                color: "#63be7b".into(),
                                t: "max".into(),
                                v: None,
                            },
                        ]),
                        ..Default::default()
                    },
                    CondFormatPayload {
                        ranges: vec![rc(1, 2, 5, 2)],
                        kind: "dataBar".into(),
                        bar: Some(CondFormatBar {
                            min: CondFormatBarStop {
                                t: "min".into(),
                                v: None,
                            },
                            max: CondFormatBarStop {
                                t: "max".into(),
                                v: None,
                            },
                            pos: "#638ec6".into(),
                            neg: Some("#ff5f5f".into()),
                            grad: Some(false),
                        }),
                        show_value: Some(false),
                        ..Default::default()
                    },
                    CondFormatPayload {
                        ranges: vec![rc(1, 4, 5, 4)],
                        kind: "iconSet".into(),
                        icon_style: Some("3Arrows".into()),
                        icons: Some(vec![
                            CondFormatIconLevel {
                                op: "greaterThanOrEqual".into(),
                                t: "percentile".into(),
                                v: Some(json!(67)),
                            },
                            CondFormatIconLevel {
                                op: "greaterThanOrEqual".into(),
                                t: "percentile".into(),
                                v: Some(json!(33)),
                            },
                            CondFormatIconLevel {
                                op: "greaterThanOrEqual".into(),
                                t: "percent".into(),
                                v: Some(json!(0)),
                            },
                        ]),
                        show_value: Some(false),
                        ..Default::default()
                    },
                ],
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    /// 读侧与写侧要认同一份模型：存出去再打开，规则一条条对得上，日期不再是序列号、
    /// colId 不再是相对列、图标集的档位次序也不再反过来
    #[test]
    fn rules_survive_xlsx_round_trip() {
        let path = tmp_path("rules-rt");
        write_xlsx_sync(path.clone(), rules_workbook()).expect("写失败");
        let wb = read_xlsx_sync(path.clone()).expect("读失败");
        let s = &wb.sheets[0];
        assert_eq!(wb.warnings, Vec::<String>::new(), "成形的规则不该欠账");

        // ---- 筛选：区域原样、colId 换回绝对列号、两种条件形状各归各位 ----
        let f = s.filter.as_ref().expect("筛选读回来了");
        assert_eq!(f.range, rc(0, 1, 5, 3), "筛选区域");
        assert_eq!(f.columns.len(), 2, "两条列条件");
        assert_eq!(f.columns[0].col, 2, "colId=1 要加回筛选区首列");
        assert_eq!(
            f.columns[0].list.clone().unwrap_or_default(),
            vec!["2".to_string(), "5".to_string()],
            "候选值"
        );
        assert_eq!(f.columns[1].col, 3);
        let cu = f.columns[1].custom.as_ref().expect("自定义条件");
        assert_eq!(cu.and, Some(false), "或关系读回 and=false");
        assert_eq!(
            cu.items
                .iter()
                .map(|x| (x.op.as_deref().unwrap_or("").to_string(), x.v.clone()))
                .collect::<Vec<_>>(),
            vec![("greaterThan".into(), "3".into()), ("contains".into(), "甲".into())],
            "带通配符的等于要退化成 contains，而不是留个 *甲* 在界面上"
        );
        let out = f.filtered_out.clone().unwrap_or_default();
        assert!(
            !out.is_empty() && out.iter().all(|r| *r > 0 && *r <= 5),
            "被筛掉的行从隐藏行里分出来：{out:?}"
        );

        // ---- 数据验证：三种类型、下拉箭头的极性、日期从序列号回到日期串 ----
        assert_eq!(s.data_validations.len(), 3);
        let list = &s.data_validations[0];
        assert_eq!(list.dv_type, "list");
        assert_eq!(list.ranges, vec![rc(1, 1, 5, 1)]);
        assert_eq!(list.f1.as_deref(), Some("甲,乙,丙"), "候选串脱掉外层引号");
        assert_eq!(list.dropdown, Some(true), "没写 showDropDown 即有箭头");
        assert_eq!(list.prompt.as_deref(), Some("只能从这三项里挑"));
        assert_eq!(list.err_style.as_deref(), Some("warning"));
        let whole = &s.data_validations[1];
        assert_eq!(whole.dv_type, "whole");
        assert_eq!(
            whole.op.as_deref().unwrap_or("between"),
            "between",
            "OOXML 的缺省比较符是 between，不落属性"
        );
        assert_eq!(whole.ranges, vec![rc(1, 2, 5, 2), rc(1, 4, 3, 4)], "多块区域逐块认回");
        assert_eq!(
            whole.dropdown, None,
            "showDropDown 只对列表有意义，别的类型不臆造箭头"
        );
        let date = &s.data_validations[2];
        assert_eq!(date.dv_type, "date");
        assert_eq!(date.op.as_deref(), Some("greaterThanOrEqual"));
        assert_eq!(date.f1.as_deref(), Some("2026-01-01"), "序列号 46023 换回日期串");

        // ---- 条件格式：顺序即优先级，四条各走各路 ----
        assert_eq!(s.cond_formats.len(), 4, "四条规则的条数");
        let kinds: Vec<&str> = s.cond_formats.iter().map(|c| c.kind.as_str()).collect();
        assert_eq!(kinds, vec!["cell", "colorScale", "dataBar", "iconSet"], "顺序不能整表反过来");

        let cell_rule = &s.cond_formats[0];
        assert_eq!(cell_rule.ranges, vec![rc(1, 0, 5, 0)]);
        assert_eq!(cell_rule.sub.as_deref(), Some("number"));
        assert_eq!(cell_rule.op.as_deref(), Some("greaterThan"));
        assert_eq!(cell_rule.v1.as_ref().and_then(Value::as_f64), Some(5.0));
        assert_eq!(cell_rule.stop, Some(true));
        let fmt = cell_rule.fmt.as_ref().expect("dxfId 指到的样式");
        assert_eq!(fmt.bg.as_deref(), Some("#ffc7ce"), "dxf 的 bgColor 是底纹");
        assert_eq!(fmt.cl.as_deref(), Some("#9c0006"));
        assert_eq!(fmt.bl, Some(true));

        let scale = s.cond_formats[1].scale.as_ref().expect("色阶");
        assert_eq!(scale.len(), 3);
        assert_eq!(scale[1].t, "percentile");
        assert_eq!(scale[1].v.as_ref().and_then(Value::as_f64), Some(50.0));
        assert_eq!(
            scale.iter().map(|x| x.color.as_str()).collect::<Vec<_>>(),
            vec!["#ffffff", "#ffeb9c", "#63be7b"]
        );
        // min/max 档的 val 在文件里是占位的 0，留着只会让界面上显示个假数字
        assert!(scale[0].v.is_none() && scale[2].v.is_none());

        let bar = s.cond_formats[2].bar.as_ref().expect("数据条");
        assert_eq!(bar.pos, "#638ec6");
        assert_eq!(bar.min.t, "min");
        assert_eq!(bar.neg.as_deref(), Some("#ff5f5f"), "负色只在 x14 扩展里，按 GUID 认回");
        assert_eq!(bar.grad, Some(false), "实心条的 gradient=0 要读成 false");
        assert_eq!(s.cond_formats[2].show_value, Some(false));

        let icons = s.cond_formats[3].icons.as_ref().expect("图标集");
        assert_eq!(s.cond_formats[3].icon_style.as_deref(), Some("3Arrows"));
        assert_eq!(
            icons.iter().map(|x| x.v.as_ref().and_then(Value::as_f64)).collect::<Vec<_>>(),
            vec![Some(67.0), Some(33.0), Some(0.0)],
            "cfvo 是低→高，载荷是高→低"
        );
        assert_eq!(icons[0].t, "percentile");
        assert_eq!(icons[2].t, "percent");
        std::fs::remove_file(&path).ok();
    }

    /// 别人写的件：认不出的判定型、按颜色筛选、区域里读不懂的片段，都要说得出而不是少给
    #[test]
    fn foreign_rules_report_what_cant_be_read() {
        let xml = r#"<worksheet xmlns="x"><dimension ref="A1:D9"/>
          <autoFilter ref="A1:D9"><filterColumn colId="1">
            <customFilters and="1"><customFilter operator="beginsWith" val="开"/></customFilters>
            <colorFilters><colorFilter dxfId="0"/></colorFilters>
          </filterColumn></autoFilter>
          <dataValidations count="3">
            <dataValidation type="textLength" operator="between" allowBlank="1" sqref="B2:B9">
              <formula1>2</formula1><formula2>6</formula2>
            </dataValidation>
            <dataValidation type="custom" sqref="C2:C9"><formula1>B2&lt;C2</formula1></dataValidation>
            <dataValidation type="list" showDropDown="1" sqref="D2:D9"><formula1>"甲,乙"</formula1></dataValidation>
          </dataValidations>
          <conditionalFormatting sqref="A2:A9"><cfRule type="containsText" operator="containsText"
            text="甲" priority="1"><formula>NOT(ISERROR(SEARCH("甲",A2)))</formula></cfRule></conditionalFormatting>
          <conditionalFormatting sqref="B2:B9"><cfRule type="aboveAverage" priority="2"/></conditionalFormatting>
          <conditionalFormatting sqref="C2:C9"><cfRule type="top10" percent="1" bottom="1" rank="20" priority="3"/></conditionalFormatting>
          <conditionalFormatting sqref="A:A"><cfRule type="expression" priority="4"><formula>AND($A1&gt;1)</formula></cfRule></conditionalFormatting>
        </worksheet>"#;
        let got = crate::xlsx_rules::read_sheet_rules(xml, &[3, 7], &[]);
        // 整列引用读不懂：规则不猜区域，只记账
        assert_eq!(got.cond_formats.len(), 3, "读不懂区域的规则不收：{:?}", got.notes);
        let t = got.cond_formats[0].sub.as_deref();
        assert_eq!(t, Some("text"), "containsText 归到文本子型");
        assert_eq!(got.cond_formats[0].op.as_deref(), Some("containsText"));
        assert_eq!(
            got.cond_formats[0].v1.as_ref().and_then(Value::as_str),
            Some("甲"),
            "判定文本取自 @text 而不是那串 SEARCH 公式"
        );
        assert_eq!(got.cond_formats[1].sub.as_deref(), Some("average"));
        assert_eq!(
            got.cond_formats[1].op.as_deref(),
            Some("greaterThan"),
            "aboveAverage 缺省即「大于均值」，界面按 CFNumberOperator 走"
        );
        assert_eq!(got.cond_formats[2].op.as_deref(), Some("bottomPercent"));
        assert_eq!(got.cond_formats[2].v1.as_ref().and_then(Value::as_f64), Some(20.0));
        // 装不下的两样：按颜色筛选 + 整列引用
        assert!(got.notes.iter().any(|n| n.contains("颜色")), "{:?}", got.notes);
        assert!(got.notes.iter().any(|n| n.contains("区域")), "{:?}", got.notes);
        assert_eq!(
            got.filter.as_ref().unwrap().columns[0]
                .custom
                .as_ref()
                .unwrap()
                .items[0]
                .op
                .as_deref(),
            Some("beginsWith")
        );
        assert_eq!(
            got.filter.as_ref().unwrap().filtered_out.clone().unwrap_or_default(),
            vec![3u32, 7],
            "筛选区里的隐藏行算「被筛掉」，交回打印"
        );
        assert_eq!(got.data_validations.len(), 3);
        assert_eq!(got.data_validations[0].dv_type, "textLength");
        assert_eq!(got.data_validations[0].f2.as_deref(), Some("6"));
        assert_eq!(
            got.data_validations[0].blank,
            Some(true),
            "allowBlank 读回「允许空」"
        );
        assert_eq!(
            got.data_validations[1].f1.as_deref(),
            Some("B2<C2"),
            "转义实体要还原"
        );
        assert_eq!(got.data_validations[2].f1.as_deref(), Some("甲,乙"));
        assert_eq!(
            got.data_validations[2].dropdown,
            Some(false),
            "列表的 showDropDown=1 即藏起箭头"
        );
        assert_eq!(
            got.data_validations[2].blank,
            None,
            "没写 allowBlank 就不臆造「允许空」"
        );
    }

    #[test]
    fn dxf_table_reads_its_own_shape() {
        let xml = r#"<styleSheet xmlns="x"><dxfs count="3">
            <dxf><font><b/><color rgb="FF9C0006"/></font><fill><patternFill><bgColor rgb="FFFFC7CE"/></patternFill></fill></dxf>
            <dxf><font><i/><u/><strike/><color indexed="10"/></font></dxf>
            <dxf><fill><patternFill patternType="solid"><fgColor rgb="FFFFFFCC"/></patternFill></fill></dxf>
          </dxfs></styleSheet>"#;
        let dxfs = crate::xlsx_style::parse_dxfs(xml);
        assert_eq!(dxfs.len(), 3);
        assert_eq!(dxfs[0].bg.as_deref(), Some("#ffc7ce"), "dxf 的底纹住在 bgColor");
        assert_eq!(dxfs[0].cl.as_deref(), Some("#9c0006"));
        assert_eq!(dxfs[0].bl, Some(true));
        assert_eq!(dxfs[1].it, Some(true));
        assert_eq!(dxfs[1].ul, Some(true));
        assert_eq!(dxfs[1].st, Some(true));
        assert_eq!(dxfs[1].cl, None, "indexed 色我们解不出，宁可不给");
        assert_eq!(dxfs[2].bg.as_deref(), Some("#ffffcc"), "别的工具写 fgColor 也认");
        assert!(crate::xlsx_style::parse_dxfs(r#"<styleSheet><dxfs count="0"/></styleSheet>"#).is_empty());
    }

    #[test]
    fn rules_land_in_xlsx_xml() {
        let path = tmp_path("rules");
        let notes = write_xlsx_sync(path.clone(), rules_workbook()).expect("写失败");
        assert_eq!(notes, Vec::<String>::new(), "成形的规则不该欠账");
        let sheet = entry(&path, "xl/worksheets/sheet1.xml");

        // 筛选：载荷里的列是绝对列号，落盘的 colId 相对筛选区首列（B1:D6 里 C→1、D→2）
        assert!(sheet.contains(r#"<autoFilter ref="B1:D6">"#), "筛选区域");
        assert!(
            sheet.contains(r#"<filterColumn colId="1">"#),
            "候选值条件的 colId 换算"
        );
        assert!(
            sheet.contains(r#"<filterColumn colId="2">"#),
            "自定义条件的 colId 换算"
        );
        assert!(
            sheet.contains(r#"<filter val="2"/>"#) && sheet.contains(r#"<filter val="5"/>"#),
            "候选值"
        );
        assert!(
            sheet.contains(r#"<customFilter operator="greaterThan" val="3"/>"#),
            "自定义比较"
        );
        // crate 的 contains 走 Excel 2007 的老写法：通配符进 val、operator 省略（默认 equal
        // 但带通配符即"包含"），读侧要认这个形状才退得回来
        assert!(sheet.contains(r#"<customFilter val="*甲*"/>"#), "包含条件落成通配符");
        // 条件写得进就得真筛得出：crate 在存盘时按条件把不匹配的行藏起来，与 Excel 同形
        assert!(sheet.contains(r#"hidden="1""#), "筛掉的行落成隐藏行");

        // 数据验证：三种类型、提示与出错文字、多块区域
        assert!(sheet.contains(r#"type="list""#), "列表验证");
        assert!(
            sheet.contains(r#"<formula1>"甲,乙,丙"</formula1>"#),
            "内联候选串"
        );
        assert!(sheet.contains(r#"prompt="只能从这三项里挑""#), "输入提示");
        assert!(sheet.contains(r#"errorStyle="warning""#), "出错样式");
        assert!(
            sheet.contains(r#"sqref="C2:C6 E2:E4""#),
            "多块区域要一起带过去（crate 的 set_multi_range 是整串替换，漏了第一块就是整块区域凭空不见）"
        );
        assert!(sheet.contains(r#"type="date""#), "日期验证");
        assert!(
            sheet.contains(r#"<formula1>46023</formula1>"#),
            "日期落成 Excel 序列号"
        );
        assert!(!sheet.contains("2026-01-01"), "载荷里的日期字面不该进文件");
        let list_tag = sheet
            .split(r#"type="list""#)
            .nth(1)
            .unwrap()
            .split("</dataValidation>")
            .next()
            .unwrap();
        // dropdown 是界面语义（有没有下拉箭头）；OOXML 只在"藏箭头"时写 showDropDown="1"
        assert!(
            !list_tag.contains("showDropDown"),
            "有箭头的列表不该写 showDropDown"
        );
        assert!(
            sheet.contains(r#"showDropDown="1""#),
            "关掉箭头才落 showDropDown"
        );

        // 条件格式：四条规则各走各路，数组顺序即优先级（高在前，与 OOXML 的 cfRule 顺序同向）
        assert!(
            sheet.contains(
                r#"<cfRule type="cellIs" dxfId="0" priority="1" stopIfTrue="1" operator="greaterThan">"#
            ),
            "单元格条件 + 停在真"
        );
        assert!(
            sheet.contains(r#"<cfRule type="colorScale" priority="2">"#)
                && sheet.contains(r#"rgb="FFFFEB9C""#),
            "三色色阶"
        );
        assert!(
            sheet.contains(r#"<dataBar showValue="0">"#),
            "数据条（只显条不显值）"
        );
        assert!(sheet.contains(r#"iconSet="3Arrows""#), "图标集家族名");
        assert!(
            sheet.contains(r#"<cfRule type="iconSet" priority="4">"#),
            "图标集优先级排在载荷第 4 位"
        );
        let styles = entry(&path, "xl/styles.xml");
        assert!(styles.contains(r#"<dxfs count="1">"#), "dxf 表写进了 styles");
        assert!(styles.contains(r#"<bgColor rgb="FFFFC7CE"/>"#), "dxf 底纹色");
        assert!(styles.contains("<b/>"), "dxf 加粗");
        std::fs::remove_file(&path).ok();
    }

    /// 欠账也要记得住：越界的列条件与摆不出的色阶都要说得出，而不是静默少给一条规则
    #[test]
    fn rules_ledger_records_what_cant_be_written() {
        let path = tmp_path("rules-debt");
        let wb = WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "欠账".into(),
                cells: vec![cell(0, 0, json!("x"))],
                filter: Some(SheetFilterPayload {
                    range: rc(0, 0, 2, 1),
                    columns: vec![FilterColumnPayload {
                        col: 7,
                        blank: Some(true),
                        ..Default::default()
                    }],
                    ..Default::default()
                }),
                cond_formats: vec![CondFormatPayload {
                    ranges: vec![rc(0, 0, 2, 0)],
                    kind: "colorScale".into(),
                    scale: Some(vec![CondFormatStop {
                        color: "#ffffff".into(),
                        t: "min".into(),
                        v: None,
                    }]),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        };
        let notes = write_xlsx_sync(path.clone(), wb).expect("写失败");
        std::fs::remove_file(&path).ok();
        assert!(
            notes.iter().any(|x| x.contains("筛选")),
            "越界的列条件要记进账：{notes:?}"
        );
        assert!(
            notes.iter().any(|x| x.contains("色阶")),
            "档数不对的色阶要记进账：{notes:?}"
        );
    }

    /// `xl/styles.xml` 里第一条 `<font>`（就是 Normal 那条）。`<fonts count=…>` 不会误匹配：找的是带 `>` 的那一枚
    fn first_font(styles_xml: &str) -> String {
        let from = styles_xml.find("<font>").expect("产物里没有 <font>");
        let rest = &styles_xml[from..];
        rest[..rest.find("</font>").expect("<font> 没关")].to_string()
    }

    /// 载荷说了工作簿默认字体 ⇒ 它落在 `fonts[0]`，而且读得回来。
    /// 反面是同一条链路的另一半：`sheetFormatPr` 不许被带动（行高/列宽是交回 crate 自己的默认）
    #[test]
    fn default_font_declared_lands_in_fonts_zero() {
        let path = tmp_path("df-on");
        let wb = WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "默认字体".into(),
                cells: vec![cell(0, 0, json!("一格"))],
                ..Default::default()
            }],
            default_font: Some(DefaultFont {
                ff: Some("宋体".into()),
                fs: Some(14.0),
            }),
            ..Default::default()
        };
        let notes = write_xlsx_sync(path.clone(), wb).expect("写失败");
        assert!(notes.iter().all(|x| !x.contains("默认字体没写进去")), "{notes:?}");
        let styles = entry(&path, "xl/styles.xml");
        let font = first_font(&styles);
        assert!(font.contains(r#"<sz val="14"/>"#), "字号那一条要上纸：{font}");
        assert!(
            font.contains(r#"<name val="宋体"/>"#),
            "族名照文件原样落笔、不归一成 Calibri：{font}"
        );
        // 实测的形状：crate 写默认那条时带 sz/color/name/family 而没有 scheme——
        // 而 Excel 在 Normal 被改过之后也正是这样丢掉 scheme 的（v0.57 前置实测那条），两家同档
        assert!(
            !font.contains("scheme"),
            "改过默认族名就不该再声明主题字族：{font}"
        );
        assert!(
            entry(&path, "xl/worksheets/sheet1.xml").contains(r#"<sheetFormatPr defaultRowHeight="15"/>"#),
            "行高仍交回 crate 那一档（只动字体那一层）"
        );
        let back = read_xlsx_sync(path.clone()).expect("读回失败");
        std::fs::remove_file(&path).ok();
        assert_eq!(
            back.default_font,
            Some(DefaultFont {
                ff: Some("宋体".into()),
                fs: Some(14.0)
            }),
            "往返：读侧认的是 cellXfs[0]@fontId 指到的那一条"
        );
    }

    /// 载荷没说 ⇒ 输出形状与这一轮之前一字不差（crate 自己的 Calibri 11 那一条）。
    /// 注意读回来仍是 `Some(Calibri, 11)`：这一层在文件里永远存在，OOXML 没有"不声明默认字体"这个形状
    #[test]
    fn default_font_absent_keeps_crate_shape() {
        let path = tmp_path("df-off");
        let wb = WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "没声明".into(),
                cells: vec![cell(0, 0, json!("一格"))],
                ..Default::default()
            }],
            ..Default::default()
        };
        write_xlsx_sync(path.clone(), wb).expect("写失败");
        let styles = entry(&path, "xl/styles.xml");
        let font = first_font(&styles);
        assert!(
            font.contains(r#"<name val="Calibri"/>"#) && font.contains(r#"<sz val="11"/>"#),
            "没声明就不许多写字幕：{font}"
        );
        std::fs::remove_file(&path).ok();
    }

    /// 存两次盘这一层不许自己漂走（第二次写吃的已经是第一次写出来的那份字节）
    #[test]
    fn default_font_survives_second_save() {
        let path = tmp_path("df-twice");
        let wb = || WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "两趟".into(),
                cells: vec![cell(0, 0, json!("一格"))],
                ..Default::default()
            }],
            default_font: Some(DefaultFont {
                ff: Some("等线".into()),
                fs: Some(12.0),
            }),
            ..Default::default()
        };
        write_xlsx_sync(path.clone(), wb()).expect("第一趟写失败");
        let first = read_xlsx_sync(path.clone()).expect("第一趟读回失败");
        write_xlsx_sync(path.clone(), first).expect("第二趟写失败");
        let styles = entry(&path, "xl/styles.xml");
        let second = read_xlsx_sync(path.clone()).expect("第二趟读回失败");
        std::fs::remove_file(&path).ok();
        assert_eq!(
            second.default_font,
            Some(DefaultFont {
                ff: Some("等线".into()),
                fs: Some(12.0)
            }),
            "两趟之后仍是同一档"
        );
        assert!(
            first_font(&styles).contains(r#"<name val="等线"/>"#),
            "第二趟的字节里仍是那一族：{}",
            first_font(&styles)
        );
    }

    /// 取某一格 `<c>` 的开头标签原文（找不到返回空串，好把上下文带进断言）
    fn cell_tag(sheet_xml: &str, refs: &str) -> String {
        let mut at = 0;
        while let Some(i) = sheet_xml[at..].find("<c ") {
            let start = at + i;
            let end = start + sheet_xml[start..].find('>').unwrap_or(0) + 1;
            let tag = &sheet_xml[start..end];
            if tag.contains(&format!(r#"r="{refs}""#)) {
                return tag.to_string();
            }
            at = end;
        }
        String::new()
    }

    /// 逐条 `<font>`——`fontId` 指的就是这个序，按位置取而不是按名字找
    fn font_blocks(styles_xml: &str) -> Vec<String> {
        let mut out = Vec::new();
        let mut at = 0;
        while let Some(i) = styles_xml[at..].find("<font>") {
            let start = at + i;
            let Some(j) = styles_xml[start..].find("</font>") else { break };
            out.push(styles_xml[start..start + j].to_string());
            at = start + j;
        }
        out
    }

    /// 载荷没说样式的格子，存盘不许盖上显式 xf：Excel 原件里那一格是靠**继承 Normal** 拿字号的，
    /// 盖上 `s="1"` 就是把正文从文件那一层摘下来接到我们的常量上（v0.57 量出来的那条）
    #[test]
    fn unstyled_cells_write_no_explicit_xf() {
        let path = tmp_path("no-xf");
        let mut bold = cell(1, 0, json!("加粗"));
        bold.s = Some(CellStyle { bl: true, ..Default::default() });
        let mut blank = cell(3, 0, json!("空样式"));
        blank.s = Some(CellStyle::default());
        let mut formula = cell(4, 0, json!(4));
        formula.f = Some("=2+2".into());
        let wb = WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "继承".into(),
                cells: vec![cell(0, 0, json!("正文")), bold, cell(2, 0, json!(7)), blank, formula],
                ..Default::default()
            }],
            default_font: Some(DefaultFont {
                ff: Some("宋体".into()),
                fs: Some(14.0),
            }),
            ..Default::default()
        };
        write_xlsx_sync(path.clone(), wb).expect("写失败");
        let sheet = entry(&path, "xl/worksheets/sheet1.xml");
        for r in ["A1", "A3", "A4", "A5"] {
            let tag = cell_tag(&sheet, r);
            assert!(!tag.is_empty() && !tag.contains(" s="), "{r} 那一格没样式，不许盖上显式 xf：{tag}");
        }
        let bold_tag = cell_tag(&sheet, "A2");
        assert!(bold_tag.contains(" s="), "说了加粗的照旧要有自己的那一条 xf：{bold_tag}");
        // 第二趟吃的是第一趟的字节，形状不许自己长回来
        let back = read_xlsx_sync(path.clone()).expect("读回失败");
        let plain = back.sheets[0]
            .cells
            .iter()
            .find(|x| x.r == 0 && x.c == 0)
            .expect("正文那格读不回来");
        assert!(plain.s.is_none(), "读回来的正文格也不该带样式：{:?}", plain.s);
        write_xlsx_sync(path.clone(), back).expect("第二趟写失败");
        let tag = cell_tag(&entry(&path, "xl/worksheets/sheet1.xml"), "A1");
        assert!(!tag.contains(" s="), "存两次盘不许把 xf 盖回来：{tag}");
        std::fs::remove_file(&path).ok();
    }

    /// 格子里只说了"加粗"、没说字号字族 ⇒ 底数跟文件那一层走，而不是落到 crate 的 Calibri/11 上
    #[test]
    fn partial_style_seeds_from_workbook_font() {
        let path = tmp_path("seed-on");
        let mut bold = cell(0, 0, json!("加粗"));
        bold.s = Some(CellStyle { bl: true, ..Default::default() });
        let wb = WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "种".into(),
                cells: vec![bold],
                ..Default::default()
            }],
            default_font: Some(DefaultFont {
                ff: Some("宋体".into()),
                fs: Some(14.0),
            }),
            ..Default::default()
        };
        write_xlsx_sync(path.clone(), wb).expect("写失败");
        let styles = entry(&path, "xl/styles.xml");
        let f = font_blocks(&styles)
            .into_iter()
            .find(|x| x.contains("<b/>"))
            .unwrap_or_default();
        assert!(
            f.contains(r#"<sz val="14"/>"#) && f.contains(r#"<name val="宋体"/>"#) && !f.contains("Calibri"),
            "加粗那格该继承工作簿默认字体那一层：{f}"
        );
        std::fs::remove_file(&path).ok();
    }

    /// 反面：文件那一层没说话时不许凭空造一层——载荷没给默认字体，加粗格仍是 crate 的 Calibri/11
    #[test]
    fn partial_style_without_default_keeps_crate_font() {
        let path = tmp_path("seed-off");
        let mut bold = cell(0, 0, json!("加粗"));
        bold.s = Some(CellStyle { bl: true, ..Default::default() });
        let wb = WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "没种".into(),
                cells: vec![bold],
                ..Default::default()
            }],
            ..Default::default()
        };
        write_xlsx_sync(path.clone(), wb).expect("写失败");
        let styles = entry(&path, "xl/styles.xml");
        let f = font_blocks(&styles)
            .into_iter()
            .find(|x| x.contains("<b/>"))
            .unwrap_or_default();
        assert!(
            f.contains(r#"<sz val="11"/>"#) && f.contains(r#"<name val="Calibri"/>"#),
            "没有工作簿默认字体可跟时就照旧用 crate 那一档：{f}"
        );
        std::fs::remove_file(&path).ok();
    }

    /// 文件说的正是 crate 那一档（Calibri/11）时一个字都不种：实测显式写出来的那两条没有
    /// `<scheme val="minor"/>`，种了等于把"字族跟着主题走"这一条弄丢
    #[test]
    fn crate_default_font_is_not_restated() {
        let path = tmp_path("df-calibri");
        let mut bold = cell(1, 0, json!("加粗"));
        bold.s = Some(CellStyle { bl: true, ..Default::default() });
        let wb = WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "同一档".into(),
                cells: vec![cell(0, 0, json!("正文")), bold],
                ..Default::default()
            }],
            default_font: Some(DefaultFont {
                ff: Some("Calibri".into()),
                fs: Some(11.0),
            }),
            ..Default::default()
        };
        write_xlsx_sync(path.clone(), wb).expect("写失败");
        let styles = entry(&path, "xl/styles.xml");
        assert!(
            first_font(&styles).contains(r#"<scheme val="minor"/>"#),
            "同一档不许多写一遍，写了就把主题那条 scheme 弄丢：{}",
            first_font(&styles)
        );
        let back = read_xlsx_sync(path.clone()).expect("读回失败");
        assert_eq!(
            back.default_font,
            Some(DefaultFont { ff: Some("Calibri".into()), fs: Some(11.0) }),
            "省掉那一笔之后，读侧仍该认得出这一层是 Calibri/11"
        );
        std::fs::remove_file(&path).ok();
    }

    /// v0.58 只读腿的成对夹具，两份吃同一份字节形状、只有正文那一层不同：
    /// `b-inherit` 正文格不带样式（写侧本轮让 `<c>` 上没有 `s=`，字号该从 Normal=宋体/14 继承下来），
    /// `b-stamped` 正文格明写 Calibri/11（正是本轮之前我们盖上去的那一档，也就是 v0.57 在 Excel 纸上量到 1.276 的形状）。
    /// 两件的页眉都只有工作簿默认字体那一层可跟，所以 Excel 自己导出的 PDF 上「页眉/正文」比一份≈1.000、一份≈14/11
    #[test]
    #[ignore]
    fn gen_inherit_fixture() {
        let dir = std::env::var("OO_FIXTURE_DIR")
            .unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/../tmp/x58").to_string());
        std::fs::create_dir_all(&dir).expect("夹具目录建不出来");
        let rows = 8u32;
        let cols = 3u32;
        let print = || SheetPrintPayload {
            orientation: Some("portrait".into()),
            paper_size: Some(9),
            scale: Some(100),
            header: Some(PrintHfPayload {
                odd: Some("&L{TAG}左&C{TAG}中&R{TAG}右".into()),
                ..Default::default()
            }),
            ..Default::default()
        };
        // stamped=true 时每个正文格都明写 Calibri/11：这是"我们的常量"那一档，不是文件那一层
        let body = |stamped: bool| -> Vec<CellPayload> {
            (0..rows)
                .flat_map(|r| {
                    (0..cols).map(move |c| CellPayload {
                        r,
                        c,
                        v: Some(json!(format!("R{}C{}", r + 1, c + 1))),
                        s: stamped.then(|| CellStyle {
                            ff: Some("Calibri".into()),
                            fs: Some(11.0),
                            ..Default::default()
                        }),
                        ..Default::default()
                    })
                })
                .collect()
        };
        let cases = ["inherit", "stamped"];
        let mut all: Vec<String> = Vec::new();
        for tag in cases {
            let path = format!("{dir}/b-{tag}.xlsx");
            let mut cells = body(tag == "stamped");
            // 加粗那一格两份都只说"加粗"、不说字号：这一格的底数正该由文件那一层给
            let mut bold = cell(0, 3, json!("BOLD"));
            bold.s = Some(CellStyle {
                bl: true,
                ..Default::default()
            });
            cells.push(bold);
            // 页眉串里的 {TAG} 换成件名，好让 pdf.js 认得出哪一行是页眉
            let mut pr = print();
            if let Some(h) = pr.header.as_mut() {
                h.odd = h.odd.take().map(|v| v.replace("{TAG}", tag));
            }
            let book = WorkbookPayload {
                sheets: vec![SheetPayload {
                    name: "继承".into(),
                    cells,
                    print: Some(pr),
                    ..Default::default()
                }],
                default_font: Some(DefaultFont {
                    ff: Some("宋体".into()),
                    fs: Some(14.0),
                }),
                ..Default::default()
            };
            // 夹具一趟写成，不走"读回再写"：b-stamped 那一档 Calibri/11 会被读侧的归一化成
            // 没说话（本轮那条当我说），重写一趟就会把对照件写成实验件
            let mut notes = write_xlsx_sync(path.clone(), book).expect("夹具写出失败");
            notes.insert(0, format!("b-{tag} 写出"));
            all.push(notes.join(" | "));
        }
        println!("夹具目录: {dir}\n{}", all.join("\n"));
    }

    /// v0.59 量正文底数用的成对夹具：内容一字不差，只有工作簿默认字体那一层不同
    /// （`bb-11` = Calibri/11、`bb-14` = 宋体/14），于是"同一张表在两种底数下纸上会怎么排"是可比的两份。
    /// 40 行是给分页留的余地（底数一档、一页少几行就可能多出一页），第 3 列那条长串是给换行留的余地
    /// （列宽按 MDW=7 换算、不跟字体走，底数一大同一格就要多折一行），第 4 行另给了显式行高
    #[test]
    #[ignore]
    fn gen_bodybase_fixture() {
        let dir = std::env::var("OO_FIXTURE_DIR")
            .unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/../tmp/x59").to_string());
        std::fs::create_dir_all(&dir).expect("夹具目录建不出来");
        let rows = 40u32;
        let cases: Vec<(&str, DefaultFont)> = vec![
            ("11", DefaultFont { ff: Some("Calibri".into()), fs: Some(11.0) }),
            ("14", DefaultFont { ff: Some("宋体".into()), fs: Some(14.0) }),
        ];
        let mut all: Vec<String> = Vec::new();
        for (tag, def) in cases {
            let path = format!("{dir}/bb-{tag}.xlsx");
            // 第 2 列首行放那条长串（同一格不重复登记）：底数从 8.25pt 抬到 11pt 时
            // 它在同一列宽里就要多折一行——列宽是按 MDW=7 换算的、不跟字体走，这正是耦合点
            let mut cells: Vec<CellPayload> = (0..rows)
                .flat_map(|r| {
                    (0..4u32).map(move |c| CellPayload {
                        r,
                        c,
                        v: Some(json!(
                            if r == 0 && c == 2 {
                                "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345".to_string()
                            } else {
                                format!("R{}C{}", r + 1, c + 1)
                            }
                        )),
                        ..Default::default()
                    })
                })
                .collect();
            // 加粗那一格只说"加粗"、不说字号：这一格的底数正该由文件那一层给
            let mut bold = cell(1, 4, json!("BOLD"));
            bold.s = Some(CellStyle {
                bl: true,
                ..Default::default()
            });
            cells.push(bold);
            let book = WorkbookPayload {
                sheets: vec![SheetPayload {
                    name: "底数".into(),
                    cells,
                    col_widths: [(0u32, 96.0), (1, 96.0), (2, 96.0), (3, 150.0), (4, 96.0)]
                        .into_iter()
                        .collect(),
                    row_heights: [(4u32, 30.0)].into_iter().collect(),
                    print: Some(SheetPrintPayload {
                        orientation: Some("portrait".into()),
                        paper_size: Some(9),
                        scale: Some(100),
                        header: Some(PrintHfPayload {
                            odd: Some(format!("&Lbb-{tag}左&Cbb-{tag}中&Rbb-{tag}右")),
                            ..Default::default()
                        }),
                        ..Default::default()
                    }),
                    ..Default::default()
                }],
                default_font: Some(def),
                ..Default::default()
            };
            let mut notes = write_xlsx_sync(path.clone(), book).expect("夹具写出失败");
            notes.insert(0, format!("bb-{tag} 写出"));
            all.push(notes.join(" | "));
        }
        println!("夹具目录: {dir}\n{}", all.join("\n"));
    }

    /// 判别（v0.60 裁决的依据）：crate 的 `set_default_row_height` 用在这一层上会多干两件事。
    /// 行是**存盘那一刻**才落进 XML 的，所以先设后设一个样——每一行没带过行高的行都被盖上
    /// `ht` + `customHeight="1"`（v0.58 立的"没声明过的东西不盖章"在这一维上被它破了）；
    /// 又因为它内部按整数像素存，17.5pt 落纸是 17.25（磅字面在字节上漂了 0.25，与逐行那条
    /// `set_row_height_pixels` 的截断同一家）。所以这一层不吃这枚 setter，走存盘后的定点重打包。
    #[test]
    fn crate_default_row_height_setter_stamps_every_row() {
        use rust_xlsxwriter::Workbook as RawWorkbook;

        let shape = |set_it: bool| -> (String, Vec<String>) {
            let path = tmp_path(if set_it { "drh-set" } else { "drh-raw" });
            let mut wb = RawWorkbook::new();
            let ws = wb.add_worksheet();
            ws.write(0, 0, "A1").unwrap();
            ws.write(1, 0, "A2").unwrap();
            ws.write_string(3, 0, "A4").unwrap();
            if set_it {
                ws.set_default_row_height(17.5);
            }
            let _ = ws.set_row_height(2, 30.0);
            std::fs::write(&path, wb.save_to_buffer().unwrap()).expect("写出失败");
            let xml = entry(&path, "xl/worksheets/sheet1.xml");
            std::fs::remove_file(&path).ok();
            let fmt = xml
                .split("<sheetFormatPr")
                .nth(1)
                .map(|s| format!("<sheetFormatPr{}", &s[..s.find('>').unwrap() + 1]))
                .unwrap_or_default();
            let rows = xml
                .split("<row ")
                .skip(1)
                .map(|s| format!("<row {}", &s[..s.find('>').unwrap() + 1]))
                .collect();
            (fmt, rows)
        };

        let (fmt, rows) = shape(false);
        assert_eq!(fmt, r#"<sheetFormatPr defaultRowHeight="15"/>"#, "不设时 crate 落它那枚常量");
        assert_eq!(rows.iter().filter(|r| r.contains(" ht=")).count(), 1, "只有明说过的那行带 ht：{rows:?}");
        assert!(rows[0].contains(r#"r="1""#) && !rows[0].contains("ht="), "第一行本来是不盖章的：{}", rows[0]);

        let (fmt, rows) = shape(true);
        assert!(
            fmt.contains(r#"defaultRowHeight="17.25""#) && fmt.contains(r#"customHeight="1""#),
            "setter 落的字面（17.5 在这里已经变成 17.25）：{fmt}"
        );
        assert!(!fmt.contains("17.5"), "17.5pt 在这一枚 setter 手里存不住：{fmt}");
        assert_eq!(rows.len(), 4);
        for (i, r) in rows.iter().enumerate() {
            if i == 2 {
                continue; // 那一行是明说的 30pt
            }
            assert!(
                r.contains(r#"ht="17.25""#) && r.contains(r#"customHeight="1""#),
                "缺省行高被盖成了每一行的显式行高：{r}"
            );
        }
    }
}
