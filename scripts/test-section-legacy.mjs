// v0.183 节余量 + numbering legacy 往返断言。
//
// 两族都是「只读记账 → 带值载荷」的升级，且都不新建 post-pack 机制：
//   type|val / pgSz|code —— 包本来就有 sections[].properties.type 与 page.size.code
//                           两个原生槽，原值直传；post-pack 一行不用动。
//   legacy 三枚        —— patchNumberingXml.insertKid 的锚点表里本来就写着
//                           'legacy'/'lvlJc'，只差把三枚原值带过 numbering.xml。
//
// 走完整链路：夹具 docx → 读手 → PageSetup/meta → 写手 → 解包对撞。
// 跑法：npx vite-node scripts/test-section-legacy.mjs

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

// ---- 1. 源件 → 读手 → 模型 ------------------------------------------------
{
  eq('读手：sectionType 原值 continuous', fid.section?.sectionType, 'continuous')
  eq('读手：paperCode 原值 9（字符串，不换算）', fid.section?.paperCode, '9')
  const page = pageSetupOf(fid.section ?? {})
  eq('pageSetupOf 透传 sectionType', page.sectionType, 'continuous')
  eq('pageSetupOf 透传 paperCode', page.paperCode, '9')
  const r = resolvePage(page)
  eq('resolvePage 透传 sectionType（写手拿得到）', r.sectionType, 'continuous')
  eq('resolvePage 透传 paperCode', r.paperCode, '9')

  const lv0 = fid.numbering?.defs?.[0]?.levels?.['0']
  eq('读手：legacy 三枚成载荷', JSON.stringify(lv0?.legacy), '{"legacy":"1","space":"0","indent":"0"}')
  check('读手：另一层没有凭空造 legacy', !fid.numbering?.defs?.[0]?.levels?.['1']?.legacy)
}

// ---- 2. 完整链路 → 写出包 --------------------------------------------------
async function outZip(meta) {
  const schema = getSchema(docExtensions())
  const { document } = parseHTML(`<!doctype html><html><body>${fid.html}</body></html>`)
  const pm = PMDOMParser.fromSchema(schema).parse(document.body).toJSON()
  const base = await docxToDocMeta(srcBytes)
  const merged = {
    ...base,
    ...meta,
    ...(fid.numbering ? { numbering: fid.numbering } : {}),
    ...(fid.styles?.length ? { styles: fid.styles } : {}),
    ...(fid.section ? { page: { ...base.page, ...pageSetupOf(fid.section) } } : {}),
  }
  const out = await prosemirrorToDocxBytes(pm, merged)
  return JSZip.loadAsync(out)
}

const zip = await outZip({})
const docXml = await zip.file('word/document.xml').async('string')
const numXml = await zip.file('word/numbering.xml').async('string')

{
  eq('写手：w:type 原值', /<w:type w:val="([^"]*)"\/>/.exec(docXml)?.[1], 'continuous')
  eq('写手：w:pgSz/@w:code 原值', /<w:pgSz\b[^>]*\sw:code="([^"]*)"/.exec(docXml)?.[1], '9')
  const lg = /<w:legacy\b([^>]*)\/>/.exec(numXml)?.[1] ?? ''
  eq('写手：w:legacy/@w:legacy 原值', /\sw:legacy="([^"]*)"/.exec(lg)?.[1], '1')
  eq('写手：w:legacySpace 原值（不归一）', /\sw:legacySpace="([^"]*)"/.exec(lg)?.[1], '0')
  eq('写手：w:legacyIndent 原值（不归一）', /\sw:legacyIndent="([^"]*)"/.exec(lg)?.[1], '0')
  eq('写手：w:legacy 只出现在带载荷那一层', (numXml.match(/<w:legacy\b/g) ?? []).length, 1)

  // schema 序：CT_SectPr 的 type 在 pgSz 之前；CT_Lvl 的 legacy 在 lvlJc 之前
  const sect = /<w:sectPr\b[^>]*>([\s\S]*?)<\/w:sectPr>/.exec(docXml)?.[1] ?? ''
  check('schema 序：w:type 排在 w:pgSz 之前',
    sect.indexOf('<w:type') >= 0 && sect.indexOf('<w:pgSz') > sect.indexOf('<w:type'))
  // 按块对位：包会发多枚 ilvl=0 的内置层，「全文第一枚」不是带载荷的那一块
  const lvlBlocks = [...numXml.matchAll(/<w:lvl\b[^>]*>[\s\S]*?<\/w:lvl>/g)].map((m) => m[0])
  const withLegacy = lvlBlocks.filter((x) => x.includes('<w:legacy'))
  eq('schema 序：legacy 只落在带载荷的那一块', withLegacy.length, 1)
  const lvl0 = withLegacy[0] ?? ''
  check('schema 序：w:legacy 排在 w:lvlJc 之前',
    lvl0.indexOf('<w:legacy') >= 0 && lvl0.indexOf('<w:lvlJc') > lvl0.indexOf('<w:legacy'))
  check('schema 序：w:legacy 排在 w:lvlPicBulletId 之后',
    lvl0.indexOf('<w:legacy') > lvl0.indexOf('<w:lvlPicBulletId'))
}

