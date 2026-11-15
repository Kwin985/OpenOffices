// 脚本宏（v0.128；VBA 那一层见 vba.ts，v0.131）
//
// 宏引擎分两层，DocEditor 的面板按 `looksLikeVba` 自动分流：
//
//   1. **VBA 子集**（`src/lib/vba*.ts`）：用户手里已有的 Sub…End Sub 直接跑。
//      那是一整套语言加一座沙箱，v0.128 立项时判"不是这一版的目标"，
//      v0.131 做成了子集——认不出的构造带行号报错，不猜。
//   2. **Office Scripts 那一类**（就是本文件）：**一段 JS + 一份文档 API**，
//      能存、能改、能跑，够覆盖"把这篇里的 X 全换成 Y""清掉多余空行"这类重复劳动。
//
// 两层共用同一份文档 API（`MacroApi`）。
//
// 沙箱的诚实说法：`new Function` **不是**安全边界——同页面的脚本能摸到的东西，
// 把 `window`/`document`/`fetch` 这几个名字挡成 undefined 只是挡住了顺手那一层，
// 真要跑别人的宏，得放进 Web Worker 或独立进程。所以这里只跑**用户自己写的宏**，
// 并在面板上写清楚：不要运行来路不明的脚本。

import type { Editor } from '@tiptap/core'
import { frPluginKey } from './find-replace'
import { VBA_BOOK_SAMPLE } from './vba'

export interface Macro {
  id: string
  name: string
  code: string
  /** 内置的删不掉，只可以照着改出一份自己的 */
  builtin?: boolean
}

/** 宏那一层能碰到的文档。刻意只给这一小把：给得越宽，越容易写出会毁格式的脚本 */
export interface MacroApi {
  /** 全文纯文本（不含标记） */
  getText(): string
  /** 当前选中的文字；没选就是空串 */
  getSelection(): string
  /** 在光标处插入一段纯文本 */
  insert(s: string): void
  /** 替换当前选中区 */
  replaceSelection(s: string): void
  /** 全文替换（走查找/替换那条路，保住各处的加粗/颜色等标记），返回换了几个地方 */
  replaceAll(find: string, rep: string): number
  /** 光标挪到第 n 个匹配上（0 基） */
  findNth(needle: string, n: number): boolean
  /**
   * 按 ProseMirror 位置区间替换：区间外的格式原样保留，区间内按纯文本重写
   * （多段用 \n 分开）。VBA 的 Range/Selection 那一套靠它落地——
   * 位置用的是 PM 位置而不是字符下标，因为"字符下标"是 VBA 的货币，
   * 不是这一层的。
   */
  replaceRange(from: number, to: number, text: string): boolean
  /** 计数：字符数 / 词数（中西混排按"连续非空白"算）/ 段数 */
  stats(): { chars: number; words: number; paragraphs: number }
  /** 往宏的输出面板写一行 */
  log(...a: unknown[]): void
  /** 往状态栏说一句 */
  status(s: string): void
  /**
   * 整篇按纯文本重写。**会丢掉全部格式**（加粗、颜色、表格、图片都没了）——
   * 只该在纯文本类整理里用，所以名字里带 Soft 提醒一层：它软，不硬。
   */
  setTextSoft(s: string): void
}

export interface MacroRun {
  ok: boolean
  log: string[]
  error?: string
  /** 这一趟有没有改到文档（决定要不要标脏/存盘） */
  changed: boolean
}

const KEY = 'openoffices.macros'

