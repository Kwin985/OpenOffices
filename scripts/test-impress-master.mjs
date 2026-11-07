// v0.182 Impress 母版配色断言。
//
// 数据模型 / .opd 往返 / pptx 导出落点 / 舞台配色链全是现成的，本轮只补
// UI 入口。这里钉三件事：① `withMaster` 必须**换引用**（StaticSlide 是 memo，
// 原地改 master.bg 缩略图与放映不会重渲染）；② 四色经 serializeDeck→parseDeck
// 逐字还原；③ `stageColors` 的优先级与 PptEditor / StaticSlide 同源。
// 跑法：npx vite-node scripts/test-impress-master.mjs

import fs from 'node:fs'
import {
  emptyDeck, parseDeck, serializeDeck, themeOf, withMaster, stageColors,
} from '../src/lib/ppt.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const eq = (name, got, want) => check(name, got === want, `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

const base = emptyDeck()
const theme = themeOf(base.theme)

// ---- 1. withMaster：换引用 + 字段合并 ------------------------------------
{
  const next = withMaster(base, { bg: '#123456', bodyColor: '#eeeeee' })
  check('withMaster 换 deck 引用', next !== base)
  check('withMaster 换 master 引用（memo(StaticSlide) 才会重渲染）', next.master !== base.master)
  eq('底色写入', next.master?.bg, '#123456')
  eq('正文色写入', next.master?.bodyColor, '#eeeeee')
  eq('deck.theme 不动（luminance 只在导入时算一次）', next.theme, base.theme)
  eq('slides 引用不变', next.slides, base.slides)
  eq('空 master 时按 {} 起步', JSON.stringify(withMaster(base, {}).master), '{}')
}
{
  const withRect = withMaster(base, {
    titleRect: { x: 0.1, y: 0.1, w: 0.8, h: 0.2 },
    majorFont: 'Georgia',
  })
  const merged = withMaster(withRect, { bg: '#abcdef' })
  eq('不开放编辑的占位矩形原样保留', JSON.stringify(merged.master?.titleRect), JSON.stringify(withRect.master?.titleRect))
  eq('字族原样保留', merged.master?.majorFont, 'Georgia')
}

// ---- 2. .opd 往返 --------------------------------------------------------
{
  const patch = { bg: '#141a2b', bgImage: 'data:image/png;base64,AAAA', titleColor: '#5b8cff', bodyColor: '#e8ecf5' }
  const round = parseDeck(serializeDeck(withMaster(base, patch)))
  eq('底色往返', round.master?.bg, patch.bg)
  eq('背景图往返', round.master?.bgImage, patch.bgImage)
  eq('标题色往返', round.master?.titleColor, patch.titleColor)
  eq('正文色往返', round.master?.bodyColor, patch.bodyColor)
  eq('主题不变', round.theme, base.theme)
  // 恢复主题：四个字段置 undefined，JSON 序列化后不落键
  const restored = withMaster(round, {
    bg: undefined, bgImage: undefined, titleColor: undefined, bodyColor: undefined,
  })
  eq('恢复主题：底色消失', restored.master?.bg, undefined)
  eq('恢复主题：背景图消失', restored.master?.bgImage, undefined)
}

// ---- 3. stageColors 优先级 ----------------------------------------------
{
  const a = stageColors(base)
  eq('无 master：正文色回落主题', a.fg, theme.fg)
  eq('无 master：强调色回落主题', a.accent, theme.accent)
  eq('无 master：底色回落主题', a.bg, theme.bg)
  const m = withMaster(base, { bg: '#222222', titleColor: '#ff0000', bodyColor: '#ffffff' })
  const b = stageColors(m)
  eq('有 master：正文色取母版', b.fg, '#ffffff')
  eq('有 master：强调色取母版', b.accent, '#ff0000')
  eq('有 master：底色取母版', b.bg, '#222222')
  const c = stageColors(m, '#00ff00')
  eq('单页背景盖住底色', c.bg, '#00ff00')
  eq('单页背景不改文字色', c.fg, '#ffffff')
  eq('单页背景不改强调色', c.accent, '#ff0000')
}

// ---- 4. 源码级纪律 -------------------------------------------------------
{
  const ui = read('../src/components/PptEditor.tsx')
  const lib = read('../src/lib/ppt.ts')
  check('ppt.ts 导出 withMaster / stageColors',
    /export function withMaster/.test(lib) && /export function stageColors/.test(lib))
  check('UI 的 patchMaster 走 withMaster 并换引用',
    /const patchMaster = \(p: Partial<MasterStyle>\) =>[\s\S]{0,140}d\.master = withMaster\(d, p\)\.master/.test(ui))
  check('UI 有开关 state 与面板', /const \[showMaster, setShowMaster\]/.test(ui) && /母版背景 \/ 配色/.test(ui))
  check('UI 三个颜色输入复用 ppt-shape-color',
    (ui.match(/type="color"[\s\S]{0,120}className="ppt-shape-color"/g) ?? []).length >= 3)
  check('UI 舞台配色仍用同一条优先级链', /const fgColor = m\?\.bodyColor \?\? t\.fg/.test(ui))
  check('背景图上传另起 fileRef、不复用 pickImage',
    /masterBgRef/.test(ui) && /if \(f\) void fileToDataUri\(f\)\.then\(\(uri\) => patchMaster\(\{ bgImage: uri \}\)\)/.test(ui))
  check('面板明写占位矩形不开放编辑', /占位矩形本轮不开放编辑/.test(ui))
  check('纪律：没碰预存改动 / 未跟踪文件的导入',
    !/from '\.\/slide-chart'[\s\S]{0,200}withMaster/.test(ui))
}

console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
