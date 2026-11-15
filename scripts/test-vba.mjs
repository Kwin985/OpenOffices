// VBA 子集的端到端验证（Node 侧，不依赖 Tauri / 真编辑器）
//
// 查四件事：
//   1. 转译链（lex → parse → emit）在各种语句上都不散架
//   2. 生成出来的 JS 真的能跑，并且跑出来的结果是 VBA 该有的结果
//   3. VBA 的对象模型（ActiveDocument / Selection / Range / Find）踩在宏 API 上是对的
//   4. 不支持的东西报的是带行号的清楚错，不是静默跑偏
//
// 这里的"编辑器"是一个假的：它只提供 TextMap 与各命令需要的那几个面
// （doc.forEach、selection、chain().focus().setTextSelection().run()）。
// 假编辑器的 PM 位置就等于 1 基字符下标——平坦文本下二者恰好同一把尺子，
// 所以 replaceRange 的账在这层验证里是准的。
import { looksLikeVba, runVba, transpileVba, VBA_SAMPLE } from '../src/lib/vba.ts'
import { frPluginKey } from '../src/lib/find-replace.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => {
  ;(cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
}

// ── 假编辑器 + 假宏 API ──────────────────────────────────────────────────────

class FakeDoc {
  constructor(text = '', from = 1, to = 1) {
    this.text = text
    this.from = from
    this.to = to
  }
  /** 状态只有一份，且 selection 是活的：api 与 editor 两头都看得见同一份选区 */
  get state() {
    const self = this
    if (!this._st) {
      const doc = {
        forEach(fn) {
          let off = 0
          for (const p of self.text.split('\n')) {
            fn({ textContent: p }, off, 0)
            off += p.length + 1
          }
        },
        textBetween(from, to, sep = '') {
          return self.text.slice(from - 1, to - 1).split('\n').join(sep)
        },
      }
      this._st = {
        doc,
        get selection() {
          return { from: self.from, to: self.to }
        },
        set selection(v) {
          self.from = v.from
          self.to = v.to
        },
      }
    }
    return this._st
  }
  get editor() {
    const self = this
    const st = this.state
    const ch = {
      focus: () => ch,
      setTextSelection: (r) => {
        st.selection = { from: r.from, to: r.to }
        return ch
      },
      insertContentAt: (range, json) => {
        const from = typeof range === 'number' ? range : range.from
        const to = typeof range === 'number' ? range : range.to
        const t = json.content.map((p) => (p.content ? p.content[0].text : '')).join('\n')
        self.replaceRange(from, to, t)
        return ch
      },
      insertContent: (s) => {
        self.replaceRange(self.from, self.to, s)
        return ch
      },
      run: () => true,
    }
    const matchesOf = (q) => {
      if (!q) return []
      const out = []
      let at = self.text.indexOf(q)
      while (at >= 0) {
        out.push({ from: at + 1, to: at + q.length + 1 })
        at = self.text.indexOf(q, at + 1)
      }
      return out
    }
    return {
      state: st,
      getText: () => self.text,
      commands: {
        setFindQuery: (q) => {
          st[frPluginKey.key] = { matches: matchesOf(q), query: q, caseSensitive: false }
          const m = matchesOf(q)[0]
          if (m) st.selection = { from: m.from, to: m.to }
          return true
        },
        findNext: () => {
          const r = st[frPluginKey.key]
          if (!r || !r.matches.length) return false
          const next = r.matches.find((m) => m.from >= st.selection.to) ?? r.matches[0]
          st.selection = { from: next.from, to: next.to }
          return true
        },
        replaceAll: (rep) => {
          const r = st[frPluginKey.key]
          if (!r || !r.matches.length) return false
          const q = r.query
          self.text = self.text.split(q).join(rep)
          self.from = 1
          self.to = 1
          return true
        },
      },
      chain: () => ch,
    }
  }
  get api() {
    const self = this
    return {
      getText: () => self.text,
      getSelection: () => self.text.slice(self.from - 1, self.to - 1),
      insert: (s) => {
        self.text = self.text.slice(0, self.from - 1) + s + self.text.slice(self.from - 1)
        self.from += s.length
        self.to = self.from
      },
      replaceSelection: (s) => self.replaceRange(self.from, self.to, s),
      replaceRange: (from, to, text) => {
        self.text = self.text.slice(0, from - 1) + text + self.text.slice(to - 1)
        self.from = from
        self.to = from + text.length
        return true
      },
      replaceAll: (find, rep) => {
        if (!find) return 0
        const parts = self.text.split(find)
        const n = parts.length - 1
        if (n) self.text = parts.join(rep)
        return n
      },
      findNth: (needle, n) => {
        if (!needle) return false
        let at = -1
        for (let i = 0; i <= n; i++) {
          at = self.text.indexOf(needle, at + 1)
          if (at < 0) return false
        }
        self.from = at + 1
        self.to = at + needle.length + 1
        return true
      },
      stats: () => ({
        chars: self.text.length,
        words: (self.text.match(/[^\s]+/g) ?? []).length,
        paragraphs: self.text.split('\n').filter((l) => l.trim()).length,
      }),
      log: () => {},
      status: () => {},
      setTextSoft: (s) => {
        self.text = s
      },
    }
  }
  replaceRange(from, to, text) {
    this.text = this.text.slice(0, from - 1) + text + this.text.slice(to - 1)
    this.from = from
    this.to = from + text.length
  }
}

