// v0.182 不等宽分栏往返断言。
//
// 包有 `createColumns({equalWidth:false, children: Column[]})` 原生槽，所以
// post-pack 只需把 `w:equalWidth="false"` 回填成 OOXML 的 onOff 字面 `"0"`
// （与 v0.179 的 FLAT/flat 同款：只让包发壳、字面按源件回填）。
// 逐栏宽是缇原值，屏上 CSS columns 只能等宽——**只往返、不屏现**。
//
// 走完整链路：夹具 docx → 读手 section → PageSetup → 写手 → 解包对撞。
// 跑法：npx vite-node scripts/test-columns.mjs

import fs from 'node:fs'
import JSZip from 'jszip'
import { parseHTML } from 'linkedom'
import { getSchema } from '@tiptap/core'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { fixtureParts } from './lib/fixture.mjs'
import { docxToHtmlFidelity } from '../src/lib/docx-fidelity.ts'
import { docxToDocMeta, pageSetupOf, prosemirrorToDocxBytes, resolvePage } from '../src/lib/docx.ts'
import { docExtensions } from '../src/lib/doc-schema.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const eq = (name, got, want) => check(name, got === want, `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

const srcZip = new JSZip()
for (const [p, c] of fixtureParts()) srcZip.file(p, c)
const srcBytes = new Uint8Array(await srcZip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
const fid = await docxToHtmlFidelity(srcBytes)

// ---- 1. 源件 → 读手 → PageSetup ------------------------------------------
const page = pageSetupOf(fid.section ?? {})
{
  check('读手：section 带出 colsLayout', !!page.colsLayout)
  eq('读手：equalWidth 原值 0 → false', page.colsLayout?.equalWidth, false)
  eq('读手：逐栏宽两枚（缇）', JSON.stringify(page.colsLayout?.widths?.map((c) => c.w)), '[2000,3000]')
  eq('读手：逐栏 space 两枚', JSON.stringify(page.colsLayout?.widths?.map((c) => c.space)), '[400,400]')
  eq('读手：栏数 2', page.cols, 2)
  const r = resolvePage(page)
  eq('resolvePage 透传 colsLayout（写手拿得到）', r.colsLayout?.widths?.length, 2)
  eq('resolvePage 不换算缇', r.colsLayout?.widths?.[0].w, 2000)
}

// ---- 2. 写手 → 写出包 ----------------------------------------------------
const meta = await docxToDocMeta(srcBytes)
const merged = { ...meta, page: { ...meta.page, ...page } }
const schema = getSchema(docExtensions())
const { document } = parseHTML(`<!doctype html><html><body>${fid.html}</body></html>`)
const pm = PMDOMParser.fromSchema(schema).parse(document.body).toJSON()
const outBytes = await prosemirrorToDocxBytes(pm, merged)
const outXml = await (await JSZip.loadAsync(outBytes)).file('word/document.xml').async('string')

{
  const cols = /<w:cols\b[^>]*>[\s\S]*?<\/w:cols>|<w:cols\b[^>]*\/>/.exec(outXml)?.[0] ?? ''
  check('写手：发出 w:cols', !!cols)
  eq('写手：equalWidth 回填成 onOff 字面 0', /\bw:equalWidth="([^"]*)"/.exec(cols)?.[1], '0')
  eq('写手：栏数 2', /\bw:num="([^"]*)"/.exec(cols)?.[1], '2')
  eq('写手：栏距 720 缇', /\bw:space="([^"]*)"/.exec(cols)?.[1], '720')
  const colTags = [...cols.matchAll(/<w:col\b[^>]*\/>/g)].map((m) => m[0])
  eq('写手：两枚 w:col', colTags.length, 2)
  eq('写手：第一枚逐栏宽', /\bw:w="([^"]*)"/.exec(colTags[0] ?? '')?.[1], '2000')
  eq('写手：第二枚逐栏宽', /\bw:w="([^"]*)"/.exec(colTags[1] ?? '')?.[1], '3000')
  eq('写手：逐栏 space', /\bw:space="([^"]*)"/.exec(colTags[0] ?? '')?.[1], '400')
  check('写手：不等宽分支没有 w:sep（避免非法的 "false"）', !/\bw:sep=/.test(cols))
}

// ---- 3. 纪律（源码级）----------------------------------------------------
{
  const writer = read('../src/lib/docx.ts')
  const reader = read('../src/lib/docx-fidelity.ts')
  const ui = read('../src/components/DocEditor.tsx')
  // `<w:color` 是 `<w:col` 的前缀，反向判据要收边，否则假红
  check('写手：用 Column 原生槽（不手搓 w:col 字符串）',
    /new Column\(\{ width: c\.w/.test(writer) && !/<w:col[\s/>]/.test(writer))
  check('写手：equalWidth:false 才挂 children', /equalWidth: false,\s*children:/.test(writer))
  check('写手：onOff 字面由 post-pack 回填', /patchColsOnOff/.test(writer) && /\$\{a\}0\$\{b\}/.test(writer))
  check('写手：补丁挂在主链并复用 PackSession', /const withCols = await patchColsOnOff\(out, sess\)/.test(writer))
  check('读手：逐栏表走 attr 单漏斗（不用 attrNum 双漏斗）',
    /Number\(attr\(c, 'w:w'\)\)/.test(reader) && !/attrNum\(c, 'w:w'\)/.test(reader))
  check('模型：PageSetup / DocxSection 各带 colsLayout',
    (writer.match(/colsLayout\?: \{ equalWidth\?: boolean; widths\?: \{ w: number; space\?: number \}\[\] \}/g) ?? []).length >= 2)
  check('pageSetupOf 不换算缇', /if \(s\.colsLayout\) page\.colsLayout = s\.colsLayout/.test(writer))
  check('UI：不等宽开关与逐栏宽输入在位',
    /checked=\{!!eff\.colsLayout\?\.widths\?\.length\}/.test(ui)
      && /栏宽\(缇\)/.test(ui) && /setPg\(\{ colsLayout:/.test(ui))
  check('诚实边界：面板 title 明写屏上等宽、只管往返',
    /屏上 CSS columns 只能等宽[\s\S]{0,80}docx 往返/.test(ui))
}

console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
