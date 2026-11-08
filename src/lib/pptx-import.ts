import type JSZip from 'jszip'
import { local, parseXml as parseXEl, type XEl } from './ooxml'
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

// ---- 元素视图（v0.141）：自家解析器出树，一次成型 --------------------------------
//
// 原先整条读入手骑在 @xmldom/xmldom 的 DOM 上：它要建属性节点、解命名空间、维护活 NodeList，
// 一篇 669 KiB 的幻灯片 XML（60 页）它要 99ms，自家 parseXml 只要 26ms（同字节实测 3.8×），
// 而且 DOM 这一层还逼着每次查问都把 childNodes 过滤一遍（v0.141 前一版最热的一枚就是它）。
// 换成下面的视图之后：属性是普通对象（ga 一次哈希），子元素是建树时就排好的数组。
//
// 刻意只留读手真正用的那几样：名 / 属性 / 子元素 / 文本。不实现 Node、命名空间解析与写操作——
// 读手不写回 XML，写侧走 pptx-export 那条路。
export interface PEl {
  name: string // 原样名（含前缀，如 a:off）
  localName: string // 去前缀名（off）
  attrs: Record<string, string>
  kids: PEl[]
  /** 直接子文本（不含后代）；textOf 才拼后代 */
  direct: string
  _text?: string
}

const EMPTY_PEL: PEl = { name: '#empty', localName: '#empty', attrs: {}, kids: [], direct: '' }

/** ooxml 的 XEl → 视图。建树一遍成：名去前缀、子元素数组、直接文本都在这一趟里落定 */
function view(e: XEl): PEl {
  const kids: PEl[] = []
  let direct = ''
  for (const c of e.children) {
    if (typeof c === 'string') direct += c
    else kids.push(view(c))
  }
  return { name: e.name, localName: local(e.name), attrs: e.attrs, kids, direct }
}

/** 解析一件部件：返回根元素（DOM 那边的 documentElement） */
function parseXml(text: string): PEl {
  const doc = parseXEl(text)
  for (const c of doc.children) if (typeof c !== 'string') return view(c)
  return EMPTY_PEL
}

/** textContent 等价物：拼接所有后代文本，问过一次就记住 */
function textOf(el: PEl): string {
  if (el._text !== undefined) return el._text
  let s = el.direct
  for (const k of el.kids) s += textOf(k)
  el._text = s
  return s
}

// ---- 属性查问漏斗 ----------------------------------------------------------------
//
// 整条读入链按名取属性只走 ga 这一枚（与 docx 侧 ooxml.ts 的 attr/attrL 同一副家什）。
// 产品行为上它就是取属性的一层直通；scripts/fidelity-report-pptx.mjs 从 git HEAD
// 取一次性副本、只改写这一枚的躯体注入探针，于是运行期每一次「问过哪枚元素上的哪个名」
// 都记在账上——分子（查问过的）与分母（部件里真实存在的字面）才对得上，
// pptx 属性覆盖账才立得起来。产品源一行不改，探针只活在副本里。
//
// 带 r: 前缀的名取空时按 local name 再取一次：个别生产方把关系命名空间铺成默认命名空间
// （<blip embed="rId2" xmlns="...relationships">），前缀那一支会落空。两路记的是同一对
// （blip|embed），探针不重复计数。
function ga(el: PEl | null | undefined, name: string): string | null {
  if (!el) return null
  const v = el.attrs[name]
  if (v !== undefined || !name.startsWith('r:')) return v ?? null
  const bare = name.slice(2)
  for (const k in el.attrs) if (local(k) === bare) return el.attrs[k]
  return null
}

function childrenByName(node: PEl, name: string): PEl[] {
  return node.kids.filter((c) => c.localName === name)
}

function descendantsByName(node: PEl, name: string): PEl[] {
  const out: PEl[] = []
  const walk = (n: PEl) => {
    for (const c of n.kids) {
      if (c.localName === name) out.push(c)
      walk(c)
    }
  }
  walk(node)
  return out
}

