import type PptxGenJS from 'pptxgenjs'
import {
  bodyLines,
  revealAnimOf,
  revealExits,
  revealOrder,
  themeOf,
  ANIM_DIR_SUBTYPE,
  type AnimDir,
  type BulletAnim,
  type MasterRect,
  type RevealItem,
  type Slide,
  type SlideTransition,
  type Deck,
  tableDims,
} from './ppt'
import { renderSlideChartPng } from './chart'

const W = 10 // inches, LAYOUT_16x9
const H = 5.625

type IPptxSlide = ReturnType<PptxGenJS['addSlide']>

// 母版分数坐标 → 英寸；无母版用默认
function rectOr(rect: MasterRect | undefined, def: { x: number; y: number; w: number; h: number }) {
  if (!rect) return def
  return { x: rect.x * W, y: rect.y * H, w: rect.w * W, h: rect.h * H }
}

function addTitleBar(pptx: PptxGenJS, slide: IPptxSlide, s: Slide, accent: string, titleRect?: MasterRect) {
  if (!s.title) return
  const r = rectOr(titleRect, { x: 0.55, y: 0.35, w: W - 1.1, h: 0.85 })
  slide.addText(s.title, {
    x: r.x,
    y: r.y,
    w: r.w,
    h: r.h,
    fontSize: 28,
    bold: true,
    color: accent,
    align: 'left',
    valign: 'bottom',
  })
  slide.addShape(pptx.ShapeType.rect, {
    x: r.x + 0.03,
    y: r.y + r.h + 0.04,
    w: 1.6,
    h: 0.035,
    fill: { color: accent },
    line: { width: 0 },
  })
}

function addBody(slide: IPptxSlide, s: Slide, fg: string, bodyRect?: MasterRect) {
  const lines = bodyLines(s)
  if (!lines.length) return
  const r = rectOr(bodyRect, { x: 0.65, y: 1.55, w: W - 1.3, h: H - 2.1 })
  slide.addText(
    lines.map((t) => ({ text: t, options: { bullet: { code: '2022' }, breakLine: true } })),
    {
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      fontSize: 18,
      color: fg,
      lineSpacing: 30,
      valign: 'top',
    },
  )
}

/** 落盘形状的反查名：idx 是它在 slide.shapes 里的下标（导出序与数组序可能不同——空形状不落盘） */
interface ShapeName {
  idx: number
  name: string
}

/**
 * @param opts.legacyWriteBack 仅用于 A/B 基准的对照腿：把没改过的 slide 也
 *   `zip.file(name, xml)` 写回（v0.181 及以前的写法）。产品路径永远不传，
 *   两腿同源、只差这一个开关，判据可长期复现（v0.180 的纪律）。
 */