/** 跑一段 VBA，返回 { ok, log, error, doc } */
function run(src, doc = new FakeDoc()) {
  const res = runVba(src, doc.editor, () => {}, 'C:\\docs\\a.doc')
  return { ...res, doc, api: doc.api }
}

// ── 1. 转译层 ────────────────────────────────────────────────────────────────

check('认得出 VBA', looksLikeVba('Sub Main()\nEnd Sub') === true)
check('不把 JS 误判成 VBA', looksLikeVba('const a = 1\napi.log(a)') === false)
check('认得出 Private Sub', looksLikeVba('Private Sub Foo()\nEnd Sub') === true)

{
  const t = transpileVba('Sub Main()\n  MsgBox "hi"\nEnd Sub')
  check('转译成功', t.ok === true, t.error)
  check('入口是 Main', t.entry === 'Main')
  check('生成了过程与调用', /function \$Main\(\)/.test(t.code) && /\$Main\(\)\s*$/.test(t.code), t.code)
}

// 续行、注释、冒号分隔、标签行
{
  const src = ['Rem 这是一条 Rem 注释', "Sub Main() ' 行尾注释", '  Dim s As String', '  s = "a" & _', '      "b"', '  s = s & "c" : s = s & "d"', 'MyLabel:', '  Debug.Print s', 'End Sub'].join('\n')
  const t = transpileVba(src)
  check('续行/注释/冒号/标签都能转', t.ok === true, t.error)
}

// ── 2. 语句与表达式 ──────────────────────────────────────────────────────────

