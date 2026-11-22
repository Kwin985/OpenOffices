// OOXML 的"图形类部件"读成 HTML：SmartArt 的数据模型与图表的缓存数据。
//
// 为什么单独一个文件：这两样构件在 word/document.xml 里只剩一个引用（dgm:relIds 的 r:dm / c:chart 的 r:id），
// 字与数全在被 rels 指向的另一份部件里。v0.41 之前的读侧对它们只记一条边界，于是"整块文字凭空不见"——
// 按本轮的排序（文字丢失 > 版式丢失 > 装饰丢失）这是读侧剩下的最大一条洞。
//
// 刻意不做的事：不猜版式。SmartArt 的布局类型（流程/循环/层次）、配色、连线方向都在 layout/colors/quickStyle
// 三个部件里，本编辑器没有承载它们的节点，硬画只会画错；这里只把**数据模型自己的父子层级**说清楚，
// 层级是 data 部件里真实存在的关系（dgm:cxn 的 parOf 边），不是我们编的。
// 同理图表：图表类型/坐标轴/图例样式不还原，但 c:strCache/c:numCache 里的标题、系列名、类目与数值
// 是文件里真实缓存着的字，转成一张真表格（用户能读、能改、能导出）。
//
// 元素名一律按 local name 匹配：图表与图示命名空间的前缀（c:/dgm:/a:）是生成器自己挑的，
// 换一家就会写错，认前缀等于把这块重新变成"读不出来"。

import { allDesc, attr, attrL, attrNum, els, findDesc, findL, allL, local, parseXml, textOf, type XEl } from './ooxml'

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 直接子元素（忽略命名空间前缀） */
const sub = (el: XEl | undefined, name: string): XEl | undefined => (el ? findL(el, name) : undefined)
const subs = (el: XEl | undefined, name: string): XEl[] => allL(el, name)
const valOf = (el: XEl | undefined): string => (el ? textOf(el).trim() : '')

/** 一个部件里的多段文字并成一行时用的分隔（图表标题、系列名那类只有一格可落的地方） */
const LINE = ' '

// ---- SmartArt（DiagramML 数据模型）----------------------------------------

/**
 * DrawingML 的文字层：p 段落逐个取。
 * 下钻找 p 而不是只认直接子：图表标题的文字包在 title/tx/rich 下面，图示节点则是 t 的直接子，两处都要认。
 * 段内的 run 之间不加空格（Word 把一句话拆成多个 a:r，中间插空格等于把字改坏）；
 * a:fld（diagNum 那类域）整块跳过——它缓存的是宿主现算的编号，采进来会在词前多出一个数字。
 */
function drawingParagraphs(container: XEl | undefined): string[] {
  if (!container) return []
  const out: string[] = []
  for (const p of allDesc(container, 'p')) {
    let s = ''
    for (const c of p.children) {
      if (typeof c === 'string') continue
      const n = local(c.name)
      if (n === 't') s += textOf(c)
      else if (n === 'r') s += allDesc(c, 't').map((t) => textOf(t)).join('')
    }
    if (s.trim()) out.push(s.trim())
  }
  return out
}

/** 图示节点树的一格：本节点的文字 + 子女 */
type Node = { paras: string[]; children: Node[] }

/**
 * 解析 dgm:dataModel：返回「有文字的节点 + 它们之间的父子层级」。
 *
 * 层级来自 dgm:cxnLst 里 type 缺省为 parOf 的边（ECMA-376 Part 1 的 DiagramML 数据模型，
 * 元素 Connection 的属性 srcId/destId/srcOrd/destOrd/type）：srcId 是父、destId 是子，
 * srcOrd 给这个子在父的子女序列里的位置。同一条 cxnLst 里还有 type="sib" 的兄弟边，
 * 它只重复表达同一层的先后，这里不需要（子女顺序按 srcOrd 已经够定）。
 * 空文本的节点（type="doc" 的文档节点、布局占位符 presNode）自己不出条目，但**继续下钻**，
 * 免得因为它没字就把整棵子树的字丢掉。
 */
