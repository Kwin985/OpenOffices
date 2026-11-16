// v0.196 断言：PDF 页签「插入空白页 / 复制选中页」（纯函数 + pdf-lib 内存往返 + UI 接线）。
//
// 两个新操作都落在「选中页整体之后」：insertAfterIndex 把 1-based 最大页号
// 直接当 0-based 插入位置。空白页尺寸取第 1 页；复制页用 copyPages 从同一字节
// 另载的源文档拷，避免自拷贝共享可变页树。
//
// 跑法：npx vite-node scripts/test-pdf-page-insert.mjs

import fs from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import { insertAfterIndex } from '../src/lib/pdf-pages.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')
const sizes = (doc) => doc.getPages().map((p) => { const { width, height } = p.getSize(); return [width, height] })

async function main() {
  // ── ① 纯函数边界 ────────────────────────────────────────────────────
  eq('没选页返回 -1（调用方整笔不写盘）', insertAfterIndex(5, []), -1)
  eq('单选第 3 页 → 插在 0-based 3', insertAfterIndex(5, [3]), 3)
  eq('不连续选区取最大页号', insertAfterIndex(5, [2, 4]), 4)
  eq('全选插在末尾', insertAfterIndex(5, [1, 2, 3, 4, 5]), 5)
  eq('越界页号过滤掉', insertAfterIndex(5, [0, 9, -1]), -1)
  eq('混合合法与越界只认合法', insertAfterIndex(5, [2, 99]), 2)
  eq('小数页号不算合法', insertAfterIndex(5, [2.5]), -1)
  eq('单页文档插在末尾', insertAfterIndex(1, [1]), 1)
  eq('0 页文档不动', insertAfterIndex(0, [1]), -1)

  // ── ② pdf-lib 内存往返：插入空白页 ───────────────────────────────────
  const dims = [[300, 400], [310, 410], [320, 420], [330, 430]]
  const mk = async () => {
    const d = await PDFDocument.create()
    for (const [w, h] of dims) d.addPage([w, h])
    return d
  }
  const a = await mk()
  const at = insertAfterIndex(a.getPageCount(), [2])
  const { width, height } = a.getPage(0).getSize()
  a.insertPage(at, [width, height])
  eq('插入后 5 页', a.getPageCount(), 5)
  eq('新页尺寸取第 1 页', sizes(a)[2], [300, 400])
  eq('原页序不变', sizes(a).filter((_, i) => i !== 2), dims)
  eq('插在末尾也合法', (() => { const p = insertAfterIndex(4, [4]); return p })(), 4)

  // ── ③ pdf-lib 内存往返：复制选中页 ────────────────────────────────────
  const b = await mk()
  const chosen = [0, 2] // 1-based [1,3]
  const copyAt = insertAfterIndex(b.getPageCount(), [1, 3])
  const saved = new Uint8Array(await b.save())
  const src = await PDFDocument.load(saved)
  const copied = await b.copyPages(src, chosen)
  for (let i = 0; i < copied.length; i++) b.insertPage(copyAt + i, copied[i])
  eq('复制后 6 页', b.getPageCount(), 6)
  eq('复制页按升序落在选中页之后', [sizes(b)[3], sizes(b)[4]], [dims[0], dims[2]])
  eq('原页序不变', sizes(b).filter((_, i) => i !== 3 && i !== 4), dims)

  // ── ④ 源码级接线 ────────────────────────────────────────────────────
  const lib = read('../src/lib/pdf-pages.ts')
  const ui = read('../src/components/PdfViewer.tsx')
  check('空白页尺寸取第 1 页', /doc\.getPage\(0\)\.getSize\(\)/.test(lib))
  check('空白页按 at + i 落位', /doc\.insertPage\(at \+ i, \[width, height\]\)/.test(lib))
  check('复制页从另载的源文档 copyPages（不自拷贝）', /lib\.PDFDocument\.load\(await readBytes\(path\)/.test(lib) && /doc\.copyPages\(src, chosen\)/.test(lib))
  check('复制页按 at + i 落位', /doc\.insertPage\(at \+ i, copied\[i\]\)/.test(lib))
  check('count 有上限（防误传撑爆页树）', /Math\.min\(20, Math\.floor\(count\)\)/.test(lib))
  check('两个操作都在 at < 0 时不写盘', (lib.match(/if \(at < 0/g) ?? []).length >= 2)
  check('UI 导入两个新函数', /duplicatePagesInPlace,/.test(ui) && /insertBlankPagesInPlace,/.test(ui))
  check('UI 两枚按钮都在页签操作区', /btn\('插入空白页', opInsertBlank/.test(ui) && /btn\('复制选中页', opDuplicate/.test(ui))
  check('两枚操作都复用 pageOp', /const opInsertBlank = \(\) =>\s*pageOp\(/.test(ui) && /const opDuplicate = \(\) =>\s*pageOp\(/.test(ui))
  check('未选中时对当前页生效（沿用 pageOp 的 targets）', /const targets = pages\.length \? pages : \[Math\.min\(curPage, doc\.numPages\)\]/.test(ui))
}

await main()
console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
