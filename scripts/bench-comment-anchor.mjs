// docx 兜底导入的批注重锚基准（v0.176）
//
// `docxToCommentHtml`（mammoth 兜底路径）此前对每个批注各跑一次全文正则 +
// `docXml.slice(bodyStart)` 大串复制 + 全文 `indexOf`，是 O(批注数 × 全文)。
// 这一轮 `commentAnchorsOf` 一次 `matchAll` 收齐所有 Start/End 并按 id 配对，
// 变成 O(全文 + 各锚点片段)；HTML 里包 span 的替换循环**原样保留**，
// 不碰「相同锚文本会嵌套」这类既有语义（那是另一笔账）。
//
// 判据取同进程 A/B：把改前 docx.ts 导出成副本，两腿同夹具交替跑，
// 并逐字比对输出 HTML——等价性与提速一起钉。
//   git archive HEAD src/lib | tar -x -C tmp/bench-docx-old   （改动提交前跑，HEAD 即改前）
//
// 跑法：npx vite-node scripts/bench-comment-anchor.mjs

import fs from 'node:fs'
import { performance } from 'node:perf_hooks'
import JSZip from 'jszip'
import { docxToCommentHtml } from '../src/lib/docx.ts'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

function fixture(comments, filler = 1600) {
  let body = ''
  // 填充段：把 document.xml 撑到真实长文的量级
  for (let i = 0; i < filler; i++) {
    body += `<w:p><w:r><w:t>填充段落 ${i} 的正文，用来把全文撑开 ABC 123</w:t></w:r></w:p>`
  }
  // 带批注的段：锚文本各不相同，避免相同 needle 的既有嵌套语义掺进比较
  for (let i = 0; i < comments; i++) {
    body += `<w:p><w:commentRangeStart w:id="${i}"/><w:r><w:t>锚文本${i}</w:t></w:r>` +
      `<w:commentRangeEnd w:id="${i}"/></w:p>`
  }
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
  const commentsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:comments xmlns:w="${W}">` +
    Array.from({ length: comments }, (_, i) =>
      `<w:comment w:id="${i}" w:author="作者"><w:p><w:r><w:t>批注内容 ${i}</w:t></w:r></w:p></w:comment>`,
    ).join('') +
    `</w:comments>`
  let html = '<p>前面的正文</p>'
  for (let i = 0; i < comments; i++) html += `<p>锚文本${i}</p>`
  for (let i = 0; i < filler; i++) html += `<p>填充段落 ${i} 的正文，用来把全文撑开 ABC 123</p>`
  const zip = new JSZip()
  zip.file('word/document.xml', docXml)
  zip.file('word/comments.xml', commentsXml)
  return zip.generateAsync({ type: 'uint8array', compression: 'STORE' }).then((bytes) => ({ bytes: new Uint8Array(bytes), html }))
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const CS = [50, 200, 800]

console.log('端到端（当前读手，预热 2 趟 + 5 趟中位）')
for (const c of CS) {
  const { bytes, html } = await fixture(c)
  await docxToCommentHtml(bytes, html)
  await docxToCommentHtml(bytes, html)
  const times = []
  for (let r = 0; r < 5; r++) {
    const t = performance.now()
    await docxToCommentHtml(bytes, html)
    times.push(performance.now() - t)
  }
  console.log(`  ${String(c).padStart(3)} 条批注 / 1600 填充段  ${median(times).toFixed(1)}ms`)
}

const oldPath = new URL('../tmp/bench-docx-old/src/lib/docx.ts', import.meta.url)
if (!fs.existsSync(oldPath)) {
  console.log('\n（没有改前副本，跳过 A/B：git archive HEAD src/lib | tar -x -C tmp/bench-docx-old）')
} else {
  const { docxToCommentHtml: oldRead } = await import('../tmp/bench-docx-old/src/lib/docx.ts')
  console.log('\n同进程 A/B（A=改前 B=当前，交替顺序 + 各 10 样本取中位）')
  for (const c of [50, 800]) {
    const { bytes, html } = await fixture(c)
    await oldRead(bytes, html)
    await docxToCommentHtml(bytes, html)
    const a = []
    const b = []
    for (let r = 0; r < 5; r++) {
      let t = performance.now()
      await oldRead(bytes, html)
      a.push(performance.now() - t)
      t = performance.now()
      await docxToCommentHtml(bytes, html)
      b.push(performance.now() - t)
      t = performance.now()
      await docxToCommentHtml(bytes, html)
      b.push(performance.now() - t)
      t = performance.now()
      await oldRead(bytes, html)
      a.push(performance.now() - t)
    }
    const ma = median(a)
    const mb = median(b)
    const A = await oldRead(bytes, html)
    const B = await docxToCommentHtml(bytes, html)
    const same = A.html === B.html && JSON.stringify(A.comments) === JSON.stringify(B.comments)
    console.log(`  ${String(c).padStart(3)} 条批注  A=${ma.toFixed(1)}ms  B=${mb.toFixed(1)}ms  降幅=${(((ma - mb) / ma) * 100).toFixed(1)}%  输出逐字相同=${same}`)
  }
}
