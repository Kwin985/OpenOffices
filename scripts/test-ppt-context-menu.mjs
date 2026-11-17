// v0.206 断言：Impress 内容区右键菜单的条目表与坐标裁剪是纯函数、可钉。
// 跑法：pnpm exec vite-node scripts/test-ppt-context-menu.mjs
import { pptContextItems, clampMenuPos, contextItems } from '../src/lib/context-menu.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const eq = (name, got, want) => check(name, got === want, `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
const ctx = (o = {}) => ({
  onShape: true, isChart: false, isText: true, editing: false,
  hasClipboard: false, hasPrev: true, hasNext: true, ...o,
})
const ids = (s) => pptContextItems(s).map((x) => x.id)
const item = (s, id) => pptContextItems(s).find((x) => x.id === id)

// ── ① 形状上下文 ──────────────────────────────────────────
{
  const list = ids(ctx())
  for (const id of ['editText', 'duplicate', 'delete', 'layerUp', 'layerDown', 'find', 'prevSlide', 'nextSlide']) {
    check(`形状态含 ${id}`, list.includes(id))
  }
  check('形状态不含页级新增项', !list.includes('addText') && !list.includes('addTable') && !list.includes('addChart'))
  check('editText 在编辑中改标签', item(ctx({ editing: true }), 'editText').label === '结束编辑')
  check('非文本非图表时 editText 灰掉', item(ctx({ isText: false, isChart: false }), 'editText').disabled === true)
  check('文本态 editText 不带 disabled 属性', !('disabled' in item(ctx({ isText: true }), 'editText')))
}

// ── ② 图表专属项 ──────────────────────────────────────────
{
  check('图表态有 chartData', ids(ctx({ isChart: true })).includes('chartData'))
  check('非图表态无 chartData', !ids(ctx({ isChart: false })).includes('chartData'))
  check('图表态 chartData 前独立分隔线', item(ctx({ isChart: true }), 'sep-chart')?.separator === true)
  check('chartData 自身不是分隔线', item(ctx({ isChart: true }), 'chartData').separator !== true)
}

// ── ③ 空白上下文 ──────────────────────────────────────────
{
  const list = ids(ctx({ onShape: false }))
  for (const id of ['addText', 'addTable', 'addChart']) check(`空白态含 ${id}`, list.includes(id))
  check('空白态不含形状项', !list.includes('delete') && !list.includes('layerUp'))
  check('无剪贴板时 paste 灰掉', item(ctx({ onShape: false, hasClipboard: false }), 'paste').disabled === true)
  check('有剪贴板时 paste 不带 disabled', !('disabled' in item(ctx({ onShape: false, hasClipboard: true }), 'paste')))
}

// ── ④ 翻页边界 ────────────────────────────────────────────
{
  check('首页 prevSlide 灰掉', item(ctx({ hasPrev: false }), 'prevSlide').disabled === true)
  check('末页 nextSlide 灰掉', item(ctx({ hasNext: false }), 'nextSlide').disabled === true)
  check('中间页两枚都不灰', !('disabled' in item(ctx(), 'prevSlide')) && !('disabled' in item(ctx(), 'nextSlide')))
}

// ── ⑤ id 唯一 / 分隔线契约 ────────────────────────────────
{
  for (const s of [ctx(), ctx({ onShape: false }), ctx({ isChart: true })]) {
    const list = pptContextItems(s)
    eq('id 唯一', new Set(list.map((x) => x.id)).size, list.length)
    check('分隔线 label 为空', list.filter((x) => x.separator).every((x) => x.label === ''))
  }
}

// ── ⑥ 坐标裁剪（Writer / Impress 共用）────────────────────
{
  eq('右上角不裁', clampMenuPos(50, 60, 1000, 800).x, 50)
  const right = clampMenuPos(990, 790, 1000, 800)
  eq('右溢出裁到 vw-w', right.x, 800)
  eq('下溢出裁到 vh-h', right.y, 420)
  eq('左上不越 8', clampMenuPos(-5, -9, 1000, 800).x, 8)
  eq('左上 y 不越 8', clampMenuPos(-5, -9, 1000, 800).y, 8)
  const tiny = clampMenuPos(50, 50, 100, 100, 200, 380)
  eq('视口小于菜单时 x 兜底 8', tiny.x, 8)
  eq('视口小于菜单时 y 兜底 8', tiny.y, 8)
}

// ── ⑦ 不破坏 Writer 原表 ──────────────────────────────────
{
  const w = contextItems({ hasSelection: true, inTable: true, navOpen: false, painterArmed: false })
  check('Writer 原表仍有清除格式', w.some((x) => x.id === 'clearFormat'))
  check('Writer 表格项仍在', w.some((x) => x.id === 'addRow'))
}

// ── ⑧ 组件接线（源码形状，纯函数测不到的那一层）────────────
import { readFileSync } from 'node:fs'
{
  const ui = readFileSync(new URL('../src/components/PptEditor.tsx', import.meta.url), 'utf8')
  check('import 了 pptContextItems/clampMenuPos', /pptContextItems/.test(ui) && /clampMenuPos/.test(ui))
  check('形状与舞台都挂 onContextMenu', (ui.match(/onContextMenu=/g) ?? []).length >= 2)
  check('形状右键 stopPropagation（不冒泡成空白菜单）', /onContextMenu[\s\S]{0,160}stopPropagation\(\)/.test(ui))
  check('菜单用公共 doc-ctx-menu 类（不碰 index.css）', ui.includes('className="doc-ctx-menu"'))
  check('坐标经 clampMenuPos', /clampMenuPos\(ctxMenu\.x/.test(ui))
  // runCtx 刻意只调现成动作包装（它们已走 editSlide），自身不碰 setDeck——
  // 断言「runCtx 体内无裸 setDeck」+「duplicateShape 走 editSlide」两段，比单看一段准。
  const runCtxBody = ui.slice(ui.indexOf('const runCtx'), ui.indexOf('const shapePointerDown'))
  check('runCtx 体内无裸 setDeck', !/setDeck\(/.test(runCtxBody))
  check('复制/粘贴动作走 editSlide', /const duplicateShape[\s\S]{0,400}editSlide/.test(ui) && /const pasteShape[\s\S]{0,400}editSlide/.test(ui))
  check('点菜单项先收起再执行', /setCtxMenu\(null\)[\s\S]{0,80}runCtx\(/.test(ui))
  check('Esc 捕获阶段收菜单', /addEventListener\('keydown', onKey, true\)/.test(ui))
  check('形状剪贴板驱动 paste 灰掉', /hasClipboard: shapeClip !== null/.test(ui))
  check('复制形状换新 id 并清揭示动画', /duplicateShape[\s\S]{0,300}anim: undefined/.test(ui))
}

console.log(`ppt-context-menu: ${ok.length} 通过 / ${bad.length} 失败`)
for (const b of bad) console.error('  FAIL ' + b)
if (bad.length) process.exitCode = 1