function uid(): string {
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

// 内置几条：既是能直接用的工具，也是"宏长什么样"的活样例
const BUILTIN: Macro[] = [
  {
    id: 'builtin-space',
    name: '中英文之间加空格',
    builtin: true,
    code: `// 中文与英文/数字之间补一个空格（排版惯例；已有空格的不重复加）
const t = api.getText()
const out = t
  .replace(/([\\u4e00-\\u9fff])([A-Za-z0-9])/g, '$1 $2')
  .replace(/([A-Za-z0-9])([\\u4e00-\\u9fff])/g, '$1 $2')
if (out === t) {
  api.log('没有需要加空格的地方')
} else {
  let n = 0
  for (let i = 0; i < t.length; i++) if (t[i] !== out[i]) n++
  api.setTextSoft(out)
  api.log('加了', n, '处空格')
}`,
  },
  {
    id: 'builtin-blank',
    name: '合并多余空行',
    builtin: true,
    code: `// 连续空行压成一个（保留段内换行）
const t = api.getText()
const out = t.replace(/\\n{3,}/g, '\\n\\n')
if (out === t) api.log('没有多余空行')
else { api.setTextSoft(out); api.log('空行已合并') }`,
  },
  {
    id: 'builtin-trim',
    name: '去掉行尾空白',
    builtin: true,
    code: `const t = api.getText()
const out = t.split('\\n').map((l) => l.replace(/[ \\t\\u3000]+$/, '')).join('\\n')
if (out === t) api.log('没有行尾空白')
else { api.setTextSoft(out); api.log('行尾空白已清掉') }`,
  },
  {
    id: 'builtin-stats',
    name: '统计字数',
    builtin: true,
    code: `const s = api.stats()
api.log('字符', s.chars, '词', s.words, '段', s.paragraphs)
api.status(\`\${s.chars} 字符 / \${s.words} 词 / \${s.paragraphs} 段\`)`,
  },
]

export function loadMacros(): Macro[] {
  let mine: Macro[] = []
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) {
        mine = arr
          .filter((m): m is Macro => !!m && typeof m.name === 'string' && typeof m.code === 'string')
          .map((m) => ({ id: String(m.id ?? uid()), name: String(m.name), code: String(m.code) }))
      }
    }
  } catch {
    // 存不下/读不出都不该让宏面板开不起来：只是这次没有自己的宏
  }
  return [...BUILTIN, ...mine]
}

export function saveMacros(mine: Macro[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(mine.filter((m) => !m.builtin)))
  } catch {
    /* 配额满就算了 */
  }
}

export function newMacro(name = '新宏'): Macro {
  return { id: uid(), name, code: '// 在这里写宏。可用的东西都在 api 上\napi.log("你好")\n' }
}

/** 表格侧的「新建一条宏」：起步是一段空 VBA（表格里只有 VBA 子集，没有 JS 引擎） */
export function newSheetMacro(name = '新宏'): Macro {
  return { id: uid(), name, code: "' 在这里写 VBA 宏：Sub Main() … End Sub\n" }
}

// ── 表格侧的宏（v0.134） ────────────────────────────────────────────────────
//
// 表格侧与文档侧**分开存**：两边能跑的东西不一样——文档侧是 JS + VBA 两层，
// 表格侧只有 VBA 子集（`api` 那一份是文档 API，表格里没有对应物）。
// 混在一个列表里，就会出现"这条在文档里能跑、在表格里跑不了"的困惑，
// 所以键也分开：openoffices.macros（文档） / openoffices.macros.sheet（表格）。

const SHEET_KEY = 'openoffices.macros.sheet'

/** 表格侧内置：两条 VBA。既是能直接用的工具，也是"表格宏长什么样"的活样子 */
const SHEET_BUILTIN: Macro[] = [
  {
    id: 'builtin-sheet-avg',
    name: 'A 列求平均并标红',
    builtin: true,
    code: VBA_BOOK_SAMPLE,
  },
  {
    id: 'builtin-sheet-header',
    name: '给已用区域首行上底色',
    builtin: true,
    code: `' 把当前表已用区域的第一行刷成浅灰（字号那些不动）
Sub Main()
    Dim ws As Worksheet
    Set ws = ThisWorkbook.ActiveSheet
    If ws.UsedRange Is Nothing Then
        MsgBox "这一张表还是空的"
        Exit Sub
    End If
    ws.UsedRange.Rows(1).Interior.Color = RGB(217, 217, 217)
    MsgBox "已给 " & ws.UsedRange.Rows(1).Address & " 上了底色"
End Sub`,
  },
]

export function loadSheetMacros(): Macro[] {
  let mine: Macro[] = []
  try {
    const raw = localStorage.getItem(SHEET_KEY)
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) {
        mine = arr
          .filter((m): m is Macro => !!m && typeof m.name === 'string' && typeof m.code === 'string')
          .map((m) => ({ id: String(m.id ?? uid()), name: String(m.name), code: String(m.code) }))
      }
    }
  } catch {
    // 读不出就不该让面板开不起来：只是这次没有自己的宏
  }
  return [...SHEET_BUILTIN, ...mine]
}

