// 表格的三类"规则"（自动筛选 / 数据验证 / 条件格式）在 Univer 与载荷之间的换算。
// Univer 把它们放在工作簿快照的 resources 里（每个插件一条 JSON 字符串），所以**取**是纯函数、
// 在 Node 里就能测；**放**必须走门面（builder + add 命令），只有真机测得到。
// 载荷里的形状是归一化模型：字段名跟着 OOXML 的语义走，但不存 Univer 的 cfId/uid 这类标识——
// 那些是第三方运行时自己认的键，存进文件就等于把我们的格式绑死在 Univer 的某个版本上。
import type { FUniver } from '@univerjs/presets'
import type {
  CondFormatIconLevel,
  CondFormatPayload,
  CondFormatStop,
  CondFormatStyle,
  DataValidationPayload,
  RangeRect,
  SheetFilterPayload,
} from './fs'

export interface SheetRules {
  filter?: SheetFilterPayload
  dataValidations?: DataValidationPayload[]
  condFormats?: CondFormatPayload[]
}

// presets 包没有把 FWorkbook/FWorksheet 这两个名字再导出（只导出了 FUniver），而门面方法确实挂在
// 那两个类上（各插件包用声明合并补的）。所以这里就地声明本模块用到的最小形状，
// 调用方传真实例——SheetEditor 那条赋值链会核对两边签名，方法真不存在时编译期就报错。
interface FilterLike {
  setColumnFilterCriteria(column: number, criteria: unknown): unknown
  getColumnFilterCriteria(column: number): unknown
}
interface RangeLike {
  setDataValidation(v: unknown): unknown
  createFilter(): FilterLike | null
}
interface WorksheetLike {
  newConditionalFormattingRule(): unknown
  addConditionalFormattingRule(rule: unknown): unknown
  getRange(row: number, column: number, numRows: number, numColumns: number): RangeLike
}
interface WorkbookLike {
  getSheetByName(name: string): WorksheetLike | null
}

const CF_PLUGIN = 'SHEET_CONDITIONAL_FORMATTING_PLUGIN'
const DV_PLUGIN = 'SHEET_DATA_VALIDATION_PLUGIN'
const FILTER_PLUGIN = 'SHEET_FILTER_PLUGIN'

/** 门面 builder 能表达的数据验证类型（textLength/time/any/checkbox 这几样这个版本的门面建不出来） */
const APPLIABLE_DV = new Set(['whole', 'decimal', 'list', 'date', 'custom'])

function rectOf(v: unknown): RangeRect | null {
  const r = v as Partial<RangeRect> | null | undefined
  if (!r) return null
  const { startRow, startColumn, endRow, endColumn } = r
  if (
    typeof startRow !== 'number' ||
    typeof startColumn !== 'number' ||
    typeof endRow !== 'number' ||
    typeof endColumn !== 'number'
  ) {
    return null
  }
  return { startRow, startColumn, endRow, endColumn }
}

function rectsOf(v: unknown): RangeRect[] {
  if (!Array.isArray(v)) return []
  return v.map(rectOf).filter((r): r is RangeRect => !!r)
}

/** Univer 的颜色既给 `rgb(r,g,b)` 也给 `#rrggbb`，载荷一律收成一个形状 */
export function normColor(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v : (v as { rgb?: string } | undefined)?.rgb
  if (!s) return undefined
  const m = /^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(s.trim())
  if (!m) return s.startsWith('#') ? s.toLowerCase() : undefined
  const hex = (n: string) => Number(n).toString(16).padStart(2, '0')
  return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/** Univer 的日期验证把值存成 `2026/1/1`，载荷统一成 ISO 形状，两边（OOXML 序列号 / ODF）都从它换算 */
export function normDateValue(v: unknown): string | undefined {
  const s = str(v)
  if (!s) return undefined
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s.trim())
  if (!m) return s
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
}

