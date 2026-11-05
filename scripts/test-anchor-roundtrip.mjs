// v0.177 浮动图（wp:anchor）整族往返断言。
//
// 此前读手把这十枚属性读出来存进 data-img 载荷，注释却写「包没有 wp:anchor 的槽」，
// 于是写手一律发内嵌图，往返账上 anchor|* 十对全在 lost。翻 docx 的 .d.ts 才发现
// CoreImageOptions 有 floating 原生槽（教训 11 的又一次应验）。
//
// 这份测试走**完整链路**：夹具 docx → 读手 HTML → TipTap schema → PM → 写手 → 解包，
// 逐枚对撞 wp:anchor 的属性；同时钉住「inline 图没被误伤」。
//
// 跑法：npx vite-node scripts/test-anchor-roundtrip.mjs

import fs from 'node:fs'
import JSZip from 'jszip'
import { parseHTML } from 'linkedom'
import { getSchema } from '@tiptap/core'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { fixtureParts } from './lib/fixture.mjs'
import { docxToHtmlFidelity } from '../src/lib/docx-fidelity.ts'
import { docxToDocMeta, prosemirrorToDocxBytes } from '../src/lib/docx.ts'
import { docExtensions } from '../src/lib/doc-schema.ts'
import { parseImgPayload } from '../src/lib/cell-style.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => {
  ;(cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
}
const eq = (name, got, want) => check(name, got === want, `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)

// ---- 1. 源包 → 读手 HTML -------------------------------------------------
const srcZip = new JSZip()
for (const [p, c] of fixtureParts()) srcZip.file(p, c)
const srcBytes = new Uint8Array(await srcZip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
const fid = await docxToHtmlFidelity(srcBytes)

const shells = [...fid.html.matchAll(/<img[^>]*data-img="([^"]*)"/g)].map((m) => m[1])
const anchorShells = shells.filter((s) => parseImgPayload(s).anKind === 'anchor')
check('读手：至少一枚浮动图标了 anKind=anchor', anchorShells.length > 0, `载荷数=${shells.length}`)
if (anchorShells.length) {
  const kv = parseImgPayload(anchorShells[0])
  eq('读手：relativeHeight 按数值存（不是 onOff）', kv.anRelH, '1')
  eq('读手：四边避让原值', [kv.distT, kv.distB, kv.distL, kv.distR].join(','), '0,0,114300,114300')
  eq('读手：位置基准', [kv.posH, kv.posV].join(','), 'page,margin')
  eq('读手：六枚闸门', [kv.anOver, kv.anBehind, kv.anCell, kv.anLocked, kv.anSimple].join(','), '1,0,1,0,0')
}

// ---- 2. HTML → PM → 写手 -------------------------------------------------
const schema = getSchema(docExtensions())
const { document } = parseHTML(`<!doctype html><html><body>${fid.html}</body></html>`)
const pmDoc = PMDOMParser.fromSchema(schema).parse(document.body).toJSON()
const meta = await docxToDocMeta(srcBytes)
const outBytes = await prosemirrorToDocxBytes(pmDoc, meta)
const outXml = await (await JSZip.loadAsync(outBytes)).file('word/document.xml').async('string')

const anchors = [...outXml.matchAll(/<wp:anchor\b([^>]*)>/g)].map((m) => m[1])
const inlines = [...outXml.matchAll(/<wp:inline\b([^>]*)>/g)].map((m) => m[1])
check('写手：真的发出 wp:anchor', anchors.length > 0, `anchor=${anchors.length} inline=${inlines.length}`)
check('写手：内嵌图没有被误伤', inlines.length > 0)

if (anchors.length) {
  const attrs = (name) => new RegExp(`\\b${name}="([^"]*)"`).exec(anchors[0])?.[1]
  // 十枚源值逐枚对撞（夹具里的 wp:anchor 见 fixture.mjs 第 238-239 行）
  const want = {
    distT: '0', distB: '0', distL: '114300', distR: '114300',
    simplePos: '0', allowOverlap: '1', behindDoc: '0', layoutInCell: '1',
    locked: '0', relativeHeight: '1',
  }
  for (const [k, v] of Object.entries(want)) eq(`写手：wp:anchor/@${k} 原值`, attrs(k), v)
  const sp = /<wp:simplePos\b([^>]*)\/>/.exec(outXml)?.[1] ?? ''
  eq('写手：wp:simplePos/@x 按载荷回填', /\bx="([^"]*)"/.exec(sp)?.[1], '360')
  eq('写手：wp:simplePos/@y 按载荷回填', /\by="([^"]*)"/.exec(sp)?.[1], '720')
  const posH = /<wp:positionH\b([^>]*)>/.exec(outXml)?.[1] ?? ''
  const posV = /<wp:positionV\b([^>]*)>/.exec(outXml)?.[1] ?? ''
  eq('写手：positionH/@relativeFrom', /relativeFrom="([^"]*)"/.exec(posH)?.[1], 'page')
  eq('写手：positionV/@relativeFrom', /relativeFrom="([^"]*)"/.exec(posV)?.[1], 'margin')
}

// ---- 3. 源码接线（漏接不报错）---------------------------------------------
{
  const reader = fs.readFileSync(new URL('../src/lib/docx-fidelity.ts', import.meta.url), 'utf8')
  const writer = fs.readFileSync(new URL('../src/lib/docx.ts', import.meta.url), 'utf8')
  const style = fs.readFileSync(new URL('../src/lib/cell-style.ts', import.meta.url), 'utf8')
  check('接线：读手按 anchor 元素标种类', reader.includes('kv.anKind = \'anchor\''))
  check('接线：relativeHeight 走 attr 单漏斗、数值解析（不碰 attrL，变异腿才不动）',
    reader.includes("const relRaw = attr(anchorEl, 'relativeHeight')") &&
      !reader.includes("attrNum(anchorEl, 'relativeHeight')"))
  check('接线：写手传 floating', writer.includes('...(floating ? { floating } : {})'))
  check('接线：补丁按载荷回填 anchor 属性', writer.includes("retag(chunk, 'wp:anchor', an)"))
  check('接线：anRelH 已退出 onOff 闸门', !/IMG_ONOFF_KEYS[\s\S]{0,300}'anRelH'/.test(style))
}

console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
