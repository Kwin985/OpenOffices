// v0.223 断言：表级对齐（docx 的 `w:tblPr/w:jc` / ODF 的 `table:align`）要能走完一整趟。
//
// 为什么单独立一份：这一族此前**两条链都只读了一半**——
//   · docx：只有**命名表样式**那一层读过 `w:tblPr/w:jc`（`styleTableAlign` → `tStyle` 的 al），
//     表自己直接写的那一枚从没查问过。Word 里居中的表导入后贴左，存盘时 `w:jc` 整枚消失。
//   · ODT：读手只认 `fo:margin-left`（缩进），`table:align` 一个方向都没读；写手那一半
//     （`tableStyleXml`）一直是通的，于是「读不进来」这件事被写手的正确掩盖了。
//
// 断言分两组，各三件：读侧形状（center / right / 不该出的档）、写侧落点（回写出真元素）、
// 以及「不该凭空多一枚声明」的反例（left 与缺省同形、样式的左对齐要能压父样式的居中）。
//
// 跑法：npx vite-node scripts/test-table-align.mjs

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
const { docxToHtmlFidelity } = await import('../src/lib/docx-fidelity.ts')
const { prosemirrorToDocxBytes } = await import('../src/lib/docx.ts')
const { docExtensions } = await import('../src/lib/doc-schema.ts')
const { getSchema } = await import('@tiptap/core')
const { DOMParser: PMDOMParser } = await import('@tiptap/pm/model')
const { parseHTML } = await import('linkedom')

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (cond || !extra ? '' : ` — ${extra}`))
const has = (name, html, sub) => check(name, html.includes(sub), `HTML 里找不到 ${JSON.stringify(sub)}`)
const hasNot = (name, html, sub) => check(name, !html.includes(sub), `HTML 里不该有 ${JSON.stringify(sub)}`)

