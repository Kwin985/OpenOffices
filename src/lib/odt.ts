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

const OD_MIME = 'application/vnd.oasis.opendocument.text'

// mm → ODF 长度字面量（cm 两位小数）
const mm2cm = (mm: number) => `${(mm / 10).toFixed(2)}cm`
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
  images = new Map<string, ImageEntry>() // src → entry
  private imageSeq = 0

  constructor(private meta?: DocMeta) {}

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
      if (m.code) tp += ' style:font-name="Courier New"'
      if (m.fam) tp += ` style:font-name="${esc(String(m.fam))}" style:font-name-asian="${esc(String(m.fam))}"`
      // fontSize 存 px，ODF 习惯 pt
      if (m.sz) tp += ` fo:font-size="${Math.round((Number(m.sz) * 72) / 96)}pt"`
      if (m.cl) tp += ` fo:color="${esc(String(m.cl))}"`
      if (m.bg) tp += ` fo:background-color="${esc(String(m.bg))}"`
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
    const aligns = (
      [['AC', 'center'], ['AR', 'right'], ['AJ', 'justify']] as const
    )
      .map(
        ([name, v]) =>
          `<style:style style:name="${name}" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="${v}"/></style:style>`,
      )
      .join('')
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
    return this.charStyleXml() + headings + pc + pq + aligns + lb + lo
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
          out += `<text:h text:style-name="H${level}" text:outline-level="${level}">${this.inline(n.content ?? [])}</text:h>`
          break
        }
        case 'paragraph': {
          const align = n.attrs?.alignment as string | undefined
          const an =
            align === 'center' || align === 'right' || align === 'justify'
              ? ` text:style-name="A${align[0].toUpperCase()}"`
              : ''
          out += `<text:p${an}>${this.inline(n.content ?? [])}</text:p>`
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
              out += `<text:p text:style-name="PQ">${this.inline(c.content ?? [])}</text:p>`
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
        .map((c) =>
          c.type === 'paragraph' ? `<text:p>${this.inline(c.content ?? [])}</text:p>` : this.blocks([c]),
        )
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
    let out = '<table:table>'
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
        const attrs = sp
          ? ` table:number-columns-spanned="${sp.cs}" table:number-rows-spanned="${sp.rs}"`
          : ''
        const body = (item.cell.content ?? [])
          .map((x) =>
            x.type === 'paragraph'
              ? `<text:p>${this.inline(x.content ?? [])}</text:p>`
              : this.blocks([x]),
          )
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
    return out
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
        return `<h${level}>${await renderInline(el)}</h${level}>`
      }
      case 'p': {
        const sn = el.getAttribute('text:style-name')
        if (sn === 'PC') return `<pre><code>${await renderInline(el)}</code></pre>`
        if (sn === 'PQ') return `<blockquote><p>${await renderInline(el)}</p></blockquote>`
        // 分页符：本编辑器写 PBK，第三方按段落样式里的 break-before 识别
        const st = sn ? styles.get(sn) : undefined
        const pp = st ? pick(st, 'paragraph-properties') : null
        if (sn === 'PBK' || pp?.getAttribute('fo:break-before') === 'page')
          return `<div data-oo-pagebreak="1"></div>`
        const align = sn === 'AC' ? 'center' : sn === 'AR' ? 'right' : sn === 'AJ' ? 'justify' : ''
        return `<p${align ? ` style="text-align: ${align}"` : ''}>${await renderInline(el)}</p>`
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
            const attrs = `${cs > 1 ? ` colspan="${cs}"` : ''}${rs > 1 ? ` rowspan="${rs}"` : ''}`
            cells.push(`<td${attrs}>${await renderChildrenBlocks(c)}</td>`)
          }
          rows.push(`<tr>${cells.join('')}</tr>`)
        }
        return `<table><tbody>${rows.join('')}</tbody></table>`
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
