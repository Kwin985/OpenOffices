// v0.174 两组断言：Writer 外壳（视图缩放 / 右键菜单）与 docx 导入索引的接线。
//
// 前者是纯函数（刻度、条目表）+ 源码级接线（漏接不报错，v0.162 那条教训）；
// 后者钉的是「5 个 note* 不再各自摊平全树」——真语义等价由两本账在门禁里验，
// 这里只保证源码形状没退回旧写法，且打印缩放确实被 !important 压回去。
//
// 跑法：npx vite-node scripts/test-writer-shell.mjs

import fs from 'node:fs'
import {
  ZOOM_STEPS, ZOOM_MIN, ZOOM_MAX,
  clampZoom, zoomStep, zoomByWheel, zoomPct,
} from '../src/lib/view-zoom.ts'
import { contextItems } from '../src/lib/context-menu.ts'
import { previewUi, estimatePages } from '../src/lib/print-preview.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => {
  ;(cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
}
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)
const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')

// ───────────────────── 1. 视图缩放 ─────────────────────

{
  eq('缩放：低于下限钳住', clampZoom(0.3), ZOOM_MIN)
  eq('缩放：高于上限钳住', clampZoom(5), ZOOM_MAX)
  eq('缩放：非法值回 100%', clampZoom(Number.NaN), 1)
  eq('缩放：两位小数归一', clampZoom(1.234), 1.23)
  eq('缩放：档位含 100%', ZOOM_STEPS.includes(1), true)
  check('缩放：档位严格递增', ZOOM_STEPS.every((s, i) => i === 0 || s > ZOOM_STEPS[i - 1]))
  eq('缩放：向上一步', zoomStep(1, 1), 1.25)
  eq('缩放：向下一步', zoomStep(1, -1), 0.75)
  eq('缩放：到顶不再走', zoomStep(2, 1), ZOOM_MAX)
  eq('缩放：到底不再走', zoomStep(0.5, -1), ZOOM_MIN)
  eq('缩放：上滚放大', zoomByWheel(1, -120), 1.25)
  eq('缩放：下滚缩小', zoomByWheel(1, 120), 0.75)
  eq('缩放：百分比串', zoomPct(1.25), '125%')
  check('缩放：滚轮结果的每一档都在下拉里',
    ZOOM_STEPS.every((s) => ZOOM_STEPS.includes(zoomByWheel(s, 1)) || s === ZOOM_MIN))
}

// ───────────────────── 2. 右键菜单条目表 ─────────────────────

{
  const base = { hasSelection: false, inTable: false, navOpen: false, painterArmed: false }
  const items = contextItems(base)
  const byId = (list, id) => list.find((x) => x.id === id)
  eq('菜单：无选区时剪切禁用', byId(items, 'cut')?.disabled, true)
  eq('菜单：无选区时复制禁用', byId(items, 'copy')?.disabled, true)
  eq('菜单：粘贴始终可用', byId(items, 'paste')?.disabled, undefined)
  eq('菜单：默认无表格项', byId(items, 'addRow'), undefined)
  eq('菜单：默认两条分隔线', items.filter((x) => x.separator).length, 2)
  eq('菜单：id 不重复', new Set(items.map((x) => x.id)).size, items.length)

  const sel = contextItems({ ...base, hasSelection: true })
  eq('菜单：有选区时剪切可用', byId(sel, 'cut')?.disabled, undefined)
  eq('菜单：有选区时复制可用', byId(sel, 'copy')?.disabled, undefined)

  const table = contextItems({ ...base, inTable: true })
  check('菜单：表格语境多出插行/删行', !!byId(table, 'addRow') && !!byId(table, 'deleteRow'))
  eq('菜单：表格语境三条分隔线', table.filter((x) => x.separator).length, 3)
  eq('菜单：导航开着时标签改口', byId(contextItems({ ...base, navOpen: true }), 'nav')?.label, '收起导航窗格')
  eq('菜单：格式刷待刷时标签改口', byId(contextItems({ ...base, painterArmed: true }), 'painter')?.label, '取消格式刷')
  check('菜单：每一项都有可见标签或显式是分隔线', items.every((x) => x.separator || !!x.label))
}

// ───────────────────── 3. UI 接线（漏接不报错，只能钉源码）─────────────────────

{
  const src = read('../src/components/DocEditor.tsx')
  const css = read('../src/index.css')
  check('接线：缩放接进纸面 style', /padding:[^\n]+\n\s+zoom,/.test(src))
  check('接线：Ctrl+滚轮监听挂在 .doc-scroll', src.includes('ref={scrollRef}') && src.includes("addEventListener('wheel'"))
  check('接线：右键入口 preventDefault 后开菜单', src.includes('onContextMenu={(e) =>') && src.includes('setCtxMenu({ x: e.clientX'))
  check('接线：菜单条目由 lib 生成', src.includes('contextItems({'))
  check('接线：菜单有点外部/Esc 收起', src.includes("window.addEventListener('pointerdown'") && src.includes('doc-ctx-menu'))
  check('接线：打印时缩放压回 100%', css.includes('zoom: 1 !important'))
  check('接线：菜单与缩放类名先进 CSS', css.includes('.doc-ctx-menu') && css.includes('.doc-zoom'))
}

