// v0.186 写手 `tagWithAttrs` / `retag` 零动态正则断言。
//
// 改前：两处每次调用都 `new RegExp(...)` 现编译，图片壳补丁一个 drawing 就要走
// 十几枚。改后纯字符串定位。改前算法原样留在产品源里当 A/B 对照腿
// （`legacyRetag` 开关），这里逐形状对撞，并把一处**语义修正**单独列出。
//
// 跑法：npx vite-node scripts/test-docx-retag.mjs

import fs from 'node:fs'
import JSZip from 'jszip'
import { parseHTML } from 'linkedom'
import { getSchema } from '@tiptap/core'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { fixtureParts } from './lib/fixture.mjs'
import { docxToHtmlFidelity } from '../src/lib/docx-fidelity.ts'
import { docxToDocMeta, pageSetupOf, prosemirrorToDocxBytes } from '../src/lib/docx.ts'
import { docExtensions } from '../src/lib/doc-schema.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const eq = (name, got, want) => check(name, got === want, `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

// ---- 1. 源码级纪律 ----------------------------------------------------------
{
  const src = read('../src/lib/docx.ts')
  const body = (name) => {
    const at = src.indexOf(`function ${name}(`)
    const end = src.indexOf('\n/**', at)
    return src.slice(at, end < 0 ? undefined : end)
      .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  }
  check('入口 opts 多一枚 legacyRetag（只给对照腿）', /legacyRetag\?: boolean/.test(src) && /legacyRetag = !!opts\?\.legacyRetag/.test(src))
  check('tagWithAttrs 函数体里没有 new RegExp', !/new RegExp/.test(body('tagWithAttrs')))
  check('retag 函数体里没有 new RegExp', !/new RegExp/.test(body('retag')))
  check('新版走字符串定位', /out\.indexOf\(needle\)/.test(body('tagWithAttrs')) && /chunk\.indexOf\(needle\)/.test(body('retag')))
  check('改前算法原样留成对照腿', /function legacyTagWithAttrs\(/.test(src) && /function legacyRetagChunk\(/.test(src))
  check('命名边界：`<wp:inlineX` 不算命中', /c <= ' '/.test(body('retag')))
  check('不误命中 data- 前缀的同名属性', /out\[at - 1\] <= ' '/.test(body('tagWithAttrs')))
}

// ---- 2. 两腿逐形状对撞（产品改前算法复刻 vs 字符串定位） --------------------
const legacyTagWithAttrs = (tag, kv) => {
  let out = tag
  for (const k of Object.keys(kv)) {
    const v = kv[k]
    if (!v) continue
    const re = new RegExp(`(\\s${k}=)"[^"]*"`)
    if (re.test(out)) { out = out.replace(re, `$1"${v}"`); continue }
    const m = /^(.*?)(\/?)>$/.exec(out)
    if (!m) continue
    out = `${m[1]} ${k}="${v}"${m[2]}>`
  }
  return out
}
const fastTagWithAttrs = (tag, kv) => {
  let out = tag
  for (const k of Object.keys(kv)) {
    const v = kv[k]
    if (!v) continue
    const needle = `${k}="`
    let at = out.indexOf(needle)
    while (at >= 0 && !(at > 0 && out[at - 1] <= ' ')) at = out.indexOf(needle, at + needle.length)
    if (at >= 0) {
      const q = out.indexOf('"', at + needle.length)
      if (q < 0) continue
      out = out.slice(0, at + needle.length) + v + out.slice(q)
      continue
    }
    const gt = out.lastIndexOf('>')
    if (gt < 0) continue
    const slash = gt > 0 && out[gt - 1] === '/' ? '/' : ''
    const cut = slash ? gt - 1 : gt
    out = out.slice(0, cut) + ` ${k}="${v}"` + slash + out.slice(gt)
  }
  return out
}
const legacyRetag = (chunk, tag, kv) => {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?/?>`).exec(chunk)
  if (!m) return chunk
  return chunk.slice(0, m.index) + legacyTagWithAttrs(m[0], kv) + chunk.slice(m.index + m[0].length)
}
const fastRetag = (chunk, tag, kv) => {
  const needle = `<${tag}`
  let at = chunk.indexOf(needle)
  while (at >= 0) {
    const c = chunk[at + needle.length]
    if (c !== undefined && (c === '>' || c === '/' || c <= ' ')) break
    at = chunk.indexOf(needle, at + needle.length)
  }
  if (at < 0) return chunk
  const end = chunk.indexOf('>', at)
  if (end < 0) return chunk
  return chunk.slice(0, at) + fastTagWithAttrs(chunk.slice(at, end + 1), kv) + chunk.slice(end + 1)
}

{
  const cases = [
    ['已有属性改值', '<wp:inline distT="0"/>', 'wp:inline', { distT: '1' }],
    ['没有就追加属性', '<wp:docPr id="1"/>', 'wp:docPr', { name: '图片 1' }],
    ['自闭合追加保留 /', '<a:srcRect/>', 'a:srcRect', { t: '1', r: '2' }],
    ['有内容标签', '<pic:spPr bwMode="auto"><a:xfrm/></pic:spPr>', 'pic:spPr', { bwMode: 'gray' }],
    ['前缀相似不算命中', '<wp:inlineX distT="0"/><wp:inline distT="0"/>', 'wp:inline', { distT: '9' }],
    ['tab 空白', '<wp:inline\tdistT="0"/>', 'wp:inline', { distT: '3' }],
    ['换行空白', '<wp:inline\ndistT="0"/>', 'wp:inline', { distT: '4' }],
    ['data- 前缀同名不误命中', '<w:x data-id="1"/>', 'w:x', { id: '7' }],
    ['空 kv 原样', '<a:blip cstate="none"/>', 'a:blip', {}],
    ['多属性一次改', '<a:xfrm rot="0" flipH="0" flipV="0"/>', 'a:xfrm', { rot: '1', flipH: '1', flipV: '1' }],
    ['标签不存在原样', '<w:p/>', 'wp:inline', { distT: '1' }],
    ['只改第一枚同名标签', '<a:off x="0"/><a:off x="0"/>', 'a:off', { x: '9' }],
  ]
  for (const [name, chunk, tag, kv] of cases) {
    const a = legacyRetag(chunk, tag, kv), b = fastRetag(chunk, tag, kv)
    eq(`等价：${name}`, b, a)
  }
  const a = legacyTagWithAttrs('<w:t a="1"/>', { b: '2', c: '3' })
  const b = fastTagWithAttrs('<w:t a="1"/>', { b: '2', c: '3' })
  eq('等价：连续追加两枚属性', b, a)
}

// ---- 3. 一处语义修正，单独列出（不算性能收益） ------------------------------
{
  // 改前 `out.replace(re, '$1"'+v+'"')` 把值里的 `$&` 当替换模式展开，会写出坏件；
  // 本轮字符串拼接按字面写入。真实载荷里 descr 是用户文本，可能带 `$`。
  const tag = '<pic:cNvPr descr="old"/>'
  const v = 'A$&B'
  const legacy = legacyTagWithAttrs(tag, { descr: v })
  const fast = fastTagWithAttrs(tag, { descr: v })
  check('改前把 $& 当替换模式展开（写出坏件）', !legacy.includes('A$&B') && legacy.includes('descr="A'))
  check('本轮按字面写入 $&（修掉这处隐患）', fast.includes('descr="A$&B"'))
  check('两腿在这一形状上不同——如实记为语义修正，不混进性能数字', legacy !== fast)
}

// ---- 4. 产品入口：两腿同源、逐部件归一后逐字相同 ----------------------------
{
  const z = new JSZip()
  for (const [p, c] of fixtureParts()) z.file(p, c)
  const bytes = new Uint8Array(await z.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
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
  const norm = (s) => s.replace(/\brId(?=[0-9]*[A-Za-z_-])[A-Za-z0-9_-]+/g, 'rIdRAND')
  const docXml = async (opts) => {
    const out = await JSZip.loadAsync(await prosemirrorToDocxBytes(pmDoc, merged, opts))
    return norm(await out.file('word/document.xml').async('string'))
  }
  eq('产品入口：对照腿与本轮腿 document.xml 逐字相同', await docXml(), await docXml({ legacyRetag: true }))
}

console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