/**
 * 前序第一枚同名后代：命中即返回，不摊平整棵子树。
 * 读手绝大多数查问是「有一枚就够」（xfrm / ph / rPr / cNvPr / tblPr / blip……），
 * 而 descendantsByName 那一支每次都要走完子树并攒一个数组——形状一多就是 O(查问数 × 子树)。
 * 与 descendantsByName(...)[0] 取到的是同一枚（同为前序）。
 */
function firstDesc(node: PEl | null | undefined, name: string): PEl | undefined {
  if (!node) return undefined
  const stack: PEl[] = [node]
  while (stack.length) {
    const n = stack.pop()!
    if (n !== node && n.localName === name) return n // 判定放在出栈时：入栈逆序 + 出栈顺序 = 文档序
    const ks = n.kids
    for (let i = ks.length - 1; i >= 0; i--) stack.push(ks[i])
  }
  return undefined
}

/**
 * v0.184：动画链两处「只关心是否存在」的查问改成**命中即停的前序遍历**。
 *
 * 原写法 `descendantsByName(...).some(...)` 每次都把整棵子树按名摊平成数组，
 * `animEffectOf` 里还是嵌套二次摊平；clickEffect 一多就是 O(查问数 × 子树)。
 * 与 v0.183 试过又回退的「惰性索引化」不同：这里不建 Map、不改数据结构、
 * 不给只查一次的子树挂缓存，只把「先收齐再判断」换成「边走边判断」——
 * 没有缓存的固定成本，也就不会在每子树只查一次的链上反而变慢。
 *
 * `legacyAnimScan` 只给同进程 A/B 对照腿用（入口设一次），产品路径恒为 false。
 */
let legacyAnimScan = false

/** 存在一枚满足 pred 的后代（不含自身）：逆序入栈 + pop = 文档序，命中即返回 */
function hasDesc(node: PEl | null | undefined, pred: (el: PEl) => boolean): boolean {
  if (!node) return false
  const stack: PEl[] = []
  for (let i = node.kids.length - 1; i >= 0; i--) stack.push(node.kids[i])
  while (stack.length) {
    const n = stack.pop()!
    if (pred(n)) return true
    for (let i = n.kids.length - 1; i >= 0; i--) stack.push(n.kids[i])
  }
  return false
}

/**
 * 原嵌套 some 的等价早停：attrName 必须是某枚 anim 的**后代**（不是任意 attrName），
 * 且文本为 ppt_x / ppt_y。inAnim 门是等价性的关键——少这一层会把 anim 外的
 * attrName 也算进来，让 fade 误判成 fly。
 */
function hasFlyXY(c: PEl): boolean {
  if (legacyAnimScan) {
    return descendantsByName(c, 'anim').some((a) =>
      descendantsByName(a, 'attrName').some((x) => textOf(x) === 'ppt_x' || textOf(x) === 'ppt_y'),
    )
  }
  const stack: { el: PEl; inAnim: boolean }[] = []
  for (let i = c.kids.length - 1; i >= 0; i--) stack.push({ el: c.kids[i], inAnim: false })
  while (stack.length) {
    const { el, inAnim } = stack.pop()!
    const inside = inAnim || el.localName === 'anim'
    if (inside && el.localName === 'attrName') {
      const t = textOf(el)
      if (t === 'ppt_x' || t === 'ppt_y') return true
    }
    for (let i = el.kids.length - 1; i >= 0; i--) stack.push({ el: el.kids[i], inAnim: inside })
  }
  return false
}

/** 出场效果：存在一枚 animEffect 后代且 transition="out" */
function hasExitEffect(c: PEl): boolean {
  if (legacyAnimScan) {
    return descendantsByName(c, 'animEffect').some((a) => ga(a, 'transition') === 'out')
  }
  return hasDesc(c, (el) => el.localName === 'animEffect' && ga(el, 'transition') === 'out')
}

// 一个 <a:p> 内的所有 <a:t> 拼接为一行
function paragraphText(p: PEl): string {
  return descendantsByName(p, 't')
    .map((t) => textOf(t))
    .join('')
}

function shapeParagraphs(sp: PEl): string[] {
  const txBody = childrenByName(sp, 'txBody')[0] ?? firstDesc(sp, 'txBody')
  if (!txBody) return []
  return childrenByName(txBody, 'p').map(paragraphText)
}

