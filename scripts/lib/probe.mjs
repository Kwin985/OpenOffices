// 量具的取样与探针注入（v0.157 从 scripts/fidelity-report.mjs 搬出来）。
//
// 这份东西是「量具的量具」：它把产品源从某个 git rev 取成一次性副本，只在副本上
// 往 ooxml.ts 的 attr / attrL 两枚漏斗里塞记录行，再把读手那份 __PROBE 再导出给脚本。
// 三条纪律原样保留，改之前先读：
//   1) 注入行绝不能以 ( 或 [ 开头（ASI 会把上一行的 return undefined 续写成调用）；
//   2) 探针只写记录，不改任何返回值——--clean-pass 就是这条的闸；
//   3) __PROBE 必须从读手模块图里再导出，入口另 import 一份会得到两个 Map。
//
// 为什么要抽：往返账（scripts/fidelity-roundtrip.mjs）要用同一套取样与注入。两处各抄
// 一份的话，改一处忘另一处，两份账就不可比了。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
// ---- 2. 一次性模块副本 + 探针注入 -------------------------------------------

export function materialize(dir, { repo, ref = 'HEAD' } = {}) {
  const gitRun = (args, buf) =>
    execFileSync('git', args, { cwd: repo, encoding: buf ? 'utf8' : null, maxBuffer: 128 * 1024 * 1024 })
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  let files
  try {
    files = gitRun(['ls-files', 'src/lib'], true).split(/\r?\n/).filter((s) => /\.(ts|tsx)$/.test(s))
  } catch {
    files = []
  }
  let fromGit = files.length > 0
  if (!fromGit) {
    files = fs
      .readdirSync(path.join(repo, 'src/lib'))
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .map((f) => `src/lib/${f}`)
  }
  for (const f of files) {
    const rel = f.replace(/^src\/lib\//, '')
    const bytes = fromGit ? gitRun(['show', `${ref}:${f}`]) : fs.readFileSync(path.join(repo, f))
    fs.writeFileSync(path.join(dir, rel), bytes)
  }
  return { count: files.length, fromGit }
}

export const RECORDER = `
// ---- 探针注入块（只写记录，不改任何返回值）----
const __seen = new Map<string, number>()
export const __PROBE = {
  seen: __seen,
  key(parentName: string, attrName: string): string {
    const lp = parentName.includes(':') ? parentName.slice(parentName.indexOf(':') + 1) : parentName
    const la = attrName.includes(':') ? attrName.slice(attrName.indexOf(':') + 1) : attrName
    return lp + '|' + la
  },
  note(parentName: string, attrName: string) {
    const k = this.key(parentName, attrName)
    __seen.set(k, (__seen.get(k) ?? 0) + 1)
  },
}

`

export function injectProbe(file, mut) {
  let src = fs.readFileSync(file, 'utf8')
  const inj = [
    {
      id: 'attr',
      skip: mut === 'no-attr',
      find: 'export function attr(el: XEl | undefined, name: string): string | undefined {\n  return el?.attrs[name]',
      put: 'export function attr(el: XEl | undefined, name: string): string | undefined {\n  if (el) __PROBE.note(el.name, name)\n  return el?.attrs[name]',
    },
    {
      id: 'attrL',
      skip: mut === 'no-attrL',
      find: 'export function attrL(el: XEl | undefined, name: string): string | undefined {\n  if (!el) return undefined',
      put: 'export function attrL(el: XEl | undefined, name: string): string | undefined {\n  if (!el) return undefined\n  __PROBE.note(el.name, name)',
    },
  ]
  const anchor = "\nimport "
  // ooxml.ts 自己一枚 import 都没有（迷你解析器不吃依赖），所以 lastIndexOf 落空时按「第一行之后」插
  const i0 = src.lastIndexOf(anchor)
  const nl = src.indexOf('\n', i0 < 0 ? 0 : i0 + 1)
  if (nl < 0) throw new Error('注入中止：找不到 import 尾部')
  src = src.slice(0, nl + 1) + RECORDER + src.slice(nl + 1)
  const applied = []
  for (const x of inj) {
    if (x.skip) continue
    const hits = src.split(x.find).length - 1
    if (hits !== 1) throw new Error(`注入锚点 ${x.id} 命中 ${hits} 次（应为 1）`)
    src = src.replace(x.find, x.put)
    applied.push(x.id)
  }
  // 注入的那一行绝不能以 ( 或 [ 开头：它前面是 `if (!el) return undefined`，而「换行 + (」在 ASI 下
  // 是上一行的续写，会被读成 return undefined(__PROBE.note(...)) —— 报 "undefined is not a function"，
  // 且只在那枚件走到 attrL 时才抛。等价腿（只一边错=0）是抓住它的闸，见 README 的量具坑一节。
  fs.writeFileSync(file, src, 'utf8')
  return applied
}

// 主题链的两条变异腿（v0.156）：都只改 themeRefCss 那一段，一处是「解析」一处是「查问」。
//   no-theme       —— 主题恒解析不出来（三道 return 里的第一道无条件命中）。
//                     期望**覆盖率一动不动**：这就是 v0.155 那处修法的断言——
//                     shade/tint 的查问被提到了 return 之前，与解析结果无关。
//                     谁把它们挪回 return 之后（旧写法），这一腿当场掉分。
//   no-themeshade  —— 还原旧写法：shade/tint 两枚根本不查问。
//                     期望**覆盖率下降**：证明那两枚属性确实是账上的分子来源，
//                     不是靠别的路径顺带看到的。
//
// v0.159 锚点搬家：`themeRefCss` 拆成了 `themeRefParts`（查问三枚、回原值）+
// `themeCssOf`（纯解析），因为 `w:u` 要把主题三枚的原值带进模型（解析出来的 hex
// 回不去槽）。两条腿随之各落各的新家——查问在 parts 里、解析在 cssOf 里，
// 这恰好让「查问与解析解耦」这条纪律的断言更直接：no-theme 只动解析那一行，
// no-themeshade 只动查问那两行。
export function injectMut(file, mut) {
  if (mut !== 'no-theme' && mut !== 'no-themeshade') return []
  let src = fs.readFileSync(file, 'utf8')
  const inj =
    mut === 'no-theme'
      ? {
          id: 'theme',
          find: '  if (!theme || !p.ref) return undefined',
          put: '  if (!p.ref || true) return undefined',
        }
      : {
          id: 'themeshade',
          find: '  const tint = attr(el, tintAttr)\n  const shade = attr(el, shadeAttr)',
          put: '  const tint = undefined\n  const shade = undefined',
        }
  const hits = src.split(inj.find).length - 1
  if (hits !== 1) throw new Error(`注入锚点 ${inj.id} 命中 ${hits} 次（应为 1）`)
  src = src.replace(inj.find, inj.put)
  fs.writeFileSync(file, src, 'utf8')
  return [inj.id]
}

// 读手副本再导出探针：脚本只从 reader.__PROBE 取账，不另开一份 ooxml.ts 的导入。
// 为什么必须这样——vite-node 下同一个 .ts 文件按不同路径形状导入是两个模块实例
// （实测：入口脚本按绝对路径 `E:/…/ooxml.ts` 动态导入 vs docx-fidelity.ts 内按
// './ooxml' 相对导入，`__PROBE.seen` 是两个不同的 Map，脚本读的那份永远是空的；
// 入口按相对路径导入学能合上，但那是路径形状的巧合）。再导出把「读到读手那一份」
// 变成模块图的基本保证：reader.__PROBE 就是读手自己 import 的那个 __PROBE。
export function injectReaderReexport(file) {
  let src = fs.readFileSync(file, 'utf8')
  const anchor = "} from './table-cond'\n"
  const hits = src.split(anchor).length - 1
  if (hits !== 1) throw new Error(`再导出锚点命中 ${hits} 次（应为 1）`)
  src = src.replace(anchor, anchor + "export { __PROBE } from './ooxml'\n")
  fs.writeFileSync(file, src, 'utf8')
  return 'reader.__PROBE(再导出)'
}

