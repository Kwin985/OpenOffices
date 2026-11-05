// docx 保真导入的解析成本基准（v0.173）
//
// 为什么单独立一份：v0.141 那轮量的是「解析器内部」的热点，这一轮量的是
// 「同一份 word/document.xml 被 parseXml 了几遍」。两者不是一回事——解析器再快，
// 对同一串字节建八棵树就是八倍的 CPU 与堆分配，而其中七棵查完即丢。
//
// 三把尺，各自独立：
//   1. 静态：产品源码里 `parseXml(documentXml)` 的出现次数（改前 8 / 改后 1）
//   2. 微基准：同一串 XML 建 8 棵树 vs 1 棵树的耗时（收益上限，不依赖产品语义）
//   3. 端到端：docxToHtmlFidelity 跑一份 N 段的最小 docx，预热后取多趟中位数
//
// 跑法：npx vite-node scripts/bench-docx-parse.mjs
// 夹具纯合成、compression=STORE，故两次运行之间唯一的变量是读手代码。
// 账本不写、产品源不改——脚本只读源文件用于静态计数。

import fs from 'node:fs'
import { performance } from 'node:perf_hooks'
import JSZip from 'jszip'
import { parseXml } from '../src/lib/ooxml.ts'
import { docxToHtmlFidelity } from '../src/lib/docx-fidelity.ts'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const THEME =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<a:theme xmlns:a="${A}"><a:themeElements><a:fontScheme>` +
  `<a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>` +
  `<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>` +
  `</a:fontScheme></a:themeElements></a:theme>`
const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/>` +
  `<w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/></w:rPr></w:style></w:styles>`

const NS = [500, 2000, 8000]
const ROUNDS = 5
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

