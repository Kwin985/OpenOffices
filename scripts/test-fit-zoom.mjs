// v0.185 自动缩放档断言（适应页宽 / 适应整页）。
//
// Writer 与 Impress 早先共用 `ZOOM_STEPS` 七档刻度，PDF 用自己的连续 scale；
// 两边都没有「按当前页尺寸自动算一档」的入口。本轮把算法收进 view-zoom.ts，
// UI 只负责量尺寸：PDF 用 scale=1 的 viewport，Impress 用 rect/zoom 还原未缩放尺寸。
//
// 跑法：npx vite-node scripts/test-fit-zoom.mjs

import fs from 'node:fs'
import { ZOOM_STEPS, ZOOM_MIN, ZOOM_MAX, FIT_PADDING, clampZoom, fitZoom, nearestZoomStep, stageZoomStyle, zoomPct, zoomStep } from '../src/lib/view-zoom.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const eq = (name, got, want) => check(name, got === want, `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

// ---- 1. 纯函数：两种模式 ----------------------------------------------------
{
  eq('适应页宽：只按宽算（扣掉两侧内边距）', fitZoom(600, 800, 1000, 1000, 'width'), 1.587)
  eq('适应整页：取宽高两路的最小值', fitZoom(600, 800, 1000, 1000, 'page'), 1.19)
  eq('适应页宽：padding=0 时不扣边', fitZoom(600, 800, 1000, 1000, 'width', 0), 1.667)
  eq('适应整页：padding=0 时取 min(1.667,1.25)', fitZoom(600, 800, 1000, 1000, 'page', 0), 1.25)
  eq('高度是瓶颈时 page 走 byH', fitZoom(400, 1200, 1000, 1000, 'page'), 0.793)
  eq('宽度是瓶颈时 page 与 width 相同', fitZoom(1200, 400, 1000, 1000, 'page'), fitZoom(1200, 400, 1000, 1000, 'width'))
  eq('结果保留三位小数', fitZoom(300, 300, 1000, 1000, 'width'), 3.173)
  eq('FIT_PADDING 默认值', FIT_PADDING, 24)
}

// ---- 2. 退化口径：非法尺寸一律回 1 -----------------------------------------
{
  eq('页面宽 0', fitZoom(0, 800, 1000, 1000, 'width'), 1)
  eq('页面高 0', fitZoom(600, 0, 1000, 1000, 'page'), 1)
  eq('NaN 页面宽', fitZoom(Number.NaN, 800, 1000, 1000, 'width'), 1)
  eq('负容器宽', fitZoom(600, 800, -1, 1000, 'width'), 1)
  eq('容器比内边距还小', fitZoom(600, 800, 40, 40, 'width'), 1)
  eq('padding 为 NaN', fitZoom(600, 800, 1000, 1000, 'width', Number.NaN), 1)
  eq('Infinity 页面高', fitZoom(600, Number.POSITIVE_INFINITY, 1000, 1000, 'page'), 1)
}

// ---- 3. 不越权：纯函数不夹档位 ---------------------------------------------
{
  const huge = fitZoom(100, 100, 10000, 10000, 'width')
  check('fitZoom 不夹 ZOOM_MAX（PDF 自己有 3.0 上限）', huge > ZOOM_MAX, `得到 ${huge}`)
  const tiny = fitZoom(10000, 10000, 100, 100, 'page')
  check('fitZoom 不夹 ZOOM_MIN（缩小档交给调用方）', tiny < ZOOM_MIN, `得到 ${tiny}`)
  eq('clampZoom 仍是七档制之外的独立值域', clampZoom(1.234), 1.23)
}

