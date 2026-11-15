// 表格规则（自动筛选 / 数据验证 / 条件格式）的端到端验证（Node 侧）
//
// 为什么单给这一块立一个脚本：它是"文件 ↔ 界面"之间一条**侧通道**——不进单元格值、
// 不进样式，只在 Univer 工作簿快照的 resources 里各占一条 JSON 字符串。正因为它不进
// 正文，主流程的读写往返测试碰不到它：打开一个带筛选的表，单元格内容全对，但筛选
// 悄悄没了，没人会报错。所以这条通道要有自己的一套账。
//
// 模块头注里承诺过"取是纯函数、在 Node 里就能测"，这一份就是那份账，分三组：
//   1. 归一化：颜色/日期/列表值那一层（同一份信息在 Univer 与文件里有不同写法）
//   2. 取（快照 → 载荷）：三类资源各取到、顺序、坏数据不炸、装不下的要记账
//   3. 放（载荷 → 界面）：走假门面，看它到底调了什么、顺序对不对
// 第 3 组里最关键的一条是**条件格式要倒着加**——门面按插入顺序的倒序吐规则，
// 顺着加会让整表的优先级反过来。
//
// 假门面而不是真 Univer：Univer 起一次要 DOM + Worker，Node 里没有。真机那一半
// （门面真的认这些 builder 方法）由 `tsc` 与 SheetEditor 的赋值链在编译期核对，
// 这里只管"我们这一侧的换算"。

import {
  aggregateNotes,
  applySheetRules,
  buildDataValidation,
  dateOfIso,
  extractRules,
  listOf,
  normColor,
  normDateValue,
} from '../src/lib/sheet-rules.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => {
  ;(cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
}
const eq = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want), `得到 ${JSON.stringify(got)}，要 ${JSON.stringify(want)}`)
const has = (name, notes, sub) =>
  check(name, notes.some((n) => n.includes(sub)), `账上是 [${notes.join(' / ')}]`)

const R = (r0, c0, r1, c1) => ({ startRow: r0, startColumn: c0, endRow: r1, endColumn: c1 })

// ───────────────────────── 1. 归一化 ─────────────────────────

eq('颜色：rgb() 收成 #rrggbb', normColor('rgb(255, 0, 0)'), '#ff0000')
eq('颜色：rgba() 只要前三档', normColor('rgba(1, 2, 3, 0.5)'), '#010203')
eq('颜色：#RRGGBB 统一小写', normColor('#FFAA33'), '#ffaa33')
eq('颜色：对象形态（{rgb}）也认', normColor({ rgb: 'rgb(16, 32, 48)' }), '#102030')
eq('颜色：认不出的一律 undefined（不猜）', normColor('red'), undefined)
eq('颜色：空值 undefined', normColor(undefined), undefined)

eq('日期：2026/1/1 → ISO', normDateValue('2026/1/1'), '2026-01-01')
eq('日期：2026-1-1 → 补零', normDateValue('2026-1-1'), '2026-01-01')
eq('日期：已是 ISO 的原样', normDateValue('2026-01-01'), '2026-01-01')
eq('日期：公式原样交回（不当日期改）', normDateValue('=TODAY()'), '=TODAY()')
eq('日期：空串 undefined', normDateValue(''), undefined)

const d = dateOfIso('2026-01-01')
check(
  'ISO → Date 按本地时区取（UTC 解析会让 1 月 1 日差成前一天）',
  d && d.getFullYear() === 2026 && d.getMonth() === 0 && d.getDate() === 1,
  d ? d.toString() : 'null',
)
eq('ISO：形状不对给 null', dateOfIso('2026-1-1'), null)

eq('列表值：JSON 数组串 → 数组', listOf('["甲","乙"]'), ['甲', '乙'])
eq('列表值：区域引用不是列表（交回 null）', listOf('$A$1:$A$3'), null)
eq('列表值：坏 JSON 不炸', listOf('["甲"'), null)
eq('列表值：空值 null', listOf(undefined), null)

eq(
  '同一句文案收成 ×N（状态栏只装得下一行）',
  aggregateNotes(['甲', '乙', '甲', '甲']),
  ['甲 ×3', '乙'],
)

// ───────────────────────── 2. 取 ─────────────────────────