// ---- 3. 白名单与「不凭空造」 ----------------------------------------------
{
  // 自造的节起法不该发给 Word（宁可少一枚，不赌坏件）
  const reader = read('../src/lib/docx-fidelity.ts')
  const writer = read('../src/lib/docx.ts')
  check('写手：节起法走 SectionType 白名单',
    /Object\.values\(SectionType\)/.test(writer) && /SectionType,/.test(writer))
  check('写手：type / code 交给原生槽，不手搓 XML 字面',
    !/`<w:type\b/.test(writer) && !/`<w:pgSz\b/.test(writer))
  check('写手：paperCode 非数值不写', /Number\.isFinite\(Number\(pg\.paperCode\)\)/.test(writer))
  // 变异腿敏感：两族都只能用 attr 单漏斗，不能换 attrNum（attr ?? attrL 两条路）
  const seg = reader.slice(reader.indexOf('  const ty = find(sect'), reader.indexOf('  const pgn ='))
  check('读手：节余量仍走 attr 单漏斗', /attr\(ty, 'w:val'\)/.test(seg) && !/attrNum/.test(seg))
  const lseg = reader.slice(reader.indexOf('  const lg = find(l,'), reader.indexOf('  const lg = find(l,') + 700)
  check('读手：legacy 三枚仍走 attr 单漏斗',
    (lseg.match(/attr\(lg, 'w:legacy/g) ?? []).length === 3 && !/attrNum/.test(lseg))
  check('写手：legacy 走既有 insertKid 锚点表',
    /insertKid\(frag, \['lvlJc', 'pPr', 'rPr'\]\)/.test(writer))
}

// ---- 4. 没有这些属性的件不凭空多出来 ---------------------------------------
{
  const parts = fixtureParts()
  const doc = parts.get('word/document.xml') ?? ''
  parts.set('word/document.xml', doc
    .replace(/<w:type w:val="continuous"\/>/, '')
    .replace(/ w:code="9"/, ''))
  const num = parts.get('word/numbering.xml') ?? ''
  parts.set('word/numbering.xml', num.replace(/<w:legacy\b[^>]*\/>/, ''))
  const z2 = new JSZip()
  for (const [p, c] of parts) z2.file(p, c)
  const b2 = new Uint8Array(await z2.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
  const f2 = await docxToHtmlFidelity(b2)
  eq('无源值时读手不带 sectionType', f2.section?.sectionType, undefined)
  eq('无源值时读手不带 paperCode', f2.section?.paperCode, undefined)
  check('无源值时读手不带 legacy 载荷', !f2.numbering?.defs?.[0]?.levels?.['0']?.legacy)
  const schema = getSchema(docExtensions())
  const { document } = parseHTML(`<!doctype html><html><body>${f2.html}</body></html>`)
  const pm = PMDOMParser.fromSchema(schema).parse(document.body).toJSON()
  const base = await docxToDocMeta(b2)
  const merged = {
    ...base, ...(f2.numbering ? { numbering: f2.numbering } : {}),
    ...(f2.section ? { page: { ...base.page, ...pageSetupOf(f2.section) } } : {}),
  }
  const out2 = await JSZip.loadAsync(await prosemirrorToDocxBytes(pm, merged))
  const d2 = await out2.file('word/document.xml').async('string')
  const n2 = await out2.file('word/numbering.xml').async('string')
  check('无源值时写出包不发 <w:type', !/<w:type\b/.test(d2))
  check('无源值时写出包不发 w:code', !/w:code=/.test(d2))
  check('无源值时写出包不发 w:legacy', !/<w:legacy\b/.test(n2))
}

console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
