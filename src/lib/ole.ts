// OLE 嵌入对象的**内容**提取。上一版只做到"看得见有个对象"（正文里占位一行），这一版把里面的字取出来。
//
// 两条容器形状都由真件实测得来（本机扫到的分布：CFB 的 oleObjectN.bin 70 个、直接放 zip 的
// Microsoft_Excel_Worksheet.xlsx 21 个、Microsoft_Word_Document.docx 2 个、Visio 的 .vsd 1 个）：
//  1. 现代 Office 常把原生文件**直接**放在 embeddings/ 下（本身就是 zip，没有 OLE 包装）；
//  2. 老的 Package 对象套一层复合文档（CFB），原生文件住在流 `\x01Ole10Native` 里。
//
// Ole10Native 的字段布局是拿 Word 写的真件（1.5MB 的 oleObject1.bin）逐字节量出来的，不是背规格：
//   DWORD cbSize | WORD 0x0002 | label asciiz | 完整路径 asciiz | WORD 0 | WORD 类型
//   | DWORD 临时路径长度（含结尾 \0）| 临时路径 | DWORD 数据长度 | 数据 | 尾部若干字段
// 两个要点：数据**不贴着流末尾**（尾部还有一百多字节的 Unicode 路径与计数，"按流长反推"必错）；
// 而严格走字段只覆盖了量到的这一种写法，所以走不通时再按"哪枚 DWORD 能把数据吃到接近结尾"扫一遍。
//
// 展平进正文而不是另起对象节点，与 v0.41 的文本框同一条决定：字没了比版式没保真严重一级。

import { isCfb, openCfb } from './cfb'
import { allDesc, attr, els, local, parseXml, textOf, type XEl } from './ooxml'

/** 单个嵌入部件最多读这么多：真件里见过 74MB 的嵌入体，不设上限等于让一次导入吃光内存 */
const MAX_EMBED = 24 * 1024 * 1024
/** 内层表格的行/列上限，截断要写进告警，不能静默少给 */
const SHEET_ROWS = 200
const SHEET_COLS = 40
/** 一份工作簿最多取几张表：嵌入的通常是单表小工作簿，取更多只会让正文被表格淹没 */
const SHEET_MAX = 4
/** 内层文本最多取这么多字节，之后按段落截断 */
const TEXT_CAP = 64 * 1024
const TEXT_PARAS = 200

export type EmbedKind = 'docx' | 'xlsx' | 'csv' | 'txt' | 'cfb' | 'zip' | 'other'


export interface EmbedContent {
  kind: EmbedKind
  /** 内层文件名（Ole10Native 的 label，或嵌入部件自己的文件名） */
  name: string
  bytes: Uint8Array
  /** 取不出内容时给人看的说法（已含文件名与大小）；有它就只看 note 不看 bytes */
  note?: string
}

export interface EmbedHtml {
  html: string
  notes: string[]
}

function u32(b: Uint8Array, o: number): number {
  return view(b).getUint32(o, true)
}

function u16(b: Uint8Array, o: number): number {
  return view(b).getUint16(o, true)
}

function view(b: Uint8Array): DataView {
  return new DataView(b.buffer, b.byteOffset, b.byteLength)
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
}

/** 以 \0 结尾的窄字符串；一路读到流末尾还没有结尾就返回 null（说明不是这份布局） */
function asciiz(b: Uint8Array, from: number): { text: string; end: number } | null {
  for (let i = from; i < b.length; i++) {
    if (b[i] !== 0) continue
    let s = ''
    for (let k = from; k < i; k++) s += String.fromCharCode(b[k])
    return { text: s, end: i + 1 }
  }
  return null
}

function magic(b: Uint8Array, sig: number[]): boolean {
  for (let i = 0; i < sig.length; i++) if (b[i] !== sig[i]) return false
  return true
}

/** 看起来是可读文本：没有 NUL/EOF 控制字节，且控制字符占比极低 */
function looksText(b: Uint8Array): boolean {
  const n = Math.min(b.length, 4096)
  if (!n) return false
  let bad = 0
  for (let i = 0; i < n; i++) {
    const c = b[i]
    if (c === 0 || c === 0x1a) return false
    if (c < 0x09 || (c > 0x0d && c < 0x20)) bad++
  }
  return bad / n < 0.02
}

/**
 * 从 `\x01Ole10Native` 流里取回内层文件。返回 null 表示这份件的写法没认出来——
 * 调用方据此记一条边界，而不是硬塞一段乱码进正文。
 */
