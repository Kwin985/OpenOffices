// PDF 几何双实现互证（Node 侧：pnpm exec vite-node scripts/test-pdf-geo-cross.mjs）
//
// 屏幕上"这一格在哪"有两条互不依赖的实现：
//   - 我们这套：src/lib/pdf-geo.ts 的纯函数（随产品编译进前端，标注命中/盖底/写回全靠它）
//   - pdf.js 那套：pdfjs-dist 的 PageViewport（页面渲染的事实标准：
//     convertToViewportPoint / convertToPdfPoint，以及 TextLayer 自己用的
//     Util.transform(viewport, item.transform)）
// 两边对不上，意味着要么我们算错（框偏、盖歪），要么对渲染器行为的理解错了。
// 后者已经兑现过一次：旧 normRot 用"四舍五入到最近 90°"，而 pdf.js 的
// PageViewport 是 switch 精确匹配——/Rotate=45 时我们按 90° 算、页面按 0°
// 渲染，屏幕上的框会偏。现在 normRot 与渲染器逐字对齐（pdf-lib 的
// reduceRotation 同为"非 90 倍数→0"，三方一致）。
//
// 五条腿：
//   A 采样点对    9×9 网格 × 4 旋转：toDisplayRect(零尺寸矩形) ↔ convertToViewportPoint
//   B 视口尺寸    displaySize ↔ viewport.width/height
//   C 真件文字项  pdf-lib 造带 /Rotate 的件，pdfjs 读回，textItemBox 的显示盒对
//                 TextLayer 同款算法的基线起点，再走一遍写回路径的 cover 矩形往返
//   D 矩形往返    fromDisplayRect(toDisplayRect(r)) === r（播种随机 × 4 旋转）
//   E 旋转归一    normRot ↔ 渲染器有效旋转（从 vp.transform 反读），含非和规值
import { PDFDocument, PDFName, PDFNumber, StandardFonts, degrees, rgb } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import {
  displaySize,
  fromDisplayRect,
  normRot,
  textItemBox,
  toDisplayRect,
} from '../src/lib/pdf-geo'

