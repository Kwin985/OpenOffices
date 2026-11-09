// v0.189 断言：PDF 页序重排（纯函数边界 + pdf-lib 内存往返 + UI 接线）。
//
// 选中页整体朝 delta 方向挪 |delta| 格，非选中页保持相对顺序；边界上不动。
// 页序由纯函数算，落位用 pdf-lib 的 removePage/insertPage（只摘页树节点、
// 不复制页面，标注与资源跟着原对象走）。
//
// 跑法：npx vite-node scripts/test-pdf-page-order.mjs

import fs from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import { reorderPageOrder } from '../src/lib/pdf-pages.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

async function main() {
  // ── ① 纯函数边界 ──────────────────────────────────────────────────
  eq('没选页不动', reorderPageOrder(5, [], -1), [0, 1, 2, 3, 4])
  eq('delta=0 不动', reorderPageOrder(5, [3], 0), [0, 1, 2, 3, 4])
  eq('首页上移不动', reorderPageOrder(5, [1], -1), [0, 1, 2, 3, 4])
  eq('末页下移不动', reorderPageOrder(5, [5], 1), [0, 1, 2, 3, 4])
  eq('全选不动', reorderPageOrder(5, [1, 2, 3, 4, 5], 1), [0, 1, 2, 3, 4])
  eq('单选中间页上移', reorderPageOrder(5, [3], -1), [0, 2, 1, 3, 4])
  eq('单选中间页下移', reorderPageOrder(5, [3], 1), [0, 1, 3, 2, 4])
  eq('连续选区整体上移', reorderPageOrder(5, [2, 3], -1), [1, 2, 0, 3, 4])
  eq('连续选区整体下移', reorderPageOrder(5, [2, 3], 1), [0, 3, 1, 2, 4])
  eq('不连续选区各自让位', reorderPageOrder(5, [2, 4], -1), [1, 0, 3, 2, 4])
  eq('|delta|=2 逐格挪两格', reorderPageOrder(5, [3], -2), [2, 0, 1, 3, 4])
  eq('越界页号被过滤', reorderPageOrder(3, [0, 9, -1], -1), [0, 1, 2])
  eq('单页文档不动', reorderPageOrder(1, [1], 1), [0])
  const cases = [[5, [3], -1], [5, [2, 3], 1], [8, [1, 4, 7], -3], [8, [2, 3, 6], 2]]
  check('输出恒为原页身份的一个排列（不丢不重）', cases.every(([n, s, d]) => {
    const o = reorderPageOrder(n, s, d)
    return o.length === n && JSON.stringify([...o].sort((a, b) => a - b)) === JSON.stringify(Array.from({ length: n }, (_, i) => i))
  }))
  check('非选中页相对顺序不变', (() => {
    const o = reorderPageOrder(8, [2, 5], 1)
    const rest = o.filter((v) => v !== 1 && v !== 4)
    return JSON.stringify(rest) === JSON.stringify([0, 2, 3, 5, 6, 7])
  })())

  // ── ② pdf-lib 内存往返：removePage/insertPage 机制 ─────────────────
  const sizes = [[200, 300], [210, 310], [220, 320], [230, 330]]
  const src = await PDFDocument.create()
  for (const [w, h] of sizes) src.addPage([w, h])
  const b0 = await src.save()
  const doc = await PDFDocument.load(b0)
  const order = reorderPageOrder(4, [2, 3], -1)
  eq('本次落位序', order, [1, 2, 0, 3])
  const kept = doc.getPages()
  for (let i = 3; i >= 0; i--) doc.removePage(i)
  for (let i = 0; i < 4; i++) doc.insertPage(i, kept[order[i]])
  const b1 = await doc.save({ addDefaultPage: false })
  const after = await PDFDocument.load(b1)
  eq('页数不变', after.getPageCount(), 4)
  const dims = after.getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())])
  eq('每页尺寸按新序落位（原页对象没被复制掉）', dims, [sizes[1], sizes[2], sizes[0], sizes[3]])
  const twice = await PDFDocument.load(b1)
  const kept2 = twice.getPages()
  const back = reorderPageOrder(4, [1, 2], 1)
  eq('反向挪一格的落位序', back, [2, 0, 1, 3])
  for (let i = 3; i >= 0; i--) twice.removePage(i)
  for (let i = 0; i < 4; i++) twice.insertPage(i, kept2[back[i]])
  const b2 = await twice.save({ addDefaultPage: false })
  const restored = await PDFDocument.load(b2)
  eq('反向挪一次回到原序（可逆）',
    restored.getPages().map((p) => Math.round(p.getWidth())), sizes.map(([w]) => w))

  // ── ③ 源码级：不写盘守卫与两条出口 ───────────────────────────────
  const lib = read('../src/lib/pdf-pages.ts')
  const ui = read('../src/components/PdfViewer.tsx')
  check('纯函数是导出函数', /export function reorderPageOrder\(/.test(lib))
  check('没动就不写盘', /if \(order\.every\(\(v, i\) => v === i\)\) return \{ total, moved: 0 \}/.test(lib))
  check('倒序摘除再按新序插回', /for \(let i = total - 1; i >= 0; i--\) doc\.removePage\(i\)/.test(lib)
    && /doc\.insertPage\(i, kept\[order\[i\]\]\)/.test(lib))
  check('不复制页面（无 copyPages）', !/copyPages/.test(lib.slice(lib.indexOf('export async function movePagesInPlace'), lib.indexOf('删除指定页'))))
  check('工具条两枚按钮', /btn\('↑ 上移'/.test(ui) && /btn\('↓ 下移'/.test(ui))
  check('opMove 复用 pageOp（未选中对当前页生效）', /const opMove = \(delta: number\) =>\s*pageOp\(/.test(ui))
  check('冒烟钩子也挂 move（两条出口一致）', /move: \(pages: number\[\], delta: number\) => movePagesInPlace/.test(ui))
  check('边界返回可读提示', /已在边界，页序未变/.test(ui))
}

await main()
console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
