// v0.222 断言：ODT 写手必须给跨列锚点补 `table:covered-table-cell` 占位格。
//
// ODF 的格位按**行内元素序**算：每枚 `table-cell` / `covered-table-cell` 各占一列，
// `table:number-columns-spanned` 只是「这一格跨了几列」的元数据，不推进列位。
// 写手原先写完锚点就 `c += colspan` 直接跳过，跨出去的那几列**一枚元素都不发**——
// 于是同一行右边的格子在文件里左移（内容换格），LibreOffice 自己的输出是逐枚补的。
// 与 v0.221 在 `ods.rs` 修的是同一条，这一侧当时没跟上（读写两侧对称地错，账本看不见）。
//
// 顺带钉住行右缘：末格跨出去的那几列、以及被上一行纵向合并整段盖住的尾巴，原先都不算进
// 行尾，导致「整行没有真实格」的行只补出一枚占位。
//
// 跑法：npx vite-node scripts/test-odt-table-covered.mjs

import fs from 'node:fs'
import JSZip from 'jszip'

const { DOMParser } = await import('@xmldom/xmldom')
const probe = new DOMParser().parseFromString('<r><a/><b/></r>', 'text/xml')
Object.defineProperty(Object.getPrototypeOf(probe.documentElement), 'children', {
  configurable: true,
  get() {
    const out = []
    const ns = this.childNodes
    for (let i = 0; i < (ns?.length ?? 0); i++) if (ns[i].nodeType === 1) out.push(ns[i])
    return out
  },
})
globalThis.DOMParser = DOMParser

const { prosemirrorToOdtBytes, odtToHtml } = await import('../src/lib/odt.ts')

