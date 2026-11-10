// v0.193 断言：ODT 页面边框读写链（补 D52「ODT 链只扩了文档属性」顺延项）。
//
// v0.190 的 docx 页面边框走包原生槽，但 ODT 导出根本不发 fo:border——导入一份
// 带边框的 .odt 另存一次就没了。本轮写侧在 page-layout-properties 上发
// `fo:border` / `fo:padding`，读侧反解回同一个 PageBorders 模型，
// DocEditor 的页面设置面板与 docx 写手共用这一格（真双向）。
//
// 跑法：npx vite-node scripts/test-odt-page-borders.mjs

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

const { prosemirrorToOdtBytes, odtToHtml, odtPageBorderAttrs, parseOdtPageBorderAttrs } =
  await import('../src/lib/odt.ts')

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

const PM = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ODT 正文' }] }] }
const PB = { style: 'dashed', color: 'AABBCC', size: 12, space: 2 }
const stylesOf = async (bytes) => (await JSZip.loadAsync(bytes)).file('styles.xml').async('string')
const plpOf = (s) => (s.match(/<style:page-layout-properties\b[^>]*>/) ?? [''])[0]

async function main() {
  // ── ① 纯函数：生成与反解 ─────────────────────────────────────────
  eq('四档 + space 生成 ODF 属性串', odtPageBorderAttrs(PB),
    'fo:border="1.5pt dashed #AABBCC" fo:padding="2pt"')
  eq('没设边框一个属性都不发', odtPageBorderAttrs(undefined), '')
  eq('五格往返逐字一致', parseOdtPageBorderAttrs({ border: '1.5pt dashed #AABBCC', padding: '2pt' }), PB)
  check('脏色回落黑，不写坏 XML', odtPageBorderAttrs({ ...PB, color: 'zzz' }).includes('#000000'))
  check('不在四档的线型回落 solid', odtPageBorderAttrs({ ...PB, style: 'inset' }).includes('solid'))
  eq('ODF solid 反解成 docx 的 single',
    parseOdtPageBorderAttrs({ border: '0.5pt solid #000000' }),
    { style: 'single', color: '000000', size: 4 })
  eq('认不出的串返回 undefined（不硬造档位）', parseOdtPageBorderAttrs({ border: 'none' }), undefined)
  eq('空输入返回 undefined', parseOdtPageBorderAttrs({}), undefined)
  eq('四边分写时只认 top', parseOdtPageBorderAttrs({ borderTop: '0.5pt dotted #112233' }),
    { style: 'dotted', color: '112233', size: 4 })
  eq('第三方 cm 宽度折算回 pt', parseOdtPageBorderAttrs({ border: '0.02cm double #FF0000' }).style, 'double')
  check('cm 宽度折算出的 size 在合法区间',
    parseOdtPageBorderAttrs({ border: '0.02cm double #FF0000' }).size >= 2)
  eq('极宽线钳到 96', parseOdtPageBorderAttrs({ border: '99pt solid #000000' }).size, 96)
  eq('space 超界就不落格', parseOdtPageBorderAttrs({ border: '1pt solid #000000', padding: '99pt' }).space, undefined)
  eq('space 单位 cm 折算', parseOdtPageBorderAttrs({ border: '1pt solid #000000', padding: '1cm' }).space, 28)

  // ── ② 端到端：ODT 写出包 ────────────────────────────────────────
  const bytes = await prosemirrorToOdtBytes(PM, { page: { pageBorders: PB } })
  const plp = plpOf(await stylesOf(bytes))
  check('page-layout-properties 上发了 fo:border', plp.includes('fo:border="1.5pt dashed #AABBCC"'))
  check('space 发成 fo:padding', plp.includes('fo:padding="2pt"'))
  const back = await odtToHtml(bytes)
  eq('导入后 meta.page.pageBorders 与写出前一致', back.meta.page?.pageBorders, PB)
  check('正文没被边框带坏', back.html.includes('ODT 正文'))
  const plain = await stylesOf(await prosemirrorToOdtBytes(PM))
  check('默认路径一个边框属性都不发（不污染无边框件）', !plpOf(plain).includes('fo:border'))

  // ── ③ 真双向：用户改值再导出 ────────────────────────────────────
  const edited = { style: 'double', color: '00FF00', size: 24, space: 4 }
  const bytes2 = await prosemirrorToOdtBytes(PM, { page: { pageBorders: edited } })
  const plp2 = plpOf(await stylesOf(bytes2))
  check('改过的四格写进新包', plp2.includes('fo:border="3pt double #00FF00"') && plp2.includes('fo:padding="4pt"'))
  check('旧字面没被留在包里', !plp2.includes('AABBCC'))
  eq('改过的四格随 .odt 读回一致', (await odtToHtml(bytes2)).meta.page?.pageBorders, edited)
  eq('没设边框导入后就是 undefined', (await odtToHtml(await prosemirrorToOdtBytes(PM))).meta.page?.pageBorders, undefined)

  // ── ④ 源码级：读写两侧接线 ──────────────────────────────────────
  const w = read('../src/lib/odt.ts')
  check('写侧走纯函数且默认不发', /const borderAttrs = odtPageBorderAttrs\(pg\.pageBorders\)/.test(w)
    && /\(borderAttrs \? `\$\{borderAttrs\} ` : ''\)/.test(w))
  check('读侧从 page-layout-properties 取四格', /const pageBorders = parseOdtPageBorderAttrs\(\{/.test(w)
    && /borderTop: plp\?\.getAttribute\('fo:border-top'\)/.test(w))
  check('解析结果落进 meta.page', /if \(pageBorders\) page\.pageBorders = pageBorders/.test(w))
  check('没有手拼 fo:border 的另一条出口',
    (w.match(/fo:border="/g) ?? []).length === 1)
}

await main()
console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
