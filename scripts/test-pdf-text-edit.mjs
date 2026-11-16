// 原地改字的端到端验证（Node 侧，不依赖 Tauri）
//
// 查四件事：
//   1. 新文字真的落在原基线上（用 pdfjs 把 transform 读回来对坐标）
//   2. 原文字没有被"删掉"——PDF 里盖一块底色不等于删字，内容流里它还在（这是特性不是 bug：
//      所有 PDF 编辑器都这么干，界面上也这么说）
//   3. 中文字体真能 subset 嵌进去，且落盘只多几 KB
//   4. 竖排文字：textItemBox 给出贴文字方向的盒（盖底盖住整根字列），
//      写回按横排画在起点——这是已知代价，本腿钉住它，免得将来悄悄变样
import fs from 'node:fs'
import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { textItemBox, fromDisplayRect } from '../src/lib/pdf-geo'

const ok = []
const bad = []
const check = (name, cond, extra = '') => {
  ;(cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
}

// ── 1. 造一份基准 PDF：左下原点 (72, 700) 处写 "Hello World"，字号 24 ──
const base = await PDFDocument.create()
base.registerFontkit(fontkit)
const helv = await base.embedFont(StandardFonts.Helvetica)
const bp = base.addPage([612, 792])
bp.drawText('Hello World', { x: 72, y: 700, size: 24, font: helv, color: rgb(0, 0, 0) })
const baseBytes = await base.save()

// ── 2. 按 applyTextEdits 的逻辑改它 ──
const doc = await PDFDocument.load(baseBytes, { updateMetadata: false })
doc.registerFontkit(fontkit)
const page = doc.getPages()[0]
const W = page.getWidth()
const H = page.getHeight()
// 覆盖盒：原文那片（左上原点 (72, 792-700-24*1.1) → PDF 左下）
page.drawRectangle({
  x: 72,
  y: H - (792 - 700 - 24 * 1.1) - 24 * 1.1,
  width: 200,
  height: 24 * 1.1,
  color: rgb(1, 1, 1),
})
page.drawText('Goodbye', { x: 72, y: 700, size: 24, font: helv, color: rgb(0, 0, 0) })
const outBytes = await doc.save()

// ── 3. 用 pdfjs 读回来验 ──
const loaded = await pdfjs.getDocument({ data: new Uint8Array(outBytes), useSystemFonts: false }).promise
const p1 = await loaded.getPage(1)
const tc = await p1.getTextContent()
const items = tc.items.filter((i) => i.str && i.str.trim())
const strs = items.map((i) => i.str)
check('新文字在内容流里', strs.includes('Goodbye'), `读到 ${JSON.stringify(strs)}`)
check('原文字仍在内容流里（盖住≠删掉）', strs.includes('Hello World'))

const gw = items.find((i) => i.str === 'Goodbye')
check('新文字拿得到 transform', !!gw)
if (gw) {
  check(
    '新文字落在原基线 (72, 700)',
    Math.abs(gw.transform[4] - 72) < 0.01 && Math.abs(gw.transform[5] - 700) < 0.01,
    `读到 (${gw.transform[4].toFixed(2)}, ${gw.transform[5].toFixed(2)})`,
  )
  check('字号仍是 24', Math.abs(Math.hypot(gw.transform[2], gw.transform[3]) - 24) < 0.01)
}

// ── 4. 中文字体 subset ──
const fontPath = 'C:/Windows/Fonts/simhei.ttf'
if (!fs.existsSync(fontPath)) {
  check('系统有 simhei.ttf（这台机器没有，跳过字体验证）', false, fontPath)
} else {
  const fontBytes = new Uint8Array(fs.readFileSync(fontPath))
  const d2 = await PDFDocument.load(baseBytes, { updateMetadata: false })
  d2.registerFontkit({
    ...fontkit,
    create: (bytes, name) => {
      const f = fontkit.create(bytes, name)
      const m = f
      if (m && Array.isArray(m.fonts) && m.fonts.length) return m.fonts[0]
      return f
    },
  })
  const cjk = await d2.embedFont(fontBytes, { subset: true })
  const pg2 = d2.getPages()[0]
  pg2.drawText('中文改字测试', { x: 72, y: 600, size: 24, font: cjk, color: rgb(0, 0, 0) })
  const out2 = await d2.save()
  check('中文字体嵌得进去', out2.length > baseBytes.length)
  const grow = out2.length - baseBytes.length
  check(
    '子集后只多用几 KB（整份 simhei 有 9.7MB）',
    grow < 200_000,
    `多了 ${(grow / 1024).toFixed(1)} KB`,
  )
  const l2 = await pdfjs.getDocument({ data: new Uint8Array(out2), useSystemFonts: false }).promise
  const t2 = await (await l2.getPage(1)).getTextContent()
  check(
    '嵌了中文字体的文件 pdfjs 照样打得开',
    t2.items.some((i) => i.str && i.str.includes('中文')),
    JSON.stringify(t2.items.map((i) => i.str).filter(Boolean)),
  )
}

// ── 5. 竖排文字：盒贴文字方向，写回按横排画在起点（已知代价） ──
// textItemBox 对旋转文字矩阵换轴（互证见 test-pdf-geo-cross.mjs 的 F 腿）；
// 这里端到端走一遍 PdfViewer → applyTextEdits 的同款路径：盖底矩形盖住整根
// 字列、新文字落在原起点。方向保持（drawText 带 rotate）是下一档，没做之前
// 由本腿把"现在按横排画"钉住
{
  const vdoc = await PDFDocument.create()
  const vhelv = await vdoc.embedFont(StandardFonts.Helvetica)
  const vpg = vdoc.addPage([612, 792])
  // pdf-lib 的 rotate -90° 发真 Tm [0,-s,s,0]：文字向下、字头朝右
  vpg.drawText('Vertical', {
    x: 300,
    y: 500,
    size: 24,
    font: vhelv,
    rotate: degrees(-90),
    color: rgb(0, 0, 0),
  })
  const vBytes = await vdoc.save()
  const vLoaded = await pdfjs
    .getDocument({ data: new Uint8Array(vBytes), useSystemFonts: false })
    .promise
  const vIt = (await (await vLoaded.getPage(1)).getTextContent()).items.find((i) => i.str === 'Vertical')
  check('竖排项读得回来', !!vIt)
  const g = vIt ? textItemBox(vIt.transform, vIt.width, vIt.str, 0, { w: 612, h: 792 }) : null
  check('竖排项拿得到盒', !!g)
  if (g) {
    const adv = Math.abs(vIt.width)
    check(
      '竖排盒贴文字方向（窄 1.1×字号 × 高 步进）',
      Math.abs(g.box.w - 1.1 * 24) < 0.01 && Math.abs(g.box.h - adv) < 0.01,
      `${g.box.w.toFixed(2)}×${g.box.h.toFixed(2)}`,
    )
    // 写回：applyTextEdits 同款两步——盖底矩形 + 新文字画回起点
    const vEdit = await PDFDocument.load(vBytes, { updateMetadata: false })
    const vPage = vEdit.getPages()[0]
    const u = fromDisplayRect(g.box, 0, { w: 612, h: 792 })
    vPage.drawRectangle({
      x: u.x,
      y: 792 - u.y - u.h,
      width: u.w,
      height: u.h,
      color: rgb(1, 1, 1),
    })
    vPage.drawText('New', { x: g.x, y: g.y, size: g.size, font: vhelv, color: rgb(0, 0, 0) })
    const vOut = await vEdit.save()
    const vBack = await pdfjs
      .getDocument({ data: new Uint8Array(vOut), useSystemFonts: false })
      .promise
    const vItems = (await (await vBack.getPage(1)).getTextContent()).items.filter((i) => i.str)
    const vNew = vItems.find((i) => i.str === 'New')
    check('竖排改字：新文字落在原起点 (300, 500)', !!vNew && Math.abs(vNew.transform[4] - 300) < 0.01 && Math.abs(vNew.transform[5] - 500) < 0.01, vNew ? `(${vNew.transform[4].toFixed(2)}, ${vNew.transform[5].toFixed(2)})` : '没读到')
    check(
      '竖排改字：新文字按横排画（已知代价，方向保持是下一档）',
      !!vNew && Math.abs(vNew.transform[0] - 24) < 0.01 && Math.abs(vNew.transform[2]) < 0.01,
      vNew ? `Tm 前四元 [${vNew.transform.slice(0, 4).map((n) => n.toFixed(1)).join(', ')}]` : '没读到',
    )
    check('竖排改字：原文字仍在（盖住≠删掉）', vItems.some((i) => i.str === 'Vertical'))
  }
}

console.log(`\n通过 ${ok.length} 项：`)
for (const s of ok) console.log('  ✓', s)
if (bad.length) {
  console.log(`\n失败 ${bad.length} 项：`)
  for (const s of bad) console.log('  ✗', s)
  process.exit(1)
}
console.log('\n全部通过')