function shapeExt(sp: PEl): { x: number; y: number; w: number; h: number } | null {
  const xfrm = firstDesc(sp, 'xfrm')
  if (!xfrm) return null
  const off = childrenByName(xfrm, 'off')[0]
  const ext = childrenByName(xfrm, 'ext')[0]
  if (!off || !ext) return null
  const ex = Number(ga(off, 'x') ?? 0) / EMU_PER_IN / SLIDE_W_IN
  const ey = Number(ga(off, 'y') ?? 0) / EMU_PER_IN / SLIDE_H_IN
  const ew = Number(ga(ext, 'cx') ?? 0) / EMU_PER_IN / SLIDE_W_IN
  const eh = Number(ga(ext, 'cy') ?? 0) / EMU_PER_IN / SLIDE_H_IN
  return { x: ex, y: ey, w: ew, h: eh }
}

function phType(sp: PEl): string | null {
  const ph = firstDesc(sp, 'ph')
  return ga(ph, 'type')
}

// 形状文本的字符样式：首个 rPr（run 级）优先，退而求其次取 defRPr；对齐取首个 pPr 的 algn
function shapeStyleOf(
  sp: PEl,
  env: { colors: Record<string, string>; clrMap: Record<string, string> },
): Partial<SlideShape> {
  const out: Partial<SlideShape> = {}
  const rPr = firstDesc(sp, 'rPr') ?? firstDesc(sp, 'defRPr')
  const sz = Number(ga(rPr, 'sz') ?? NaN) // OOXML：百分之一磅
  if (Number.isFinite(sz) && sz >= 400 && sz <= 40000) out.sizePt = Math.round(sz) / 100
  if (ga(rPr, 'b') === '1') out.bold = true
  // v0.140：斜体/下划线。u 是枚举（none/sng/dbl/…），模型只有一枚布尔——
  // 「有线」即真，双线/点线降级成单线（导出侧只写得出 sng）
  if (ga(rPr, 'i') === '1') out.italic = true
  const u = ga(rPr, 'u')
  if (u && u !== 'none') out.underline = true
  if (rPr) {
    const color = solidFillToHex(childrenByName(rPr, 'solidFill')[0], env.colors, env.clrMap)
    if (color) out.color = color
  }
  const algn = ga(firstDesc(sp, 'pPr'), 'algn')
  if (algn === 'ctr') out.align = 'center'
  else if (algn === 'r') out.align = 'right'
  else if (algn === 'just') out.align = 'left'
  return out
}

/// 形状名与替代文本（v0.140）：`<p:cNvPr name= descr=>`——sp/pic/graphicFrame 各层都有自己的那一枚。
/// 名字是 PowerPoint 选择窗格与动画目标的认人凭据，descr 是屏幕阅读器念的图说
function nameOf(el: PEl): string | undefined {
  const v = ga(firstDesc(el, 'cNvPr'), 'name')
  return v && v.trim() ? v : undefined
}

function altOf(el: PEl): string | undefined {
  const v = ga(firstDesc(el, 'cNvPr'), 'descr')
  return v && v.trim() ? v : undefined
}

// bodyPr@anchor 的枚举 → 模型锚点（just/dist 在「块内垂直分布」，CSS 无从表达，不收）
const ANCHOR_MAP: Record<string, NonNullable<SlideShape['anchor']>> = {
  t: 'top',
  ctr: 'middle',
  b: 'bottom',
}

/// 文本框的垂直锚点与换行（v0.140）：`<a:bodyPr anchor="t|ctr|b" wrap="none|square">`。
/// wrap="square"（缺省）= 换行；只有 "none" 值得记——模型里 false 才是「说了话」
function bodyStyleOf(sp: PEl): { anchor?: NonNullable<SlideShape['anchor']>; wrap?: boolean } {
  const out: { anchor?: NonNullable<SlideShape['anchor']>; wrap?: boolean } = {}
  const bodyPr = firstDesc(sp, 'bodyPr')
  const anchor = ANCHOR_MAP[ga(bodyPr, 'anchor') ?? '']
  if (anchor) out.anchor = anchor
  if (ga(bodyPr, 'wrap') === 'none') out.wrap = false
  return out
}

