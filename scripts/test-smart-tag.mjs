// v0.190 断言：`w:smartTag` 两族 lost→kept + 整片字面通道的泛化。
//
// 泛化点（教训⑪）：v0.189 为表单域写的「按结果文字认领、前后贴回字面原件」
// 在第二处同形状需求（智能标记）出现时才抽成共用通道 `literalWrappersOf` /
// `patchLiteralWrappers`；`marker` 让每片各判各的幂等，顺带修掉 v0.189
// 「包发过任何 fldChar 就整笔不贴」的跨类误伤。
//
// 跑法：npx vite-node scripts/test-smart-tag.mjs

import fs from 'node:fs'
import JSZip from 'jszip'
import { parseHTML } from 'linkedom'
import { getSchema } from '@tiptap/core'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { fixtureParts } from './lib/fixture.mjs'
import { docxToHtmlFidelity } from '../src/lib/docx-fidelity.ts'
import {
  docxToDocMeta, literalWrappersOf, pageSetupOf, patchLiteralWrappers, prosemirrorToDocxBytes,
} from '../src/lib/docx.ts'
import { docExtensions } from '../src/lib/doc-schema.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

async function zipBytes(map) {
  const z = new JSZip()
  for (const [p, c] of map) z.file(p, c)
  return new Uint8Array(await z.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
}
const ST = (text, attrs = 'w:element="address" w:uri="urn:schemas-microsoft-com:office:smarttags"') =>
  `<w:p><w:smartTag ${attrs}><w:r><w:t>${text}</w:t></w:r></w:smartTag></w:p>`

async function main() {
  const parts = fixtureParts()
  const bytes = await zipBytes(parts)
  const srcDoc = parts.get('word/document.xml') ?? ''

  // ── ① 纯函数：两类壳共用一条通道 ──────────────────────────────────
  const all = literalWrappersOf(srcDoc)
  eq('夹具里两类壳各一片', all.length, 2)
  eq('按源包出现序：智能标记在前、表单域在后', all.map((f) => f.marker), ['<w:smartTag', '<w:ffData>'])
  const st = all[0]
  eq('smartTag 的结果文字', st.text, '智能标记里的字')
  eq('smartTag 的 before 是开标签（含两枚属性）',
    st.before, '<w:smartTag w:element="address" w:uri="urn:schemas-microsoft-com:office:smarttags">')
  eq('smartTag 的 after 是闭标签', st.after, '</w:smartTag>')
  eq('smartTag 的 marker 是开标签名', st.marker, '<w:smartTag')
  check('表单域那片仍带五枚 run', all[1].before.includes('<w:ffData>') && all[1].before.includes('<w:instrText'))

  const two = literalWrappersOf(`${ST('甲')}${ST('乙')}`)
  eq('两个 smartTag 按出现序', two.map((f) => f.text), ['甲', '乙'])
  eq('缺闭标签跳过', literalWrappersOf('<w:p><w:smartTag w:element="address"><w:r><w:t>甲</w:t></w:r></w:p>').length, 0)
  eq('空结果文字跳过', literalWrappersOf(ST('')).length, 0)
  eq('没有壳的段落不产片', literalWrappersOf('<w:p><w:r><w:t>普通段落</w:t></w:r></w:p>').length, 0)
  eq('空串输入不炸', literalWrappersOf('').length, 0)
  check('同段落内不吞壳外的 run', !two[0].before.includes('<w:t>') && !two[0].after.includes('<w:t>'))
  const mixed = literalWrappersOf(`${ST('甲')}<w:p><w:r><w:t>普通</w:t></w:r></w:p>${ST('乙')}`)
  eq('壳与普通段落混排仍按出现序', mixed.map((f) => f.text), ['甲', '乙'])

  // ── ② 端到端：写出包里两枚属性都回来 ─────────────────────────────
  const fid = await docxToHtmlFidelity(bytes)
  const meta = await docxToDocMeta(bytes)
  eq('meta 带两片壳', meta.literalWrappers?.length, 2)
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
  const outDoc = await out.file('word/document.xml').async('string')
  check('写出包有 smartTag 开标签', outDoc.includes('<w:smartTag'))
  check('两枚属性 element / uri 原值都回来',
    outDoc.includes('w:element="address"') && outDoc.includes('w:uri="urn:schemas-microsoft-com:office:smarttags"'))
  check('壳正好一层（不叠）', (outDoc.match(/<w:smartTag\b/g) ?? []).length === 1)
  const para = (s) => {
    const i = s.indexOf('智能标记里的字')
    return s.slice(s.lastIndexOf('<w:p>', i), s.indexOf('</w:p>', i) + 6)
  }
  const norm = (s) => s.replace(/<w:rPr>[\s\S]*?<\/w:rPr>/g, '').replace(/ xml:space="preserve"/g, '')
  check('写出段落与源件剥掉包发属性后逐字相同', norm(para(srcDoc)) === norm(para(outDoc)))
  check('结果文字确实在壳内', para(outDoc).indexOf('<w:smartTag') < para(outDoc).indexOf('智能标记里的字')
    && para(outDoc).indexOf('智能标记里的字') < para(outDoc).indexOf('</w:smartTag>'))
  check('表单域壳没被泛化弄丢（同包共存）', outDoc.includes('<w:ffData>') && outDoc.includes('fldCharType="end"'))

  // ── ③ 逐片幂等：跨类不误伤 ───────────────────────────────────────
  const mixedXml = `<w:document>${ST('智能标记里的字')}<w:p><w:r><w:t>表单里的字</w:t></w:r></w:p></w:document>`
  const mixedBytes = await zipBytes(new Map([['word/document.xml', mixedXml]]))
  const patched = await patchLiteralWrappers(mixedBytes, all)
  const patchedXml = await (await JSZip.loadAsync(patched)).file('word/document.xml').async('string')
  eq('已有 smartTag 就只跳过那一片', (patchedXml.match(/<w:smartTag\b/g) ?? []).length, 1)
  check('表单域那片照贴（v0.189 全局闸门会整笔跳过）', patchedXml.includes('<w:ffData>'))
  const bothXml = `<w:document>${ST('智能标记里的字')}<w:r><w:fldChar w:fldCharType="begin"><w:ffData/></w:fldChar></w:r></w:document>`
  const bothBytes = await zipBytes(new Map([['word/document.xml', bothXml]]))
  eq('两类 marker 都在时整笔不动', await patchLiteralWrappers(bothBytes, all), bothBytes)
  const plain = await zipBytes(new Map([['word/document.xml', '<w:document><w:p><w:r><w:t>甲</w:t></w:r></w:p></w:document>']]))
  const hit = await (await JSZip.loadAsync(await patchLiteralWrappers(plain, [{ ...st, text: '甲' }]))).file('word/document.xml').async('string')
  check('认得出时前后贴回开闭标签', hit.includes('<w:smartTag') && hit.includes('</w:smartTag>') && hit.indexOf('<w:smartTag') < hit.indexOf('甲'))
  eq('认不出（结果文字被改）就不贴', await patchLiteralWrappers(plain, [{ ...st, text: '改过的字' }]), plain)

  // ── ④ 源码级：泛化口径与零新增查问 ───────────────────────────────
  const w = read('../src/lib/docx.ts')
  const r = read('../src/lib/docx-fidelity.ts')
  check('两类壳在同一个提取函数里', /export function literalWrappersOf/.test(w)
    && /<w:smartTag\\b\[\^>\]\*>/.test(w) && /<w:ffData>/.test(w))
  check('smartTag 的 marker 是开标签名', /marker: '<w:smartTag'/.test(w))
  check('表单域的 marker 收窄为 ffData', /marker: '<w:ffData>'/.test(w))
  check('读手仍是只读记账、下钻照旧（没改读手）',
    /case 'smartTag'/.test(r) && /attrL\(node, 'element'\)/.test(r) && /attrL\(node, 'uri'\)/.test(r)
      && /await this\.children\(node, props, st\)/.test(r))
  check('读手源码没有新增 attr 漏斗之外的查问', !/smartTag[\s\S]{0,200}attr\(node/.test(r))
}

await main()
console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