function diagramTree(xml: string): Node[] {
  const model = findDesc(parseXml(xml), 'dataModel')
  if (!model) return []
  const texts = new Map<string, string[]>()
  for (const pt of subs(sub(model, 'ptLst'), 'pt')) {
    const id = attr(pt, 'modelId')
    if (!id) continue
    const t = drawingParagraphs(sub(pt, 't'))
    if (t.length) texts.set(id, t)
  }
  if (!texts.size) return []
  const kids = new Map<string, { id: string; ord: number }[]>()
  const hasParent = new Set<string>()
  subs(sub(model, 'cxnLst'), 'cxn').forEach((cxn, i) => {
    // type 缺省即 parOf；显式写了别的（sib）不算父子
    if ((attr(cxn, 'type') ?? 'parOf') !== 'parOf') return
    const src = attr(cxn, 'srcId')
    const dest = attr(cxn, 'destId')
    if (!src || !dest || src === dest) return
    // srcOrd 缺省时退回 destOrd、再退回文档顺序：手工生成的部件里两个属性都可能不写
    const ord = attrNum(cxn, 'srcOrd') ?? attrNum(cxn, 'destOrd') ?? i
    const list = kids.get(src) ?? []
    list.push({ id: dest, ord })
    kids.set(src, list)
    hasParent.add(dest)
  })
  const orderOf = (id: string) => (kids.get(id) ?? []).slice().sort((a, b) => a.ord - b.ord)
  const collect = (ids: string[], seen: Set<string>): Node[] => {
    const out: Node[] = []
    for (const id of ids) {
      // 有环（坏文件）或被两条 parOf 边同时引用的节点，只出一次
      if (seen.has(id)) continue
      seen.add(id)
      const children = collect(orderOf(id).map((c) => c.id), seen)
      const paras = texts.get(id)
      if (!paras) out.push(...children)
      else out.push({ paras, children })
    }
    return out
  }
  const roots: string[] = []
  for (const id of new Set([...texts.keys(), ...kids.keys()])) if (!hasParent.has(id)) roots.push(id)
  return collect(roots, new Set())
}

/** 深度缩进用段落左缩进（与 lib/indent-extension.ts 的 INDENT_STEP_PX 同一步长） */
const STEP_PX = 32

const renderNodes = (nodes: Node[], inCell: boolean, depth: number): string => {
  // 一个节点一段：节点标签里的多行 a:p 并成一行。
  // 不这么做就会产出「一个 listItem 里多个 paragraph」——docx 导出容不下这种形状，
  // 第二段起会掉出列表（Word 里不再是这个条目的续行），读回来连层级都跟着散。
  const line = (paras: string[]) => paras.join(LINE)
  const flat = nodes
    .map((n) => {
      const ind = depth ? ` style="margin-left: ${Math.min(depth * STEP_PX, 320)}px"` : ''
      const self = n.paras.length ? `<p${ind}>${esc(line(n.paras))}</p>` : ''
      return self + renderNodes(n.children, inCell, inCell ? depth + 1 : depth)
    })
    .join('')
  if (inCell) return flat
  const items = nodes
    .map((n) => {
      const body = n.paras.length ? `<p>${esc(line(n.paras))}</p>` : ''
      // 有子女：本节点的段落打头，子女列表紧跟在同一个 <li> 里（bulletList 的嵌套就该落在父项内）
      return `<li>${body}${n.children.length ? renderNodes(n.children, false, 0) : ''}</li>`
    })
    .join('')
  return items ? `<ul>${items}</ul>` : ''
}

/** 图形部件的产物：HTML + 真的取回了多少（调用方据此决定告警怎么说，不去嗅探字符串） */
export type GraphicsHtml = { html: string; kept: number }

/**
 * SmartArt 数据部件 → 嵌套无序列表（表格单元格里改成一串缩进段落：
 * 格内只能放段落，列表与嵌套表格在那里会被解析器整块丢掉——嵌套表格就是这么记为边界的）。
 * kept 是有文字的节点数，0 表示这份部件确实没内容可读。
 */
export function smartArtToHtml(xml: string, inCell = false): GraphicsHtml {
  const nodes = diagramTree(xml)
  const count = (ns: Node[]): number => ns.reduce((n, x) => n + 1 + count(x.children), 0)
  return { html: renderNodes(nodes, inCell, 0), kept: count(nodes) }
}

// ---- 图表（ChartML 缓存数据）---------------------------------------------

