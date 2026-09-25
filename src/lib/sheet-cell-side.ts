// 单元格的两位邻居：批注（note）与超链接（hyperlink）。它们都不在 cellData 的 v/s 里——
// 批注住快照的 resources（SHEET_NOTE_PLUGIN，按 表 id → 行 → 列 分家），
// 超链接住 cellData[r][c].p.body.customRanges（Univer 把链接当成富文本的一种自定义区间）。
// 与 v0.46 那三类规则不同：**两头都是纯函数**（实测把 resources 与 p 裸写进快照，
// 门面的 getNote()/getHyperLinks() 都读得回来），所以这里不放命令、不碰 DOM，Node 里直测。
import type { CellLinkPayload, CellNotePayload } from './fs'

export interface CellSide {
  notes?: CellNotePayload[]
  links?: CellLinkPayload[]
}

export interface CellSideResult {
  /** sheetId → 这张表上的批注与链接 */
  side: Map<string, CellSide>
  /** 模型装不下的形状只记账，不挑个像样的凑数 */
  notes: string[]
}

const NOTE_PLUGIN = 'SHEET_NOTE_PLUGIN'
// CustomRangeType.HYPERLINK；区间类型还有书签/字段/批注好几种，只认这一种
const HYPERLINK_RANGE = 0
// Univer 的表内跳转把目标编在 url 里：#gid=<表 id>[&range=A1:B2]
const GID_URL = /^#gid=([^&]+)(?:&range=(.+))?$/
// OOXML hyperlink@location：Sheet2!A1 / 'Sales Data'!A1:G5 / Sheet2（整表）
const LOCATION_REF = /^\$?[A-Z]{1,3}\$?[0-9]{1,7}(?::\$?[A-Z]{1,3}\$?[0-9]{1,7})?$/

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}
function posInt(v: unknown): number | undefined {
  const n = num(v)
  return n !== undefined && Number.isInteger(n) && n >= 0 ? n : undefined
}

