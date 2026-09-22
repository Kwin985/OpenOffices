// ODT（OpenDocument 文本）导出/导入：ProseMirror JSON ⇄ content.xml，零新依赖（JSZip + DOMParser）。
// 范围：批注与目录节点不写 ODT；图片以 dataURL 内嵌进 Pictures/；页眉页脚/页码走 master-page。

import {
  DEFAULT_COL_GAP,
  detectPageFormat,
  pageNumberParts,
  resolvePage,
  type DocMeta,
  type PageMargin,
  type PageSetup,
  type PMNode,
} from './docx'
import { bdAttr, borderParts, CELL_EDGES, cssBorder, rgb2hex } from './cell-style'

const OD_MIME = 'application/vnd.oasis.opendocument.text'

// mm → ODF 长度字面量（cm 两位小数）
const mm2cm = (mm: number) => `${(mm / 10).toFixed(2)}cm`
// CSS px → ODF 长度：缩进写 cm，三位小数以免往返掉精度（32px ≈ 0.847cm）
const px2cm = (px: number) => `${(px / 37.795).toFixed(3)}cm`
/** ODF 承认的四边框线型；inset/outset 之类翻成 solid，至少宽度与颜色还在 */
const ODF_BORDER_STYLE: Record<string, string> = { solid: 'solid', dashed: 'dashed', dotted: 'dotted', double: 'double' }
/** 规范边框串（`1px solid #8899aa`）→ fo:border-* 的值（宽度用 pt：px↔pt 换算是精确的） */
function odtBorder(v: string): string {
  const p = borderParts(v)
  if (!p) return 'none'
  const style = ODF_BORDER_STYLE[p.style] ?? 'solid'
  return `${Math.round(p.px * 75) / 100}pt ${style} ${p.hex}`
}
/**
 * fo:border-* 的值 → 规范边框串。
 * 第三方 ODF 的宽度多写 cm（本应用写 pt），cssBorder 只认 px/pt，故先把长度档位换成 px。
 * 这里不走 len2px：它按整数 px 取整，会把 0.5pt 的细线（0.67px）抬成 1px，
 * 而边框宽度正是往返要保真的量，故保留两位小数。
 */
