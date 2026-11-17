// v0.209 守卫：钉住 roadmap 三条「部分过期」就地澄清与它们对应的代码事实。
// 任一侧被回退（澄清被删 / 代码事实变了但澄清没更新）即红，避免历史快照重新误导判断。
// 跑法：node scripts/test-roadmap-clarity.mjs（纯 Node 内置模块）
import { readFileSync } from 'node:fs'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const road = read('../docs/roadmap.md')
const pdf = read('../src/components/PdfViewer.tsx')
const prewarm = read('../src/lib/prewarm.ts')

// ── ① PDF 搜索「从当前页找下一个」：两件事被压成一句 ──────────
check('roadmap 澄清①在场', /从当前页开始找下一个[\s\S]{0,500}v0\.209 澄清/.test(road))
check('focusFirst 仍按当前页定位', /found\.findIndex\(\(m\) => m\.page >= curPageRef\.current\)/.test(pdf))
check('gotoMatch 仍是列表环绕', /\(activeIdx \+ delta \+ n\) % n/.test(pdf))

// ── ② 预热「建实例提到外壳 / chunk 备好」已被实测回答 ──────────
check('roadmap 澄清②在场', /建实例提到外壳[\s\S]{0,600}v0\.209 澄清/.test(road))
check('prewarm 记着实例预热已删', /已删/.test(prewarm))
check('prewarm 只保留 chunk 预取', /只保留 chunk 预取|chunk 预取/.test(prewarm))

// ── ③ PDF chunk 构成被 v0.198 改变 ───────────────────────────
check('roadmap 澄清③在场', /PdfViewer` 那块 chunk[\s\S]{0,500}v0\.209 澄清/.test(road))
check('澄清③点名 v0.198', /v0\.198 改变/.test(road))
check('澄清③点名 chunk 降幅', /−31\.6%/.test(road))
check('PDF 改字仍是动态 import（构成没回退）', /await import\('pdf-lib'\)/.test(read('../src/lib/pdf-text-edit.ts')))

// ── ④ 三条澄清没被写进别的条目（只改这三条）──────────────────
const clarifications = (road.match(/v0\.209 澄清/g) ?? []).length
check('恰好三条 v0.209 澄清', clarifications === 3, `got=${clarifications}`)

console.log(`roadmap-clarity: ${ok.length} 通过 / ${bad.length} 失败`)
for (const b of bad) console.error('  FAIL ' + b)
if (bad.length) process.exitCode = 1
