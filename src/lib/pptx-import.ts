import type JSZip from 'jszip'
import {
  emptyDeck,
  newId,
  type Deck,
  type MasterRect,
  type MasterStyle,
  type Slide,
} from './ppt'

const EMU_PER_IN = 914400
const SLIDE_W_IN = 10
const SLIDE_H_IN = 5.625

// @xmldom/xmldom 0.8 不实现 Element.children，统一用 childNodes 过滤（浏览器同样适用）
function kids(n: Element): Element[] {
  return Array.from(n.childNodes).filter((c) => c.nodeType === 1) as Element[]
}

function childrenByName(node: Element, name: string): Element[] {
  return kids(node).filter((c) => c.localName === name)
}

function descendantsByName(node: Element, name: string): Element[] {
  const out: Element[] = []
  const walk = (n: Element) => {
    for (const c of kids(n)) {
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

function parseXml(text: string): Document {
  return new DOMParser().parseFromString(text, 'application/xml')
}

// theme1.xml 的 clrScheme：{dk1,lt1,accent1,...} → '#rrggbb'
function colorScheme(themeDoc: Document): Record<string, string> {
  const out: Record<string, string> = {}
  const scheme = descendantsByName(themeDoc.documentElement, 'clrScheme')[0]
  if (!scheme) return out
  for (const c of kids(scheme)) {
    const srgb = childrenByName(c, 'srgbClr')[0]
    const sys = childrenByName(c, 'sysClr')[0]
    const val = srgb?.getAttribute('val') ?? sys?.getAttribute('lastClr')
    if (val) out[c.localName] = `#${val}`
  }
  return out
}

// 把一个 solidFill 元素解析成 '#rrggbb'（支持 srgbClr/sysClr/schemeClr+clrMap）
function solidFillToHex(
  fill: Element | undefined,
  colors: Record<string, string>,
  clrMap: Record<string, string>,
): string | undefined {
  if (!fill) return undefined
  const srgb = childrenByName(fill, 'srgbClr')[0]
  if (srgb?.getAttribute('val')) return `#${srgb.getAttribute('val')}`
  const sys = childrenByName(fill, 'sysClr')[0]
  if (sys?.getAttribute('lastClr')) return `#${sys.getAttribute('lastClr')}`
  const scheme = childrenByName(fill, 'schemeClr')[0]?.getAttribute('val')
  if (!scheme) return undefined
  return colors[clrMap[scheme] ?? scheme] ?? colors[scheme]
}

function relsEntries(text: string): { id?: string; type: string; target: string }[] {
  const doc = parseXml(text)
  return descendantsByName(doc.documentElement, 'Relationship').map((r) => ({
    id: r.getAttribute('Id') ?? undefined,
    type: r.getAttribute('Type') ?? '',
    target: r.getAttribute('Target') ?? '',
  }))
}

async function imageFromRid(
  zip: JSZip,
  relsText: string,
  rid: string,
  baseDir: string,
): Promise<string | undefined> {
  const rel = relsEntries(relsText).find((e) => e.id === rid)
  if (!rel?.target) return undefined
  const mediaPath = resolveRel(baseDir, rel.target)
  const file = zip.file(mediaPath)
  if (!file) return undefined
  const bytes = await file.async('uint8array')
  const ext = mediaPath.split('.').pop()?.toLowerCase() ?? 'png'
  return bytesToDataUri(bytes, MIME_BY_EXT[ext] ?? 'image/png')
}

// 解析 cSld/bg：母版或单页的背景（纯色或图片）
async function bgOf(
  root: Element,
  zip: JSZip,
  relsText: string | undefined,
  baseDir: string,
  colors: Record<string, string>,
  clrMap: Record<string, string>,
): Promise<{ bg?: string; bgImage?: string }> {
  const cSld = childrenByName(root, 'cSld')[0]
  const bg = cSld ? childrenByName(cSld, 'bg')[0] : undefined
  if (!bg) return {}
  const fill = descendantsByName(bg, 'blipFill')[0]
  if (fill && relsText) {
    const blip = descendantsByName(fill, 'blip')[0]
    const rid = blip?.getAttribute('r:embed') ??
      blip?.getAttributeNS(
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
        'embed',
      )
    if (rid) {
      const data = await imageFromRid(zip, relsText, rid, baseDir)
      if (data) return { bgImage: data }
    }
  }
  const hex = solidFillToHex(descendantsByName(bg, 'solidFill')[0], colors, clrMap)
  return hex ? { bg: hex } : {}
}

function luminance(hex: string): number {
  const m = hex.replace('#', '')
  if (m.length !== 6) return 1
  const r = parseInt(m.slice(0, 2), 16)
  const g = parseInt(m.slice(2, 4), 16)
  const b = parseInt(m.slice(4, 6), 16)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

// 母版：背景（色/图）+ 主题色 + 标题/正文占位几何
async function parseMaster(zip: JSZip): Promise<{
  master: MasterStyle
  colors: Record<string, string>
  clrMap: Record<string, string>
}> {
  const colors = zip.file('ppt/theme/theme1.xml')
    ? colorScheme(parseXml(await zip.file('ppt/theme/theme1.xml')!.async('string')))
    : {}
  const masterFile = zip.file('ppt/slideMasters/slideMaster1.xml')
  if (!masterFile) return { master: {}, colors, clrMap: {} }
  const root = parseXml(await masterFile.async('string')).documentElement
  const clrMapEl = descendantsByName(root, 'clrMap')[0]
  const clrMap: Record<string, string> = {}
  if (clrMapEl) for (const a of Array.from(clrMapEl.attributes)) clrMap[a.localName] = a.value

  const masterRelText = await zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels')?.async('string')
  const master: MasterStyle = {}
  const bg = await bgOf(
    root,
    zip,
    masterRelText,
    'ppt/slideMasters',
    colors,
    clrMap,
  )
  if (bg.bg) master.bg = bg.bg
  if (bg.bgImage) master.bgImage = bg.bgImage

  const bgColor = master.bg ?? colors[clrMap.bg1 ?? 'bg1'] ?? colors.bg1 ?? '#ffffff'
  const txColor = colors[clrMap.tx1 ?? 'tx1'] ?? colors.tx1 ?? '#000000'
  master.bg = master.bg ?? bgColor
  master.titleColor = colors.accent1 ?? txColor
  master.bodyColor = txColor

  for (const sp of descendantsByName(root, 'sp')) {
    const ph = phType(sp)
    const pos = shapeExt(sp)
    if (!pos) continue
    const rect: MasterRect = { x: pos.x, y: pos.y, w: pos.w, h: pos.h }
    if (!master.titleRect && (ph === 'title' || ph === 'ctrTitle')) master.titleRect = rect
    else if (!master.bodyRect && (ph === 'body' || ph === 'subTitle')) master.bodyRect = rect
  }
  return { master, colors, clrMap }
}

// notesSlideN.xml 里的备注文本（跳过页码/占位噪声）
async function parseNotes(zip: JSZip, slideName: string): Promise<string | undefined> {
  const relsPath = slideName.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels')
  const relsFile = zip.file(relsPath)
  if (!relsFile) return undefined
  const rel = relsEntries(await relsFile.async('string')).find((e) =>
    /\/notesSlide$/.test(e.type),
  )
  if (!rel?.target) return undefined
  const notesPath = resolveRel('ppt/slides', rel.target)
  const notesFile = zip.file(notesPath)
  if (!notesFile) return undefined
  const root = parseXml(await notesFile.async('string')).documentElement
  const lines: string[] = []
  for (const sp of descendantsByName(root, 'sp')) {
    const ph = phType(sp)
    if (ph === 'sldImg' || ph === 'sldNum' || ph === 'dt' || ph === 'ftr') continue
    for (const line of shapeParagraphs(sp)) if (line.trim()) lines.push(line)
  }
  const text = lines.join('\n').trim()
  return text || undefined
}

async function slideToDeckSlide(
  zip: JSZip,
  slideXml: JSZip.JSZipObject,
  index: number,
  total: number,
  env: { colors: Record<string, string>; clrMap: Record<string, string> },
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

  // 单页背景覆盖 + 演讲者备注
  let bg: string | undefined
  let notes: string | undefined
  try {
    const relsText = await zip
      .file(slideXml.name.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels'))
      ?.async('string')
    const slideBg = await bgOf(root, zip, relsText, 'ppt/slides', env.colors, env.clrMap)
    bg = slideBg.bg
    notes = await parseNotes(zip, slideXml.name)
    if (slideBg.bgImage && !image) {
      // 单页背景图当作整页图片还原
      image = slideBg.bgImage
      layout = 'image'
    }
  } catch (e) {
    console.warn('页背景/备注解析失败，忽略', e)
  }

  return { id: newId(), layout, title, body: bodyLines.join('\n'), image, notes, bg }
}

export async function pptxBytesToDeck(bytes: Uint8Array): Promise<Deck> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(bytes)
  const slideFiles = Object.values(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f.name))
    .sort((a, b) => {
      const na = Number(a.name.match(/slide(\d+)\.xml/)?.[1] ?? 0)
      const nb = Number(b.name.match(/slide(\d+)\.xml/)?.[1] ?? 0)
      return na - nb
    })
  if (!slideFiles.length) throw new Error('pptx 中未找到任何幻灯片')

  const { master, colors, clrMap } = await parseMaster(zip)
  const deck = emptyDeck()
  if (Object.values(master).some((v) => v !== undefined)) {
    deck.master = master
    if (master.bg && luminance(master.bg) < 0.45) deck.theme = 'dark'
  }
  const slides: Slide[] = []
  for (let i = 0; i < slideFiles.length; i++) {
    try {
      slides.push(await slideToDeckSlide(zip, slideFiles[i], i, slideFiles.length, { colors, clrMap }))
    } catch (e) {
      console.warn(`第 ${i + 1} 页解析失败，使用占位`, e)
      slides.push({ id: newId(), layout: 'blank', title: `第 ${i + 1} 页（解析失败）`, body: '' })
    }
  }
  deck.slides = slides
  return deck
}
