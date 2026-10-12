/**
 * 命名样式的编辑器渲染层（v0.106）：把 DocMeta.styles 的摊平快照编译成 CSS 规则，
 * 段落上只挂 data-pstyle 标签，屏幕呈现统一由这里出的样式表驱动——样式定义一改，
 * 挂着这个标签的段落全文即时变，这就是「样式」区别于「逐段格式」的全部意义。
 *
 * 优先级靠 CSS 天然次序兜住：段落直接格式是 inline style，永远压过这里的规则——
 * 与 Word「直接格式覆盖样式」的语义一致，不需要任何特判。
 */
import { BUILTIN_STYLE_IDS, type DocxStyleInfo, type TableCondType } from './docx'
import { CELL_EDGES } from './cell-style'

/** styleId 会原样进 CSS 属性选择器，反斜杠和引号必须先处理（Word 的 id 一般是 NCName，但别赌） */
function cssAttrEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/** Word 字体名进 CSS 一律加引号：含空格的名字（Times New Roman）不加引号会被拆成字体列表 */
function quoted(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** run 层快照 → CSS 声明（段落与字符样式共用一套口径） */
function runDecls(r: DocxStyleInfo['run']): string[] {
  const decls: string[] = []
  if (r.font) decls.push(`font-family:${quoted(r.font)}`)
  if (r.sizePx !== undefined) decls.push(`font-size:${r.sizePx}px`)
  if (r.bold) decls.push('font-weight:700')
  if (r.italic) decls.push('font-style:italic')
  // 下划线与删除线共用 text-decoration 槽，都有就并一起
  const deco = [r.underline ? 'underline' : '', r.strike ? 'line-through' : ''].filter(Boolean)
  if (deco.length) decls.push(`text-decoration:${deco.join(' ')}`)
  if (r.color) decls.push(`color:${r.color}`)
  return decls
}

/** para 层快照 → CSS 声明 */
function paraDecls(p: DocxStyleInfo['para']): string[] {
  const decls: string[] = []
  if (p.align) decls.push(`text-align:${p.align}`)
  if (p.lineHeight !== undefined) {
    // auto 是倍数原样写；exact/atLeast 是像素绝对值
    decls.push(p.lineRule === 'exact' || p.lineRule === 'atLeast' ? `line-height:${p.lineHeight}px` : `line-height:${p.lineHeight}`)
  }
  if (p.marginLeftPx !== undefined) decls.push(`margin-left:${p.marginLeftPx}px`)
  if (p.marginRightPx !== undefined) decls.push(`margin-right:${p.marginRightPx}px`)
  if (p.textIndentPx !== undefined) decls.push(`text-indent:${p.textIndentPx}px`)
  if (p.spaceBeforePx !== undefined) decls.push(`margin-top:${p.spaceBeforePx}px`)
  if (p.spaceAfterPx !== undefined) decls.push(`margin-bottom:${p.spaceAfterPx}px`)
  return decls
}

/**
 * 表样式快照 → 格子直吃的那部分（底纹与格边距），与各自的行列位置无关（v0.114）。
 *
 * 命中点刻意落在 `td/th` 而不是 `table`：Word 的表级层横向看比 CSS 的 table 元素深一层——
 * `w:tcMar`（格边距）、`w:shd`（默认格底纹）的画面主要由格子承担，
 * 挂在 `<table>` 上的 padding/background 会被 `<td>` 自己的盒模型挡在外面。
 */
function tableCellDecls(t: NonNullable<DocxStyleInfo['table']>): string[] {
  const decls: string[] = []
  if (t.background) decls.push(`background-color:${t.background}`)
  if (t.padTopPx !== undefined) decls.push(`padding-top:${t.padTopPx}px`)
  if (t.padRightPx !== undefined) decls.push(`padding-right:${t.padRightPx}px`)
  if (t.padBottomPx !== undefined) decls.push(`padding-bottom:${t.padBottomPx}px`)
  if (t.padLeftPx !== undefined) decls.push(`padding-left:${t.padLeftPx}px`)
  return decls
}

/**
 * 表样式的六条边框线 → 按行列位置落地的规则（v0.121，清掉 v0.116 那笔简化账）。
 *
 * Word 的 `w:tblBorders` 是**六条各管一段**的线：`top/right/bottom/left` 只描最外那一圈，
 * `insideH/insideV` 只描格子之间的横线与竖线，两者分工不同、从不重叠。此前这里把四条外框边
 * 一股脑给到每个格子、`insideH/insideV` 就此蒸发——于是「清单型」这类只声明内部横线、
 * 压根没有外框的表样式，在屏幕上一根线也看不到（导出侧一直是对的，所以存盘进 Word 又是好的，
 * 差额只在屏幕上）。
 *
 * 现在改成「首/末行（列）走外框、其余走内部线」，与 docx-fidelity 内联那条路径
 * （`cb.top ?? (ri === 0 ? tb.top : tb.insideH)`）同形，两条渲染路径就此对齐。
 * 表格是 `border-collapse: collapse`（index.css），相邻两格共享同一条边，各写不冲突。
 *
 * 剩下两条是 CSS 表达本身的局限：① `first-child`/`last-child` 只看 DOM 位置，碰到
 * rowspan/colspan 的合并格会把它当成普通非首格（内联路径能按 `gc + colspan >= rowEnd` 算准）；
 * ② 这里每格只落一条边，所以本族内部不存在互相覆盖，条件层仍靠「排在后面 + 特异度不低于它」压住。
 */
function tableBorderRules(sel: string, t: NonNullable<DocxStyleInfo['table']>): string[] {
  const cell = ':is(td,th)'
  const rowRule = (pos: string, decl: string) => `${sel} tr:${pos} > ${cell}{${decl}}`
  const colRule = (pos: string, decl: string) => `${sel} ${cell}:${pos}{${decl}}`
  const out: string[] = []
  if (t.bdTop) out.push(rowRule('first-child', `border-top:${t.bdTop}`))
  if (t.bdInsideH) out.push(rowRule('not(:first-child)', `border-top:${t.bdInsideH}`))
  if (t.bdBottom) out.push(rowRule('last-child', `border-bottom:${t.bdBottom}`))
  if (t.bdInsideH) out.push(rowRule('not(:last-child)', `border-bottom:${t.bdInsideH}`))
  if (t.bdLeft) out.push(colRule('first-child', `border-left:${t.bdLeft}`))
  if (t.bdInsideV) out.push(colRule('not(:first-child)', `border-left:${t.bdInsideV}`))
  if (t.bdRight) out.push(colRule('last-child', `border-right:${t.bdRight}`))
  if (t.bdInsideV) out.push(colRule('not(:last-child)', `border-right:${t.bdInsideV}`))
  return out
}

/**
 * 条件层 → CSS 规则（v0.116 起）：十二个部位各出一条选择器。
 *
 * 位置用结构伪类表达：`tr:nth-child(...)` 是说第几行、`td:nth-child(...)` 是说第几列，
 * 与 Word 那边"按位置落账"是同一件事。`nth-child(n)` 是"全体"的写法，它的用处是
 * 把每一条补齐到同样多的伪类数——于是规则之间特异度相等，**先后次序就是胜负**。
 *
 * 但条件层有两族不同的优先级（都是 Word 16.0 实测出来的，不是一条通用梯子，见 docx-fidelity）：
 * - **边距族**（格边距 `w:tcMar`）：角型只压列型、**不压行型**——`condMarginLadder` 是「行型 > 角型 > 列型」，
 *   所以 `COND_RULES_MARGIN` 把四角排在行型之前，行型压角。
 * - **外观族**（底纹 `w:shd` / 条件边框 `w:tcBorders` / 粗体）：角型压一切——`condShadingFor` /
 *   `condBordersFor` 是「四角最先说、先说先定」，所以 `COND_RULES_APPEARANCE` 把四角排在梯子最末，
 *   同一格被首行+首列+角三型同时命中时**专属角赢**（对齐 Word 界面，v0.118 修掉了此前"行压角"的简化账）。
 * 两族各自按自己的序出规则，且两族写的 CSS 属性互不相交（外观只写背景/边框/粗体，边距只写 padding），
 * 所以两族之间不会互相覆盖，只在本族内部拼先后。
 */
const COND_RULES_MARGIN: { type: TableCondType; row: string; col: string }[] = [
  { type: 'band1Vert', row: 'nth-child(n)', col: 'nth-child(odd)' },
  { type: 'band2Vert', row: 'nth-child(n)', col: 'nth-child(even)' },
  { type: 'band1Horz', row: 'nth-child(odd)', col: 'nth-child(n)' },
  { type: 'band2Horz', row: 'nth-child(even)', col: 'nth-child(n)' },
  { type: 'firstColumn', row: 'nth-child(n)', col: 'first-child' },
  { type: 'lastColumn', row: 'nth-child(n)', col: 'last-child' },
  { type: 'nwCell', row: 'first-child', col: 'first-child' },
  { type: 'neCell', row: 'first-child', col: 'last-child' },
  { type: 'swCell', row: 'last-child', col: 'first-child' },
  { type: 'seCell', row: 'last-child', col: 'last-child' },
  { type: 'lastRow', row: 'last-child', col: 'nth-child(n)' },
  { type: 'firstRow', row: 'first-child', col: 'nth-child(n)' },
]

/** 外观族梯子（角型压一切，四角排最末）：镜像 docx-fidelity 的 condShadingFor / condBordersFor。 */
const COND_RULES_APPEARANCE: { type: TableCondType; row: string; col: string }[] = [
  { type: 'band1Vert', row: 'nth-child(n)', col: 'nth-child(odd)' },
  { type: 'band2Vert', row: 'nth-child(n)', col: 'nth-child(even)' },
  { type: 'band1Horz', row: 'nth-child(odd)', col: 'nth-child(n)' },
  { type: 'band2Horz', row: 'nth-child(even)', col: 'nth-child(n)' },
  { type: 'firstColumn', row: 'nth-child(n)', col: 'first-child' },
  { type: 'lastColumn', row: 'nth-child(n)', col: 'last-child' },
  { type: 'lastRow', row: 'last-child', col: 'nth-child(n)' },
  { type: 'firstRow', row: 'first-child', col: 'nth-child(n)' },
  { type: 'nwCell', row: 'first-child', col: 'first-child' },
  { type: 'neCell', row: 'first-child', col: 'last-child' },
  { type: 'swCell', row: 'last-child', col: 'first-child' },
  { type: 'seCell', row: 'last-child', col: 'last-child' },
]

function condRules(sel: string, cond: NonNullable<DocxStyleInfo['table']>['cond']): string[] {
  const out: string[] = []
  // 外观族（底纹/边框/粗体）：同一格被首行+首列+角三型同时命中时专属角赢（v0.118）。
  for (const r of COND_RULES_APPEARANCE) {
    const c = cond?.[r.type]
    if (!c) continue
    const decls: string[] = []
    if (c.background) decls.push(`background-color:${c.background}`)
    if (c.bold) decls.push('font-weight:700')
    // 条件格边框（v0.117）：与底纹/粗体同特异度、后来者胜
    if (c.borders) {
      for (const e of CELL_EDGES) {
        const v = c.borders[e]
        if (v) decls.push(`border-${e}:${v}`)
      }
    }
    if (decls.length) out.push(`${sel} tr:${r.row} > :is(td,th):${r.col}{${decls.join(';')}}`)
  }
  // 边距族（padding）：行型压角型、角型压列型，与上面外观族反序（见 COND_RULES_MARGIN 说明）。
  for (const r of COND_RULES_MARGIN) {
    const c = cond?.[r.type]
    if (!c) continue
    const decls: string[] = []
    if (c.padTopPx !== undefined) decls.push(`padding-top:${c.padTopPx}px`)
    if (c.padRightPx !== undefined) decls.push(`padding-right:${c.padRightPx}px`)
    if (c.padBottomPx !== undefined) decls.push(`padding-bottom:${c.padBottomPx}px`)
    if (c.padLeftPx !== undefined) decls.push(`padding-left:${c.padLeftPx}px`)
    if (decls.length) out.push(`${sel} tr:${r.row} > :is(td,th):${r.col}{${decls.join(';')}}`)
  }
  return out
}

/**
 * 条件层行高（v0.117）：行型条件才出规则，命中落在 `tr` 元素上（不是 td）。
 * 与 condRules 同特异度的"后来者胜"无关——它压的是表级默认行高那一层。
 * 列型条件（firstColumn/lastColumn/band*Vert）的 row 是 `nth-child(n)`（全体行），不对整行说话，跳过。
 */
function condRowRules(sel: string, cond: NonNullable<DocxStyleInfo['table']>['cond']): string[] {
  const out: string[] = []
  for (const r of COND_RULES_MARGIN) {
    if (r.row === 'nth-child(n)') continue
    const c = cond?.[r.type]
    if (!c?.rowHeightPx) continue
    out.push(`${sel} tr:${r.row}{height:${c.rowHeightPx}px}`)
  }
  return out
}

/**
 * 快照 → CSS 文本。三类不出规则：标题 1-4 在编辑器里是 heading 节点，呈现由
 * .doc-content 的 h 标签样式管；库内置七类（Heading/Title/Strong…）与导出侧
 * styleDefOf 用同一个判定跳过——它们的定义进不了样式表，屏幕上也不假装吃定义，
 * 免得出现「编辑在屏幕生效、导出却原样」的半吊子行为。
 */
export function styleCssOf(styles: DocxStyleInfo[]): string {
  const out: string[] = []
  for (const s of styles) {
    if (BUILTIN_STYLE_IDS.test(s.id)) continue
    // 字符样式（v0.113）：命中挂了 data-rstyle 标签的 run（rStyle mark 的输出壳）
    if (s.kind === 'character') {
      const decls = runDecls(s.run)
      if (decls.length) out.push(`.doc-content span[data-rstyle="${cssAttrEscape(s.id)}"]{${decls.join(';')}}`)
      continue
    }
    // 表样式（v0.114）：表级那一层落在格子上；整表对齐与 run 层留在 table 元素上
    if (s.kind === 'table') {
      const sel = `.doc-content table[data-tstyle="${cssAttrEscape(s.id)}"]`
      const cells = tableCellDecls(s.table ?? {})
      if (cells.length) out.push(`${sel} td,${sel} th{${cells.join(';')}}`)
      // 表样式的六条边框线（v0.121）：排在条件层之前，让条件层照旧压得住基座层
      out.push(...tableBorderRules(sel, s.table ?? {}))
      const own: string[] = [...runDecls(s.run)]
      if (s.table?.align === 'center') own.push('margin-left:auto;margin-right:auto')
      else if (s.table?.align === 'right') own.push('margin-left:auto')
      if (own.length) out.push(`${sel}{${own.join(';')}}`)
      // 条件层（v0.116）：排在表级那条之后——同特异度下后来者优先，正是「条件层压基座层」
      out.push(...condRules(sel, s.table?.cond))
      // 条件层行高（v0.117）：行型条件落在 tr 上，独立于上面的 per-cell 规则
      out.push(...condRowRules(sel, s.table?.cond))
      continue
    }
    if (s.level && s.level <= 4) continue
    const decls = [...runDecls(s.run), ...paraDecls(s.para)]
    if (!decls.length) continue
    out.push(`.doc-content p[data-pstyle="${cssAttrEscape(s.id)}"]{${decls.join(';')}}`)
  }
  return out.join('\n')
}

/** 面板新建样式用的下一个空闲 id：ooS1、ooS2… 避开清单里已有的和库内置七类 */
export function nextStyleId(styles: DocxStyleInfo[]): string {
  const taken = new Set(styles.map((s) => s.id))
  for (let i = 1; ; i++) {
    const id = `ooS${i}`
    if (!taken.has(id)) return id
  }
}