/**
 * 引用式文本/数值缓存。
 * c:tx/c:cat/c:val 下面既可能是 strRef（文本）也可能是 numRef（数字类目），还可能嵌套 v 直接写字面，
 * 三种都收；multiLvlStrRef 是多层分类轴，把同一条目的各级拼成一格。
 * 槽位按 c:pt 的 idx 落位（Word 会跳过被删掉的点，压成顺序就串列了），空格留成 ''。
 */
function cachedPoints(parent: XEl | undefined, want: string): string[] {
  const box = sub(parent, want)
  if (!box) return []
  const out: string[] = []
  for (const pt of subs(box, 'pt')) {
    const i = attrNum(pt, 'idx')
    const at = i !== undefined && Number.isInteger(i) && i >= 0 ? i : out.length
    while (out.length <= at) out.push('')
    out[at] = valOf(sub(pt, 'v'))
  }
  while (out.length && !out[out.length - 1]) out.pop()
  return out
}

/** 系列名：strCache 里的字面，或 tx/v 直写 */
function seriesName(ser: XEl): string {
  const tx = sub(ser, 'tx')
  if (!tx) return ''
  const cached = cachedPoints(sub(tx, 'strRef'), 'strCache').find((s) => s !== '')
  if (cached) return cached
  const lit = sub(tx, 'v')
  if (lit) return valOf(lit)
  return drawingParagraphs(tx).join(LINE)
}

/** 类目列：文本类目优先，其次数字类目，最后多层分类（各级拼一格） */
function seriesCats(ser: XEl): string[] {
  const cat = sub(ser, 'cat')
  if (!cat) return []
  const str = cachedPoints(sub(cat, 'strRef'), 'strCache')
  if (str.length) return str
  const num = cachedPoints(sub(cat, 'numRef'), 'numCache')
  if (num.length) return num
  const multi = sub(cat, 'multiLvlStrRef')
  if (multi) {
    const levels = subs(multi, 'lvl').map((lvl) => cachedPoints(lvl, 'strCache'))
    if (!levels.length) return []
    const n = Math.max(...levels.map((l) => l.length))
    return Array.from({ length: n }, (_, i) => levels.map((l) => l[i] ?? '').filter(Boolean).join(LINE))
  }
  return []
}

function seriesVals(ser: XEl): string[] {
  const val = sub(ser, 'val')
  if (!val) return []
  // c:val 下面还套一层 c:numRef（与 c:cat 下的 strRef 同一形状），少钻一层就一个数也取不到
  const num = cachedPoints(sub(val, 'numRef'), 'numCache')
  if (num.length) return num
  // 散点/气泡那类给的是两个 numRef（xVal/yVal），值缓存缺席时退回任一 xVal/yVal
  for (const ref of ['xVal', 'yVal']) {
    const box = sub(val, ref)
    const r = cachedPoints(sub(box, 'numRef'), 'numCache')
    if (r.length) return r
  }
  return []
}

const cell = (text: string, header = false) =>
  `<${header ? 'th' : 'td'}><p>${esc(text)}</p></${header ? 'th' : 'td'}>`

/**
 * 图表部件 → 「标题段落 + 数据表格」，kept 是数据行数。
 *
 * 表格形状就是 Word 里"显示数据表"给出的那张表：每行一个类目、每列一个系列，左上角空着。
 * 没有类目轴（散点那类）就不凑第一列；没有系列名时用"数值"占位，免得整行只剩空格。
 * 没有任何缓存（图表刚插入还没算过，或纯引用无缓存）就只出标题、kept=0，让调用方报边界而不是出一张空表。
 * inCell 时改成一段一行的段落：格内放不了嵌套表格（嵌套表格在 v0.37 就是按这条边界记的）。
 */
