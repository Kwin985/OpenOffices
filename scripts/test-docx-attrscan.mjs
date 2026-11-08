// v0.187 写手补丁链「最后三处循环内动态正则」断言。
//
// v0.186 已收掉 `tagWithAttrs` / `retag`，本轮把 `mergeTagAttrs`、
// `patchStyleIndZeros`、`pprOrder` 剩下的 `new RegExp(...)` 换成共用的
// `hasAttrNamed`。旧算法原样留在 `legacyAttrScan:true` 对照腿。
//
// 跑法：npx vite-node scripts/test-docx-attrscan.mjs

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
  check('入口 opts 多一枚 legacyAttrScan', /legacyAttrScan\?: boolean/.test(src) && /legacyAttrScan = !!opts\?\.legacyAttrScan/.test(src))
  check('共享 helper 用字符串定位 + 空白收边', /function hasAttrNamed\(/.test(src) && /tag\[at - 1\] <= ' '/.test(src))
  check('三处产品路径都不再编译动态正则',
    !/new RegExp/.test(body('mergeTagAttrs').replace(/if \(legacyAttrScan\)[\s\S]*?continue/, ''))
      && !/new RegExp/.test(body('patchStyleIndZeros').replace(/legacyAttrScan[\s\S]{0,140}hasAttrNamed/, ''))
      && /hasAttrNamed\(tag, `w:\$\{m\[1\]\}`\)/.test(body('pprOrder')))
  check('改前算法原样留在三个对照腿分支',
    (src.match(/legacyAttrScan/g) ?? []).length >= 4
      && /if \(legacyAttrScan\) \{[\s\S]{0,180}new RegExp/.test(src))
  check('pprOrder 与 patchStyleIndZeros 都走共享 helper',
    /hasAttrNamed\(tag, `w:\$\{m\[1\]\}`\)/.test(src) && /hasAttrNamed\(ind\[0\], a\.trim\(\)\.split\('='\)\[0\]\)/.test(src))
}

// ---- 2. 纯函数两腿对撞（属性存在判定） --------------------------------------
const legacyHas = (tag, name) => new RegExp(`\\s${name}=`).test(tag)
const fastHas = (tag, name) => {
  const needle = `${name}=`
  let at = tag.indexOf(needle)
  while (at >= 0) {
    if (at > 0 && tag[at - 1] <= ' ') return true
    at = tag.indexOf(needle, at + needle.length)
  }
  return false
}
{
  const cases = [
    ['已有属性', '<w:ind w:left="0"/>', 'w:left', true],
    ['第二枚属性', '<w:ind w:left="0" w:right="0"/>', 'w:right', true],
    ['属性不存在', '<w:rPr/>', 'w:left', false],
    ['data- 前缀同名不算', '<w:rPr data-w:left="1"/>', 'w:left', false],
    ['tab 收边', '<w:rPr\tw:color="ff0000"/>', 'w:color', true],
    ['换行收边', '<w:rPr\nw:sz="22"/>', 'w:sz', true],
    ['同前缀元素名不算属性', '<w:leftFoo/>', 'w:left', false],
    ['无前缀属性', '<wp:docPr id="7" name="图片 1" descr="画布级替代文本"/>', 'descr', true],
    ['单字符属性名', '<a:srcRect t="0" r="0" b="0" l="0"/>', 'l', true],
  ]
  for (const [name, tag, attr, want] of cases) {
    eq(`等价：${name} — 改前`, legacyHas(tag, attr), want)
    eq(`等价：${name} — 本轮`, fastHas(tag, attr), want)
  }
}

// ---- 3. 产品入口两腿：逐部件归一后逐字相同 ----------------------------------
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
  const partsSig = async (opts) => {
    const zip = await JSZip.loadAsync(await prosemirrorToDocxBytes(pmDoc, merged, opts))
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort()
    const out = []
    for (const n of names) {
      const text = await zip.file(n).async('string')
      // 与 bench 同一套归一：core.xml 的时间戳两次调用天然不同，不参与比较
      const clean = n === 'docProps/core.xml'
        ? text.replace(/(<dcterms:(?:created|modified)[^>]*>)[^<]*(<\/dcterms:)/g, '$1TS$2')
        : norm(text)
      out.push(`${n}\u0000${clean}`)
    }
    return out.join('\u0001')
  }
  eq('产品入口：对照腿与本轮腿逐部件字符串归一后逐字相同',
    await partsSig(), await partsSig({ legacyAttrScan: true }))
}

console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
