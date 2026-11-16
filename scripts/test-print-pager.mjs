// v0.181 Writer 逐页翻页预览断言。
//
// 这一轮**没有写分页算法**：复用屏幕上分页参考线的 --pgh（就是 effPx.h）与
// estimatePages 的同一份页高，把「第 n 页」翻成滚动量。纸面真分页仍由
// Chromium 的 @media print 决定，表格/图片跨页、孤行控制一概不模拟。
//
// 钉三件事：① 页码换算纯函数（含七档 zoom 的互逆）；② 组件接线与程序化
// 滚动期间的回写闸门；③ 诚实边界没被悄悄写成「真分页」。
// 跑法：npx vite-node scripts/test-print-pager.mjs

import fs from 'node:fs'
import {
  previewUi, estimatePages, pageScrollTop, pageOfScrollTop, clampPage,
} from '../src/lib/print-preview.ts'
import { statusBarPages } from '../src/lib/status-bar.ts'
import { ZOOM_STEPS } from '../src/lib/view-zoom.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const eq = (name, got, want) => check(name, got === want, `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

// ---- 1. 纯函数 -----------------------------------------------------------
eq('第 1 页顶部就是上边距', pageScrollTop(1, 1000, 1, 96), 96)
eq('第 3 页顶部 = 2 张纸 + 上边距', pageScrollTop(3, 1000, 1, 96), 2096)
eq('zoom=1.5 时页距一起缩放', pageScrollTop(2, 1000, 1.5, 96), 1644)
eq('负 scrollTop 归第 1 页', pageOfScrollTop(-500, 1000, 1, 96), 1)
eq('非法 zoom 退回 1', pageScrollTop(2, 1000, Number.NaN, 0), 1000)
eq('pageH 非正时页距至少 1', pageScrollTop(2, 0, 1, 0), 1)

{
  let allInv = true
  for (const z of [1, 0.5, 0.75, 1.25, 1.5, 1.75, 2, ...ZOOM_STEPS]) {
    for (let p = 1; p <= 12; p++) {
      if (pageOfScrollTop(pageScrollTop(p, 1123, z, 96), 1123, z, 96) !== p) allInv = false
    }
  }
  check('页码换算互逆（七档 zoom × 12 页）', allInv)
  eq('ZOOM_STEPS 档位数', ZOOM_STEPS.length, 7)
}

eq('clampPage 下界', clampPage(-3, 5), 1)
eq('clampPage 上界', clampPage(99, 5), 5)
eq('clampPage 非法值按 1 页', clampPage(Number.NaN, Number.NaN), 1)
eq('clampPage total 非正至少 1 页', clampPage(4, 0), 1)

eq('previewUi 打开时显示翻页控件', previewUi(true).showPager, true)
eq('previewUi 关闭时不显示翻页控件', previewUi(false).showPager, false)
eq('previewUi 打开时仍切只读', previewUi(true).editable, false)

// 页数口径与状态栏同源
{
  const s = { docH: 2500, pageH: 1123, marginTop: 96, marginBottom: 96 }
  eq('状态栏页数与 estimatePages 同源', statusBarPages(s), estimatePages(s.docH, s.pageH, s.marginTop, s.marginBottom))
}

// ---- 2. 组件接线（源码级）------------------------------------------------
{
  const ui = read('../src/components/DocEditor.tsx')
  const lib = read('../src/lib/print-preview.ts')
  const css = read('../src/index.css')
  const bar = read('../src/lib/status-bar.ts')
  check('组件：翻页目标由纯函数算', /const top = pageScrollTop\(p, effPx\.h, zoom, effPx\.top\)/.test(ui))
  check('组件：页码经 clampPage 夹在总页数内', /clampPage\(previewPage \+ delta, totalPreviewPages\)/.test(ui))
  check('组件：程序化滚动走 scrollTo', /scrollRef\.current\?\.scrollTo\(\{ top, behavior: 'smooth' \}\)/.test(ui))
  check('组件：targetRef 挡住 smooth 中间帧回写', /previewTargetRef\.current = top/.test(ui) && /Math\.abs\(top - target\) < 2/.test(ui))
  check('组件：滚动时用 pageOfScrollTop 回写页码', /pageOfScrollTop\(top, effPx\.h, zoom, effPx\.top\)/.test(ui))
  check('组件：预览条只在 showPager 时渲染', /previewUi\(previewOpen\)\.showPager/.test(ui))
  check('组件：上一页/下一页各有禁用边界',
    /disabled=\{previewPage <= 1\}/.test(ui) && /disabled=\{previewPage >= totalPreviewPages\}/.test(ui))
  check('组件：非预览态 onScroll 直接返回（不白跑）', /if \(!previewOpen\) return/.test(ui))
  check('组件：打开预览时按当前滚动量定页码', /pageOfScrollTop\(top, effPx\.h, zoom, effPx\.top\)[\s\S]{0,200}estimatePages/.test(ui))
  check('预览条旧文案已撤（不再写「逐页翻页未做」）',
    !/逐页翻页未做/.test(ui) && !/逐页翻页未做/.test(bar))
  check('CSS：翻页控件样式在位', /\.doc-preview-pager \{/.test(css) && /\.doc-preview-pager \.tb-btn:disabled/.test(css))
  check('诚实边界：lib 明写屏幕不重排、不切页', /屏幕上不重排、不切页/.test(lib))
  check('诚实边界：组件 title 明写真分页以打印样式为准', /真分页以打印样式为准/.test(ui))
}

console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