const T = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0'
const TX = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const eq = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want), `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')
const contentOf = async (bytes) => (await JSZip.loadAsync(bytes)).file('content.xml').async('string')

/** 网格：每枚格元素各占一列；covered 也占一列 */
function gridOf(content) {
  const doc = new DOMParser().parseFromString(content, 'text/xml')
  const tables = doc.getElementsByTagNameNS(T, 'table')
  const out = []
  for (let t = 0; t < tables.length; t++) {
    const rows = []
    const trs = tables[t].getElementsByTagNameNS(T, 'table-row')
    for (let r = 0; r < trs.length; r++) {
      const cells = []
      let gc = 0
      const kids = trs[r].childNodes
      for (let i = 0; i < kids.length; i++) {
        const el = kids[i]
        if (el.nodeType !== 1) continue
        const ln = el.localName
        const rep = Number(el.getAttribute('table:number-columns-repeated') ?? 1) || 1
        if (ln === 'covered-table-cell') {
          for (let k = 0; k < rep; k++) cells.push({ gc, covered: true })
          gc += rep
          continue
        }
        if (ln !== 'table-cell') continue
        const cs = Number(el.getAttribute('table:number-columns-spanned') ?? 1) || 1
        const rs = Number(el.getAttribute('table:number-rows-spanned') ?? 1) || 1
        let text = ''
        const ps = el.getElementsByTagNameNS(TX, 'p')
        for (let p = 0; p < ps.length; p++) text += ps[p].textContent ?? ''
        for (let k = 0; k < rep; k++) cells.push({ gc, covered: false, text, cs, rs })
        gc += rep
      }
      rows.push(cells)
    }
    out.push(rows)
  }
  return out
}

/** 结构合法性：跨 cs 列的锚点后面必须紧跟 cs-1 枚 covered，且列位连续 */
function holes(g) {
  const out = []
  g.forEach((rows, ti) =>
    rows.forEach((cells, ri) =>
      cells.forEach((c, i) => {
        if (c.covered || c.cs <= 1) return
        for (let k = 1; k < c.cs; k++) {
          const n = cells[i + k]
          if (!n || !n.covered || n.gc !== c.gc + k) out.push(`表${ti}r${ri} gc${c.gc} 跨${c.cs}列缺第${k}枚占位`)
        }
      }),
    ),
  )
  return out
}

const para = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const cell = (t, attrs = {}) => ({ type: 'tableCell', attrs, content: [para(t)] })
const row = (...cells) => ({ type: 'tableRow', content: cells })

// 三行三列：A 跨 2 列 2 行；第二行只剩 col2 一格（col0/1 全被 A 盖住）；第三行 F + G 跨 2 列。
// 这一张同时踩两个坑：跨列要补占位、整行被纵向合并盖住时行尾要够长。
const DOC = {
  type: 'doc',
  content: [
    {
      type: 'table',
      content: [
        row(cell('A', { colspan: 2, rowspan: 2 }), cell('B')),
        row(cell('E')),
        row(cell('F'), cell('G', { colspan: 2 })),
      ],
    },
  ],
}

async function main() {
  const bytes = await prosemirrorToOdtBytes(DOC)
  const content = await contentOf(bytes)
  const g = gridOf(content)
  const rowsOf = g[0] ?? []

  // ── ① 网格与占位格 ───────────────────────────────────────────────
  check('只有一张表', g.length === 1, `得到 ${g.length}`)
  eq('三行', rowsOf.length, 3)
  eq(
    'r0 三格：A(跨2列2行) / 占位 / B',
    rowsOf[0]?.map((c) => (c.covered ? 'covered' : `${c.text}@${c.gc}`)),
    ['A@0', 'covered', 'B@2'],
  )
  eq(
    'r1 三格：两枚占位 + E 在 col2（不是 col0）',
    rowsOf[1]?.map((c) => (c.covered ? 'covered' : `${c.text}@${c.gc}`)),
    ['covered', 'covered', 'E@2'],
  )
  eq(
    'r2 三格：F / G(跨2列) / 占位',
    rowsOf[2]?.map((c) => (c.covered ? 'covered' : `${c.text}@${c.gc}`)),
    ['F@0', 'G@1', 'covered'],
  )
  eq('每行都是 3 列', rowsOf.map((r) => r.length), [3, 3, 3])
  eq('结构合法性（跨列锚点后紧跟占位）', holes(g), [])
  check('锚点仍写 number-columns-spanned', content.includes('table:number-columns-spanned="2"'))
  check('纵向合并仍写 number-rows-spanned', content.includes('table:number-rows-spanned="2"'))
  check('占位格不发正文（空元素）', /<table:covered-table-cell\s*\/>/.test(content))

  // ── ② 读回来位置对 ──────────────────────────────────────────────
  const back = await odtToHtml(bytes)
  check('HTML 里 A 带 colspan/rowspan', /<td colspan="2" rowspan="2">/.test(back.html))
  const trs = back.html.match(/<tr>[\s\S]*?<\/tr>/g) ?? []
  eq('HTML 三行', trs.length, 3)
  check('r1 只有一格 E（被 rowspan 盖住的不出 td）', /^<tr><td><p>E<\/p><\/td><\/tr>$/.test(trs[1] ?? ''), trs[1] ?? '')
  check('r2 是 F + 跨列的 G', /^<tr><td><p>F<\/p><\/td><td colspan="2"><p>G<\/p><\/td><\/tr>$/.test(trs[2] ?? ''), trs[2] ?? '')

  // ── ②b 整行被纵向合并盖住：行尾必须够长 ──────────────────────────
  // 这一行一枚真实格都没有，行尾只能由「本行被盖住的位置」给出；
  // 若按最右那格的左边算行尾，这一行只会补出 1 枚占位（3 列要 3 枚）。
  const wide = {
    type: 'doc',
    content: [
      {
        type: 'table',
        content: [row(cell('甲', { colspan: 3, rowspan: 2 })), row(), row(cell('A'), cell('B'), cell('C'))],
      },
    ],
  }
  const wideRows = gridOf(await contentOf(await prosemirrorToOdtBytes(wide)))[0] ?? []
  eq(
    'r0 跨 3 列：一枚锚点 + 两枚占位',
    wideRows[0]?.map((c) => (c.covered ? 'covered' : `${c.text}@${c.gc}`)),
    ['甲@0', 'covered', 'covered'],
  )
  eq(
    'r1 一枚真实格都没有，也要补满 3 枚占位',
    wideRows[1]?.map((c) => (c.covered ? 'covered' : `${c.text}@${c.gc}`)),
    ['covered', 'covered', 'covered'],
  )
  eq(
    'r2 三格各归其位',
    wideRows[2]?.map((c) => (c.covered ? 'covered' : `${c.text}@${c.gc}`)),
    ['A@0', 'B@1', 'C@2'],
  )
  eq('跨 3 列那张表每行也是 3 列', wideRows.map((r) => r.length), [3, 3, 3])

  // ── ③ 二次保存稳定（同一网格，不漂）──────────────────────────────
  const again = await prosemirrorToOdtBytes(DOC, {})
  eq('二次写出网格一致', gridOf(await contentOf(again)), g)

  // ── ④ 不误伤：没有合并的表一枚占位都不发 ──────────────────────────
  const plain = await contentOf(
    await prosemirrorToOdtBytes({ type: 'doc', content: [{ type: 'table', content: [row(cell('甲'), cell('乙'))] }] }),
  )
  check('无合并表不发 covered', !plain.includes('covered-table-cell'))
  check('无合并表不发 spanned', !plain.includes('number-columns-spanned'))

  // ── ⑤ 源码级：两处接线都在 ──────────────────────────────────────
  const w = read('../src/lib/odt.ts')
  check('跨列锚点后补 cs-1 枚占位', /for \(let k = 1; k < colspan; k\+\+\) rowXml \+= '<table:covered-table-cell\/>'/.test(w))
  check('行尾按跨越右缘 + 本行被盖住的位置算', /it\.col \+ \(spans\.get\(`\$\{ri\},\$\{it\.col\}`\)\?\.cs \?\? 1\)/.test(w))
  check('循环用 c < rowEnd（不是 <= lastCol）', /while \(c < rowEnd\)/.test(w))
}

await main()
console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
