import type JSZip from 'jszip'
import {
  emptyDeck,
  newId,
  revealItemKey,
  revealOrder,
  type AnimDir,
  type BulletAnim,
  type BulletExit,
  type Deck,
  type MasterRect,
  type MasterStyle,
  type Slide,
  type SlideShape,
  type SlideTransition,
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

// 形状文本的字符样式：首个 rPr（run 级）优先，退而求其次取 defRPr；对齐取首个 pPr 的 algn
function shapeStyleOf(
  sp: Element,
  env: { colors: Record<string, string>; clrMap: Record<string, string> },
): Partial<SlideShape> {
  const out: Partial<SlideShape> = {}
  const rPr = descendantsByName(sp, 'rPr')[0] ?? descendantsByName(sp, 'defRPr')[0]
  const sz = Number(rPr?.getAttribute('sz') ?? NaN) // OOXML：百分之一磅
  if (Number.isFinite(sz) && sz >= 400 && sz <= 40000) out.sizePt = Math.round(sz) / 100
  if (rPr?.getAttribute('b') === '1') out.bold = true
  if (rPr) {
    const color = solidFillToHex(childrenByName(rPr, 'solidFill')[0], env.colors, env.clrMap)
    if (color) out.color = color
  }
  const algn = descendantsByName(sp, 'pPr')[0]?.getAttribute('algn')
  if (algn === 'ctr') out.align = 'center'
  else if (algn === 'r') out.align = 'right'
  else if (algn === 'just') out.align = 'left'
  return out
}

// 形状盒子外观（v0.108）：spPr 的 solidFill → 底色、ln → 边框色 + 磅宽（w 是 EMU，12700=1pt）。
// noFill/渐变等不认的填充按「无」落；ln 里没有 solidFill 视作无边框
function boxStyleOf(
  sp: Element,
  env: { colors: Record<string, string>; clrMap: Record<string, string> },
): { fill?: string; outline?: string; outlineW?: number } {
  const out: { fill?: string; outline?: string; outlineW?: number } = {}
  const spPr = childrenByName(sp, 'spPr')[0]
  if (spPr && !childrenByName(spPr, 'noFill').length) {
    const fill = solidFillToHex(childrenByName(spPr, 'solidFill')[0], env.colors, env.clrMap)
    if (fill) out.fill = fill
  }
  const ln = spPr ? childrenByName(spPr, 'ln')[0] : undefined
  if (ln && !childrenByName(ln, 'noFill').length) {
    const c = solidFillToHex(childrenByName(ln, 'solidFill')[0], env.colors, env.clrMap)
    if (c) {
      out.outline = c
      const wEmu = Number(ln.getAttribute('w') ?? NaN)
      if (Number.isFinite(wEmu) && wEmu >= 3175 && wEmu <= 254000)
        out.outlineW = Math.round((wEmu / 12700) * 100) / 100
    }
  }
  return out
}

const MIME_BY_EXT: Record<string, string> = {  png: 'image/png',
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

// <p:transition spd="med" advTm="5000"><p:fade/></p:transition>：效果名 + 自动换页毫秒数
function parseTransition(root: Element): {
  transition?: SlideTransition
  autoAdvance?: number
} {
  const tr = descendantsByName(root, 'transition')[0]
  if (!tr) return {}
  const out: { transition?: SlideTransition; autoAdvance?: number } = {}
  const advTm = Number(tr.getAttribute('advTm') ?? 0)
  if (Number.isFinite(advTm) && advTm >= 1000 && advTm <= 3_600_000)
    out.autoAdvance = Math.round(advTm / 1000)
  for (const c of kids(tr)) {
    if (c.localName === 'fade' || c.localName === 'push' || c.localName === 'wipe' || c.localName === 'split') {
      out.transition = c.localName as SlideTransition
      break
    }
  }
  return out
}

// presetSubtype 方向位（与导出侧 ANIM_DIR_SUBTYPE 一致）
const SUBTYPE_DIR: Record<number, AnimDir> = { 1: 'top', 2: 'right', 4: 'bottom', 8: 'left' }
// wipe filter 是扫过方向：wipe(up) 即从下往上 → bottom（与导出侧 WIPE_FILTER 互逆）
const WIPE_FILTER_DIR: Record<string, AnimDir> = {
  'wipe(up)': 'bottom',
  'wipe(down)': 'top',
  'wipe(right)': 'left',
  'wipe(left)': 'right',
}

function flyStartDir(effect: Element): AnimDir | undefined {
  for (const sv of descendantsByName(effect, 'strVal')) {
    const v = (sv.textContent ?? '').replace(/\s+/g, '')
    if (v.startsWith('#+y')) return 'bottom'
    if (v.startsWith('#-y')) return 'top'
    if (v.startsWith('#-x')) return 'left'
    if (v.startsWith('#+x')) return 'right'
  }
  return undefined
}

/// 形状的 spid：`<p:cNvPr id="N">`（sp/pic 都是这一枚，且都在自己那一层里）
function spidOf(el: Element): string | undefined {
  return descendantsByName(el, 'cNvPr')[0]?.getAttribute('id') ?? undefined
}

/// 一枚 clickEffect 的效果：filter 判定 wipe/fade，`ppt_x`/`ppt_y` 位移判定 fly，
/// 方向按 presetSubtype → 滤镜名 → 起始位移三路认
function animEffectOf(c: Element): { anim: BulletAnim; dir?: AnimDir } {
  const filter = (
    descendantsByName(c, 'animEffect')[0]?.getAttribute('filter') ?? ''
  ).toLowerCase()
  let anim: BulletAnim
  if (filter.startsWith('wipe')) anim = 'wipe'
  else if (filter.startsWith('fade')) anim = 'fade'
  else if (
    descendantsByName(c, 'anim').some((a) =>
      descendantsByName(a, 'attrName').some(
        (x) => (x.textContent ?? '') === 'ppt_x' || (x.textContent ?? '') === 'ppt_y',
      ),
    )
  )
    anim = 'fly'
  else anim = 'fade'
  if (anim === 'fade') return { anim }
  const dir =
    SUBTYPE_DIR[Number(c.getAttribute('presetSubtype') ?? 0)] ??
    WIPE_FILTER_DIR[filter] ??
    flyStartDir(c)
  return dir ? { anim, dir } : { anim }
}

/**
 * `<p:timing>` 逐条构建（v0.111 扩到形状）：每个 entr clickEffect 认自己的 `<p:spTgt spid>`——
 * 等于 bldP 那个 spid 的是正文逐段（build="p"），其余按 spid 归给对应的形状。
 * 出场同理（transition="out" 的 animEffect）。
 *
 * v0.115 起顺手 read 出**播放序**：clickEffect 在 mainSeq 里的先后就是 PowerPoint 的放映序，
 * 同一段正文的每一条各占一枚 clickEffect 而 spid 相同，故按「第几回遇到它」编成 l<n>；
 * 形状按它在形状数组里的下标编成 s<n>。默认序（正文在前、形状按数组序）不写回 slide，
 * 只有真被排过才落 animOrder——「没说话」与「说了一遍默认序」在文件里是同一件事
 */
function parseAnim(
  root: Element,
  shapeSpids: string[],
): {
  anim?: BulletAnim
  animDir?: AnimDir
  exitAnim?: BulletExit
  order: string[]
  shapeAnims: Map<number, { anim: BulletAnim; animDir?: AnimDir; exitAnim?: BulletExit }>
} {
  const empty = {
    order: [] as string[],
    shapeAnims: new Map<number, { anim: BulletAnim; animDir?: AnimDir; exitAnim?: BulletExit }>(),
  }
  const timing = childrenByName(root, 'timing')[0]
  if (!timing) return empty
  const bodySpid = descendantsByName(timing, 'bldP')[0]?.getAttribute('spid') ?? undefined
  const clicks = descendantsByName(timing, 'cTn').filter(
    (c) => c.getAttribute('nodeType') === 'clickEffect',
  )
  const out: {
    anim?: BulletAnim
    animDir?: AnimDir
    exitAnim?: BulletExit
    order: string[]
    shapeAnims: Map<number, { anim: BulletAnim; animDir?: AnimDir; exitAnim?: BulletExit }>
  } = empty
  const shapeAt = (spid: string) => {
    const i = shapeSpids.indexOf(spid)
    return i < 0 ? undefined : i
  }
  let bodySeen = 0
  for (const c of clicks) {
    const spid = descendantsByName(c, 'spTgt')[0]?.getAttribute('spid')
    if (!spid) continue
    if (c.getAttribute('presetClass') === 'exit') {
      if (!descendantsByName(c, 'animEffect').some((a) => a.getAttribute('transition') === 'out'))
        continue
      if (spid === bodySpid) out.exitAnim = 'fade'
      else {
        const i = shapeAt(spid)
        if (i !== undefined) out.shapeAnims.set(i, { ...(out.shapeAnims.get(i) ?? { anim: 'fade' }), exitAnim: 'fade' })
      }
      continue
    }
    if (c.getAttribute('presetClass') !== 'entr') continue
    const eff = animEffectOf(c)
    if (spid === bodySpid) {
      out.anim = eff.anim
      if (eff.dir) out.animDir = eff.dir
      out.order.push(`l${bodySeen++}`)
    } else {
      const i = shapeAt(spid)
      if (i !== undefined) {
        out.shapeAnims.set(i, {
          ...(out.shapeAnims.get(i) ?? { anim: eff.anim }),
          anim: eff.anim,
          ...(eff.dir ? { animDir: eff.dir } : {}),
        })
        out.order.push(`s${i}`)
      }
    }
  }
  return out
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

  // 占位符走版式槽；无占位符身份的自由文本框进形状层（v0.107）——不再摊进正文，
  // 位置/字号/颜色原样保住，这正是外部设计版版面此前整页丢失的地方。
  // v0.108 起按 spTree 文档序单趟收集 sp/pic：形状数组序 = 层叠序（后画在上），
  // 不再是「文本先收、图片后收」导致「图片垫底、文字压上」被翻转
  const boxes: { lines: string[]; y: number; ph: string | null }[] = []
  const shapes: SlideShape[] = []
  // 形状在原件里的 spid（与 shapes 平行）：动画挂靠靠它认人（v0.111），
  // 它是 pptx 内部的号，不进 .opd——换一次存盘号就重排了
  const shapeSpids: string[] = []
  {
    const relsPath = slideXml.name.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels')
    const relsFile = zip.file(relsPath)
    const rels = relsFile ? parseRels(await relsFile.async('string')) : undefined
    const ordered: Element[] = []
    const walk = (n: Element) => {
      for (const c of kids(n)) {
        if (c.localName === 'sp' || c.localName === 'pic') ordered.push(c)
        walk(c)
      }
    }
    walk(root)
    for (const el of ordered) {
      if (el.localName === 'sp') {
        const lines = shapeParagraphs(el).filter((l) => l.trim())
        if (!lines.length) continue
        const pos = shapeExt(el)
        const ph = phType(el)
        if (!ph && pos) {
          const sh: SlideShape = {
            id: newId(),
            kind: 'text',
            ...pos,
            text: lines.join('\n'),
            ...shapeStyleOf(el, env),
          }
          Object.assign(sh, boxStyleOf(el, env)) // fill/outline/outlineW 按接口序落在 align 之后
          shapes.push(sh)
          shapeSpids.push(spidOf(el) ?? '')
          continue
        }
        boxes.push({ lines, y: pos ? pos.y : 999, ph })
      } else {
        // 图片：一律进形状层（v0.107）——位置原样保住，不再有「第一张塞版式槽、其余丢弃」的
        // 有损近似；版式槽的 image 只留给用户在图片页手工插入与单页背景图回退
        const blip = descendantsByName(el, 'blip')[0]
        const embed =
          blip?.getAttribute('r:embed') ??
          blip?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed')
        if (!embed || !rels) continue
        const target = rels.get(embed)
        if (!target) continue
        const mediaPath = resolveRel('ppt/slides', target)
        const mediaFile = zip.file(mediaPath)
        if (!mediaFile) continue
        const bytes = await mediaFile.async('uint8array')
        const ext = mediaPath.split('.').pop()?.toLowerCase() ?? 'png'
        const pos = shapeExt(el)
        if (!pos) continue
        const sh: SlideShape = { id: newId(), kind: 'image', ...pos }
        Object.assign(sh, boxStyleOf(el, env))
        sh.image = bytesToDataUri(bytes, MIME_BY_EXT[ext] ?? 'image/png')
        shapes.push(sh)
        shapeSpids.push(spidOf(el) ?? '')
      }
    }
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

  // 图片一律已在上面的文档序单趟里进形状层（v0.107/108）；槽位 image 只留给单页背景图回退
  let image: string | undefined
  let layout: Slide['layout'] = 'bullets'

  if (!title && !bodyLines.length && !image && shapes.length) {
    // 纯自由形状页：画布驱动，没有槽可渲染，落空白（优先于「首页即标题页」推断）
    layout = 'blank'
  } else if (index === 0 && total > 1 && bodyLines.length <= 2 && !image) {
    layout = 'title'
  } else if (index === 0 && total === 1) {
    layout = 'title'
  }

  // 单页背景覆盖 + 演讲者备注 + 切页动画/自动换页
  let bg: string | undefined
  let notes: string | undefined
  let transition: SlideTransition | undefined
  let autoAdvance: number | undefined
  try {
    const relsText = await zip
      .file(slideXml.name.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels'))
      ?.async('string')
    const slideBg = await bgOf(root, zip, relsText, 'ppt/slides', env.colors, env.clrMap)
    bg = slideBg.bg
    notes = await parseNotes(zip, slideXml.name)
    ;({ transition, autoAdvance } = parseTransition(root))
    if (slideBg.bgImage && !image) {
      // 单页背景图当作整页图片还原
      image = slideBg.bgImage
      layout = 'image'
    }
  } catch (e) {
    console.warn('页背景/备注解析失败，忽略', e)
  }

  const { anim, animDir, exitAnim, order, shapeAnims } = parseAnim(root, shapeSpids)
  // 形状动画按 spid 归位：出场那条可能先于入场被遇到，两条并进同一格
  for (const [i, a] of shapeAnims) {
    const sh = shapes[i]
    if (!sh) continue
    sh.anim = a.anim
    if (a.animDir) sh.animDir = a.animDir
    if (a.exitAnim) sh.exitAnim = a.exitAnim
  }
  // 播放序：read 出来的先后就是 PowerPoint 的放映序，只有真被排过（≠ 默认序）才写回模型
  let animOrder: string[] | undefined
  if (order.length) {
    // 去重（正文那枚 spid 在 mainSeq 里每逐条一回就要出现一回）+ 只留这一页真有的那几项：
    // 自有导出件再导入时标题/正文会落进形状层（v0.107 语义），文件里 l0/l1 那几票
    // 参照的正文此刻已不存在，留着就是一串悬空引用
    const keys = [...new Set(order)]
    const probe: Slide = {
      id: '',
      layout,
      title: '',
      body: bodyLines.join('\n'),
      anim,
      animDir,
      exitAnim,
      ...(shapes.length ? { shapes } : {}),
    }
    const def = revealOrder(probe).map(revealItemKey)
    const known = keys.filter((k) => def.includes(k))
    // 一项都不剩（文件里那几票的对象全没了）⇒ 不写——空数组比 undefined 更没信息
    if (known.length && def.join(',') !== known.join(',')) animOrder = known
  }

  return {
    id: newId(),
    layout,
    title,
    body: bodyLines.join('\n'),
    image,
    notes,
    bg,
    transition,
    anim,
    animDir,
    exitAnim,
    autoAdvance,
    animOrder,
    ...(shapes.length ? { shapes } : {}),
  }
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
