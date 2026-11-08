// v0.186 Impress 母版占位矩形断言。
//
// `MasterStyle.titleRect/bodyRect` 是归一化 0..1 比例（导出侧 `rect.x * W` 换算成
// 英寸）。这轮把「拖动/缩放 → 新矩形」的纯换算收到 lib/master-rect.ts，PptEditor
// 用第二套拖拽状态机写回 deck.master；这里钉换算、钳制与接线，不做真机浏览器对撞。
//
// 跑法：npx vite-node scripts/test-master-rect.mjs

import fs from 'node:fs'
import {
  DEFAULT_TITLE_RECT, DEFAULT_BODY_RECT, SLIDE_IN, RECT_KEY,
  rectFor, dragRect, rectStyle,
} from '../src/lib/master-rect.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const eq = (name, got, want) => check(name, got === want, `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

// ---- 1. 缺省矩形与导出侧英寸默认值同源 -------------------------------------
{
  eq('幻灯片尺寸常量 W', SLIDE_IN.w, 10)
  eq('幻灯片尺寸常量 H', SLIDE_IN.h, 5.625)
  eq('标题缺省 x × W', +(DEFAULT_TITLE_RECT.x * SLIDE_IN.w).toFixed(4), 0.55)
  eq('标题缺省 y × H', +(DEFAULT_TITLE_RECT.y * SLIDE_IN.h).toFixed(4), 0.35)
  eq('标题缺省 w × W', +(DEFAULT_TITLE_RECT.w * SLIDE_IN.w).toFixed(4), 8.9)
  eq('标题缺省 h × H', +(DEFAULT_TITLE_RECT.h * SLIDE_IN.h).toFixed(4), 0.85)
  eq('正文缺省 x × W', +(DEFAULT_BODY_RECT.x * SLIDE_IN.w).toFixed(4), 0.65)
  eq('正文缺省 y × H', +(DEFAULT_BODY_RECT.y * SLIDE_IN.h).toFixed(4), 1.55)
  eq('正文缺省 w × W', +(DEFAULT_BODY_RECT.w * SLIDE_IN.w).toFixed(4), 8.7)
  eq('正文缺省 h × H', +(DEFAULT_BODY_RECT.h * SLIDE_IN.h).toFixed(4), 3.525)
  eq('键名映射 title', RECT_KEY.title, 'titleRect')
  eq('键名映射 body', RECT_KEY.body, 'bodyRect')
  const ex = read('../src/lib/pptx-export.ts')
  check('导出侧仍是同一组英寸默认值（没另起一套）',
    /rectOr\(titleRect, \{ x: 0\.55, y: 0\.35, w: W - 1\.1, h: 0\.85 \}\)/.test(ex)
    && /rectOr\(bodyRect, \{ x: 0\.65, y: 1\.55, w: W - 1\.3, h: H - 2\.1 \}\)/.test(ex))
}

// ---- 2. rectFor：有则用自己的、无则用缺省，且都返回副本 --------------------
{
  const a = rectFor(undefined, 'title')
  eq('无母版时用标题缺省值', JSON.stringify(a), JSON.stringify(DEFAULT_TITLE_RECT))
  a.x = 0.9
  check('返回副本，改它不污染缺省常量', Math.abs(DEFAULT_TITLE_RECT.x - 0.055) < 1e-9)
  const own = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }
  const b = rectFor({ titleRect: own }, 'title')
  eq('母版写了就用自己的', JSON.stringify(b), JSON.stringify(own))
  b.w = 0.8
  eq('自己的那份也不被就地改', own.w, 0.3)
  eq('没写 titleRect 时仍走缺省', rectFor({ bodyRect: own }, 'title').x, DEFAULT_TITLE_RECT.x)
}

