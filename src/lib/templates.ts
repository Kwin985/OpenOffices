// 首页模板体系：模板即"预置初始内容"，标签经 Tab.template 携带 id，
// 三编辑器在各自的无路径启动分支消费（Doc 走 setContent、Sheet 走 payloadToWorkbook、PPT 走 useState 初始值）。
import type { DocMeta, PMNode } from './docx'
import type { WorkbookPayload, CellPayload, CellStyle } from './fs'
import { THEMES, newId, type Deck, type Slide } from './ppt'

export interface TemplateDef {
  id: string
  kind: 'doc' | 'sheet' | 'ppt'
  name: string
  desc: string
}

export const TEMPLATES: TemplateDef[] = [
  { id: 'doc-official', kind: 'doc', name: '公文', desc: '标题 + 主送 + 正文 + 落款，页脚带页码' },
  { id: 'doc-meeting', kind: 'doc', name: '会议纪要', desc: '会议信息 / 议题 / 结论 / 待办' },
  { id: 'doc-weekly', kind: 'doc', name: '周报', desc: '本周工作 / 下周计划 / 问题与风险' },
  { id: 'sheet-ledger', kind: 'sheet', name: '记账表', desc: '收支明细 + 合计公式 + 金额格式' },
  { id: 'sheet-inventory', kind: 'sheet', name: '库存清单', desc: '冻结表头 + 金额列公式' },
  ...THEMES.map((t) => ({
    id: `ppt-${t.id}`,
    kind: 'ppt' as const,
    name: `演示 · ${t.name}`,
    desc: `${t.name}配色 · 标题/要点/收束三页`,
  })),
]

// ---------- doc ----------

const p = (text = ''): PMNode => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) })
const h = (level: number, text: string): PMNode => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] })
const li = (...items: string[]): PMNode => ({
  type: 'bulletList',
  content: items.map((t) => ({ type: 'listItem', content: [p(t)] })),
})

export function docTemplate(id: string): { content: PMNode; meta: DocMeta } {
  let blocks: PMNode[] = []
  let meta: DocMeta = {}
  if (id === 'doc-official') {
    blocks = [
      h(1, '关于×××的通知'),
      p('各有关单位：'),
      p('　　为……现将有关事项通知如下：'),
      h(2, '一、×××'),
      p('　　……'),
      h(2, '二、×××'),
      p('　　……'),
      p(''),
      p('附件：1. ×××'),
      p(''),
      p('×××单位'),
      p('2026年×月×日'),
    ]
    meta = { footerPageNumber: true }
  } else if (id === 'doc-meeting') {
    blocks = [
      h(1, '会议纪要'),
      p('会议时间：'),
      p('会议地点：'),
      p('主 持 人：'),
      p('记 录 人：'),
      p('参会人员：'),
      h(2, '一、议题'),
      li('议题一：', '议题二：'),
      h(2, '二、讨论结论'),
      p('　　1.'),
      p('　　2.'),
      h(2, '三、待办事项'),
      p('　　事项 / 责任人 / 完成时间：'),
    ]
  } else {
    blocks = [
      h(1, '工作周报'),
      p('姓名：　　部门：　　日期：　—　'),
      h(2, '本周工作'),
      li('完成事项 1（进度/结果）', '完成事项 2'),
      h(2, '下周计划'),
      li('计划事项 1', '计划事项 2'),
      h(2, '问题与风险'),
      p('　　无 / 描述与需要的支持：'),
    ]
  }
  return { content: { type: 'doc', content: blocks }, meta }
}

// ---------- sheet ----------

const head: CellStyle = { bl: true, ho: 'center', bg: '#e8f0fe' }
const money: CellStyle = { nf: '#,##0.00' }
const cell = (r: number, c: number, v: string | number, s?: CellStyle, f?: string): CellPayload => ({
  r,
  c,
  v,
  ...(s ? { s } : {}),
  ...(f ? { f } : {}),
})