{
  const r = run('Sub Main()\n  Debug.Print 2 + 3 * 4\nEnd Sub')
  check('算术与优先级', r.ok && r.log[0] === '14', `${r.error ?? r.log[0]}`)
}
{
  const r = run('Sub Main()\n  Debug.Print 10 - 2 - 3\nEnd Sub')
  check('减法左结合', r.ok && r.log[0] === '5', `${r.error ?? r.log[0]}`)
}
{
  const r = run('Sub Main()\n  Debug.Print 2 ^ 3 ^ 2\nEnd Sub')
  check('幂右结合 2^3^2=512', r.ok && r.log[0] === '512', `${r.error ?? r.log[0]}`)
}
{
  const r = run('Sub Main()\n  Debug.Print -2 ^ 2\nEnd Sub')
  // MS 文档的优先级表把 ^ 列在一元负号上面：-2^2 = -(2^2) = -4
  check('一元负号松于 ^（-2^2=-4）', r.ok && r.log[0] === '-4', `${r.error ?? r.log[0]}`)
}
{
  const r = run('Sub Main()\n  Debug.Print 7 \\ 2\nEnd Sub')
  check('整数除法 7\\2=3', r.ok && r.log[0] === '3', `${r.error ?? r.log[0]}`)
}
{
  const r = run('Sub Main()\n  Debug.Print -7 Mod 3\nEnd Sub')
  check('Mod 取被除数符号 -7Mod3=-1', r.ok && r.log[0] === '-1', `${r.error ?? r.log[0]}`)
}
{
  const r = run('Sub Main()\n  Debug.Print "a" & 1 & "b"\nEnd Sub')
  check('& 是字符串连接', r.ok && r.log[0] === 'a1b', `${r.error ?? r.log[0]}`)
}
{
  const r = run('Sub Main()\n  Debug.Print True\nEnd Sub')
  check('True 打印成 True', r.ok && r.log[0] === 'True', `${r.error ?? r.log[0]}`)
}
{
  const r = run('Sub Main()\n  Debug.Print "10" = "10"\nEnd Sub')
  check('= 是比较', r.ok && r.log[0] === 'True', `${r.error ?? r.log[0]}`)
}
{
  const r = run('Sub Main()\n  Debug.Print "abc" Like "a?c"\nEnd Sub')
  check('Like 通配', r.ok && r.log[0] === 'True', `${r.error ?? r.log[0]}`)
}
{
  const r = run('Sub Main()\n  Debug.Print 1 = 1 And 2 = 2\nEnd Sub')
  check('And 逻辑', r.ok && r.log[0] === 'True', `${r.error ?? r.log[0]}`)
}
{
  const r = run('Sub Main()\n  Debug.Print 5 And 3\nEnd Sub')
  check('整数 And 按位', r.ok && r.log[0] === '1', `${r.error ?? r.log[0]}`)
}
{
  const r = run('Sub Main()\n  Debug.Print Round(2.5)\nEnd Sub')
  check('Round 四舍六入五成双', r.ok && r.log[0] === '2', `${r.error ?? r.log[0]}`)
}
{
  const r = run('Sub Main()\n  Debug.Print Round(3.5)\nEnd Sub')
  check('Round 五成双取偶', r.ok && r.log[0] === '4', `${r.error ?? r.log[0]}`)
}
{
  const r = run('Sub Main()\n  Debug.Print Len("你好ab")\nEnd Sub')
  check('Len 中文按字符', r.ok && r.log[0] === '4', `${r.error ?? r.log[0]}`)
}

// ── 3. 控制流 ────────────────────────────────────────────────────────────────

