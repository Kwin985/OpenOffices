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