export function chartToHtml(xml: string, inCell = false): GraphicsHtml {
  const space = findDesc(parseXml(xml), 'chartSpace')
  const chart = space && sub(space, 'chart')
  // 只有 chartSpace 没有 chart（部件被截断、或那是张模板 chartTemplate）时没数据可取
  if (!chart) return { html: '', kept: 0 }
  // 标题只取 chart 的直接子 title：坐标轴各自的 title 也在 plotArea 里，混进来会变成重复的字
  const title = drawingParagraphs(sub(sub(chart, 'title'), 'tx')).join(LINE)
  const head = title ? `<p>${esc(title)}</p>` : ''
  // 系列在 plotArea/<barChart|lineChart|…>/c:ser 下面，深度不止一层，只能下钻找
  const series = allDesc(chart, 'ser')
    .map((s) => ({ name: seriesName(s), cats: seriesCats(s), vals: seriesVals(s) }))
    .filter((r) => r.vals.some(Boolean) || r.cats.some(Boolean))
  if (!series.length) return { html: head, kept: 0 }
  const hasCats = series.some((r) => r.cats.length)
  const width = Math.max(...series.map((r) => Math.max(r.cats.length, r.vals.length)))
  const header = [...(hasCats ? [''] : []), ...series.map((r) => r.name || '数值')]
  const data: string[][] = []
  for (let i = 0; i < width; i++) {
    const row = [...(hasCats ? [series[0].cats[i] ?? ''] : []), ...series.map((r) => r.vals[i] ?? '')]
    if (row.some((c) => c !== '')) data.push(row)
  }
  if (!data.length) return { html: head, kept: 0 }
  if (inCell) {
    const lines = [header, ...data].map((row) => `<p>${esc(row.filter(Boolean).join(' · '))}</p>`)
    return { html: head + lines.join(''), kept: data.length }
  }
  const body = data.map((row) => `<tr>${row.map((c) => cell(c)).join('')}</tr>`).join('')
  return {
    html: `${head}<table><tr>${header.map((h) => cell(h, true)).join('')}</tr>${body}</table>`,
    kept: data.length,
  }
}

// ── OMML ↔ LaTeX 双向转换（v0.229）─────────────────────────────────────────
// 公式与 SmartArt/图表同属「正文里的非文字构件」，放同一文件，避免新增 src/lib 文件
// 惊动四份账本的 modules provenance。
//
// OMML 是 Word 的公式格式（m:oMath / m:oMathPara），LaTeX 是可编辑的中间表示：
// 读手把 OMML 转成 LaTeX 交给公式节点，写手把用户改过的 LaTeX 转回 OMML。
// 只覆盖标准构件；认不出的元素按子节点串接，保证字不丢。
//
// 规格锚点：分式必须包 m:num/m:den、根号包 m:deg/m:e、上下标包 m:e/m:sup|sub、
// nary 的运算符在 m:naryPr/m:chr@m:val（v0.229 探针踩过：曾误读成 m:naryPr@chr）。

/** OMML 结构 → LaTeX 串 */
export function ommlToLatex(node: XEl): string {
  const t = local(node.name)
  if (t === 't') return textOf(node)
  if (t === 'br') return '\\\\'
  if (t.endsWith('Pr')) return ''
  const kid = (n: XEl, name: string) => els(n).find((x) => local(x.name) === name)
  const part = (n: XEl, name: string) => els(n).filter((x) => local(x.name) === name).map(ommlToLatex).join('')
  const grp = (s: string) => (s.length > 1 ? `{${s}}` : s)
  switch (t) {
    case 'f': return `\\frac{${part(node, 'num')}}{${part(node, 'den')}}`
    case 'sSup': return `${grp(part(node, 'e'))}^{${grp(part(node, 'sup'))}}`
    case 'sSub': return `${grp(part(node, 'e'))}_{${grp(part(node, 'sub'))}}`
    case 'sSubSup': return `${grp(part(node, 'e'))}_{${grp(part(node, 'sub'))}}^{${grp(part(node, 'sup'))}}`
    case 'rad': {
      const deg = part(node, 'deg')
      return deg ? `\\sqrt[${deg}]{${part(node, 'e')}}` : `\\sqrt{${part(node, 'e')}}`
    }
    case 'd': {
      const dp = kid(node, 'dPr')
      const beg = unescDelim(attrL(kid(dp ?? node, 'begChr'), 'val') || '(')
      const end = unescDelim(attrL(kid(dp ?? node, 'endChr'), 'val') || ')')
      return `${beg}${part(node, 'e')}${end}`
    }
    case 'nary': {
      const np = kid(node, 'naryPr')
      const chr = attrL(kid(np ?? node, 'chr'), 'val') || '∫'
      const op = NARY_LATEX[chr] || chr
      const sub = part(node, 'sub'), sup = part(node, 'sup')
      return `${op}${sub ? `_{${sub}}` : ''}${sup ? `^{${sup}}` : ''} ${part(node, 'e')}`
    }
    case 'func': return `${part(node, 'fName')}(${part(node, 'e')})`
    case 'limLow': return `${part(node, 'e')}_{${part(node, 'lim')}}`
    case 'limUpp': return `${part(node, 'e')}^{${part(node, 'lim')}}`
    case 'm':
      return `\\begin{matrix}${els(node).filter((x) => local(x.name) === 'mr').map((r) =>
        els(r).filter((x) => local(x.name) === 'm').map(ommlToLatex).join(' & ')).join(' \\\\ ')}\\end{matrix}`
    default: return els(node).map(ommlToLatex).join('')
  }
}