{
  const r = run('Sub Main()\n  Dim i As Integer\n  Dim s As String\n  For i = 1 To 5\n    s = s & i\n  Next i\n  Debug.Print s\nEnd Sub')
  check('For/Next 累加', r.ok && r.log[0] === '12345', `${r.error ?? r.log[0]}`)
}
{
  const r = run('Sub Main()\n  Dim i As Integer\n  Dim s As String\n  For i = 5 To 1 Step -2\n    s = s & i\n  Next i\n  Debug.Print s\nEnd Sub')
  check('For/Next 负步长', r.ok && r.log[0] === '531', `${r.error ?? r.log[0]}`)
}
{
  const r = run('Sub Main()\n  Dim a\n  a = Array(10, 20, 30)\n  Dim s As String\n  Dim v\n  For Each v In a\n    s = s & v\n  Next v\n  Debug.Print s\nEnd Sub')
  check('For Each 走数组', r.ok && r.log[0] === '102030', `${r.error ?? r.log[0]}`)
}
{
  const r = run('Sub Main()\n  Dim i As Integer\n  Dim s As String\n  Do While i < 3\n    i = i + 1\n    s = s & i\n  Loop\n  Debug.Print s\nEnd Sub')
  check('Do While/Loop', r.ok && r.log[0] === '123', `${r.error ?? r.log[0]}`)
}
{
  const r = run('Sub Main()\n  Dim i As Integer\n  Dim s As String\n  Do\n    i = i + 1\n    s = s & i\n  Loop Until i >= 3\n  Debug.Print s\nEnd Sub')
  check('Do/Loop Until', r.ok && r.log[0] === '123', `${r.error ?? r.log[0]}`)
}
{
  const r = run('Sub Main()\n  Dim i As Integer\n  i = 0\n  While i < 3\n    i = i + 1\n  Wend\n  Debug.Print i\nEnd Sub')
  check('While/Wend', r.ok && r.log[0] === '3', `${r.error ?? r.log[0]}`)
}
{
  const r = run('Sub Main()\n  Dim x As Integer\n  x = 2\n  Select Case x\n    Case 1\n      Debug.Print "one"\n    Case 2, 3\n      Debug.Print "two-or-three"\n    Case Is > 5\n      Debug.Print "big"\n    Case Else\n      Debug.Print "other"\n  End Select\nEnd Sub')
  check('Select Case 多值与 Is', r.ok && r.log[0] === 'two-or-three', `${r.error ?? r.log[0]}`)
}
{
  const r = run('Sub Main()\n  Dim x As Integer\n  x = 9\n  Select Case x\n    Case 1 To 5\n      Debug.Print "low"\n    Case 6 To 10\n      Debug.Print "mid"\n    Case Else\n      Debug.Print "high"\n  End Select\nEnd Sub')
  check('Select Case To 区间', r.ok && r.log[0] === 'mid', `${r.error ?? r.log[0]}`)
}
{
  const r = run('Sub Main()\n  Dim x As Integer\n  x = 7\n  If x < 5 Then\n    Debug.Print "small"\n  ElseIf x < 10 Then\n    Debug.Print "mid"\n  Else\n    Debug.Print "big"\n  End If\nEnd Sub')
  check('If/ElseIf/Else', r.ok && r.log[0] === 'mid', `${r.error ?? r.log[0]}`)
}
{
  const r = run('Sub Main()\n  Dim x As Integer\n  x = 1\n  If x = 1 Then Debug.Print "inline" Else Debug.Print "no"\nEnd Sub')
  check('单行 If/Else', r.ok && r.log[0] === 'inline', `${r.error ?? r.log[0]}`)
}
{
  const r = run('Sub Main()\n  Dim i As Integer\n  Dim s As String\n  For i = 1 To 10\n    If i > 3 Then Exit For\n    s = s & i\n  Next i\n  Debug.Print s\nEnd Sub')
  check('Exit For', r.ok && r.log[0] === '123', `${r.error ?? r.log[0]}`)
}
{
  const r = run('Sub Main()\n  Dim i As Integer\n  i = 0\n  Do\n    i = i + 1\n    If i >= 3 Then Exit Do\n  Loop\n  Debug.Print i\nEnd Sub')
  check('Exit Do', r.ok && r.log[0] === '3', `${r.error ?? r.log[0]}`)
}
{
  const r = run('Sub Main()\n  With Application\n    Debug.Print .Name\n  End With\nEnd Sub')
  check('With 块', r.ok && r.log[0] === 'OpenOffices', `${r.error ?? r.log[0]}`)
}

// ── 4. 过程与变量 ────────────────────────────────────────────────────────────

