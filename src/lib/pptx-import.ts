import JSZip from 'jszip'
import { emptyDeck, newId, type Deck, type Slide } from './ppt'

const EMU_PER_IN = 914400
const SLIDE_W_IN = 10
const SLIDE_H_IN = 5.625

function childrenByName(node: Element, name: string): Element[] {
  return Array.from(node.children).filter((c) => c.localName === name)
}

function descendantsByName(node: Element, name: string): Element[] {
  const out: Element[] = []
  const walk = (n: Element) => {
    for (const c of Array.from(n.children)) {
      if (c.localName === name) out.push(c)
      walk(c)
    }
  }
  walk(node)
  return out
}

// 一个 <a:p> 内的所有 <a:t> 拼接为一行
function paragraphText(p: Element): string {
  return descendantsByName(p, 't')
    .map((t) => t.textContent ?? '')
    .join('')
}

function shapeParagraphs(sp: Element): string[] {
  const txBody = childrenByName(sp, 'txBody')[0] ?? descendantsByName(sp, 'txBody')[0]
  if (!txBody) return []
  return childrenByName(txBody, 'p').map(paragraphText)
}

function shapeExt(sp: Element): { x: number; y: number; w: number; h: number } | null {
  const xfrm = descendantsByName(sp, 'xfrm')[0]
  if (!xfrm) return null
  const off = childrenByName(xfrm, 'off')[0]
  const ext = childrenByName(xfrm, 'ext')[0]
  if (!off || !ext) return null
  const ex = Number(off.getAttribute('x') ?? 0) / EMU_PER_IN / SLIDE_W_IN
  const ey = Number(off.getAttribute('y') ?? 0) / EMU_PER_IN / SLIDE_H_IN
  const ew = Number(ext.getAttribute('cx') ?? 0) / EMU_PER_IN / SLIDE_W_IN
  const eh = Number(ext.getAttribute('cy') ?? 0) / EMU_PER_IN / SLIDE_H_IN
  return { x: ex, y: ey, w: ew, h: eh }
}

function phType(sp: Element): string | null {
  const ph = descendantsByName(sp, 'ph')[0]
  return ph?.getAttribute('type') ?? null
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  tiff: 'image/tiff',
}

function bytesToDataUri(bytes: Uint8Array, mime: string): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return `data:${mime};base64,${btoa(bin)}`
}

function parseRels(text: string): Map<string, string> {
  const map = new Map<string, string>()
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  for (const rel of descendantsByName(doc.documentElement, 'Relationship')) {
    const id = rel.getAttribute('Id')
    const target = rel.getAttribute('Target')
    if (id && target) map.set(id, target)
  }
  return map
}

function resolveRel(baseDir: string, target: string): string {
  const parts = baseDir.split('/')
  for (const seg of target.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

async function slideToDeckSlide(
  zip: JSZip,
  slideXml: JSZip.JSZipObject,
  index: number,
  total: number,
): Promise<Slide> {
  const text = await slideXml.async('string')
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  const root = doc.documentElement

  const boxes: { lines: string[]; y: number; ph: string | null }[] = []
  for (const sp of descendantsByName(root, 'sp')) {
    const lines = shapeParagraphs(sp).filter((l) => l.trim())
    if (!lines.length) continue
    const pos = shapeExt(sp)
    boxes.push({ lines, y: pos ? pos.y : 999, ph: phType(sp) })
  }

  let title = ''
  let bodyLines: string[] = []
  const phTitle = boxes.find((b) => b.ph === 'title' || b.ph === 'ctrTitle')
  const phSub = boxes.find((b) => b.ph === 'subTitle')
  const rest = boxes.filter((b) => b !== phTitle && b !== phSub).sort((a, b) => a.y - b.y)
  if (phTitle) {
    title = phTitle.lines.join(' ')
    bodyLines = phSub ? [...phSub.lines] : rest.flatMap((b) => b.lines)
  } else if (rest.length) {
    const first = rest[0]
    title = first.y < 0.35 ? first.lines[0] : ''
    bodyLines = title ? first.lines.slice(1) : first.lines
    for (const b of rest.slice(title ? 1 : 0)) bodyLines.push(...b.lines)
  }

  // 图片：第一个有位置信息的 blip
  let image: string | undefined
  let layout: Slide['layout'] = 'bullets'
  const pic = descendantsByName(root, 'pic')[0]
  if (pic) {
    const embed = descendantsByName(pic, 'blip')[0]?.getAttribute('r:embed') ??
      descendantsByName(pic, 'blip')[0]?.getAttributeNS(
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
        'embed',
      )
    if (embed) {
      const relsPath = slideXml.name.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels')
      const relsFile = zip.file(relsPath)
      if (relsFile) {
        const rels = parseRels(await relsFile.async('string'))
        const target = rels.get(embed)
        if (target) {
          const mediaPath = resolveRel('ppt/slides', target)
          const mediaFile = zip.file(mediaPath)
          if (mediaFile) {
            const bytes = await mediaFile.async('uint8array')
            const ext = mediaPath.split('.').pop()?.toLowerCase() ?? 'png'
            image = bytesToDataUri(bytes, MIME_BY_EXT[ext] ?? 'image/png')
            layout = 'image'
          }
        }
      }
    }
  }

  if (index === 0 && total > 1 && bodyLines.length <= 2 && !image) {
    layout = 'title'
  } else if (index === 0 && total === 1) {
    layout = 'title'
  }

  return { id: newId(), layout, title, body: bodyLines.join('\n'), image }
}

export async function pptxBytesToDeck(bytes: Uint8Array): Promise<Deck> {
  const zip = await JSZip.loadAsync(bytes)
  const slideFiles = Object.values(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f.name))
    .sort((a, b) => {
      const na = Number(a.name.match(/slide(\d+)\.xml/)?.[1] ?? 0)
      const nb = Number(b.name.match(/slide(\d+)\.xml/)?.[1] ?? 0)
      return na - nb
    })
  if (!slideFiles.length) throw new Error('pptx 中未找到任何幻灯片')

  const deck = emptyDeck()
  const slides: Slide[] = []
  for (let i = 0; i < slideFiles.length; i++) {
    try {
      slides.push(await slideToDeckSlide(zip, slideFiles[i], i, slideFiles.length))
    } catch (e) {
      console.warn(`第 ${i + 1} 页解析失败，使用占位`, e)
      slides.push({ id: newId(), layout: 'blank', title: `第 ${i + 1} 页（解析失败）`, body: '' })
    }
  }
  deck.slides = slides
  return deck
}
