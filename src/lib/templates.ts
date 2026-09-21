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
