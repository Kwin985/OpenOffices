// v0.228 断言：ODT 列表标签几何（后缀 / 标签间距 / 标签最小宽 / 定位模式）读写闭环。
//
// 先过合法性筛（ODF 1.2 RNG）：`text:min-label-width` 才是合法属性，v0.224 普查夹具
// 写的 `style:min-label-width` 是假红。`text:space-before`、`text:list-level-position-and-space-mode`
// 住在 style:list-level-properties 里；`style:num-suffix` 住在编号层元素上。
//
// 载荷形状：四个 encodeURIComponent 格用 `|` 相连，挂在 ol/ul 上（ListGeometry 扩展），
// 屏上折成 padding-left / 负 text-indent；写手按载荷登记一份 LGn 列表档，
// 只把第一层换成源几何（更深层沿用默认，避免拿一层的话替别层做主）。
//
// 跑法：npx vite-node scripts/test-odt-list-geometry.mjs

import JSZip from 'jszip'

const { DOMParser } = await import('@xmldom/xmldom')
const probe = new DOMParser().parseFromString('<r><a/></r>', 'text/xml')
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

const { odtToHtml, prosemirrorToOdtBytes } = await import('../src/lib/odt.ts')
const { docExtensions } = await import('../src/lib/doc-schema.ts')
const { getSchema } = await import('@tiptap/core')
const { DOMParser: PMDOMParser } = await import('@tiptap/pm/model')
const { parseHTML } = await import('linkedom')

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (cond || !extra ? '' : ` — ${extra}`))
const hasNot = (name, text, sub) => check(name, !text.includes(sub), `不该有 ${JSON.stringify(sub)}`)

const schema = getSchema(docExtensions())
const toPm = (html) => {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`)
  return PMDOMParser.fromSchema(schema).parse(document.body).toJSON()
}
const O = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0'
const ST = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0'
const TX = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0'
const NSDECL = `xmlns:office="${O}" xmlns:style="${ST}" xmlns:text="${TX}"`

const skeleton = await prosemirrorToOdtBytes(toPm('<p>骨架</p>'))

/** 手写 content.xml：列表档由调用方给全 */
async function buildOdt(styleXml, body = '<text:list text:style-name="L1"><text:list-item><text:p>第一项</text:p></text:list-item><text:list-item><text:p>第二项</text:p></text:list-item></text:list>') {
  const zip = await JSZip.loadAsync(skeleton)
  zip.file(
    'content.xml',
    `<?xml version="1.0" encoding="UTF-8"?>` +
      `<office:document-content ${NSDECL} office:version="1.2">` +
      `<office:automatic-styles>${styleXml}</office:automatic-styles>` +
      `<office:body><office:text>${body}</office:text></office:body></office:document-content>`,
  )
  return new Uint8Array(await zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
}
const listStyle = (levelXml) =>
  `<text:list-style style:name="L1"><text:list-level-style-number text:level="1" style:num-format="1">${levelXml}</text:list-level-style-number></text:list-style>`

const legal = listStyle(
  '<style:list-level-properties text:space-before="1cm" text:min-label-width="2cm" text:list-level-position-and-space-mode="label-width-and-position"/>',
)

// ── 读侧 ──
const r = await odtToHtml(await buildOdt(legal))
const payload = '|1cm|2cm|label-width-and-position'
check('读：合法几何 → data-oo-listgeom 四格载荷', r.html.includes(`data-oo-listgeom="${payload}"`), r.html.slice(0, 400))
// CSS 是 schema 的 renderHTML 在「PM → DOM」那一步画的，odtToHtml 只发载荷属性
const geomExt = docExtensions().find((e) => e.name === 'listGeometry')
const geomRender = typeof geomExt?.config.addGlobalAttributes === 'function'
  ? geomExt.config.addGlobalAttributes.call(geomExt)[0]?.attributes.listGeom.renderHTML
  : undefined
const rendered = typeof geomRender === 'function' ? geomRender({ listGeom: payload }) : null
check('屏上缩进 = 标签宽 + 间距（schema renderHTML）', !!rendered && JSON.stringify(rendered).includes('padding-left: 113px; text-indent: -76px'), JSON.stringify(rendered))

// 后缀住在编号层元素上，与另三格一起进载荷
const withSuffix = listStyle(
  '<style:list-level-properties text:min-label-width="0.9cm"/>',
).replace('style:num-format="1"', 'style:num-format="1" style:num-suffix=")"')
const rs = await odtToHtml(await buildOdt(withSuffix))
check('读：style:num-suffix 进载荷首格', rs.html.includes('data-oo-listgeom=")||0.9cm|"'), rs.html.slice(0, 400))

// 普查夹具那种 style:min-label-width 是假红：不合法、也不该据此立案
const illegal = await odtToHtml(await buildOdt(listStyle('<style:list-level-properties style:min-label-width="2cm"/>')))
hasNot('反例：style:min-label-width（非法形状）不进载荷', illegal.html, 'data-oo-listgeom')

const bare = await odtToHtml(await buildOdt(listStyle('<style:list-level-properties/>')))
hasNot('反例：没有几何不出载荷', bare.html, 'data-oo-listgeom')

// ── 写侧 / 整趟 ──
const pm = toPm(r.html)
const outBytes = await prosemirrorToOdtBytes(pm)
const outXml = await (await JSZip.loadAsync(outBytes)).file('content.xml').async('string')
const lg = outXml.match(/<text:list-style style:name="LG1">[\s\S]*?<\/text:list-style>/)?.[0] ?? ''
check('写：按载荷登记 LGn 列表档', !!lg, outXml.slice(0, 300))
check('写：第一层回发三枚几何属性', lg.includes('text:space-before="1cm"') && lg.includes('text:min-label-width="2cm"') && lg.includes('text:list-level-position-and-space-mode="label-width-and-position"'), lg.slice(0, 400))
const firstLevel = lg.match(/<text:list-level-style-number text:level="1"[\s\S]*?<\/text:list-level-style-number>/)?.[0] ?? ''
check('写：label-width-and-position 不挂 label-alignment 子元素', !firstLevel.includes('style:list-level-label-alignment'), firstLevel)
check('写：更深层仍用默认宽度（0.6cm × 层号）', (lg.match(/fo:margin-left="/g) ?? []).length === 9 && lg.includes('fo:margin-left="6.00cm"'), lg.slice(-400))
check('写：列表身挂上专属档名', /<text:list text:style-name="LG1"/.test(outXml), outXml.slice(0, 300))

const again = await odtToHtml(outBytes)
check('整趟：二次读回载荷不变', again.html.includes(`data-oo-listgeom="${payload}"`), again.html.slice(0, 400))

// 无几何的列表仍走默认档，不能凭空多出 LG 档
const outBare = await prosemirrorToOdtBytes(toPm(bare.html))
const bareXml = await (await JSZip.loadAsync(outBare)).file('content.xml').async('string')
hasNot('反例：无几何不发 LG 档', bareXml, 'style:name="LG1"')

for (const n of ok) console.log(`  ✓ ${n}`)
for (const n of bad) console.log(`  ✗ ${n}`)
console.log(`\nODT 列表标签几何：${ok.length} 通过 / ${bad.length} 失败`)
if (bad.length) process.exit(1)
