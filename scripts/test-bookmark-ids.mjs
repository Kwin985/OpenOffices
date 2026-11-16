// v0.186 书签 `w:id` 往返断言。
//
// 改前：写手 `new Bookmark({ id: 书签名 })`，docx 库把每枚 `w:id` 恒写成 1；
// 源件 7/9/9 三个令牌到写出包全成了 1，Word 里几枚书签同号就分不开。
// 读手其实**查问过** `w:id`（bookmarkStart/End 分支），只是没进模型——本轮把
// 查问结果扩进 `data-oo-bookmark` 载荷第二格，post-pack 按书签名栈式对位改回。
//
// 跑法：npx vite-node scripts/test-bookmark-ids.mjs

import fs from 'node:fs'
import JSZip from 'jszip'
import { parseHTML } from 'linkedom'
import { getSchema } from '@tiptap/core'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { fixtureParts } from './lib/fixture.mjs'
import { docxToHtmlFidelity } from '../src/lib/docx-fidelity.ts'
import { docxToDocMeta, pageSetupOf, patchBookmarkIds, prosemirrorToDocxBytes } from '../src/lib/docx.ts'
import { docExtensions } from '../src/lib/doc-schema.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const eq = (name, got, want) => check(name, got === want, `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

async function zipBytes(parts) {
  const z = new JSZip()
  for (const [p, c] of parts) z.file(p, c)
  return new Uint8Array(await z.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
}
async function writeDoc(parts = fixtureParts()) {
  const bytes = await zipBytes(parts)
  const fid = await docxToHtmlFidelity(bytes)
  const meta = await docxToDocMeta(bytes)
  const merged = {
    ...meta,
    ...(fid.styles?.length ? { styles: fid.styles } : {}),
    ...(fid.numbering ? { numbering: fid.numbering } : {}),
    ...(fid.section ? { page: { ...meta.page, ...pageSetupOf(fid.section) } } : {}),
  }
  const { document } = parseHTML(`<!doctype html><html><body>${fid.html}</body></html>`)
  const pmDoc = PMDOMParser.fromSchema(getSchema(docExtensions())).parse(document.body).toJSON()
  const out = await JSZip.loadAsync(await prosemirrorToDocxBytes(pmDoc, merged))
  return { fid, pmDoc, doc: await out.file('word/document.xml').async('string') }
}
const tagsOf = (xml) => [...xml.matchAll(/<w:bookmark(?:Start|End)\b[^>]*>/g)].map((m) => m[0])
const idsOf = (xml) => tagsOf(xml).map((t) => /\sw:id="([^"]*)"/.exec(t)?.[1])

// ---- 1. 读手：载荷扩成两格，w:id 没新增查问 --------------------------------
const { fid, pmDoc, doc } = await writeDoc()
{
  const payloads = [...fid.html.matchAll(/data-oo-bookmark="([^"]*)"/g)].map((m) => m[1])
  eq('读手：三枚书签都带「名字;源 id」', payloads.length, 3)
  check('读手：_Toc7 带 7', payloads.includes('_Toc7;7'))
  check('读手：跨段 _Cross 两枚都带 9', payloads.filter((p) => p === '_Cross;9').length === 2)
  eq('读手：没有残留单格载荷', payloads.filter((p) => !p.includes(';')).length, 0)
  const marks = []
  const walk = (n) => {
    for (const m of n.marks ?? []) if (m.type === 'bookmark') marks.push(m.attrs?.name)
    for (const k of n.content ?? []) walk(k)
  }
  walk(pmDoc)
  check('PM：bookmark mark 的 name 是整串载荷（零 schema 改动）', marks.includes('_Toc7;7'))
}

// ---- 2. 写出包：三对 Start/End 都回到源值 ----------------------------------
{
  const tags = tagsOf(doc)
  eq('写手：写出 6 枚 Start/End 标签', tags.length, 6)
  eq('写手：w:id 序列回到 7/9/9（不再全是 1）', idsOf(doc).join(','), '7,7,9,9,9,9')
  eq('写手：没有残留 w:id="1"', idsOf(doc).filter((x) => x === '1').length, 0)
  eq('写手：每枚标签只有一枚 w:id', tags.every((t) => (t.match(/\sw:id=/g) ?? []).length === 1), true)
  check('写手：书签名没被分号污染', tags.filter((t) => t.includes('w:name=')).every((t) => !/w:name="[^"]*;/.test(t)))
  eq('写手：Start/End 严格交替（配对没串位）', tags.map((t) => (t.includes('Start') ? 'S' : 'E')).join(''), 'SESESE')
  check('写手：跨段两枚同名书签回同一个 id（Word 才认作一枚）',
    /w:name="_Cross" w:id="9"/.test(doc) && (doc.match(/w:name="_Cross" w:id="9"/g) ?? []).length === 2)
}

// ---- 3. 变体：源 id 换一组也按名对位（不是硬编码 7/9） ---------------------
{
  const parts = fixtureParts()
  const src = parts.get('word/document.xml') ?? ''
  parts.set('word/document.xml', src.replaceAll('w:id="7"', 'w:id="21"').replaceAll('w:id="9"', 'w:id="33"'))
  const v = await writeDoc(parts)
  eq('变体：源 id 改成 21/33，写出包跟着变', idsOf(v.doc).join(','), '21,21,33,33,33,33')
}

