import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
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

export async function docxToHtml(bytes: Uint8Array): Promise<string> {
  const arrayBuffer = bytes.slice().buffer
  const mammoth = (await import('mammoth')).default
  const result = await mammoth.convertToHtml({ arrayBuffer })
  return result.value
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

function blocksOf(nodes: PMNode[], depth = 0): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = []
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

export async function prosemirrorToDocxBytes(json: PMNode): Promise<Uint8Array> {
  const doc = new Document({
    creator: 'OpenOffices',
    title: 'OpenOffices 文档',
    sections: [{ children: blocksOf(json.content ?? []) }],
  })
  const buf = await Packer.toBuffer(doc)
  return new Uint8Array(buf)
}