function documentXml(n) {
  let body = ''
  for (let i = 0; i < n; i++) {
    body += `<w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="24"/></w:rPr>` +
      `<w:t>第 ${i} 段的正文，用于量解析与序列化的成本 ABC 123</w:t></w:r></w:p>`
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>` +
    `<w:cols w:num="1" w:space="425"/></w:sectPr></w:body></w:document>`
}

async function fixture(n) {
  const zip = new JSZip()
  zip.file('word/document.xml', documentXml(n))
  zip.file('word/styles.xml', STYLES)
  zip.file('word/theme/theme1.xml', THEME)
  return new Uint8Array(await zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
}

// ① 静态计数：只数「把整份 document.xml 交给 parseXml」的那一族调用
const source = fs.readFileSync(new URL('../src/lib/docx-fidelity.ts', import.meta.url), 'utf8')
const parseCalls = (source.match(/parseXml\(documentXml\)/g) ?? []).length

console.log(`产品源码里 parseXml(documentXml) 的调用点：${parseCalls}`)
console.log('')

// ② 微基准：同一串 XML 建 8 棵树 vs 1 棵树
for (const n of NS) {
  const xml = documentXml(n)
  parseXml(xml) // 预热
  const eight = []
  const one = []
  for (let r = 0; r < ROUNDS; r++) {
    let t = performance.now()
    for (let k = 0; k < 8; k++) parseXml(xml)
    eight.push(performance.now() - t)
    t = performance.now()
    parseXml(xml)
    one.push(performance.now() - t)
  }
  const e = median(eight)
  const o = median(one)
  console.log(`微基准 N=${String(n).padStart(5)}  8 树 ${e.toFixed(1)}ms  1 树 ${o.toFixed(1)}ms  比值 ${(e / o).toFixed(2)}x`)
}
console.log('')

// ③ 端到端：预热 2 趟 + 5 趟中位数
for (const n of NS) {
  const bytes = await fixture(n)
  await docxToHtmlFidelity(bytes)
  await docxToHtmlFidelity(bytes)
  const times = []
  let blocks = 0
  for (let r = 0; r < ROUNDS; r++) {
    const t = performance.now()
    const out = await docxToHtmlFidelity(bytes)
    times.push(performance.now() - t)
    blocks = out.blocks
  }
  console.log(`端到端   N=${String(n).padStart(5)}  ${median(times).toFixed(1)}ms（5 趟中位，blocks=${blocks}）`)
}

// ④ 图形密集夹具（v0.174）：每段一枚 w:pict（VML 形状 + 填充/描边/阴影/路径/公式）
// 与一枚 w:drawing（DrawingML 效果/三维/艺术字）。这两族的 note* 是按
// 「每个 pict/drawing × 每个标签 × 一次 allDesc 子树」扫的，纯文字夹具量不出来。
function graphicXml(n) {
  let body = ''
  for (let i = 0; i < n; i++) {
    body += `<w:p><w:r><w:t>图形段 ${i}</w:t>` +
      `<w:pict><v:shape id="s${i}" style="width:100pt;height:60pt" fillcolor="#ff0000" stroked="t">` +
      `<v:fill type="gradient" color2="#00ff00" rotate="t"/>` +
      `<v:stroke dashstyle="dash" startarrow="block" endarrow="block"/>` +
      `<v:shadow on="t" dir="45" dist="5pt"/>` +
      `<v:path arrowok="t" fillok="t" connecttype="rect"/>` +
      `<v:formulas><v:f eqn="sum 0 0 0"/></v:formulas>` +
      `</v:shape></w:pict>` +
      `<w:drawing><wp:inline><a:graphic><a:graphicData>` +
      `<a:prstDash val="dash"/><a:headEnd type="triangle" w="med" len="med"/>` +
      `<a:outerShdw blurRad="50800" dir="2700000" dist="38100" algn="ctr" rotWithShape="0"/>` +
      `<a:glow rad="127000"/><a:reflection blurRad="6350" stA="50000" endA="300"/>` +
      `<a:lightRig dir="t" rig="threePt"/><a:sp3d contourW="12700" extrusionH="0" prstMaterial="plastic"/>` +
      `<a:gradFill flip="none" rotWithShape="1"/><a:sizeRelH relativeFrom="page"/>` +
      `<a:wrapSquare wrapText="bothSides"/><a:prstTxWarp prst="textNoShape"/>` +
      `<a:spLocks noEditPoints="1"/><a:tint val="50000"/><a:alpha val="40000"/>` +
      `<a:custGeom><a:pathLst><a:path path="M 0 0 L 10 10"/></a:pathLst></a:custGeom>` +
      `</a:graphicData></a:graphic></wp:inline></w:drawing>` +
      `</w:r></w:p>`
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`
}

async function graphicFixture(n) {
  const zip = new JSZip()
  zip.file('word/document.xml', graphicXml(n))
  zip.file('word/styles.xml', STYLES)
  zip.file('word/theme/theme1.xml', THEME)
  return new Uint8Array(await zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
}

console.log('')
for (const n of [100, 400, 1600]) {
  const bytes = await graphicFixture(n)
  await docxToHtmlFidelity(bytes)
  await docxToHtmlFidelity(bytes)
  const times = []
  for (let r = 0; r < ROUNDS; r++) {
    const t = performance.now()
    await docxToHtmlFidelity(bytes)
    times.push(performance.now() - t)
  }
  console.log(`图形密集 N=${String(n).padStart(5)}  ${median(times).toFixed(1)}ms（5 趟中位，每段 pict+drawing 各一枚）`)
}

// ⑤ 同进程 A/B（v0.174）：把改前读手导出成副本后，两腿在同一进程、同一夹具上
// 交替跑，机器负载对两边相同；顺带逐字比对 HTML，钉住「提速没换语义」。
//   准备副本：git archive HEAD src/lib | tar -x -C tmp/bench-old
//   注意：跑这一腿时 HEAD 必须是**改前**那一笔提交；提交完本轮代码后副本要重新导出
//   才能继续做 A/B（否则两腿是同一份代码）。
const oldPath = new URL('../tmp/bench-old/src/lib/docx-fidelity.ts', import.meta.url)
if (fs.existsSync(oldPath)) {
  const { docxToHtmlFidelity: oldRead } = await import('../tmp/bench-old/src/lib/docx-fidelity.ts')
  console.log('')
  console.log('同进程 A/B（A=改前读手 B=当前读手，交替顺序 + 各 10 样本取中位）')
  for (const [label, n, make] of [
    ['纯文字', 8000, fixture],
    ['图形密集', 1600, graphicFixture],
  ]) {
    const bytes = await make(n)
    await oldRead(bytes)
    await docxToHtmlFidelity(bytes)
    const a = []
    const b = []
    for (let r = 0; r < 5; r++) {
      let t = performance.now()
      await oldRead(bytes)
      a.push(performance.now() - t)
      t = performance.now()
      await docxToHtmlFidelity(bytes)
      b.push(performance.now() - t)
      t = performance.now()
      await docxToHtmlFidelity(bytes)
      b.push(performance.now() - t)
      t = performance.now()
      await oldRead(bytes)
      a.push(performance.now() - t)
    }
    const ma = median(a)
    const mb = median(b)
    const htmlSame = (await oldRead(bytes)).html === (await docxToHtmlFidelity(bytes)).html
    console.log(`${label} N=${n}  A=${ma.toFixed(1)}ms  B=${mb.toFixed(1)}ms  降幅=${(((ma - mb) / ma) * 100).toFixed(1)}%  HTML逐字相同=${htmlSame}`)
  }
}
