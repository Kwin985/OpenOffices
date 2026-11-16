// v0.176 批注锚文本预扫的等价性断言（v0.177 增补一例语义修复）。
//
// `commentAnchorsOf` 把「每个批注各扫一次全文」换成「一次预扫」。提速之外更要紧的是
// 语义逐字不变：这里把**改前的 anchorOf / 替换循环**原样复刻一份，对八种边界形状
// 逐例对撞产品 `docxToCommentHtml` 的输出 HTML。两边不共用实现（comments 的解析共用
// 产品那份，锚文本与包 span 的逻辑各自一份），撞得上才算等价。
// 第九例「相同锚文本」是 v0.177 单独立账的修复（改前的嵌套是 bug），不参与对撞。
//
// 跑法：npx vite-node scripts/test-comment-anchor.mjs

import JSZip from 'jszip'
import { docxToCommentHtml } from '../src/lib/docx.ts'
import { decodeEnt } from '../src/lib/ooxml.ts'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const ok = []
const bad = []
const check = (name, cond, extra = '') => {
  ;(cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const joinT = (xml) =>
  (xml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? []).map((m) => m.replace(/<[^>]+>/g, '')).join('')

/** 改前的逐 id 算法，一字不改地复刻（含 -1 < endIdx 这条边界） */
function legacyAnchors(docXml, ids) {
  const out = new Map()
  for (const id of ids) {
    const sm = new RegExp(`<w:commentRangeStart[^>]*w:id="${id}"[^>]*>`).exec(docXml)
    if (!sm) continue
    const bodyStart = sm.index + sm[0].length
    const em = new RegExp(`<w:commentRangeEnd[^>]*w:id="${id}"[^>]*>`).exec(docXml.slice(bodyStart))
    if (!em) continue
    const endIdx = bodyStart + em.index
    if (docXml.indexOf('</w:p>', bodyStart) < endIdx) continue
    const text = decodeEnt(joinT(docXml.slice(bodyStart, endIdx)))
    if (text) out.set(id, text)
  }
  return out
}

/** 改前的 HTML 替换循环，也原样复刻（相同 needle 会嵌套，这是既有语义，本轮不改） */
function legacyHtml(html, comments, anchors) {
  let out = html
  for (const c of comments) {
    const anchor = anchors.get(c.id)
    if (!anchor) continue
    const needle = esc(anchor)
    const idx = out.indexOf(needle)
    if (idx < 0) continue
    out = out.slice(0, idx) + `<span data-oo-comment="${c.id}">${needle}</span>` + out.slice(idx + needle.length)
  }
  return out
}

async function run(name, body, ids, html, compareLegacy = true) {
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
  const commentsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:comments xmlns:w="${W}">` +
    ids.map((id) => `<w:comment w:id="${id}" w:author="A"><w:p><w:r><w:t>批注 ${id}</w:t></w:r></w:p></w:comment>`).join('') +
    `</w:comments>`
  const zip = new JSZip()
  zip.file('word/document.xml', docXml)
  zip.file('word/comments.xml', commentsXml)
  const bytes = new Uint8Array(await zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
  const got = await docxToCommentHtml(bytes, html)
  const expected = legacyHtml(html, got.comments, legacyAnchors(docXml, got.comments.map((c) => c.id)))
  // v0.177 起「相同锚文本」那一例是有意的语义修复，不参与改前算法的等价比对
  if (compareLegacy) check(name, got.html === expected, `新=${JSON.stringify(got.html.slice(0, 160))} 旧=${JSON.stringify(expected.slice(0, 160))}`)
  return got
}

const p = (inner) => `<w:p>${inner}</w:p>`
const anchorP = (id, text, extra = '') =>
  `<w:p><w:commentRangeStart w:id="${id}"/>${extra}<w:r><w:t>${text}</w:t></w:r><w:commentRangeEnd w:id="${id}"/></w:p>`

// 1. 正常：三枚批注各自重锚
await run('正常三枚批注',
  anchorP(0, '甲文字') + anchorP(1, '乙文字') + anchorP(2, '丙文字'),
  [0, 1, 2], '<p>甲文字</p><p>乙文字</p><p>丙文字</p>')

// 2. 跨段：Start/End 之间先出现 </w:p> ⇒ 不重锚
await run('跨段批注不重锚',
  `<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>跨段</w:t></w:r></w:p>` +
  p('<w:commentRangeEnd w:id="0"/>'),
  [0], '<p>跨段</p>')

// 3. 缺 End
await run('缺 commentRangeEnd 不重锚',
  `<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>只有起点</w:t></w:r></w:p>`,
  [0], '<p>只有起点</p>')

// 4. 全文没有 </w:p>：旧算法 indexOf 返回 -1，-1 < endIdx 为真 ⇒ 不重锚
await run('无段落结束标签时按旧边界判为跨段',
  `<w:commentRangeStart w:id="0"/><w:r><w:t>没有段尾</w:t></w:r><w:commentRangeEnd w:id="0"/>`,
  [0], '<p>没有段尾</p>')

// 5. 同一 id 两对：只认第一对
await run('重复 id 只认第一对',
  anchorP(0, '第一对') + anchorP(0, '第二对'),
  [0], '<p>第一对</p><p>第二对</p>')

// 6. w:id 不在属性首位
await run('属性顺序不同仍命中',
  `<w:p><w:commentRangeStart w:author="x" w:id="7"/><w:r><w:t>属性乱序</w:t></w:r>` +
  `<w:commentRangeEnd w:author="x" w:id="7"/></w:p>`,
  [7], '<p>属性乱序</p>')

// 7. 实体解码（decodeEnt 与产品同源）
await run('锚文本里的实体',
  anchorP(0, 'A&amp;B'), [0], '<p>A&amp;B</p>')

// 8. 空锚：Start/End 之间没有 w:t
await run('空锚不重锚',
  `<w:p><w:commentRangeStart w:id="0"/><w:commentRangeEnd w:id="0"/></w:p>`,
  [0], '<p>什么都不写</p>')

// 9. 两枚批注锚文本相同（v0.177 单独立账的语义修复）：
//    改前循环每次在累积串里从头找，第二枚会命中刚插进去的 span，把两枚套成嵌套；
//    现在按「原文第 n 次出现」各认领一处。用两处原文才能看出两枚都落了位。
{
  const got = await run('相同锚文本各占一处',
    anchorP(0, '同字') + anchorP(1, '同字'), [0, 1],
    '<p>同字</p><p>同字</p>', false)
  check('相同锚文本：两枚批注都回得来', got.html.includes('data-oo-comment="0"') && got.html.includes('data-oo-comment="1"'))
  check('相同锚文本：两枚 span 各自独立（不再嵌套）',
    (got.html.match(/<span data-oo-comment=/g) ?? []).length === 2)
  check('相同锚文本：没有 span 套 span', !/<span data-oo-comment="\d+"><span data-oo-comment=/.test(got.html))
}

// 10. 产品源码形状：不再逐 id 全文正则
{
  const src = (await import('node:fs')).readFileSync(new URL('../src/lib/docx.ts', import.meta.url), 'utf8')
  check('源码：一次预扫建锚点索引', src.includes('commentAnchorsOf(docXml, joinT)'))
  check('源码：逐 id 全文正则已退场', !src.includes('new RegExp(`<w:commentRangeStart'))
}

console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