const schema = getSchema(docExtensions())
const toPm = (html) => {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`)
  return PMDOMParser.fromSchema(schema).parse(document.body).toJSON()
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const O = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0'
const T = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0'
const TX = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0'
const ST = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0'
const FO = 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0'

// ─────────────────────────── docx 一侧 ───────────────────────────

/** 造一份最小 docx：只有一张两格表，`tblPr` 里塞调用方给的那几枚 */
async function importDocx(tblPr) {
  const zip = new JSZip()
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="${W}"><w:body><w:tbl>` +
      `<w:tblPr>${tblPr}</w:tblPr>` +
      `<w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>` +
      `<w:tr><w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>甲</w:t></w:r></w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>乙</w:t></w:r></w:p></w:tc></w:tr>` +
      `</w:tbl><w:p/></w:body></w:document>`,
  )
  zip.file(
    'word/styles.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W}">` +
      `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
      `</w:styles>`,
  )
  const bytes = new Uint8Array(await zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
  const r = await docxToHtmlFidelity(bytes)
  if (r.blocks === 0) throw new Error('夹具没拆出块，导入没跑起来')
  return r.html
}

const docxCenter = await importDocx('<w:jc w:val="center"/>')
has('docx 读：w:jc=center → data-talign=center', docxCenter, 'data-talign="center"')

const docxEnd = await importDocx('<w:jc w:val="end"/>')
has('docx 读：ST_Jc 的 end 折成贴右', docxEnd, 'data-talign="right"')

const docxRight = await importDocx('<w:jc w:val="right"/>')
has('docx 读：w:jc=right', docxRight, 'data-talign="right"')

// left 与缺省同形：挂一枚属性出去等于凭空多一句声明，下游还得再判一次默认值
const docxLeft = await importDocx('<w:jc w:val="left"/>')
hasNot('docx 读：w:jc=left 不出标签（与缺省同形）', docxLeft, 'data-talign')

const docxNone = await importDocx('')
hasNot('docx 读：没有 w:jc 时不出标签', docxNone, 'data-talign')

// 写侧：模型里那枚 talign 必须落成真元素（库有槽：ITableOptions.alignment）
const docxDocOf = async (pm) => {
  const bytes = await prosemirrorToDocxBytes(pm)
  return (await JSZip.loadAsync(bytes)).file('word/document.xml').async('string')
}
const outCenter = await docxDocOf(toPm(docxCenter))
check('docx 写：居中回写成 <w:jc w:val="center"/>', outCenter.includes('<w:jc w:val="center"/>'), outCenter.slice(0, 400))
const outRight = await docxDocOf(toPm(docxRight))
check('docx 写：贴右回写成 <w:jc w:val="right"/>', outRight.includes('<w:jc w:val="right"/>'))
const outNone = await docxDocOf(toPm(docxNone))
check('docx 写：没对齐时不发 w:jc（表级）', !/<w:tblPr>[\s\S]*?<w:jc /.test(outNone), '写出包的表级 tblPr 里出现了 w:jc')

// ─────────────────────────── ODT 一侧 ───────────────────────────

const skeleton = await prosemirrorToOdtBytes(toPm('<p>骨架</p>'))

/** 产品骨架 + 手写 content.xml（`office:automatic-styles` 里带表样式，LibreOffice 也是这么写的） */
async function buildOdt(autostyles, body) {
  const zip = await JSZip.loadAsync(skeleton)
  zip.file(
    'content.xml',
    `<?xml version="1.0" encoding="UTF-8"?>` +
      `<office:document-content xmlns:office="${O}" xmlns:style="${ST}" xmlns:text="${TX}" ` +
      `xmlns:table="${T}" xmlns:fo="${FO}" office:version="1.2">` +
      `<office:automatic-styles>${autostyles}</office:automatic-styles>` +
      `<office:body><office:text>${body}</office:text></office:body></office:document-content>`,
  )
  return new Uint8Array(await zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
}

const tableBody =
  `<table:table table:name="T" table:style-name="T1">` +
  `<table:table-column table:number-columns-repeated="2"/>` +
  `<table:table-row><table:table-cell><text:p>甲</text:p></table:table-cell>` +
  `<table:table-cell><text:p>乙</text:p></table:table-cell></table:table-row>` +
  `</table:table>`

const tableStyle = (align, extra = '') =>
  `<style:style style:name="T1" style:family="table"><style:table-properties table:align="${align}"${extra}/></style:style>`

const odtCenter = await odtToHtml(await buildOdt(tableStyle('center'), tableBody))
has('ODT 读：table:align=center → data-talign=center', odtCenter.html, 'data-talign="center"')

const odtRight = await odtToHtml(await buildOdt(tableStyle('right'), tableBody))
has('ODT 读：table:align=right', odtRight.html, 'data-talign="right"')

const odtMargins = await odtToHtml(await buildOdt(tableStyle('margins'), tableBody))
hasNot('ODT 读：margins 是缺省档，不出标签', odtMargins.html, 'data-talign')

// 样式链：父样式居中、本样式说左 —— 自己赢（子样式那枚 left 打回缺省）
const odtChain = await odtToHtml(
  await buildOdt(
    `<style:style style:name="TP" style:family="table"><style:table-properties table:align="center"/></style:style>` +
      `<style:style style:name="T1" style:family="table" style:parent-style-name="TP"><style:table-properties table:align="left"/></style:style>`,
    tableBody,
  ),
)
hasNot('ODT 读：子样式说 left 压掉父样式的 center', odtChain.html, 'data-talign')

const odtContentOf = async (pm) => {
  const bytes = await prosemirrorToOdtBytes(pm)
  return (await JSZip.loadAsync(bytes)).file('content.xml').async('string')
}
const outOdtCenter = await odtContentOf(toPm(odtCenter.html))
check('ODT 写：居中回写成 table:align="center"', outOdtCenter.includes('table:align="center"'), outOdtCenter.slice(0, 300))
check('ODT 写：表身上挂了 table:style-name', /<table:table[^>]*table:style-name="/.test(outOdtCenter))
const outOdtRight = await odtContentOf(toPm(odtRight.html))
check('ODT 写：贴右回写成 table:align="right"', outOdtRight.includes('table:align="right"'))
const outOdtMargins = await odtContentOf(toPm(odtMargins.html))
check('ODT 写：没对齐时不发 table:align（省掉整条表样式）', !outOdtMargins.includes('table:align'), '写出包里出现了 table:align')

// ODF 的 `table:align` 与 `w:jc` 是同一件事的两个词：读进来的 center 一路到 docx 也得是 center
const crossOdtToDocx = await docxDocOf(toPm(odtCenter.html))
check('跨链：ODT 读到的居中，写出 docx 时仍是 <w:jc w:val="center"/>', crossOdtToDocx.includes('<w:jc w:val="center"/>'))

// ─────────────────────────── 收口 ───────────────────────────
for (const n of ok) console.log(`  ✓ ${n}`)
for (const n of bad) console.log(`  ✗ ${n}`)
console.log(`\n表级对齐：${ok.length} 通过 / ${bad.length} 失败`)
if (bad.length) process.exit(1)