export function oleNativePayload(s: Uint8Array): { label: string; data: Uint8Array } | null {
  // 偏移 4 是 WORD 标志（实测恒为 0x0002），按 DWORD 读会把紧随的 label 头两个字节一起吃进来
  if (s.length < 16 || u16(s, 4) !== 0x0002) return null
  const label = asciiz(s, 6)
  const path = label ? asciiz(s, label.end) : null
  if (!label || !path) return null
  // 严格布局：两个 asciiz 之后是 4 个占位字节（实测 00 00 03 00）、临时路径（长度含结尾 \0）、数据
  let p = path.end + 4
  const tmpLen = u32(s, p)
  if (tmpLen > 0 && tmpLen < 4096) {
    p += 4 + tmpLen
    const size = u32(s, p)
    if (size > 0 && p + 4 + size <= s.length) return { label: label.text, data: s.subarray(p + 4, p + 4 + size) }
  }
  // 兜底扫描：真件的数据之后只剩百来字节，别的候选会差出整个文件长度，所以"空隙最小"的那个就是它
  let best: { at: number; size: number; gap: number } | null = null
  for (let o = path.end; o + 4 <= Math.min(s.length, 1024); o++) {
    const size = u32(s, o)
    if (size < 8 || o + 4 + size > s.length) continue
    const gap = s.length - (o + 4 + size)
    if (!best || gap < best.gap) best = { at: o, size, gap }
  }
  if (!best || best.gap > 4096) return null
  return { label: label.text, data: s.subarray(best.at + 4, best.at + 4 + best.size) }
}

