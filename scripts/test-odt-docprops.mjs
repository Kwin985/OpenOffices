// v0.191 断言：ODT 文档属性读写链（补 D50 顺延）。
//
// docx 侧 v0.188 已有 `DocMeta.docProps`，ODT 导出此前**根本不发 meta.xml**——
// 导入别人的 .odt 另存一次标题/作者/关键词全没。本轮写侧生成 ODF 标准的
// office:document-meta、读侧解析回同一份模型，DocEditor 现有面板直接可用。
//
// 跑法：npx vite-node scripts/test-odt-docprops.mjs

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

const { prosemirrorToOdtBytes, odtToHtml, odtMetaXml, parseOdtMetaProps } = await import('../src/lib/odt.ts')

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

const PM = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ODT 正文' }] }] }
const PROPS = { title: '季度报告', subject: '车载视频', creator: '张三', keywords: 'MDVR, 4G', description: '备注一行' }

async function main() {
  // ── ① 纯函数：生成与解析 ──────────────────────────────────────────
  const xml = odtMetaXml(PROPS)
  check('根是 office:document-meta 且声明 dc/meta 命名空间',
    xml.includes('<office:document-meta') && xml.includes('xmlns:dc="http://purl.org/dc/elements/1.1/"')
      && xml.includes('xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"'))
  eq('五格往返', parseOdtMetaProps(xml), PROPS)
  check('只发非空格（没话说的件不发空元素）',
    !odtMetaXml().includes('<dc:title') && !odtMetaXml({ title: '只有标题' }).includes('<meta:keyword'))
  eq('空 meta.xml 解析为 undefined', parseOdtMetaProps(odtMetaXml()), undefined)
  eq('空串输入不炸', parseOdtMetaProps(''), undefined)
  check('实体转义与逆解（& < > "）',
    parseOdtMetaProps(odtMetaXml({ title: 'A&B<"', description: 'x > y' })).title === 'A&B<"')
  check('属性值带尖括号不写坏 XML', odtMetaXml({ title: 'A&B<"' }).includes('A&amp;B&lt;&quot;'))
  const ext = `<?xml version="1.0"?><office:document-meta><office:meta>` +
    `<dc:title>外部标题</dc:title><dc:creator>外部作者</dc:creator></office:meta></office:document-meta>`
  eq('外部 .odt 的 meta.xml 也能读（不依赖生成器前缀声明）',
    parseOdtMetaProps(ext), { title: '外部标题', creator: '外部作者' })
  check('空白归一', parseOdtMetaProps('<dc:title>  多  空格 \n 换行 </dc:title>').title, '多 空格 换行')

  // ── ② 端到端：ODT 写出包 ─────────────────────────────────────────
  const bytes = await prosemirrorToOdtBytes(PM, { docProps: PROPS })
  const zip = await JSZip.loadAsync(bytes)
  check('写出包有 meta.xml', !!zip.file('meta.xml'))
  check('manifest 声明 meta.xml', (await zip.file('META-INF/manifest.xml').async('string')).includes('full-path="meta.xml"'))
  const metaText = await zip.file('meta.xml').async('string')
  check('meta.xml 里五格都在', ['dc:title', 'dc:subject', 'dc:creator', 'meta:keyword', 'dc:description']
    .every((t) => metaText.includes(`<${t}>`)))
  const back = await odtToHtml(bytes)
  eq('导入后 meta.docProps 与写出前一致', back.meta.docProps, PROPS)
  check('正文没被 meta.xml 带坏', back.html.includes('ODT 正文'))

  // ── ③ 真双向：用户改值再导出 ─────────────────────────────────────
  const edited = { ...PROPS, title: '改过的标题', keywords: '新关键词' }
  const bytes2 = await prosemirrorToOdtBytes(PM, { docProps: edited })
  eq('改过的五格随 .odt 往返', (await odtToHtml(bytes2)).meta.docProps, edited)
  const noProps = await prosemirrorToOdtBytes(PM)
  const noPropsZip = await JSZip.loadAsync(noProps)
  check('没设 docProps 也发合法的空 meta.xml',
    (await noPropsZip.file('meta.xml').async('string')).includes('<office:meta></office:meta>'))
  eq('没设 docProps 导入后就是 undefined', (await odtToHtml(noProps)).meta.docProps, undefined)

  // ── ④ 源码级：读写两侧接线 ───────────────────────────────────────
  const w = read('../src/lib/odt.ts')
  check('写侧补 meta.xml 部件', /zip\.file\('meta\.xml', odtMetaXml\(meta\?\.docProps\)\)/.test(w))
  check('manifest 加 meta.xml 条目', /manifest:full-path="meta\.xml"/.test(w))
  check('读侧读 meta.xml 并解析', /const metaText = \(await zip\.file\('meta\.xml'\)/.test(w)
    && /const docProps = parseOdtMetaProps\(metaText\)/.test(w))
  check('解析结果落进 DocMeta.docProps', /if \(docProps\) meta\.docProps = docProps/.test(w))
  check('解析不用动态正则', w.includes('const i = xml.indexOf(`<${tag}`)'))
  check('只发非空格', w.includes("const el = (tag: string, v?: string) => (v ? `<${tag}>${esc(v)}</${tag}>` : '')"))
}

await main()
console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
