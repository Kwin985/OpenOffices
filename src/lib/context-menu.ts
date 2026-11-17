// Writer 内容区右键菜单的条目表（v0.174）——纯函数，只决定「该出现哪些项、哪些灰掉」。
//
// 为什么抽出来：菜单项的启用条件（有没有选区、光标是不是在表格里、导航开着没有、
// 格式刷待刷没有）是最容易写散的一层，而它又要能被 Node 侧钉住。命令的执行留在组件里，
// 这里一个 editor 都不碰。
//
// 刻意不放的：浏览器的「粘贴为纯文本 / 字体 / 段落对话框」这类需要模态面板的项，
// 以及任何会改文档语义却看不出后果的操作。菜单只列按下去立刻看得见结果的动作。
// v0.183 补了「清除格式」：它摘的是字符外观 mark 与样式标签，身份型 mark
// （批注/书签/修订/超链接）整列保留——按下去立刻看得见，且不越权删别人的标注。

export interface CtxState {
  hasSelection: boolean
  inTable: boolean
  navOpen: boolean
  painterArmed: boolean
}

export interface CtxItem {
  id: string
  label: string
  disabled?: boolean
  /** 分隔线项：label 不画，只有一条横线 */
  separator?: boolean
}

// ── Impress 内容区右键菜单（v0.206）──
// 与 Writer 共用 CtxItem 契约与「disabled 只在真禁用时出现」的纪律，但条目表独立：
// Impress 是自研 Deck + React 状态，没有 ProseMirror 的 editor.*，探测与执行都留在组件侧。
// 这里只按「命中的是什么」决定该出现哪些项——纯函数、零 import、Node 侧可钉。

export interface PptCtxState {
  /** 右键落在形状上（true）还是舞台空白处（false） */
  onShape: boolean
  /** 命中形状是不是图表（图表才有 CSV 编辑项） */
  isChart: boolean
  /** 命中形状是不是文本类（可就地改字） */
  isText: boolean
  /** 当前是否已在编辑该形状的文字 */
  editing: boolean
  /** 剪贴板里有没有形状（组件侧探测，纯函数只认这个布尔） */
  hasClipboard: boolean
  /** 是否还有上一页 / 下一页（首尾页灰掉翻页项） */
  hasPrev: boolean
  hasNext: boolean
}

/** 把视口坐标裁进屏幕内：菜单四边都不溢出（含左侧/顶部）。Writer / Impress 同用。 */
export function clampMenuPos(x: number, y: number, vw: number, vh: number, w = 200, h = 380): { x: number; y: number } {
  return {
    x: Math.max(8, Math.min(x, vw - w)),
    y: Math.max(8, Math.min(y, vh - h)),
  }
}

export function pptContextItems(s: PptCtxState): CtxItem[] {
  const out: CtxItem[] = []
  if (s.onShape) {
    out.push(
      { id: 'editText', label: s.editing ? '结束编辑' : '编辑文字', ...(!s.isText && !s.isChart ? { disabled: true } : {}) },
      { id: 'duplicate', label: '复制形状' },
      { id: 'delete', label: '删除形状' },
      { id: 'sep-shape', label: '', separator: true },
      { id: 'layerUp', label: '上移一层' },
      { id: 'layerDown', label: '下移一层' },
      ...(s.isChart ? [
        { id: 'sep-chart', label: '', separator: true },
        { id: 'chartData', label: '编辑图表数据' },
      ] : []),
    )
  } else {
    out.push(
      { id: 'addText', label: '插入文本框' },
      { id: 'addTable', label: '插入表格' },
      { id: 'addChart', label: '插入图表' },
      { id: 'sep-page', label: '', separator: true },
      { id: 'paste', label: '粘贴', ...(!s.hasClipboard ? { disabled: true } : {}) },
    )
  }
  out.push(
    { id: 'sep-page-nav', label: '', separator: true },
    { id: 'find', label: '查找替换' },
    { id: 'prevSlide', label: '上一页', ...(!s.hasPrev ? { disabled: true } : {}) },
    { id: 'nextSlide', label: '下一页', ...(!s.hasNext ? { disabled: true } : {}) },
  )
  return out
}

export function contextItems(s: CtxState): CtxItem[] {
  const out: CtxItem[] = [
    { id: 'undo', label: '撤销' },
    { id: 'redo', label: '重做' },
    { id: 'sep-1', label: '', separator: true },
    // disabled 只在真禁用时出现：输出里不留一枚值为 false 的属性，入口条件更干净
    { id: 'cut', label: '剪切', ...(!s.hasSelection ? { disabled: true } : {}) },
    { id: 'copy', label: '复制', ...(!s.hasSelection ? { disabled: true } : {}) },
    { id: 'paste', label: '粘贴' },
    { id: 'selectAll', label: '全选' },
    // 不随 hasSelection 灰掉：无选区时清的是「光标处后续输入会带上什么格式」，
    // 与 WPS 同口径；执行侧 unsetMark 对空选区正好落 storedMarks
    { id: 'clearFormat', label: '清除格式' },
    { id: 'sep-2', label: '', separator: true },
    { id: 'find', label: '查找替换' },
    { id: 'painter', label: s.painterArmed ? '取消格式刷' : '格式刷' },
    { id: 'nav', label: s.navOpen ? '收起导航窗格' : '打开导航窗格' },
    { id: 'pageBreak', label: '插入分页符' },
  ]
  if (s.inTable) {
    out.push(
      { id: 'sep-3', label: '', separator: true },
      { id: 'addRow', label: '在下方插入行' },
      { id: 'deleteRow', label: '删除当前行' },
    )
  }
  return out
}
