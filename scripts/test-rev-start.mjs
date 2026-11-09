// v0.187 两族「值变」修复断言：修订壳 `w:id` 与编号 `w:startOverride`。
//
// `ins|id`：写手 `revId` 从 1 起，源件 7 被冲成 1。读手在 w:ins/w:del 分支
// 已查问过 w:id（只读记账），本轮由 `docxToDocMeta` 从源包正则提取原值
// （正则读的部件不进保真账），post-pack 按出现序前缀对位改回。
// `startOverride|val`：包对每个重建的 w:num 恒发 1，源件说「从第 3 号起」就丢了。
// `DocxNumbering.starts` 按 w:num 出现序存原值，补丁前缀对位（只存序不存号）。
//
// 跑法：npx vite-node scripts/test-rev-start.mjs

import fs from 'node:fs'
import JSZip from 'jszip'
import { parseHTML } from 'linkedom'
import { getSchema } from '@tiptap/core'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { fixtureParts } from './lib/fixture.mjs'
import { docxToHtmlFidelity } from '../src/lib/docx-fidelity.ts'
import { docxToDocMeta, pageSetupOf, patchNumOverrides, patchRevIds, prosemirrorToDocxBytes } from '../src/lib/docx.ts'
import { docExtensions } from '../src/lib/doc-schema.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const eq = (name, got, want) => check(name, got === want, `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

async function zipBytes(parts) {
  const z = new JSZip()
  for (const [p, c] of parts) z.file(p, c)
  return new Uint8Array(await z.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
}
async function writeParts(parts = fixtureParts()) {
  const bytes = await zipBytes(parts)
  const fid = await docxToHtmlFidelity(bytes)
  const meta = await docxToDocMeta(bytes)
  const merged = {
    ...meta,
    ...(fid.styles?.length ? { styles: fid.styles } : {}),
    ...(fid.numbering ? { numbering: fid.numbering } : {}),
    ...(fid.section ? { page: { ...meta.page, ...pageSetupOf(fid.section) } } : {}),
  }
  const { document } = parseHTML(`<!doctype html><html><body>${fid.html}</body></html>`)
  const pmDoc = PMDOMParser.fromSchema(getSchema(docExtensions())).parse(document.body).toJSON()
  const out = await JSZip.loadAsync(await prosemirrorToDocxBytes(pmDoc, merged))
  return {
    fid, meta,
    doc: await out.file('word/document.xml').async('string'),
    num: await out.file('word/numbering.xml').async('string'),
  }
}

// ---- 1. meta 与读手载荷 -----------------------------------------------------
const base = await writeParts()
{
  eq('写手 meta：revIds 按源包出现序', JSON.stringify(base.meta.revIds), JSON.stringify(['7']))
  eq('读手 numbering.starts 按 w:num 出现序', JSON.stringify(base.fid.numbering?.starts), JSON.stringify([3]))
  check('读手：startOverride 复用已有 attrNum 查问，没新开漏斗',
    /const so = attrNum\(find\(lo, 'w:startOverride'\), 'w:val'\)/.test(read('../src/lib/docx-fidelity.ts')))
}

// ---- 2. 写出包：两族都回到源值 ---------------------------------------------
{
  eq('写手：w:ins/@w:id 回到 7', /<w:ins\b[^>]*\sw:id="([^"]*)"/.exec(base.doc)?.[1], '7')
  eq('写手：每枚 w:ins 只有一枚 w:id',
    ([...base.doc.matchAll(/<w:ins\b[^>]*>/g)].every((m) => (m[0].match(/\sw:id=/g) ?? []).length === 1)), true)
  const starts = [...base.num.matchAll(/<w:startOverride\b[^>]*\sw:val="([^"]*)"/g)].map((m) => m[1])
  eq('写手：首个 w:num 的 startOverride 回到 3', starts[0], '3')
  eq('写手：源里没说过的第二串保持包的 1', starts[1], '1')
}

// ---- 3. 变体：源值换一组也按出现序对位 -------------------------------------
{
  const parts = fixtureParts()
  parts.set('word/document.xml', (parts.get('word/document.xml') ?? '').replaceAll('w:id="7" w:author', 'w:id="21" w:author'))
  parts.set('word/numbering.xml', (parts.get('word/numbering.xml') ?? '').replace('<w:startOverride w:val="3"/>', '<w:startOverride w:val="5"/>'))
  const v = await writeParts(parts)
  eq('变体：源修订 id 改 21，写出跟着变', /<w:ins\b[^>]*\sw:id="([^"]*)"/.exec(v.doc)?.[1], '21')
  eq('变体：源起始号改 5，写出跟着变', /<w:startOverride\b[^>]*\sw:val="([^"]*)"/.exec(v.num)?.[1], '5')
}