/** 表名需要加引号的两种情况：含空格等非常规字符，或者长得像单元格引用（A1 会被当成引用而不是表名） */
export function quoteSheetName(name: string): string {
  const plain = /^[^\s!'`"]+$/.test(name) && !/^[A-Za-z]{1,3}[0-9]+$/.test(name) && !/^[0-9]/.test(name)
  return plain ? name : `'${name.replace(/'/g, "''")}'`
}

/** 加引号的表名 → 原名（'' 是引号本身的转义） */
function unquoteSheetName(quoted: string): string {
  if (quoted.startsWith("'") && quoted.endsWith("'")) return quoted.slice(1, -1).replace(/''/g, "'")
  return quoted
}

/**
 * 载荷里的 location → Univer 的 #gid= 形状。
 * 认不出表名、或者目标不是"单元格/区域"这种形状（命名区域、整列 A:A）时返回 null：
 * 界面上放不出这么一枚链接，硬塞一个猜出来的区域等于凭空造跳转目标。
 */
export function univerUrlOf(link: CellLinkPayload, nameToId: Map<string, string>): string | null {
  const loc = link.location
  if (!loc) return link.url ?? null
  const bang = splitLocation(loc)
  if (!bang) return null
  const id = nameToId.get(bang.sheet)
  if (!id) return null
  return bang.range ? `#gid=${id}&range=${bang.range.replace(/\$/g, '')}` : `#gid=${id}`
}

function splitLocation(loc: string): { sheet: string; range?: string } | null {
  const bang = loc.lastIndexOf('!')
  if (bang < 0) return { sheet: unquoteSheetName(loc) }
  const range = loc.slice(bang + 1)
  if (!range || !LOCATION_REF.test(range)) return null
  return { sheet: unquoteSheetName(loc.slice(0, bang)), range }
}

/** Univer 的 #gid= 形状 → 载荷里的 location（表 id 换回表名，绝对引用的 $ 去掉） */
export function locationOfUniverUrl(
  url: string,
  idToName: Map<string, string>,
): { location?: string; note?: string } {
  const m = GID_URL.exec(url)
  if (!m) return { location: undefined }
  const name = idToName.get(m[1])
  if (!name) return { note: '有链接指向已不存在的表' }
  if (!m[2]) return { location: quoteSheetName(name) }
  if (!LOCATION_REF.test(m[2])) return { note: `有链接指向"${name}"里界面上放不出的区域` }
  return { location: `${quoteSheetName(name)}!${m[2].replace(/\$/g, '')}` }
}

/** 富文本格的正文（去掉 Univer 段尾的 \r\n）；没有 p 时返回 null */
export function richTextOf(cell: unknown): string | null {
  const stream = (cell as { p?: { body?: { dataStream?: unknown } } } | undefined)?.p?.body?.dataStream
  if (typeof stream !== 'string') return null
  return stream.replace(/\r\n$/, '')
}

/** 批注的一格：Univer 的形状里没有作者，只有正文与气泡尺寸 */
function noteAt(row: number, col: number, raw: unknown, notes: string[]): CellNotePayload | null {
  const o = raw as Record<string, unknown> | null | undefined
  if (!o || typeof o !== 'object') {
    notes.push('有条批注的形状不认识，未收进来')
    return null
  }
  const text = typeof o.note === 'string' ? o.note : undefined
  if (text === undefined) {
    notes.push(`第 ${row + 1} 行第 ${col + 1} 列的批注没有正文，未收进来`)
    return null
  }
  const width = num(o.width)
  const height = num(o.height)
  return {
    r: row,
    c: col,
    text,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(o.show === true ? { show: true } : {}),
  }
}

/** 一格富文本里的链接区间：Excel 一格最多一枚，多了只留第一枚并记账 */
function linksAt(
  row: number,
  col: number,
  cell: unknown,
  idToName: Map<string, string>,
  notes: string[],
): CellLinkPayload[] {
  const ranges = (cell as { p?: { body?: { customRanges?: unknown } } } | undefined)?.p?.body
    ?.customRanges
  if (!Array.isArray(ranges)) return []
  const out: CellLinkPayload[] = []
  for (const raw of ranges) {
    const o = raw as Record<string, unknown> | null | undefined
    if (!o || typeof o !== 'object') continue
    if (o.rangeType !== HYPERLINK_RANGE) continue
    const url = str((o.properties as Record<string, unknown> | undefined)?.url)
    if (!url) {
      notes.push(`第 ${row + 1} 行第 ${col + 1} 列的链接没有目标地址，未收进来`)
      continue
    }
    if (out.length) {
      notes.push(`第 ${row + 1} 行第 ${col + 1} 列有多枚链接，只留第一枚`)
      break
    }
    if (url.startsWith('#')) {
      const got = locationOfUniverUrl(url, idToName)
      if (got.note) notes.push(got.note)
      if (got.location) out.push({ r: row, c: col, location: got.location })
      else if (!got.note) notes.push('有条链接的跳转目标认不出来，未收进来')
      continue
    }
    out.push({ r: row, c: col, url })
  }
  return out
}

/**
 * 从快照里取批注与超链接。
 * sheets 只要三样：id（对回 resources 的分家键与 #gid= 的指向）、name（location 用表名）、
 * cellData（链接住在富文本里）。
 */
export function extractCellSide(
  resources: unknown,
  sheets: Array<{ id: string; name: string; cellData: unknown }>,
): CellSideResult {
  const side = new Map<string, CellSide>()
  const notes: string[] = []
  const idToName = new Map(sheets.map((s) => [s.id, s.name]))
  const noteMap = noteMapOf(resources, notes)
  for (const s of sheets) {
    const byRow = (s.cellData ?? {}) as Record<string, Record<string, unknown> | undefined>
    const links: CellLinkPayload[] = []
    for (const [rStr, row] of Object.entries(byRow)) {
      const r = posInt(Number(rStr))
      if (r === undefined || !row) continue
      for (const [cStr, cell] of Object.entries(row)) {
        const c = posInt(Number(cStr))
        if (c === undefined) continue
        links.push(...linksAt(r, c, cell, idToName, notes))
      }
    }
    links.sort((a, b) => a.r - b.r || a.c - b.c)
    const noteList = notesOfSheet(s.id, noteMap, notes)
    if (links.length || noteList.length) {
      side.set(s.id, {
        ...(noteList.length ? { notes: noteList } : {}),
        ...(links.length ? { links } : {}),
      })
    }
  }
  return { side, notes }
}

function noteMapOf(resources: unknown, notes: string[]): Record<string, unknown> | null {
  const list = Array.isArray(resources) ? resources : []
  const entry = list.find((r) => (r as { name?: unknown } | null)?.name === NOTE_PLUGIN) as
    | { data?: unknown }
    | undefined
  const data = typeof entry?.data === 'string' ? entry.data : undefined
  // 空字符串是"这一版没有批注"，不是坏数据（未名工作簿的 resources 里就有空壳条目）
  if (!data) return null
  try {
    const parsed = JSON.parse(data) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    notes.push('有一条批注记录读不开，未收进来')
    return null
  }
}

function notesOfSheet(
  sheetId: string,
  noteMap: Record<string, unknown> | null,
  notes: string[],
): CellNotePayload[] {
  const bySheet = noteMap?.[sheetId]
  if (!bySheet || typeof bySheet !== 'object') return []
  const out: CellNotePayload[] = []
  for (const [rStr, row] of Object.entries(bySheet as Record<string, unknown>)) {
    const r = posInt(Number(rStr))
    if (r === undefined || !row || typeof row !== 'object') continue
    for (const [cStr, raw] of Object.entries(row as Record<string, unknown>)) {
      const c = posInt(Number(cStr))
      if (c === undefined) continue
      const note = noteAt(r, c, raw, notes)
      if (note) out.push(note)
    }
  }
  return out.sort((a, b) => a.r - b.r || a.c - b.c)
}

/** 链接格的富文本：Univer 用 p 而不是 v 显示这一格，所以放侧要连段尾与区间一起建出来 */
export function richTextBox(url: string, text: string, rangeId: string): Record<string, unknown> {
  const len = [...text].length
  return {
    id: 'd',
    documentStyle: {
      pageSize: { width: null, height: null },
      documentFlavor: 0,
      marginTop: 0,
      marginBottom: 2,
      marginRight: 2,
      marginLeft: 2,
      paragraphLineGapDefault: 0,
      renderConfig: { horizontalAlign: 0, verticalAlign: 0, centerAngle: 0, vertexAngle: 0, wrapStrategy: 0 },
    },
    body: {
      dataStream: `${text}\r\n`,
      textRuns: [],
      paragraphs: [{ startIndex: len, paragraphStyle: { horizontalAlign: 0 } }],
      sectionBreaks: [{ startIndex: len + 1 }],
      customRanges: [
        { startIndex: 0, endIndex: Math.max(0, len - 1), rangeType: HYPERLINK_RANGE, rangeId, properties: { url } },
      ],
      customDecorations: [],
    },
    drawings: {},
    drawingsOrder: [],
  }
}

/**
 * 批注放回快照：门面的 createOrUpdateNote 能建，但逐格是一条命令，一张表几百条批注会一串命令
 * 排在首开路径上；实测裸写 resources 与走门面建出来的产物一模一样，所以这里直接产 resources 那一条。
 * id 由位置推出来（同一格始终同一个 id），存一次盘整不会让所有批注换标识。
 */
export function noteResourceOf(
  sheets: Array<{ id: string; notes?: CellNotePayload[] }>,
): { name: string; data: string } | null {
  const out: Record<string, Record<string, Record<string, unknown>>> = {}
  for (const s of sheets) {
    if (!s.notes?.length) continue
    const byRow: Record<string, Record<string, unknown>> = {}
    for (const n of s.notes) {
      const row = (byRow[String(n.r)] ??= {})
      row[String(n.c)] = {
        note: n.text,
        width: Math.round(n.width ?? 128),
        height: Math.round(n.height ?? 74),
        ...(n.show ? { show: true } : {}),
        id: `oo-${s.id}-${n.r}-${n.c}`,
        row: n.r,
        col: n.c,
      }
    }
    out[s.id] = byRow
  }
  return Object.keys(out).length ? { name: NOTE_PLUGIN, data: JSON.stringify(out) } : null
}

/**
 * 把打开时读到的元数据按格子回贴到存盘载荷上。
 * 批注作者与链接提示文字是 Univer 模型装不下的东西（批注模型只有正文，链接只有地址与显示文本），
 * 而外来 resource 活不过 createWorkbook（实测），所以只能自己留档再回贴。
 * 只回贴"看得见的那个对象"的附属信息：批注或链接被删了，这次存盘就没有对应格子，旧记录自然作废，
 * 不会凭空复活一条用户已经删掉的东西。
 */
export function restampCellSide(fresh: CellSide, loaded: CellSide | undefined): void {
  if (!loaded) return
  if (loaded.notes?.length && fresh.notes?.length) {
    const byKey = new Map(loaded.notes.map((n) => [`${n.r},${n.c}`, n]))
    for (const n of fresh.notes) {
      if (n.author) continue
      const old = byKey.get(`${n.r},${n.c}`)
      if (old?.author) n.author = old.author
    }
  }
  if (loaded.links?.length && fresh.links?.length) {
    const byKey = new Map(loaded.links.map((l) => [`${l.r},${l.c}`, l]))
    for (const l of fresh.links) {
      if (l.tip) continue
      const old = byKey.get(`${l.r},${l.c}`)
      if (old?.tip) l.tip = old.tip
    }
  }
}
