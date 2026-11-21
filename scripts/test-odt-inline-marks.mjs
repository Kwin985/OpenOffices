// v0.222 断言：ODT 行内三枚标记——下划线 / 删除线 / 高亮。
//
// ① 下划线、删除线：ODF 里这两族各有两枚同义属性（`style:text-underline-type` 与
//    `style:text-underline-style`，删除线同理）。读手原先写的是
//    `getAttribute('…-type') ?? getAttribute('…-style')`——而 `getAttribute` 缺属性时
//    浏览器返回 null、测试用的 `@xmldom/xmldom` 返回空串，`??` 在 xmldom 下整枚兜底失效：
//    只写 -style 的合法 ODF 在测试里读不到、在浏览器里读得到，**量具与产品量的不是一件事**。
//    改用 `||` 之后两边一致。
//
// ② 高亮：读手原来发 `<span style="background-color: …">`，而 TipTap 的 Highlight 只按
//    `<mark>` 解析，schema 认不出 ⇒ 高亮在「HTML → 模型」那一步就没了（写手侧反倒是好的：
//    `charStyleXml` 会把 highlight mark 的色写成 `fo:background-color`，两头对不上）。
//    改成与 docx 读手同一枚形状 `<mark data-color="…" style="background-color: …; color: inherit">`。
//
// 跑法：npx vite-node scripts/test-odt-inline-marks.mjs

import fs from 'node:fs'
import JSZip from 'jszip'
import { parseHTML } from 'linkedom'
import { getSchema } from '@tiptap/core'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'

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

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')
const partsOf = async (bytes) => {
  const z = await JSZip.loadAsync(bytes)
  const out = {}
  for (const n of Object.keys(z.files)) if (!z.files[n].dir) out[n] = await z.file(n).async('uint8array')
  return out
}

const NS =
  `<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"` +
  ` xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"` +
  ` xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"` +
  ` xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.2">`

/** 用产品骨架（mimetype/manifest/styles.xml 的形状由产品自己给）换掉 content.xml */
async function withContent(contentXml) {
  const skel = await prosemirrorToOdtBytes({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: '骨架' }] }],
  })
  const parts = await partsOf(skel)
  const zip = new JSZip()
  for (const [n, v] of Object.entries(parts)) if (n !== 'content.xml') zip.file(n, v)
  zip.file('content.xml', contentXml)
  return new Uint8Array(await zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
}

// 三种写法各一段：只写 -style 的下划线 / 只写 -style 的删除线 / 只写 fo:background-color 的高亮
const CONTENT =
  `<?xml version="1.0" encoding="UTF-8"?>` +
  NS +
  `<office:automatic-styles>` +
  `<style:style style:name="U1" style:family="text"><style:text-properties style:text-underline-style="solid"/></style:style>` +
  `<style:style style:name="S1" style:family="text"><style:text-properties style:text-line-through-style="solid"/></style:style>` +
  `<style:style style:name="H1" style:family="text"><style:text-properties fo:background-color="#ffff00"/></style:style>` +
  `</office:automatic-styles>` +
  `<office:body><office:text>` +
  `<text:p><text:span text:style-name="U1">下划线</text:span></text:p>` +
  `<text:p><text:span text:style-name="S1">删除线</text:span></text:p>` +
  `<text:p><text:span text:style-name="H1">高亮</text:span></text:p>` +
  `</office:text></office:body></office:document-content>`

async function main() {
  const src = await withContent(CONTENT)
  const { html } = await odtToHtml(src)

  // ── ① 只写 -style 的下划线/删除线也要读出来 ─────────────────────
  check('只有 style:text-underline-style 也出 <u>', html.includes('<u>下划线</u>'), html)
  check('只有 style:text-line-through-style 也出 <s>', html.includes('<s>删除线</s>'), html)

  // ── ② 高亮按 docx 那枚形状出 <mark> ─────────────────────────────
  check(
    '高亮出 <mark data-color> 且带 color: inherit（与 docx 读手同形）',
    html.includes('<mark data-color="#ffff00" style="background-color: #ffff00; color: inherit">高亮</mark>'),
    html,
  )
  check('不再发行内 background-color 的 <span>（旧形状会让 schema 丢掉高亮）',
    !html.includes('<span style="background-color:'))

  // ── ③ 高亮真的进得了模型，并且能写回去 ──────────────────────────
  const schema = getSchema(docExtensions())
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`)
  const pm = PMDOMParser.fromSchema(schema).parse(document.body).toJSON()
  const marks = []
  const walk = (n) => {
    for (const m of n.marks ?? []) if (m.type === 'highlight') marks.push(m.attrs?.color)
    for (const c of n.content ?? []) walk(c)
  }
  walk(pm)
  check('模型里拿到 highlight mark', marks.length === 1, `marks=${JSON.stringify(marks)}`)
  check('highlight 色是源件的 #ffff00', marks[0] === '#ffff00', String(marks[0]))

  const back = await partsOf(await prosemirrorToOdtBytes(pm, {}))
  const backContent = new TextDecoder().decode(back['content.xml'])
  check('写回包里有 fo:background-color="#ffff00"', backContent.includes('fo:background-color="#ffff00"'), '')
  check('写回包里有下划线（style + type 两枚都发）',
    /style:text-underline-style="solid" style:text-underline-type="single"/.test(backContent))
  check('写回包里有删除线',
    /style:text-line-through-style="solid" style:text-line-through-type="single"/.test(backContent))

  // ── ④ 复读一遍：三枚都还在（闭环）────────────────────────────────
  const again = await odtToHtml(await prosemirrorToOdtBytes(pm, {}))
  check('再读回来下划线还在', again.html.includes('<u>下划线</u>'), again.html)
  check('再读回来删除线还在', again.html.includes('<s>删除线</s>'), again.html)
  check('再读回来高亮还在', again.html.includes('data-color="#ffff00"'), again.html)

  // ── ⑤ 源码级：兜底不许退回 ??，高亮形状只此一处 ──────────────────
  const w = read('../src/lib/odt.ts')
  check('下划线兜底用 ||', /getAttribute\('style:text-underline-type'\) \|\| tp\.getAttribute\('style:text-underline-style'\)/.test(w))
  check('删除线兜底用 ||', /getAttribute\('style:text-line-through-type'\) \|\| tp\.getAttribute\('style:text-line-through-style'\)/.test(w))
  check('这两处不再出现 ?? 兜底',
    !/getAttribute\('style:text-underline-type'\) \?\?/.test(w) &&
    !/getAttribute\('style:text-line-through-type'\) \?\?/.test(w))
  check('高亮只从这一处发 <mark>', (w.match(/<mark data-color=/g) ?? []).length === 1)
}

await main()
console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
