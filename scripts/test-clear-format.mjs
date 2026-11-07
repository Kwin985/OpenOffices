// v0.183 Writer「清除格式」断言。
//
// 纪律：清除格式摘的是**字符外观**，不是「删除标注」。批注锚 / 书签 / 修订 /
// 超链接带身份与外部目标，抹掉它们等于把别人的标注一起删了，所以整列排除；
// 节点类型（标题→段落）也不越权改。名单与格式刷同源、抽在 lib 里可纯函数钉。
//
// 跑法：npx vite-node scripts/test-clear-format.mjs

import fs from 'node:fs'
import { getSchema } from '@tiptap/core'
import { contextItems } from '../src/lib/context-menu.ts'
import { clearableMarkNames, paintableMarkNames, PAINT_EXCLUDE } from '../src/lib/format-painter.ts'
import { docExtensions } from '../src/lib/doc-schema.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const eq = (name, got, want) => check(name, got === want, `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

// ---- 1. 右键菜单条目表（纯函数） -------------------------------------------
{
  const base = { hasSelection: false, inTable: false, navOpen: false, painterArmed: false }
  const ids = (s) => contextItems(s).map((i) => i.id)
  check('菜单：有 clearFormat 这一项', ids(base).includes('clearFormat'))
  eq('菜单：clearFormat 文案', contextItems(base).find((i) => i.id === 'clearFormat')?.label, '清除格式')
  check('菜单：clearFormat 排在 selectAll 之后、第二道分隔线之前',
    ids(base).indexOf('clearFormat') === ids(base).indexOf('selectAll') + 1
      && ids(base).indexOf('clearFormat') < ids(base).indexOf('sep-2'))
  check('菜单：无选区时 clearFormat 不灰掉（清后续输入格式）',
    contextItems(base).find((i) => i.id === 'clearFormat')?.disabled === undefined)
  check('菜单：有选区时也不灰掉',
    contextItems({ ...base, hasSelection: true }).find((i) => i.id === 'clearFormat')?.disabled === undefined)
  check('菜单：表格语境另外多两枚行操作，clearFormat 仍在',
    ids({ ...base, inTable: true }).includes('clearFormat')
      && ids({ ...base, inTable: true }).includes('addRow'))
  check('菜单：disabled 只在真禁用时出现（旧纪律不破）',
    contextItems({ ...base, hasSelection: true }).every((i) => i.disabled !== false))
}

// ---- 2. 清除名单（真实 schema 上的纯函数） ----------------------------------
{
  const schema = getSchema(docExtensions())
  const names = clearableMarkNames(schema)
  check('名单：非空且覆盖外观 mark',
    names.includes('bold') && names.includes('italic') && names.includes('textStyle'))
  for (const id of PAINT_EXCLUDE) {
    if (schema.marks[id]) check(`名单：身份型 ${id} 整列排除`, !names.includes(id))
  }
  eq('名单：与格式刷同源', JSON.stringify(names), JSON.stringify(paintableMarkNames(schema)))
  check('名单：不重复、都是 schema 里真有的 mark',
    new Set(names).size === names.length && names.every((n) => !!schema.marks[n]))
}

// ---- 3. 执行分支与接线 ------------------------------------------------------
{
  const ui = read('../src/components/DocEditor.tsx')
  const lib = read('../src/lib/format-painter.ts')
  check('接线：右键菜单项由 contextItems 生成（不是硬编码按钮）', /contextItems\(\{/.test(ui))
  check('接线：runCtx 有 clearFormat 分支', /case 'clearFormat': \{/.test(ui))
  const seg = ui.slice(ui.indexOf("case 'clearFormat': {"), ui.indexOf("case 'clearFormat': {") + 420)
  check('执行：用 clearableMarkNames 循环 unsetMark',
    /for \(const name of clearableMarkNames\(editor\.state\.schema\)\) chain\.unsetMark\(name\)/.test(seg))
  check('执行：三个样式标签一起摘',
    /setPstyle\(null\)\.setRStyle\(null\)\.setTableStyle\(null\)\.run\(\)/.test(seg))
  check('执行：不改节点类型（没有 setParagraph / setNode）', !/setParagraph\(|setNode\(/.test(seg))
  check('执行：没有手点 unsetMark 身份型 mark', !/unsetMark\('comment'|unsetMark\('link'/.test(seg))
  check('接线：工具条有清格式按钮且 tooltip 写明边界',
    /btn\('清格式', \(\) => void runCtx\('clearFormat'\)/.test(ui)
      && /带身份的标记保留/.test(ui))
  check('lib：身份型排除名单仍在单一事实源', /PAINT_EXCLUDE = new Set\(\['comment', 'bookmark', 'revIns', 'revDel', 'link'\]\)/.test(lib))
}

console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
