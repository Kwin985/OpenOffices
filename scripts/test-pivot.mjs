// v0.231 守卫：数据透视表计算引擎（纯函数，不依赖 Univer / 浏览器）。
// 跑法：npx vite-node scripts/test-pivot.mjs

import { buildPivot, fieldIndex, PIVOT_AGGS } from '../src/lib/pivot.ts'

const ok = []
const bad = []
const check = (n, c, extra = '') => (c ? ok : bad).push(n + (c || !extra ? '' : ` — ${extra}`))

const grid = [
  ['地区', '产品', '销量'],
  ['华东', 'A', 10],
  ['华东', 'B', 20],
  ['华南', 'A', 30],
  ['华南', 'A', 40],
]
const base = { grid, rowField: '地区', colField: '产品', valueField: '销量', agg: 'sum' }

check('五个汇总档齐全', PIVOT_AGGS.map((a) => a.value).join() === 'count,sum,avg,min,max')
check('字段定位', fieldIndex(grid[0], '地区') === 0 && fieldIndex(grid[0], '产品') === 1 && fieldIndex(grid[0], '销量') === 2)
check('不存在的字段 -1', fieldIndex(grid[0], '无') === -1)

const r = buildPivot(base)
check('表头 = 行字段 + 列值 + 总计', JSON.stringify(r.rows[0]) === JSON.stringify(['地区', 'A', 'B', '总计']), JSON.stringify(r.rows))
check('华东行求和', JSON.stringify(r.rows[1]) === JSON.stringify(['华东', 10, 20, 30]), JSON.stringify(r.rows[1]))
check('华南行求和（同格累加）', JSON.stringify(r.rows[2]) === JSON.stringify(['华南', 70, 0, 70]), JSON.stringify(r.rows[2]))
check('总计行', JSON.stringify(r.rows[3]) === JSON.stringify(['总计', 80, 20, 100]), JSON.stringify(r.rows[3]))
check('参与行数', r.used === 4 && r.skipped === 0)

const avg = buildPivot({ ...base, agg: 'avg' })
check('平均：华南 A = 35', avg.rows[2][1] === 35, JSON.stringify(avg.rows[2]))
const cnt = buildPivot({ ...base, agg: 'count' })
check('计数：华东 A = 1、华南 A = 2', cnt.rows[1][1] === 1 && cnt.rows[2][1] === 2, JSON.stringify(cnt.rows))
const mn = buildPivot({ ...base, agg: 'min' })
check('最小：华南 A = 30', mn.rows[2][1] === 30)
const mx = buildPivot({ ...base, agg: 'max' })
check('最大：华南 A = 40', mx.rows[2][1] === 40)

// 只有行维度
const rowOnly = buildPivot({ ...base, colField: '' })
check('单行维度：表头两列', JSON.stringify(rowOnly.rows[0]) === JSON.stringify(['地区', '总计']), JSON.stringify(rowOnly.rows[0]))
check('单行维度：华东汇总 30', rowOnly.rows[1][1] === 30, JSON.stringify(rowOnly.rows[1]))
// 只有列维度
const colOnly = buildPivot({ ...base, rowField: '' })
check('单列维度：表头含列值与总计', JSON.stringify(colOnly.rows[0]) === JSON.stringify(['总计', 'A', 'B', '总计']), JSON.stringify(colOnly.rows[0]))
// 都没有 → 一行汇总
const none = buildPivot({ ...base, rowField: '', colField: '' })
check('零维度：表头 + 一行汇总', none.rows.length === 2 && none.rows[0][1] === '总计' && none.rows[1][1] === 100, JSON.stringify(none.rows))

// 空值与跳过
const withBad = buildPivot({
  grid: [['地区', '销量'], ['华东', 10], ['华南', ''], ['华北', 'abc']],
  rowField: '地区', colField: '', valueField: '销量', agg: 'sum',
})
check('非数值跳过并如实计数', withBad.skipped === 2 && withBad.used === 3, JSON.stringify({ u: withBad.used, s: withBad.skipped }))
check('空值格给 0 不报错', withBad.rows[2][1] === 0, JSON.stringify(withBad.rows))

// 配置错误 / 空数据
check('值字段不存在 → 空结果', buildPivot({ ...base, valueField: '无' }).rows.length === 0)
check('空网格 → 空结果', buildPivot({ ...base, grid: [] }).rows.length === 0)
check('只有表头 → 表头 + 总计 0 行', buildPivot({ ...base, grid: [grid[0]] }).rows.length === 2)

// 纯函数：不改源网格
const before = JSON.stringify(grid)
buildPivot(base)
check('源网格未被修改', JSON.stringify(grid) === before)

// 源码级：UI 接线与落表路径（写入当前表 → Univer 快照 → xlsx 保存链）
const fs = await import('node:fs')
const ui = fs.readFileSync(new URL('../src/components/SheetEditor.tsx', import.meta.url), 'utf8')
check('工具条有数据透视表入口', ui.includes('onClick={openPivot}'))
check('预览与写入两按钮齐', ui.includes('onClick={previewPivot}') && ui.includes('onClick={writePivot}'))
check('写入走 setValues（进 Univer 快照）', /getRange\(r, c, grid\.length, w\)\.setValues\(grid\)/.test(ui))
check('写入后标脏', /markDirty\(tab\.id, true\)/.test(ui))
check('如实报跳过数', /跳过 \$\{pivotResult\.skipped\}/.test(ui))

for (const n of ok) console.log(`  ✓ ${n}`)
for (const n of bad) console.log(`  ✗ ${n}`)
console.log(`\n透视表引擎：${ok.length} 通过 / ${bad.length} 失败`)
if (bad.length) process.exit(1)

