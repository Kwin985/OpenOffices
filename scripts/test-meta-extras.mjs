// v0.193 断言：部件级字面元信息（按身份补属性 + 根级字面片回填）。
//
// 一次带回 5 对：numbering.xml 的 `num|durableId` / `numPicBullet|numPicBulletId` /
// `numIdMacAtCleanup|val`，styles.xml 的 `style|default`，commentsExtended.xml 的
// `creationId|id`。全是「包不会自己发、读手只读记账、模型没槽」的元信息，
// 走写手侧从源包正则读 + post-pack 贴回（不进保真账、读手零改动）。
//
// 跑法：npx vite-node scripts/test-meta-extras.mjs

import fs from 'node:fs'
import JSZip from 'jszip'
import { parseHTML } from 'linkedom'
import { getSchema } from '@tiptap/core'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { fixtureParts } from './lib/fixture.mjs'
import { docxToHtmlFidelity } from '../src/lib/docx-fidelity.ts'
import {
  docxToDocMeta, identityAttrsOf, pageSetupOf, patchMetaExtras, prosemirrorToDocxBytes, rootExtrasOf,
} from '../src/lib/docx.ts'
import { docExtensions } from '../src/lib/doc-schema.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')
const mkBytes = async (files) => {
  const z = new JSZip()
  for (const [p, c] of Object.entries(files)) z.file(p, c)
  return new Uint8Array(await z.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
}
const partOf = async (b, p) => (await JSZip.loadAsync(b)).file(p)?.async('string') ?? ''

async function main() {
  const z = new JSZip()
  for (const [p, c] of fixtureParts()) z.file(p, c)
  const bytes = new Uint8Array(await z.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
  const fid = await docxToHtmlFidelity(bytes)
  const meta = await docxToDocMeta(bytes)
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
  const out = await prosemirrorToDocxBytes(pmDoc, merged)
  const numXml = await partOf(out, 'word/numbering.xml')
  const styXml = await partOf(out, 'word/styles.xml')
  const extXml = await partOf(out, 'word/commentsExtended.xml')

  // ── ① 端到端：五族确实回到写出包 ─────────────────────────────────
  check('w:num 按 numId 认领 durableId',
    /<w:num w:numId="1"[^>]*w:durableId="3C7B9A2E"/.test(numXml))
  check('写出包多出的 numId=2 没被凭空贴令牌',
    /<w:num w:numId="2"><w:abstractNumId/.test(numXml))
  check('numbering 根级两片按源包出现序贴回',
    numXml.includes('<w:numPicBullet w:numPicBulletId="7"/><w:numIdMacAtCleanup w:val="0"/></w:numbering>'))
  check('styles Normal 补回 w:default',
    /<w:style w:type="paragraph" w:styleId="Normal" w:default="1">/.test(styXml))
  check('commentsExtended 补回 creationId',
    extXml.includes('<w15:creationId w15:id="00000001"/></w15:commentsEx>'))
  check('meta 里带 metaExtras', !!meta.metaExtras?.byId?.length && !!meta.metaExtras?.roots?.length)
  eq('byId 两处（numbering / styles）', meta.metaExtras.byId.map((x) => x.part),
    ['word/numbering.xml', 'word/styles.xml'])
  eq('roots 两处（numbering / commentsExtended）', meta.metaExtras.roots.map((x) => x.part),
    ['word/numbering.xml', 'word/commentsExtended.xml'])

  // ── ② 纯函数边界 ────────────────────────────────────────────────
  eq('identityAttrsOf 只收真的说过的属性', identityAttrsOf(
    '<w:num w:numId="1" w:durableId="A"/><w:num w:numId="2"/>', 'w:num', 'w:numId', ['w:durableId']),
    [{ id: '1', attrs: { 'w:durableId': 'A' } }])
  eq('身份属性读不到就跳过（不退回出现序）', identityAttrsOf(
    '<w:num x-w:numId="9" w:durableId="B"/>', 'w:num', 'w:numId', ['w:durableId']), [])
  eq('前缀相近的标签名不吃', identityAttrsOf(
    '<w:numPicBullet w:numId="4" w:durableId="C"/>', 'w:num', 'w:numId', ['w:durableId']), [])
  eq('同类属性名前缀不误配（x-w:default 不认）', identityAttrsOf(
    '<w:style w:styleId="N" x-w:default="1"/>', 'w:style', 'w:styleId', ['w:default']), [])
  eq('rootExtrasOf 按出现序而非传入 tag 顺序', rootExtrasOf(
    '<w:numPicBullet a="1"/><w:numIdMacAtCleanup b="2"/>',
    ['w:numIdMacAtCleanup', 'w:numPicBullet']),
    ['<w:numPicBullet a="1"/>', '<w:numIdMacAtCleanup b="2"/>'])
  eq('只认自闭合片（有内容的容器不吃开标签）', rootExtrasOf(
    '<w15:creationId w15:id="x"><w:p/></w15:creationId>', ['w15:creationId']), [])
  eq('空 xml 不炸', rootExtrasOf('', ['w:numPicBullet']), [])

  // ── ③ 补丁边界：幂等 / 陈旧 / 守卫 ────────────────────────────────
  const baseFiles = {
    'word/numbering.xml': '<w:numbering><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>',
    'word/commentsExtended.xml': '<w15:commentsEx><w15:commentEx/></w15:commentsEx>',
  }
  const base = await mkBytes(baseFiles)
  check('空 extras 返回同一枚 bytes', (await patchMetaExtras(base, undefined)) === base)
  const EX = {
    byId: [{ part: 'word/numbering.xml', tag: 'w:num', idAttr: 'w:numId', items: [{ id: '1', attrs: { 'w:durableId': 'XYZ' } }] }],
    roots: [{ part: 'word/commentsExtended.xml', close: '</w15:commentsEx>', literals: ['<w15:creationId w15:id="00000009"/>'] }],
  }
  const once = await patchMetaExtras(base, EX)
  check('补丁确实改了两枚部件',
    (await partOf(once, 'word/numbering.xml')).includes('w:durableId="XYZ"') &&
    (await partOf(once, 'word/commentsExtended.xml')).includes('w15:id="00000009"'))
  check('幂等：再跑一次返回同一枚 bytes', (await patchMetaExtras(once, EX)) === once)
  const userWrote = await mkBytes({
    ...baseFiles,
    'word/numbering.xml': '<w:numbering><w:num w:numId="1" w:durableId="USER"><w:abstractNumId w:val="0"/></w:num></w:numbering>',
  })
  check('已有同名属性不覆盖（用户/包写过的是新事实）',
    (await partOf(await patchMetaExtras(userWrote, EX), 'word/numbering.xml')).includes('w:durableId="USER"'))
  const missingId = await mkBytes({
    ...baseFiles,
    'word/numbering.xml': '<w:numbering><w:num w:numId="8"/></w:numbering>',
  })
  check('身份认不出就跳过，不退回落出现序',
    (await partOf(await patchMetaExtras(missingId, EX), 'word/numbering.xml')) ===
    '<w:numbering><w:num w:numId="8"/></w:numbering>')
  const noClose = { roots: [{ part: 'word/commentsExtended.xml', close: '</w:foo>', literals: ['<A/>'] }] }
  check('闭标签找不到就整笔不动', (await patchMetaExtras(base, noClose)) === base)
  const noPart = { roots: [{ part: 'word/nope.xml', close: '</x>', literals: ['<A/>'] }] }
  check('部件不存在就整笔不动', (await patchMetaExtras(base, noPart)) === base)
  const samePart = {
    byId: [{ part: 'word/numbering.xml', tag: 'w:num', idAttr: 'w:numId', items: [{ id: '1', attrs: { 'w:durableId': 'D1' } }] }],
    roots: [{ part: 'word/numbering.xml', close: '</w:numbering>', literals: ['<w:numIdMacAtCleanup w:val="0"/>'] }],
  }
  const both = await partOf(await patchMetaExtras(base, samePart), 'word/numbering.xml')
  check('byId 与 roots 同部件时两处改动都生效（缓存写回同步）',
    both.includes('w:durableId="D1"') && both.includes('<w:numIdMacAtCleanup w:val="0"/>'))
  check('同部件只插一枚，不叠第二遍', both.split('<w:numIdMacAtCleanup').length === 2)

  // ── ④ 源码级接线 ────────────────────────────────────────────────
  const w = read('../src/lib/docx.ts')
  const r = read('../src/lib/docx-fidelity.ts')
  check('DocMeta 有 metaExtras 字段', /metaExtras\?: MetaExtras/.test(w))
  check('主链挂 withMeta 且逐笔接上一笔',
    /const withMeta = await patchMetaExtras\(withLink, meta\?\.metaExtras, sess\)/.test(w) &&
    /patchTcPr\(withMeta,|: withMeta/.test(w))
  check('meta 构造确实读三个部件',
    ["readText('word/numbering.xml')", "readText('word/styles.xml')", "readText('word/commentsExtended.xml')"]
      .every((s) => w.includes(s)))
  check('按身份键对位（不用出现序）', /const kv = id \? items\.get\(id\) : undefined/.test(w))
  check('只补缺不覆盖', /if \(v && !hasAttrNamed\(tag, k\)\) need\[k\] = v/.test(w))
  check('根级片逐片判幂等', /r\.literals\.filter\(\(l\) => l && !xml\.includes\(l\)\)/.test(w))
  check('读手源码没被本轮改动（不新增查问）', !r.includes('metaExtras'))
}

await main()
console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
