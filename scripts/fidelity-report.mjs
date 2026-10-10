// 属性级保真覆盖率生成器。
//
// 它量的不是「实现了多少命令」，而是：真件里一共有哪些「元素|属性」字面，读手在真实导入那一趟里
// 主动按名查过其中多少枚。分子来自运行时探针（注入在 ooxml.ts 的 attr / attrL 两枚漏斗上——整条
// 读入链按名取属性只走这两处），分母来自同一趟里用我们自己的解析器对部件全树的遍历。
// 产品源一行不改：模块层从 git rev 取出一份一次性副本，注入只发生在副本上。
//
//   pnpm exec vite-node scripts/fidelity-report.mjs --corpus D:/docs            # 出一份报告
//   pnpm exec vite-node scripts/fidelity-report.mjs --clist tmp/clist.txt       # 或按清单
//   ... --selftest        用内置夹具证明分子语义（不依赖任何语料）
//   ... --clean-pass      再跑一遍不带探针的副本，证明观察者不扰动产品
//   ... --mut no-attrL    变异档：故意漏注入一枚漏斗，覆盖率必须下降
//
// 报告里不许出现任何文件路径或文件名：语料是每个人的本地件，公开的只有聚合数字。
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import JSZip from 'jszip'

const argv = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`)
  return i < 0 ? dflt : argv[i + 1]
}
const has = (name) => argv.includes(`--${name}`)

const REPO = path.resolve(import.meta.dirname, '..')
const REF = flag('ref', 'HEAD')
const OUT_DIR = path.resolve(REPO, flag('out', 'docs'))
const MOD_DIR = path.resolve(REPO, flag('tmp', 'tmp/fidelity-mod'))
const LIMIT = Number(flag('limit', '0'))
const MUT = flag('mut', '')
const CLIST_FILE = flag('clist', '')
const CORPUS = flag('corpus', '')

// 读手真正吃进去的部件：分母只算这些，别把没打算读的部件算成丢账
const PARTS = [
  'word/document.xml',
  'word/styles.xml',
  'word/numbering.xml',
  'word/footnotes.xml',
  'word/endnotes.xml',
  'word/comments.xml',
  'word/commentsExtended.xml',
]
// Word 自己的存档流水号：零渲染语义也不进 UI，按名字规则归到噪音档而不是「丢账」
const NOISE = /^(rsid[A-Za-z]*|paraId|textId)$/

// ---- 1b. 内置夹具（--selftest）---------------------------------------------
//
// 分子语义不依赖任何语料：这一份 document.xml 里每枚属性都是我亲手放的，所以「探针应当看到哪些、
// 应当看不到哪些」可以事先写死。MUST_SEE 是读手真会按名查问的，MUST_NOT_SEE 是我故意放进去、
// 而读手（按源码现状）确实一寸都不查的——两边都断言才叫量具，只断一边等于自说自话。
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const FIXTURE_STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:styles xmlns:w="${W}">` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal">` +
  `<w:name w:val="Normal"/><w:pPr><w:spacing w:line="276" w:lineRule="auto" w:before="0" w:after="0"/>` +
  `<w:ind w:left="0" w:right="0"/></w:pPr>` +
  `<w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="等线"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>` +
  `</w:style>` +
  `<w:style w:type="paragraph" w:styleId="ReportHead"><w:name w:val="report head"/>` +
  `<w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="120"/><w:ind w:left="420"/></w:pPr>` +
  `</w:style>` +
  `</w:styles>`