function odfBorderCss(v: string | null | undefined): string | null {
  if (!v) return null
  const s = v.trim()
  if (!s || s === 'none' || s === 'hidden') return 'none'
  const m = s.match(/^(-?[\d.]+)(cm|mm|in|"|pt|px)?(.*)$/)
  if (!m) return cssBorder(s)
  const n = Number(m[1])
  const unit = m[2] ?? ''
  const px =
    unit === 'mm' ? n * 37.795
    : unit === 'in' || unit === '"' ? n * 96
    : unit === 'pt' ? (n * 96) / 72
    : unit === 'px' ? n
    : n * 37.795
  return cssBorder(`${Math.round(px * 100) / 100}px${m[3]}`)
}
/** ODF 长度 → CSS px；负值照收（悬挂缩进就是负的 fo:text-indent） */
function len2px(v: string | null | undefined): number | undefined {
  if (!v) return undefined
  const m = v.trim().match(/^(-?[\d.]+)(cm|mm|in|"|pt|px)?$/)
  if (!m) return undefined
  const n = Number(m[1])
  if (!Number.isFinite(n) || n === 0) return undefined
  const px =
    m[2] === 'mm' ? n * 37.795
    : m[2] === 'in' || m[2] === '"' ? n * 96
    : m[2] === 'pt' ? (n * 96) / 72
    : m[2] === 'px' ? n
    : n * 37.795
  return Math.round(px)
}
/** CSS 属性值 → ODF 的 fo:text-align（start/center/end/justify） */
const FO_ALIGN: Record<string, string> = { left: 'start', center: 'center', right: 'end', justify: 'justify' }
/** ODF 的 fo:text-align → CSS 值（本编辑器的 textAlign 属性吃 CSS 词） */
const CSS_ALIGN: Record<string, string> = { start: 'left', center: 'center', end: 'right', justify: 'justify' }

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number.parseInt(String(v ?? ''), 10)
  return Number.isFinite(n) ? n : 0
}

/**
 * CSS 字体列表 → ODF 的拉丁/中日韩两个槽。
 * 'Times New Roman', '宋体' 里前一个是拉丁名、后一个是中文名（保真导入就是这个排法）。
 */
function splitFont(family: string): { latin: string; cjk?: string } {
  const names = family
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
  const cjk = names.find((n) => /[㐀-䶿一-鿿぀-ヿ가-힯]/.test(n))
  return { latin: names.find((n) => n !== cjk) ?? names[0] ?? '', cjk }
}
// ODF 长度字面量 → mm；无法解析回 undefined
function cm2mm(v: string | null | undefined): number | undefined {
  if (!v) return undefined
  const m = v.match(/^([\d.]+)\s*(cm|mm|in|")?$/)
  if (!m) return undefined
  const n = Number(m[1])
  if (!Number.isFinite(n) || n <= 0) return undefined
  return m[2] === 'in' ? n * 25.4 : m[2] === 'mm' ? n : n * 10
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

interface ImageEntry {
  file: string
  mime: string
  bytes: Uint8Array
}

const NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ' +
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ' +
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" ' +
  'xmlns:xlink="http://www.w3.org/1999/xlink" ' +
  'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" ' +
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" ' +
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"'

class OdtBuilder {
  charStyles = new Map<string, string>() // 样式键 JSON → 样式名
  paraStyles = new Map<string, string>() // 段落直接格式键 JSON → 段落自动样式名
  cellStyles = new Map<string, string>() // 单元格样式键 JSON → 自动样式名（ce1…）
  tableStyles = new Map<string, string>() // 表格样式键 JSON → 自动样式名（TS1…）
  images = new Map<string, ImageEntry>() // src → entry
  private imageSeq = 0
  private paraSeq = 0
  private cellSeq = 0
  private tableSeq = 0

  /**
   * 单元格直接格式（四边边框 + 底纹 + 竖排对齐）→ table-cell 家族自动样式。
   * ODF 的表格单元格样式必须走 `style:family="table-cell"`，不能像 HTML 那样写内联。
   * 边框宽度用 pt 而不是 cm：px↔pt 是 ×4/3 的精确换算，cm 保留两位小数会把 1px 变成 1.13px。
   */
  private cStyle(cell: PMNode): string {
    const o: Record<string, string> = {}
    for (const edge of CELL_EDGES) {
      const v = cell.attrs?.[bdAttr(edge)]
      if (typeof v !== 'string' || !v) continue
      o[`b${edge}`] = v === 'none' ? 'none' : odtBorder(v)
    }
    const bg = cell.attrs?.background
    if (typeof bg === 'string' && bg) o.bg = bg
    const va = cell.attrs?.vAlign
    if (va === 'top' || va === 'middle' || va === 'bottom') o.va = va
    if (!Object.keys(o).length) return ''
    const key = JSON.stringify(o)
    let name = this.cellStyles.get(key)
    if (!name) {
      name = `ce${++this.cellSeq}`
      this.cellStyles.set(key, name)
    }
    return name
  }

  private cellStyleXml(): string {
    let out = ''
    for (const [key, name] of this.cellStyles) {
      const s = JSON.parse(key) as Record<string, string>
      let tp = ''
      for (const edge of CELL_EDGES) {
        if (s[`b${edge}`]) tp += ` fo:border-${edge}="${esc(s[`b${edge}`])}"`
      }
      if (s.bg) tp += ` fo:background-color="${esc(s.bg)}"`
      if (s.va) tp += ` style:vertical-align="${s.va}"`
      out += `<style:style style:name="${name}" style:family="table-cell"><style:table-cell-properties${tp}/></style:style>`
    }
    return out
  }

  /**
   * 表格缩进（Word 的 w:tblInd 那一档）→ table 家族自动样式。
   * ODF 里整张表的左边距就是 `fo:margin-left`，表宽本应用不锁（版式表恒为满宽减缩进），
   * 所以只写 margin-left，导入侧按同一属性读回。
   */
  private tStyle(node: PMNode): string {
    const ml = Number(node.attrs?.marginLeft)
    if (!Number.isFinite(ml) || ml <= 0) return ''
    const key = JSON.stringify({ ml: Math.round(ml * 100) / 100 })
    let name = this.tableStyles.get(key)
    if (!name) {
      name = `TS${++this.tableSeq}`
      this.tableStyles.set(key, name)
    }
    return name
  }

  private tableStyleXml(): string {
    let out = ''
    for (const [key, name] of this.tableStyles) {
      const s = JSON.parse(key) as { ml: number }
      out +=
        `<style:style style:name="${name}" style:family="table">` +
        `<style:table-properties table:align="margins" fo:margin-left="${px2cm(s.ml)}"/></style:style>`
    }
    return out
  }

  constructor(private meta?: DocMeta) {}

  /**
   * 段落直接格式（对齐 + 缩进）→ 派生自动样式名。
   * ODF 一个段落只认一个 text:style-name，「居中 + 首行缩进两字符」这类组合只能另起一条样式，
   * 父样式指回基础样式（Standard/H1/PQ），同样的组合复用同一个名字。
   * leftAdd：基础样式自带的左边距（PQ 的 0.8cm），节点上的缩进是在它之外的增量。
   * dropLeft：左缩进交给 text:list-style 管（列表项节点上那份多半是从 docx 层级继承来的，再写就是双份）。
   */
  private pStyle(
    node: PMNode,
    base: string,
    opts: { leftAdd?: number; dropLeft?: boolean } = {},
  ): string {
    const align = String(node.attrs?.textAlign ?? '')
    const raw = opts.dropLeft ? 0 : Math.max(0, num(node.attrs?.indentLeft)) + (opts.leftAdd ?? 0)
    const right = Math.max(0, num(node.attrs?.indentRight))
    const first = num(node.attrs?.indentFirst)
    const bl = opts.leftAdd ?? 0
    if (!align && raw <= bl && !right && !first) return base
    const key = JSON.stringify({ base, align, left: raw, right, first, bl })
    let name = this.paraStyles.get(key)
    if (!name) {
      name = `PS${++this.paraSeq}`
      this.paraStyles.set(key, name)
    }
    return name
  }

  private paraStyleXml(): string {
    let out = ''
    for (const [key, name] of this.paraStyles) {
      const s = JSON.parse(key) as { base?: string; align?: string; left?: number; right?: number; first?: number; bl?: number }
      let pp = ''
      const align = FO_ALIGN[s.align ?? '']
      if (align) pp += ` fo:text-align="${align}"`
      // 父样式链已经给到的左边距不必重写
      if ((s.left ?? 0) > (s.bl ?? 0)) pp += ` fo:margin-left="${px2cm(s.left ?? 0)}"`
      if (s.right) pp += ` fo:margin-right="${px2cm(s.right)}"`
      if (s.first) pp += ` fo:text-indent="${px2cm(s.first)}"`
      out +=
        `<style:style style:name="${name}" style:family="paragraph" style:parent-style-name="${s.base || 'Standard'}">` +
        `<style:paragraph-properties${pp}/></style:style>`
    }
    return out
  }

  private charStyleXml(): string {
    let out = ''
    for (const [key, name] of this.charStyles) {
      const m = JSON.parse(key) as Record<string, unknown>
      let tp = ''
      if (m.bl) tp += ' fo:font-weight="bold"'
      if (m.it) tp += ' fo:font-style="italic"'
      if (m.ul)
        tp += ' style:text-underline-style="solid" style:text-underline-type="single" style:text-underline-width="auto"'
      if (m.st) tp += ' style:text-line-through-style="solid" style:text-line-through-type="single"'
      // 字体族拆拉丁/中日韩两槽；code 与 fam 都写 style:font-name，同元素重复属性会让 XML 解析失败
      const font = m.fam ? splitFont(String(m.fam)) : m.code ? { latin: 'Courier New' } : null
      if (font?.latin) tp += ` style:font-name="${esc(font.latin)}"`
      if (font?.cjk) tp += ` style:font-name-asian="${esc(font.cjk)}"`
      // fontSize 存 px，ODF 习惯 pt
      if (m.sz) tp += ` fo:font-size="${Math.round((Number(m.sz) * 72) / 96)}pt"`
      if (m.cl) tp += ` fo:color="${esc(String(m.cl))}"`
      if (m.bg) tp += ` fo:background-color="${esc(String(m.bg))}"`
      // 58%/-25% 是 LibreOffice 自己写上下标时用的偏移档位，跟着它才不会被判成自定义位置
      if (m.sp) tp += ' style:text-position="super 58%"'
      else if (m.sb) tp += ' style:text-position="sub -25%"'
      out += `<style:style style:name="${name}" style:family="text"><style:text-properties${tp}/></style:style>`
    }
    return out
  }

  private autoStyles(): string {
    const headings = [1, 2, 3, 4]
      .map(
        (l) =>
          `<style:style style:name="H${l}" style:family="paragraph" style:parent-style-name="Standard"><style:text-properties fo:font-size="${22 - l * 3}pt" fo:font-weight="bold" fo:color="#111827"/></style:style>`,
      )
      .join('')
    const pc = `<style:style style:name="PC" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:background-color="#f3f4f6" fo:margin-left="0.4cm"/><style:text-properties style:font-name="Courier New" fo:font-size="9.5pt"/></style:style>`
    const pq = `<style:style style:name="PQ" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-left="0.8cm" fo:border-left="0.06cm solid #d1d5db" fo:padding-left="0.3cm"/></style:style>`
    const aligns = this.paraStyleXml()
    const lb = `<text:list-style style:name="LB">${[1, 2, 3]
      .map(
        (l) =>
          `<text:list-level-style-bullet text:level="${l}" text:bullet-char="•"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" fo:text-indent="-0.6cm" fo:margin-left="${(0.6 * l).toFixed(2)}cm"/></style:list-level-properties></text:list-level-style-bullet>`,
      )
      .join('')}</text:list-style>`
    const lo = `<text:list-style style:name="LO">${[1, 2, 3]
      .map(
        (l) =>
          `<text:list-level-style-number text:level="${l}" style:num-suffix="." style:num-format="1"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" fo:text-indent="-0.7cm" fo:margin-left="${(0.7 * l).toFixed(2)}cm"/></style:list-level-properties></text:list-level-style-number>`,
      )
      .join('')}</text:list-style>`
    return this.charStyleXml() + this.cellStyleXml() + this.tableStyleXml() + headings + pc + pq + aligns + lb + lo
  }

  private registerImage(src: string): ImageEntry | null {
    const hit = this.images.get(src)
    if (hit) return hit
    const dm = src.match(/^data:([^;]+);base64,(.*)$/)
    if (!dm) return null
    try {
      const bin = atob(dm[2])
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const ext =
        dm[1] === 'image/jpeg' ? 'jpg' : dm[1] === 'image/svg+xml' ? 'svg' : (dm[1].split('/')[1] ?? 'png')
      const entry: ImageEntry = { file: `Pictures/odt${++this.imageSeq}.${ext}`, mime: dm[1], bytes }
      this.images.set(src, entry)
      return entry
    } catch {
      return null
    }
  }

  inline(nodes: PMNode[]): string {
    let out = ''
    for (const n of nodes) {
      if (n.type === 'text') {
        let inner = esc(n.text ?? '')
        const marks = n.marks ?? []
        const at = (t: string) => marks.find((k) => k.type === t)?.attrs
        const markKey = {
          bl: marks.some((k) => k.type === 'bold'),
          it: marks.some((k) => k.type === 'italic'),
          ul: marks.some((k) => k.type === 'underline'),
          st: marks.some((k) => k.type === 'strike'),
          code: marks.some((k) => k.type === 'code'),
          cl: (at('textStyle')?.color ?? at('color')?.color) as string | undefined,
          bg: at('highlight')?.color as string | undefined,
          fam: (at('textStyle')?.fontFamily ?? at('fontFamily')?.fontFamily) as string | undefined,
          sz: parseInt(String(at('textStyle')?.fontSize ?? at('fontSize')?.fontSize ?? ''), 10) || undefined,
          // ODF 的上下标是一个属性两值（style:text-position="super 58%"），故两个布尔键分开记
          sp: marks.some((k) => k.type === 'superscript'),
          sb: marks.some((k) => k.type === 'subscript'),
        }
        const hasAny = Object.values(markKey).some(Boolean)
        if (hasAny) {
          const key = JSON.stringify(markKey)
          let name = this.charStyles.get(key)
          if (!name) {
            name = `C${this.charStyles.size + 1}`
            this.charStyles.set(key, name)
          }
          inner = `<text:span text:style-name="${name}">${inner}</text:span>`
        }
        const href = at('link')?.href as string | undefined
        if (href) inner = `<text:a xlink:type="simple" xlink:href="${esc(href)}">${inner}</text:a>`
        out += inner
      } else if (n.type === 'hardBreak') {
        out += '<text:line-break/>'
      } else if (n.type === 'image') {
        const src = (n.attrs?.src as string) ?? ''
        if (!src) continue
        // 宽度属性是像素（UI 设定），换算成 ODF 长度；缺省回退 4.5in
        const pw = Number(n.attrs?.width)
        const wAttr = `svg:width="${Number.isFinite(pw) && pw > 0 ? mm2cm(pw * 25.4 / 96) : '4.5in'}"`
        const ph = Number(n.attrs?.height)
        const hAttr = Number.isFinite(ph) && ph > 0 ? ` svg:height="${mm2cm(ph * 25.4 / 96)}"` : ''
        const entry = this.registerImage(src)
        if (entry) {
          out += `<draw:frame draw:name="${entry.file}" text:anchor-type="as-char" ${wAttr}${hAttr}><draw:image xlink:href="${entry.file}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame>`
        } else if (!src.startsWith('data:')) {
          out += `<draw:frame text:anchor-type="as-char" ${wAttr}${hAttr}><draw:image xlink:href="${esc(src)}" xlink:type="simple"/></draw:frame>`
        }
      } else if (n.content) {
        out += this.inline(n.content)
      }
    }
    return out
  }

  blocks(nodes: PMNode[]): string {
    let out = ''
    for (const n of nodes) {
      switch (n.type) {
        case 'heading': {
          const level = Math.min(4, Math.max(1, Number(n.attrs?.level ?? 1)))
          const sn = this.pStyle(n, `H${level}`)
          out += `<text:h text:style-name="${sn}" text:outline-level="${level}">${this.inline(n.content ?? [])}</text:h>`
          break
        }
        case 'paragraph': {
          const sn = this.pStyle(n, '')
          out += `<text:p${sn ? ` text:style-name="${sn}"` : ''}>${this.inline(n.content ?? [])}</text:p>`
          break
        }
        case 'codeBlock': {
          const text = (n.content ?? []).map((x) => x.text ?? '').join('')
          out += `<text:p text:style-name="PC">${text.split('\n').map(esc).join('<text:line-break/>')}</text:p>`
          break
        }
        case 'blockquote':
          for (const c of n.content ?? []) {
            if (c.type === 'paragraph') {
              // PQ 自带 0.8cm 左边距：用户再缩进要在这个基础上加，否则派生样式会盖掉引用缩进
              out += `<text:p text:style-name="${this.pStyle(c, 'PQ', { leftAdd: 30 })}">${this.inline(c.content ?? [])}</text:p>`
            } else {
              out += this.blocks([c])
            }
          }
          break
        case 'bulletList':
          out += `<text:list text:style-name="LB">${this.listItems(n.content ?? [])}</text:list>`
          break
        case 'orderedList':
          out += `<text:list text:style-name="LO">${this.listItems(n.content ?? [])}</text:list>`
          break
        case 'table':
          out += this.table(n)
          break
        case 'image':
          // TipTap 允许图片作为顶层节点，包一层段落写出
          out += `<text:p>${this.inline([n])}</text:p>`
          break
        case 'pageBreak':
          // 空段落带 fo:break-before="page"：本段落在新页起始，正文随之续排
          out += `<text:p text:style-name="PBK"/>`
          break
        case 'toc':
          break // 目录是实时汇总节点，ODT 不写占位
        default:
          if (n.content) out += this.blocks(n.content)
      }
    }
    return out
  }

  private listItems(nodes: PMNode[]): string {
    let out = ''
    for (const li of nodes) {
      if (li.type !== 'listItem') continue
      const inner = (li.content ?? [])
        .map((c) => {
          if (c.type !== 'paragraph') return this.blocks([c])
          const sn = this.pStyle(c, '', { dropLeft: true })
          return `<text:p${sn ? ` text:style-name="${sn}"` : ''}>${this.inline(c.content ?? [])}</text:p>`
        })
        .join('')
      out += `<text:list-item>${inner}</text:list-item>`
    }
    return out
  }

  private table(node: PMNode): string {
    const rows = (node.content ?? []).filter((r) => r.type === 'tableRow')
    if (!rows.length) return ''
    // 预铺覆盖矩阵：合并区非左上角格子写 covered 占位（列序与 xlsx/ods 同一套语义）
    const covered = new Set<string>()
    const spans = new Map<string, { cs: number; rs: number }>()
    const grid: { col: number; cell: PMNode }[][] = []
    rows.forEach((row, ri) => {
      const line: { col: number; cell: PMNode }[] = []
      let c = 0
      for (const cell of row.content ?? []) {
        if (cell.type !== 'tableCell' && cell.type !== 'tableHeader') continue
        while (covered.has(`${ri},${c}`)) c++
        const cs = Number(cell.attrs?.colspan ?? 1) || 1
        const rs = Number(cell.attrs?.rowspan ?? 1) || 1
        line.push({ col: c, cell })
        if (cs > 1 || rs > 1) spans.set(`${ri},${c}`, { cs, rs })
        for (let dr = 0; dr < rs; dr++)
          for (let dc = 0; dc < cs; dc++) if (dr || dc) covered.add(`${ri + dr},${c + dc}`)
        c += cs
      }
      grid.push(line)
    })
    // 后续行可能只写到部分列：补齐 covered 占位由 while+set 逻辑自然处理
    const ts = this.tStyle(node)
    let out = `<table:table${ts ? ` table:style-name="${ts}"` : ''}>`
    grid.forEach((line, ri) => {
      let rowXml = ''
      const lastCol = Math.max(...line.map((x) => x.col), 0)
      let c = 0
      while (c <= lastCol) {
        if (covered.has(`${ri},${c}`)) {
          rowXml += '<table:covered-table-cell/>'
          c++
          continue
        }
        const item = line.find((x) => x.col === c)
        if (!item) {
          rowXml += '<table:table-cell/>'
          c++
          continue
        }
        const sp = spans.get(`${ri},${c}`)
        const cellStyle = this.cStyle(item.cell)
        const attrs = `${sp ? ` table:number-columns-spanned="${sp.cs}" table:number-rows-spanned="${sp.rs}"` : ''}${
          cellStyle ? ` table:style-name="${cellStyle}"` : ''
        }`
        const body = (item.cell.content ?? [])
          .map((x) => {
            if (x.type !== 'paragraph') return this.blocks([x])
            const sn = this.pStyle(x, '')
            return `<text:p${sn ? ` text:style-name="${sn}"` : ''}>${this.inline(x.content ?? [])}</text:p>`
          })
          .join('')
        rowXml += `<table:table-cell${attrs}>${body}</table:table-cell>`
        c += sp?.cs ?? 1
      }
      out += `<table:table-row>${rowXml}</table:table-row>`
    })
    out += '</table:table>'
    return out
  }

  private stylesXml(): string {
    const footText = this.meta?.footerText?.trim()
    const withPage = this.meta?.footerPageNumber
    const pn = pageNumberParts(this.meta?.pageNumberFormat)
    // ODF 页码/总页数字段：缓存值写 1 / 3，应用打开后自行重算
    const pageField = `<text:page-number text:select-page="current">1</text:page-number>`
    const totalField = `<text:page-count>3</text:page-count>`
    const pageRun = `${esc(pn.before)}${pageField}${esc(pn.after)}${pn.total ? ` / ${totalField}` : ''}`
    let footer = ''
    if (footText && withPage) {
      footer = `<text:p text:style-name="Footer">${esc(footText)} · ${pageRun}</text:p>`
    } else if (withPage) {
      footer = `<text:p text:style-name="Footer">${pageRun}</text:p>`
    } else if (footText) {
      footer = `<text:p text:style-name="Footer">${esc(footText)}</text:p>`
    }
    const headerText = this.meta?.headerText?.trim()
    const master = `<style:master-page style:name="Standard" style:page-layout-name="pm1">${
      headerText ? `<style:header><text:p text:style-name="Header">${esc(headerText)}</text:p></style:header>` : ''
    }${footer ? `<style:footer>${footer}</style:footer>` : ''}</style:master-page>`
    const stylesNS = NS.split(' ')
      .filter((p) => /office|style|text|fo/.test(p))
      .join(' ')
    const pg = resolvePage(this.meta?.page)
    const pageProps =
      `<style:page-layout-properties ` +
      `fo:page-width="${mm2cm(pg.w)}" fo:page-height="${mm2cm(pg.h)}" ` +
      `fo:margin-top="${mm2cm(pg.margin.top)}" fo:margin-bottom="${mm2cm(pg.margin.bottom)}" ` +
      `fo:margin-left="${mm2cm(pg.margin.left)}" fo:margin-right="${mm2cm(pg.margin.right)}" ` +
      `style:num-format="1"/>`
    // 多栏：ODF 的栏数写在 page-layout 的 style:columns，栏分隔子元素个数 = 栏数-1（等宽用 rel-width="*"）
    const columns =
      pg.cols > 1
        ? `<style:columns fo:column-count="${pg.cols}" fo:column-gap="${mm2cm(pg.colGap)}">` +
          `<style:column style:rel-width="*" fo:break-before="auto"/></style:columns>`
        : ''
    return (
      `<?xml version="1.0" encoding="UTF-8"?><office:document-styles ${stylesNS} office:version="1.2">` +
      `<office:styles>` +
      `<style:style style:name="Standard" style:family="paragraph"><style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0.2cm"/></style:style>` +
      `<style:style style:name="Text_20_Body" style:family="paragraph" style:parent-style-name="Standard"/>` +
      `<style:style style:name="PBK" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:break-before="page" fo:margin-top="0cm" fo:margin-bottom="0cm"/></style:style>` +
      `<style:style style:name="Header" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="end"/><style:text-properties fo:font-size="9pt" fo:color="#6b7280"/></style:style>` +
      `<style:style style:name="Footer" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="center"/><style:text-properties fo:font-size="9pt" fo:color="#6b7280"/></style:style>` +
      `</office:styles>` +
      `<office:automatic-styles><style:page-layout style:name="pm1">${pageProps}${columns}</style:page-layout></office:automatic-styles>` +
      `<office:master-styles>${master}</office:master-styles>` +
      `</office:document-styles>`
    )
  }

  private manifestXml(): string {
    let entries =
      `<manifest:file-entry manifest:full-path="/" manifest:media-type="${OD_MIME}"/>` +
      `<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>` +
      `<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>`
    for (const e of this.images.values()) {
      entries += `<manifest:file-entry manifest:full-path="${e.file}" manifest:media-type="${e.mime}"/>`
    }
    return `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">${entries}</manifest:manifest>`
  }

  build(rootContent: PMNode[]): { content: string; styles: string; manifest: string } {
    // 先跑 blocks：charStyles 在行内渲染时才注册，autoStyles 必须后置求值
    const body = this.blocks(rootContent)
    const content =
      `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${NS} office:version="1.2">` +
      `<office:automatic-styles>${this.autoStyles()}</office:automatic-styles>` +
      `<office:body><office:text>${body}</office:text></office:body>` +
      `</office:document-content>`
    return { content, styles: this.stylesXml(), manifest: this.manifestXml() }
  }
}

export async function prosemirrorToOdtBytes(json: PMNode, meta?: DocMeta): Promise<Uint8Array> {
  const { default: JSZip } = await import('jszip')
  const builder = new OdtBuilder(meta)
  const parts = builder.build(json.content ?? [])
  const zip = new JSZip()
  // mimetype 必须为首条且不压缩
  zip.file('mimetype', OD_MIME, { compression: 'STORE' })
  zip.file('META-INF/manifest.xml', parts.manifest)
  zip.file('content.xml', parts.content)
  zip.file('styles.xml', parts.styles)
  for (const e of builder.images.values()) zip.file(e.file, e.bytes)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }) as Promise<Uint8Array>
}