/// EMU 列宽/行高 → 相对总和的分数（v0.140）：只留正数，和归一后恒为 1，
/// 于是 .opd 里存的是「比例」而不是绝对 EMU——换页宽照样翻得回来
function fractions(emu: number[]): number[] | undefined {
  const pos = emu.filter((v) => Number.isFinite(v) && v > 0)
  const sum = pos.reduce((a, b) => a + b, 0)
  if (!pos.length || sum <= 0) return undefined
  return pos.map((v) => v / sum)
}

// 形状盒子外观（v0.108）：spPr 的 solidFill → 底色、ln → 边框色 + 磅宽（w 是 EMU，12700=1pt）。
// noFill/渐变等不认的填充按「无」落；ln 里没有 solidFill 视作无边框
function boxStyleOf(
  sp: PEl,
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
      const wEmu = Number(ga(ln, 'w') ?? NaN)
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

/**
 * v0.175：一份 `.rels` 只解析一次。此前 `parseRels`（形状/图片的 r:embed 用）与
 * `relsEntries`（背景图、备注找 notesSlide 用）各建一棵树，主流程还为同一份
 * `slideN.xml.rels` 解压三次（形状 / 背景 / 备注各一次）。
 * 现在入口读一次、解析一次，给出 byId / entries 两种视图，三处共用。
 * 每枚属性仍走 `ga` 漏斗按名查问——查问次数少了，consulted 集合一枚不少。
 */
interface SlideRels {
  /** rels 文件是否在场（背景图那一支原来用 relsText 判空） */
  present: boolean
  byId: Map<string, string>
  entries: { id?: string; type: string; target: string }[]
}

function slideRelsOf(text: string | undefined): SlideRels {
  const out: SlideRels = { present: !!text, byId: new Map(), entries: [] }
  if (!text) return out
  const doc = parseXml(text)
  for (const r of descendantsByName(doc, 'Relationship')) {
    const id = ga(r, 'Id') ?? undefined
    const type = ga(r, 'Type') ?? ''
    const target = ga(r, 'Target') ?? ''
    out.entries.push({ id, type, target })
    if (id && target) out.byId.set(id, target)
  }
  return out
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

// theme1.xml 的 clrScheme：{dk1,lt1,accent1,...} → '#rrggbb'
function colorScheme(themeDoc: PEl): Record<string, string> {
  const out: Record<string, string> = {}
  const scheme = firstDesc(themeDoc, 'clrScheme')
  if (!scheme) return out
  for (const c of scheme.kids) {
    const srgb = childrenByName(c, 'srgbClr')[0]
    const sys = childrenByName(c, 'sysClr')[0]
    const val = ga(srgb, 'val') ?? ga(sys, 'lastClr')
    if (val) out[c.localName] = `#${val}`
  }
  return out
}

// 把一个 solidFill 元素解析成 '#rrggbb'（支持 srgbClr/sysClr/schemeClr+clrMap）
function solidFillToHex(
  fill: PEl | undefined,
  colors: Record<string, string>,
  clrMap: Record<string, string>,
): string | undefined {
  if (!fill) return undefined
  const srgb = childrenByName(fill, 'srgbClr')[0]
  if (ga(srgb, 'val')) return `#${ga(srgb, 'val')}`
  const sys = childrenByName(fill, 'sysClr')[0]
  if (ga(sys, 'lastClr')) return `#${ga(sys, 'lastClr')}`
  const scheme = ga(childrenByName(fill, 'schemeClr')[0], 'val')
  if (!scheme) return undefined
  return colors[clrMap[scheme] ?? scheme] ?? colors[scheme]
}

async function imageFromRid(
  zip: JSZip,
  rels: SlideRels,
  rid: string,
  baseDir: string,
): Promise<string | undefined> {
  const target = rels.byId.get(rid)
  if (!target) return undefined
  const mediaPath = resolveRel(baseDir, target)
  const file = zip.file(mediaPath)
  if (!file) return undefined
  const bytes = await file.async('uint8array')
  const ext = mediaPath.split('.').pop()?.toLowerCase() ?? 'png'
  return bytesToDataUri(bytes, MIME_BY_EXT[ext] ?? 'image/png')
}

// 解析 cSld/bg：母版或单页的背景（纯色或图片）
async function bgOf(
  root: PEl,
  zip: JSZip,
  rels: SlideRels,
  baseDir: string,
  colors: Record<string, string>,
  clrMap: Record<string, string>,
): Promise<{ bg?: string; bgImage?: string }> {
  const cSld = childrenByName(root, 'cSld')[0]
  const bg = cSld ? childrenByName(cSld, 'bg')[0] : undefined
  if (!bg) return {}
  const fill = firstDesc(bg, 'blipFill')
  if (fill && rels.present) {
    const blip = firstDesc(fill, 'blip')
    const rid = ga(blip, 'r:embed')
    if (rid) {
      const data = await imageFromRid(zip, rels, rid, baseDir)
      if (data) return { bgImage: data }
    }
  }
  const hex = solidFillToHex(firstDesc(bg, 'solidFill'), colors, clrMap)
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

// theme1.xml 的 fontScheme：major/minor 的 latin 字族（v0.140）。名字（@name）不读——
// 主题名不参与呈现，字族名才是换机器后会回落的东西
function fontSchemeOf(themeDoc: PEl): { majorFont?: string; minorFont?: string } {
  const out: { majorFont?: string; minorFont?: string } = {}
  const scheme = firstDesc(themeDoc, 'fontScheme')
  if (!scheme) return out
  for (const c of scheme.kids) {
    if (c.localName !== 'majorFont' && c.localName !== 'minorFont') continue
    const latin = childrenByName(c, 'latin')[0]
    const face = ga(latin, 'typeface')
    if (face && face.trim()) out[c.localName === 'majorFont' ? 'majorFont' : 'minorFont'] = face
  }
  return out
}

// 母版：背景（色/图）+ 主题色 + 标题/正文占位几何
async function parseMaster(zip: JSZip): Promise<{
  master: MasterStyle
  colors: Record<string, string>
  clrMap: Record<string, string>
}> {
  let colors: Record<string, string> = {}
  let fonts: { majorFont?: string; minorFont?: string } = {}
  const themeFile = zip.file('ppt/theme/theme1.xml')
  if (themeFile) {
    const themeDoc = parseXml(await themeFile.async('string'))
    colors = colorScheme(themeDoc)
    fonts = fontSchemeOf(themeDoc)
  }
  const masterFile = zip.file('ppt/slideMasters/slideMaster1.xml')
  if (!masterFile) return { master: {}, colors, clrMap: {} }
  const root = parseXml(await masterFile.async('string'))
  const clrMapEl = firstDesc(root, 'clrMap')
  const clrMap: Record<string, string> = {}
  // 照单全收也按名逐枚问：clrMap 上有哪些名是文件说的，每一个名的值都过 ga 漏斗——
  // 探针的分子这才看得见这一族查问（直接读 a.value 就绕过了漏斗）
  if (clrMapEl)
    for (const a of Object.keys(clrMapEl.attrs)) clrMap[local(a)] = ga(clrMapEl, local(a)) ?? clrMapEl.attrs[a]

  const masterRelText = await zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels')?.async('string')
  const master: MasterStyle = {}
  // v0.175：母版 rels 与每页 rels 走同一个解析器；母版全库只有一份，
  // 这里多建一棵小树的代价远小于给 bgOf 再开一条「字符串 vs 索引」的分支
  const bg = await bgOf(
    root,
    zip,
    slideRelsOf(masterRelText),
    'ppt/slideMasters',
    colors,
    clrMap,
  )
  if (bg.bg) master.bg = bg.bg
  if (bg.bgImage) master.bgImage = bg.bgImage
  if (fonts.majorFont) master.majorFont = fonts.majorFont
  if (fonts.minorFont) master.minorFont = fonts.minorFont

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
async function parseNotes(zip: JSZip, rels: SlideRels): Promise<string | undefined> {
  // v0.175：不再为备注单独解压一次同一份 .rels；入口那份索引里已有 notesSlide 关系
  if (!rels.present) return undefined
  const rel = rels.entries.find((e) => /\/notesSlide$/.test(e.type))
  if (!rel?.target) return undefined
  const notesPath = resolveRel('ppt/slides', rel.target)
  const notesFile = zip.file(notesPath)
  if (!notesFile) return undefined
  const root = parseXml(await notesFile.async('string'))
  const lines: string[] = []
  for (const sp of descendantsByName(root, 'sp')) {
    const ph = phType(sp)
    if (ph === 'sldImg' || ph === 'sldNum' || ph === 'dt' || ph === 'ftr') continue
    for (const line of shapeParagraphs(sp)) if (line.trim()) lines.push(line)
  }
  const text = lines.join('\n').trim()
  return text || undefined
}

// <p:transition spd="med" advTm="5000"><p:fade/></p:transition>：效果名 + 自动换页毫秒数。
// v0.140 加 advClick：显式 "0" = 点击不换页（这类页若无 advTm 就只剩自动翻一条路）——
// 「没说话」（缺省）与「点击翻页」（"1"）在文件里同义，模型只记说了话的那一半
function parseTransition(root: PEl): {
  transition?: SlideTransition
  autoAdvance?: number
  advClick?: boolean
} {
  const tr = firstDesc(root, 'transition')
  if (!tr) return {}
  const out: { transition?: SlideTransition; autoAdvance?: number; advClick?: boolean } = {}
  const advTm = Number(ga(tr, 'advTm') ?? 0)
  if (Number.isFinite(advTm) && advTm >= 1000 && advTm <= 3_600_000)
    out.autoAdvance = Math.round(advTm / 1000)
  if (ga(tr, 'advClick') === '0') out.advClick = false
  for (const c of tr.kids) {
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

function flyStartDir(effect: PEl): AnimDir | undefined {
  for (const sv of descendantsByName(effect, 'strVal')) {
    const v = textOf(sv).replace(/\s+/g, '')
    if (v.startsWith('#+y')) return 'bottom'
    if (v.startsWith('#-y')) return 'top'
    if (v.startsWith('#-x')) return 'left'
    if (v.startsWith('#+x')) return 'right'
  }
  return undefined
}

/// 形状的 spid：`<p:cNvPr id="N">`（sp/pic 都是这一枚，且都在自己那一层里）
function spidOf(el: PEl): string | undefined {
  return ga(firstDesc(el, 'cNvPr'), 'id') ?? undefined
}

/// 一枚 clickEffect 的效果：filter 判定 wipe/fade，`ppt_x`/`ppt_y` 位移判定 fly，
/// 方向按 presetSubtype → 滤镜名 → 起始位移三路认。
/// v0.140 加 dur：效果行为自己的 cTn 上的毫秒数（50ms~10min 外不收）——
/// 没有 animEffect 的淡入（set/visibility 那一支）dur="1" 是瞬时显隐，不是时长，不读
function animEffectOf(c: PEl): { anim: BulletAnim; dir?: AnimDir; dur?: number } {
  const effect = firstDesc(c, 'animEffect')
  const filter = (ga(effect, 'filter') ?? '').toLowerCase()
  let anim: BulletAnim
  if (filter.startsWith('wipe')) anim = 'wipe'
  else if (filter.startsWith('fade')) anim = 'fade'
  else if (hasFlyXY(c)) anim = 'fly'
  else anim = 'fade'
  const dur = Number(ga(effect ? firstDesc(effect, 'cTn') : undefined, 'dur') ?? NaN)
  const durOk = Number.isFinite(dur) && dur >= 50 && dur <= 600_000 ? Math.round(dur) : undefined
  if (anim === 'fade') return { anim, ...(durOk ? { dur: durOk } : {}) }
  const dir =
    SUBTYPE_DIR[Number(ga(c, 'presetSubtype') ?? 0)] ??
    WIPE_FILTER_DIR[filter] ??
    flyStartDir(c)
  return dir ? { anim, dir, ...(durOk ? { dur: durOk } : {}) } : { anim, ...(durOk ? { dur: durOk } : {}) }
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
  root: PEl,
  shapeSpids: string[],
): {
  anim?: BulletAnim
  animDir?: AnimDir
  exitAnim?: BulletExit
  animDur?: number
  order: string[]
  shapeAnims: Map<number, { anim: BulletAnim; animDir?: AnimDir; exitAnim?: BulletExit; dur?: number }>
} {
  const empty = {
    order: [] as string[],
    shapeAnims: new Map<number, { anim: BulletAnim; animDir?: AnimDir; exitAnim?: BulletExit; dur?: number }>(),
  }
  const timing = childrenByName(root, 'timing')[0]
  if (!timing) return empty
  const bodySpid = ga(firstDesc(timing, 'bldP'), 'spid') ?? undefined
  const clicks = descendantsByName(timing, 'cTn').filter(
    (c) => ga(c, 'nodeType') === 'clickEffect',
  )
  const out: {
    anim?: BulletAnim
    animDir?: AnimDir
    exitAnim?: BulletExit
    animDur?: number
    order: string[]
    shapeAnims: Map<number, { anim: BulletAnim; animDir?: AnimDir; exitAnim?: BulletExit; dur?: number }>
  } = empty
  const shapeAt = (spid: string) => {
    const i = shapeSpids.indexOf(spid)
    return i < 0 ? undefined : i
  }
  let bodySeen = 0
  for (const c of clicks) {
    const spid = ga(firstDesc(c, 'spTgt'), 'spid')
    if (!spid) continue
    if (ga(c, 'presetClass') === 'exit') {
      if (!hasExitEffect(c)) continue
      if (spid === bodySpid) out.exitAnim = 'fade'
      else {
        const i = shapeAt(spid)
        if (i !== undefined) out.shapeAnims.set(i, { ...(out.shapeAnims.get(i) ?? { anim: 'fade' }), exitAnim: 'fade' })
      }
      continue
    }
    if (ga(c, 'presetClass') !== 'entr') continue
    const eff = animEffectOf(c)
    if (spid === bodySpid) {
      out.anim = eff.anim
      if (eff.dir) out.animDir = eff.dir
      if (eff.dur) out.animDur = eff.dur
      out.order.push(`l${bodySeen++}`)
    } else {
      const i = shapeAt(spid)
      if (i !== undefined) {
        out.shapeAnims.set(i, {
          ...(out.shapeAnims.get(i) ?? { anim: eff.anim }),
          anim: eff.anim,
          ...(eff.dir ? { animDir: eff.dir } : {}),
          ...(eff.dur ? { dur: eff.dur } : {}),
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
  const root = parseXml(text)
  // v0.175：同一页的 `slideN.xml.rels` 只解压 + 解析一次。此前形状（r:embed）、
  // 单页背景图、演讲者备注三条路各读各解析，一页三次；60 页的件就是 180 次。
  // 这份索引随本页一路传下去，三处共用。
  const relsText = await zip
    .file(slideXml.name.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels'))
    ?.async('string')
  const rels = slideRelsOf(relsText)

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
    const ordered: PEl[] = []
    const walk = (n: PEl) => {
      for (const c of n.kids) {
        if (c.localName === 'sp' || c.localName === 'pic' || c.localName === 'graphicFrame')
          ordered.push(c)
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
          // v0.140：锚点/换行（bodyPr）+ 形状名/替代文本（cNvPr）
          Object.assign(sh, bodyStyleOf(el))
          const nm = nameOf(el)
          if (nm) sh.name = nm
          const alt = altOf(el)
          if (alt) sh.alt = alt
          shapes.push(sh)
          shapeSpids.push(spidOf(el) ?? '')
          continue
        }
        boxes.push({ lines, y: pos ? pos.y : 999, ph })
      } else if (el.localName === 'graphicFrame') {
        // PowerPoint 原生表格（v0.127）：<a:tbl> → 表格形状，位置取 graphicFrame 自己的 xfrm。
        // 首行是不是表头由 <a:tblPr firstRow="1"> 说了算。
        // 图表（<c:chart>）这一片**不接**：它的数据住在另一份 chartN.xml 里，硬读进来
        // 也只能落一张改不了的死图，宁可这一枚形状不认，其余照常导入。
        const tbl = firstDesc(el, 'tbl')
        if (!tbl) continue
        const pos = shapeExt(el)
        if (!pos) continue
        const rows = childrenByName(tbl, 'tr').map((tr) =>
          childrenByName(tr, 'tc').map((tc) =>
            descendantsByName(tc, 't')
              .map((t) => textOf(t))
              .join('')
              .trim(),
          ),
        )
        if (!rows.length || !rows.some((r) => r.some((c) => c))) continue
        const tblPr = firstDesc(tbl, 'tblPr')
        // v0.140：列宽/行高按 EMU 读进来折成比例（和归一），隔行底纹读 bandRow
        const grid = childrenByName(tbl, 'tblGrid')[0]
        const colW = grid ? fractions(childrenByName(grid, 'gridCol').map((c) => Number(ga(c, 'w') ?? 0))) : undefined
        const rowH = fractions(childrenByName(tbl, 'tr').map((tr) => Number(ga(tr, 'h') ?? 0)))
        const sh: SlideShape = {
          id: newId(),
          kind: 'table',
          ...pos,
          table: {
            rows,
            hasHeader: ga(tblPr, 'firstRow') === '1',
            ...(colW ? { colW } : {}),
            ...(rowH ? { rowH } : {}),
            ...(ga(tblPr, 'bandRow') === '1' ? { bandRow: true } : {}),
          },
        }
        const nm = nameOf(el)
        if (nm) sh.name = nm
        const alt = altOf(el)
        if (alt) sh.alt = alt
        shapes.push(sh)
        shapeSpids.push(spidOf(el) ?? '')
      } else {
        // 图片：一律进形状层（v0.107）——位置原样保住，不再有「第一张塞版式槽、其余丢弃」的
        // 有损近似；版式槽的 image 只留给用户在图片页手工插入与单页背景图回退
        const blip = firstDesc(el, 'blip')
        const embed = ga(blip, 'r:embed')
        if (!embed) continue
        const target = rels.byId.get(embed)
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
        const nm = nameOf(el) // v0.140：图片也带名与替代文本（PowerPoint 选择窗格认得出）
        if (nm) sh.name = nm
        const alt = altOf(el)
        if (alt) sh.alt = alt
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
  let advClick: boolean | undefined
  try {
    // v0.175：背景与备注都吃入口那份 rels 索引，不再各自解压/解析同一份 .rels
    const slideBg = await bgOf(root, zip, rels, 'ppt/slides', env.colors, env.clrMap)
    bg = slideBg.bg
    notes = await parseNotes(zip, rels)
    ;({ transition, autoAdvance, advClick } = parseTransition(root))
    if (slideBg.bgImage && !image) {
      // 单页背景图当作整页图片还原
      image = slideBg.bgImage
      layout = 'image'
    }
  } catch (e) {
    console.warn('页背景/备注解析失败，忽略', e)
  }

  const { anim, animDir, exitAnim, animDur, order, shapeAnims } = parseAnim(root, shapeSpids)
  // 形状动画按 spid 归位：出场那条可能先于入场被遇到，两条并进同一格
  for (const [i, a] of shapeAnims) {
    const sh = shapes[i]
    if (!sh) continue
    sh.anim = a.anim
    if (a.animDir) sh.animDir = a.animDir
    if (a.exitAnim) sh.exitAnim = a.exitAnim
    if (a.dur) sh.animDur = a.dur
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
    animDur,
    autoAdvance,
    advClick,
    animOrder,
    ...(shapes.length ? { shapes } : {}),
  }
}

export async function pptxBytesToDeck(
  bytes: Uint8Array,
  opts?: { legacyAnimScan?: boolean },
): Promise<Deck> {
  // v0.184：A/B 对照腿只切这一个开关；不传（产品路径）走命中即停的早停遍历
  legacyAnimScan = !!opts?.legacyAnimScan
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