/** `2026-01-01` → Date（按本地时区取，UTC 解析会让 1 月 1 日差成前一天） */
export function dateOfIso(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

function num(v: string | number | null | undefined): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function val(v: unknown): number | string | null {
  if (v === '' || v == null) return null
  return typeof v === 'number' || typeof v === 'string' ? v : null
}

// ---------------- 条件格式：快照 → 载荷 ----------------

function highlightStyle(sd: Record<string, unknown> | undefined): CondFormatStyle | undefined {
  if (!sd) return undefined
  const out: CondFormatStyle = {}
  const bg = normColor(sd.bg)
  const cl = normColor(sd.cl)
  if (bg) out.bg = bg
  if (cl) out.cl = cl
  if (sd.bl) out.bl = true
  if (sd.it) out.it = true
  if ((sd.ul as { s?: number } | undefined)?.s) out.ul = true
  if ((sd.st as { s?: number } | undefined)?.s) out.st = true
  return Object.keys(out).length ? out : undefined
}

/** Univer 的 rank 规则只给 isBottom/isPercent，OOXML 把它们并成一枚操作符 */
function rankOp(isBottom: boolean, isPercent: boolean): string {
  return isBottom ? (isPercent ? 'bottomPercent' : 'bottom') : isPercent ? 'topPercent' : 'top'
}

function stopsOf(list: unknown): CondFormatStop[] {
  if (!Array.isArray(list)) return []
  return list.flatMap((raw) => {
    const it = raw as { color?: unknown; value?: { type?: string; value?: unknown } } | null
    const color = normColor(it?.color)
    if (!color) return []
    const v = val(it?.value?.value)
    return [{ color, t: it?.value?.type ?? 'num', ...(v == null ? {} : { v }) }]
  })
}

function iconsOf(list: unknown): { style?: string; levels: CondFormatIconLevel[] } {
  if (!Array.isArray(list)) return { levels: [] }
  let style: string | undefined
  const levels: CondFormatIconLevel[] = []
  for (const raw of list) {
    const it = raw as {
      iconType?: string
      operator?: string
      value?: { type?: string; value?: unknown }
    } | null
    if (!it) continue
    if (!style && it.iconType) style = it.iconType
    const v = val(it.value?.value)
    levels.push({
      op: it.operator ?? 'greaterThanOrEqual',
      t: it.value?.type ?? 'num',
      ...(v == null ? {} : { v }),
    })
  }
  return { style, levels }
}

function cfRuleOf(raw: unknown, notes: string[]): CondFormatPayload | null {
  const outer = raw as { rule?: Record<string, unknown>; ranges?: unknown; stopIfTrue?: boolean } | null
  const rule = outer?.rule
  const ranges = rectsOf(outer?.ranges)
  if (!rule || ranges.length === 0) {
    // 没有区的条件格式在 OOXML 里无处安放，Univer 自己也不画它——坏数据也要说得出，不静默少给
    notes.push('有条条件格式没有作用区域，未保存')
    return null
  }
  const base = { ranges, ...(outer?.stopIfTrue ? { stop: true } : {}) }
  const type = str(rule.type) ?? 'highlightCell'
  if (type === 'colorScale') {
    const scale = stopsOf(rule.config)
    if (scale.length < 2) {
      notes.push('有条色阶规则档位不足两档，未保存')
      return null
    }
    return { ...base, kind: 'colorScale', scale }
  }
  if (type === 'dataBar') {
    const cfg = rule.config as {
      min?: { type?: string; value?: unknown }
      max?: { type?: string; value?: unknown }
      positiveColor?: unknown
      nativeColor?: unknown
      isGradient?: boolean
    } | null
    const pos = normColor(cfg?.positiveColor)
    if (!pos) {
      notes.push('有条数据条规则没有正数颜色，未保存')
      return null
    }
    const neg = normColor(cfg?.nativeColor)
    const edge = (s: { type?: string; value?: unknown } | undefined) => {
      const v = val(s?.value)
      return { t: s?.type ?? 'min', ...(v == null ? {} : { v }) }
    }
    const bar = {
      min: edge(cfg?.min),
      max: { t: cfg?.max?.type ?? 'max', ...(val(cfg?.max?.value) == null ? {} : { v: val(cfg?.max?.value) }) },
      pos,
      // Univer 的 nativeColor 在"根本没设负色"时就是我们塞过去的正色（写侧 bar.neg ?? bar.pos），
      // 同色的负色不携带信息：留着它会让"快照直接存"和"读文件再存"两条路产出不同的 xlsx
      ...(neg && neg !== pos ? { neg } : {}),
      // 渐变是 Excel 的默认画法，x14 那块只在"实色"时才写 gradient="0"——所以载荷里一律带个明确的
      // grad，让"没渐变"这件事有地方落，而不是靠两边各自的默认值猜成一样
      grad: cfg?.isGradient !== false,
    }
    return {
      ...base,
      kind: 'dataBar',
      bar,
      ...(rule.isShowValue === false ? { showValue: false } : {}),
    }
  }
  if (type === 'iconSet') {
    const { style, levels } = iconsOf(rule.config)
    if (!style || levels.length < 2) {
      notes.push('有条图标集规则认不出图标样式或档位不足，未保存')
      return null
    }
    return {
      ...base,
      kind: 'iconSet',
      iconStyle: style,
      icons: levels,
      ...(rule.isShowValue === false ? { showValue: false } : {}),
    }
  }
  // highlightCell：子类型决定判定值怎么摆
  const sub = str(rule.subType) ?? 'number'
  const op = str(rule.operator) ?? ''
  const value = rule.value
  const fmt = highlightStyle(rule.style as Record<string, unknown> | undefined)
  const out: CondFormatPayload = { ...base, kind: 'cell', sub, ...(op ? { op } : {}), ...(fmt ? { fmt } : {}) }
  if (sub === 'rank') {
    out.op = rankOp(!!rule.isBottom, !!rule.isPercent)
    out.v1 = typeof value === 'number' ? value : Number(value) || 10
  } else if (sub === 'duplicateValues' || sub === 'uniqueValues') {
    delete out.op
  } else if (Array.isArray(value)) {
    out.v1 = (value[0] ?? '') as string | number
    out.v2 = (value[1] ?? '') as string | number
  } else if (sub === 'timePeriod' || sub === 'average') {
    // 时段与均值的 operator 本身就是判定，Univer 往 value 里塞的是占位串
  } else if (value !== 'abc' && value != null) {
    out.v1 = value as string | number
  }
  return out
}

// ---------------- 数据验证：快照 → 载荷 ----------------

/** Univer 的 list 值有两种写法：JSON 数组串（面板里敲的选项）与区域引用（`$A$1:$A$3`） */
export function listOf(formula1: string | undefined): string[] | null {
  if (!formula1) return null
  const t = formula1.trim()
  if (!t.startsWith('[')) return null
  try {
    const arr = JSON.parse(t)
    return Array.isArray(arr) ? arr.map((x) => String(x)) : null
  } catch {
    return null
  }
}

function dvOf(raw: unknown, notes: string[]): DataValidationPayload | null {
  const o = raw as Record<string, unknown> | null
  const ranges = rectsOf(o?.ranges)
  const type = str(o?.type)
  if (!o || !type || ranges.length === 0) return null
  const out: DataValidationPayload = { ranges, type }
  const op = str(o.operator)
  // list 没有"比较符"这回事（Univer 在那里存的是它自己的类型标记），带上它就会在写读之间来回变
  if (op && type !== 'list') out.op = op
  const f1 = str(o.formula1)
  const list = listOf(f1)
  if (list) out.f1 = list.join(',')
  else if (f1) out.f1 = f1
  const f2 = str(o.formula2)
  if (f2) out.f2 = f2
  if (type === 'date') {
    out.f1 = normDateValue(out.f1)
    out.f2 = normDateValue(out.f2)
  }
  if (o.allowBlank) out.blank = true
  if (o.showDropDown) out.dropdown = true
  if (str(o.error)) out.err = str(o.error)
  if (str(o.errorTitle)) out.errTitle = str(o.errorTitle)
  if (str(o.prompt)) out.prompt = str(o.prompt)
  if (str(o.promptTitle)) out.promptTitle = str(o.promptTitle)
  if (!APPLIABLE_DV.has(type)) notes.push(`有条数据验证（类型 ${type}）界面暂不能还原`)
  return out
}

// ---------------- 筛选：快照 → 载荷 ----------------

function filterOf(raw: unknown, notes: string[]): SheetFilterPayload | null {
  const o = raw as {
    ref?: unknown
    filterColumns?: unknown
    cachedFilteredOut?: unknown
  } | null
  const ref = rectOf(o?.ref)
  if (!ref) return null
  const columns: SheetFilterPayload['columns'] = []
  if (Array.isArray(o?.filterColumns)) {
    for (const rawCol of o.filterColumns) {
      const c = rawCol as {
        colId?: number
        filters?: { blank?: boolean; filters?: unknown[] }
        colorFilters?: unknown
        customFilters?: { and?: boolean; customFilters?: { operator?: string; val?: string }[] }
      } | null
      if (!c || typeof c.colId !== 'number') continue
      const col: SheetFilterPayload['columns'][number] = { col: c.colId }
      if (c.filters?.blank) col.blank = true
      if (Array.isArray(c.filters?.filters) && c.filters.filters.length) {
        col.list = c.filters.filters.map((x) => String(x))
      }
      if (Array.isArray(c.customFilters?.customFilters) && c.customFilters.customFilters.length) {
        col.custom = {
          ...(c.customFilters.and ? { and: true } : {}),
          items: c.customFilters.customFilters.map((x) => ({
            ...(x?.operator ? { op: x.operator } : {}),
            v: str(x?.val) ?? '',
          })),
        }
      }
      if (c.colorFilters) notes.push('有条按颜色筛选的条件界面暂不能还原')
      if (col.list || col.custom || col.blank) columns.push(col)
    }
  }
  const filteredOut = Array.isArray(o?.cachedFilteredOut)
    ? o.cachedFilteredOut.filter((x): x is number => typeof x === 'number')
    : []
  return { ref, columns, ...(filteredOut.length ? { filteredOut } : {}) }
}

// ---------------- 取（整本快照） ----------------

function readResource(resources: unknown, name: string): Record<string, unknown> | null {
  const list = Array.isArray(resources) ? resources : []
  for (const item of list) {
    const it = item as { name?: string; data?: string }
    if (it?.name !== name || !it.data) continue
    try {
      return JSON.parse(it.data) as Record<string, unknown>
    } catch {
      return null
    }
  }
  return null
}

/**
 * 从工作簿快照的 resources 里按表取出规则，键是快照里的 sheetId（表名可能重复，id 不会）。
 * 条件格式按快照里的原序交回——那是 Univer 模型的"高优先级在前"，OOXML 的 `<cfRule>` 同向。
 */
export function extractRules(resources: unknown): {
  rules: Map<string, SheetRules>
  notes: string[]
} {
  const rules = new Map<string, SheetRules>()
  const notes: string[] = []
  const take = (sheetId: string): SheetRules => {
    let entry = rules.get(sheetId)
    if (!entry) {
      entry = {}
      rules.set(sheetId, entry)
    }
    return entry
  }
  const cf = readResource(resources, CF_PLUGIN)
  for (const [sheetId, list] of Object.entries(cf ?? {})) {
    const got = (Array.isArray(list) ? list : [])
      .map((r) => cfRuleOf(r, notes))
      .filter((r): r is CondFormatPayload => !!r)
    if (got.length) take(sheetId).condFormats = got
  }
  const dv = readResource(resources, DV_PLUGIN)
  for (const [sheetId, list] of Object.entries(dv ?? {})) {
    const got = (Array.isArray(list) ? list : [])
      .map((r) => dvOf(r, notes))
      .filter((r): r is DataValidationPayload => !!r)
    if (got.length) take(sheetId).dataValidations = got
  }
  const fl = readResource(resources, FILTER_PLUGIN)
  for (const [sheetId, obj] of Object.entries(fl ?? {})) {
    const got = filterOf(obj, notes)
    if (got) take(sheetId).filter = got
  }
  return { rules, notes }
}

// ---------------- 放（载荷 → Univer 门面） ----------------

function rectArgs(r: RangeRect): [number, number, number, number] {
  return [r.startRow, r.startColumn, r.endRow - r.startRow + 1, r.endColumn - r.startColumn + 1]
}

type Builder = Record<string, (...args: never[]) => unknown>

function caller(b: Builder, label: string) {
  return (name: string, ...args: unknown[]) => {
    const fn = b[name] as ((...a: unknown[]) => unknown) | undefined
    if (typeof fn !== 'function') throw new Error(`${label}门面缺方法 ${name}`)
    return fn.apply(b, args)
  }
}

/**
 * 建一条条件格式规则。作用区一律在 build() 之后挂到产物上：这一版门面的 builder 没有 setRanges
 * （`.d.ts` 里有，实例上没有），而 build() 的产物正是 addConditionalFormattingRule 收下的那个对象。
 */
function buildCf(ws: WorksheetLike, rule: CondFormatPayload): unknown | null {
  const b = ws.newConditionalFormattingRule() as unknown as Builder
  const call = caller(b, '条件格式')
  const style = rule.fmt
  switch (rule.kind) {
    case 'colorScale':
      call(
        'setColorScale',
        (rule.scale ?? []).map((s, i) => ({
          index: i,
          color: s.color,
          value: { type: s.t, value: s.v ?? '' },
        })),
      )
      break
    case 'dataBar': {
      const bar = rule.bar
      if (!bar) return null
      call('setDataBar', {
        min: { type: bar.min.t, value: bar.min.v ?? '' },
        max: { type: bar.max.t, value: bar.max.v ?? '' },
        positiveColor: bar.pos,
        nativeColor: bar.neg ?? bar.pos,
        isGradient: bar.grad !== false,
        ...(rule.showValue === false ? {} : { isShowValue: true }),
      })
      break
    }
    case 'iconSet': {
      const levels = rule.icons ?? []
      if (!rule.iconStyle || levels.length < 2) return null
      call('setIconSet', {
        iconConfigs: levels.map((l, i) => ({
          iconType: rule.iconStyle,
          // 图标位在家族里的编号由档位次序推出（高→低），载荷里不存它
          iconId: String(levels.length - 1 - i),
          operator: l.op,
          value: { type: l.t, value: l.v ?? '' },
        })),
        ...(rule.showValue === false ? {} : { isShowValue: true }),
      })
      break
    }
    default: {
      const op = rule.op ?? ''
      const v1 = rule.v1 == null ? '' : String(rule.v1)
      const sub = rule.sub ?? ''
      if (sub === 'number') {
        if (op === 'between') call('whenNumberBetween', num(rule.v1), num(rule.v2))
        else if (op === 'notBetween') call('whenNumberNotBetween', num(rule.v1), num(rule.v2))
        else if (op === 'equal') call('whenNumberEqualTo', num(rule.v1))
        else if (op === 'notEqual') call('whenNumberNotEqualTo', num(rule.v1))
        else if (op === 'greaterThan') call('whenNumberGreaterThan', num(rule.v1))
        else if (op === 'greaterThanOrEqual') call('whenNumberGreaterThanOrEqualTo', num(rule.v1))
        else if (op === 'lessThan') call('whenNumberLessThan', num(rule.v1))
        else if (op === 'lessThanOrEqual') call('whenNumberLessThanOrEqualTo', num(rule.v1))
        else return null
      } else if (sub === 'text') {
        if (op === 'containsText') call('whenTextContains', v1)
        else if (op === 'notContains') call('whenTextDoesNotContain', v1)
        else if (op === 'beginsWith') call('whenTextStartsWith', v1)
        else if (op === 'endsWith') call('whenTextEndsWith', v1)
        else if (op === 'equal' && v1 === '') call('whenCellEmpty')
        else if (op === 'notEqual' && v1 === '') call('whenCellNotEmpty')
        else if (op === 'equal') call('whenTextEqualTo', v1)
        else return null
      } else if (sub === 'timePeriod') {
        call('whenDate', op)
      } else if (sub === 'rank') {
        call('setRank', {
          isBottom: op.startsWith('bottom'),
          isPercent: op.endsWith('Percent'),
          value: num(rule.v1),
        })
      } else if (sub === 'average') {
        call('setAverage', op)
      } else if (sub === 'duplicateValues') {
        call('setDuplicateValues')
      } else if (sub === 'uniqueValues') {
        call('setUniqueValues')
      } else if (sub === 'formula') {
        call('whenFormulaSatisfied', v1)
      } else {
        return null
      }
      if (style?.bg) call('setBackground', style.bg)
      if (style?.cl) call('setFontColor', style.cl)
      if (style?.bl) call('setBold', true)
      if (style?.it) call('setItalic', true)
      if (style?.ul) call('setUnderline', true)
      if (style?.st) call('setStrikethrough', true)
    }
  }
  const built = (b.build as unknown as () => Record<string, unknown>)()
  built.ranges = rule.ranges
  if (rule.stop) built.stopIfTrue = true
  return built
}

/** 建一条数据验证。数值/日期/列表/自定义公式四类门面都建得出来，其余交回 null 由调用方记边界 */
export function buildDataValidation(api: FUniver, rule: DataValidationPayload): unknown | null {
  const b = api.newDataValidation() as unknown as Builder
  const call = caller(b, '数据验证')
  const f1 = rule.f1 ?? ''
  const op = rule.op ?? 'between'
  switch (rule.type) {
    case 'whole':
    case 'decimal': {
      const int = rule.type === 'whole'
      if (op === 'between') call('requireNumberBetween', num(f1), num(rule.f2), int)
      else if (op === 'notBetween') call('requireNumberNotBetween', num(f1), num(rule.f2), int)
      else if (op === 'equal') call('requireNumberEqualTo', num(f1), int)
      else if (op === 'notEqual') call('requireNumberNotEqualTo', num(f1), int)
      else if (op === 'greaterThan') call('requireNumberGreaterThan', num(f1), int)
      else if (op === 'greaterThanOrEqual') call('requireNumberGreaterThanOrEqualTo', num(f1), int)
      else if (op === 'lessThan') call('requireNumberLessThan', num(f1), int)
      else if (op === 'lessThanOrEqual') call('requireNumberLessThanOrEqualTo', num(f1), int)
      else return null
      break
    }
    case 'list':
      if (f1.startsWith('$') || f1.includes(':')) call('requireValueInRange', f1)
      else call('requireValueInList', f1.split(','), false, rule.dropdown !== false)
      break
    case 'date': {
      const d1 = asDate(f1)
      const d2 = asDate(rule.f2)
      if (!d1 || (op === 'between' && !d2) || (op === 'notBetween' && !d2)) return null
      if (op === 'between') call('requireDateBetween', d1, d2)
      else if (op === 'notBetween') call('requireDateNotBetween', d1, d2)
      else if (op === 'equal') call('requireDateEqualTo', d1)
      else if (op === 'greaterThan') call('requireDateAfter', d1)
      else if (op === 'greaterThanOrEqual') call('requireDateOnOrAfter', d1)
      else if (op === 'lessThan') call('requireDateBefore', d1)
      else if (op === 'lessThanOrEqual') call('requireDateOnOrBefore', d1)
      else return null
      break
    }
    case 'custom':
      call('requireFormulaSatisfied', f1)
      break
    default:
      return null
  }
  const options: Record<string, unknown> = {}
  if (rule.blank) options.allowBlank = true
  if (rule.err) {
    options.showErrorMessage = true
    options.error = rule.err
    if (rule.errTitle) options.errorTitle = rule.errTitle
  }
  if (rule.prompt) {
    options.showInputMessage = true
    options.prompt = rule.prompt
    if (rule.promptTitle) options.promptTitle = rule.promptTitle
  }
  if (Object.keys(options).length) call('setOptions', options)
  return (b.build as unknown as () => unknown)()
}

function asDate(s: string | undefined): Date | null {
  return s ? dateOfIso(normDateValue(s) ?? '') : null
}

/** 同一句话出现多次时收成"文案×N"，状态栏只装得下一行 */
export function aggregateNotes(notes: string[]): string[] {
  const counts = new Map<string, number>()
  for (const n of notes) counts.set(n, (counts.get(n) ?? 0) + 1)
  return [...counts].map(([text, n]) => (n > 1 ? `${text} ×${n}` : text))
}

/**
 * 把一张表的规则放回编辑界面。
 * 条件格式要**倒着加**：门面按插入顺序的倒序吐规则（实测），载荷数组是"高优先级在前"，
 * 倒着插才让落盘时的顺序与读入时一致，优先级不会整表反过来。
 */
export function applySheetRules(
  api: FUniver,
  wb: WorkbookLike,
  sheetName: string,
  rules: SheetRules,
): string[] {
  const ws = wb.getSheetByName(sheetName)
  if (!ws) return [`规则要落在"${sheetName}"上，但这张表已不在`]
  const notes: string[] = []
  for (const rule of [...(rules.condFormats ?? [])].reverse()) {
    try {
      const built = buildCf(ws, rule)
      if (built) ws.addConditionalFormattingRule(built as never)
      else notes.push('有条条件格式的判定界面建不出来，未在界面还原')
    } catch (e) {
      notes.push(`条件格式没能还原（${e instanceof Error ? e.message : String(e)}）`)
    }
  }
  for (const rule of rules.dataValidations ?? []) {
    try {
      const obj = buildDataValidation(api, rule)
      if (!obj) {
        notes.push(`有条数据验证（类型 ${rule.type}）界面建不出来，未在界面还原`)
        continue
      }
      for (const range of rule.ranges) {
        ws.getRange(...rectArgs(range)).setDataValidation(obj as never)
      }
    } catch (e) {
      notes.push(`数据验证没能还原（${e instanceof Error ? e.message : String(e)}）`)
    }
  }
  const fl = rules.filter
  if (fl) {
    try {
      const f = ws.getRange(...rectArgs(fl.ref)).createFilter()
      if (!f) notes.push('有条筛选没能落到界面上（建过滤器没成功）')
      // 落在筛选区外的列，Univer 的命令是 return false 静默不做的（不抛），所以要自己核
      for (const col of fl.columns) {
        if (!f) break
        if (col.col < fl.ref.startColumn || col.col > fl.ref.endColumn) {
          notes.push('有条筛选条件落在筛选区之外，未在界面还原')
          continue
        }
        const crit: Record<string, unknown> = { colId: col.col }
        if (col.list || col.blank) crit.filters = { blank: !!col.blank, filters: col.list ?? [] }
        if (col.custom) {
          crit.customFilters = {
            ...(col.custom.and ? { and: true } : {}),
            customFilters: col.custom.items.map((x) => ({ operator: x.op, val: x.v })),
          }
        }
        f.setColumnFilterCriteria(col.col, crit as never)
        if (f.getColumnFilterCriteria(col.col) == null)
          notes.push('有条筛选条件没能落到界面上')
      }
    } catch (e) {
      notes.push(`筛选没能还原（${e instanceof Error ? e.message : String(e)}）`)
    }
  }
  return notes
}
