// v0.194 断言：rPr 字符特性四枚 lost→kept（外加 cntxtalts 随片搬回）。
//
// 读手 v0.155 起把 w:ligatures / w:numForm / w:numSpacing / w:cntxtalts 只兑现成
// 屏上的 font-variant-* CSS，没进 HTML/PM 载荷；docx 包也没有 IRunOptions 的槽。
// 写手侧从源包留下这几枚元素的字面，按结果文字认领写出包里那一枚 run，
// 按 CT_RPrBase 序贴回它的 <w:rPr>：outline 是标准元素，排在 emboss 之前；
// 另外四枚是 Word 2010+ 扩展，Word 自己放在 rPr 末尾。
//
// 跑法：npx vite-node scripts/test-rpr-features.mjs

import fs from 'node:fs'
import JSZip from 'jszip'
import { parseHTML } from 'linkedom'
import { getSchema } from '@tiptap/core'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { fixtureParts } from './lib/fixture.mjs'
import { docxToHtmlFidelity } from '../src/lib/docx-fidelity.ts'
import {
  docxToDocMeta, pageSetupOf, patchRPrFeatures, prosemirrorToDocxBytes, rPrFeaturesOf,
} from '../src/lib/docx.ts'
import { docExtensions } from '../src/lib/doc-schema.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')
const mkBytes = async (docXml) => {
  const z = new JSZip()
  z.file('word/document.xml', docXml)
  return new Uint8Array(await z.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
}
const partOf = async (b, p) => (await JSZip.loadAsync(b)).file(p)?.async('string') ?? ''

const RUN = (text) => `<w:r><w:rPr><w:em w:val="dot"/><w:ligatures w:val="standardContextual"/>` +
  `<w:numForm w:val="oldStyle"/><w:numSpacing w:val="proportional"/><w:cntxtalts/>` +
  `<w:emboss/><w:imprint/><w:outline/></w:rPr><w:t>${text}</w:t></w:r>`
const OUT_RUN = (text) => `<w:r><w:rPr><w:b w:val="false"/><w:emboss/><w:imprint/>` +
  `<w:em w:val="dot"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`

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
  const docXml = await partOf(out, 'word/document.xml')
  const i = docXml.indexOf('>字形档</w:t>')
  const runStart = Math.max(docXml.lastIndexOf('<w:r>', i), docXml.lastIndexOf('<w:r ', i))
  const run = docXml.slice(runStart, docXml.indexOf('</w:r>', i) + 6)

  // ── ① 端到端：五枚在位且按 schema 序 ──────────────────────────────
  for (const lit of [
    '<w:ligatures w:val="standardContextual"/>', '<w:numForm w:val="oldStyle"/>',
    '<w:numSpacing w:val="proportional"/>', '<w:cntxtalts/>', '<w:outline/>',
  ]) check(`写出 run 含 ${lit}`, run.includes(lit))
  check('outline 是标准元素，排在 emboss 之前',
    run.indexOf('<w:outline/>') < run.indexOf('<w:emboss/>'))
  check('四枚扩展排在 rPr 末尾（em 之后）',
    run.indexOf('<w:ligatures') > run.indexOf('<w:em w:val="dot"/>'))
  check('包自己发的 b/emboss/imprint/em 没被抹掉',
    ['<w:b w:val="false"/>', '<w:emboss/>', '<w:imprint/>', '<w:em w:val="dot"/>'].every((s) => run.includes(s)))
  check('meta 带 rPrFeatures', meta.rPrFeatures?.length === 1)
  eq('源片五枚按源序', meta.rPrFeatures[0].extras, [
    '<w:ligatures w:val="standardContextual"/>', '<w:numForm w:val="oldStyle"/>',
    '<w:numSpacing w:val="proportional"/>', '<w:cntxtalts/>', '<w:outline/>',
  ])

  // ── ② 纯函数边界 ─────────────────────────────────────────────────
  eq('多 run 各取各的', rPrFeaturesOf(RUN('甲') + RUN('乙')).map((x) => x.text), ['甲', '乙'])
  eq('带属性的 run 开标签也认', rPrFeaturesOf(RUN('甲').replace('<w:r>', '<w:r w:rsidR="A1">'))[0].text, '甲')
  eq('没有 rPr 的 run 跳过', rPrFeaturesOf('<w:r><w:t>甲</w:t></w:r>'), [])
  eq('没有 w:t 的 run 跳过', rPrFeaturesOf(RUN('甲').replace(/<w:t>[^<]*<\/w:t>/, '')), [])
  eq('rPr 里没有目标元素就跳过',
    rPrFeaturesOf('<w:r><w:rPr><w:em w:val="dot"/></w:rPr><w:t>甲</w:t></w:r>'), [])
  eq('不在名单里的元素不收（别把整块 rPr 搬走）',
    rPrFeaturesOf('<w:r><w:rPr><w:shadow/><w:em w:val="dot"/></w:rPr><w:t>甲</w:t></w:r>'), [])
  eq('空 xml 不炸', rPrFeaturesOf(''), [])

  // ── ③ 补丁边界：幂等 / 陈旧 / 守卫 ────────────────────────────────
  const items = rPrFeaturesOf(RUN('甲'))
  const base = await mkBytes(`<w:document>${OUT_RUN('甲')}${OUT_RUN('乙')}</w:document>`)
  const once = await patchRPrFeatures(base, items)
  const onceXml = await partOf(once, 'word/document.xml')
  check('补丁只改认领到的那一枚 run',
    (onceXml.match(/<w:ligatures/g) ?? []).length === 1 && onceXml.includes('>甲</w:t>'))
  check('幂等：再跑一次返回同一枚 bytes', (await patchRPrFeatures(once, items)) === once)
  const userWrote = await mkBytes(`<w:document>${OUT_RUN('甲').replace('<w:emboss/>', '<w:ligatures w:val="USER"/><w:emboss/>')}</w:document>`)
  const kept = await partOf(await patchRPrFeatures(userWrote, items), 'word/document.xml')
  check('已有同名元素不覆盖（按元素名判，不是按整串字面）',
    kept.includes('<w:ligatures w:val="USER"/>') && !kept.includes('standardContextual'))
  const changedText = await mkBytes(`<w:document>${OUT_RUN('改过的字')}</w:document>`)
  check('结果文字被改过就认不出，宁可不贴',
    (await patchRPrFeatures(changedText, items)) === changedText)
  const noRPr = await mkBytes('<w:document><w:r><w:t>甲</w:t></w:r></w:document>')
  check('写出 run 没有 rPr 就不硬造一个',
    (await patchRPrFeatures(noRPr, items)) === noRPr)
  check('空 items 返回同一枚 bytes', (await patchRPrFeatures(base, undefined)) === base)
  const two = await mkBytes(`<w:document>${OUT_RUN('甲')}${OUT_RUN('乙')}</w:document>`)
  const both = await partOf(await patchRPrFeatures(two, [
    { text: '甲', extras: items[0].extras }, { text: '乙', extras: items[0].extras },
  ]), 'word/document.xml')
  check('两枚 run 各自贴一片，cursor 单调前进',
    (both.match(/<w:ligatures/g) ?? []).length === 2)
  const outOfOrder = await partOf(await patchRPrFeatures(two, [
    { text: '乙', extras: items[0].extras }, { text: '甲', extras: items[0].extras },
  ]), 'word/document.xml')
  check('乱序片也不会回头贴到前一段（区间守卫）',
    (outOfOrder.match(/<w:ligatures/g) ?? []).length === 1)

  // ── ④ 源码级接线 ────────────────────────────────────────────────
  const w = read('../src/lib/docx.ts')
  const r = read('../src/lib/docx-fidelity.ts')
  check('DocMeta 有 rPrFeatures 字段', /rPrFeatures\?: RPrFeature\[\]/.test(w))
  // 链尾变量名每加一支补丁就红，改「每笔输入 = 上一笔输出」的动态校验（v0.190 同款）
  const chainOk = (src) => {
    const defs = [...src.matchAll(/^  const (with[A-Z]\w*) =/gm)].map((m) => ({ name: m[1], at: m.index ?? 0 }))
    const a = defs.findIndex((d) => d.name === 'withFeat'), b = defs.findIndex((d) => d.name === 'withNumStart')
    if (a < 0 || b <= a) return false
    const core = defs.slice(a, b + 1)
    return core.every((d, i) => i === 0 || src.slice(d.at, i + 1 < core.length ? core[i + 1].at : d.at + 600).includes(core[i - 1].name))
  }
  check('主链挂 withFeat，且后续补丁逐笔接上一笔（动态校验）',
    /const withFeat = await patchRPrFeatures\(withMeta, meta\?\.rPrFeatures, sess\)/.test(w) && chainOk(w))
  check('meta 构造从 document.xml 正则提取',
    /const rPrFeatures = rPrFeaturesOf\(docXml\)/.test(w) && /out\.rPrFeatures = rPrFeatures/.test(w))
  check('按结果文字认领、不用出现序', /xml\.indexOf\(`>\$\{it\.text\}<\/w:t>`, cursor\)/.test(w))
  check('幂等按元素名判', /body\.includes\(`<w:\$\{tag\}`\)/.test(w))
  check('outline 走 CT_RPr 锚点表',
    /\['<w:emboss', '<w:imprint', '<w:shadow', '<w:noProof'\]/.test(w))
  check('扩展元素插在 rPr 末尾', /next \+= ext\.join\(''\)/.test(w))
  check('读手源码零改动（四枚仍只是屏上 CSS）',
    r.includes('font-variant-ligatures') && !r.includes('rPrFeatures'))
}

await main()
console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
