// v0.224 断言：ODT 读手的 locale / 复杂文字字号 / 字符缩放 / 字族兜底四族，读写都要走完一整趟。
//
// 来源是 tmp 探针的查问面普查（95 对源对、43 对读手从未查问）。这一轮修的是其中
// 「docx 链已有槽、ODT 侧整族消失」的四个：
//   · fo:font-family   —— 字族兜底链的最后一枚（v0.222 立案；只写它的第三方程式整族掉）
//   · fo:language/country（+ asian/complex 两套）—— docx 读手发 data-lang/-ea/-bidi，
//     ODT 此前一枚不读 ⇒ 拼写检查与断行的语言丢了
//   · style:font-size-complex ↔ docx 的 w:szCs（半点）
//   · style:text-scale ↔ docx 的 w:w（字符缩放，百分比）
// 五族都屏上不兑现（CSS 无对应物），只往返——与 docx 链同一口径。
//
// 跑法：npx vite-node scripts/test-odt-run-extra.mjs

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
const { docExtensions } = await import('../src/lib/doc-schema.ts')
const { getSchema } = await import('@tiptap/core')
const { DOMParser: PMDOMParser } = await import('@tiptap/pm/model')
const { parseHTML } = await import('linkedom')

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (cond || !extra ? '' : ` — ${extra}`))
const hasNot = (name, html, sub) => check(name, !html.includes(sub), `HTML 里不该有 ${JSON.stringify(sub)}`)

const schema = getSchema(docExtensions())
const toPm = (html) => {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`)
  return PMDOMParser.fromSchema(schema).parse(document.body).toJSON()
}

const O = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0'
const ST = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0'
const TX = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0'
const FO = 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0'
const NSDECL = `xmlns:office="${O}" xmlns:style="${ST}" xmlns:text="${TX}" xmlns:fo="${FO}"`

const skeleton = await prosemirrorToOdtBytes(toPm('<p>骨架</p>'))

/** 产品骨架 + 手写 content.xml：正文挂一枚字符样式（text-properties 由调用方给全） */
async function buildOdt(textProps, bodyInner = '<text:span text:style-name="C1">正文</text:span>') {
  const zip = await JSZip.loadAsync(skeleton)
  zip.file(
    'content.xml',
    `<?xml version="1.0" encoding="UTF-8"?>` +
      `<office:document-content ${NSDECL} office:version="1.2">` +
      `<office:automatic-styles><style:style style:name="C1" style:family="text"><style:text-properties ${textProps}/></style:style></office:automatic-styles>` +
      `<office:body><office:text><text:p>${bodyInner}</text:p></office:text></office:body></office:document-content>`,
  )
  return new Uint8Array(await zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
}

// ── 读侧：每行 = 名称 / 源属性串 / HTML 里该出现的形状 ──
const readCases = [
  ['字族兜底：只写 fo:font-family 也认（配对引号剥掉）', "fo:font-family=\"&apos;Liberation Serif&apos;\"", 'font-family: Liberation Serif'],
  ['locale：fo:language + fo:country 合并成 zh-CN', 'fo:language="zh" fo:country="CN"', 'data-lang="zh-CN"'],
  ['locale：缺国只发语言', 'fo:language="zh"', 'data-lang="zh"'],
  ['locale：asian 一套 → data-lang-ea', 'style:language-asian="zh" style:country-asian="CN"', 'data-lang-ea="zh-CN"'],
  ['locale：complex 一套 → data-lang-bidi', 'style:language-complex="ar" style:country-complex="SA"', 'data-lang-bidi="ar-SA"'],
  ['字符缩放：120% → data-scale=120', 'style:text-scale="120%"', 'data-scale="120"'],
  ['复杂文字字号：12pt → data-szcs=24（半点）', 'style:font-size-complex="12pt"', 'data-szcs="24"'],
]
for (const [name, tp, want] of readCases) {
  const h = await odtToHtml(await buildOdt(tp))
  check(name, h.html.includes(want), `HTML 里找不到 ${JSON.stringify(want)}：${h.html.slice(0, 220)}`)
}

const plain = await odtToHtml(await buildOdt('fo:color="#ff0000"'))
hasNot('反例：没有 locale 时不发 data-lang', plain.html, 'data-lang')
hasNot('反例：没有缩放时不发 data-scale', plain.html, 'data-scale')

// ── 写侧：PM 里的 charExtra mark 要落回 ODF 属性 ──
const writeOf = async (markAttrs) => {
  const pm = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: '正文', marks: [{ type: 'charExtra', attrs: markAttrs }] }],
      },
    ],
  }
  const bytes = await prosemirrorToOdtBytes(pm)
  return (await JSZip.loadAsync(bytes)).file('content.xml').async('string')
}

check('写：zh-CN 拆回 language+country', (await writeOf({ lang: 'zh-CN' })).includes('fo:language="zh" fo:country="CN"'))
check('写：asian 一套', (await writeOf({ langEa: 'zh-CN' })).includes('style:language-asian="zh" style:country-asian="CN"'))
check('写：complex 一套', (await writeOf({ langBidi: 'ar-SA' })).includes('style:language-complex="ar" style:country-complex="SA"'))
const zhHans = await writeOf({ lang: 'zh-Hans' })
check('写：变体串 zh-Hans 整串进 language', zhHans.includes('fo:language="zh-Hans"'))
hasNot('写：zh-Hans 不造非法的 fo:country', zhHans, 'fo:country')
check('写：半点折回 pt', (await writeOf({ szcs: 24 })).includes('style:font-size-complex="12pt"'))
check('写：缩放发百分比', (await writeOf({ scale: 120 })).includes('style:text-scale="120%"'))
const bare = await writeOf({})
hasNot('写：没有 locale 时不发 fo:language', bare, 'fo:language')

// ── 整趟：读进来再写出去，值不丢 ──
const back = await writeOf({ lang: 'de-DE', scale: 90, szcs: 21 })
check(
  '往返：locale/缩放/半点三族一路到写出包',
  back.includes('fo:language="de" fo:country="DE"') && back.includes('style:text-scale="90%"') && back.includes('style:font-size-complex="10.5pt"'),
  back.slice(0, 300),
)

for (const n of ok) console.log(`  ✓ ${n}`)
for (const n of bad) console.log(`  ✗ ${n}`)
console.log(`\nODT run 扩展族：${ok.length} 通过 / ${bad.length} 失败`)
if (bad.length) process.exit(1)