export function sheetTemplate(id: string): WorkbookPayload {
  if (id === 'sheet-inventory') {
    const cells: CellPayload[] = [
      cell(0, 0, '商品名称', head), cell(0, 1, '编码', head), cell(0, 2, '数量', head), cell(0, 3, '单价', head), cell(0, 4, '金额', head),
      cell(1, 0, '示例商品 A'), cell(1, 1, 'A-001'), cell(1, 2, 10), cell(1, 3, 12.5),
      cell(1, 4, 125, money, '=C2*D2'),
      cell(2, 0, '示例商品 B'), cell(2, 1, 'B-002'), cell(2, 2, 4), cell(2, 3, 300),
      cell(2, 4, 1200, money, '=C3*D3'),
    ]
    // 金额列公式：先落缓存值，f 让 Univer 重算，xlsx/ODS 往返同源
    return {
      sheets: [{
        name: '库存',
        cells,
        colWidths: { 0: 160, 1: 100, 2: 80, 3: 90, 4: 100 },
        freeze: { rows: 1, cols: 0 },
      }],
    }
  }
  const cells: CellPayload[] = [
    cell(0, 0, '日期', head), cell(0, 1, '项目', head), cell(0, 2, '收入', head), cell(0, 3, '支出', head), cell(0, 4, '备注', head),
    cell(1, 0, '2026-09-01'), cell(1, 1, '示例：工资'), cell(1, 2, 10000, money), cell(1, 4, ''),
    cell(2, 0, '2026-09-05'), cell(2, 1, '示例：餐饮'), cell(2, 3, 120, money),
    cell(3, 0, '合计', { bl: true }),
    cell(3, 2, 10000, money, '=SUM(C2:C3)'),
    cell(3, 3, 120, money, '=SUM(D2:D3)'),
  ]
  return {
    sheets: [{
      name: '账单',
      cells,
      colWidths: { 0: 100, 1: 140, 2: 90, 3: 90, 4: 160 },
      freeze: { rows: 1, cols: 0 },
    }],
  }
}

// ---------- ppt ----------

export function pptTemplate(id: string): Deck {
  const theme = id.replace(/^ppt-/, '')
  const t = THEMES.find((x) => x.id === theme) ?? THEMES[0]
  const slides: Slide[] = [
    { id: newId(), layout: 'title', title: `${t.name}演示模板`, body: '副标题 / 汇报人 / 日期' },
    { id: newId(), layout: 'bullets', title: '要点页', body: '第一条要点\n第二条要点\n第三条要点' },
    { id: newId(), layout: 'bullets', title: '结束页', body: '谢谢观看' },
  ]
  return { app: 'openoffices', kind: 'deck', version: 1, title: `演示 · ${t.name}`, theme: t.id, slides }
}

// ── 邮件合并（v0.236）───────────────────────────────────────────────────────
// 第一版：粘贴 CSV/TSV 作数据源，正文用 «列名» 作占位，按行生成 N 份结果。
// 占位符只是文本，不写 Word 的 MERGEFIELD 域——那是第二版（要在 docx 里写域代码）。
// 纯函数放这里（templates 本来就是「预置内容」，邮件合并是它的自然延伸），不新增 lib 文件。

export interface MergeSource {
  fields: string[]
  rows: Record<string, string>[]
  /** 解析告警（如某行列数不足），如实报给用户 */
  warnings: string[]
}

/**
 * CSV/TSV 解析：首行列名，支持双引号包裹（"" 转义）、逗号/制表符分隔。
 * 不用正则硬拆——引号里可能有逗号或换行，状态机逐字符走才不会错位（房规：正则跨元素会吞边界）。
 */
export function parseMergeSource(text: string, tab = false): MergeSource {
  const sep = tab ? '\t' : ','
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let quoted = false
  const pushField = () => { row.push(field); field = '' }
  const pushRow = () => { pushField(); if (row.some((c) => c !== '')) rows.push(row); row = [] }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else quoted = false
      } else field += c
      continue
    }
    if (c === '"' && field === '') { quoted = true; continue }
    if (c === sep) { pushField(); continue }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      pushRow()
      continue
    }
    field += c
  }
  if (field || row.length) pushRow()
  if (!rows.length) return { fields: [], rows: [], warnings: [] }
  const fields = rows[0].map((f, i) => f.trim() || `列${i + 1}`)
  const warnings: string[] = []
  const data = rows.slice(1).map((r, ri) => {
    const rec: Record<string, string> = {}
    fields.forEach((f, ci) => { rec[f] = (r[ci] ?? '').trim() })
    if (r.length < fields.length) warnings.push(`第 ${ri + 2} 行列数不足，缺的列按空值处理`)
    if (r.length > fields.length) warnings.push(`第 ${ri + 2} 行列数超出，多出的列忽略`)
    return rec
  })
  return { fields, rows: data, warnings }
}

