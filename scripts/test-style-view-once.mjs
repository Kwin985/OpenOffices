// v0.194 断言：读手 styleView 每段两次调用 → 一次（纯去重复计算）。
//
// `Fidelity.effPPrOf()` 与 `paragraph()` 对同一个 styleId 各调一次 styleView，
// 后者拿到的 chain 与前者完全相同（styleView 是纯函数）。本轮把 view 从
// effPPrOf 带出来给 paragraph 复用：不引入跨段落共享的可变树，语义零变化。
// `legacyStyleView:true` 复刻改前的重复计算，供同进程 A/B 对撞。
//
// 跑法：npx vite-node scripts/test-style-view-once.mjs

import fs from 'node:fs'
import JSZip from 'jszip'
import { fixtureParts } from './lib/fixture.mjs'
import { docxToHtmlFidelity } from '../src/lib/docx-fidelity.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

const signature = (f) => JSON.stringify({
  html: f.html,
  styles: f.styles,
  latentStyles: f.latentStyles,
  numbering: f.numbering,
  section: f.section,
  background: f.background,
  comments: f.comments,
  warnings: [...(f.warnings ?? [])],
})

async function main() {
  const z = new JSZip()
  for (const [p, c] of fixtureParts()) z.file(p, c)
  const bytes = new Uint8Array(await z.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))

  const before = signature(await docxToHtmlFidelity(bytes, 0, undefined, { legacyStyleView: true }))
  const after = signature(await docxToHtmlFidelity(bytes))
  check('两腿导入结果逐字相同', before === after,
    before === after ? '' : `长度 ${before.length} vs ${after.length}`)
  check('夹具非空（确实走到段落渲染）',
    after.includes('控件里的字') && after.includes('font-variant-ligatures'))

  // 放大语料：把同一段复制 N 份插在 sectPr 之前，让重复调用的代价显出来
  const srcDoc = fixtureParts().get('word/document.xml')
  const at = srcDoc.lastIndexOf('<w:sectPr')
  const one = '<w:p><w:pPr><w:pStyle w:val="Report"/></w:pPr><w:r><w:t>放大语料</w:t></w:r></w:p>'
  for (const n of [20, 200]) {
    const big = srcDoc.slice(0, at) + one.repeat(n) + srcDoc.slice(at)
    const bz = new JSZip()
    for (const [p, c] of fixtureParts()) bz.file(p, p === 'word/document.xml' ? big : c)
    const bigBytes = new Uint8Array(await bz.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
    const a = signature(await docxToHtmlFidelity(bigBytes, 0, undefined, { legacyStyleView: true }))
    const b = signature(await docxToHtmlFidelity(bigBytes))
    check(`${n} 段放大语料两腿仍逐字相同`, a === b)
    check(`${n} 段语料确实渲染了复制段落`, (b.match(/放大语料/g) ?? []).length >= n)
  }

  const w = read('../src/lib/docx-fidelity.ts')
  check('effPPrOf 把 view 一并返回（v0.195 起 effPPr 走短路变量）',
    /const effPPr = !this\.legacyMergePPr && !pPr \? view\.pPr : mergePPr\(\[view\.pPr, pPr\]\)/.test(w) &&
    /return \{ pPr, effPPr, view \}/.test(w))
  check('paragraph 直接复用 view.chain',
    /: view\.chain/.test(w) && /const \{ pPr, effPPr, view \} = this\.effPPrOf\(el\)/.test(w))
  const para = w.slice(w.indexOf('private async paragraph('), w.indexOf('private async paragraph(') + 1400)
  check('paragraph 里只在对照腿分支调 styleView',
    /const chain = this\.legacyStyleView/.test(para) &&
    (para.match(/styleView\(/g) ?? []).length === 1)
  check('不引入跨段落缓存（没有 Map 缓存 view）', !/viewCache|styleViews = new Map/.test(w))
  check('构造有独立开关', /private legacyStyleView = false/.test(w))
  check('入口第 4 个可选参数接两个独立开关',
    /opts\?: \{ legacyStyleView\?: boolean; legacyMergePPr\?: boolean \}/.test(w) &&
    /!!opts\?\.legacyStyleView, !!opts\?\.legacyMergePPr\)/.test(w))
}

await main()
console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