export async function deckToPptxBytes(
  deck: Deck,
  opts?: { legacyWriteBack?: boolean },
): Promise<Uint8Array> {
  const { default: PptxGenJS } = await import('pptxgenjs')
  const pptx = new PptxGenJS()
  const shapeNames: ShapeName[][] = [] // 逐页：形状动画注入时按它反查 spid（v0.111）
  pptx.title = deck.title
  pptx.layout = 'LAYOUT_16x9'
  const theme = themeOf(deck.theme)
  const m = deck.master
  const fg = (m?.bodyColor ?? theme.fg).replace('#', '')
  const accent = (m?.titleColor ?? theme.accent).replace('#', '')
  // v0.140：导入带来的主题字族落回 theme1.xml 的 fontScheme（majorFont/minorFont 的 latin 面），
  // 换机器打开时字族不再回落
  if (m?.majorFont || m?.minorFont) {
    pptx.theme = {
      ...(m.majorFont ? { headFontFace: m.majorFont } : {}),
      ...(m.minorFont ? { bodyFontFace: m.minorFont } : {}),
    }
  }

  for (const s of deck.slides) {
    const slide = pptx.addSlide()
    if (s.bg) slide.background = { color: s.bg.replace('#', '') }
    else if (m?.bgImage) slide.background = { data: m.bgImage.replace(/^data:/, '') }
    else slide.background = { color: (m?.bg ?? theme.bg).replace('#', '') }
    if (s.notes?.trim()) slide.addNotes(s.notes)

    if (s.layout === 'title') {
      const tr = rectOr(m?.titleRect, { x: 0.8, y: 1.7, w: W - 1.6, h: 1.3 })
      if (s.title) {
        slide.addText(s.title, {
          x: tr.x,
          y: tr.y,
          w: tr.w,
          h: tr.h,
          fontSize: 40,
          bold: true,
          color: accent,
          align: 'center',
        })
      }
      if (s.body) {
        const br = rectOr(m?.bodyRect, { x: 1.2, y: 3.15, w: W - 2.4, h: 1.0 })
        slide.addText(s.body, {
          x: br.x,
          y: br.y,
          w: br.w,
          h: br.h,
          fontSize: 18,
          color: fg,
          align: 'center',
        })
      }
    } else if (s.layout === 'image') {
      addTitleBar(pptx, slide, s, accent, m?.titleRect)
      const lines = bodyLines(s)
      const imgW = lines.length ? W * 0.55 : W - 1.1
      if (s.image) {
        slide.addImage({
          data: s.image,
          x: 0.55,
          y: 1.5,
          w: imgW,
          h: H - 2.05,
          sizing: { type: 'contain', w: imgW, h: H - 2.05 },
        })
      }
      if (lines.length) {
        slide.addText(lines.join('\n'), {
          x: 0.55 + imgW + 0.25,
          y: 1.55,
          w: Math.max(1.5, W - imgW - 1.35),
          h: H - 2.1,
          fontSize: 15,
          color: fg,
          valign: 'top',
          lineSpacing: 24,
        })
      }
    } else if (s.layout === 'blank') {
      addTitleBar(pptx, slide, s, accent, m?.titleRect)
    } else {
      addTitleBar(pptx, slide, s, accent, m?.titleRect)
      addBody(slide, s, fg, m?.bodyRect)
    }

    // 自由形状层（v0.107）：分数坐标 → 英寸原位导出；文字样式直接落 run 级属性；
    // v0.108 起盒子的底色/边框随 spPr 的 fill/line 落盘（边框宽 pptxgenjs 收磅值）。
    // v0.111：每个真落盘的形状起一个 objectName（`ooShapeN`），注入动画时按它反查 spid——
    // pptxgenjs 不给形状可预测的 id，按序号猜会在「形状没落盘」时整体错位。
    // v0.140：形状名唯一时直接拿它当 objectName（PowerPoint 选择窗格里就是导入时的那个名），
    // 重名才退回去年的 oooShapeN——重名时反查会认错人，宁可丢名字也不指错形状
    const names: ShapeName[] = []
    const nameCount = new Map<string, number>()
    for (const sh of s.shapes ?? []) if (sh.name) nameCount.set(sh.name, (nameCount.get(sh.name) ?? 0) + 1)
    for (const [idx, sh] of (s.shapes ?? []).entries()) {
      const r = { x: sh.x * W, y: sh.y * H, w: sh.w * W, h: sh.h * H }
      const realName = sh.name && (nameCount.get(sh.name) ?? 0) === 1 ? sh.name : undefined
      const objectName = realName ?? `ooShape${names.length}`
      if (sh.kind === 'image' && sh.image) {
        slide.addImage({ data: sh.image, ...r, objectName, ...(sh.alt ? { altText: sh.alt } : {}) })
        names.push({ idx, name: objectName })
      } else if (sh.kind === 'text' && sh.text?.trim()) {
        slide.addText(sh.text, {
          ...r,
          objectName,
          fontSize: sh.sizePt ?? 18,
          ...(sh.bold ? { bold: true } : {}),
          ...(sh.italic ? { italic: true } : {}), // v0.140
          ...(sh.underline ? { underline: { style: 'sng' as const } } : {}), // v0.140（点线/双线降级）
          color: (sh.color ?? fg).replace('#', ''),
          ...(sh.align ? { align: sh.align } : {}),
          ...(sh.wrap === false ? { wrap: false } : {}), // v0.140：wrap="none" 文本不换行
          ...(sh.fill ? { fill: { color: sh.fill.replace('#', '') } } : {}),
          ...(sh.outline
            ? { line: { color: sh.outline.replace('#', ''), width: sh.outlineW ?? 1 } }
            : {}),
          valign: sh.anchor ?? 'top', // v0.140：锚点缺省仍是顶对齐
        })
        names.push({ idx, name: objectName })
      } else if (sh.kind === 'table' && sh.table) {
        // 表格落**原生 PowerPoint 表格**（v0.127）：对方拿到手能接着改字改行，
        // 而不是一张截屏。表头行按强调色铺底，格线可关。
        const t = sh.table
        const cols = Math.max(1, tableDims(t).cols)
        // v0.140：导入的列宽/行高是比例，导出时按表框实宽高折算回英寸（按和归一，
        // 手改过的 .opd 也翻得回来）；长度对不上就退回等分/自适应
        const bySum = (fracs: number[] | undefined, n: number, total: number) => {
          if (!fracs || fracs.length !== n || fracs.some((f) => !(f > 0))) return undefined
          const s = fracs.reduce((a, b) => a + b, 0)
          return fracs.map((f) => (f / s) * total)
        }
        const colW =
          bySum(t.colW, cols, r.w) ?? Array.from({ length: cols }, () => r.w / cols)
        const rowH = bySum(t.rowH, t.rows.length, r.h)
        const rows = t.rows.map((row, ri) =>
          row.map((cell) => {
            const head = t.hasHeader && ri === 0
            return {
              text: cell,
              options: {
                ...(head ? { bold: true, align: 'center' as const } : { align: 'left' as const }),
                color: head ? 'FFFFFF' : fg,
                ...(head
                  ? { fill: { color: (t.headerFill ?? accent).replace('#', '') } }
                  : {}),
              },
            }
          }),
        )
        slide.addTable(rows, {
          ...r,
          objectName,
          colW,
          ...(rowH ? { rowH } : {}),
          fontSize: t.sizePt ?? 14,
          // 关掉格线时 type:'none'，否则 PowerPoint 会自作主张给一张无框表
          border:
            t.border === false
              ? { type: 'none' }
              : { type: 'solid', pt: 1, color: 'BFBFBF' },
          valign: 'middle',
        })
        names.push({ idx, name: objectName })
      } else if (sh.kind === 'chart' && sh.chart) {
        // 图表落**图片**（v0.127）：pptxgenjs 只给得出原生图表的骨架，
        // 而这一片要的是「幻灯片上有一张对的图」。数据在 .opd 里留着，回应用内可再编辑。
        // 渲不出来就整枚不落——宁可少一枚形状，也不要在 pptx 里塞一张坏的图。
        try {
          const png = await renderSlideChartPng(
            sh.chart,
            Math.round(sh.w * 960),
            Math.round(sh.h * 540),
          )
          slide.addImage({ data: png, ...r, objectName })
          names.push({ idx, name: objectName })
        } catch {
          /* 图表渲染失败：跳过这一枚，其余形状照常落盘 */
        }
      }
    }
    shapeNames.push(names)
  }

  const out = (await pptx.write({ outputType: 'arraybuffer' })) as ArrayBuffer

  // pptxgenjs 不支持动画/换页计时：解包后向 slideN.xml 注入 <p:transition> 与 <p:timing>（schema 顺序：transition 在 timing 前）
  const needsTiming = (s: Slide) =>
    !!s.transition || !!s.autoAdvance || s.advClick === false || !!s.anim || (s.shapes ?? []).some((sh) => sh.anim)
  // v0.140：pptxgenjs 不写文本/表格形状的 descr，也不写 tblPr@bandRow（源码里那一行是注释掉的）——
  // 这两枚与 timing 走同一条解包注入的路
  const needsMeta = (s: Slide) =>
    (s.shapes ?? []).some(
      (sh) =>
        ((sh.kind === 'text' || sh.kind === 'table') && !!sh.alt) || (sh.kind === 'table' && sh.table?.bandRow),
    )
  if (deck.slides.some((s) => needsTiming(s) || needsMeta(s))) {
    const { default: JSZip } = await import('jszip')
    const zip = await JSZip.loadAsync(out)
    for (let i = 0; i < deck.slides.length; i++) {
      const s = deck.slides[i]
      if (!needsTiming(s) && !needsMeta(s)) continue
      const name = `ppt/slides/slide${i + 1}.xml`
      const file = zip.file(name)
      if (!file) continue
      const original = await file.async('string')
      let xml = original
      // v0.140：形状名/替代文本（cNvPr@descr，只有 image/chart 有原生 altText）与隔行底纹
      for (const n of shapeNames[i] ?? []) {
        const sh = s.shapes?.[n.idx]
        if (!sh) continue
        if ((sh.kind === 'text' || sh.kind === 'table') && sh.alt) xml = injectDescr(xml, n.name, sh.alt)
        if (sh.kind === 'table' && sh.table?.bandRow) xml = injectBandRow(xml, n.name)
      }
      let inject = transitionXml(s.transition, s.autoAdvance, s.advClick)
      const lines = bodyLines(s)
      const spid = s.anim && lines.length ? findBodySpid(xml, lines[0]) : undefined
      // 形状：按 objectName 反查 spid，认不出的形状不落动画（宁可少一段，也不指向错的形状）
      const shapeSpid = new Map<number, string>()
      for (const n of shapeNames[i] ?? []) {
        const found = findSpidByName(xml, n.name)
        if (found) shapeSpid.set(n.idx, found)
      }
      const order = revealOrder(s)
      if (order.length) {
        const spidOf = (it: RevealItem) => (it.kind === 'line' ? spid : shapeSpid.get(it.idx))
        inject += timingXml(s, order, spidOf)
      }
      // v0.182：只在**真改过**时写回。JSZip 对未被 `file(name, data)` 替换的条目
      // 复用原有压缩数据；把没改的 slide 也写回会丢掉那份缓存，让末尾的
      // generateAsync 重新 DEFLATE 整包（含媒体、theme 与其它未改的 slide）。
      const next = inject ? xml.replace('</p:sld>', `${inject}</p:sld>`) : xml
      if (next !== original || opts?.legacyWriteBack) zip.file(name, next)
    }
    const buf = (await zip.generateAsync({ type: 'arraybuffer' })) as ArrayBuffer
    return new Uint8Array(buf)
  }
  return new Uint8Array(out)
}