{
  const r = run('Function Double(x As Integer) As Integer\n  Double = x * 2\nEnd Function\n\nSub Main()\n  Debug.Print Double(21)\nEnd Sub')
  check('Function 返回值', r.ok && r.log[0] === '42', `${r.error ?? r.log[0]}`)
}
{
  const r = run('Function Add(a As Integer, b As Integer) As Long\n  Add = a + b\nEnd Function\n\nSub Main()\n  Debug.Print Add(1, 2)\nEnd Sub')
  check('多参数 Function', r.ok && r.log[0] === '3', `${r.error ?? r.log[0]}`)
}
{
  const r = run('Function Greet(Optional name As String) As String\n  If name = "" Then\n    Greet = "hi"\n  Else\n    Greet = "hi " & name\n  End If\nEnd Function\n\nSub Main()\n  Debug.Print Greet()\n  Debug.Print Greet("bob")\nEnd Sub')
  check('Optional 形参', r.ok && r.log[0] === 'hi' && r.log[1] === 'hi bob', `${r.error ?? r.log.join('/')}`)
}
{
  const r = run('Dim g As Integer\n\nSub SetIt()\n  g = 5\nEnd Sub\n\nSub Main()\n  SetIt\n  Debug.Print g\nEnd Sub')
  check('模块级变量跨过程', r.ok && r.log[0] === '5', `${r.error ?? r.log[0]}`)
}
{
  const r = run('Sub Helper()\n  Debug.Print "from helper"\nEnd Sub\n\nSub Main()\n  Call Helper()\nEnd Sub')
  check('Call 语句', r.ok && r.log[0] === 'from helper', `${r.error ?? r.log[0]}`)
}
{
  const r = run('Sub Helper(s As String)\n  Debug.Print s\nEnd Sub\n\nSub Main()\n  Helper "bare"\nEnd Sub')
  check('无括号实参表', r.ok && r.log[0] === 'bare', `${r.error ?? r.log[0]}`)
}
{
  const r = run('Sub Main()\n  Dim x As Integer\n  x = 1\n  Dim y As Integer\n  y = 2\n  Debug.Print x + y\nEnd Sub')
  check('顺序 Dim', r.ok && r.log[0] === '3', `${r.error ?? r.log[0]}`)
}

// ── 5. 数组 ──────────────────────────────────────────────────────────────────

{
  const r = run('Sub Main()\n  Dim a(3) As String\n  a(0) = "x"\n  a(3) = "y"\n  Debug.Print LBound(a) & "-" & UBound(a)\n  Debug.Print a(0) & a(3)\nEnd Sub')
  check('数组下标与边界', r.ok && r.log[0] === '0-3' && r.log[1] === 'xy', `${r.error ?? r.log.join('/')}`)
}
{
  const r = run('Option Base 1\n\nSub Main()\n  Dim a(3) As String\n  a(1) = "x"\n  Debug.Print LBound(a) & "-" & UBound(a)\n  Debug.Print a(1)\nEnd Sub')
  check('Option Base 1', r.ok && r.log[0] === '1-3' && r.log[1] === 'x', `${r.error ?? r.log.join('/')}`)
}
{
  const r = run('Sub Main()\n  Dim a(1 To 3) As Integer\n  a(1) = 7\n  Debug.Print a(1) + a(3)\nEnd Sub')
  check('To 形式的上下界', r.ok && r.log[0] === '7', `${r.error ?? r.log[0]}`)
}
{
  const r = run('Sub Main()\n  Dim a(2) As Integer\n  a(0) = 1\n  a(1) = 2\n  ReDim Preserve a(3)\n  a(2) = 3\n  Debug.Print a(0) & a(1) & a(2)\nEnd Sub')
  check('ReDim Preserve', r.ok && r.log[0] === '123', `${r.error ?? r.log[0]}`)
}
{
  const r = run('Sub Main()\n  Dim a(1) As Integer\n  Debug.Print UBound(Split("a,b,c", ","))\nEnd Sub')
  check('Split 得到 0 基数组', r.ok && r.log[0] === '2', `${r.error ?? r.log[0]}`)
}
{
  const r = run('Sub Main()\n  Debug.Print Join(Split("a,b,c", ","), "-")\nEnd Sub')
  check('Join', r.ok && r.log[0] === 'a-b-c', `${r.error ?? r.log[0]}`)
}