const FIXTURE_DOC =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:document xmlns:w="${W}"><w:body>` +
  `<w:p w:rsidR="00A1" w:rsidRDefault="00A2" w:rsidP="00B3">` +
  `<w:pPr><w:pStyle w:val="ReportHead"/>` +
  `<w:spacing w:before="120" w:after="240" w:line="360" w:lineRule="auto" w:beforeAutospacing="0" w:afterAutospacing="0"/>` +
  `<w:ind w:left="420" w:right="210" w:firstLineChars="200" w:hangingChars="0"/>` +
  `<w:jc w:val="both"/>` +
  `<w:pBdr><w:top w:val="single" w:sz="8" w:space="1" w:color="FF0000"/>` +
  `<w:left w:val="dotted" w:sz="4" w:space="2" w:color="00FF00"/></w:pBdr></w:pPr>` +
  `<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体" w:hint="eastAsia"/>` +
  `<w:sz w:val="24"/><w:szCs w:val="28"/><w:b w:val="0"/></w:rPr>` +
  `<w:t xml:space="preserve"> 带空白的正文 </w:t></w:r></w:p>` +
  `<w:sectPr><w:pgSz w:w="11906" w:h="16838" w:orient="portrait"/>` +
  `<w:pgMar w:top="1440" w:right="1800" w:bottom="1440" w:left="1800" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr>` +
  `</w:body></w:document>`

// 读手按名查问过的（源码里 spacing / ind / jc / pStyle / rFonts / sz / b / 顶边 都走 attr 或 attrL）
const MUST_SEE = [
  'pStyle|val',
  'spacing|before',
  'spacing|after',
  'spacing|line',
  'spacing|lineRule',
  'ind|left',
  'ind|right',
  'ind|firstLineChars',
  'jc|val',
  'top|val',
  'top|sz',
  'top|space',
  'rFonts|ascii',
  'rFonts|eastAsia',
  'sz|val',
  'b|val',
]
// 我放进夹具而读手一寸不查的：hangingChars 在合并里被搬而没人读（段落读侧第一笔账记过同一件事），
// beforeAutospacing / hint / szCs / 非顶边的 space / t 的 xml:space 在源码里都没有查问处
const MUST_NOT_SEE = [
  'ind|hangingChars',
  'spacing|beforeAutospacing',
  'spacing|afterAutospacing',
  'rFonts|hint',
  'szCs|val',
  'left|space',
  't|space',
  'pgSz|orient',
  'pgMar|gutter',
]

const md5 = (s) => createHash('md5').update(s).digest('hex')
const local = (n) => (n.includes(':') ? n.slice(n.indexOf(':') + 1) : n)
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0)

function git(args, buf) {
  return execFileSync('git', args, { cwd: REPO, encoding: buf ? 'utf8' : null, maxBuffer: 128 * 1024 * 1024 })
}

// ---- 1. 语料清单 ------------------------------------------------------------

function corpusList() {
  let list = []
  if (CLIST_FILE) {
    list = fs
      .readFileSync(path.resolve(REPO, CLIST_FILE), 'utf8')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((p) => (/^\/([a-zA-Z])\//.test(p) ? p.replace(/^\/([a-zA-Z])\//, (m, d) => d.toUpperCase() + ':/') : p))
  } else {
    if (!CORPUS) throw new Error('要么给 --corpus <目录>，要么给 --clist <清单文件>')
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) {
          if (['node_modules', '.git', 'dist', 'target', '__pycache__'].includes(e.name)) continue
          walk(path.join(dir, e.name))
        } else if (/\.docx$/i.test(e.name) && !e.name.startsWith('~$')) {
          list.push(path.join(dir, e.name))
        }
      }
    }
    walk(path.resolve(CORPUS))
  }
  list.sort()
  return LIMIT > 0 ? list.slice(0, LIMIT) : list
}

// ---- 2. 一次性模块副本 + 探针注入 -------------------------------------------

function materialize(dir) {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  let files
  try {
    files = git(['ls-files', 'src/lib'], true).split(/\r?\n/).filter((s) => /\.(ts|tsx)$/.test(s))
  } catch {
    files = []
  }
  let fromGit = files.length > 0
  if (!fromGit) {
    files = fs
      .readdirSync(path.join(REPO, 'src/lib'))
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .map((f) => `src/lib/${f}`)
  }
  for (const f of files) {
    const rel = f.replace(/^src\/lib\//, '')
    const bytes = fromGit ? git(['show', `${REF}:${f}`]) : fs.readFileSync(path.join(REPO, f))
    fs.writeFileSync(path.join(dir, rel), bytes)
  }
  return { count: files.length, fromGit }
}

const RECORDER = `
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

function injectProbe(file, mut) {
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

// ---- 3. 一趟读手 + 一份分母 --------------------------------------------------

function errClass(e) {
  const m = String(e && e.message ? e.message : e)
  if (/Corrupted zip|End of data reached|unexpected end|invalid stored|compressed data|not a Zip/i.test(m)) return 'unreadable-zip'
  if (/缺 word\/document\.xml/.test(m)) return 'no-document-xml'
  // 任何引号里的东西都可能是路径，公开产物里一律抹掉
  return m.replace(/['"`][^'"`]*['"`]/g, "''").slice(0, 48)
}