// 形状 spid：objectName 落在 <p:cNvPr name="ooShapeN"> 上，同标签里读 id
function findSpidByName(xml: string, objectName: string): string | undefined {
  const i = xml.indexOf(`name="${objectName}"`)
  if (i < 0) return undefined
  const open = xml.lastIndexOf('<p:cNvPr', i)
  const gt = xml.indexOf('>', i)
  if (open < 0 || gt < 0) return undefined
  return xml.slice(open, gt).match(/id="(\d+)"/)?.[1]
}

function transitionXml(tr: SlideTransition | undefined, autoAdvance: number | undefined, advClick?: boolean): string {
  if (!tr && !autoAdvance && advClick !== false) return ''
  const inner =
    tr === 'fade'
      ? '<p:fade/>'
      : tr === 'push'
        ? '<p:push dir="l"/>'
        : tr === 'wipe'
          ? '<p:wipe dir="l"/>'
          : tr === 'split'
            ? '<p:split orient="vert" dir="d"/>'
            : ''
  const advTm = autoAdvance ? ` advTm="${Math.round(autoAdvance * 1000)}"` : ''
  // v0.140：advClick="0" = 点击不换页；缺省与 "1" 同义，都写 1（PowerPoint 自己也是这么写的）
  return `<p:transition spd="med" advClick="${advClick === false ? 0 : 1}"${advTm}>${inner}</p:transition>`
}