// ---- 3. dragRect：两种模式 / 钳制 / 互逆 / 退化 ----------------------------
{
  const r = { x: 0.2, y: 0.3, w: 0.4, h: 0.5 }
  const moved = dragRect(r, 'move', 0.1, -0.05)
  eq('move：x 平移', moved.x, 0.3)
  eq('move：y 平移', moved.y, 0.25)
  eq('move：宽不变', moved.w, 0.4)
  eq('move：高不变', moved.h, 0.5)
  eq('move 互逆：再拖回去', dragRect(moved, 'move', -0.1, 0.05).x, 0.2)
  const sized = dragRect(r, 'resize', 0.1, -0.05)
  eq('resize：w 增长', sized.w, 0.5)
  eq('resize：h 缩短', sized.h, 0.45)
  eq('resize：锚点不动', sized.x, 0.2)
  eq('resize：y 不动', sized.y, 0.3)
  eq('move：右边界钳到 1.5', dragRect({ ...r, x: 1.4 }, 'move', 0.5, 0).x, 1.5)
  eq('move：左边界钳到 -0.5', dragRect({ ...r, x: -0.4 }, 'move', -0.5, 0).x, -0.5)
  eq('resize：最小宽 0.05', dragRect(r, 'resize', -10, 0).w, 0.05)
  eq('resize：最小高 0.03', dragRect(r, 'resize', 0, -10).h, 0.03)
  eq('resize：最大宽 1.5', dragRect(r, 'resize', 10, 0).w, 1.5)
  eq('resize：最大高 1.5', dragRect(r, 'resize', 0, 10).h, 1.5)
  eq('三位小数精度', dragRect(r, 'move', 0.123456, 0).x, 0.323)
  eq('非有限 dx 退回下界而不是 NaN', dragRect(r, 'move', Number.NaN, 0).x, -0.5)
  eq('非有限 dy 在 resize 也不写 NaN 进文件', dragRect(r, 'resize', 0, Number.POSITIVE_INFINITY).h, 0.03)
}

// ---- 4. rectStyle：归一化 → 百分比 -----------------------------------------
{
  const s = rectStyle({ x: 0.1, y: 0.2, w: 0.3, h: 0.4567 })
  eq('left', s.left, '10%')
  eq('top', s.top, '20%')
  eq('width', s.width, '30%')
  eq('百分比保留三位小数', s.height, '45.67%')
}

// ---- 5. 接线（源码级；真机拖拽没做浏览器对撞） -----------------------------
{
  const p = read('../src/components/PptEditor.tsx')
  const css = read('../src/index.css')
  const ppt = read('../src/lib/ppt.ts')
  const lib = read('../src/lib/master-rect.ts')
  check('组件引入 master-rect 的换算', /from '\.\.\/lib\/master-rect'/.test(p) && /dragRect\(d\.from, d\.mode, dx, dy\)/.test(p))
  check('第二套拖拽状态机按 kind/mode 记录', /masterDragRef = useRef/.test(p) && /kind: PlaceholderKind/.test(p))
  check('位移按舞台宽高折成比例（与形状拖拽同款）',
    /\(e\.clientX - d\.sx\) \/ d\.stage\.width/.test(p) && /\(e\.clientY - d\.sy\) \/ d\.stage\.height/.test(p))
  check('写回复用母版写入唯一出口 patchMaster（换引用，memo 才重渲染）', /patchMaster\(\{ \[key\]: next \}\)/.test(p))
  check('没有绕过唯一出口自己改 master', !/dk\.master = \{/.test(p))
  check('占位框百分比定位且随舞台 zoom', /rectStyle\(rectFor\(deck\.master, kind\)\)/.test(p))
  check('工具条有显隐开关', /setShowPlaceholders\(\(v\) => !v\)/.test(p))
  check('关着时不渲染占位框', /\{showPlaceholders &&/.test(p))
  check('母版配色按钮不再写「占位矩形不开放编辑」', !/占位矩形本轮不开放编辑/.test(p))
  check('ppt.ts 的旧注释同步更新', !/占位矩形（titleRect\/bodyRect）本轮不开放编辑/.test(ppt))
  check('CSS 三枚类都在', /\.ppt-master-rect \{/.test(css) && /\.ppt-master-rect-tag \{/.test(css) && /\.ppt-master-rect-handle \{/.test(css))
  // 注释里提到 pptx-export 的英寸默认值是同源说明，不算依赖；只查真 import
  check('换算模块不碰导出/导入链（只出纯函数）', !/from ['"][^'"]*pptx-(export|import)/.test(lib))
}

console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