const ok = []
const bad = []
const check = (name, cond, extra = '') => {
  ;(cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps
const ROTS = [0, 90, 180, 270]

// ── 基准：一份 612×792 的空白页，pdf.js 与 pdf-lib 对它的尺寸认知必须一致 ──
const blankDoc = await PDFDocument.create()
blankDoc.addPage([612, 792])
const blankBytes = await blankDoc.save()
const blank = await pdfjs
  .getDocument({ data: new Uint8Array(blankBytes), useSystemFonts: false })
  .promise
const blankPage = await blank.getPage(1)
const vp0 = blankPage.getViewport({ scale: 1, rotation: 0 })
const base = { w: vp0.width, h: vp0.height }
check(
  '基准页尺寸 612×792（pdf-lib 写 ↔ pdf.js 读）',
  near(base.w, 612) && near(base.h, 792),
  `${base.w}×${base.h}`,
)

// ── A 采样点对：mapPoint/unmapPoint 不导出，用零尺寸矩形走公开 API 触达
//    （viaPoint 两点相同时返回的就是 mapPoint 本身）──
{
  const xs = [0, 76.5, 153, 229.5, 306, 382.5, 459, 535.5, 612]
  const ys = [0, 99, 198, 297, 396, 495, 594, 693, 792]
  const n = xs.length * ys.length
  for (const rot of ROTS) {
    const vp = blankPage.getViewport({ scale: 1, rotation: rot })
    let fwd = 0
    let inv = 0
    for (const x of xs) {
      for (const y of ys) {
        // 我们这套吃"未旋转左上原点"；pdf.js 吃"未旋转 PDF（左下）"，先翻 y
        const ours = toDisplayRect({ x, y, w: 0, h: 0 }, rot, base)
        const [px, py] = vp.convertToViewportPoint(x, base.h - y)
        if (near(ours.x, px) && near(ours.y, py)) fwd++
        const [bx, by] = vp.convertToPdfPoint(ours.x, ours.y)
        if (near(bx, x) && near(by, base.h - y)) inv++
      }
    }
    check(`A: rot=${rot} mapPoint↔convertToViewportPoint（${n} 点）`, fwd === n, `命中 ${fwd}/${n}`)
    check(`A: rot=${rot} convertToPdfPoint 逆回未旋转点`, inv === n, `命中 ${inv}/${n}`)
  }
}

// ── B 视口尺寸 ──
for (const rot of ROTS) {
  const vp = blankPage.getViewport({ scale: 1, rotation: rot })
  const ds = displaySize(base, rot)
  check(
    `B: rot=${rot} displaySize==viewport 尺寸`,
    near(ds.w, vp.width) && near(ds.h, vp.height),
    `${ds.w}×${ds.h} vs ${vp.width}×${vp.height}`,
  )
}

// ── C 真件文字项 ──
// 两行不同字号不同位置的文字，逐行对：显示盒 vs TextLayer 同款算法的基线起点，
// 盒尺寸 vs 未旋转盒旋转后的尺寸，宽度 vs pdf-lib 独立量得的步进，
// 最后走一遍写回路径（fromDisplayRect → 翻 y）看 cover 矩形是否回到原始 pdfBox。
{
  const LINES = [
    { str: 'Hello World', x: 72, y: 700, size: 24 },
    { str: 'Second line', x: 300, y: 500, size: 18 },
  ]
  for (const rot of ROTS) {
    const d = await PDFDocument.create()
    const helv = await d.embedFont(StandardFonts.Helvetica)
    const pg = d.addPage([612, 792])
    pg.setRotation(degrees(rot))
    for (const ln of LINES) {
      pg.drawText(ln.str, { x: ln.x, y: ln.y, size: ln.size, font: helv, color: rgb(0, 0, 0) })
    }
    const bytes = await d.save()
    const loaded = await pdfjs
      .getDocument({ data: new Uint8Array(bytes), useSystemFonts: false })
      .promise
    const p = await loaded.getPage(1)
    const r = normRot(p.rotate)
    const v0 = p.getViewport({ scale: 1, rotation: 0 })
    const b = { w: v0.width, h: v0.height }
    const vp = p.getViewport({ scale: 1 }) // 显示视口：旋转取页面自己的
    const tc = await p.getTextContent()
    const items = tc.items.filter((i) => i.str && i.transform)
    check(`C: rot=${rot} 读到 ${LINES.length} 个文字项`, items.length === LINES.length, `实到 ${items.length}`)

    for (const want of LINES) {
      const it = items.find((i) => i.str === want.str)
      if (!it) {
        check(`C: rot=${rot} 找到「${want.str}」`, false)
        continue
      }
      const g = textItemBox(it.transform, it.width, it.str, r, b)
      if (!g) {
        check(`C: rot=${rot}「${want.str}」textItemBox 有产出`, false)
        continue
      }
      const tag = `C: rot=${rot}「${want.str}」`

      // 写回用的 PDF 空间坐标：直接就是 transform 的 e/f
      check(`${tag} x/y 透传 transform e/f`, near(g.x, want.x) && near(g.y, want.y), `(${g.x}, ${g.y})`)
      check(`${tag} 字号`, near(g.size, want.size), `${g.size}`)

      // 显示空间基线起点：TextLayer 自己就是这么算的（Util.transform(vp, item)）
      const tx = pdfjs.Util.transform(vp.transform, it.transform)
      const inside =
        tx[4] >= g.box.x - 1e-6 &&
        tx[4] <= g.box.x + g.box.w + 1e-6 &&
        tx[5] >= g.box.y - 1e-6 &&
        tx[5] <= g.box.y + g.box.h + 1e-6
      check(
        `${tag} 显示基线起点落在盒内`,
        inside,
        `(${tx[4].toFixed(2)}, ${tx[5].toFixed(2)}) vs 盒 (${g.box.x.toFixed(2)}, ${g.box.y.toFixed(2)}, ${g.box.w.toFixed(2)}, ${g.box.h.toFixed(2)})`,
      )
      check(
        `${tag} 显示空间字高==字号`,
        near(Math.hypot(tx[2], tx[3]), g.size),
        `${Math.hypot(tx[2], tx[3])} vs ${g.size}`,
      )

      // 盒尺寸：未旋转盒 {步进, 1.1*字号} 随旋转互换
      const adv = Math.abs(it.width ?? 0)
      const expW = r === 90 || r === 270 ? 1.1 * g.size : adv
      const expH = r === 90 || r === 270 ? adv : 1.1 * g.size
      check(
        `${tag} 盒尺寸随旋转互换`,
        near(g.box.w, expW) && near(g.box.h, expH),
        `${g.box.w.toFixed(3)}×${g.box.h.toFixed(3)} vs ${expW.toFixed(3)}×${expH.toFixed(3)}`,
      )

      // 宽度互证：pdf.js 的 item.width vs pdf-lib 独立量得的步进（两份字体 metrics）
      const libW = helv.widthOfTextAtSize(want.str, want.size)
      check(
        `${tag} item.width↔pdf-lib 步进（两份 metrics）`,
        Math.abs(adv - libW) <= 0.02 * libW,
        `pdfjs ${adv.toFixed(3)} vs pdf-lib ${libW.toFixed(3)}（差 ${((Math.abs(adv - libW) / libW) * 100).toFixed(2)}%）`,
      )

      // 写回路径往返：applyTextEdits 的 cover 矩形必须回到原始 pdfBox（PDF 左下原点）
      const u = fromDisplayRect(g.box, r, b)
      const coverY = b.h - u.y - u.h
      const pdfBox = {
        x: it.transform[4],
        y: it.transform[5] - 0.25 * g.size,
        w: adv,
        h: 1.1 * g.size,
      }
      check(
        `${tag} 写回 cover 矩形往返`,
        near(u.x, pdfBox.x) && near(coverY, pdfBox.y) && near(u.w, pdfBox.w) && near(u.h, pdfBox.h),
        `cover (${u.x.toFixed(3)}, ${coverY.toFixed(3)}, ${u.w.toFixed(3)}, ${u.h.toFixed(3)}) vs pdfBox (${pdfBox.x.toFixed(3)}, ${pdfBox.y.toFixed(3)}, ${pdfBox.w.toFixed(3)}, ${pdfBox.h.toFixed(3)})`,
      )
    }
  }
}

// ── D 矩形往返：播种随机（不靠 Math.random，跑两遍结果一致） ──
{
  let seed = 20261021
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  for (const rot of ROTS) {
    let hit = 0
    for (let i = 0; i < 200; i++) {
      const rect = { x: rnd() * 700 - 50, y: rnd() * 900 - 50, w: rnd() * 200, h: rnd() * 200 }
      const back = fromDisplayRect(toDisplayRect(rect, rot, base), rot, base)
      if (
        near(back.x, rect.x) &&
        near(back.y, rect.y) &&
        near(back.w, rect.w) &&
        near(back.h, rect.h)
      ) {
        hit++
      }
    }
    check(`D: rot=${rot} 矩形往返 200 例`, hit === 200, `命中 ${hit}/200`)
  }
}

// ── E 旋转归一：normRot ↔ 渲染器有效旋转（从 vp.transform 反读，不靠我们自己的判据） ──
// pdf-lib 的 setRotation 只收 90 倍数，非和规值直接捅页字典造件
{
  const RAW = [0, 45, 90, 135, 180, 225, 270, 315, 360, 450, 720, -45, -90, -135, -270]
  for (const raw of RAW) {
    const d = await PDFDocument.create()
    const pg = d.addPage([612, 792])
    pg.node.set(PDFName.of('Rotate'), PDFNumber.of(raw))
    const bytes = await d.save()
    const loaded = await pdfjs
      .getDocument({ data: new Uint8Array(bytes), useSystemFonts: false })
      .promise
    const p = await loaded.getPage(1)
    const vp = p.getViewport({ scale: 1 })
    const [a, b2] = vp.transform
    // rot0: [1,0,0,-1] rot90: [0,1,1,0] rot180: [-1,0,0,1] rot270: [0,-1,-1,0]
    const eff = a === 0 ? (b2 > 0 ? 90 : 270) : a < 0 ? 180 : 0
    check(
      `E: /Rotate=${raw} normRot 与渲染器一致`,
      normRot(raw) === eff && normRot(p.rotate) === eff,
      `normRot=${normRot(raw)} p.rotate=${p.rotate} 渲染器=${eff}`,
    )
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
