import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  PageNumber,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'

export interface PMNode {
  type: string
  attrs?: Record<string, unknown>
  content?: PMNode[]
  marks?: { type: string; attrs?: Record<string, unknown> }[]
}

// 页眉页脚设置：随 .odoc meta 存储，导出写入 OOXML section header/footer
export interface DocMeta {
  headerText?: string
  footerText?: string
  footerPageNumber?: boolean
}

export async function docxToHtml(bytes: Uint8Array): Promise<string> {
  const arrayBuffer = bytes.slice().buffer
  const mammoth = (await import('mammoth')).default
  const result = await mammoth.convertToHtml({ arrayBuffer })
  return result.value
}

// mammoth 不读页眉页脚：直接解 zip 里 sectPr 引用的 header/footer XML，抽文本与 PAGE 页码域
export async function docxToDocMeta(bytes: Uint8Array): Promise<DocMeta> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(bytes)
  const docXml = (await zip.file('word/document.xml')?.async('string')) ?? ''
  const relsText = (await zip.file('word/_rels/document.xml.rels')?.async('string')) ?? ''
  const relFor = (rid: string) =>
    relsText.match(new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`))?.[1] ??
    relsText.match(new RegExp(`Target="([^"]+)"[^>]*Id="${rid}"`))?.[1]
  const refOf = (tag: string) => {
    // Word 可能同时写 even/default/first 三个引用，取 default（无 type 属性时取首个）
    const rid =
      docXml.match(new RegExp(`<w:${tag}Reference[^>]*w:type="default"[^>]*r:id="(rId\\d+)"`))?.[1] ??
      docXml.match(new RegExp(`<w:${tag}Reference[^>]*r:id="(rId\\d+)"`))?.[1]
    if (!rid) return undefined
    const target = relFor(rid)
    if (!target) return undefined
    return zip.file(target.startsWith('/') ? target.slice(1) : `word/${target.replace(/^\.\//, '')}`)
  }
  const readPart = async (tag: string): Promise<{ text?: string; hasPage: boolean }> => {
    const f = refOf(tag)
    if (!f) return { hasPage: false }
    const xml = await f.async('string')
    // 段落里文本按 w:t 顺序拼接（Word 会保留节点内空格，不要额外插空格）
    const text = (xml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? [])
      .map((m) => m.replace(/<[^>]+>/g, ''))
      .join('')
      .trim()
    // 页码域形态多样：fldSimple instr / fldChar+instrText / instrText 含 PAGE
    const hasPage = /PAGE(\s|\*|"|'|<)/.test(xml)
    return { text: text || undefined, hasPage }
  }
  const [head, foot] = await Promise.all([readPart('header'), readPart('footer')])
  // 页码域的缓存值（数字/第/页/共）混在 w:t 里，带页码域时把这些剔掉
  const stripPageTokens = (t: string) =>
    t
      .split(/\s+/)
      .filter((x) => x && x !== '第' && x !== '页' && x !== '共' && x !== '·' && !/^\d+$/.test(x))
      .join(' ')
  const out: DocMeta = {}
  if (head.text) out.headerText = head.text
  if (foot.text) {
    const rest = foot.hasPage ? stripPageTokens(foot.text) : foot.text
    if (rest) out.footerText = rest
  }
  if (foot.hasPage) out.footerPageNumber = true
  return out
}

function textOf(node: PMNode): string {
  if (node.type === 'text') return (node.attrs?.text as string) ?? ''
  if (node.type === 'hardBreak') return '\n'
  return (node.content ?? []).map(textOf).join('')
}

function hasMark(node: PMNode, type: string): boolean {
  return (node.marks ?? []).some((m) => m.type === type)
}

function linkHref(node: PMNode): string | undefined {
  return node.marks?.find((m) => m.type === 'link')?.attrs?.href as string | undefined
}

