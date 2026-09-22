// 迷你 XML 解析器（只读，面向 OOXML 部件）。
// 为什么不用 DOMParser：结构测试跑在 node 里没有 DOM，浏览器端为一次导入再引一份 XML 依赖也
// 不划算；而 docx 的部件是 Word 生成的规整 XML，需要的只是"元素+属性+文本"这一层。
// 刻意宽松：标签不配按时向上找同名闭合而不是抛异常——导入坏文件应当少部分内容照出，而不是整篇打不开。
// 前缀原样保留（查子元素写 'w:p'），同时也提供按 local name 匹配的 findL/attrL，
// 因为不同生成器给同一命名空间挑的前缀不一定相同（LibreOffice 的 r:embed 实测就见过写成 rel:embed）。

export interface XEl {
  name: string
  attrs: Record<string, string>
  children: (XEl | string)[]
}

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

const ATTR_RE = /([:A-Za-z_][-.\w:]*)\s*=\s*("([^"]*)"|'([^']*)')/g

/** 实体还原：命名实体五个 + 十进制/十六进制数字实体；认不出的原样留着 */
export function decodeEnt(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const cp = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10)
      if (!Number.isFinite(cp) || cp < 1 || cp > 0x10ffff) return whole
      try {
        return String.fromCodePoint(cp)
      } catch {
        return whole
      }
    }
    return NAMED[body] ?? whole
  })
}

export function parseXml(src: string): XEl {
  const doc: XEl = { name: '#doc', attrs: {}, children: [] }
  const stack: XEl[] = [doc]
  const pushText = (raw: string) => {
    const top = stack[stack.length - 1]
    const last = top.children[top.children.length - 1]
    if (typeof last === 'string') top.children[top.children.length - 1] = last + raw
    else top.children.push(raw)
  }
  let i = 0
  const n = src.length
  while (i < n) {
    const lt = src.indexOf('<', i)
    if (lt < 0) {
      pushText(decodeEnt(src.slice(i)))
      break
    }
    if (lt > i) pushText(decodeEnt(src.slice(i, lt)))
    if (src.startsWith('<!--', lt)) {
      const e = src.indexOf('-->', lt)
      i = e < 0 ? n : e + 3
      continue
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const e = src.indexOf(']]>', lt)
      pushText(src.slice(lt + 9, e < 0 ? n : e))
      i = e < 0 ? n : e + 3
      continue
    }
    if (src.startsWith('<?', lt)) {
      const e = src.indexOf('?>', lt)
      i = e < 0 ? n : e + 2
      continue
    }
    if (src.startsWith('<!', lt)) {
      // doctype（含内部子集）：整段跳过
      const e = src.indexOf('>', lt)
      i = e < 0 ? n : e + 1
      continue
    }
    // 属性值里允许出现 '>'，所以闭标签的位置要跳过引号内内容再找
    let gt = lt + 1
    let q = ''
    while (gt < n) {
      const c = src[gt]
      if (q) {
        if (c === q) q = ''
      } else if (c === '"' || c === "'") q = c
      else if (c === '>') break
      gt++
    }
    const tag = src.slice(lt + 1, gt)
    if (tag[0] === '/') {
      const name = tag.slice(1).trim()
      const at = lastIndex(stack, name)
      // 不配对时向上找到同名再闭合；找不到就忽略这枚尾标签（宽松优先，不抛）
      if (at > 0) stack.length = at
      i = gt + 1
      continue
    }
    // 属性值可以以 / 结尾（如 <w:tab w:val="/"/>），故只有引号外的尾斜杠才算自闭合
    const selfClosed = tag.endsWith('/') && !inQuotes(tag.slice(0, -1))
    const body = selfClosed ? tag.slice(0, -1) : tag
    const name = body.slice(0, tagWordEnd(body))
    const el: XEl = { name, attrs: {}, children: [] }
    ATTR_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = ATTR_RE.exec(body))) el.attrs[m[1]] = decodeEnt(m[3] ?? m[4] ?? '')
    stack[stack.length - 1].children.push(el)
    stack.push(el)
    if (selfClosed) stack.pop()
    i = gt + 1
  }
  return doc
}