// ---- 4. 档位制 UI 的落地 ---------------------------------------------------
{
  for (const s of ZOOM_STEPS) eq(`最近档位：${zoomPct(s)} 落到自己`, nearestZoomStep(s), s)
  eq('最近档位：1.12 → 100%', nearestZoomStep(1.12), 1)
  eq('最近档位：1.2 → 125%', nearestZoomStep(1.2), 1.25)
  eq('最近档位：0.1 → 50%', nearestZoomStep(0.1), 0.5)
  eq('最近档位：9 → 200%', nearestZoomStep(9), 2)
  eq('最近档位：NaN → 100%', nearestZoomStep(Number.NaN), 1)
  check('最近档位永远在档位表内', ZOOM_STEPS.includes(nearestZoomStep(1.41)))
  eq('原档位步进没被改坏', zoomStep(1, 1), 1.25)
  eq('舞台样式仍只给 zoom 一枚', JSON.stringify(stageZoomStyle(1.5)), '{"zoom":1.5}')
}

// ---- 5. 接线：两处 UI 共用同一份算法 ---------------------------------------
{
  const pdf = read('../src/components/PdfViewer.tsx')
  const ppt = read('../src/components/PptEditor.tsx')
  const lib = read('../src/lib/view-zoom.ts')
  check('lib 导出 fitZoom 与 nearestZoomStep', /export function fitZoom\(/.test(lib) && /export function nearestZoomStep\(/.test(lib))
  check('PDF 引入 fitZoom/FitMode', /import \{ fitZoom, type FitMode \} from '\.\.\/lib\/view-zoom'/.test(pdf))
  check('PDF 用 scale=1 的 viewport（未缩放页面尺寸）', /p\.getViewport\(\{ scale: 1 \}\)/.test(pdf))
  check('PDF 把容器尺寸交给纯函数', /fitZoom\(vp\.width, vp\.height, host\.clientWidth, host\.clientHeight, mode\)/.test(pdf))
  check('PDF 按自己的 [0.5,3] 夹一次', /Math\.min\(SCALE_MAX, Math\.max\(SCALE_MIN, z\)\)/.test(pdf))
  check('PDF 两枚按钮都在且未打开时禁用', /fitTo\('width'\), !doc/.test(pdf) && /fitTo\('page'\), !doc/.test(pdf))
  check('Impress 引入 fitZoom/nearestZoomStep/FitMode', /fitZoom, nearestZoomStep/.test(ppt) && /type FitMode/.test(ppt))
  check('Impress 用 rect/zoom 还原未缩放页面尺寸', /r\.width \/ zoom, r\.height \/ zoom/.test(ppt))
  check('Impress 扣掉 CSS 的 26px padding', /wrap\.clientWidth, wrap\.clientHeight, mode, 26/.test(ppt))
  check('Impress 自动值落到最近一档（select 不显示空白）', /setZoom\(nearestZoomStep\(z\)\)/.test(ppt))
  check('Impress 两枚按钮都在', /fitTo\('width'\)/.test(ppt) && /fitTo\('page'\)/.test(ppt))
  check('缩放口径没有第二份实现（三处都不自己算除法）',
    !/clientWidth\s*\/\s*vp\.width/.test(pdf) && !/clientWidth\s*\/\s*r\.width/.test(ppt)
      && !/clientWidth\s*\/\s*effPx\.w/.test(read('../src/components/DocEditor.tsx')))
  // v0.187：Writer 补齐自动档（v0.185 判断「纸面固定版心没有新信息」偏保守——
  // 视口宽会随侧栏开合变化）。三处 UI 现在共用同一份 fitZoom。
  const doc = read('../src/components/DocEditor.tsx')
  check('Writer 引入 fitZoom/nearestZoomStep/FitMode', /fitZoom, nearestZoomStep/.test(doc) && /type FitMode/.test(doc))
  check('Writer 用未缩放纸面尺寸 + 滚动容器尺寸', /fitZoom\(effPx\.w, effPx\.h, host\.clientWidth, host\.clientHeight, mode\)/.test(doc))
  check('Writer 自动值落到最近一档（select 不显示空白）', /setZoom\(nearestZoomStep\(z\)\)/.test(doc))
  check('Writer 两枚按钮都在', /fitTo\('width'\)/.test(doc) && /fitTo\('page'\)/.test(doc))
}

console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
