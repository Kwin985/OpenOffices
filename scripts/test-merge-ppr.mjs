// v0.195 断言：读手 effPPrOf 的 mergePPr 空链短路（纯去重复计算）。
//
// 段落没有自己的 w:pPr 时，mergePPr([view.pPr, undefined]) 本来就原样返回
// view.pPr；这一趟函数调用 + 数组创建可以省掉。`legacyMergePPr:true` 复刻
// 改前路径供同进程 A/B，两腿导入结果必须逐字相同。与 v0.194 的
// legacyStyleView 是两个独立开关，互不干扰。
//
// 跑法：npx vite-node scripts/test-merge-ppr.mjs

import fs from 'node:fs'
import JSZip from 'jszip'
import { fixtureParts } from './lib/fixture.mjs'
import { docxToHtmlFidelity } from '../src/lib/docx-fidelity.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

const signature = (f) => JSON.stringify({
  html: f.html, styles: f.styles, latentStyles: f.latentStyles,
  comments: f.comments, warnings: [...(f.warnings ?? [])],
})

async function main() {
  const z = new JSZip()
  for (const [p, c] of fixtureParts()) z.file(p, c)
  const bytes = new Uint8Array(await z.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))

  const before = signature(await docxToHtmlFidelity(bytes, 0, undefined, { legacyMergePPr: true }))
  const after = signature(await docxToHtmlFidelity(bytes))
  check('两腿导入结果逐字相同', before === after,
    before === after ? '' : `长度 ${before.length} vs ${after.length}`)
  check('夹具非空（确实走到段落渲染）',
    after.includes('控件里的字') && after.includes('font-variant-ligatures'))

  // 放大语料：无 pPr 的普通段落与带 pStyle 的段落各一批，覆盖短路与不短路两条路
  const srcDoc = fixtureParts().get('word/document.xml')
  const at = srcDoc.lastIndexOf('<w:sectPr')
  const one = '<w:p><w:r><w:t>无格式段</w:t></w:r></w:p>' +
    '<w:p><w:pPr><w:pStyle w:val="Report"/></w:pPr><w:r><w:t>带样式段</w:t></w:r></w:p>'
  for (const n of [20, 200]) {
    const big = srcDoc.slice(0, at) + one.repeat(n) + srcDoc.slice(at)
    const bz = new JSZip()
    for (const [p, c] of fixtureParts()) bz.file(p, p === 'word/document.xml' ? big : c)
    const bigBytes = new Uint8Array(await bz.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
    const a = signature(await docxToHtmlFidelity(bigBytes, 0, undefined, { legacyMergePPr: true }))
    const b = signature(await docxToHtmlFidelity(bigBytes))
    check(`${n} 组放大语料两腿仍逐字相同`, a === b)
    check(`${n} 组语料确实渲染了复制段落`, (b.match(/无格式段/g) ?? []).length >= n)
  }

  // 两个开关互不干扰：同时打开对照腿也应与只开一个的结果一致
  const both = signature(await docxToHtmlFidelity(bytes, 0, undefined, {
    legacyStyleView: true, legacyMergePPr: true,
  }))
  check('legacyStyleView 与 legacyMergePPr 同时打开仍逐字相同', both === before)

  const w = read('../src/lib/docx-fidelity.ts')
  check('短路条件只认「无 pPr」',
    /const effPPr = !this\.legacyMergePPr && !pPr \? view\.pPr : mergePPr\(\[view\.pPr, pPr\]\)/.test(w))
  check('构造有独立开关', /private legacyMergePPr = false/.test(w))
  check('入口 opts 接两个开关',
    /opts\?: \{ legacyStyleView\?: boolean; legacyMergePPr\?: boolean \}/.test(w) &&
    /!!opts\?\.legacyMergePPr\)/.test(w))
  check('不引入缓存（没有 Map）', !/pprCache|effPPrCache/.test(w))
  check('短路与 v0.194 的 view 复用共存', /return \{ pPr, effPPr, view \}/.test(w))
}

await main()
console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