/** 从正文纯文本里找 «列名»，返回去重列名（按出现序） */
export function mergeFieldsOf(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/«([^»\n]+)»/g)) {
    const f = m[1].trim()
    if (f && !out.includes(f)) out.push(f)
  }
  return out
}

/** 把列名列表拼成一段可一次插入的占位符串（v0.240 修：避免多次 chain 插同一点） */
export function mergeFieldSnippet(fields: string[]): string {
  return fields.map((f) => `«${f}»`).join(' ')
}

/** 按一行数据替换所有占位符；没提供的值保留原占位符（不假装有值） */
export function mergeOne(text: string, row: Record<string, string>): string {
  return text.replace(/«([^»\n]+)»/g, (whole, name: string) => {
    const key = String(name).trim()
    return Object.prototype.hasOwnProperty.call(row, key) ? row[key] : whole
  })
}

/** 批量生成：一行一份，返回文本数组与缺失字段统计 */
export function mergeAll(
  text: string,
  src: MergeSource,
): { results: string[]; missing: string[] } {
  const used = mergeFieldsOf(text)
  const missing = used.filter((f) => !src.fields.includes(f))
  return { results: src.rows.map((r) => mergeOne(text, r)), missing }
}

// ── 主控文档（v0.237）───────────────────────────────────────────────────────
// 一份主控文档持有若干子文档路径（DocMeta.subDocs，随 .odoc 整体 JSON 往返）。
// 第一版：清单管理 + 逐个打开 + 按序把子文档正文展开合并进当前文档。
// 不写回子文档、不处理 .docx 子文档的格式——展开是纯文本段落级合并。

/** 子文档路径去重追加：已存在的不再加，保持原序 */
export function addSubDoc(list: string[], path: string): string[] {
  if (!path || list.includes(path)) return list
  return [...list, path]
}

/** 移除一枚（按路径），返回新数组 */
export function removeSubDoc(list: string[], path: string): string[] {
  return list.filter((p) => p !== path)
}

/** 上/下移一枚；越界返回原数组（不可变） */
export function moveSubDoc(list: string[], path: string, delta: -1 | 1): string[] {
  const i = list.indexOf(path)
  const j = i + delta
  if (i < 0 || j < 0 || j >= list.length) return list
  const out = [...list]
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}

/** 从 .odoc 的 JSON 文本里取正文纯文本（段落按 \n 拼），坏件返回空串 */
export function paragraphsFromOdoc(json: string): string {
  try {
    const o = JSON.parse(json) as { app?: string; kind?: string; content?: { content?: unknown[] } }
    if (o.app !== 'openoffices' || o.kind !== 'doc') return ''
    const nodes = o.content?.content ?? []
    const lines: string[] = []
    for (const n of nodes) {
      const node = n as { type?: string; content?: { text?: string }[] }
      if (node.type !== 'paragraph') continue
      lines.push((node.content ?? []).map((c) => c.text ?? '').join(''))
    }
    return lines.join('\n')
  } catch {
    return ''
  }
}

/** 多份子文档正文按清单序合并展开；每份之间空一行分隔（空份跳过，不造假空段） */
export function expandSubDocs(parts: string[]): string {
  return parts.map((s) => s.trim()).filter(Boolean).join('\n\n')
}

/**
 * HTML 正文 → 纯文本段落（v0.240 修）：主控文档展开 .docx 子文档时用。
 *
 * 旧写法 `html.replace(/<[^>]+>/g, ' ')` 把 `</p><p>` 换成一个空格，三段会挤成一行——
 * 展开后段落边界全丢。正确做法：先把块级结束标签换成换行，再剥剩余标签。
 * 只处理表格/列表/段落/标题这些块级边界；内联标签（b/i/span）直接剥掉即可。
 */
export function htmlToParagraphs(html: string): string {
  return html
    .replace(/<\/(?:p|div|h[1-6]|li|tr|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/td>/gi, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .split('\n')
    .map((s) => s.replace(/^\s+|\s+$/g, ''))
    .join('\n')
    .replace(/^\n+/, '') // 去首尾空行，保留正文中间的空段（那是原文的空白段落）
    .replace(/\n+$/, '')
}
