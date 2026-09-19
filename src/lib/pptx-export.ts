import PptxGenJS from 'pptxgenjs'
import { bodyLines, themeOf, type Slide, type Deck } from './ppt'

const W = 10 // inches, LAYOUT_16x9
const H = 5.625

type IPptxSlide = ReturnType<PptxGenJS['addSlide']>

function addTitleBar(pptx: PptxGenJS, slide: IPptxSlide, s: Slide, accent: string) {
  if (!s.title) return
  slide.addText(s.title, {
    x: 0.55,
    y: 0.35,
    w: W - 1.1,
    h: 0.85,
    fontSize: 28,
    bold: true,
    color: accent,
    align: 'left',
    valign: 'bottom',
  })
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.58,
    y: 1.26,
    w: 1.6,
    h: 0.035,
    fill: { color: accent },
    line: { width: 0 },
  })
}

function addBody(slide: IPptxSlide, s: Slide, fg: string) {
  const lines = bodyLines(s)
  if (!lines.length) return
  slide.addText(
    lines.map((t) => ({ text: t, options: { bullet: { code: '2022' }, breakLine: true } })),
    {
      x: 0.65,
      y: 1.55,
      w: W - 1.3,
      h: H - 2.1,
      fontSize: 18,
      color: fg,
      lineSpacing: 30,
      valign: 'top',
    },
  )
}

export async function deckToPptxBytes(deck: Deck): Promise<Uint8Array> {
  const pptx = new PptxGenJS()
  pptx.title = deck.title
  pptx.layout = 'LAYOUT_16x9'
  const theme = themeOf(deck.theme)
  const fg = theme.fg.replace('#', '')
  const accent = theme.accent.replace('#', '')

  for (const s of deck.slides) {
    const slide = pptx.addSlide()
    slide.background = { color: theme.bg.replace('#', '') }

    if (s.layout === 'title') {
      if (s.title) {
        slide.addText(s.title, {
          x: 0.8,
          y: 1.7,
          w: W - 1.6,
          h: 1.3,
          fontSize: 40,
          bold: true,
          color: accent,
          align: 'center',
        })
      }
      if (s.body) {
        slide.addText(s.body, {
          x: 1.2,
          y: 3.15,
          w: W - 2.4,
          h: 1.0,
          fontSize: 18,
          color: fg,
          align: 'center',
        })
      }
    } else if (s.layout === 'image') {
      addTitleBar(pptx, slide, s, accent)
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
      if (s.title) {
        slide.addText(s.title, {
          x: 0.55,
          y: 0.35,
          w: W - 1.1,
          h: 0.9,
          fontSize: 28,
          bold: true,
          color: accent,
        })
      }
    } else {
      addTitleBar(pptx, slide, s, accent)
      addBody(slide, s, fg)
    }
  }

  const out = (await pptx.write({ outputType: 'arraybuffer' })) as ArrayBuffer
  return new Uint8Array(out)
}
