import type PptxGenJS from 'pptxgenjs'
import { bodyLines, themeOf, type MasterRect, type Slide, type SlideTransition, type Deck } from './ppt'

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

  // pptxgenjs 不支持切换动画：解包后向 slideN.xml 注入 <p:transition>（schema 顺序在末尾即可）
  if (deck.slides.some((s) => s.transition)) {
    const { default: JSZip } = await import('jszip')
    const zip = await JSZip.loadAsync(out)
    for (let i = 0; i < deck.slides.length; i++) {
      const tr = deck.slides[i].transition
      if (!tr) continue
      const name = `ppt/slides/slide${i + 1}.xml`
      const file = zip.file(name)
      if (!file) continue
      const xml = await file.async('string')
      zip.file(name, xml.replace('</p:sld>', `${transitionXml(tr)}</p:sld>`))
    }
    const buf = (await zip.generateAsync({ type: 'arraybuffer' })) as ArrayBuffer
    return new Uint8Array(buf)
  }
  return new Uint8Array(out)
}

function transitionXml(tr: SlideTransition): string {
  const inner =
    tr === 'fade'
      ? '<p:fade/>'
      : tr === 'push'
        ? '<p:push dir="l"/>'
        : tr === 'wipe'
          ? '<p:wipe dir="l"/>'
          : '<p:split orient="vert" dir="d"/>'
  return `<p:transition spd="med" advClick="1">${inner}</p:transition>`
}