function countAttrsOurParser(parseXml, root) {
  const pairs = new Map()
  let total = 0
  const visit = (el) => {
    const p = local(el.name)
    for (const k of Object.keys(el.attrs)) {
      if (k === 'xmlns' || k.startsWith('xmlns:')) continue
      const key = `${p}|${local(k)}`
      pairs.set(key, (pairs.get(key) ?? 0) + 1)
      total++
    }
    for (const c of el.children) if (typeof c !== 'string') visit(c)
  }
  visit(root)
  return { pairs, total }
}

async function runSelftest(reader, probe) {
  const seen = probe.__PROBE.seen
  const zip = new JSZip()
  zip.file('word/document.xml', FIXTURE_DOC)
  zip.file('word/styles.xml', FIXTURE_STYLES)
  const bytes = new Uint8Array(await zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
  seen.clear()
  const out = await reader.docxToHtmlFidelity(bytes)
  const got = new Set(seen.keys())
  const fails = []
  for (const k of MUST_SEE) if (!got.has(k)) fails.push(`应看到而没看到 ${k}`)
  for (const k of MUST_NOT_SEE) if (got.has(k)) fails.push(`不该看到却看到 ${k}`)
  // 夹具必须真的产出了内容，否则上面的断言是在空转
  if (!(out.blocks > 0)) fails.push('夹具 blocks=0，导入根本没跑起来')
  if (!out.html.includes('带空白的正文')) fails.push('夹具正文没进 HTML')
  let notes = 0
  for (const v of seen.values()) notes += v
  console.log(`SELFTEST|夹具 查问对=${got.size} 查问次数=${notes} blocks=${out.blocks}`)
  console.log(`SELFTEST|看到的全部键 ${[...got].sort().join(' ')}`)
  if (fails.length) {
    for (const f of fails) console.log(`SELFTEST|FAIL ${f}`)
    throw new Error(`夹具自检 ${fails.length} 条不通过`)
  }
  console.log(`SELFTEST|双向断言通过 应看到 ${MUST_SEE.length} 枚全命中，不该看到 ${MUST_NOT_SEE.length} 枚全落空`)
  seen.clear()
}

async function main() {
  const t0 = Date.now()
  const { count: modFiles, fromGit } = materialize(MOD_DIR)
  const applied = injectProbe(path.join(MOD_DIR, 'ooxml.ts'), MUT)
  const reader = await import(`${path.join(MOD_DIR, 'docx-fidelity.ts').replace(/\\/g, '/')}`)
  const { parseXml } = await import(`${path.join(MOD_DIR, 'ooxml.ts').replace(/\\/g, '/')}`)
  const probe = await import(`${path.join(MOD_DIR, 'ooxml.ts').replace(/\\/g, '/')}`)
  const seen = probe.__PROBE.seen

  if (has('selftest')) await runSelftest(reader, probe)

  let files = []
  try {
    files = corpusList()
  } catch (e) {
    if (!has('selftest')) throw e
    console.log('REPORT|没给语料，只跑 --selftest 就到此为止')
    return
  }

  let clean = null
  if (has('clean-pass')) {
    const CLEAN_DIR = path.resolve(REPO, 'tmp/fidelity-clean')
    materialize(CLEAN_DIR)
    clean = await import(`${path.join(CLEAN_DIR, 'docx-fidelity.ts').replace(/\\/g, '/')}`)
  }

  const pairs = new Map()
  const partTotals = {}
  let bytesTotal = 0
  let ok = 0
  const errs = new Map()
  let eqSame = 0
  let eqDiff = 0
  let eqErrBoth = 0
  let eqErrOne = 0
  let idx = 0

  for (const f of files) {
    idx++
    let bytes
    try {
      bytes = new Uint8Array(fs.readFileSync(f))
    } catch (e) {
      errs.set(errClass(e), (errs.get(errClass(e)) ?? 0) + 1)
      continue
    }
    bytesTotal += bytes.length
    // 分子：读手在真实导入里的按名查问
    let html
    let firstErr = ''
    try {
      html = (await reader.docxToHtmlFidelity(bytes)).html
      ok++
    } catch (e) {
      const k = errClass(e)
      firstErr = k
      errs.set(k, (errs.get(k) ?? 0) + 1)
    }
    if (clean) {
      let ch
      try {
        ch = (await clean.docxToHtmlFidelity(bytes)).html
      } catch (e) {
        ch = `ERR:${errClass(e)}`
      }
      const probeOk = html !== undefined
      const cleanOk = !String(ch).startsWith('ERR:')
      if (probeOk && cleanOk) {
        if (md5(html) === md5(ch)) eqSame++
        else eqDiff++
      } else if (!probeOk && !cleanOk) {
        // 两边都失败：错类相同才算「同一件事失败两次」，不同就是扰动
        if (String(ch).slice(4) === firstErr) eqErrBoth++
        else eqDiff++
      } else {
        eqErrOne++
      }
    }
    // 分母：同一件、同一套部件，用我们自己的解析器全树数一遍属性字面
    try {
      const zip = await JSZip.loadAsync(bytes)
      for (const p of PARTS) {
        const entry = zip.file(p)
        if (!entry) continue
        const { pairs: pp, total } = countAttrsOurParser(parseXml, parseXml(await entry.async('string')))
        partTotals[p] = (partTotals[p] ?? 0) + total
        for (const [k, v] of pp) pairs.set(k, (pairs.get(k) ?? 0) + v)
      }
    } catch (e) {
      errs.set(`census:${errClass(e)}`, (errs.get(`census:${errClass(e)}`) ?? 0) + 1)
    }
    if (idx % 50 === 0) process.stderr.write(`  … ${idx}/${files.length}\n`)
  }

  const totalOcc = sum(Object.fromEntries(pairs))
  const noise = {}
  const covered = {}
  const uncovered = {}
  for (const [k, v] of pairs) {
    const attr = k.split('|')[1]
    if (NOISE.test(attr)) noise[k] = v
    else if (seen.has(k)) covered[k] = v
    else uncovered[k] = v
  }
  const meaningful = sum(covered) + sum(uncovered)
  const byElement = new Map()
  for (const [k, v] of Object.entries(uncovered)) {
    const p = k.split('|')[0]
    byElement.set(p, (byElement.get(p) ?? 0) + v)
  }

  const data = {
    measured: { ref: REF, source: fromGit ? `git:${REF}` : 'worktree', modules: modFiles, injections: applied },
    corpus: { files: files.length, readable: ok, unreadable: files.length - ok, bytes: bytesTotal, scopeParts: PARTS },
    totals: {
      distinctPairs: pairs.size,
      occurrences: totalOcc,
      noisePairs: Object.keys(noise).length,
      noiseOccurrences: sum(noise),
      meaningfulPairs: Object.keys(covered).length + Object.keys(uncovered).length,
      meaningfulOccurrences: meaningful,
    },
    coverage: {
      byPair: Object.keys(covered).length / (Object.keys(covered).length + Object.keys(uncovered).length),
      byOccurrence: sum(covered) / meaningful,
      consultedPairs: Object.keys(covered).length,
      consultedOccurrences: sum(covered),
      neverConsultedPairs: Object.keys(uncovered).length,
      neverConsultedOccurrences: sum(uncovered),
    },
    consulted: sorted(covered),
    neverConsulted: sorted(uncovered),
    noise: sorted(noise),
    neverConsultedByElement: [...byElement.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    partTotals,
    errors: Object.fromEntries(errs),
  }
  if (clean) data.equivalence = { identical: eqSame, differing: eqDiff, bothFailed: eqErrBoth, onlyOneFailed: eqErrOne }

  const mdPath = path.join(OUT_DIR, 'fidelity.md')
  const jsonPath = path.join(OUT_DIR, 'fidelity.json')
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n', 'utf8')
  fs.writeFileSync(mdPath, renderMd(data), 'utf8')

  console.log(
    `REPORT|ref=${REF} 件=${files.length} 读成=${ok} 分母对=${pairs.size} 字面=${totalOcc} ` +
      `噪音=${sum(noise)} 有效=${meaningful} 已查问=${sum(covered)}`,
  )
  console.log(
    `REPORT|覆盖率 按对=${(data.coverage.byPair * 100).toFixed(1)}% 按字面=${(data.coverage.byOccurrence * 100).toFixed(1)}% ` +
      `注入=[${applied.join(',')}] 探针记录对=${seen.size} 用时=${((Date.now() - t0) / 1000).toFixed(1)}s`,
  )
  if (clean) console.log(`REPORT|等价腿 相同=${eqSame} 不同=${eqDiff} 两边同错=${eqErrBoth} 只一边错=${eqErrOne}`)
  console.log(`REPORT|写盘 ${path.relative(REPO, mdPath).replace(/\\/g, '/')} 与 ${path.relative(REPO, jsonPath).replace(/\\/g, '/')}`)
  console.log(`REPORT|md5 md=${md5(fs.readFileSync(mdPath, 'utf8'))} json=${md5(fs.readFileSync(jsonPath, 'utf8'))}`)
}

function sorted(o) {
  return Object.entries(o).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

function pct(x) {
  return `${(x * 100).toFixed(1)}%`
}

function n(x) {
  return x.toLocaleString('en-US')
}

function renderMd(d) {
  const row = (arr, i) => `\`${arr[i][0]}\` | ${n(arr[i][1])}`
  const L = []
  L.push('# DOCX fidelity: attribute-level coverage report')
  L.push('')
  L.push(
    'This report is generated by `scripts/fidelity-report.mjs`. It is **not** a count of implemented',
  )
  L.push(
    'commands: it compares every `element|attribute` literal that real .docx files put on the wire',
  )
  L.push(
    'against the lookups our import path actually performs on them, at run time. A pair counts as',
  )
  L.push(
    '*consulted* only if the reader asked for it by name while a real import was running.',
  )
  L.push('')
  L.push('## How to read the numbers')
  L.push('')
  L.push('| Tier | Meaning | Why it is its own tier |')
  L.push('|---|---|---|')
  L.push(
    '| **consulted** | the reader looked the pair up by name during import | not proof it changed the output — see caveats |',
  )
  L.push(
    '| **never consulted** | the pair appears in real files and no code path asks for it | the actionable list: fidelity we do not claim |',
  )
  L.push(
    '| **noise** | `rsid*`, `paraId`, `textId` | Word\'s save-session bookkeeping: no rendering and no UI meaning |',
  )
  L.push('')
  L.push(
    `Measured on the committed product at \`${d.measured.ref}\` (\`${d.measured.source}\`, ${d.measured.modules} modules,`,
  )
  L.push(
    `probe injected into ${d.measured.injections.length} accessor${d.measured.injections.length === 1 ? '' : 's'}: ${d.measured.injections.join(', ')}).`,
  )
  L.push('')
  L.push('## Headline')
  L.push('')
  L.push('| | pairs | attribute literals |')
  L.push('|---|---:|---:|')
  L.push(`| In scope (7 parts, ${d.corpus.readable} readable files) | ${n(d.totals.distinctPairs)} | ${n(d.totals.occurrences)} |`)
  L.push(`| Word save-session noise | ${n(d.totals.noisePairs)} | ${n(d.totals.noiseOccurrences)} |`)
  L.push(`| Meaningful universe | ${n(d.totals.meaningfulPairs)} | ${n(d.totals.meaningfulOccurrences)} |`)
  L.push(`| Consulted | ${n(d.coverage.consultedPairs)} | ${n(d.coverage.consultedOccurrences)} |`)
  L.push(`| Never consulted | ${n(d.coverage.neverConsultedPairs)} | ${n(d.coverage.neverConsultedOccurrences)} |`)
  L.push('')
  L.push(
    `**Coverage: ${pct(d.coverage.byPair)} of distinct pairs, ${pct(d.coverage.byOccurrence)} of meaningful literals.**`,
  )
  L.push('')
  L.push(
    `The corpus held ${n(d.corpus.files)} .docx files (${(d.corpus.bytes / 1048576).toFixed(0)} MiB); ${d.corpus.unreadable} were`,
  )
  L.push('unreadable as archives and are reported by failure class only, never by name.')
  L.push('')
  L.push('## Never consulted — largest first')
  L.push('')
  L.push('| `element|attribute` | literals |')
  L.push('|---|---:|')
  for (let i = 0; i < Math.min(30, d.neverConsulted.length); i++) L.push(`| ${row(d.neverConsulted, i)} |`)
  L.push('')
  L.push('## Which elements the missing literals sit on')
  L.push('')
  L.push('| element | never-consulted literals |')
  L.push('|---|---:|')
  for (let i = 0; i < Math.min(20, d.neverConsultedByElement.length); i++) {
    L.push(`| \`${d.neverConsultedByElement[i][0]}\` | ${n(d.neverConsultedByElement[i][1])} |`)
  }
  L.push('')
  L.push('## Consulted — the work already paid for')
  L.push('')
  L.push('| `element|attribute` | literals |')
  L.push('|---|---:|')
  for (let i = 0; i < Math.min(30, d.consulted.length); i++) L.push(`| ${row(d.consulted, i)} |`)
  L.push('')
  L.push('## Caveats, stated before anyone reads them off')
  L.push('')
  L.push(
    '- **consulted is not "landed on screen".** A pair can be looked up and then dropped (we read',
  )
  L.push(
    '  `w:top/@w:space` only to warn) or carried by a merge and never read (`w:ind/@w:hangingChars`).',
  )
  L.push(
    '  The second column of that table is the next round of work, not a claim of visual parity.',
  )
  L.push(
    '- **never consulted is not "visibly wrong".** `w:szCs` drives complex script, `xml:space` drives',
  )
  L.push(
    '  whitespace our tokenizer already keeps, `w:lang` drives spellcheck. Each row needs its own',
  )
  L.push(
    '  verdict against real Word before it becomes a bug.',
  )
  L.push(
    '- **the numerator needs a corpus, the claim does not.** Nothing here depends on a specific',
  )
  L.push(
    '  document: rerun with `--selftest` for a fixture whose lookups are known in advance.',
  )
  L.push('')
  L.push('## Reproduce')
  L.push('')
  L.push('```sh')
  L.push('pnpm exec vite-node scripts/fidelity-report.mjs --corpus /path/to/docx')
  L.push('pnpm exec vite-node scripts/fidelity-report.mjs --corpus /path/to/docx --selftest --clean-pass')
  L.push('python3 scripts/fidelity-census.py        # independent denominator, second parser')
  L.push('```')
  L.push('')
  L.push('The report is deterministic: same corpus list and same source revision give byte-identical')
  L.push('output, so a diff of `docs/fidelity.md` is a diff of fidelity, not of a timestamp.')
  L.push('')
  L.push('## Evidence that the instrument works')
  L.push('')
  L.push('| leg | what it proves |')
  L.push('|---|---|')
  L.push('| `--selftest` | the probe sees exactly the lookups a fixture dictates, including the pairs we deliberately do not read |')
  L.push('| `--clean-pass` | the patched copy and an unpatched copy emit byte-identical HTML for every readable file: the observer does not perturb the product |')
  L.push('| `--mut no-attrL` | coverage drops: the numerator really comes from run-time lookups, not from a name list in the source |')
  L.push('| `scripts/fidelity-census.py` | a second, different XML parser (Python `xml.etree`) counts the same denominator |')
  if (d.equivalence) {
    L.push('')
    L.push(
      `Last run: identical=${d.equivalence.identical}, differing=${d.equivalence.differing}, both-failed=${d.equivalence.bothFailed}, only-one-failed=${d.equivalence.onlyOneFailed}.`,
    )
  }
  L.push('')
  return L.join('\n')
}

main().catch((e) => {
  console.error(`REPORT|失败 ${String(e && e.message ? e.message : e).slice(0, 200)}`)
  process.exitCode = 1
})