const CF = 'SHEET_CONDITIONAL_FORMATTING_PLUGIN'
const DV = 'SHEET_DATA_VALIDATION_PLUGIN'
const FL = 'SHEET_FILTER_PLUGIN'

const resources = [
  {
    name: CF,
    data: JSON.stringify({
      s1: [
        {
          ranges: [R(0, 0, 9, 0)],
          rule: {
            type: 'highlightCell',
            subType: 'number',
            operator: 'greaterThan',
            value: [10],
            style: { bg: 'rgb(255, 0, 0)' },
          },
        },
        {
          ranges: [R(0, 1, 9, 1)],
          rule: {
            type: 'highlightCell',
            subType: 'number',
            operator: 'lessThan',
            value: [5],
            style: { bg: '#00ff00' },
          },
        },
      ],
      s2: [
        {
          ranges: [R(0, 0, 9, 0)],
          rule: {
            type: 'colorScale',
            config: [
              { color: 'rgb(255, 0, 0)', value: { type: 'num', value: 0 } },
              { color: '#0000ff', value: { type: 'num', value: 100 } },
            ],
          },
        },
      ],
    }),
  },
  {
    name: DV,
    data: JSON.stringify({
      s1: [
        { ranges: [R(0, 0, 9, 0)], type: 'whole', operator: 'between', formula1: '1', formula2: '10' },
        { ranges: [R(0, 1, 9, 1)], type: 'textLength', operator: 'between', formula1: '1', formula2: '5' },
        { ranges: [R(0, 2, 9, 2)], type: 'list', formula1: '["甲","乙"]' },
        { ranges: [R(0, 3, 9, 3)], type: 'date', operator: 'greaterThan', formula1: '2026/1/1' },
      ],
    }),
  },
  {
    name: FL,
    data: JSON.stringify({
      s1: {
        ref: R(0, 0, 9, 2),
        filterColumns: [
          { colId: 1, filters: { blank: false, filters: ['甲'] } },
          { colId: 5, filters: { filters: ['乙'] } }, // 落在筛选区之外
        ],
      },
    }),
  },
]

const { rules, notes } = extractRules(resources)

check('三类资源都取到了，键是快照里的 sheetId', rules.has('s1') && rules.has('s2'), `键：[${[...rules.keys()]}]`)
const s1 = rules.get('s1') ?? {}
eq('条件格式按快照原序交回（高优先级在前）', (s1.condFormats ?? []).map((r) => r.op), ['greaterThan', 'lessThan'])
eq('条件格式的样式颜色过了归一化', s1.condFormats?.[0]?.fmt?.bg, '#ff0000')
eq('条件格式第二条颜色也归一了', s1.condFormats?.[1]?.fmt?.bg, '#00ff00')
eq('色阶的档位与颜色', s1 === undefined ? null : rules.get('s2')?.condFormats?.[0]?.scale, [
  { color: '#ff0000', t: 'num', v: 0 },
  { color: '#0000ff', t: 'num', v: 100 },
])
eq('数据验证四条都在（装不下的也要在账上）', (s1.dataValidations ?? []).map((r) => r.type), ['whole', 'textLength', 'list', 'date'])
eq('list 的 op 不带（Univer 在那里存的是它自己的类型标记）', s1.dataValidations?.[2]?.op, undefined)
eq('list 的取值收成逗号串', s1.dataValidations?.[2]?.f1, '甲,乙')
eq('date 的取值归一到 ISO', s1.dataValidations?.[3]?.f1, '2026-01-01')
has('门面建不出来的类型要记账', notes, 'textLength')
eq('筛选的区取到了', s1.filter?.ref, R(0, 0, 9, 2))
eq(
  '筛选的列一条不少（区外那条也取回——"取"不替"放"做决定）',
  (s1.filter?.columns ?? []).map((c) => c.col),
  [1, 5],
)

// 坏数据：不该炸，也不该静默少给
const broken = extractRules([
  { name: CF, data: '{这不是 JSON' },
  { name: DV, data: JSON.stringify({ s1: [{ type: 'whole' }] }) }, // 没有区
  { name: FL, data: JSON.stringify({ s1: { filterColumns: [] } }) }, // 没有 ref
])
eq('坏 JSON 的资源不炸也不取', broken.rules.size, 0)
eq('不是数组的 resources 同样安全', extractRules({}).rules.size, 0)
eq('空的 resources 给空账', extractRules(undefined).rules.size, 0)

