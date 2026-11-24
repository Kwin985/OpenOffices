// v0.234 守卫：文档比较 diff 纯函数（修订 HTML 可直接进 PM / 写回 docx）。
// 跑法：npx vite-node scripts/test-doc-compare.mjs

import {
  compareTextToHtml,
  compareParagraphsToHtml,
  splitParagraphs,
  tokenize,
} from '../src/lib/revision-extension.ts'

const ok = []
const bad = []
const check = (n, c, extra = '') => (c ? ok : bad).push(n + (c || !extra ? '' : ` — ${extra}`))
const O = { author: '比较者', date: '2026-01-01' }

// 切分与分词
check('段落切分保留空段', JSON.stringify(splitParagraphs('a\n\nb')) === JSON.stringify(['a', '', 'b']))
check('CRLF 归一', JSON.stringify(splitParagraphs('a\r\nb')) === JSON.stringify(['a', 'b']))
check('英文成词、中文成字', JSON.stringify(tokenize('hello 世界')) === JSON.stringify(['hello', ' ', '世', '界']))

// 无变化
const same = compareTextToHtml('第一段\n第二段', '第一段\n第二段', O)
check('相同文本零修订', same.changed === 0 && !same.html.includes('data-rev'), JSON.stringify(same))
check('相同文本段落数不变', (same.html.match(/<p>/g) ?? []).length === 2)

// 段内小改：只标改动字符
const small = compareTextToHtml('数值是 3。', '数值是 5。', O)
check('一字之差有修订', small.changed === 1 && small.html.includes('data-rev'), JSON.stringify(small))
check('小改只标 3 和 5', /data-rev="del"[^>]*>3</.test(small.html) && /data-rev="ins"[^>]*>5</.test(small.html), small.html)
check('小改保留未改文字', small.html.includes('数值是') && small.html.includes('。'), small.html)

// 纯新增段 / 纯删除段
const added = compareTextToHtml('甲', '甲\n乙', O)
check('新增段标 ins', added.changed === 1 && /data-rev="ins"[^>]*>乙</.test(added.html), added.html)
const deleted = compareTextToHtml('甲\n乙', '甲', O)
check('删除段标 del', deleted.changed === 1 && /data-rev="del"[^>]*>乙</.test(deleted.html), deleted.html)

// 两段替换仍逐段细粒度
const two = compareTextToHtml('甲一\n乙二', '甲三\n乙四', O)
check('多段改动配对', (two.html.match(/data-rev="del"/g) ?? []).length === 2 && (two.html.match(/data-rev="ins"/g) ?? []).length === 2, two.html)

// 空 → 有 / 有 → 空
const fromEmpty = compareTextToHtml('', '新内容', O)
check('空到有全标 ins', fromEmpty.changed === 1 && fromEmpty.html.includes('data-rev="ins"'), fromEmpty.html)
const toEmpty = compareTextToHtml('旧内容', '', O)
check('有到空全标 del', toEmpty.changed === 1 && toEmpty.html.includes('data-rev="del"'), toEmpty.html)

// 作者/日期进属性，且 HTML 转义
const esc = compareTextToHtml('a', 'b', { author: 'A&B', date: '<d>' })
check('作者日期进 mark 属性', esc.html.includes('data-rev-author="A&amp;B"') && esc.html.includes('data-rev-date="&lt;d&gt;"'), esc.html)
const inject = compareTextToHtml('<script>', '<b>', O)
check('正文做 HTML 转义', inject.html.includes('&lt;') && inject.html.includes('&gt;') && !inject.html.includes('<script>'), inject.html)

// 段内比较入口
const para = compareParagraphsToHtml('甲乙\n丙', '甲丁\n丙', O)
check('段内入口按段输出', (para.match(/<p>/g) ?? []).length === 2 && para.includes('data-rev="del"') && para.includes('data-rev="ins"'), para)

// 产出能被 schema 接住（mark 属性不丢）
const { getSchema } = await import('@tiptap/core')
const { docExtensions } = await import('../src/lib/doc-schema.ts')
const { DOMParser } = await import('@tiptap/pm/model')
const { parseHTML } = await import('linkedom')
const schema = getSchema(docExtensions())
const pm = DOMParser.fromSchema(schema).parse(parseHTML(`<html><body>${small.html}</body></html>`).document.body).toJSON()
const walk = (n) => (n.content ?? []).flatMap((c) => (c.marks ? [c] : walk(c)))
const marked = walk(pm).filter((n) => n.marks.some((m) => m.type === 'revIns' || m.type === 'revDel'))
check('PM 接住修订 mark', marked.length >= 2, JSON.stringify(marked.slice(0, 3)))
check('mark 带作者', marked.some((n) => n.marks.some((m) => (m.attrs?.author ?? '').includes('比较者'))), JSON.stringify(marked.slice(0, 2)))


// 应用路径：diff HTML 进 PM → 修订 mark → 写手发 w:ins/w:del（完整闭环）
const { prosemirrorToDocxBytes, docxToDocMeta } = await import('../src/lib/docx.ts')
const fs = await import('node:fs')
const JSZip = (await import('jszip')).default
const pm2 = DOMParser.fromSchema(schema).parse(parseHTML(`<html><body>${small.html}</body></html>`).document.body).toJSON()
const docx = await prosemirrorToDocxBytes(pm2)
const z = await JSZip.loadAsync(docx)
const dx = await z.file('word/document.xml').async('string')
check('写出发 w:del / w:ins', dx.includes('<w:del ') && dx.includes('<w:ins '), dx.slice(0, 300))

const ui = fs.readFileSync(new URL('../src/components/DocEditor.tsx', import.meta.url), 'utf8')
check('工具条有「比较」入口', ui.includes("btn('比较'"))
check('有预览与应用两按钮', ui.includes('onClick={previewCompare}') && ui.includes('onClick={applyCompare}'))
check('应用为整篇替换（保留修订 mark）', /insertContentAt\(\{ from: 0, to: editor\.state\.doc\.content\.size \}, compareHtml\)/.test(ui))


for (const n of ok) console.log(`  ✓ ${n}`)
for (const n of bad) console.log(`  ✗ ${n}`)
console.log(`\n文档比较：${ok.length} 通过 / ${bad.length} 失败`)
if (bad.length) process.exit(1)
