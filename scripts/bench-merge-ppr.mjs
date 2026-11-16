// v0.195 基准：读手 effPPrOf 的 mergePPr 空链短路。
//
// 判据：① 两腿导入结果（HTML + 样式/批注等签名）逐字相同；
// ② 同进程交替顺序各 10 样本取中位；③ 放大语料按段落数分档，
// 端到端被 XML 解析/树构建盖住时如实写「噪声内」，不拿小降幅冒充整链收益。
//
// 跑法：npx vite-node scripts/bench-merge-ppr.mjs

import { performance } from 'node:perf_hooks'
import JSZip from 'jszip'
import { fixtureParts } from './lib/fixture.mjs'
import { docxToHtmlFidelity } from '../src/lib/docx-fidelity.ts'

const ROUNDS = 10
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

const srcDoc = fixtureParts().get('word/document.xml')
const at = srcDoc.lastIndexOf('<w:sectPr')
// 无 pPr 的段落走短路，带 pStyle 的段落走原路径，两条都要覆盖
const one = '<w:p><w:r><w:t>无格式段</w:t></w:r></w:p>' +
  '<w:p><w:pPr><w:pStyle w:val="Report"/></w:pPr><w:r><w:t>带样式段</w:t></w:r></w:p>'
const mkBytes = async (n) => {
  const z = new JSZip()
  const big = n ? srcDoc.slice(0, at) + one.repeat(n) + srcDoc.slice(at) : srcDoc
  for (const [p, c] of fixtureParts()) z.file(p, p === 'word/document.xml' ? big : c)
  return new Uint8Array(await z.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
}
const signature = (f) => JSON.stringify({
  html: f.html, styles: f.styles, comments: f.comments,
  warnings: [...(f.warnings ?? [])],
})

const legs = [
  { name: '改前（每段都走 mergePPr）', fn: (b) => docxToHtmlFidelity(b, 0, undefined, { legacyMergePPr: true }) },
  { name: '本轮（空链短路）', fn: (b) => docxToHtmlFidelity(b) },
]

console.log('读手导入（完整链，含 XML 解析与树构建）')
for (const [n, label] of [[0, '原始夹具'], [50, '50 组'], [500, '500 组'], [2000, '2000 组']]) {
  const b = await mkBytes(n)
  const a = await legs[0].fn(b), c = await legs[1].fn(b)
  const same = signature(a) === signature(c)
  console.log(`${label.padEnd(10)} 语义等价（逐字）：${same ? '✓ 相同' : '✗ 不同'}`)
  if (!same) { process.exitCode = 1; continue }
  for (const l of legs) { await l.fn(b); await l.fn(b) }
  const t = legs.map(() => [])
  for (let r = 0; r < ROUNDS; r++) {
    for (const i of (r % 2 === 0 ? [0, 1, 1, 0] : [1, 0, 0, 1])) {
      const s = performance.now()
      await legs[i].fn(b)
      t[i].push(performance.now() - s)
    }
  }
  const m0 = median(t[0]), m1 = median(t[1])
  console.log(`  ${m0.toFixed(1)} → ${m1.toFixed(1)}ms  降幅 ${(((m0 - m1) / m0) * 100).toFixed(1)}%` +
    (Math.abs((m0 - m1) / m0) < 0.08 ? '（噪声内属正常）' : ''))
}