// ───────────────────── 4. 导入索引：note* 不再各自摊平全树 ─────────────────────

{
  const src = read('../src/lib/docx-fidelity.ts')
  // 只截 note* 函数族（从 noteDocumentMarks 到 docBackgroundOf 之前）
  const from = src.indexOf('function noteDocumentMarks')
  const to = src.indexOf('function docBackgroundOf')
  const notes = src.slice(from, to)
  check('索引：入口建一次索引', src.includes('const marksIndex = buildDocIndex(doc)'))
  check('索引：5 个 note* 都吃同一份索引', (src.match(/note\w+Marks\(marksIndex\)/g) ?? []).length === 5)
  check('索引：note* 内不再有 allDesc', !notes.includes('allDesc('))
  check('索引：VML/Drawing 不再「每标签一次子树」',
    !notes.includes('allDesc(pict, tag)') && !notes.includes('Object.keys(VML_SHELL_ATTRS)'))
  check('索引：查表口径单一（tagOf / kids）', notes.includes('tagOf(idx,') && notes.includes('idx.pictKids') && notes.includes('idx.drawingKids'))
  check('索引：schemeClr 仍只问第一枚', notes.includes('idx.firstSchemeClr'))
}

// ───────────────────── 5. 独立打印预览（v0.175）─────────────────────

{
  eq('预览：关着时是可编辑、无预览条', previewUi(false), {
    editable: true, showEditorBars: true, showSidebars: true, showPreviewBar: false,
  })
  eq('预览：开着时只读、只留预览条', previewUi(true), {
    editable: false, showEditorBars: false, showSidebars: false, showPreviewBar: true,
  })
  eq('预览：空文档也是一页', estimatePages(0, 1000, 100, 100), 1)
  eq('预览：正好一版心', estimatePages(800, 1000, 100, 100), 1)
  eq('预览：刚超一点算两页', estimatePages(801, 1000, 100, 100), 2)
  eq('预览：三页半算四页', estimatePages(2800, 1000, 100, 100), 4)
  eq('预览：版心非正时兜一页', estimatePages(5000, 100, 100, 100), 1)
  eq('预览：非有限内容兜一页', estimatePages(Number.NaN, 1000, 100, 100), 1)
  eq('预览：负内容兜一页', estimatePages(-500, 1000, 100, 100), 1)

  const src = read('../src/components/DocEditor.tsx')
  const css = read('../src/index.css')
  const lib = read('../src/lib/print-preview.ts')
  check('预览：工具条与预览条都接状态函数', src.includes('previewUi(previewOpen).showPreviewBar'))
  check('预览：切只读（setEditable）', src.includes('editor.setEditable(!previewOpen)'))
  check('预览：Esc 退出', /if \(!previewOpen\) return[\s\S]{0,200}setPreviewOpen\(false\)/.test(src))
  check('预览：状态栏与预览条共用 estimatePages', (src.match(/estimatePages\(/g) ?? []).length >= 2 && !src.includes('Math.ceil(docH'))
  check('预览：只读态不弹编辑右键菜单', /onContextMenu=\{\(e\) => \{[\s\S]{0,160}if \(previewOpen\) return/.test(src))
  check('预览：一条 CSS 收起所有工具条/面板', css.includes('.editor-pane.is-preview > :not(.doc-body)'))
  check('预览：预览条与侧栏样式在位', css.includes('.doc-preview-bar') && css.includes('.editor-pane.is-preview .doc-outline'))
  check('预览：诚实边界写进 lib', lib.includes('逐页翻页'))
}

// ───────────────────── 6. pptx 导入：一页一份 .rels 索引（v0.175）─────────────────────

{
  const src = read('../src/lib/pptx-import.ts')
  check('pptx：入口只解析一次', src.includes('const rels = slideRelsOf(relsText)'))
  check('pptx：旧的两份解析器已退场', !src.includes('parseRels(') && !src.includes('relsEntries('))
  check('pptx：形状用 byId、备注用 entries', src.includes('rels.byId.get(embed)') && src.includes('rels.entries.find('))
  check('pptx：背景与备注都吃同一份索引', src.includes('bgOf(root, zip, rels,') && src.includes('parseNotes(zip, rels)'))
  check('pptx：每枚关系属性仍走 ga 漏斗', ["ga(r, 'Id')", "ga(r, 'Type')", "ga(r, 'Target')"].every((s) => src.includes(s)))
  check('pptx：同进程 A/B 基准在库', fs.existsSync(new URL('../scripts/bench-pptx-import.mjs', import.meta.url)))
}

console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