// 无作用区的条件格式：无处安放，但要说得出
const noRange = extractRules([
  { name: CF, data: JSON.stringify({ s1: [{ ranges: [], rule: { type: 'highlightCell' } }] }) },
])
has('没有作用区的条件格式要记账', noRange.notes, '没有作用区域')
eq('没有作用区的条件格式不进载荷', noRange.rules.get('s1')?.condFormats ?? [], [])

// 色阶不足两档 / 数据条没正色：同样要说得出
const shortScale = extractRules([
  { name: CF, data: JSON.stringify({ s1: [{ ranges: [R(0, 0, 1, 1)], rule: { type: 'colorScale', config: [{ color: '#ff0000', value: { type: 'num', value: 1 } }] } }] }) },
])
has('档位不足的色阶要记账', shortScale.notes, '档位不足')
const noBar = extractRules([
  { name: CF, data: JSON.stringify({ s1: [{ ranges: [R(0, 0, 1, 1)], rule: { type: 'dataBar', config: {} } }] }) },
])
has('没有正色的数据条要记账', noBar.notes, '正数颜色')

// 按颜色筛选：取得到但界面还原不了，必须记账而不是悄悄丢
const colorFilter = extractRules([
  { name: FL, data: JSON.stringify({ s1: { ref: R(0, 0, 9, 2), filterColumns: [{ colId: 1, colorFilters: { rgb: '#ff0000' } }] } }) },
])
has('按颜色筛选要记账', colorFilter.notes, '按颜色筛选')

// 'abc'：Univer 给文本类条件的初值。代价是用户真把判定文本写成 abc 时这一条不落盘，
// 这行断言是把这个已知代价钉在这里——哪天 Univer 换了初值，这里会红
const abc = extractRules([
  { name: CF, data: JSON.stringify({ s1: [{ ranges: [R(0, 0, 1, 1)], rule: { type: 'highlightCell', subType: 'text', operator: 'containsText', value: 'abc' } }] }) },
])
eq('判定值恰为 abc 时不落 v1（Univer 的占位初值）', abc.rules.get('s1')?.condFormats?.[0]?.v1, undefined)
const realText = extractRules([
  { name: CF, data: JSON.stringify({ s1: [{ ranges: [R(0, 0, 1, 1)], rule: { type: 'highlightCell', subType: 'text', operator: 'containsText', value: 'abcd' } }] }) },
])
eq('判定值不是占位串时照常落盘', realText.rules.get('s1')?.condFormats?.[0]?.v1, 'abcd')

// ───────────────────────── 3. 放 ─────────────────────────

/**
 * 假门面：不真建规则，只把"调了什么、按什么顺序、传了什么"记下来。
 * 门面方法名很多且会随版本加，所以 builder 用 Proxy 接住一切——缺方法的场景
 * 另有断言覆盖（真缺时 `caller` 会抛，被 applySheetRules 收成一条说明）
 */
function fakeBuilder() {
  const sink = []
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop !== 'string') return undefined
        // build() 的产物里带上这一条的调用账：断言要看的正是"它调了什么"
        if (prop === 'build') return () => ({ __built: true, calls: sink.slice() })
        return (...args) => {
          sink.push({ fn: prop, args })
        }
      },
    },
  )
}

function fakeSheet({ noFilter = false } = {}) {
  const cfAdded = []
  const dvRanges = []
  const criteria = new Map()
  const filter = {
    setColumnFilterCriteria: (col, crit) => criteria.set(col, crit),
    getColumnFilterCriteria: (col) => criteria.get(col) ?? null,
  }
  const ws = {
    // 每条规则一个 builder：调用账跟着这一条走，才看得出加的次序
    newConditionalFormattingRule: () => fakeBuilder(),
    addConditionalFormattingRule: (rule) => cfAdded.push(rule),
    getRange: (r, c, nr, nc) => ({
      setDataValidation: (v) => dvRanges.push({ r, c, nr, nc, v }),
      createFilter: () => (noFilter ? null : filter),
    }),
  }
  return { ws, cfAdded, dvRanges, criteria }
}