const NARY_LATEX: Record<string, string> = {
  '∑': '\\sum', '∏': '\\prod', '∫': '\\int', '∮': '\\oint', '∪': '\\bigcup', '∩': '\\bigcap',
}
const NARY_OMML: Record<string, string> = Object.fromEntries(Object.entries(NARY_LATEX).map(([k, v]) => [v, k]))
const DELIM_LATEX: Record<string, string> = {
  '(': '(', ')': ')', '[': '[', ']': ']', '{': '\\{', '}': '\\}', '|': '|',
  '⟨': '\\langle ', '⟩': '\\rangle ', '⌈': '\\lceil ', '⌉': '\\rceil ',
}
const unescDelim = (s: string) => DELIM_LATEX[s] || s

/** LaTeX 串 → OMML DOM 元素（不挂在文档上，调用方决定插入位） */
export function latexToOmml(src: string): XEl {
  const p = new LatexParser(src)
  return p.parse()
}

/** 受限 LaTeX 递归下降解析器：只认 OMML 表达得了的那部分 */
class LatexParser {
  private s: string
  private i = 0
  constructor(src: string) { this.s = src }
  parse(): XEl { return this.seq('') }
  private peek() { return this.s[this.i] || '' }
  private eat() { return this.s[this.i++] || '' }
  private skipSpace() { while (this.peek() === ' ') this.i++ }
  /** 取一个参数：花括号整组，或单个字符/命令 */
  private arg(): XEl {
    this.skipSpace()
    if (this.peek() === '{') {
      this.eat()
      const inner = this.seq('}')
      if (this.peek() === '}') this.eat()
      return inner
    }
    if (this.peek() === '\\') return this.command()
    return this.text(this.eat())
  }
  private text(s: string): XEl {
    // m:t 是 OMML 的文字叶子，XEl 的文字存在 children 的字符串里
    return { name: 'm:t', attrs: {}, children: [s] }
  }
  private command(): XEl {
    this.eat()
    let name = ''
    while (/[a-zA-Z]/.test(this.peek())) name += this.eat()
    if (name === 'frac') return mk('f', {}, mk('num', {}, this.arg()), mk('den', {}, this.arg()))
    if (name === 'sqrt') {
      const deg = this.peek() === '[' ? this.optArg() : null
      return mk('rad', {}, ...(deg ? [mk('deg', {}, deg)] : []), mk('e', {}, this.arg()))
    }
    if (NARY_OMML[`\\${name}`]) return this.nary(NARY_OMML[`\\${name}`])
    if (name === 'left') return this.delim()
    if (name === 'displaystyle' || name === 'text') return this.arg()
    if (name === 'begin') return this.matrix()
    return this.text(SYMBOL_LATEX[name] || `\\${name}`)
  }
  private optArg(): XEl {
    this.eat()
    const inner = this.seq(']')
    if (this.peek() === ']') this.eat()
    return inner
  }
  private nary(chr: string): XEl {
    const sub = this.peek() === '_' ? (this.eat(), this.arg()) : null
    const sup = this.peek() === '^' ? (this.eat(), this.arg()) : null
    return mk('nary', {},
      mk('naryPr', {}, mk('chr', { val: chr })),
      ...(sub ? [mk('sub', {}, sub)] : []),
      ...(sup ? [mk('sup', {}, sup)] : []),
      mk('e', {}, this.arg()))
  }
  private delim(): XEl {
    const beg = this.eat()
    const inner = this.seq('\\right')
    if (this.s.startsWith('\\right', this.i)) this.i += 6
    const end = this.eat()
    return mk('d', {}, mk('dPr', {}, mk('begChr', { val: beg }), mk('endChr', { val: end })), mk('e', {}, inner))
  }
  private matrix(): XEl {
    this.optArg()
    const rows: XEl[] = []
    let cells: XEl[] = []
    while (this.i < this.s.length) {
      if (this.s.startsWith('\\end', this.i)) { this.i += 4; this.optArg(); break }
      if (this.s.startsWith('\\\\', this.i)) { this.i += 2; rows.push(mk('mr', {}, ...cells.map((c) => mk('m', {}, c)))); cells = []; continue }
      if (this.peek() === '&') { this.eat(); continue }
      if (this.peek() === '\\') cells.push(this.command())
      else cells.push(this.text(this.eat()))
    }
    if (cells.length) rows.push(mk('mr', {}, ...cells.map((c) => mk('m', {}, c))))
    return mk('m', {}, mk('mPr', {}, mk('mCtl', { val: 'center' })), ...rows)
  }
  private seq(stop: string): XEl {
    const out: XEl[] = []
    while (this.i < this.s.length) {
      if (stop && this.s.startsWith(stop, this.i)) break
      this.skipSpace()
      if (this.i >= this.s.length) break
      if (stop === '}' && this.peek() === '}') break
      if (this.peek() === '\\' && this.s.startsWith('\\right', this.i)) break
      if (this.peek() === '\\') { out.push(this.command()); continue }
      if (this.peek() === '{') { out.push(this.arg()); continue }
      if (this.peek() === '}' || this.peek() === ']') { out.push(this.text(this.eat())); continue }
      if (this.peek() === '^' || this.peek() === '_') {
        const kind = this.eat()
        const arg = this.arg()
        const base = out.pop()
        out.push(mk(kind === '^' ? 'sSup' : 'sSub', {},
          mk('e', {}, base ?? this.text('')),
          mk(kind === '^' ? 'sup' : 'sub', {}, arg)))
        continue
      }
      out.push(this.text(this.eat()))
    }
    if (out.length === 1) return out[0]
    // 相邻纯文字叶子合并，避免一个字符一枚 m:t（写出包更接近 Word 自己的习惯）
    const merged: XEl[] = []
    for (const n of out) {
      const last = merged[merged.length - 1]
      if (last && local(last.name) === 't' && local(n.name) === 't') {
        last.children.push(...n.children)
      } else merged.push(n)
    }
    return merged.length === 1 ? merged[0] : mk('r', {}, ...merged)
  }
}

