// v0.190 断言：页面边框读写链（docx 包原生槽）。
//
// 修的是「导入一份带页面边框的 docx，另存一次边框就没了」的坏件：读侧走
// `docxToDocMeta` 从源包正则读（不进保真账、读手零改动），写侧走包
// `sections[].properties.borders` 原生槽（不手拼 XML）。屏上/打印预览不画。
//
// 跑法：npx vite-node scripts/test-page-borders.mjs

import fs from 'node:fs'
import JSZip from 'jszip'
import { parseHTML } from 'linkedom'
import { getSchema } from '@tiptap/core'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { fixtureParts } from './lib/fixture.mjs'
import { docxToHtmlFidelity } from '../src/lib/docx-fidelity.ts'
import {
  DEFAULT_PAGE_BORDERS, PAGE_BORDER_STYLES, docxToDocMeta, pageBordersOf, pageSetupOf,
  prosemirrorToDocxBytes, resolvePage,
} from '../src/lib/docx.ts'
import { docExtensions } from '../src/lib/doc-schema.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

const PGB = (attrs = 'w:val="dashed" w:sz="12" w:space="2" w:color="AABBCC"') =>
  `<w:pgBorders w:offsetFrom="page"><w:top ${attrs}/><w:left ${attrs}/>` +
  `<w:bottom ${attrs}/><w:right ${attrs}/></w:pgBorders>`

