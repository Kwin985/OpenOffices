// v0.226 断言：ODT 批注身份串读写闭环 + 普查假红备案。
//
// v0.224 查问面普查曾报「annotation|creator / |date 读手从未查问」——那是**假红**：
// 夹具把 dc:creator / dc:date 写成了属性，而 ODF 1.2 里它们是 office:annotation 的子元素。
// 读手（odtToHtml）一直按子元素收，合法件两个字段都读得到。真缺口在写手：
// openAnnEl 只发 dc:creator，另存一次批注日期就没了（docx 的 w:comment/@w:date 有对应槽）。
//
// 所以这份守卫两头都钉：合法子元素的读、以及 dc:date 的写与整趟往返；并把
// 「属性形状不读」作为假红的来源记成反例，防止下次有人照那个夹具重新立案。
//
// 跑法：npx vite-node scripts/test-odt-comment-date.mjs

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
const hasNot = (name, text, sub) => check(name, !text.includes(sub), `不该有 ${JSON.stringify(sub)}`)

const schema = getSchema(docExtensions())
const toPm = (html) => {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`)
  return PMDOMParser.fromSchema(schema).parse(document.body).toJSON()
}

const O = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0'
const ST = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0'
const TX = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0'
const DC = 'http://purl.org/dc/elements/1.1/'
const NSDECL = `xmlns:office="${O}" xmlns:style="${ST}" xmlns:text="${TX}" xmlns:dc="${DC}"`

const skeleton = await prosemirrorToOdtBytes(toPm('<p>骨架</p>'))

/** 手写 content.xml：一段带批注区间（子元素形状由调用方给全） */
async function buildOdt(identity, body = '锚前<office:annotation office:name="a1">__ID__<text:p>批注正文</text:p></office:annotation>锚后<office:annotation-end office:name="a1"/>') {
  const zip = await JSZip.loadAsync(skeleton)
  zip.file(
    'content.xml',
    `<?xml version="1.0" encoding="UTF-8"?>` +
      `<office:document-content ${NSDECL} office:version="1.2">` +
      `<office:body><office:text><text:p>${body.replace('__ID__', identity)}</text:p></office:text></office:body></office:document-content>`,
  )
  return new Uint8Array(await zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
}

// ── 读侧：合法子元素形状下作者/日期都在（证伪普查的假红）──
const legal =
  '<dc:creator>张三</dc:creator><dc:date>2026-11-22T10:00:00</dc:date>'
const r = await odtToHtml(await buildOdt(legal))
const c = r.meta.comments?.[0]
check('读：合法子元素 dc:creator → author', c?.author === '张三', JSON.stringify(c))
check('读：合法子元素 dc:date → date', c?.date === '2026-11-22T10:00:00', JSON.stringify(c))
check('读：批注正文不漏进文档正文', !r.html.includes('批注正文') && r.html.includes('锚前') && r.html.includes('锚后'), r.html)

// 普查夹具那种属性形状确实读不到——留一条反例，说明那份夹具不合法、不可据此立案
const illegal = await odtToHtml(
  await buildOdt('', '锚前<office:annotation office:name="a1" dc:creator="张三" dc:date="2026-11-22T10:00:00"><text:p>批注正文</text:p></office:annotation>锚后<office:annotation-end office:name="a1"/>'),
)
check('反例：属性形状本来就不是 ODF 的写法（普查假红来源）', !illegal.meta.comments?.[0]?.author && !illegal.meta.comments?.[0]?.date, JSON.stringify(illegal.meta.comments))

// ── 写侧：meta.comments 的 date 要发成 dc:date ──
const writeOf = async (comments) => {
  const pm = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '锚前' },
          { type: 'text', text: '批注词', marks: [{ type: 'comment', attrs: { cid: 1 } }] },
          { type: 'text', text: '锚后' },
        ],
      },
    ],
  }
  const bytes = await prosemirrorToOdtBytes(pm, { comments })
  return {
    bytes,
    xml: await (await JSZip.loadAsync(bytes)).file('content.xml').async('string'),
  }
}

const full = await writeOf([{ id: 1, author: '张三', date: '2026-11-22T10:00:00', text: '批注正文' }])
check('写：dc:creator 与 dc:date 都发', full.xml.includes('<dc:creator>张三</dc:creator>') && full.xml.includes('<dc:date>2026-11-22T10:00:00</dc:date>'), full.xml.slice(0, 300))
const noDate = await writeOf([{ id: 1, author: '张三', text: '批注正文' }])
hasNot('反例：没日期时不发空 dc:date', noDate.xml, '<dc:date>')

// ── 整趟：读 → 写 → 读，身份串不丢 ──
const again = await odtToHtml(full.bytes)
check('整趟：作者与日期二次读回都在', again.meta.comments?.[0]?.author === '张三' && again.meta.comments?.[0]?.date === '2026-11-22T10:00:00', JSON.stringify(again.meta.comments))

for (const n of ok) console.log(`  ✓ ${n}`)
for (const n of bad) console.log(`  ✗ ${n}`)
console.log(`\nODT 批注身份串：${ok.length} 通过 / ${bad.length} 失败`)
if (bad.length) process.exit(1)
