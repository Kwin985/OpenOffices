// v0.195 断言：Writer 批注侧栏筛选（只看未解决 / 按作者）。
//
// 批注一多，侧栏里「已解决」的卡片会把待办淹掉；本轮加两个纯 UI 筛选，
// 不改动文档里的批注。作者名按侧栏显示口径归一（没写 author 的显示「我」），
// 筛选与卡片不能两套房。纯函数放已有 `src/lib/docx.ts`，不新增 lib 文件
// （modules 不变，两份保真账 provenance 不受扰）。
//
// 跑法：npx vite-node scripts/test-comment-filter.mjs

import fs from 'node:fs'
import { filterDocComments } from '../src/lib/docx.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

const CS = [
  { id: 1, author: '张三', text: '待办一' },
  { id: 2, author: '张三', text: '已解决', resolved: true },
  { id: 3, author: '李四', text: '待办二' },
  { id: 4, text: '我的待办' },
  { id: 5, text: '我的已解决', resolved: true },
]

async function main() {
  // ── ① 纯函数边界 ─────────────────────────────────────────────────
  check('无条件时返回原数组（不复制、不过滤）', filterDocComments(CS) === CS)
  check('空 opts 同上', filterDocComments(CS, {}) === CS)
  eq('只看未解决', filterDocComments(CS, { openOnly: true }).map((c) => c.id), [1, 3, 4])
  eq('按作者', filterDocComments(CS, { author: '张三' }).map((c) => c.id), [1, 2])
  eq('无名作者归「我」', filterDocComments(CS, { author: '我' }).map((c) => c.id), [4, 5])
  eq('两条件取交集', filterDocComments(CS, { openOnly: true, author: '张三' }).map((c) => c.id), [1])
  eq('两条件交集（我）', filterDocComments(CS, { openOnly: true, author: '我' }).map((c) => c.id), [4])
  eq('认不出的作者返回空', filterDocComments(CS, { author: '王五' }), [])
  eq('空列表不炸', filterDocComments([], { openOnly: true }), [])
  check('不改原数组（纯函数）', CS.length === 5 && CS[1].resolved === true)

  // ── ② 源码级：DocEditor 接线 ─────────────────────────────────────
  const ui = read('../src/components/DocEditor.tsx')
  const css = read('../src/index.css')
  const lib = read('../src/lib/docx.ts')
  check('从 docx.ts 导入纯函数（不新增 lib 文件）', /filterDocComments,/.test(ui))
  check('纯函数在已有文件里导出', /export function filterDocComments\(/.test(lib))
  check('两个筛选状态都是组件内 useState',
    /const \[cmOnlyOpen, setCmOnlyOpen\] = useState\(false\)/.test(ui) &&
    /const \[cmAuthor, setCmAuthor\] = useState\(''\)/.test(ui))
  check('作者下拉按显示口径去重', /Array\.from\(new Set\(comments\.map\(\(c\) => c\.author \|\| '我'\)\)\)/.test(ui))
  check('渲染走 shownComments 而不是 comments',
    /\{\[\.\.\.shownComments\]/.test(ui) && !/\{\[\.\.\.comments\]\s*\.sort/.test(ui))
  check('筛选条件传给纯函数',
    /filterDocComments\(comments, \{ openOnly: cmOnlyOpen, author: cmAuthor \}\)/.test(ui))
  check('复选框与作者下拉都在', /type="checkbox" checked=\{cmOnlyOpen\}/.test(ui) &&
    /<select className="tb-input" value=\{cmAuthor\}/.test(ui) &&
    /<option value="">全部作者<\/option>/.test(ui))
  check('筛选结果为空时给提示', /没有符合筛选的批注/.test(ui))
  check('计数把「显示全部 / 显示 N」分开', /显示 \$\{shownComments\.length\}/.test(ui))
  check('筛选条有 CSS 布局', /\.doc-comments-tools \{/.test(css) && /\.doc-comments-tools \.tb-check/.test(css))
  check('筛选只影响侧栏（不写回 meta.comments）',
    !/patchMeta\(\{ comments: shownComments/.test(ui))
}

await main()
console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
