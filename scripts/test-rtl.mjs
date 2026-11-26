// v0.238 守卫：RTL 段落方向（data-ppr 的 bidi 键 → 屏上 dir）。
// 跑法：npx vite-node scripts/test-rtl.mjs

import { isRtlParagraph, withRtlPpr, parsePprPayload, PPR_ATTR } from '../src/lib/cell-style.ts'

const ok = []
const bad = []
const check = (n, c, extra = '') => (c ? ok : bad).push(n + (c || !extra ? '' : ` — ${extra}`))

// 三态判定
check('bidi=1 → RTL', isRtlParagraph('bidi=1'))
check('bidi=0 → 非 RTL', !isRtlParagraph('bidi=0'))
check('缺键 → 非 RTL', !isRtlParagraph('snapToGrid=1'))
check('空载荷 → 非 RTL', !isRtlParagraph('') && !isRtlParagraph(null))

// 切换：开只加 bidi，关整键删（不留 bidi=0 噪音）
check('开 RTL', withRtlPpr('snapToGrid=1', true) === 'bidi=1;snapToGrid=1', withRtlPpr('snapToGrid=1', true))
check('关 RTL 不留零', withRtlPpr('bidi=1;snapToGrid=1', false) === 'snapToGrid=1', withRtlPpr('bidi=1;snapToGrid=1', false))
check('空载荷开', withRtlPpr('', true) === 'bidi=1')
check('空载荷关', withRtlPpr('', false) === '')
check('反复切换幂等', withRtlPpr(withRtlPpr('a=1', true), true) === withRtlPpr('a=1', true))
check('载荷可逆', parsePprPayload(withRtlPpr('bidi=1;topLinePunct=1', false)).topLinePunct === '1')

// 源读写闭环：bidi 已经在 PPR_ONOFF_KEYS，读手能拿到
const { PPR_ONOFF_KEYS } = await import('../src/lib/cell-style.ts')
check('bidi 在 onOff 键表', PPR_ONOFF_KEYS.includes('bidi'))
check('PPR_ATTR 名正确', PPR_ATTR === 'data-ppr')

// PM 往返：ppr attr 带 bidi=1 → HTML 里有 dir=rtl；关掉后没有
const { getSchema } = await import('@tiptap/core')
const { docExtensions } = await import('../src/lib/doc-schema.ts')
const { DOMParser, DOMSerializer } = await import('@tiptap/pm/model')
const { parseHTML } = await import('linkedom')
const schema = getSchema(docExtensions())
const pmAt = (ppr) => DOMParser.fromSchema(schema).parse(parseHTML(`<html><body><p data-ppr="${ppr}">שלום</p></body></html>`).document.body)
const htmlOf = (doc) => {
  const d = parseHTML('<html><body></body></html>').document
  const frag = DOMSerializer.fromSchema(schema).serializeFragment(doc.content, { document: d })
  const div = d.createElement('div')
  for (const n of Array.from(frag.childNodes)) div.appendChild(n)
  return div.innerHTML
}
const rtlHtml = htmlOf(pmAt('bidi=1'))
check('序列化发 dir=rtl', rtlHtml.includes('dir="rtl"'), rtlHtml)
check('序列化保留 data-ppr', rtlHtml.includes('data-ppr="bidi=1"'), rtlHtml)
const ltrHtml = htmlOf(pmAt('snapToGrid=1'))
check('非 RTL 不发 dir', !ltrHtml.includes('dir='), ltrHtml)

// UI 接线
const fs = await import('node:fs')
const ui = fs.readFileSync(new URL('../src/components/DocEditor.tsx', import.meta.url), 'utf8')
check('工具条有 RTL 按钮', ui.includes("btn('RTL'"))
check('切换走 withRtlPpr', ui.includes('withRtlPpr('))
check('写回 data-ppr 属性', ui.includes("updateAttributes('paragraph', { [PPR_ATTR]: next || null })"))
const css = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
check('CSS 按 dir 选择器定右对齐', css.includes("p[dir='rtl']") && css.includes('text-align: right'))

for (const n of ok) console.log(`  ✓ ${n}`)
for (const n of bad) console.log(`  ✗ ${n}`)
console.log(`\nRTL 段落：${ok.length} 通过 / ${bad.length} 失败`)
if (bad.length) process.exit(1)
