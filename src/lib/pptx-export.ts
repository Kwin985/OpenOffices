import type PptxGenJS from 'pptxgenjs'
import {
  bodyLines,
  themeOf,
  ANIM_DIR_SUBTYPE,
  type AnimDir,
  type BulletAnim,
  type BulletExit,
  type MasterRect,
  type Slide,
  type SlideTransition,
  type Deck,
} from './ppt'

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

export async function deckToPptxBytes(deck: Deck): Promise<Uint8Array> {
  const { default: PptxGenJS } = await import('pptxgenjs')
  const pptx = new PptxGenJS()
  pptx.title = deck.title
  pptx.layout = 'LAYOUT_16x9'
  const theme = themeOf(deck.theme)
  const m = deck.master
  const fg = (m?.bodyColor ?? theme.fg).replace('#', '')
  const accent = (m?.titleColor ?? theme.accent).replace('#', '')

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
  }

  const out = (await pptx.write({ outputType: 'arraybuffer' })) as ArrayBuffer

  // pptxgenjs 不支持动画/换页计时：解包后向 slideN.xml 注入 <p:transition> 与 <p:timing>（schema 顺序：transition 在 timing 前）
  if (deck.slides.some((s) => s.transition || s.autoAdvance || s.anim)) {
    const { default: JSZip } = await import('jszip')
    const zip = await JSZip.loadAsync(out)
    for (let i = 0; i < deck.slides.length; i++) {
      const s = deck.slides[i]
      if (!s.transition && !s.autoAdvance && !s.anim) continue
      const name = `ppt/slides/slide${i + 1}.xml`
      const file = zip.file(name)
      if (!file) continue
      let xml = await file.async('string')
      let inject = transitionXml(s.transition, s.autoAdvance)
      if (s.anim) {
        const lines = bodyLines(s)
        const spid = lines.length ? findBodySpid(xml, lines[0]) : undefined
        if (spid) inject += timingXml(s.anim, s.animDir ?? 'bottom', s.exitAnim, spid, lines.length)
      }
      zip.file(name, xml.replace('</p:sld>', `${inject}</p:sld>`))
    }
    const buf = (await zip.generateAsync({ type: 'arraybuffer' })) as ArrayBuffer
    return new Uint8Array(buf)
  }
  return new Uint8Array(out)
}

function transitionXml(tr: SlideTransition | undefined, autoAdvance: number | undefined): string {
  if (!tr && !autoAdvance) return ''
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
  return `<p:transition spd="med" advClick="1"${advTm}>${inner}</p:transition>`
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

function enterEffectXml(anim: BulletAnim, dir: AnimDir, spid: string, nid: () => string): string {
  if (anim === 'fly') {
    const axis = dir === 'left' || dir === 'right' ? 'ppt_x' : 'ppt_y'
    return `<p:anim calcmode="lin" valueType="num"><p:cBhvr additive="base"><p:cTn id="${nid()}" dur="500" fill="hold"/><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl><p:attrNameLst><p:attrName>${axis}</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst><p:tav tm="0"><p:val><p:strVal val="${FLY_START[dir]}"/></p:val></p:tav><p:tav tm="100000"><p:val><p:strVal val="#${axis}"/></p:val></p:tav></p:tavLst></p:anim>`
  }
  const filter = anim === 'fade' ? 'fade' : WIPE_FILTER[dir]
  return `<p:animEffect transition="in" filter="${filter}"><p:cBhvr><p:cTn id="${nid()}" dur="500"/><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl></p:cBhvr></p:animEffect>`
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

// PowerPoint 原生 timing 树：mainSeq 内每段一个 entr clickEffect（set 可见性 + 入场行为），
// 设了出场再按段追加 exit clickEffect；bldP build="p" 驱动逐段构建
function timingXml(
  anim: BulletAnim,
  dir: AnimDir,
  exit: BulletExit | undefined,
  spid: string,
  count: number,
): string {
  const preset = anim === 'fade' ? 10 : anim === 'wipe' ? 22 : 2
  const subtype = anim === 'fade' ? 0 : ANIM_DIR_SUBTYPE[dir]
  let id = 10
  const nid = () => String(id++)
  const pars: string[] = []
  for (let i = 0; i < count; i++) {
    const setVisible = `<p:set><p:cBhvr><p:cTn id="${nid()}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>`
    pars.push(
      clickParXml(preset, 'entr', subtype, setVisible + enterEffectXml(anim, dir, spid, nid), nid),
    )
  }
  if (exit) {
    for (let i = 0; i < count; i++) {
      const fadeOut = `<p:animEffect transition="out" filter="fade"><p:cBhvr><p:cTn id="${nid()}" dur="500"/><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl></p:cBhvr></p:animEffect>`
      pars.push(clickParXml(10, 'exit', 0, fadeOut, nid))
    }
  }
  return (
    `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>` +
    `<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${pars.join('')}</p:childTnLst></p:cTn>` +
    `<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>` +
    `<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>` +
    `</p:seq></p:childTnLst></p:cTn></p:par></p:tnLst>` +
    `<p:bldLst><p:bldP spid="${spid}" grpId="0" build="p"/></p:bldLst></p:timing>`
  )
}