// ---- 4. 纯函数边界：空映射 / 无 name / 孤立 End / 嵌套 / 转义 --------------
async function patched(xml, ids) {
  const bytes = await zipBytes(new Map([['word/document.xml', xml]]))
  const out = await patchBookmarkIds(bytes, new Map(Object.entries(ids)))
  return (await (await JSZip.loadAsync(out)).file('word/document.xml').async('string'))
}
{
  const plain = '<w:document><w:bookmarkStart w:name="A" w:id="1"/><w:bookmarkEnd w:id="1"/></w:document>'
  eq('纯函数：空映射原样返回', await patched(plain, {}), plain)
  eq('纯函数：按名改值，一对 Start/End 同步', idsOf(await patched(plain, { A: '7' })).join(','), '7,7')
  eq('纯函数：书签名不在映射里就不动', idsOf(await patched(plain, { B: '9' })).join(','), '1,1')
  eq('纯函数：Start 没写 w:name 就不动',
    idsOf(await patched('<w:bookmarkStart w:id="1"/><w:bookmarkEnd w:id="1"/>', { A: '7' })).join(','), '1,1')
  eq('纯函数：孤立 End（没有 Start）不凭空造令牌',
    idsOf(await patched('<w:bookmarkEnd w:id="1"/>', { A: '7' })).join(','), '1')
  const nested = '<w:bookmarkStart w:name="A" w:id="1"/><w:bookmarkStart w:name="B" w:id="1"/>' +
    '<w:bookmarkEnd w:id="1"/><w:bookmarkEnd w:id="1"/>'
  eq('纯函数：嵌套书签栈式对位（后进先出）',
    idsOf(await patched(nested, { A: '7', B: '9' })).join(','), '7,9,9,7')
  const sameName = '<w:bookmarkStart w:name="A" w:id="1"/><w:bookmarkEnd w:id="1"/>' +
    '<w:bookmarkStart w:name="A" w:id="1"/><w:bookmarkEnd w:id="1"/>'
  eq('纯函数：同名两段都回同一个源 id',
    idsOf(await patched(sameName, { A: '9' })).join(','), '9,9,9,9')
  const escaped = await patched(plain, { A: 'a&b"c' })
  check('纯函数：源 id 走 xmlAttr 转义，不写坏 XML', /w:id="a&amp;b&quot;c"/.test(escaped))
  eq('纯函数：标签没有 w:id 时不凭空追加',
    await patched('<w:bookmarkStart w:name="A"/>', { A: '7' }), '<w:bookmarkStart w:name="A"/>')
}

// ---- 5. 源码级接线 ----------------------------------------------------------
{
  const r = read('../src/lib/docx-fidelity.ts')
  const w = read('../src/lib/docx.ts')
  const s = read('../src/lib/bookmark-extension.ts')
  check('读手：wrapBookmark 生成「名字;id」两格', /data-oo-bookmark="\$\{attrEsc\(name\)\};\$\{attrEsc\(id\)\}"/.test(r))
  check('读手：w:id 复用已有查问，没有新增 attr 调用', /const id = attr\(node, 'w:id'\)/.test(r))
  check('写手：按最后一个分号拆载荷（书签名含分号也不丢）', /const cut = raw\.lastIndexOf\(';'\)/.test(w))
  check('写手：Bookmark 组件只收纯书签名', /new Bookmark\(\{ id: sp\.name, children: inner \}\)/.test(w))
  check('写手：id 登记进 DocTrack', /dt\?\.bookmarkIds\.set\(name, bmId\)/.test(w))
  check('写手：主链挂 patchBookmarkIds', /const withBm = await patchBookmarkIds\(withImg, dt\.bookmarkIds, sess\)/.test(w))
  // v0.187 主链在 withBm 后又插了 withRev（修订 id），链尾变量名会跟着轮次变；
  // 按「withBm 是下一笔的输入、后续没有绕过它」判，不钉死链尾名字
  // 链尾会随轮次增加（v0.188 又插了 withDocPr），按「逐笔接上一笔」判整条链
  // 链尾会随轮次增加（v0.187 withRev、v0.188 withDocPr、v0.189 withFf），
  // 按「逐笔接上一笔」判整条链，不钉死链尾名字
  // v0.190：链尾变量名连续三轮让断言过期，改成动态链校验——
  // 核心补丁链（withBm → withNumStart）每笔的输入必须是上一笔的输出名，
  // 以后在链中插新补丁只要接上就不再红，不钉死任何链尾名字。
  const chainOk = (src) => {
    const defs = [...src.matchAll(/^  const (with[A-Z]\w*) =/gm)].map((m) => ({ name: m[1], at: m.index ?? 0 }))
    const a = defs.findIndex((d) => d.name === 'withBm'), b = defs.findIndex((d) => d.name === 'withNumStart')
    if (a < 0 || b <= a) return false
    const core = defs.slice(a, b + 1)
    return core.every((d, i) => i === 0 || src.slice(d.at, i + 1 < core.length ? core[i + 1].at : d.at + 600).includes(core[i - 1].name))
  }
  check('写手：withBm 是主链上的一笔', /const withBm = await patchBookmarkIds\(withImg,/.test(w))
  check('写手：核心补丁链逐笔接上一笔（动态校验）', chainOk(w))
  check('写手：Start 压栈 / End 弹栈', /if \(isStart\) stack\.push\(want\)/.test(w) && /stack\.pop\(\)/.test(w))
  check('schema：注释改成「w:id 随载荷往返」，不再说库会重排', /按名回填源值/.test(s))
}

console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
