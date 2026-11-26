// v0.240 守卫：质量收口（主控 docx 展开段落边界 / 占位符一次插入 / 比较结构守卫 / aria-pressed）。
// 跑法：npx vite-node scripts/test-quality-v240.mjs

import fs from 'node:fs'
import { htmlToParagraphs, mergeFieldSnippet, expandSubDocs } from '../src/lib/templates.ts'

const ok = []
const bad = []
const check = (n, c, extra = '') => (c ? ok : bad).push(n + (c || !extra ? '' : ` — ${extra}`))

// ① 主控文档展开 docx：段落边界不能丢（旧写法 replace(/<[^>]+>/g,' ') 会把三段挤成一行）
check('三段保边界', htmlToParagraphs('<p>第一段</p><p>第二段</p><p>第三段</p>') === '第一段\n第二段\n第三段', htmlToParagraphs('<p>第一段</p><p>第二段</p><p>第三段</p>'))
check('内联标签剥掉不换行', htmlToParagraphs('<p>甲<b>乙</b>丙</p>') === '甲乙丙')
check('br 换行', htmlToParagraphs('<p>甲<br>乙</p>') === '甲\n乙')
check('标题/列表块换行', htmlToParagraphs('<h1>题</h1><ul><li>一</li><li>二</li></ul>') === '题\n一\n二')
check('表格单元格用制表符', htmlToParagraphs('<table><tr><td>a</td><td>b</td></tr></table>') === 'a\tb')
check('实体解码', htmlToParagraphs('<p>A&amp;B&lt;C&gt;&quot;D&quot;</p>') === 'A&B<C>"D"')
check('空输入零输出', htmlToParagraphs('') === '')
check('首尾空段去掉', htmlToParagraphs('<p></p><p>有</p><p></p>') === '有')
check('展开接上段落', expandSubDocs([htmlToParagraphs('<p>甲</p><p>乙</p>'), '丙']) === '甲\n乙\n\n丙')

// ② 邮件合并占位符一次插入
check('字段串拼成一段', mergeFieldSnippet(['姓名', '部门']) === '«姓名» «部门»')
check('空字段返回空串', mergeFieldSnippet([]) === '')

// ③ 源码断言：接线与结构守卫
const ui = fs.readFileSync(new URL('../src/components/DocEditor.tsx', import.meta.url), 'utf8')
check('主控展开用 htmlToParagraphs', ui.includes('parts.push(htmlToParagraphs(html))'))
check('不再用旧 replace 挤标签', !ui.includes("replace(/<[^>]+>/g, ' ')"))
check('占位符一次插入', ui.includes('insertContent(mergeFieldSnippet(src.fields))') && !ui.includes('forEach(mergeInsertField)'))
check('比较有结构守卫', ui.includes('文档比较只处理纯文本，为避免丢失已拒绝应用'))
check('结构守卫覆盖表格/图片/公式', ui.includes("['table', 'image', 'formula', 'blockquote']"))

// ④ aria-pressed 不发 false（非切换按钮不该被念成「未按下」）
for (const [name, p] of [['Writer', 'DocEditor.tsx'], ['Calc', 'SheetEditor.tsx']]) {
  const src = fs.readFileSync(new URL(`../src/components/${p}`, import.meta.url), 'utf8')
  check(`${name} aria-pressed 只发真值`, src.includes('aria-pressed={active || undefined}'), p)
}

for (const n of ok) console.log(`  ✓ ${n}`)
for (const n of bad) console.log(`  ✗ ${n}`)
console.log(`\n质量收口：${ok.length} 通过 / ${bad.length} 失败`)
if (bad.length) process.exit(1)