// ---- 4. 纯函数边界 ----------------------------------------------------------
async function revPatched(xml, ids) {
  const out = await patchRevIds(await zipBytes(new Map([['word/document.xml', xml]])), ids)
  return (await (await JSZip.loadAsync(out)).file('word/document.xml').async('string'))
}
async function numPatched(xml, starts) {
  const out = await patchNumOverrides(await zipBytes(new Map([['word/numbering.xml', xml]])), starts)
  return (await (await JSZip.loadAsync(out)).file('word/numbering.xml').async('string'))
}
{
  const plain = '<w:document><w:ins w:id="1" w:author="A"/><w:ins w:id="1"/></w:document>'
  eq('纯函数：空 ids 原样返回', await revPatched(plain, []), plain)
  eq('纯函数：按出现序改值', [...(await revPatched(plain, ['7', '9'])).matchAll(/\sw:id="([^"]*)"/g)].map((m) => m[1]).join(','), '7,9')
  eq('纯函数：写出比源多的修订保持包自己的号',
    [...(await revPatched(plain, ['7'])).matchAll(/\sw:id="([^"]*)"/g)].map((m) => m[1]).join(','), '7,1')
  eq('纯函数：空串占位不凭空造令牌',
    [...(await revPatched(plain, ['', '9'])).matchAll(/\sw:id="([^"]*)"/g)].map((m) => m[1]).join(','), '1,9')
  eq('纯函数：ins/del 混排按同一个出现序',
    [...(await revPatched('<w:del w:id="1"/><w:ins w:id="1"/>', ['8', '7'])).matchAll(/\sw:id="([^"]*)"/g)].map((m) => m[1]).join(','), '8,7')
  eq('纯函数：标签没写 w:id 时不追加', await revPatched('<w:ins w:author="A"/>', ['7']), '<w:ins w:author="A"/>')
  const numXml = '<w:numbering><w:num w:numId="1"><w:startOverride w:val="1"/></w:num><w:num w:numId="2"><w:startOverride w:val="1"/></w:num></w:numbering>'
  eq('纯函数：空 starts 原样返回', await numPatched(numXml, []), numXml)
  eq('纯函数：只改第一串（前缀对位）',
    [...(await numPatched(numXml, [3])).matchAll(/\sw:val="([^"]*)"/g)].map((m) => m[1]).join(','), '3,1')
  eq('纯函数：undefined 占位让第二串保持 1',
    [...(await numPatched(numXml, [undefined, 5])).matchAll(/\sw:val="([^"]*)"/g)].map((m) => m[1]).join(','), '1,5')
  eq('纯函数：starts 比写出包长也不越界',
    [...(await numPatched(numXml, [3, 5, 7])).matchAll(/\sw:val="([^"]*)"/g)].map((m) => m[1]).join(','), '3,5')
}

// ---- 5. 源码级接线 ----------------------------------------------------------
{
  const r = read('../src/lib/docx-fidelity.ts')
  const w = read('../src/lib/docx.ts')
  check('写手 meta：docxToDocMeta 正则提取 revIds',
    /const revIds = \[\.\.\.docXml\.matchAll/.test(w) && /out\.revIds = revIds/.test(w))
  check('写手 meta：DocMeta 有 revIds 槽', /revIds\?: string\[\]/.test(w))
  check('读手：Numbering 有 starts 槽', /starts: \(number \| undefined\)\[\]/.test(r))
  check('读手：按 w:num 出现序先占一格（无 id 也不错位）', /out\.starts\.push\(undefined\)/.test(r))
  check('读手：复用同一次 startOverride 查问回填', /out\.starts\[startAt\] = so/.test(r))
  check('写手：主链挂 patchRevIds', /const withRev = await patchRevIds\(withBm, meta\?\.revIds \?\? \[\], sess\)/.test(w))
  // v0.188 在 withRev 之后又插了 withDocPr，按「逐笔接上一笔」判，不钉死链尾
  // v0.190：与 test-bookmark-ids 同一条动态链校验，不钉链尾变量名
  const chainOk = (src) => {
    const defs = [...src.matchAll(/^  const (with[A-Z]\w*) =/gm)].map((m) => ({ name: m[1], at: m.index ?? 0 }))
    const a = defs.findIndex((d) => d.name === 'withBm'), b = defs.findIndex((d) => d.name === 'withNumStart')
    if (a < 0 || b <= a) return false
    const core = defs.slice(a, b + 1)
    return core.every((d, i) => i === 0 || src.slice(d.at, i + 1 < core.length ? core[i + 1].at : d.at + 600).includes(core[i - 1].name))
  }
  check('写手：后续补丁接 withRev 不绕过它（动态链校验）',
    /const withDocPr = await patchDocPr\(withRev,/.test(w) && chainOk(w))
  check('写手：主链挂 patchNumOverrides', /const withNumStart = await patchNumOverrides\(withNum, meta\?\.numbering\?\.starts, sess\)/.test(w))
  check('写手：后续补丁接 withNumStart', /: withNumStart/.test(w))
}

console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
