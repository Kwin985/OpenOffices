// pptx 导入的 .rels 重复解析基准（v0.175）
//
// 改前：同一份 `slideN.xml.rels` 被解压 + 解析 3 次——
//   ① slideToDeckSlide 里形状的 r:embed（parseRels）
//   ② 主流程的单页背景图（relsText → bgOf → imageFromRid → relsEntries）
//   ③ 演讲者备注（parseNotes 里再读一次文件 → relsEntries）
// 且 ② ③ 每次调用都重新 parseXml 整棵关系树。页数一多就是稳定的固定开销。
// 改后：入口读一次、slideRelsOf 解析一次，byId / entries 两种视图三处共用。
//
// 判据取**同进程 A/B**（跨进程绝对值随机器负载浮动，不能相减）：
//   git archive 36d27e8 src/lib | tar -x -C tmp/bench-old
//   （v0.174 未改 pptx-import.ts，故 36d27e8 那份就是改前读手）
//   两腿同夹具交替顺序各 10 样本取中位，并比对「页数/标题/备注/背景」的签名。
//
// 跑法：npx vite-node scripts/bench-pptx-import.mjs

import fs from 'node:fs'
import { performance } from 'node:perf_hooks'
import JSZip from 'jszip'
import { pptxBytesToDeck } from '../src/lib/pptx-import.ts'

const P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships'

const THEME =
  `<a:theme xmlns:a="${A}"><a:themeElements><a:clrScheme name="T">` +
  `<a:dk1><a:srgbClr val="111111"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>` +
  `<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>` +
  `<a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>` +
  `<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>` +
  `<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>` +
  `<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink>` +
  `</a:clrScheme><a:fontScheme name="F"><a:majorFont><a:latin typeface="Calibri"/></a:majorFont>` +
  `<a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`

const MASTER =
  `<p:sldMaster xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}"><p:cSld><p:spTree/></p:cSld>` +
  `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2"` +
  ` accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink"` +
  ` folHlink="folHlink" dk1="dk1" lt1="lt1" dk2="dk2" lt2="lt2"/></p:sldMaster>`

const MASTER_RELS =
  `<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${R}/theme" Target="../theme/theme1.xml"/></Relationships>`

const NOTES =
  `<p:notes xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree>` +
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="N"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/>` +
  `<p:txBody><a:bodyPr/><a:p><a:r><a:t>这一页的备注</a:t></a:r></a:p></p:txBody></p:sp>` +
  `</p:spTree></p:cSld></p:notes>`

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])

function slideXml(n) {
  return `<p:sld xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}"><p:cSld>` +
    // 背景图那一支：bgOf → imageFromRid
    `<p:bg><p:bgPr><a:blipFill><a:blip r:embed="rId2"/></a:blipFill></p:bgPr></p:bg>` +
    `<p:spTree>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="T"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>` +
    `<p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>第 ${n} 页的标题</a:t></a:r></a:p></p:txBody></p:sp>` +
    // 形状图片那一支：r:embed → byId
    `<p:pic><p:nvPicPr><p:cNvPr id="3" name="P"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="rId2"/></p:blipFill>` +
    `<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm></p:spPr></p:pic>` +
    `</p:spTree></p:cSld></p:sld>`
}

const SLIDE_RELS =
  `<Relationships xmlns="${PKG}">` +
  `<Relationship Id="rId1" Type="${R}/notesSlide" Target="../notesSlides/notesSlide1.xml"/>` +
  `<Relationship Id="rId2" Type="${R}/image" Target="../media/image1.png"/>` +
  `</Relationships>`

async function fixture(pages) {
  const zip = new JSZip()
  zip.file('ppt/theme/theme1.xml', THEME)
  zip.file('ppt/slideMasters/slideMaster1.xml', MASTER)
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', MASTER_RELS)
  zip.file('ppt/notesSlides/notesSlide1.xml', NOTES)
  zip.file('ppt/media/image1.png', PNG)
  for (let i = 1; i <= pages; i++) {
    zip.file(`ppt/slides/slide${i}.xml`, slideXml(i))
    zip.file(`ppt/slides/_rels/slide${i}.xml.rels`, SLIDE_RELS)
  }
  return new Uint8Array(await zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
}

// 只比与随机 shape id 无关的字段：页数、标题、备注、背景图在场与否
const sig = (deck) => JSON.stringify(deck.slides.map((s) => ({
  title: s.title ?? '', notes: s.notes ?? '', bg: !!s.bg, image: !!s.image,
})))

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const oldPath = new URL('../tmp/bench-old/src/lib/pptx-import.ts', import.meta.url)

console.log('端到端（当前读手，预热 2 趟 + 5 趟中位）')
for (const n of [10, 40, 120]) {
  const bytes = await fixture(n)
  await pptxBytesToDeck(bytes)
  await pptxBytesToDeck(bytes)
  const times = []
  for (let r = 0; r < 5; r++) {
    const t = performance.now()
    await pptxBytesToDeck(bytes)
    times.push(performance.now() - t)
  }
  console.log(`  ${String(n).padStart(3)} 页  ${median(times).toFixed(1)}ms`)
}

if (!fs.existsSync(oldPath)) {
  console.log('\n（没有改前副本，跳过同进程 A/B：git archive 36d27e8 src/lib | tar -x -C tmp/bench-old）')
} else {
  const { pptxBytesToDeck: oldRead } = await import('../tmp/bench-old/src/lib/pptx-import.ts')
  console.log('\n同进程 A/B（A=改前 B=当前，交替顺序 + 各 10 样本取中位）')
  for (const n of [10, 120]) {
    const bytes = await fixture(n)
    await oldRead(bytes)
    await pptxBytesToDeck(bytes)
    const a = []
    const b = []
    for (let r = 0; r < 5; r++) {
      let t = performance.now()
      await oldRead(bytes)
      a.push(performance.now() - t)
      t = performance.now()
      await pptxBytesToDeck(bytes)
      b.push(performance.now() - t)
      t = performance.now()
      await pptxBytesToDeck(bytes)
      b.push(performance.now() - t)
      t = performance.now()
      await oldRead(bytes)
      a.push(performance.now() - t)
    }
    const ma = median(a)
    const mb = median(b)
    const same = sig(await oldRead(bytes)) === sig(await pptxBytesToDeck(bytes))
    console.log(`  ${String(n).padStart(3)} 页  A=${ma.toFixed(1)}ms  B=${mb.toFixed(1)}ms  降幅=${(((ma - mb) / ma) * 100).toFixed(1)}%  导入结果签名相同=${same}`)
  }
}
