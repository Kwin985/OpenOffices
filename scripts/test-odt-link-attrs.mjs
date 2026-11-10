// v0.194 断言：ODT 超链接 title / target 双向（补 D53「超链接两枚仍只在 docx 链」）。
//
// v0.191 把 docx 的 w:tooltip / w:tgtFrame 从 PM link mark 接回写出包，但 ODT
// 写手只发 xlink:href、读手只读 xlink:href——导入带提示/目标框架的 .odt 另存一次
// 这两枚就没了。ODF 的 <text:a> 有 xlink:title 与 office:target-frame-name，
// 正好与 docx 两枚同义，本轮两侧接上，与 DocEditor / PM link mark 真双向。
//
// 跑法：npx vite-node scripts/test-odt-link-attrs.mjs

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

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')
const contentOf = async (bytes) => (await JSZip.loadAsync(bytes)).file('content.xml').async('string')

const PM = (extra = {}) => ({
  type: 'doc',
  content: [{
    type: 'paragraph',
    content: [{
      type: 'text', text: '链接文字',
      marks: [{ type: 'link', attrs: { href: 'https://example.com/a?x=1&y=2', ...extra } }],
    }],
  }],
})

async function main() {
  // ── ① 端到端：写出包两枚属性 ──────────────────────────────────────
  const bytes = await prosemirrorToOdtBytes(PM({ title: '提示一', target: '_self' }))
  const content = await contentOf(bytes)
  check('content.xml 发 xlink:title', content.includes('xlink:title="提示一"'))
  check('content.xml 发 office:target-frame-name', content.includes('office:target-frame-name="_self"'))
  check('href 仍在且顺序是 type→href→title→target',
    /<text:a xlink:type="simple" xlink:href="[^"]*" xlink:title="提示一" office:target-frame-name="_self">/.test(content))
  check('href 里的 & 被 XML 转义', content.includes('a?x=1&amp;y=2'))
  const back = await odtToHtml(bytes)
  check('导入后 HTML 的 <a> 带 title / target',
    /<a href="[^"]*" title="提示一" target="_self">/.test(back.html))
  check('正文没被链接带坏', back.html.includes('链接文字'))

  // ── ② 真双向：改 mark 值再导出 ───────────────────────────────────
  const edited = await prosemirrorToOdtBytes(PM({ title: '改过的提示', target: '_blank' }))
  const editedContent = await contentOf(edited)
  check('改过的两枚写进新包',
    editedContent.includes('xlink:title="改过的提示"') && editedContent.includes('office:target-frame-name="_blank"'))
  check('旧字面没被留在包里', !editedContent.includes('提示一') && !editedContent.includes('_self'))
  const editedBack = await odtToHtml(edited)
  check('改过的两枚随 .odt 读回一致',
    editedBack.html.includes('title="改过的提示"') && editedBack.html.includes('target="_blank"'))

  // ── ③ 默认路径逐字不变 / 只发非空格 ──────────────────────────────
  const plain = await contentOf(await prosemirrorToOdtBytes(PM()))
  check('没设两枚时一个属性都不发',
    /<text:a xlink:type="simple" xlink:href="[^"]*">/.test(plain) &&
    !plain.includes('xlink:title') && !plain.includes('office:target-frame-name'))
  const onlyTitle = await contentOf(await prosemirrorToOdtBytes(PM({ title: '只有提示' })))
  check('只设一枚就只发一枚',
    onlyTitle.includes('xlink:title="只有提示"') && !onlyTitle.includes('target-frame-name'))
  check('空串不落属性',
    !onlyTitle.includes('xlink:title=""') && !onlyTitle.includes('target-frame-name=""'))

  // ── ④ 实体转义与第三方件 ─────────────────────────────────────────
  const escaped = await contentOf(await prosemirrorToOdtBytes(PM({ title: 'A&B<"', target: 'x>y' })))
  check('title 里的 & < " 被转义（不写坏 XML）',
    escaped.includes('xlink:title="A&amp;B&lt;&quot;"') && escaped.includes('office:target-frame-name="x&gt;y"'))
  const extZip = await JSZip.loadAsync(bytes)
  const extContent = (await extZip.file('content.xml').async('string'))
    .replace('xlink:title="提示一"', 'xlink:title="外部提示"')
    .replace('office:target-frame-name="_self"', 'office:target-frame-name="外部框架"')
  extZip.file('content.xml', extContent)
  const extBytes = new Uint8Array(await extZip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
  const extBack = await odtToHtml(extBytes)
  check('外部 .odt 的两枚也能读（不依赖生成器前缀）',
    extBack.html.includes('title="外部提示"') && extBack.html.includes('target="外部框架"'))

  // ── ⑤ 源码级：读写两侧接线 ──────────────────────────────────────
  const w = read('../src/lib/odt.ts')
  check('写侧从 link mark 取 title / target',
    /const link = at\('link'\)/.test(w) && /link\?\.title/.test(w) && /link\?\.target/.test(w))
  check('写侧只发非空格', /typeof link\?\.title === 'string' && link\.title/.test(w))
  check('读侧取 ODF 两枚标准属性',
    /getAttribute\('xlink:title'\)/.test(w) && /getAttribute\('office:target-frame-name'\)/.test(w))
  check('read 侧新属性走含引号转义的 esc', /\(title \? ` title="\$\{esc\(title\)\}"` : ''\)/.test(w))
  check('href 仍走原来的 escapeHtml（默认路径逐字不变）',
    /href="\$\{escapeHtml\(e\.getAttribute\('xlink:href'\) \?\? ''\)\}"/.test(w))
  check('office: 命名空间已在 content.xml 根声明', /xmlns:office="urn:oasis:names:tc:opendocument/.test(w))
}

await main()
console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