// v0.140：往 objectName 那一枚 <p:cNvPr> 上补 descr（替代文本）。
// pptxgenjs 只给 image/chart 写 altText，文本/表格形状的 cNvPr 上这一枚只能自己注
function injectDescr(xml: string, objectName: string, descr: string): string {
  const i = xml.indexOf(`name="${objectName}"`)
  if (i < 0) return xml
  const open = xml.lastIndexOf('<p:cNvPr', i)
  const gt = xml.indexOf('>', i)
  if (open < 0 || gt < 0 || open > i) return xml
  // tag 含结尾字符：pptxgenjs 写的 cNvPr 两种形态都有（<p:cNvPr …> 带子节点 / <p:cNvPr …/> 自闭），
  // 正则按 (?<=.) 分组拆「属性串 + 结尾」，descr 插在中间——切少了结尾字符两支全会哑
  const tag = xml.slice(open, gt + 1)
  const m = tag.match(/^(.*?)(\/?>)$/)
  if (!m) return xml
  const esc = escXml(descr).replace(/"/g, '&quot;')
  const withDescr = tag.includes('descr="')
    ? tag.replace(/descr="[^"]*"/, `descr="${esc}"`)
    : `${m[1]} descr="${esc}"${m[2]}`
  return xml.slice(0, open) + withDescr + xml.slice(gt + 1)
}

// v0.140：往 objectName 那一帧表格的 <a:tblPr/> 上补 bandRow（隔行底纹）——
// pptxgenjs 永远写空 tblPr，bandRow 那一行在它源码里是注释
function injectBandRow(xml: string, objectName: string): string {
  const i = xml.indexOf(`name="${objectName}"`)
  if (i < 0) return xml
  const tblAt = xml.indexOf('<a:tbl>', i)
  if (tblAt < 0) return xml
  const prst = xml.slice(tblAt, tblAt + 64).match(/<a:tblPr\s*\/>|<a:tblPr>\s*<\/a:tblPr>/)
  if (!prst) return xml
  const at = tblAt + (prst.index ?? 0)
  return xml.slice(0, at) + '<a:tblPr bandRow="1"/>' + xml.slice(at + prst[0].length)
}

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// pptxgenjs 不给形状起可预测的 name/id：按正文首行文本反查所在 <p:sp> 的 cNvPr id；取最后一个命中（正文形状总在标题之后）
function findBodySpid(xml: string, firstLine: string): string | undefined {
  const needle = `<a:t>${escXml(firstLine)}</a:t>`
  if (!firstLine.trim()) return undefined
  let spid: string | undefined
  for (const seg of xml.split('<p:sp>').slice(1)) {
    const m = seg.match(/<p:cNvPr id="(\d+)"/)
    if (m && seg.includes(needle)) spid = m[1]
  }
  return spid
}

// wipe 滤镜名指擦除移动方向（从下方进场 = 向上擦开）；fly 起始位移按方向选轴与符号
const WIPE_FILTER: Record<AnimDir, string> = {
  bottom: 'wipe(up)',
  top: 'wipe(down)',
  left: 'wipe(right)',
  right: 'wipe(left)',
}
const FLY_START: Record<AnimDir, string> = {
  bottom: '#+y+1',
  top: '#-y+1',
  left: '#-x+1',
  right: '#+x+1',
}

function enterEffectXml(anim: BulletAnim, dir: AnimDir, spid: string, nid: () => string, durMs?: number): string {
  // v0.140：导入的单条时长优先；缺省仍是 500ms（与往年一致）
  const dur = durMs && durMs >= 50 && durMs <= 600000 ? String(Math.round(durMs)) : '500'
  if (anim === 'fly') {
    const axis = dir === 'left' || dir === 'right' ? 'ppt_x' : 'ppt_y'
    return `<p:anim calcmode="lin" valueType="num"><p:cBhvr additive="base"><p:cTn id="${nid()}" dur="${dur}" fill="hold"/><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl><p:attrNameLst><p:attrName>${axis}</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst><p:tav tm="0"><p:val><p:strVal val="${FLY_START[dir]}"/></p:val></p:tav><p:tav tm="100000"><p:val><p:strVal val="#${axis}"/></p:val></p:tav></p:tavLst></p:anim>`
  }
  const filter = anim === 'fade' ? 'fade' : WIPE_FILTER[dir]
  return `<p:animEffect transition="in" filter="${filter}"><p:cBhvr><p:cTn id="${nid()}" dur="${dur}"/><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl></p:cBhvr></p:animEffect>`
}

function clickParXml(
  presetId: number,
  presetClass: 'entr' | 'exit',
  subtype: number,
  inner: string,
  nid: () => string,
): string {
  return (
    `<p:par><p:cTn id="${nid()}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="${nid()}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="${nid()}" presetID="${presetId}" presetClass="${presetClass}" presetSubtype="${subtype}" fill="hold" grpId="0" nodeType="clickEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>` +
    inner +
    `</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>`
  )
}

// PowerPoint 原生 timing 树：mainSeq 内每个 clickEffect 一段——正文逐段（bldP build="p"
// 驱动逐段构建），形状每个一段（整形状入场，不写 bldP）；出场按同序追加 exit clickEffect。
// 段落顺序即 PowerPoint 的播放序：v0.115 起由 revealOrder（默认正文在前、形状按层叠序在后）
// 逐项产出，认不出 spid 的那一项整段跳过（宁可少一段，也不指向错的形状）
function timingXml(
  slide: Slide,
  order: RevealItem[],
  spidOf: (it: RevealItem) => string | undefined,
): string {
  let id = 10
  const nid = () => String(id++)
  const pars: string[] = []
  const setVisible = (spid: string) =>
    `<p:set><p:cBhvr><p:cTn id="${nid()}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>`
  const fadeOut = (spid: string) =>
    `<p:animEffect transition="out" filter="fade"><p:cBhvr><p:cTn id="${nid()}" dur="500"/><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl></p:cBhvr></p:animEffect>`
  const preset = (a: BulletAnim) => (a === 'fade' ? 10 : a === 'wipe' ? 22 : 2)
  const subtype = (a: BulletAnim, d: AnimDir) => (a === 'fade' ? 0 : ANIM_DIR_SUBTYPE[d])
  // 入场：揭示序逐项各一枚 clickEffect；正文那一项额外由下面那枚 bldP 驱动逐段构建。
  // v0.140：时长按项各取——正文逐条用页级 animDur，形状用自己那枚；缺省回落 500ms
  for (const it of order) {
    const t = spidOf(it)
    const eff = revealAnimOf(slide, it)
    if (!t || !eff) continue
    const durMs = it.kind === 'line' ? slide.animDur : slide.shapes?.[it.idx]?.animDur
    pars.push(
      clickParXml(
        preset(eff.anim),
        'entr',
        subtype(eff.anim, eff.dir),
        setVisible(t) + enterEffectXml(eff.anim, eff.dir, t, nid, durMs),
        nid,
      ),
    )
  }
  // 出场：揭示序里会出场的那几项，按同一支次序依次淡出
  for (const it of revealExits(slide, order)) {
    const t = spidOf(it)
    if (!t) continue
    pars.push(clickParXml(10, 'exit', 0, fadeOut(t), nid))
  }
  const firstLine = order.find((it) => it.kind === 'line')
  const bodySpid = firstLine ? spidOf(firstLine) : undefined
  const bld =
    bodySpid
      ? `<p:bldLst><p:bldP spid="${bodySpid}" grpId="0" build="p"/></p:bldLst>`
      : ''
  return (
    `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>` +
    `<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${pars.join('')}</p:childTnLst></p:cTn>` +
    `<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>` +
    `<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>` +
    `</p:seq></p:childTnLst></p:cTn></p:par></p:tnLst>` +
    bld +
    `</p:timing>`
  )
}
