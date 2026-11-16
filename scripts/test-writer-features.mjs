// v0.173 两项 Writer 功能的结构断言：文档结构图 / 格式刷。
//
// 为什么单独一份：这两处都刻意做成了「纯函数 + UI 接线」两层——lib 里的形状能用
// Node 侧的真 schema 钉死，而「按钮有没有真的接上那枚函数」是另一回事（v0.162
// 漏改不报错那条教训）。所以末尾另有一组源码级接线断言。
//
// 跑法：npx vite-node scripts/test-writer-features.mjs

import fs from 'node:fs'
import { getSchema } from '@tiptap/core'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { docExtensions } from '../src/lib/doc-schema.ts'
import { outlineOf, activeOutlinePos } from '../src/lib/outline.ts'
import {
  PAINT_EXCLUDE,
  captureFormat,
  marksForSchema,
  paintableMarkNames,
} from '../src/lib/format-painter.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => {
  ;(cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
}
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)

const schema = getSchema(docExtensions())
const t = (text, marks = []) => schema.text(text, marks)
const para = (attrs, ...kids) => schema.node('paragraph', attrs, kids)
const head = (level, text) => schema.node('heading', { level }, text ? [t(text)] : [])
const doc = (...kids) => schema.node('doc', null, kids)

// ───────────────────── 1. 文档结构图 ─────────────────────

{
  const d = doc(
    head(1, '第一章 总则'),
    para(null, t('正文一句')),
    head(2, '1.1 适用范围'),
    head(4, '1.1.1 细则'),
    head(2, ''),              // 空标题不该占一格
    head(9, '越界层级'),       // UI 只有四档缩进，按边界收
  )
  const list = outlineOf(d)
  eq('结构图：条数（空标题跳过）', list.length, 4)
  eq('结构图：层级序列', list.map((x) => x.level), [1, 2, 4, 4])
  eq('结构图：文本序列', list.map((x) => x.text), ['第一章 总则', '1.1 适用范围', '1.1.1 细则', '越界层级'])
  check('结构图：pos 严格递增且落在节点边界', list.every((x, i) => x.pos >= 0 && (i === 0 || x.pos > list[i - 1].pos)))
  eq('结构图：空文档', outlineOf(doc(para(null, t('没有标题')))), [])
  // 文档以段落开头时，光标在引子里还没进任何一节
  const withPreface = doc(para(null, t('引子')), head(1, '第一章'))
  eq('结构图：光标在第一枚标题之前', activeOutlinePos(outlineOf(withPreface), 1), -1)
  // 文档以标题开头时 pos=0 就是第一节的起点，应当判成落在第一节
  eq('结构图：光标与首节起点重合', activeOutlinePos(list, 0), list[0].pos)
  eq('结构图：光标落在第二节之后', activeOutlinePos(list, list[2].pos + 1), list[2].pos)
  eq('结构图：光标越过最后一节', activeOutlinePos(list, d.content.size), list[3].pos)
  eq('结构图：空清单', activeOutlinePos([], 10), -1)
}

// 目录节点与导航窗格必须共用同一段遍历，不许各自抄一份 descendants
{
  const toc = fs.readFileSync(new URL('../src/lib/toc-extension.ts', import.meta.url), 'utf8')
  check('结构图：目录节点复用 outlineOf（单一事实源）', /collectHeadings[\s\S]{0,160}outlineOf\(/.test(toc))
  check('结构图：目录里没有第二份 descendants', !/doc\.descendants/.test(toc))
}

// ───────────────────── 2. 格式刷：捕到什么 ─────────────────────

{
  const marks = [
    schema.marks.bold.create(),
    schema.marks.textStyle.create({ color: '#ff0000', fontSize: '18px' }),
    schema.marks.highlight.create({ color: '#fff59d' }),
    schema.marks.comment.create(),
    schema.marks.revIns.create(),
    schema.marks.link.create({ href: 'https://example.test' }),
    schema.marks.bookmark.create(),
  ]
  const d = doc(para({ textAlign: 'center' }, t('加粗红字', marks)))
  const state = EditorState.create({ doc: d, selection: TextSelection.create(d, 2, 5) })
  const payload = captureFormat(state)
  const names = payload.marks.map((m) => m.type)
  eq('格式刷：只留外观 mark', names.sort(), ['bold', 'highlight', 'textStyle'])
  eq('格式刷：textStyle 原值带回', payload.marks.find((m) => m.type === 'textStyle')?.attrs.color, '#ff0000')
  eq('格式刷：非默认对齐带回', payload.align, 'center')
  check('格式刷：身份 mark 一枚不进载荷', [...PAINT_EXCLUDE].every((n) => !names.includes(n)))

  // 默认左对齐：不带 align，免得给目标白写一枚属性
  const left = doc(para(null, t('普通字', [schema.marks.bold.create()])))
  const s2 = EditorState.create({ doc: left, selection: TextSelection.create(left, 2, 4) })
  eq('格式刷：默认左对齐不进载荷', captureFormat(s2).align, null)
  eq('格式刷：载荷里仍有 bold', captureFormat(s2).marks.map((m) => m.type), ['bold'])

  // 空段：既没有 marks 也没有对齐
  const empty = doc(para(null))
  const s3 = EditorState.create({ doc: empty, selection: TextSelection.create(empty, 1, 1) })
  eq('格式刷：空段载荷为空', captureFormat(s3), { marks: [], align: null })
}

// ───────────────────── 3. 格式刷：还原成什么 ─────────────────────

{
  const names = paintableMarkNames(schema)
  check('格式刷：可清名单含 bold / textStyle / highlight', ['bold', 'textStyle', 'highlight'].every((n) => names.includes(n)))
  check('格式刷：可清名单不含身份 mark', [...PAINT_EXCLUDE].every((n) => !names.includes(n)), names.join(','))

  const payload = {
    marks: [
      { type: 'bold', attrs: {} },
      { type: 'textStyle', attrs: { color: '#00ff00' } },
      { type: 'comment', attrs: { id: 'c9' } },   // 排除名单，即便混进载荷也不还原
      { type: 'notAMark', attrs: {} },            // schema 里没有，跳过而不是整笔作废
    ],
    align: 'right',
  }
  const restored = marksForSchema(schema, payload)
  eq('格式刷：非法/身份型各跳过，其余照刷', restored.map((m) => m.type.name), ['bold', 'textStyle'])
  eq('格式刷：还原出的属性保持原值', restored[1].attrs.color, '#00ff00')
  eq('格式刷：空载荷还原为空', marksForSchema(schema, { marks: [], align: null }), [])
}

// ───────────────────── 4. UI 接线（漏接不报错，只能钉源码）─────────────────────

{
  const src = fs.readFileSync(new URL('../src/components/DocEditor.tsx', import.meta.url), 'utf8')
  const css = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
  check('接线：导航窗格接 outlineOf / activeOutlinePos', src.includes('outlineOf(') && src.includes('activeOutlinePos('))
  check('接线：格式刷接 captureFormat / paintableMarkNames / marksForSchema',
    src.includes('captureFormat(') && src.includes('paintableMarkNames(') && src.includes('marksForSchema('))
  check('接线：格式刷有 Esc 退出与双击连刷', src.includes('painterLocked') && src.includes('onDoubleClick'))
  check('接线：导航侧栏的类名先进 CSS', src.includes('doc-outline-item') && css.includes('.doc-outline-item'))
  check('接线：导航开关只在打开时才遍历全文', /navOpen\s*\?\s*outlineOf\(/.test(src))
}

console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
