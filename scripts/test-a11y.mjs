// v0.239 守卫：工具条无障碍语义化 + 状态播报（纯源码静态断言）。
// 跑法：npx vite-node scripts/test-a11y.mjs

import fs from 'node:fs'

const ok = []
const bad = []
const check = (n, c, extra = '') => (c ? ok : bad).push(n + (c || !extra ? '' : ` — ${extra}`))

const read = (p) => fs.readFileSync(new URL(`../src/components/${p}`, import.meta.url), 'utf8')
const doc = read('DocEditor.tsx')
const sheet = read('SheetEditor.tsx')
const pdf = read('PdfViewer.tsx')
const ppt = read('PptEditor.tsx')
const css = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')

// 三个主力编辑器的 btn 函数：type / aria-label / 状态语义
for (const [name, src] of [['Writer', doc], ['Calc', sheet], ['PDF', pdf]]) {
  const i = src.indexOf('const btn = (label: string, onClick')
  check(`${name} 有 btn 工厂`, i >= 0)
  const chunk = src.slice(i, i + 700)
  check(`${name} 按钮 type=button`, chunk.includes('type="button"'))
  check(`${name} 按钮有 aria-label`, chunk.includes('aria-label={title || label}'))
}
check('Writer/Calc 切换态 aria-pressed（只发真值）', doc.includes('aria-pressed={active || undefined}') && sheet.includes('aria-pressed={active || undefined}'))
check('PDF 禁用态 aria-disabled', pdf.includes('aria-disabled={disabled}'))
check('按钮注释在 JSX 属性区之外', !/title=\{title\}\s*\n\s*\/\//.test(doc) && !/title=\{title\}\s*\n\s*\/\//.test(sheet))

// 状态播报
check('Writer 状态区可播报', /role="status" aria-live="polite" aria-atomic="true"\{status\}/.test(doc) || (doc.includes('role="status" aria-live="polite" aria-atomic="true"') && doc.includes('{status}')))
check('Calc 主状态条播报', sheet.includes('role="status" aria-live="polite" aria-atomic="true"'))
check('PDF 主状态条播报', pdf.includes('role="status" aria-live="polite" aria-atomic="true"'))
check('sr-only 样式存在', css.includes('.sr-only') && css.includes('clip: rect(0, 0, 0, 0)'))

// Impress：63 个按钮全带 type（避免表单误提交）；中文文本本身可读
const buttons = [...ppt.matchAll(/<button\b([^>]*)>/g)].map((m) => m[0])
check('Impress 按钮数量 > 0', buttons.length > 0, String(buttons.length))
check('Impress 按钮全带 type', buttons.every((b) => b.includes('type="button"')), `${buttons.filter((b) => !b.includes('type="button"')).length} 个缺 type`)

// 既有 ARIA 不回退
check('PDF 密码对话框 ARIA 仍在', pdf.includes('role="dialog" aria-modal="true"'))

for (const n of ok) console.log(`  ✓ ${n}`)
for (const n of bad) console.log(`  ✗ ${n}`)
console.log(`\n无障碍：${ok.length} 通过 / ${bad.length} 失败`)
if (bad.length) process.exit(1)