function fakeApi() {
  const calls = []
  const names = [
    'requireNumberBetween', 'requireNumberNotBetween', 'requireNumberEqualTo',
    'requireNumberNotEqualTo', 'requireNumberGreaterThan', 'requireNumberGreaterThanOrEqualTo',
    'requireNumberLessThan', 'requireNumberLessThanOrEqualTo',
    'requireValueInList', 'requireValueInRange',
    'requireDateBetween', 'requireDateNotBetween', 'requireDateEqualTo', 'requireDateAfter',
    'requireDateOnOrAfter', 'requireDateBefore', 'requireDateOnOrBefore',
    'requireFormulaSatisfied', 'setOptions',
  ]
  const b = {}
  for (const n of names) b[n] = (...args) => calls.push({ fn: n, args })
  b.build = () => ({ __dv: true, calls: calls.slice() })
  return { api: { newDataValidation: () => b }, calls }
}

// 数据验证：四类可建的各自走到对的 builder 方法
const { api, calls } = fakeApi()
eq('whole between → requireNumberBetween(1, 10, true)', buildDataValidation(api, { ranges: [R(0, 0, 1, 1)], type: 'whole', op: 'between', f1: '1', f2: '10' })?.calls?.[0], { fn: 'requireNumberBetween', args: [1, 10, true] })
calls.length = 0
eq('decimal 的 int 标记是 false', buildDataValidation(api, { ranges: [R(0, 0, 1, 1)], type: 'decimal', op: 'between', f1: '1', f2: '9' })?.calls?.[0], { fn: 'requireNumberBetween', args: [1, 9, false] })
calls.length = 0
eq('list 的逗号串 → 数组', buildDataValidation(api, { ranges: [R(0, 0, 1, 1)], type: 'list', f1: '甲,乙' })?.calls?.[0], { fn: 'requireValueInList', args: [['甲', '乙'], false, true] })
calls.length = 0
eq('list 的区域引用 → requireValueInRange', buildDataValidation(api, { ranges: [R(0, 0, 1, 1)], type: 'list', f1: '$A$1:$A$3' })?.calls?.[0], { fn: 'requireValueInRange', args: ['$A$1:$A$3'] })
calls.length = 0
eq('list 的区域引用（不带 $）', buildDataValidation(api, { ranges: [R(0, 0, 1, 1)], type: 'list', f1: 'A1:A3' })?.calls?.[0], { fn: 'requireValueInRange', args: ['A1:A3'] })
calls.length = 0
eq('list 的区域引用（带表名）', buildDataValidation(api, { ranges: [R(0, 0, 1, 1)], type: 'list', f1: 'Sheet1!A1:A3' })?.calls?.[0], { fn: 'requireValueInRange', args: ['Sheet1!A1:A3'] })
calls.length = 0
// 关键反面：含冒号却不是区域。早先这里用 `includes(':')` 猜，时间类选项会被切成"区域名"
eq('时间类选项不是区域（含冒号但两边不是单元格）', buildDataValidation(api, { ranges: [R(0, 0, 1, 1)], type: 'list', f1: '08:00,12:00' })?.calls?.[0], { fn: 'requireValueInList', args: [['08:00', '12:00'], false, true] })
calls.length = 0
const dvDate = buildDataValidation(api, { ranges: [R(0, 0, 1, 1)], type: 'date', op: 'between', f1: '2026/1/1', f2: '2026-12-31' })
check(
  'date between → 两个真 Date（按本地时区）',
  dvDate?.calls?.[0]?.fn === 'requireDateBetween' &&
    dvDate.calls[0].args[0] instanceof Date &&
    dvDate.calls[0].args[0].getDate() === 1 &&
    dvDate.calls[0].args[1].getMonth() === 11,
  JSON.stringify(dvDate?.calls?.[0]?.args?.map(String)),
)
calls.length = 0
eq('custom → requireFormulaSatisfied', buildDataValidation(api, { ranges: [R(0, 0, 1, 1)], type: 'custom', f1: '=A1>0' })?.calls?.[0], { fn: 'requireFormulaSatisfied', args: ['=A1>0'] })
calls.length = 0
eq('门面建不出来的类型（textLength）交回 null', buildDataValidation(api, { ranges: [R(0, 0, 1, 1)], type: 'textLength', f1: '1', f2: '5' }), null)
calls.length = 0
eq('日期给了个解析不了的串 → null（不猜）', buildDataValidation(api, { ranges: [R(0, 0, 1, 1)], type: 'date', op: 'between', f1: '明年', f2: '后年' }), null)