function dataUriToBytes(dataUri: string): Uint8Array | null {
  const comma = dataUri.indexOf(',')
  if (comma < 0) return null
  const meta = dataUri.slice(0, comma)
  if (!meta.includes('base64')) return null
  try {
    const bin = atob(dataUri.slice(comma + 1))
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

function imageType(src: string): 'png' | 'jpg' | 'gif' | 'bmp' {
  if (/^data:image\/jpeg/i.test(src) || /\.jpe?g([?#]|$)/i.test(src)) return 'jpg'
  if (/^data:image\/gif/i.test(src)) return 'gif'
  if (/^data:image\/bmp/i.test(src)) return 'bmp'
  return 'png'
}

interface Inherited {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  mono?: boolean
}

function markAttr(node: PMNode, mark: string, attr: string): string | undefined {
  const m = node.marks?.find((x) => x.type === mark)
  const v = m?.attrs?.[attr]
  return typeof v === 'string' ? v : undefined
}

function inlineToChildren(node: PMNode, inherited: Inherited = {}): (TextRun | ExternalHyperlink)[] {
  const out: (TextRun | ExternalHyperlink)[] = []
  for (const child of node.content ?? []) {
    if (child.type === 'text') {
      const text = (child.attrs?.text as string) ?? ''
      const bold = inherited.bold || hasMark(child, 'bold')
      const italic = inherited.italic || hasMark(child, 'italic')
      const underline = inherited.underline || hasMark(child, 'underline')
      const strike = inherited.strike || hasMark(child, 'strike')
      const mono = inherited.mono || hasMark(child, 'code')
      const href = linkHref(child)
      const color = markAttr(child, 'color', 'color')?.replace('#', '')
      const highlight = markAttr(child, 'highlight', 'color')?.replace('#', '')
      const runOpts = {
        text,
        bold,
        italics: italic,
        strike,
        font: mono ? 'Consolas' : undefined,
        ...(color ? { color } : {}),
        ...(highlight ? { shading: { type: 'clear' as const, fill: highlight } } : {}),
        ...(underline ? { underline: {} } : {}),
      }
      if (href) {
        out.push(
          new ExternalHyperlink({
            link: href,
            children: [new TextRun({ ...runOpts, style: 'Hyperlink' })],
          }),
        )
      } else {
        out.push(new TextRun(runOpts))
      }
    } else if (child.type === 'hardBreak') {
      out.push(new TextRun({ text: '', break: 1 }))
    } else if (child.type === 'image') {
      const src = (child.attrs?.src as string) ?? ''
      const bytes = src.startsWith('data:') ? dataUriToBytes(src) : null
      if (bytes) {
        out.push(
          new TextRun({
            children: [
              new ImageRun({
                type: imageType(src),
                data: bytes,
                transformation: {
                  width: Number(child.attrs?.width) || 320,
                  height: Number(child.attrs?.height) || 240,
                },
              }),
            ],
          }),
        )
      } else if (src) {
        out.push(new TextRun({ text: `[图片: ${src}]`, italics: true }))
      }
    } else {
      out.push(...inlineToChildren(child, inherited))
    }
  }
  return out
}

function alignOf(node: PMNode): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  switch (node.attrs?.textAlign) {
    case 'center':
      return AlignmentType.CENTER
    case 'right':
      return AlignmentType.RIGHT
    case 'justify':
      return AlignmentType.JUSTIFIED
    default:
      return undefined
  }
}

function blocksOf(nodes: PMNode[], depth = 0): (Paragraph | Table | TableOfContents)[] {
  const out: (Paragraph | Table | TableOfContents)[] = []
  for (const node of nodes) {
    if (node.type === 'bulletList' || node.type === 'orderedList') {
      const ordered = node.type === 'orderedList'
      let counter = 0
      for (const item of node.content ?? []) {
        counter += 1
        const blocks = (item.content ?? []).filter((b) => b.type !== 'bulletList' && b.type !== 'orderedList')
        const nested = (item.content ?? []).filter((b) => b.type === 'bulletList' || b.type === 'orderedList')
        const main = blocks[0] ?? { type: 'paragraph', content: [] }
        out.push(
          new Paragraph({
            children: [
              ...(ordered ? [new TextRun({ text: `${counter}. ` })] : []),
              ...inlineToChildren(main),
            ],
            bullet: ordered ? undefined : { level: depth },
            indent: ordered ? { left: 480 + depth * 360 } : undefined,
            spacing: { after: 60 },
          }),
        )
        out.push(...blocksOf(blocks.slice(1), depth))
        out.push(...blocksOf(nested, depth + 1))
      }
      continue
    }
    if (node.type === 'heading') {
      const level = Number(node.attrs?.level ?? 1)
      out.push(
        new Paragraph({
          children: inlineToChildren(node),
          outlineLevel: Math.max(0, Math.min(8, level - 1)),
          heading:
            level === 1 ? HeadingLevel.HEADING_1
            : level === 2 ? HeadingLevel.HEADING_2
            : level === 3 ? HeadingLevel.HEADING_3
            : HeadingLevel.HEADING_4,
        }),
      )
      continue
    }
    if (node.type === 'codeBlock') {
      const lines = textOf(node).split('\n')
      out.push(
        new Paragraph({
          children: lines.flatMap((l, i) => [
            ...(i > 0 ? [new TextRun({ text: '', break: 1 })] : []),
            new TextRun({ text: l, font: 'Consolas' }),
          ]),
          shading: { type: 'clear', fill: 'F2F3F5' },
          spacing: { after: 120 },
        }),
      )
      continue
    }
    if (node.type === 'horizontalRule') {
      out.push(new Paragraph({ children: [], thematicBreak: true }))
      continue
    }
    if (node.type === 'blockquote') {
      out.push(
        new Paragraph({
          children: inlineToChildren(node),
          indent: { left: 480 },
          border: { left: { style: BorderStyle.SINGLE, size: 12, color: '9CA3AF', space: 8 } },
          spacing: { after: 120 },
        }),
      )
      continue
    }
    if (node.type === 'toc') {
      // \o 按内置标题样式 + \u 按段落大纲级别收集；Word 打开后"更新域"重生成
      out.push(
        new TableOfContents('目录', {
          hyperlink: true,
          headingStyleRange: '1-4',
          useAppliedParagraphOutlineLevel: true,
        }),
      )
      continue
    }
    if (node.type === 'table') {
      const rows = (node.content ?? []).filter((r) => r.type === 'tableRow')
      if (rows.length === 0) continue
      out.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: rows.map(
            (r) =>
              new TableRow({
                children: (r.content ?? []).map(
                  (cell) =>
                    new TableCell({
                      children: [new Paragraph({ children: inlineToChildren(cell) })],
                    }),
                ),
              }),
          ),
        }),
      )
      continue
    }
    out.push(
      new Paragraph({
        children: inlineToChildren(node),
        alignment: alignOf(node),
        spacing: { after: 120 },
      }),
    )
  }
  return out
}

export async function prosemirrorToDocxBytes(json: PMNode, meta?: DocMeta): Promise<Uint8Array> {
  const section: {
    children: (Paragraph | Table | TableOfContents)[]
    headers?: { default: Header }
    footers?: { default: Footer }
  } = { children: blocksOf(json.content ?? []) }
  if (meta?.headerText?.trim()) {
    section.headers = {
      default: new Header({
        children: [
          new Paragraph({
            children: [new TextRun({ text: meta.headerText.trim(), size: 18, color: '6B7280' })],
            alignment: AlignmentType.RIGHT,
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB', space: 2 } },
          }),
        ],
      }),
    }
  }
  const footText = meta?.footerText?.trim()
  if (footText || meta?.footerPageNumber) {
    section.footers = {
      default: new Footer({
        children: [
          new Paragraph({
            children: [
              new TextRun({
                ...(footText && meta?.footerPageNumber
                  ? { children: [`${footText} · 第 `, PageNumber.CURRENT, ' 页'] }
                  : meta?.footerPageNumber
                    ? { children: ['第 ', PageNumber.CURRENT, ' 页'] }
                    : { text: footText }),
                size: 18,
                color: '6B7280',
              }),
            ],
            alignment: AlignmentType.CENTER,
            border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB', space: 2 } },
          }),
        ],
      }),
    }
  }
  const doc = new Document({
    creator: 'OpenOffices',
    title: 'OpenOffices 文档',
    features: { updateFields: true },
    sections: [section],
  })
  const buf = await Packer.toBuffer(doc)
  return new Uint8Array(buf)
}