// ── 6. 集合 ──────────────────────────────────────────────────────────────────

{
  const r = run('Sub Main()\n  Dim c As New Collection\n  c.Add "first"\n  c.Add "second"\n  Debug.Print c.Count\n  Debug.Print c.Item(2)\n  Dim v\n  Dim s As String\n  For Each v In c\n    s = s & v & ";"\n  Next v\n  Debug.Print s\nEnd Sub')
  check('Collection Add/Item/Count/For Each', r.ok && r.log[0] === '2' && r.log[1] === 'second' && r.log[2] === 'first;second;', `${r.error ?? r.log.join('/')}`)
}
{
  const r = run('Sub Main()\n  Dim d\n  Set d = CreateObject("Scripting.Dictionary")\n  d.Add "k", "v"\n  Debug.Print d.Exists("k")\n  Debug.Print d.Item("k")\n  Debug.Print d.Count\nEnd Sub')
  check('Dictionary', r.ok && r.log[0] === 'True' && r.log[1] === 'v' && r.log[2] === '1', `${r.error ?? r.log.join('/')}`)
}

// ── 7. 对象模型 ──────────────────────────────────────────────────────────────

{
  const doc = new FakeDoc('hello world')
  const r = run('Sub Main()\n  Debug.Print ActiveDocument.Content.Text\n  Debug.Print ActiveDocument.Content.Start\n  Debug.Print ActiveDocument.Content.End\nEnd Sub', doc)
  check('Content.Text/Start/End', r.ok && r.log[0] === 'hello world' && r.log[1] === '1' && r.log[2] === '12', `${r.error ?? r.log.join('/')}`)
}
{
  const doc = new FakeDoc('hello world')
  const r = run('Sub Main()\n  ActiveDocument.Content.Text = "bye"\nEnd Sub', doc)
  check('Content.Text 赋值', r.ok && doc.text === 'bye', `${r.error ?? doc.text}`)
}
{
  const doc = new FakeDoc('hello world')
  const r = run('Sub Main()\n  ActiveDocument.Range(1, 6).Text = "HELLO"\nEnd Sub', doc)
  check('Range 赋值', r.ok && doc.text === 'HELLO world', `${r.error ?? doc.text}`)
}
{
  const doc = new FakeDoc('hello world', 7, 12)
  const r = run('Sub Main()\n  Debug.Print Selection.Text\n  Debug.Print Selection.Start & "-" & Selection.End\nEnd Sub', doc)
  check('Selection.Text/Start/End', r.ok && r.log[0] === 'world' && r.log[1] === '7-12', `${r.error ?? r.log.join('/')}`)
}
{
  const doc = new FakeDoc('hello world', 7, 12)
  const r = run('Sub Main()\n  Selection.Text = "there"\nEnd Sub', doc)
  check('Selection.Text 赋值', r.ok && doc.text === 'hello there', `${r.error ?? doc.text}`)
}
{
  const doc = new FakeDoc('hello world')
  const r = run('Sub Main()\n  Selection.InsertBefore ">> "\nEnd Sub', doc)
  check('InsertBefore', r.ok && doc.text === '>> hello world', `${r.error ?? doc.text}`)
}
{
  const doc = new FakeDoc('hello world', 7, 12)
  const r = run('Sub Main()\n  Selection.Delete\nEnd Sub', doc)
  check('Selection.Delete', r.ok && doc.text === 'hello ', `${r.error ?? doc.text}`)
}
{
  const doc = new FakeDoc('a b c')
  const r = run('Sub Main()\n  Debug.Print ActiveDocument.Words.Count\n  Debug.Print ActiveDocument.Paragraphs.Count\n  Debug.Print ActiveDocument.Characters.Count\nEnd Sub', doc)
  check('Words/Paragraphs/Characters 计数', r.ok && r.log[0] === '3' && r.log[1] === '1' && r.log[2] === '5', `${r.error ?? r.log.join('/')}`)
}
{
  const doc = new FakeDoc('the quick brown fox')
  const r = run('Sub Main()\n  With ActiveDocument.Content.Find\n    .Text = "quick"\n    .Replacement.Text = "slow"\n    .Execute Replace:=wdReplaceAll\n  End With\nEnd Sub', doc)
  check('Find.Execute 属性式替换', r.ok && doc.text === 'the slow brown fox', `${r.error ?? doc.text}`)
}
{
  const doc = new FakeDoc('one two one two')
  const r = run('Sub Main()\n  ActiveDocument.Content.Find.Execute "one", "1", wdReplaceAll\nEnd Sub', doc)
  check('Find.Execute 命名实参', r.ok && doc.text === '1 two 1 two', `${r.error ?? doc.text}`)
}
{
  const doc = new FakeDoc('one two')
  const r = run('Sub Main()\n  If ActiveDocument.Content.Find.Execute("two") Then\n    Selection.Text = "2"\n  End If\nEnd Sub', doc)
  check('Find.Execute 查找并改写', r.ok && doc.text === 'one 2', `${r.error ?? doc.text}`)
}
{
  const doc = new FakeDoc('abc')
  const r = run('Sub Main()\n  Debug.Print ActiveDocument.Name\n  Debug.Print ActiveDocument.Path\nEnd Sub', doc)
  check('Name/Path', r.ok && r.log[0] === 'a.doc' && r.log[1] === 'C:\\docs\\a.doc', `${r.error ?? r.log.join('/')}`)
}
{
  const r = run('Sub Main()\n  Debug.Print vbCrLf\n  Debug.Print vbTab\nEnd Sub')
  check('vbCrLf/vbTab', r.ok && r.log[0] === '\r\n' && r.log[1] === '\t', JSON.stringify(r.log))
}
{
  const r = run('Sub Main()\n  Documents.Add\nEnd Sub')
  check('Documents.Add 报没实现', !r.ok && /没有实现/.test(r.error ?? ''), r.error)
}