function tagWordEnd(s: string): number {
  let i = 0
  while (i < s.length && !/[\s/>]/.test(s[i])) i++
  return i
}

/** 去掉尾字符后的片段是否停在了引号里（奇数个未转义引号） */
function inQuotes(s: string): boolean {
  let q = ''
  for (const c of s) {
    if (q === c) q = ''
    else if (!q && (c === '"' || c === "'")) q = c
  }
  return q !== ''
}

function lastIndex(stack: XEl[], name: string): number {
  for (let k = stack.length - 1; k >= 1; k--) if (stack[k].name === name) return k
  return -1
}

export function local(name: string): string {
  const c = name.indexOf(':')
  return c < 0 ? name : name.slice(c + 1)
}

export function els(el: XEl): XEl[] {
  return el.children.filter((c): c is XEl => typeof c !== 'string')
}

export function attr(el: XEl | undefined, name: string): string | undefined {
  return el?.attrs[name]
}

/** 按 local name 取属性（r:embed / rel:embed 都算命中） */
export function attrL(el: XEl | undefined, name: string): string | undefined {
  if (!el) return undefined
  if (el.attrs[name] !== undefined) return el.attrs[name]
  for (const k in el.attrs) if (local(k) === name) return el.attrs[k]
  return undefined
}

export function attrNum(el: XEl | undefined, name: string): number | undefined {
  const v = attr(el, name) ?? attrL(el, name)
  if (v === undefined) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/** 子元素里首个全名等于 name 的（'w:pPr' 这种写法） */
export function find(el: XEl | undefined, name: string): XEl | undefined {
  if (!el) return undefined
  for (const c of el.children) if (typeof c !== 'string' && c.name === name) return c
  return undefined
}

export function all(el: XEl | undefined, name: string): XEl[] {
  if (!el) return []
  const out: XEl[] = []
  for (const c of el.children) if (typeof c !== 'string' && c.name === name) out.push(c)
  return out
}

/** 按 local name 匹配子元素（不认前缀） */
export function allL(el: XEl | undefined, name: string): XEl[] {
  if (!el) return []
  const out: XEl[] = []
  for (const c of el.children) if (typeof c !== 'string' && local(c.name) === name) out.push(c)
  return out
}

export function findL(el: XEl | undefined, name: string): XEl | undefined {
  if (!el) return undefined
  for (const c of el.children) if (typeof c !== 'string' && local(c.name) === name) return c
  return undefined
}

/** 逐层下钻（每段可写全名或 local name），任一段缺失即 undefined */
export function child(el: XEl | undefined, ...path: string[]): XEl | undefined {
  let cur = el
  for (const seg of path) {
    if (!cur) return undefined
    cur = find(cur, seg) ?? (seg.includes(':') ? undefined : findL(cur, seg))
  }
  return cur
}

/** 全部后代元素（不含自身），用于 drawing 里找 blip 这类深浅不一的嵌套 */
export function descend(el: XEl, out: XEl[] = []): XEl[] {
  for (const c of el.children) {
    if (typeof c === 'string') continue
    out.push(c)
    descend(c, out)
  }
  return out
}

export function findDesc(el: XEl, name: string): XEl | undefined {
  for (const d of descend(el)) if (d.name === name || local(d.name) === name) return d
  return undefined
}

export function allDesc(el: XEl, name: string): XEl[] {
  return descend(el).filter((d) => d.name === name || local(d.name) === name)
}

/** 后代文本按文档顺序拼接（w:t 之间的空白一个不加——Word 自己决定断句） */
export function textOf(el: XEl | string): string {
  if (typeof el === 'string') return el
  let s = ''
  for (const c of el.children) {
    if (typeof c === 'string') s += c
    else s += textOf(c)
  }
  return s
}
