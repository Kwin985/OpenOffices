import fs from 'node:fs'
// v0.230 守卫：图表可编辑的纯函数（数据区重建 + payload 覆写）。
// 跑法：npx vite-node scripts/test-chart-edit.mjs

import { seriesFromGrid, editChartPayload } from '../src/lib/chart.ts'

const ok = []
const bad = []
const check = (n, c, extra = '') => (c ? ok : bad).push(n + (c || !extra ? '' : ` — ${extra}`))

// 插入时同一口径：首行系列名、首列类别
const grid = [
  ['月份', '甲', '乙'],
  ['1月', 10, 20],
  ['2月', 15, 25],
]
const s = seriesFromGrid(grid, 'Sheet1', 2, 3)
check('两列数据 → 两条系列', s.length === 2)
check('系列名取首行', s[0].name === '甲' && s[1].name === '乙', JSON.stringify(s))
check('类别取首列', JSON.stringify(s[0].cats) === JSON.stringify(['1月', '2月']))
check('数值按列取', JSON.stringify(s[0].vals) === JSON.stringify([10, 15]) && JSON.stringify(s[1].vals) === JSON.stringify([20, 25]), JSON.stringify(s))
check('引用 0 基网格坐标 +1 跳表头', s[0].val.r1 === 3 && s[0].val.c1 === 4 && s[0].val.r2 === 4 && s[0].val.c2 === 4, JSON.stringify(s[0].val))
check('类别引用同列', s[0].cat.c1 === 3 && s[0].cat.c2 === 3)

check('数据不足不出系列', seriesFromGrid([['甲', '乙']], 'S', 0, 0).length === 0)
check('单列不出系列', seriesFromGrid([['甲'], [1]], 'S', 0, 0).length === 0)

const base = {
  chartType: 'column', grouping: 'standard', title: '旧标题',
  anchorRow: 5, anchorCol: 8, width: 480, height: 320, series: s,
}
const edited = editChartPayload(base, { chartType: 'line', title: '新标题', series: seriesFromGrid(grid, 'Sheet1', 9, 1) })
check('改类型/标题生效', edited.chartType === 'line' && edited.title === '新标题')
check('没说的字段保留', edited.grouping === 'standard' && edited.anchorRow === 5 && edited.anchorCol === 8 && edited.width === 480)
check('新数据区生效', edited.series[0].val.r1 === 10 && edited.series[0].val.c1 === 2)
check('原 payload 不被改（纯函数）', base.chartType === 'column' && base.title === '旧标题' && base.series[0].val.r1 === 3)
check('空 patch 原样返回', JSON.stringify(editChartPayload(base, {})) === JSON.stringify(base))

// 源码级：编辑后的 payload 必须随工作簿写回 xlsx（不能只改屏上 PNG）
import fs from 'node:fs'
const ui = fs.readFileSync(new URL('../src/components/SheetEditor.tsx', import.meta.url), 'utf8')
check('编辑后写回 chartsRef（保存链同吃）', /chartsRef\.current\.set\(id, \{ \.\.\.item, payload: next \}\)/.test(ui))
check('编辑面板有保存/数据区/删除三入口', ui.includes('confirmChartEdit()') && ui.includes('retargetChart()') && ui.includes('deleteChart(id)'))
check('保存链从 chartsRef 取 payload 写 sheet.charts', /bySheet\.get\(sheet\.name\)/.test(ui) && /sheet\.charts = list/.test(ui))
check('删除图表同步移出 chartsRef', /chartsRef\.current\.delete\(id\)/.test(ui))

for (const n of ok) console.log(`  ✓ ${n}`)
for (const n of bad) console.log(`  ✗ ${n}`)
console.log(`\n图表编辑纯函数：${ok.length} 通过 / ${bad.length} 失败`)
if (bad.length) process.exit(1)


