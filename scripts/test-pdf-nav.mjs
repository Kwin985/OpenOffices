// v0.184 PDF 首页/末页 + 页码钳制单一出口断言。
//
// 此前工具条里散着三种口径：Math.max(1, curPage-1)、Math.min(numPages, curPage+1)、
// 输入框「越界就不跳」，且没有首页/末页。现在 `pageNav` 一次算全四枚目标页，
// 钳制统一转调 Writer 打印预览那份 `clampPage`（单一事实源，PDF 侧不重写）。
//
// 跑法：npx vite-node scripts/test-pdf-nav.mjs

import fs from 'node:fs'
import { clampPdfPage, pageNav, parsePageSpec } from '../src/lib/pdf-geo.ts'
import { clampPage } from '../src/lib/print-preview.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const eq = (name, got, want) => check(name, got === want, `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

// ---- 1. pageNav 纯函数 ------------------------------------------------------
{
  const mid = pageNav(5, 12)
  eq('中间页：首页', mid.first, 1)
  eq('中间页：上一页', mid.prev, 4)
  eq('中间页：下一页', mid.next, 6)
  eq('中间页：末页', mid.last, 12)
  eq('中间页：两端都可用', `${mid.canPrev}/${mid.canNext}`, 'true/true')

  const first = pageNav(1, 12)
  eq('第 1 页：上一页仍夹在 1', first.prev, 1)
  eq('第 1 页：不可再往前', first.canPrev, false)
  eq('第 1 页：可以往后', first.canNext, true)

  const last = pageNav(12, 12)
  eq('末页：下一页仍夹在 12', last.next, 12)
  eq('末页：不可再往后', last.canNext, false)

  const one = pageNav(1, 1)
  eq('单页：两端都不可用', `${one.canPrev}/${one.canNext}`, 'false/false')
  eq('单页：末页就是 1', one.last, 1)

  // 边界：total=0 / NaN / 负数 / cur 越界，全部与 clampPage 同口径
  const empty = pageNav(1, 0)
  eq('没打开文档：total 按一页处理', empty.last, 1)
  eq('没打开文档：两端都不可用', `${empty.canPrev}/${empty.canNext}`, 'false/false')
  eq('total=NaN：不炸', pageNav(3, NaN).last, 1)
  eq('total 负数：按一页', pageNav(3, -7).last, 1)
  eq('cur 越上界：夹到末页', pageNav(99, 12).next, 12)
  eq('cur 越下界：夹到首页', pageNav(-4, 12).prev, 1)
  eq('小数 total：四舍五入', pageNav(2, 7.6).last, 8)
}

// ---- 2. 单一事实源 ----------------------------------------------------------
{
  eq('clampPdfPage 就是 clampPage（引用相等）', clampPdfPage, clampPage)
  for (const [p, t] of [[0, 5], [99, 5], [NaN, 3], [2.6, 8], [-1, 0]]) {
    eq(`clampPdfPage(${p}, ${t}) 与 clampPage 同值`, clampPdfPage(p, t), clampPage(p, t))
  }
  // 同模块既有纯函数没被牵坏
  eq('parsePageSpec 仍工作', JSON.stringify(parsePageSpec('1-3,5', 8)), '[1,2,3,5]')
}

// ---- 3. 组件接线 ------------------------------------------------------------
{
  const ui = read('../src/components/PdfViewer.tsx')
  const lib = read('../src/lib/pdf-geo.ts')
  check('lib：pageNav 内部转调 clampPage（不重写钳制）',
    /import \{ clampPage \} from '\.\/print-preview'/.test(lib)
      && /const t = clampPage\(Number\.MAX_SAFE_INTEGER, total\)/.test(lib)
      && /const c = clampPage\(cur, t\)/.test(lib))
  check('组件：从 pdf-geo 引入 clampPdfPage / pageNav',
    /clampPdfPage,/.test(ui) && /pageNav,/.test(ui))
  check('组件：gotoPage 内部统一钳制',
    /const gotoPage = \(n: number\) => \{[\s\S]{0,140}pageEl\(clampPdfPage\(n, doc\?\.numPages \?\? 1\)\)/.test(ui))
  check('组件：pageNav 驱动四枚按钮的目标页',
    ['nav.first', 'nav.prev', 'nav.next', 'nav.last'].every((x) => ui.includes(`gotoPage(${x})`)))
  check('组件：上一页/下一页的 disabled 走 nav 的可用状态',
    /!nav\.canPrev/.test(ui) && /!nav\.canNext/.test(ui))
  // 收窄到页码工具条段，别把缩放控件里的 Math.max(SCALE_MIN, ...) 算进来
  const seg = ui.slice(ui.indexOf("btn('⏮'"), ui.indexOf("btn('⏭'") + 80)
  check('组件：工具条段内不再手写 Math.max / Math.min 钳制',
    !/Math\.max\(1, curPage/.test(seg) && !/Math\.min\(numPages, curPage/.test(seg))
  check('组件：输入框越界交给 gotoPage（不再静默不跳）',
    /if \(doc && Number\.isFinite\(n\)\) gotoPage\(n\)/.test(seg))
  check('组件：首页/末页按钮都在', /⏮/.test(ui) && /⏭/.test(ui))
}

console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