// ── 8. On Error ──────────────────────────────────────────────────────────────

{
  const r = run('Sub Main()\n  On Error Resume Next\n  Dim x\n  x = 1 / 0\n  Debug.Print " survived"\n  On Error GoTo 0\n  Debug.Print Err.Number <> 0\nEnd Sub')
  check('On Error Resume Next', r.ok && r.log[0] === ' survived' && r.log[1] === 'True', `${r.error ?? r.log.join('/')}`)
}
{
  const r = run('Sub Main()\n  Dim x\n  x = 1 / 0\nEnd Sub')
  check('不开 Resume Next 时除零照抛', !r.ok && /除以零/.test(r.error ?? ''), r.error)
}

// ── 9. 字符串函数 ────────────────────────────────────────────────────────────

const strCases = [
  ['Left("hello", 2)', 'he'],
  ['Right("hello", 2)', 'lo'],
  ['Mid("hello", 2, 3)', 'ell'],
  ['Mid("hello", 2)', 'ello'],
  ['UCase("aB")', 'AB'],
  ['LCase("aB")', 'ab'],
  ['Trim("  x  ")', 'x'],
  ['LTrim("  x  ")', 'x  '],
  ['RTrim("  x  ")', '  x'],
  ['InStr("abc", "b")', '2'],
  ['InStr(2, "abc", "c")', '3'],
  ['InStr("abc", "z")', '0'],
  ['Replace("aXaXa", "X", "-")', 'a-a-a'],
  ['StrReverse("abc")', 'cba'],
  ['Space(3) & "|"', '   |'],
  ['String(3, "ab")', 'aaa'],
  ['String(3, 65)', 'AAA'],
  ['Chr(65)', 'A'],
  ['Asc("A")', '65'],
  ['Abs(-3)', '3'],
  ['Int(-1.5)', '-2'],
  ['Fix(-1.5)', '-1'],
  ['Sqr(16)', '4'],
  ['CInt("42")', '42'],
  ['CDbl("1.5")', '1.5'],
  ['CStr(42)', '42'],
  ['IsNumeric("12")', 'True'],
  ['IsNumeric("1x")', 'False'],
  ['IsEmpty(Empty)', 'True'],
  ['IIf(1 = 2, "a", "b")', 'b'],
  ['Format(1.5, "0.00")', '1.50'],
  ['Format(1234.5, "#,##0")', '1,235'],
  ['Format(0.25, "0%")', '25%'],
  ['TypeName("x")', 'String'],
  ['TypeName(1)', 'Long'],
  ['TypeName(Empty)', 'Empty'],
]
for (const [expr, want] of strCases) {
  const r = run(`Sub Main()\n  Debug.Print ${expr}\nEnd Sub`)
  check(`内置 ${expr}`, r.ok && r.log[0] === want, `${r.error ?? r.log[0]}`)
}