export function saveSheetMacros(mine: Macro[]): void {
  try {
    localStorage.setItem(SHEET_KEY, JSON.stringify(mine.filter((m) => !m.builtin)))
  } catch {
    /* 配额满就算了 */
  }
}

/** 造一份绑定在当前编辑器上的 API。`changed` 由各操作自己置位。
 *  导出来是给 VBA 那一层（vba-rt.ts）复用的：它的对象模型要踩在同一份 API 上 */
export function apiOf(editor: Editor, out: string[], setStatus: (s: string) => void, st: { changed: boolean }): MacroApi {
  // 逐段建 paragraph 节点再 setContent：给 setContent 一整串带 \n 的文本，
  // 它只会得到一段（\n 在 HTML 里是空白），多段结构就没了
  const setTextSoft = (text: string) => {
    const json = {
      type: 'doc',
      content: text.split('\n').map((t) => ({
        type: 'paragraph',
        ...(t ? { content: [{ type: 'text', text: t }] } : {}),
      })),
    }
    editor.chain().focus().setContent(json).run()
    st.changed = true
  }

  return {
    getText: () => editor.getText(),
    getSelection: () => editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, '\n'),
    insert: (s) => {
      editor.chain().focus().insertContent(s).run()
      st.changed = true
    },
    replaceSelection: (s) => {
      editor.chain().focus().insertContent(s).run()
      st.changed = true
    },
    replaceAll: (find, rep) => {
      if (!find) return 0
      // 走查找/替换那条路：按文本块匹配并保住各处 mark，比整篇 setText 干净
      editor.commands.setFindQuery(find)
      // 命中数是插件 state 说了算的（storage 里没有），读那一处才数得准
      const n = frPluginKey.getState(editor.state)?.matches.length ?? 0
      if (n) editor.commands.replaceAll(rep)
      editor.commands.setFindQuery('')
      if (n) st.changed = true
      return n
    },
    findNth: (needle, n) => {
      if (!needle) return false
      editor.commands.setFindQuery(needle)
      let ok = true
      for (let i = 0; i <= n; i++) ok = editor.commands.findNext()
      return ok
    },
    replaceRange: (from, to, text) => {
      if (from >= to && !text) return false
      // 逐段建 paragraph 再 insertContentAt：给 insertContentAt 一整串带 \n 的文本，
      // \n 在 HTML 里只是空白，多段结构就没了
      const json = {
        type: 'doc',
        content: text.split('\n').map((t) => ({
          type: 'paragraph',
          ...(t ? { content: [{ type: 'text', text: t }] } : {}),
        })),
      }
      const ok = editor.chain().focus().insertContentAt({ from, to }, json).run()
      if (ok) st.changed = true
      return ok
    },
    stats: () => {
      const t = editor.getText()
      const words = (t.match(/[^\s]+/g) ?? []).length
      const paragraphs = t.split('\n').filter((l) => l.trim()).length
      return { chars: t.length, words, paragraphs }
    },
    log: (...a) => {
      out.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '))
    },
    status: (s) => setStatus(s),
    setTextSoft,
  }
}

/**
 * 跑一段宏。`new Function` 挡住 window/document/fetch 这几个名字，
 * 但如开头所说——那不是安全边界，只跑自己写的。
 *
 * 参数表里**不能**出现 `eval`：严格模式下拿它当形参名会直接 SyntaxError
 * （"Unexpected eval or arguments in strict mode"），整个宏就跑不起来。
 * 严格模式下的 eval 本来也泄漏不出绑定，挡它纯属摆设——真要有心绕，
 * `(0, eval)('...')` 一样通。所以这里只挡确实挡得住的几个名字。
 */
export function runMacro(code: string, editor: Editor, setStatus: (s: string) => void): MacroRun {
  const out: string[] = []
  const st = { changed: false }
  const api = apiOf(editor, out, setStatus, st)
  try {
    const fn = new Function(
      'api',
      'window',
      'document',
      'fetch',
      'XMLHttpRequest',
      'globalThis',
      'Function',
      `"use strict";\n${code}`,
    )
    fn(api, undefined, undefined, undefined, undefined, undefined, undefined)
    return { ok: true, log: out, changed: st.changed }
  } catch (e) {
    return { ok: false, log: out, error: e instanceof Error ? e.message : String(e), changed: st.changed }
  }
}