/** 内层文件是什么形状：先看魔数，再按文件名补（纯文本没有魔数可用） */
export function classifyEmbed(bytes: Uint8Array, name: string): EmbedKind {
  const lower = name.toLowerCase()
  if (magic(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    if (/\.docx$|word_document/.test(lower)) return 'docx'
    if (/\.xlsx$|worksheet|workbook/.test(lower)) return 'xlsx'
    return 'zip'
  }
  if (isCfb(bytes)) return 'cfb'
  if (lower.endsWith('.csv')) return 'csv'
  if (/\.(txt|md|log)$/.test(lower) || looksText(bytes)) return 'txt'
  return 'other'
}

/**
 * 解开容器拿到内层文件。`bytes` 是 embeddings/ 下那个部件的全部内容。
 * 现代形状（部件本身就是原生文件）直接分派；老形状先进复合文档找 `\x01Ole10Native`。
 */
export function unwrapEmbed(bytes: Uint8Array, name: string): EmbedContent | null {
  if (!bytes.length) return null
  if (bytes.length > MAX_EMBED) {
    return { kind: 'other', name, bytes: new Uint8Array(0), note: `嵌入文件太大（${Math.round(bytes.length / 1048576)}MB），未提取` }
  }
  const cfb = openCfb(bytes)
  if (!cfb) {
    const kind = classifyEmbed(bytes, name)
    if (kind === 'other' || kind === 'zip') return { kind, name, bytes: new Uint8Array(0), note: `嵌入的 ${name} 不是可读的文本或 OOXML` }
    return { kind, name, bytes }
  }
  const native = cfb.read('\x01Ole10Native') ?? cfb.read('Ole10Native')
  if (!native) {
    const seen = cfb.entries.filter((e) => e.kind === 'stream').map((e) => e.name.replace(/^\u0001/, ''))
    return {
      kind: 'cfb',
      name,
      bytes: new Uint8Array(0),
      note: `复合文档里没有嵌入的原生文件${seen.length ? `（它的流是 ${seen.slice(0, 3).join('、')}）` : ''}`,
    }
  }
  const payload = oleNativePayload(native)
  if (!payload) return { kind: 'cfb', name, bytes: new Uint8Array(0), note: 'Ole10Native 的字段写法没认出来' }
  const inner = payload.label || name
  const kind = classifyEmbed(payload.data, inner)
  if (kind === 'cfb') {
    return {
      kind,
      name: inner,
      bytes: payload.data,
      note: `嵌入的 ${inner}（${Math.round(payload.data.length / 1024)}KB）是老式复合文档，其正文格式（Excel 97 的 BIFF、Word 97 的 FIB）未解析`,
    }
  }
  if (kind === 'other' || kind === 'zip') {
    return {
      kind,
      name: inner,
      bytes: new Uint8Array(0),
      note: `嵌入的 ${inner}（${Math.round(payload.data.length / 1024)}KB）不是可读的文本或 OOXML`,
    }
  }
  return { kind, name: inner, bytes: payload.data }
}

function decodeText(b: Uint8Array): string {
  const src = b.byteLength > TEXT_CAP ? b.subarray(0, TEXT_CAP) : b
  let s = new TextDecoder('utf-8', { fatal: false }).decode(src)
  // 老 Windows 上的 txt/csv 常是 GBK：出现替换符就换一条码路重来，别把中文写成 ?
  if (s.includes('\ufffd')) s = new TextDecoder('gbk', { fatal: false }).decode(src)
  return s.replace(/\r\n?/g, '\n')
}

/** CSV：分隔符按首行里谁出现得多来嗅；引号内的换行与双写引号按 RFC4180 处理（与 Rust 侧 csv.rs 同规则） */
export function csvRows(s: string, cap = SHEET_ROWS): string[][] {
  const brk = s.indexOf('\n')
  const first = brk < 0 ? s : s.slice(0, brk)
  const count = (d: string) => first.split(d).length - 1
  const c = count(',')
  const semi = count(';')
  const tab = count('\t')
  const delim = c >= semi && c >= tab ? ',' : semi >= tab ? ';' : '\t'
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quoted) {
      if (ch !== '"') {
        field += ch
        continue
      }
      if (s[i + 1] === '"') {
        field += '"'
        i++
      } else quoted = false
      continue
    }
    if (ch === '"') quoted = true
    else if (ch === delim) {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      if (rows.length >= cap) return rows
    } else field += ch
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function tableHtml(rows: string[][]): string {
  return `<table><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
}

/** 文本/CSV 的呈现：CSV 出表，纯文本按空行分段 */
export function textEmbedHtml(content: EmbedContent): EmbedHtml {
  const s = decodeText(content.bytes)
  if (!s.trim()) return { html: '', notes: [`嵌入的 ${content.name} 里没有文字`] }
  const cutByBytes = content.bytes.length > TEXT_CAP
  if (content.kind === 'csv') {
    // 多取一行当"是否还有下文"的探针：正好截在 200 行时也要能说清"后面还有"
    const rows = csvRows(s, SHEET_ROWS + 1)
    const wide = rows.some((r) => r.length > SHEET_COLS)
    const body = rows.slice(0, SHEET_ROWS).map((r) => r.slice(0, SHEET_COLS))
    const notes = ['嵌入的 CSV 已取值为表格（列宽、数字格式与多表未保留）']
    if (rows.length > SHEET_ROWS || wide || cutByBytes) notes.push(`嵌入的 CSV 只取前 ${SHEET_ROWS} 行 × ${SHEET_COLS} 列`)
    return { html: tableHtml(body), notes }
  }
  const paras = s
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
  const notes = ['嵌入的文本已并入正文（分段按空行划分，原文件的换行与行宽未保留）']
  if (paras.length > TEXT_PARAS || cutByBytes) notes.push(`嵌入的文本只取前 ${TEXT_PARAS} 段`)
  return {
    html: paras
      .slice(0, TEXT_PARAS)
      .map((p) => `<p>${esc(p.replace(/\n/g, ' '))}</p>`)
      .join(''),
    notes,
  }
}

/**
 * 把摊出来的**块级**正文压成行内：段落/列表项/表格行的结束换成换行，其余标签剥掉。
 * 用武之地是单元格——那里放不下一张嵌套表（本读侧对嵌套表格自己都是"展平为段落"），
 * 压成行文本至少字还在，而不是被 ProseMirror 的内容表达式整块丢掉。
 */
export function inlineFlatten(html: string): string {
  return html
    .replace(/<[^>]+>/g, (m) => (/^<\/(p|li|tr|h[1-4])>$/.test(m) ? '<br/>' : ''))
    .replace(/^(<br\/>)+|(<br\/>)+$/g, '')
}

/** `<c r="C5">` → 列的下标（0 起）；没有 r 就当接着上一列 */
function colIndex(ref?: string): number {
  if (!ref) return -1
  let n = 0
  for (const ch of ref) {
    if (ch < 'A' || ch > 'Z') break
    n = n * 26 + (ch.charCodeAt(0) - 64)
  }
  return n > 0 ? n - 1 : -1
}

function cellText(c: XEl, shared: string[]): string {
  const t = attr(c, 't')
  if (t === 'inlineStr') {
    const is = findLocal(c, 'is')
    return is ? textOf(is) : ''
  }
  const v = allDesc(c, 'v')[0]
  if (!v) return ''
  if (t === 's' || t === 'str') {
    const idx = Number(textOf(v))
    return t === 's' ? shared[Number.isInteger(idx) ? idx : -1] ?? '' : textOf(v)
  }
  return textOf(v)
}

function findLocal(el: XEl, name: string): XEl | undefined {
  for (const c of els(el)) if (local(c.name) === name) return c
  return undefined
}

/** 内层 xlsx：只要值。样式、公式与多表都不在这里 */
async function xlsxEmbedHtml(bytes: Uint8Array, name: string): Promise<EmbedHtml> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(bytes)
  const read = async (p: string): Promise<string> => (await zip.file(p)?.async('string')) ?? ''
  const shared: string[] = []
  const ss = await read('xl/sharedStrings.xml')
  if (ss) for (const si of allDesc(parseXml(ss), 'si')) shared.push(textOf(si))
  const wb = await read('xl/workbook.xml')
  const titles = wb ? allDesc(parseXml(wb), 'sheet').map((s) => attr(s, 'name') ?? '') : []
  const parts = Object.keys(zip.files)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort()
  if (!parts.length) return { html: '', notes: [`嵌入的 ${name} 里没有工作表`] }
  const notes: string[] = []
  const html: string[] = []
  for (let k = 0; k < Math.min(parts.length, SHEET_MAX); k++) {
    const p = parts[k]
    const rows: string[][] = []
    let wide = false
    for (const row of allDesc(parseXml(await read(p)), 'row')) {
      if (rows.length >= SHEET_ROWS) break
      const cells: string[] = []
      for (const c of allDesc(row, 'c')) {
        // 列号决定落在哪一列：跳过的空列不能挤位
        const at = colIndex(attr(c, 'r'))
        const n = at < 0 ? cells.length : at
        if (n >= SHEET_COLS) wide = true
        while (cells.length < Math.min(n, SHEET_COLS)) cells.push('')
        if (cells.length >= SHEET_COLS) continue
        cells[n] = cellText(c, shared)
      }
      rows.push(cells)
    }
    const title = titles[k] || `工作表 ${k + 1}`
    html.push(`<p><strong>${esc(title)}</strong></p>${tableHtml(rows)}`)
    if (rows.length >= SHEET_ROWS || wide) notes.push(`嵌入的工作表「${title}」只取前 ${SHEET_ROWS} 行 × ${SHEET_COLS} 列`)
  }
  if (parts.length > SHEET_MAX) notes.push(`嵌入的工作簿有 ${parts.length} 张表，只取前 ${SHEET_MAX} 张`)
  notes.push('嵌入的工作表已取值为表格（样式、公式与多表未保留）')
  return { html: html.join(''), notes }
}

/**
 * 嵌入对象的内容 → 落进文档流的 HTML。`depth` 是嵌套层数（文档套文档再套文档没完）。
 * 取不出内容时 html 为空串，调用方保留 v0.43 那条可见占位。
 */
export async function embedHtml(content: EmbedContent, depth = 0): Promise<EmbedHtml> {
  if (content.note) return { html: '', notes: [content.note] }
  switch (content.kind) {
    case 'docx': {
      if (depth >= 2) return { html: '', notes: ['嵌入文档套得过深，未继续展开'] }
      try {
        const { docxToHtmlFidelity } = await import('./docx-fidelity')
        const r = await docxToHtmlFidelity(content.bytes, depth + 1)
        if (!r.blocks) return { html: '', notes: [`嵌入的 ${content.name} 里没有可导入的段落`] }
        return {
          html: r.html,
          notes: [`嵌入文档已展开为正文${r.warnings.length ? `（其中 ${r.warnings.length} 项未保真）` : ''}`],
        }
      } catch (e) {
        return { html: '', notes: [`嵌入的 ${content.name} 解不开：${e instanceof Error ? e.message : String(e)}`] }
      }
    }
    case 'xlsx':
      try {
        return await xlsxEmbedHtml(content.bytes, content.name)
      } catch (e) {
        return { html: '', notes: [`嵌入的 ${content.name} 解不开：${e instanceof Error ? e.message : String(e)}`] }
      }
    case 'csv':
    case 'txt':
      return textEmbedHtml(content)
    default:
      return { html: '', notes: [`嵌入的 ${content.name} 未提取`] }
  }
}
