// v0.176 PDF 查找替换的纯函数断言 + UI 接线钉子。
//
// 跑法：npx vite-node scripts/test-pdf-replace.mjs

import fs from 'node:fs'
import { replacementPlan, locateReplace } from '../src/lib/pdf-replace.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => {
  ;(cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
}
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)

const item = (str, x, box) => ({
  x, y: 100, size: 12, str,
  box: box ?? { x, y: 88, w: str.length * 10, h: 14 },
})
const items = [
  item('第一章 总则', 0),
  item('与适用范围', 60),
  item('第一章 附则', 120),
]

// ───────────────────── 1. 替换计划 ─────────────────────

{
  eq('计划：空清单', replacementPlan([], '新'), [])
  eq('计划：不同页不同字各编 0', replacementPlan([
    { page: 1, from: '甲' }, { page: 2, from: '乙' },
  ], '新').map((x) => x.occurrence), [0, 0])
  eq('计划：同页同字按出现序编号', replacementPlan([
    { page: 1, from: '甲' }, { page: 1, from: '甲' }, { page: 1, from: '甲' },
  ], '新').map((x) => x.occurrence), [0, 1, 2])
  eq('计划：同字不同页各编 0', replacementPlan([
    { page: 1, from: '甲' }, { page: 2, from: '甲' },
  ], '新').map((x) => x.occurrence), [0, 0])
  eq('计划：替换文本原样带入', replacementPlan([{ page: 3, from: '甲' }], '替换成 X')[0], {
    page: 3, from: '甲', to: '替换成 X', occurrence: 0,
  })
}

// ───────────────────── 2. 文字项定位 ─────────────────────

{
  const one = locateReplace(items, '总则', 0)
  check('定位：单文字项命中', !!one)
  eq('定位：起点/字号取覆盖项第一枚', one && [one.x, one.y, one.size], [0, 100, 12])
  eq('定位：单项盒就是该项的盒', one && one.box, items[0].box)

  const cross = locateReplace(items, '第一章 总则与', 0)
  check('定位：跨文字项命中', !!cross)
  eq('定位：跨项盒是并集', cross && cross.box, {
    x: 0, y: 88, w: 110, h: 14,
  })

  const second = locateReplace(items, '第一章', 1)
  eq('定位：第 2 次出现落在第三项', second && second.x, 120)
  eq('定位：找不到返回 null', locateReplace(items, '不存在', 0), null)
  eq('定位：occurrence 越界返回 null', locateReplace(items, '第一章', 5), null)
  eq('定位：空原文返回 null', locateReplace(items, '', 0), null)
  eq('定位：空文字项返回 null', locateReplace([], '甲', 0), null)
  eq('定位：负数 occurrence 返回 null', locateReplace(items, '第一章', -1), null)
  eq('定位：非整数 occurrence 返回 null', locateReplace(items, '第一章', 1.5), null)
}

// ───────────────────── 3. UI 接线（漏接不报错）─────────────────────

{
  const src = fs.readFileSync(new URL('../src/components/PdfViewer.tsx', import.meta.url), 'utf8')
  const css = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
  check('接线：搜索命中带原文 from', src.includes('from: t.full.slice(pos, pos + q.length)'))
  check('接线：替换走规划 + 定位两个纯函数', src.includes('replacementPlan(') && src.includes('locateReplace('))
  check('接线：替换落到既有改字队列', src.includes('setTextEdits((prev) => [...prev, ...edits])'))
  check('接线：单个与全部替换两个入口', src.includes('replaceMatches(false)') && src.includes('replaceMatches(true)'))
  check('接线：替换输入与样式在位', src.includes('replaceText') && css.includes('.pdf-replace'))
  // 房规：pdf-text-edit.ts 是另一条线未跟踪的文件，本轮只调用它现有 API、不新增依赖
  check('接线：改字模块的 import 面没扩', src.includes("import { sampleBackdrop, applyTextEdits, type TextEdit } from '../lib/pdf-text-edit'"))
}

console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
