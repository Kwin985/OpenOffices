// v0.227 断言：ODT 书签名（`text:name`）读写闭环，含点书签与跨段续挂。
//
// v0.224 普查报「bookmark|name 从未查问」——合法形状下确实如此：ODT 读手此前
// 既不认 text:bookmark（点书签），也不认 text:bookmark-start/end（区间书签），
// 写手也不发。docx 链早有 Bookmark mark + span[data-oo-bookmark] 通道
// （w:bookmarkStart/End 的 name/id 两格载荷），本轮让 ODT 接同一条通道：
//   · 区间 → 同名 span 包住内容；跨段在段末收 span、下一段开头再开一枚
//   · 点书签 → 零宽空格安家 + data-oo-bookmark-point=1，写手认出后发回无内容的
//     <text:bookmark/>，不把零宽字符写进文件
//
// 跑法：npx vite-node scripts/test-odt-bookmark.mjs

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
const { prosemirrorToDocxBytes } = await import('../src/lib/docx.ts')
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

/** 手写 content.xml；正文由调用方给全，产品包骨架负责其它部件 */
async function buildOdt(body) {
  const zip = await JSZip.loadAsync(skeleton)
  zip.file(
    'content.xml',
    `<?xml version="1.0" encoding="UTF-8"?>` +
      `<office:document-content ${NSDECL} office:version="1.2">` +
      `<office:body><office:text>${body}</office:text></office:body></office:document-content>`,
  )
  return new Uint8Array(await zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
}
const contentOf = async (bytes) => await (await JSZip.loadAsync(bytes)).file('content.xml').async('string')

// ── 读侧 ──
const range = await odtToHtml(
  await buildOdt('<text:p>前<text:bookmark-start text:name="B1"/>书签内容<text:bookmark-end text:name="B1"/>后</text:p>'),
)
check('读：区间书签 → data-oo-bookmark 载荷', range.html.includes('data-oo-bookmark="B1;"'), range.html)
check('读：载荷确实包住了内容', /data-oo-bookmark="B1;"[^>]*>书签内容<\/span>/.test(range.html), range.html)

const point = await odtToHtml(await buildOdt('<text:p>锚<text:bookmark text:name="B2"/>点后</text:p>'))
check('读：点书签 → point 标记 + 零宽空格', /data-oo-bookmark="B2;" data-oo-bookmark-point="1">(?:&#8203;|\u200b)<\/span>/.test(point.html), JSON.stringify(point.html))

const plain = await odtToHtml(await buildOdt('<text:p>没有书签</text:p>'))
hasNot('反例：没有书签不出载荷', plain.html, 'data-oo-bookmark')

// 跨段续挂：段末收 span、下一段开头再开同名 span
const cross = await odtToHtml(
  await buildOdt(
    '<text:p>前<text:bookmark-start text:name="BX"/>甲</text:p>' +
      '<text:p>乙<text:bookmark-end text:name="BX"/>后</text:p>',
  ),
)
check('读：跨段书签两段各出一枚同名 span', (cross.html.match(/data-oo-bookmark="BX;"/g) ?? []).length === 2, cross.html)

// ── 写侧 ──
const writeOf = async (nodes) => {
  const bytes = await prosemirrorToOdtBytes({ type: 'doc', content: [{ type: 'paragraph', content: nodes }] })
  return { bytes, xml: await contentOf(bytes) }
}
const textWith = (text, name, extraAttrs = {}) => ({
  type: 'text',
  text,
  marks: name ? [{ type: 'bookmark', attrs: { name, ...extraAttrs } }] : [],
})

const wRange = await writeOf([textWith('前', ''), textWith('书签内容', 'B1;'), textWith('后', '')])
check('写：区间书签发 start/end 对', wRange.xml.includes('<text:bookmark-start text:name="B1"/>') && wRange.xml.includes('<text:bookmark-end text:name="B1"/>'), wRange.xml.slice(0, 400))
const wPoint = await writeOf([textWith('锚', ''), textWith('\u200b', 'B2;', { point: true }), textWith('点后', '')])
check('写：点书签发无内容 text:bookmark', wPoint.xml.includes('<text:bookmark text:name="B2"/>'), wPoint.xml.slice(0, 400))
hasNot('写：点书签不把零宽空格写进文件', wPoint.xml, '\u200b')
hasNot('写：点书签不发 start/end 对', wPoint.xml, '<text:bookmark-start')

// ── 整趟 ──
const rtRange = await odtToHtml(range ? await (async () => {
  // 直接把读到的 HTML 过 schema 再写回 ODT
  const bytes = await prosemirrorToOdtBytes(toPm(range.html))
  return bytes
})() : skeleton)
check('整趟：区间书签二次读回名字还在', rtRange.html.includes('data-oo-bookmark="B1;"'), rtRange.html)
const rtPoint = await odtToHtml(wPoint.bytes)
check('整趟：点书签二次读回仍是 point', rtPoint.html.includes('data-oo-bookmark="B2;" data-oo-bookmark-point="1"'), rtPoint.html)

// 跨链：ODT 读进来的书签写出 docx，也要落 w:bookmarkStart/End
const docxBytes = await prosemirrorToDocxBytes(toPm(range.html))
const docXml = await (await JSZip.loadAsync(docxBytes)).file('word/document.xml').async('string')
check('跨链：写出 docx 带 w:bookmarkStart/End 与名字', /<w:bookmarkStart[^>]*w:name="B1"/.test(docXml) && /<w:bookmarkEnd/.test(docXml), docXml.slice(0, 500))

for (const n of ok) console.log(`  ✓ ${n}`)
for (const n of bad) console.log(`  ✗ ${n}`)
console.log(`\nODT 书签名：${ok.length} 通过 / ${bad.length} 失败`)
if (bad.length) process.exit(1)
