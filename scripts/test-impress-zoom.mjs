// Impress 视图缩放（v0.178）的结构断言。
//
// 缩放最怕的不是「数字算错」，而是悄悄渗进不该渗的地方：导出 pptx/PDF 时把
// 屏幕上的 150% 带进文件，或放映时跟着放大。这里把「值从哪来、谁读它、谁不该读」
// 三条分别钉住；纯函数直接跑，接线用源码级断言（Node 侧没有 DOM，不装浏览器）。
import fs from 'node:fs'
import {
  ZOOM_STEPS,
  clampZoom,
  stageZoomStyle,
  zoomByWheel,
  zoomPct,
  zoomStep,
} from '../src/lib/view-zoom.ts'

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')
const ok = []
const bad = []
const check = (name, cond, detail) => (cond ? ok : bad).push(detail ? `${name} — ${detail}` : name)
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want),
  JSON.stringify(got) === JSON.stringify(want) ? '' : `得到 ${JSON.stringify(got)}，期望 ${JSON.stringify(want)}`)

// ───────────────────── 1. 档位定义（与 Writer 共用一份）─────────────────────
{
  eq('档位：七档', [...ZOOM_STEPS], [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2])
  eq('边界：超过 2 收在 2', clampZoom(9), 2)
  eq('边界：低于 0.5 收在 0.5', clampZoom(0.1), 0.5)
  eq('边界：非有限值回 100%', clampZoom(Number.NaN), 1)
  eq('步进：1 → 1.25', zoomStep(1, 1), 1.25)
  eq('步进：2 到顶不动', zoomStep(2, 1), 2)
  eq('步进：0.5 到底不动', zoomStep(0.5, -1), 0.5)
  eq('滚轮：上滚放大', zoomByWheel(1, -100), 1.25)
  eq('滚轮：下滚缩小', zoomByWheel(1, 100), 0.75)
  eq('显示：1.75 → 175%', zoomPct(1.75), '175%')
  eq('舞台样式：只产出一枚 zoom', stageZoomStyle(1.5), { zoom: 1.5 })
  eq('舞台样式：脏值也归一', stageZoomStyle(999), { zoom: 2 })
}

// ───────────────────── 2. 接线：只有舞台读它 ─────────────────────
{
  const src = read('../src/components/PptEditor.tsx')
  const zoomSrc = read('../src/lib/view-zoom.ts')
  const css = read('../src/index.css')
  check('接线：从共用模块导入档位与 stageZoomStyle',
    /import \{ ZOOM_STEPS, clampZoom, stageZoomStyle, zoomByWheel, zoomPct, zoomStep \} from '\.\.\/lib\/view-zoom'/.test(src))
  check('接线：stageZoomStyle 是单一事实源（组件里不另算 zoom 值）',
    /\.\.\.stageZoomStyle\(zoom\)/.test(src) && !/zoom:\s*clampZoom|zoom:\s*zoom\b/.test(src))
  check('接线：缩放状态初值 100%', /const \[zoom, setZoom\] = useState\(1\)/.test(src))
  check('接线：Ctrl+滚轮挂舞台滚动容器，不是 window',
    /stageWrapRef\.current/.test(src) && /el\.addEventListener\('wheel', onWheel, \{ passive: false \}\)/.test(src)
      && /if \(!e\.ctrlKey\) return/.test(src) && /e\.preventDefault\(\)/.test(src))
  check('接线：wheel 监听挂在 .ppt-stage-wrap 的 ref 上',
    /className="ppt-stage-wrap" ref=\{stageWrapRef\}/.test(src))
  check('接线：七个档位都进下拉', /ZOOM_STEPS\.map\(\(s\)/.test(src))
  check('接线：加减/复位四个入口都在', /zoomStep\(z, -1\)/.test(src) && /zoomStep\(z, 1\)/.test(src)
    && /setZoom\(1\)/.test(src) && /clampZoom\(Number\(e\.target\.value\)\)/.test(src))
  check('接线：工具条控件提示写明「导出/放映 100%」',
    /导出 pptx\/PDF 与放映始终按 100%/.test(src))
  check('CSS：打印把内联 zoom 压回 1', /@media print \{[\s\S]{0,120}\.ppt-stage \{\s*zoom: 1 !important;/.test(css))
  check('纯函数：stageZoomStyle 在共用模块里导出（不是组件内私算）',
    /export function stageZoomStyle/.test(zoomSrc))
}

// ───────────────────── 3. 边界：导出 / 放映 / 存档都不碰 zoom ─────────────────────
{
  const src = read('../src/components/PptEditor.tsx')
  const exportSrc = read('../src/lib/pptx-export.ts')
  const importSrc = read('../src/lib/pptx-import.ts')
  const staticSrc = read('../src/components/StaticSlide.tsx')
  check('隔离：pptx 导出只吃 deck 数据', /deckToPptxBytes\(deck\)/.test(src) && !/\bzoom\b/i.test(exportSrc))
  check('隔离：pptx 导入不读屏幕缩放', !/\bzoom\b/i.test(importSrc))
  check('隔离：放映用的 StaticSlide 不读屏幕缩放', !/\bzoom\b/i.test(staticSrc))
  check('隔离：PDF 走离屏 .ppt-print-page', /className="ppt-print-page"/.test(src)
    && /exportPdfWithOverlay/.test(src))
  check('隔离：serializeDeck 不带 zoom 字段', !/zoom/.test(read('../src/lib/ppt.ts')))
  check('隔离：缩放值没有进 setDeck / editSlide 的载荷',
    !/setDeck\([^)]*\bzoom\b|editSlide\([^)]*\bzoom\b/.test(src))
}

console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