// ── 10. 报错要清楚 ───────────────────────────────────────────────────────────

{
  const r = run('Sub Main()\n  GoTo Label\nEnd Sub')
  check('GoTo 报不支持并带行号', !r.ok && /第 2 行/.test(r.error ?? '') && /不支持/.test(r.error ?? ''), r.error)
}
{
  const r = run('Sub Main()\n  Dim x As Foo\n  x = Bar()\nEnd Sub')
  check('没声明过的变量报清楚', !r.ok && /没有名为|没有声明过/.test(r.error ?? ''), r.error)
}
{
  const r = run('Sub Main()\n  Debug.Print Shell("cmd")\nEnd Sub')
  check('认得但没实现的函数报 NYI', !r.ok && /还没有实现/.test(r.error ?? ''), r.error)
}
{
  const r = run('Sub Main()\n  MsgBox "unclosed\nEnd Sub')
  check('字符串不闭合报错', !r.ok && /字符串/.test(r.error ?? ''), r.error)
}
{
  const r = run('Sub Main()\n  If x Then\n  Debug.Print 1\nEnd Sub')
  check('缺 End If 报错', !r.ok && /End Sub|闭合/.test(r.error ?? ''), r.error)
}
{
  const r = run('Sub Main()\n  For i = 1 To 3\n  Debug.Print i\nEnd Sub')
  check('For 缺 Next 报错', !r.ok && /闭合|End Sub/.test(r.error ?? ''), r.error)
}
{
  const r = run('Sub Main()\n  Type T\n    x As Integer\n  End Type\nEnd Sub')
  check('Type 报不支持', !r.ok && /不支持|类模块/.test(r.error ?? ''), r.error)
}
{
  const r = run('x = 1\n')
  check('过程外的语句报错', !r.ok && /过程外面/.test(r.error ?? ''), r.error)
}

// ── 11. 面板上那条一键样例 ────────────────────────────────────────────────────

{
  const t = transpileVba(VBA_SAMPLE)
  check('VBA_SAMPLE 转得动', t.ok === true, t.error)
  check('VBA_SAMPLE 入口是 Main', t.entry === 'Main')
  const doc = new FakeDoc('old old new old')
  const r = run(VBA_SAMPLE, doc)
  check('VBA_SAMPLE 真能跑（Find 全量替换）', r.ok && doc.text === 'new new new new', `${r.error ?? doc.text}`)
  check('VBA_SAMPLE 有 MsgBox 输出', r.log.some((l) => l.includes('换完了')), JSON.stringify(r.log))
}

// ── 汇总 ─────────────────────────────────────────────────────────────────────

console.log(`通过 ${ok.length} / ${ok.length + bad.length}`)
if (bad.length) {
  console.log('\n失败的用例：')
  for (const b of bad) console.log('  × ' + b)
  process.exit(1)
}
