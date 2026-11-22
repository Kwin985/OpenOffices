// v0.225 断言：ODT 的下划线三格（style/width/color）要借 docx 那条 data-u 六格载荷走完读写。
//
// 来源是 v0.224 查问面普查档 B 的第一族：`text-underline-style` / `-width` / `-color`
// 从没被读手问过。docx 读手早就把线型与颜色装进 data-u（线型;屏上色;字面色;主题三枚），
// charExtra mark 接住后屏上画得出线型/颜色；ODT 此前只读两枚同义属性里的一枚，
// 写手则永远发 solid/single/auto 死档——线型与颜色整族丢。
//
// 跑法：npx vite-node scripts/test-odt-underline.mjs

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

/** 产品骨架 + 手写 content.xml：正文挂一枚带下划线的字符样式 */
async function buildOdt(props) {
  const zip = await JSZip.loadAsync(skeleton)
  zip.file(
    'content.xml',
    `<?xml version="1.0" encoding="UTF-8"?>` +
      `<office:document-content ${NSDECL} office:version="1.2">` +
      `<office:automatic-styles><style:style style:name="C1" style:family="text"><style:text-properties ${props}/></style:style></office:automatic-styles>` +
      `<office:body><office:text><text:p><text:span text:style-name="C1">正文</text:span></text:p></office:text></office:body></office:document-content>`,
  )
  return new Uint8Array(await zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
}

// ── 读侧：ODF 三格 → docx 六格载荷 ──
const readCases = [
  ['点线 + 红 → dotted 载荷', 'style:text-underline-type="single" style:text-underline-style="dotted" style:text-underline-color="#ff0000"', 'data-u="dotted;#ff0000;FF0000;;;"'],
  ['虚线 → dash 载荷', 'style:text-underline-type="single" style:text-underline-style="dashed"', 'data-u="dash;;;;;"'],
  ['波浪 → wave 载荷', 'style:text-underline-type="single" style:text-underline-style="wavy"', 'data-u="wave;;;;;"'],
  ['type=double 压过 style', 'style:text-underline-type="double" style:text-underline-style="solid"', 'data-u="double;;;;;"'],
  ['粗线宽 → thick 载荷', 'style:text-underline-type="single" style:text-underline-style="solid" style:text-underline-width="bold"', 'data-u="thick;;;;;"'],
  ['颜色关键词保形（不伪造 hex）', 'style:text-underline-type="single" style:text-underline-style="solid" style:text-underline-color="red"', 'data-u="single;;red;;;"'],
['只有 type + 颜色关键词也保形', 'style:text-underline-type="single" style:text-underline-color="red"', 'data-u="single;;red;;;"'],
  ['只写同义的 -style 也认', 'style:text-underline-style="dotted"', 'data-u="dotted;;;;;"'],
]
for (const [name, props, want] of readCases) {
  const h = await odtToHtml(await buildOdt(props))
  check(name, h.html.includes(want), `找不到 ${JSON.stringify(want)}：${h.html.slice(0, 220)}`)
}
const none = await odtToHtml(await buildOdt('style:text-underline-type="none"'))
hasNot('反例：type=none 不出 data-u', none.html, 'data-u')
const plain = await odtToHtml(await buildOdt('fo:color="#ff0000"'))
hasNot('反例：没有下划线不出 data-u', plain.html, 'data-u')

// ── 写侧：PM 的 data-u 载荷 → ODF 三格 ──
const writeOf = async (u) => {
  const pm = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: '正文',
            marks: [
              { type: 'underline' },
              ...(u ? [{ type: 'charExtra', attrs: { u } }] : []),
            ],
          },
        ],
      },
    ],
  }
  const bytes = await prosemirrorToOdtBytes(pm)
  return (await JSZip.loadAsync(bytes)).file('content.xml').async('string')
}

const c = await writeOf('dotted;#ff0000;FF0000;;;')
check('写：点线 + 颜色落三格', c.includes('style:text-underline-style="dotted"') && c.includes('style:text-underline-type="single"') && c.includes('style:text-underline-color="#FF0000"'), c.slice(0, 300))
const w = await writeOf('wave;;;;;')
check('写：wave 折回 wavy', w.includes('style:text-underline-style="wavy"'))
check('写：double 落 type=double', (await writeOf('double;;;;;')).includes('style:text-underline-type="double"'))
check('写：thick 落 width=bold', (await writeOf('thick;;;;;')).includes('style:text-underline-width="bold"'))
check('写：关键词颜色保形', (await writeOf('solid;;red;;;')).includes('style:text-underline-color="red"'))
const legacy = await writeOf('')
check('写：没有载荷时保留旧的 solid/single/auto 死档', legacy.includes('style:text-underline-style="solid"') && legacy.includes('style:text-underline-width="auto"'))

// ── 整趟：ODT → HTML → PM → ODT，线型与颜色都不掉 ──
const first = await odtToHtml(await buildOdt('style:text-underline-type="single" style:text-underline-style="dotted" style:text-underline-color="#ff0000"'))
const pm = toPm(first.html)
const bytes = await prosemirrorToOdtBytes(pm)
const second = await (await JSZip.loadAsync(bytes)).file('content.xml').async('string')
const again = await odtToHtml(bytes)
check('整趟：二次读回仍是 dotted + 红', again.html.includes('data-u="dotted;#ff0000;FF0000;;;"'), `${second.slice(0, 200)} / ${again.html.slice(0, 200)}`)

for (const n of ok) console.log(`  ✓ ${n}`)
for (const n of bad) console.log(`  ✗ ${n}`)
console.log(`\nODT 下划线三格：${ok.length} 通过 / ${bad.length} 失败`)
if (bad.length) process.exit(1)