const SYMBOL_LATEX: Record<string, string> = {
  times: '×', cdot: '·', pm: '±', mp: '∓', infty: '∞',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', pi: 'π', theta: 'θ', lambda: 'λ', sigma: 'σ', omega: 'ω',
  le: '≤', ge: '≥', ne: '≠', approx: '≈', equiv: '≡', to: '→', in: '∈', notin: '∉', subset: '⊂',
  partial: '∂', nabla: '∇', forall: '∀', exists: '∃', neg: '¬', land: '∧', lor: '∨',
}

/** 造一枚 OMML 元素（m: 命名空间写死，与 OOXML 一致） */
function mk(tag: string, attrs: Record<string, string> = {}, ...kids: XEl[]): XEl {
  const named: Record<string, string> = {}
  for (const [k, v] of Object.entries(attrs)) named[`m:${k}`] = v
  return { name: `m:${tag}`, attrs: named, children: kids }
}

/** XEl → XML 串（只用于我们造的 OMML 子树；属性值做 XML 转义） */
export function xelToXml(el: XEl): string {
  const attrs = Object.entries(el.attrs)
    .map(([k, v]) => ` ${k}="${v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"`)
    .join('')
  const kids = el.children.map((c) => (typeof c === 'string'
    ? c.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    : xelToXml(c))).join('')
  return `<${el.name}${attrs}>${kids}</${el.name}>`
}

/** LaTeX 串 → `<m:oMath>...</m:oMath>`  literal（写手 post-pack 用） */
export function latexToOmmlXml(latex: string): string {
  const body = xelToXml(latexToOmml(latex))
  // 行内公式必须包在 m:oMath 里（块级是 m:oMathPara）——Word 认这一层作为公式边界
  return `<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">${body}</m:oMath>`
}