async function zipBytes(parts) {
  const z = new JSZip()
  for (const [p, c] of parts) z.file(p, c)
  return new Uint8Array(await z.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
}
async function writeDoc(metaPatch, parts = fixtureParts()) {
  const bytes = await zipBytes(parts)
  const fid = await docxToHtmlFidelity(bytes)
  const meta = { ...(await docxToDocMeta(bytes)), ...metaPatch }
  const merged = {
    ...meta,
    ...(fid.styles?.length ? { styles: fid.styles } : {}),
    ...(fid.latentStyles ? { latentStyles: fid.latentStyles } : {}),
    ...(fid.numbering ? { numbering: fid.numbering } : {}),
    ...(fid.section ? { page: { ...meta.page, ...pageSetupOf(fid.section) } } : {}),
    ...(fid.background ? { background: fid.background } : {}),
    ...(fid.comments.length ? { comments: fid.comments } : {}),
  }
  const { document } = parseHTML(`<!doctype html><html><body>${fid.html}</body></html>`)
  const pmDoc = PMDOMParser.fromSchema(getSchema(docExtensions())).parse(document.body).toJSON()
  const out = await JSZip.loadAsync(await prosemirrorToDocxBytes(pmDoc, merged))
  return { meta, doc: await out.file('word/document.xml').async('string') }
}

async function main() {
  // ── ① 纯函数：读侧解析与守卫 ──────────────────────────────────────
  eq('没有 pgBorders 时不发', pageBordersOf('<w:document><w:sectPr/></w:document>'), undefined)
  eq('标准四边统一值', pageBordersOf(PGB()), { style: 'dashed', color: 'AABBCC', size: 12, space: 2 })
  eq('只认四档（thick 认不出就宁缺毋滥）',
    pageBordersOf(PGB('w:val="thick" w:sz="12" w:color="112233"')), undefined)
  eq('属性顺序不固定照样读',
    pageBordersOf(PGB('w:color="ff00aa" w:space="0" w:sz="6" w:val="double"')),
    { style: 'double', color: 'FF00AA', size: 6, space: 0 })
  eq('脏色回落默认', pageBordersOf(PGB('w:val="single" w:sz="4" w:color="red"')).color, DEFAULT_PAGE_BORDERS.color)
  eq('脏线宽回落默认', pageBordersOf(PGB('w:val="single" w:sz="999" w:color="112233"')).size, DEFAULT_PAGE_BORDERS.size)
  eq('缺 space 就不写 space', pageBordersOf(PGB('w:val="single" w:sz="4" w:color="112233"')).space, undefined)
  eq('空串输入不炸', pageBordersOf(''), undefined)
  eq('只有开标签没有边元素', pageBordersOf('<w:pgBorders w:offsetFrom="page"></w:pgBorders>'), undefined)
  eq('UI 档位表就是读侧白名单', PAGE_BORDER_STYLES, ['single', 'dotted', 'dashed', 'double'])

  // ── ② resolvePage 透传 ───────────────────────────────────────────
  eq('resolvePage 带上 pageBorders', resolvePage({ pageBorders: DEFAULT_PAGE_BORDERS }).pageBorders, DEFAULT_PAGE_BORDERS)
  eq('没设就是 undefined', resolvePage({}).pageBorders, undefined)

  // ── ③ 端到端：默认路径零影响 ─────────────────────────────────────
  const plain = await writeDoc({})
  eq('meta 没带页面边框', plain.meta.page?.pageBorders, undefined)
  check('默认写出包根本没有 pgBorders（账本不受扰）', !plain.doc.includes('<w:pgBorders'))

  // ── ④ 端到端：源件带边框 → 导入另存保住 ───────────────────────────
  const withBorders = new Map(fixtureParts())
  const srcDoc = withBorders.get('word/document.xml')
  check('夹具确实有 sectPr 可插', srcDoc.includes('</w:sectPr>'))
  withBorders.set('word/document.xml', srcDoc.replace('</w:sectPr>', `${PGB()}</w:sectPr>`))
  const imported = await writeDoc({}, withBorders)
  eq('docxToDocMeta 读出页面边框', imported.meta.page?.pageBorders,
    { style: 'dashed', color: 'AABBCC', size: 12, space: 2 })
  check('写出包有 pgBorders', imported.doc.includes('<w:pgBorders'))
  check('四边都由包发出', ['top', 'left', 'bottom', 'right'].every((e) => imported.doc.includes(`<w:${e}`)))
  check('线型/颜色/线宽回到原值',
    imported.doc.includes('w:val="dashed"') && /w:color="AABBCC"/i.test(imported.doc) && imported.doc.includes('w:sz="12"'))
  check('写出包只有一组 pgBorders', (imported.doc.match(/<w:pgBorders\b/g) ?? []).length === 1)

  // ── ⑤ 端到端：用户在面板改值 ─────────────────────────────────────
  const edited = await writeDoc({ page: { size: 'A4', pageBorders: { style: 'double', color: 'FF0000', size: 24, space: 4 } } })
  check('用户设的双线写回', edited.doc.includes('w:val="double"'))
  check('用户设的颜色写回', /w:color="FF0000"/i.test(edited.doc))
  check('用户设的线宽写回', edited.doc.includes('w:sz="24"'))
  const removed = await writeDoc({ page: { size: 'A4', pageBorders: undefined } })
  check('面板关掉后写出包没有 pgBorders', !removed.doc.includes('<w:pgBorders'))

  // ── ⑥ 源码级：原生槽、零新增查问、UI 接线 ─────────────────────────
  const w = read('../src/lib/docx.ts')
  const r = read('../src/lib/docx-fidelity.ts')
  const ui = read('../src/components/DocEditor.tsx')
  const css = read('../src/index.css')
  check('读侧是独立纯函数且走 docxToDocMeta', /export function pageBordersOf\(docXml: string\)/.test(w)
    && /const pageBorders = pageBordersOf\(docXml\)/.test(w) && /page\.pageBorders = pageBorders/.test(w))
  check('读侧不用动态正则（按属性名字符串定位）', w.includes('const needle = `w:${k}="`'))
  check('读手 sectionOf 没被本轮改动', !/pgBorders/.test(r))
  check('写侧走包 borders 原生槽，不手拼 pgBorders XML',
    /borders: \{\s*pageBorderTop: pageBorderOption/.test(w) && !/setPart\([^\n]*pgBorders/.test(w))
  check('键名用 pageBorderTop 一族（不是 OOXML 的 top）', /pageBorderRight: pageBorderOption/.test(w)
    && /borders\?: IPageBordersOptions/.test(w))
  check('PageSetup 有 pageBorders 字段', /pageBorders\?: PageBorders/.test(w))
  check('面板有开关与四档选择', /checked=\{!!pg\.pageBorders\}/.test(ui) && /PAGE_BORDER_STYLES\.map/.test(ui))
  check('面板可改颜色与线宽', /type="color"/.test(ui) && /pageBorders: \{ \.\.\.pg\.pageBorders!, size:/.test(ui))
  check('CSS 有边框小节', /\.doc-pg-borders/.test(css))
  check('诚实边界写明屏上不画', /屏上纸面与打印预览都不画/.test(ui))
}

await main()
console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
