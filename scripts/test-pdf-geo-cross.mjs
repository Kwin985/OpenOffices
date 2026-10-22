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
// 六条腿：
//   A 采样点对    9×9 网格 × 4 旋转：toDisplayRect(零尺寸矩形) ↔ convertToViewportPoint
//   B 视口尺寸    displaySize ↔ viewport.width/height
//   C 真件文字项  pdf-lib 造带 /Rotate 的件，pdfjs 读回，textItemBox 的显示盒对
//                 TextLayer 同款算法的基线起点，再走一遍写回路径的 cover 矩形往返
//   D 矩形往返    fromDisplayRect(toDisplayRect(r)) === r（播种随机 × 4 旋转）
//   E 旋转归一    normRot ↔ 渲染器有效旋转（从 vp.transform 反读），含非和规值
//   F 竖排/斜排   pdf-lib 的 rotate 走 rotateAndSkewTextRadiansAndTranslate 发真 Tm
//                 （不是画布变换）：同一串文字横排/竖排向下/竖排向上/斜排各画一遍，
//                 验 textItemBox 的盒跟着文字方向换轴
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

// ── F 竖排/斜排文字项：盒跟着文字方向换轴 ──
// pdf-lib 的 drawText rotate 不是画布变换，是 rotateAndSkewTextRadiansAndTranslate
// 发出的真 Tm（[cos,sin,-sin,cos,x,y] × 字号）。实证过的方向语义：
//   rotate 0    → Tm=[s,0,0,s]    横排，步进 +x、字身 +y
//   rotate -90° → Tm=[0,-s,s,0]   竖排文字向下、字头朝右（步进 -y、字身 +x）
//   rotate +90° → Tm=[0,s,-s,0]   竖排文字向上、字头朝左
//   rotate 30°  → 斜排（步进与字身都斜）
// 每条断言都从渲染器自己的量出发（Util.transform 后的 tx = TextLayer 同款），
// 不拿 textItemBox 的中间量自证：
//   - 基线起点落在盒内，且贴在步进侧的起步边缘上（竖排向下在顶边、向上在底边、
//     横排在左边），距字身侧（下沉侧）边缘 0.25×size——"字头朝哪"由这个 inset 体现
//   - 盒尺寸 = 1.1×size × 步进，随页旋转互换；面积与页旋转无关
//   - 真盒四角（本腿按 transform 独立算的）全部含在 AABB 内
//   - width 方向无关：同一串文字横排与竖排，pdf.js 报出同一个步进
//   - 写回 cover 矩形往返（applyTextEdits 那条路）回到 PDF 空间的真盒 AABB
{
  const inside = (x, y, r) => x >= r.x - 1e-6 && x <= r.x + r.w + 1e-6 && y >= r.y - 1e-6 && y <= r.y + r.h + 1e-6
  // 真盒四角（PDF 空间）：起点/步进终点 × 字身方向 [-0.25s, +0.85s]。
  // 与 textItemBox 同一副模型，但在这里独立算一遍——验的是"AABB 含得住真盒"
  const trueCorners = (t, w, size) => {
    const al = Math.hypot(t[0], t[1])
    const ux = al > 0 ? t[0] / al : 1
    const uy = al > 0 ? t[1] / al : 0
    const vx = t[2] / size
    const vy = t[3] / size
    const pts = []
    for (const step of [0, w]) {
      for (const off of [-0.25 * size, 0.85 * size]) {
        pts.push([t[4] + step * ux + off * vx, t[5] + step * uy + off * vy])
      }
    }
    return pts
  }
  const CASES = [
    { tag: '横排对照', str: 'Vertical', x: 72, y: 700, rotate: 0 },
    { tag: '竖排向下', str: 'Vertical', x: 300, y: 500, rotate: -90 },
    { tag: '竖排向上', str: 'Vertical', x: 450, y: 500, rotate: 90 },
    { tag: '斜排30°', str: 'Skewed', x: 72, y: 400, rotate: 30 },
  ]
  for (const rot of ROTS) {
    const d = await PDFDocument.create()
    const helv = await d.embedFont(StandardFonts.Helvetica)
    const pg = d.addPage([612, 792])
    pg.setRotation(degrees(rot))
    for (const c of CASES) {
      pg.drawText(c.str, {
        x: c.x,
        y: c.y,
        size: 24,
        font: helv,
        rotate: degrees(c.rotate),
        color: rgb(0, 0, 0),
      })
    }
    const bytes = await d.save()
    const loaded = await pdfjs
      .getDocument({ data: new Uint8Array(bytes), useSystemFonts: false })
      .promise
    const p = await loaded.getPage(1)
    const r = normRot(p.rotate)
    const v0 = p.getViewport({ scale: 1, rotation: 0 })
    const b = { w: v0.width, h: v0.height }
    const vp = p.getViewport({ scale: 1 })
    const tc = await p.getTextContent()
    const items = tc.items.filter((i) => i.str && i.transform)
    check(`F: rot=${rot} 读到 ${CASES.length} 个文字项`, items.length === CASES.length, `实到 ${items.length}`)
    if (items.length !== CASES.length) continue

    const byCase = CASES.map((c) => ({
      c,
      it: items.find((i) => i.str === c.str && Math.abs(i.transform[4] - c.x) < 0.01),
    }))

    // width 方向无关：横排与竖排向下是同一串文字，pdf.js 报的步进必须相同
    const hItem = byCase[0].it
    const vItem = byCase[1].it
    check(
      `F: rot=${rot} width 方向无关（横排↔竖排同一串）`,
      near(hItem.width, vItem.width),
      `横排 ${hItem.width.toFixed(3)} vs 竖排 ${vItem.width.toFixed(3)}`,
    )

    for (const { c, it } of byCase) {
      if (!it) {
        check(`F: rot=${rot} 找到「${c.tag}」`, false)
        continue
      }
      const g = textItemBox(it.transform, it.width, it.str, r, b)
      if (!g) {
        check(`F: rot=${rot}「${c.tag}」textItemBox 有产出`, false)
        continue
      }
      const tag = `F: rot=${rot}「${c.tag}」`
      const tx = pdfjs.Util.transform(vp.transform, it.transform)
      const adv = Math.abs(it.width ?? 0)
      const axisAligned = c.tag !== '斜排30°'

      check(`${tag} size==24`, near(g.size, 24), `${g.size}`)
      check(
        `${tag} 基线起点落盒内`,
        inside(tx[4], tx[5], g.box),
        `(${tx[4].toFixed(2)}, ${tx[5].toFixed(2)}) vs 盒 (${g.box.x.toFixed(2)}, ${g.box.y.toFixed(2)}, ${g.box.w.toFixed(2)}, ${g.box.h.toFixed(2)})`,
      )

      // 真盒四角含得住（AABB 的基本性质，四角按 transform 独立算）
      const corners = trueCorners(it.transform, adv, g.size)
      const cornersIn = corners.map(([px, py]) => {
        const [dx, dy] = vp.convertToViewportPoint(px, py)
        return inside(dx, dy, g.box)
      })
      check(`${tag} 真盒四角含得住`, cornersIn.every(Boolean), `含住 ${cornersIn.filter(Boolean).length}/4`)

      if (axisAligned) {
        // 渲染器自己的文字方向：TextLayer 的 angle = atan2(tx[1], tx[0])，
        // 字身方向取 tx 的 (c,d)。步进沿哪根轴、起点贴哪条边、inset 在哪侧，
        // 全部由这两个向量现算，不按用例写死
        const ang = Math.atan2(tx[1], tx[0])
        const advx = Math.cos(ang)
        const advy = Math.sin(ang)
        const upLen = Math.hypot(tx[2], tx[3])
        const upx = tx[2] / upLen
        const upy = tx[3] / upLen
        const s = g.size
        if (Math.abs(advx) > Math.abs(advy)) {
          check(
            `${tag} 起点贴步进起步边`,
            near(tx[4], advx > 0 ? g.box.x : g.box.x + g.box.w),
            `${tx[4].toFixed(2)} vs ${(advx > 0 ? g.box.x : g.box.x + g.box.w).toFixed(2)}`,
          )
          // 下沉侧 = up 的反向边：up 朝右则盒左边是下沉侧，起点距它 0.25×size
          check(
            `${tag} 起点距下沉侧 0.25×size`,
            near(tx[5], upy > 0 ? g.box.y + 0.25 * s : g.box.y + g.box.h - 0.25 * s),
            `${tx[5].toFixed(2)} vs ${(upy > 0 ? g.box.y + 0.25 * s : g.box.y + g.box.h - 0.25 * s).toFixed(2)}`,
          )
        } else {
          check(
            `${tag} 起点贴步进起步边`,
            near(tx[5], advy > 0 ? g.box.y : g.box.y + g.box.h),
            `${tx[5].toFixed(2)} vs ${(advy > 0 ? g.box.y : g.box.y + g.box.h).toFixed(2)}`,
          )
          check(
            `${tag} 起点距下沉侧 0.25×size`,
            near(tx[4], upx > 0 ? g.box.x + 0.25 * s : g.box.x + g.box.w - 0.25 * s),
            `${tx[4].toFixed(2)} vs ${(upx > 0 ? g.box.x + 0.25 * s : g.box.x + g.box.w - 0.25 * s).toFixed(2)}`,
          )
        }
        // 盒尺寸：未旋转盒的形状由**文字自己的方向**定（竖排窄高、横排宽扁），
        // 页旋转 90/270 再把整个盒转过去（宽高互换）
        const textVertical = Math.abs(it.transform[1]) > Math.abs(it.transform[0])
        const urW = textVertical ? 1.1 * s : adv
        const urH = textVertical ? adv : 1.1 * s
        const swap = r === 90 || r === 270
        check(
          `${tag} 盒尺寸随页旋转互换`,
          near(g.box.w, swap ? urH : urW) && near(g.box.h, swap ? urW : urH),
          `${g.box.w.toFixed(3)}×${g.box.h.toFixed(3)} vs 期望 ${(swap ? urH : urW).toFixed(3)}×${(swap ? urW : urH).toFixed(3)}`,
        )
      } else {
        // 斜排：AABB 不贴真盒的边，但面积必须不小于真盒（旋转矩形的包围只会更大）
        check(
          `${tag} 斜排 AABB 面积≥真盒`,
          g.box.w * g.box.h >= adv * 1.1 * g.size - 1e-6,
          `${(g.box.w * g.box.h).toFixed(1)} vs 真盒 ${(adv * 1.1 * g.size).toFixed(1)}`,
        )
      }

      // 写回路径往返：applyTextEdits 的 cover 矩形必须回到 PDF 空间的真盒 AABB
      const u = fromDisplayRect(g.box, r, b)
      const coverY = b.h - u.y - u.h
      const cs = corners
      const ex0 = Math.min(...cs.map((q) => q[0]))
      const ey0 = Math.min(...cs.map((q) => q[1]))
      const ex1 = Math.max(...cs.map((q) => q[0]))
      const ey1 = Math.max(...cs.map((q) => q[1]))
      check(
        `${tag} 写回 cover 矩形往返`,
        near(u.x, ex0) && near(coverY, ey0) && near(u.w, ex1 - ex0) && near(u.h, ey1 - ey0),
        `cover (${u.x.toFixed(3)}, ${coverY.toFixed(3)}, ${u.w.toFixed(3)}, ${u.h.toFixed(3)}) vs 真盒 (${ex0.toFixed(3)}, ${ey0.toFixed(3)}, ${(ex1 - ex0).toFixed(3)}, ${(ey1 - ey0).toFixed(3)})`,
      )
    }
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