// 整表放回：条件格式必须倒着加，否则整表优先级反过来
const sheet = fakeSheet()
const put = applySheetRules(fakeApi().api, { getSheetByName: () => sheet.ws }, '表1', {
  condFormats: (s1.condFormats ?? []).slice(),
  dataValidations: (s1.dataValidations ?? []).filter((r) => r.type !== 'textLength'),
  filter: s1.filter,
})
eq(
  '条件格式倒着加（载荷高优先级在前 → 门面按插入倒序吐，正上加才不反）',
  sheet.cfAdded.map((r) => r.calls[0].fn),
  ['whenNumberLessThan', 'whenNumberGreaterThan'],
)
eq('放回的条件格式带着原来的作用区', sheet.cfAdded[0].ranges, [R(0, 1, 9, 1)])
eq(
  '数据验证落到它自己的每个区上',
  sheet.dvRanges.map((x) => [x.r, x.c, x.nr, x.nc]),
  [
    [0, 0, 10, 1],
    [0, 2, 10, 1],
    [0, 3, 10, 1],
  ],
)
eq(
  'rect 换成了 (行,列,行数,列数)',
  sheet.dvRanges[0] && [sheet.dvRanges[0].nr, sheet.dvRanges[0].nc],
  [10, 1],
)
has('落在筛选区之外的列要记账', put, '筛选区之外')
check('区内那条筛选条件落到了界面上', sheet.criteria.has(1), `落到列 [${[...sheet.criteria.keys()]}]`)
eq('筛选条件的内容带过去了', sheet.criteria.get(1)?.filters, { blank: false, filters: ['甲'] })

// 建不出来的类型：不落界面，但要在账上说清楚
const sheet2 = fakeSheet()
const put2 = applySheetRules(fakeApi().api, { getSheetByName: () => sheet2.ws }, '表1', {
  dataValidations: [{ ranges: [R(0, 0, 1, 1)], type: 'textLength', f1: '1', f2: '5' }],
})
has('建不出来的数据验证要记账', put2, '界面建不出来')
eq('建不出来的数据验证不落界面', sheet2.dvRanges.length, 0)

// 表不在了：一句话说清，不抛
eq(
  '表不在了有话说',
  applySheetRules(fakeApi().api, { getSheetByName: () => null }, '已删的表', {}),
  ['规则要落在"已删的表"上，但这张表已不在'],
)

// 建过滤器失败：Univer 在这条路上不抛，得自己核
const sheet3 = fakeSheet({ noFilter: true })
has('建过滤器失败要记账', applySheetRules(fakeApi().api, { getSheetByName: () => sheet3.ws }, '表1', { filter: s1.filter }), '建过滤器没成功')

// 门面缺方法：应当收成一条说明，而不是让整张表的还原炸掉
const brokenWs = {
  newConditionalFormattingRule: () => ({
    whenNumberGreaterThan: () => {},
    // 故意没有 build
  }),
  addConditionalFormattingRule: () => {},
  getRange: () => ({ setDataValidation: () => {}, createFilter: () => null }),
}
has(
  '门面缺方法时不炸，收成一条说明',
  applySheetRules(fakeApi().api, { getSheetByName: () => brokenWs }, '表1', {
    condFormats: [{ ranges: [R(0, 0, 1, 1)], kind: 'cell', sub: 'number', op: 'greaterThan', v1: 1 }],
  }),
  '没能还原',
)

// ── 收尾 ──
console.log(`\n通过 ${ok.length} 项：`)
for (const s of ok) console.log('  ✓', s)
if (bad.length) {
  console.log(`\n失败 ${bad.length} 项：`)
  for (const s of bad) console.log('  ✗', s)
}
console.log(bad.length ? `\n失败 ${bad.length} 项` : '\n全部通过')
process.exit(bad.length ? 1 : 0)