// ———— 导入 ————

interface StyleInfo {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  color?: string
  bg?: string
  mono?: boolean
  fam?: string
  szPx?: number
  sup?: boolean
  sub?: boolean
}

function pick(el: Element, localName: string): Element | null {
  for (const c of Array.from(el.children)) if (c.localName === localName) return c
  return null
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export async function odtToHtml(bytes: Uint8Array): Promise<{ html: string; meta: DocMeta }> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(bytes)
  const contentText = await zip.file('content.xml')?.async('string')
  if (!contentText) throw new Error('odt 缺少 content.xml')
  const stylesText = (await zip.file('styles.xml')?.async('string')) ?? ''
  const parser = new DOMParser()
  const cdoc = parser.parseFromString(contentText, 'text/xml')
  const sdoc = stylesText ? parser.parseFromString(stylesText, 'text/xml') : null

  const styles = new Map<string, Element>() // name → style:style / default-style
  const listStyles = new Map<string, boolean>() // name → 是否有序
  for (const d of [cdoc, sdoc]) {
    if (!d) continue
    for (const el of Array.from(d.getElementsByTagName('*'))) {
      if (el.localName === 'style') {
        const name = el.getAttribute('style:name')
        if (name && !styles.has(name)) styles.set(name, el)
      } else if (el.localName === 'list-style') {
        const name = el.getAttribute('style:name')
        if (name)
          listStyles.set(
            name,
            Array.from(el.getElementsByTagName('*')).some((x) => x.localName === 'list-level-style-number'),
          )
      }
    }
  }

  const resolveStyle = (name: string | null | undefined, depth = 0): StyleInfo => {
    if (!name || depth > 5) return {}
    const el = styles.get(name)
    if (!el) return {}
    const out: StyleInfo = resolveStyle(el.getAttribute('style:parent-style-name'), depth + 1)
    const tp = pick(el, 'text-properties') ?? el
    if (tp.getAttribute('fo:font-weight') === 'bold') out.bold = true
    if (tp.getAttribute('fo:font-style') === 'italic') out.italic = true
    const ul = tp.getAttribute('style:text-underline-type') ?? tp.getAttribute('style:text-underline-style')
    if (ul && ul !== 'none') out.underline = true
    const lt = tp.getAttribute('style:text-line-through-type') ?? tp.getAttribute('style:text-line-through-style')
    if (lt && lt !== 'none') out.strike = true
    const color = tp.getAttribute('fo:color')
    if (color && color !== 'inherit') out.color = color
    const pp = pick(el, 'paragraph-properties')
    const bg = tp.getAttribute('fo:background-color') ?? pp?.getAttribute('fo:background-color')
    if (bg && bg !== 'transparent' && bg !== 'inherit') out.bg = bg
    const font =
      tp.getAttribute('style:font-name') ?? tp.getAttribute('fo:font-name') ?? tp.getAttribute('style:font-name-asian')
    if (font && /courier|mono|consolas|menlo/i.test(font)) out.mono = true
    if (font) out.fam = font
    const sz = tp.getAttribute('fo:font-size')
    if (sz) {
      const v = parseFloat(sz)
      // 导出统一写 pt；宽松兼容 cm/mm 与无前缀（px）写法
      if (Number.isFinite(v) && v > 0)
        out.szPx = /cm$/.test(sz) ? Math.round(v * 37.8) : /mm$/.test(sz) ? Math.round(v * 3.78) : /px$/.test(sz) ? Math.round(v) : Math.round((v * 96) / 72)
    }
    const pos = tp.getAttribute('style:text-position')
    if (pos) {
      // ODF 一条属性同时表方向与偏移（super 58% / sub -25%），normal 表示回到基线
      const w = pos.trim().toLowerCase()
      out.sup = w.startsWith('super')
      out.sub = w.startsWith('sub')
    }
    return out
  }

  /** 样式名 → 从祖先到自己的样式元素链（派生样式要连父样式一起看） */
  const styleChain = (name: string | null | undefined): Element[] => {
    const out: Element[] = []
    let el = name ? styles.get(name) : undefined
    for (let guard = 0; el && guard < 6; guard++) {
      out.unshift(el)
      el = styles.get(el.getAttribute('style:parent-style-name') ?? '')
    }
    return out
  }

  /** 段落直接格式：对齐 + 缩进（本应用把它写成派生自动样式，第三方文件同理） */
  interface ParaFormat {
    align?: string
    leftPx?: number
    rightPx?: number
    firstPx?: number
  }

  const resolvePara = (name: string | null | undefined): ParaFormat => {
    const out: ParaFormat = {}
    for (const el of styleChain(name)) {
      const pp = pick(el, 'paragraph-properties')
      if (!pp) continue
      const al = pp.getAttribute('fo:text-align')
      if (al) out.align = CSS_ALIGN[al] ?? out.align
      const ml = len2px(pp.getAttribute('fo:margin-left'))
      if (ml !== undefined) out.leftPx = ml
      const mr = len2px(pp.getAttribute('fo:margin-right'))
      if (mr !== undefined) out.rightPx = mr
      const ti = len2px(pp.getAttribute('fo:text-indent'))
      if (ti !== undefined) out.firstPx = ti
    }
    return out
  }

  /**
   * 段落 → 行内 style（textAlign 与 Indent 两个扩展都按行内样式解析）。
   * minusLeft 是容器本身已经给出的左边距（blockquote 即 PQ 的 0.8cm），只把超出的那一档落成缩进属性。
   */
  const paraStyle = (name: string | null | undefined, minusLeft = 0): string => {
    const p = resolvePara(name)
    const bits: string[] = []
    if (p.align && p.align !== 'left') bits.push(`text-align: ${p.align}`)
    const left = (p.leftPx ?? 0) - minusLeft
    if (left > 0) bits.push(`margin-left: ${left}px`)
    if (p.rightPx) bits.push(`margin-right: ${p.rightPx}px`)
    if (p.firstPx) bits.push(`text-indent: ${p.firstPx}px`)
    return bits.length ? ` style="${bits.join('; ')}"` : ''
  }

  /**
   * 单元格样式（table-cell 家族）→ td 的行内 style。
   * CellStyle 扩展就是按 border 四边、background-color、vertical-align 这几条行内属性取值的，
   * 而 ODF 侧它们只能住在样式里（表格单元格不给内联），这里就是两者之间的桥。
   */
  const cellStyleCss = (name: string | null | undefined): string => {
    const o: Record<string, string> = {}
    for (const el of styleChain(name)) {
      const tp = pick(el, 'table-cell-properties')
      if (!tp) continue
      // 四边各有一条 fo:border-<edge>，简写 fo:border 是「四边同值」的兜底
      const shorthand = tp.getAttribute('fo:border')
      for (const edge of CELL_EDGES) {
        const v = odfBorderCss(tp.getAttribute(`fo:border-${edge}`) ?? shorthand)
        if (v) o[`border-${edge}`] = v
      }
      const bg = tp.getAttribute('fo:background-color')
      if (bg && !/^(auto|transparent|inherit)$/.test(bg.trim().toLowerCase()))
        o['background-color'] = rgb2hex(bg) ?? bg.trim()
      const va = tp.getAttribute('style:vertical-align')?.trim().toLowerCase()
      if (va === 'top' || va === 'bottom') o['vertical-align'] = va
      else if (va === 'middle' || va === 'center') o['vertical-align'] = 'middle'
    }
    return Object.keys(o).length ? ` style="${Object.entries(o).map(([k, v]) => `${k}: ${v}`).join('; ')}"` : ''
  }

  /** 表格样式（table 家族）的 fo:margin-left → 缩进；表宽由 CellStyle 的 renderHTML 自己收 */
  const tableStyleCss = (name: string | null | undefined): string => {
    let ml: number | undefined
    for (const el of styleChain(name)) {
      const tp = pick(el, 'table-properties')
      const v = len2px(tp?.getAttribute('fo:margin-left'))
      if (v !== undefined) ml = v
    }
    return ml && ml > 0 ? ` style="margin-left: ${ml}px"` : ''
  }

  const htmlOfStyle = (si: StyleInfo, inner: string): string => {
    let html = inner
    if (si.mono) html = `<code>${html}</code>`
    if (si.bg) html = `<span style="background-color: ${si.bg}">${html}</span>`
    // 字体族/字号/字色同挂 textStyle mark，必须合成一个 span，不能嵌套两层同类 mark
    const css: string[] = []
    if (si.fam) css.push(`font-family: ${si.fam}`)
    if (si.szPx) css.push(`font-size: ${si.szPx}px`)
    if (si.color) css.push(`color: ${si.color}`)
    if (css.length) html = `<span style="${css.join('; ')}">${html}</span>`
    if (si.strike) html = `<s>${html}</s>`
    if (si.underline) html = `<u>${html}</u>`
    if (si.italic) html = `<em>${html}</em>`
    if (si.bold) html = `<strong>${html}</strong>`
    // 上下标套在最外层：superscript/subscript 是独立 mark，与加粗同层不会互相吞掉
    if (si.sup) html = `<sup>${html}</sup>`
    else if (si.sub) html = `<sub>${html}</sub>`
    return html
  }

  const imgCache = new Map<string, Promise<string>>()
  const imageDataUrl = (href: string): Promise<string> => {
    if (href.startsWith('data:')) return Promise.resolve(href)
    const hit = imgCache.get(href)
    if (hit) return hit
    const p = (async () => {
      const f = zip.file(href.replace(/^\.\//, ''))
      if (!f) return ''
      const b = await f.async('base64')
      const ext = href.split('.').pop()?.toLowerCase() ?? 'png'
      const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
      return `data:${mime};base64,${b}`
    })()
    imgCache.set(href, p)
    return p
  }

  async function renderInline(el: Element): Promise<string> {
    let out = ''
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 3) {
        out += escapeHtml(child.nodeValue ?? '')
      } else if (child.nodeType === 1) {
        const e = child as Element
        switch (e.localName) {
          case 's':
            out += ' '.repeat(Math.max(1, Number(e.getAttribute('text:c') ?? 1)))
            break
          case 'tab':
            out += '    '
            break
          case 'line-break':
            out += '<br/>'
            break
          case 'span':
            out += htmlOfStyle(resolveStyle(e.getAttribute('text:style-name')), await renderInline(e))
            break
          case 'a':
            out += `<a href="${escapeHtml(e.getAttribute('xlink:href') ?? '')}">${await renderInline(e)}</a>`
            break
          case 'frame': {
            let src = ''
            for (const d of Array.from(e.getElementsByTagName('*'))) {
              if (d.localName === 'image') {
                src = await imageDataUrl(d.getAttribute('xlink:href') ?? '')
                break
              }
            }
            if (src) {
              const wmm = cm2mm(e.getAttribute('svg:width'))
              out += wmm
                ? `<img src="${src}" style="width:${Math.round((wmm / 25.4) * 96)}px"/>`
                : `<img src="${src}"/>`
            }
            break
          }
          case 'noscript':
            break
          case 'note':
            break // 脚注文本不进正文
          default:
            out += await renderInline(e)
        }
      }
    }
    return out
  }

  async function renderChildrenBlocks(el: Element): Promise<string> {
    let out = ''
    for (const child of Array.from(el.children)) {
      if (['s', 'tab', 'line-break', 'span', 'a', 'frame'].includes(child.localName)) {
        // 容器里直接散落的行内容（list-item/table-cell 均可能）
        out += `<p>${await renderInline(el)}</p>`
        return out
      }
      out += await renderBlock(child)
    }
    return out
  }

  async function renderBlock(el: Element): Promise<string> {
    switch (el.localName) {
      case 'h': {
        const level = Math.min(4, Math.max(1, Number(el.getAttribute('text:outline-level') ?? 1)))
        const sn = el.getAttribute('text:style-name')
        // 派生样式（PSn）挂在 H1..H4 之下，对齐与缩进照旧从样式链上取
        return `<h${level}${paraStyle(sn)}>${await renderInline(el)}</h${level}>`
      }
      case 'p': {
        const sn = el.getAttribute('text:style-name')
        const chain = styleChain(sn)
        const names = chain.map((x) => x.getAttribute('style:name'))
        // 分页符：本编辑器写 PBK，第三方按段落样式里的 break-before 识别
        if (
          names.includes('PBK') ||
          chain.some((x) => pick(x, 'paragraph-properties')?.getAttribute('fo:break-before') === 'page')
        )
          return `<div data-oo-pagebreak="1"></div>`
        if (names.includes('PC')) return `<pre><code>${await renderInline(el)}</code></pre>`
        if (names.includes('PQ'))
          return `<blockquote><p${paraStyle(sn, 30)}>${await renderInline(el)}</p></blockquote>`
        return `<p${paraStyle(sn)}>${await renderInline(el)}</p>`
      }
      case 'list': {
        const ordered = listStyles.get(el.getAttribute('text:style-name') ?? '') ?? false
        const items: string[] = []
        for (const child of Array.from(el.children)) {
          if (child.localName === 'list-item') {
            items.push(`<li>${await renderChildrenBlocks(child)}</li>`)
          } else if (child.localName === 'list') {
            const nested = await renderBlock(child)
            if (items.length) items[items.length - 1] += nested
            else items.push(`<li>${nested}</li>`)
          }
        }
        return `<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`
      }
      case 'table': {
        const rows: string[] = []
        for (const r of Array.from(el.children)) {
          if (r.localName !== 'table-row') continue
          const cells: string[] = []
          for (const c of Array.from(r.children)) {
            if (c.localName === 'covered-table-cell') continue
            if (c.localName !== 'table-cell') continue
            const cs = Number(c.getAttribute('table:number-columns-spanned') ?? 1)
            const rs = Number(c.getAttribute('table:number-rows-spanned') ?? 1)
            const attrs = `${cs > 1 ? ` colspan="${cs}"` : ''}${rs > 1 ? ` rowspan="${rs}"` : ''}${cellStyleCss(c.getAttribute('table:style-name'))}`
            cells.push(`<td${attrs}>${await renderChildrenBlocks(c)}</td>`)
          }
          rows.push(`<tr>${cells.join('')}</tr>`)
        }
        return `<table${tableStyleCss(el.getAttribute('table:style-name'))}><tbody>${rows.join('')}</tbody></table>`
      }
      case 'body':
      case 'text':
        return await renderChildrenBlocks(el)
      default:
        return ''
    }
  }

  const body = cdoc.getElementsByTagNameNS('*', 'body')[0]
  const otext = body ? pick(body, 'text') : null
  const html = otext ? await renderChildrenBlocks(otext) : ''

  // —— meta：styles.xml 的 master-page 头脚
  const meta: DocMeta = {}
  if (sdoc) {
    const master = Array.from(sdoc.getElementsByTagName('*')).find((x) => x.localName === 'master-page')
    const plain = (n: Element | null | undefined) => (n ? (n.textContent ?? '').replace(/\s+/g, ' ').trim() : '')
    const header = master ? pick(master, 'header') : null
    const footer = master ? pick(master, 'footer') : null
    const headText = plain(header ?? undefined)
    if (headText) meta.headerText = headText
    if (footer) {
      const kids = Array.from(footer.getElementsByTagName('*'))
      const hasPage = kids.some((x) => x.localName === 'page-number')
      const hasCount = kids.some((x) => x.localName === 'page-count')
      let foot = plain(footer)
      if (hasPage) {
        meta.footerPageNumber = true
        meta.pageNumberFormat = detectPageFormat(foot, hasCount)
        foot = foot
          .replace(/第\s*\d+\s*页/g, ' ')
          .replace(/-?\s*\d+\s*-?/g, ' ')
          .replace(/·/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      }
      if (foot) meta.footerText = foot
    }
    // 页面设置：page-layout-properties 的纸张与四边距 + style:columns 的分栏
    const plp = Array.from(sdoc.getElementsByTagName('*')).find((x) => x.localName === 'page-layout-properties')
    const pw = cm2mm(plp?.getAttribute('fo:page-width') ?? null)
    const ph = cm2mm(plp?.getAttribute('fo:page-height') ?? null)
    const page: PageSetup = {}
    if (pw && ph) {
      const near = (a: number, b: number) => Math.abs(a - b) < 1.5
      const size = near(pw, 210) && near(ph, 297) ? 'A4' : near(pw, 215.9) && near(ph, 279.4) ? 'Letter' : 'custom'
      const r1 = (v: number) => Math.round(v * 10) / 10
      const margin: Partial<PageMargin> = {}
      const mt = cm2mm(plp?.getAttribute('fo:margin-top') ?? null)
      const mb = cm2mm(plp?.getAttribute('fo:margin-bottom') ?? null)
      const ml = cm2mm(plp?.getAttribute('fo:margin-left') ?? null)
      const mr = cm2mm(plp?.getAttribute('fo:margin-right') ?? null)
      if (mt) margin.top = r1(mt)
      if (mb) margin.bottom = r1(mb)
      if (ml) margin.left = r1(ml)
      if (mr) margin.right = r1(mr)
      page.size = size
      if (size === 'custom') {
        page.w = r1(pw)
        page.h = r1(ph)
      }
      if (Object.keys(margin).length) page.margin = margin
    }
    const colsEl = Array.from(sdoc.getElementsByTagName('*')).find((x) => x.localName === 'columns')
    const cn = Number(colsEl?.getAttribute('fo:column-count') ?? 1)
    if (cn > 1) {
      page.cols = Math.min(4, cn)
      // LibreOffice 可能只写 fo:column-gap 或 style:distance（后者为栏间距）
      const gap = cm2mm(colsEl?.getAttribute('fo:column-gap') ?? colsEl?.getAttribute('style:distance') ?? null)
      if (gap && Math.abs(gap - DEFAULT_COL_GAP) > 0.6) page.colGap = Math.round(gap * 10) / 10
    }
    if (Object.keys(page).length) meta.page = page
  }
  return { html, meta }
}
