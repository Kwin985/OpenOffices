// 表格属性级往返账（v0.200 xlsx / v0.201 ODS）：产品真链路跑出来的两个包，逐对普查。
//
//   cargo test --lib dump_sheet_roundtrip  →  tmp/sheet-roundtrip/{src,out}.xlsx
//   cargo test --lib dump_ods_roundtrip    →  tmp/sheet-roundtrip/{ods-src,ods-out}.ods
//        （Rust 侧 sheet_dump.rs：产品写手造源包 → 产品读手读回 → 写手再写一次）
//   本脚本                                 →  docs/{sheet,ods}-roundtrip.md / .json
//
// 跑法：
//   pnpm exec vite-node scripts/sheet-roundtrip.mjs                       xlsx 默认夹具
//   ... --format ods                                                     ODS 默认夹具
//   ... --src <真件> --out tmp/<目录>                                     外部真件（不覆盖主账本）
//   ... --no-dump                                                        复用上一次 dump
//
// 与 docx 往返账的**口径差异必须说清**：那份账的分子是「源包在场 ∩ 读手探针查问过」，
// 因为 TS 读手有 attr/attrL 两枚漏斗可注入探针。表格读手在 Rust（calamine +
// quick-xml），没有统一漏斗，所以分母是**白名单部件里全部属性对**——整包普查，
// 不是「读手查问过的」。xlsx_preserve 整份搬运的部件、打包细节都不进分母，
// 否则整份搬运会算成 kept（假绿）。
//
// xlsx 与 ODS 是**两套词表**（OOXML 的 `c|s` / ODF 的 `table-cell|style-name`），
// 两本账各自独立、不可并排比百分比。归一化与 docx 往返账同源；不套用 docx 的
// ST_OnOff 裸元素名单，漏补只会留假红、不会造假绿——保守方向。

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import JSZip from 'jszip'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(import.meta.dirname, '..')
const argv = process.argv.slice(2)
const flag = (name, dflt = '') => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt
}
const SRC = flag('src')
const NO_DUMP = argv.includes('--no-dump')
const FORMAT_NAME = flag('format', 'xlsx')

// v0.201：第二处同形状需求出现时泛化，不复制一份脚本。两种格式共用
// census / 归一化 / 四档判据，只在「跑哪个测试、读哪两个包、哪些部件进分母、
// 账本叫什么」这四处分开。
const FORMATS = {
  xlsx: {
    test: 'dump_sheet_roundtrip',
    envVar: 'SHEET_SRC_XLSX',
    src: 'src.xlsx',
    out: 'out.xlsx',
    ledger: 'sheet-roundtrip',
    title: 'xlsx 属性级往返账',
    ext: '.xlsx',
    parts: [
      /^xl\/worksheets\/sheet\d+\.xml$/,
      /^xl\/styles\.xml$/,
      /^xl\/workbook\.xml$/,
      /^xl\/sharedStrings\.xml$/,
    ],
    partDesc: '`xl/worksheets/sheetN.xml`、`xl/styles.xml`、`xl/workbook.xml`、`xl/sharedStrings.xml`',
    packageDesc: '打包细节（Content_Types / _rels / docProps / theme）与 `xlsx_preserve` 整份搬运的侧通道部件',
    wordTable: 'OOXML（`c|s` 那一套）',
  },
  ods: {
    test: 'dump_ods_roundtrip',
    envVar: 'ODS_SRC_ODS',
    src: 'ods-src.ods',
    out: 'ods-out.ods',
    ledger: 'ods-roundtrip',
    title: 'ODS 属性级往返账',
    ext: '.ods',
    parts: [
      /^content\.xml$/,
      /^styles\.xml$/,
      /^Object \d+\/content\.xml$/,
    ],
    partDesc: '`content.xml`、`styles.xml`、`Object N/content.xml`（图表对象）',
    packageDesc: '打包细节（`mimetype`、`META-INF/manifest.xml`）',
    wordTable: 'ODF（`table-cell|style-name` 那一套）',
  },
}
if (!FORMATS[FORMAT_NAME]) {
  console.error(`SHEET|未知 --format ${FORMAT_NAME}（可用：${Object.keys(FORMATS).join(' / ')}）`)
  process.exit(2)
}
const F = FORMATS[FORMAT_NAME]
const OUT_DIR = path.resolve(REPO, flag('out', SRC ? `tmp/${F.ledger}-external` : 'docs'))
const DUMP_DIR = path.join(REPO, 'tmp/sheet-roundtrip')

const url = (p) => `file:///${p.replace(/\\/g, '/')}`
const local = (n) => (n.includes(':') ? n.slice(n.indexOf(':') + 1) : n)
const md5 = (s) => createHash('md5').update(s).digest('hex')

// 读手真吃进去的部件；打包细节与整份搬运的侧通道部件都不进分母。
const PART_RE = F.parts

// 已逐对诊断过的「已知口径」：**只标注，不改四档数字**（v0.199 假红分档的
// 同一条纪律）。ods 那两枚当年被叫作「源包冗余」，v0.202 判断修正后查出真因是
// max_col 漏算 col_widths、已修；名单留作回归守卫。xlsx 那批是 v0.211 真件回归
// 诊断出的架构限制（theme/tint 无法逐字节还原、cellStyle/tableStyle crate 无写 API）。
// 两份名单都只在「本轮账本里确实命中且非 kept」时才显示——夹具账里同名但 kept 的
// 那几对（如 cellStyle|name=normal）不挂标注，免得误标成架构限制。
const CAVEATS = {
  // xlsx 真件（Excel 亲笔样式表）里这几族是**架构限制**，不是读手漏读或写手漏写：
  // theme/tint 是 Excel 按主题算出的任意浮点，rust_xlsxwriter 0.99.1 的 Color::Theme
  // 只接受离散 shade 并写回它自己硬编码的 tint 常量，无法逐字节还原；
  // cellStyle/tableStyle 族 crate 根本没有公共写 API（styles.rs 只写死 Normal+Hyperlink）。
  // v0.211 逐族取证（见 docs/xlsx-styles-gap.md）；只标注、不改四档数字（v0.199 纪律）。
  // 夹具账（65 对）里没有这些对——产品自写自出不含 Excel 复杂样式表——
  // 所以登记它们不会让夹具账变色，只在真件账里显示口径解释。
  xlsx: {
    'fgColor|theme': '孤儿样式：产品码 v0.215 已能写回 theme 色（合成件验证），但真件 theme 色全挂在未被单元格引用的命名样式上（cellXfs 的 fillId 全 0），写回也进不了账',
    'bgColor|theme': '同上；主题背景色同理，非架构限制',
    'fgColor|tint': '孤儿样式：tint 与 crate 常量是同一个 double（15/17 位打印精度差），v0.215 已能写回，但真件里没人引用',
    'bgColor|tint': '同上；背景色调',
    'color|tint': '同上；字体色调',
    'color|theme': '孤儿样式：字体主题色同族，非架构限制',
    'charset|val': '架构限制：字体字符集（134=GB2312）；读手未建模，crate 有 set_font_charset 但未接线',
    'scheme|val': '架构限制：字体方案（minor/major）；crate 有 set_font_scheme 但未接线',
    'fgColor|rgb': '填充前景色：真件 7 个全在 fills 节（dxf 里 rgb=0），多属未被单元格引用的孤儿样式定义；写手只重建实际引用的样式（v0.212 定性）',
    'color|rgb': '字体色 rgb：真件 29 个里 fonts 节 12 个、其余在未被 c|s 引用的孤儿命名样式里；写手只写实际用到的样式（v0.212 定性，非架构限制）',
    'bgColor|indexed': '架构限制：调色板索引色（64=系统窗口色），crate Color 枚举无 Indexed 变体，写不回',
    'cellStyle|name': '架构限制：Excel 49 个本地化样式名（常规/货币…）；crate 只写死 Normal+Hyperlink，无公共 API',
    'cellStyle|builtinId': '同上；内置样式 id',
    'cellStyle|xfId': '同上；样式表索引',
    'tableStyle|name': '架构限制：Excel tableStyle 族；rust_xlsxwriter 无公共写 API',
    'tableStyle|count': '同上',
    'tableStyle|uid': '同上',
    'tableStyle|pivot': '同上',
    'tableStyle|table': '同上',
    'tableStyleElement|dxfId': '架构限制：表格样式元素引用的 dxf；crate 无 tableStyle 写 API',
    'tableStyleElement|type': '同上',
    'numFmt|formatCode': '架构限制：Excel 内置数字格式 41-44（会计/货币）；读侧 builtin_numfmt 表未覆盖',
    'numFmt|numFmtId': '同上',
    'xf|fillId': '口径假红：非0值全在未被单元格引用的孤儿样式里；被引用样式的 fillId 往返保真（v0.217 合成件实证）',
    'xf|fontId': '同上：被引用样式保真，孤儿样式的字体索引不算真丢',
    'xf|borderId': '同上：被引用样式保真',
    'xf|numFmtId': '同上：被引用样式的 numFmtId 往返保真（合成件 164-168 实测保留）',
    'numFmts|count': '同上',
    'feature|name': '架构限制：Excel 里的 x14 扩展特性名（如 microsoft.com:let_wf），模型无承载位',
    'ext|uri': '架构限制：x14 扩展的 GUID，模型无承载位',
    'slicerStyles|defaultSlicerStyle': '架构限制：切片器样式，读手不认',
    'styleSheet|Ignorable': '架构限制：MC 可忽略命名空间声明（xr9），打包细节',
  },
  ods: {
    'style|name': '孤儿列样式 co2：源包为超出实际列范围的 col_widths 生成了没人引用的样式（v0.202 已修）',
    'table-column-properties|column-width': '同上；2.1167cm 属于那个孤儿样式（v0.202 已修）',
  },
}

const BOOL_ON = new Set(['true', 'on'])
const BOOL_OFF = new Set(['false', 'off'])
function normValue(v, attrName) {
  const s = String(v).trim().toLowerCase()
  if (BOOL_ON.has(s) || s === '1') return '1'
  if (BOOL_OFF.has(s) || s === '0') return '0'
  if (attrName === 'lvlJc' || attrName === 'jc') {
    if (s === 'start') return 'left'
    if (s === 'end') return 'right'
  }
  if (/^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}(\.\d+)?z?$/.test(s)) {
    const t = Date.parse(s)
    if (Number.isFinite(t)) return new Date(t).toISOString().toLowerCase()
  }
  if (/^rid[-_0-9a-z]*$/i.test(s)) return 'rid#'
  return s
}

/** 一份包 → 每个「元素|属性」对的值分布 + 在场的部件集合。 */
async function censusAsync(zip, parseXml) {
  const pairs = new Map()
  const present = new Set()
  for (const name of Object.keys(zip.files)) {
    if (zip.files[name].dir || !PART_RE.some((r) => r.test(name))) continue
    const text = await zip.file(name).async('string')
    present.add(name)
    let root
    try {
      root = parseXml(text)
    } catch {
      continue
    }
    const visit = (el) => {
      const p = local(el.name)
      for (const k of Object.keys(el.attrs ?? {})) {
        if (k === 'xmlns' || k.startsWith('xmlns:')) continue
        const key = `${p}|${local(k)}`
        let rec = pairs.get(key)
        if (!rec) {
          rec = { n: 0, values: new Map(), parts: new Set() }
          pairs.set(key, rec)
        }
        rec.n++
        rec.parts.add(name)
        if (local(k) === 'Ignorable') {
          for (const t of String(el.attrs[k]).split(/\s+/).filter(Boolean))
            rec.values.set(t, (rec.values.get(t) ?? 0) + 1)
          continue
        }
        const v = normValue(el.attrs[k], local(k))
        rec.values.set(v, (rec.values.get(v) ?? 0) + 1)
      }
      for (const c of el.children ?? []) if (typeof c !== 'string') visit(c)
    }
    visit(root)
  }
  return { pairs, present }
}

async function main() {
  if (!NO_DUMP) {
    const env = { ...process.env }
    // 两种格式的外部入口互斥：跑 ods 时别让上一次留下的 SHEET_SRC_XLSX 串进来
    delete env.SHEET_SRC_XLSX
    delete env.ODS_SRC_ODS
    if (SRC) env[F.envVar] = path.resolve(SRC)
    const r = spawnSync(
      'cargo',
      ['test', '--manifest-path', path.join(REPO, 'src-tauri/Cargo.toml'), '--lib', F.test, '--', '--nocapture'],
      { cwd: REPO, encoding: 'utf8', timeout: 600_000, maxBuffer: 16 * 1024 * 1024, env },
    )
    const text = (r.stdout || '') + (r.stderr || '')
    if (r.error || r.status !== 0 || !text.includes('SHEETDUMP|')) {
      console.error('SHEET|产品真链路 dump 失败：' + text.trim().split('\n').slice(-6).join(' ').slice(0, 400))
      process.exit(1)
    }
  }
  const srcPath = path.join(DUMP_DIR, F.src)
  const outPath = path.join(DUMP_DIR, F.out)
  if (!fs.existsSync(srcPath) || !fs.existsSync(outPath)) {
    console.error(`SHEET|缺 tmp/sheet-roundtrip/{${F.src},${F.out}}，先跑一次不带 --no-dump 的 --format ${FORMAT_NAME}`)
    process.exit(1)
  }

  const { parseXml } = await import(url(path.join(REPO, 'src/lib/ooxml.ts')))
  const src = censusAsync(await JSZip.loadAsync(fs.readFileSync(srcPath)), parseXml)
  const out = censusAsync(await JSZip.loadAsync(fs.readFileSync(outPath)), parseXml)
  // censusAsync 里没有 await 之外的异步依赖，但保持 Promise 形状统一
  const S = await src
  const O = await out

  const rows = []
  for (const [key, sp] of [...S.pairs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const op = O.pairs.get(key)
    let bucket
    if (!op) bucket = [...sp.parts].every((p) => !O.present.has(p)) ? 'part' : 'lost'
    else {
      const missing = [...sp.values.keys()].filter((v) => !op.values.has(v))
      bucket = missing.length ? 'value' : 'kept'
    }
    rows.push({
      key,
      bucket,
      n: sp.n,
      parts: [...sp.parts],
      srcValues: [...sp.values.keys()].sort(),
      outValues: op ? [...op.values.keys()].sort() : [],
    })
  }
  const byBucket = { kept: [], value: [], lost: [], part: [] }
  for (const r of rows) byBucket[r.bucket].push(r)
  for (const b of Object.values(byBucket)) b.sort((a, c) => c.n - a.n || a.key.localeCompare(c.key))
  const total = rows.length
  const keptN = byBucket.kept.length
  const pct = total ? ((keptN / total) * 100).toFixed(1) : '—'

  console.log(`SHEET|源=${SRC ? path.basename(SRC) : '产品夹具'} 源部件=${S.present.size} 写出部件=${O.present.size} 对数=${total}`)
  console.log(`SHEET|保留=${keptN}/${total}(${pct}%) 值变=${byBucket.value.length} 掉了=${byBucket.lost.length} 缺件=${byBucket.part.length}`)

  const L = []
  L.push(`# ${F.title}（产品写出 → 读回 → 再写出）`)
  L.push('')
  L.push(`> 复跑：\`pnpm exec vite-node scripts/sheet-roundtrip.mjs --format ${FORMAT_NAME}\`；`)
  L.push(`> 外部真件加 \`--src <${F.ext}> --out <tmp目录>\`；\`--no-dump\` 可复用上一次 dump。`)
  L.push(`> 源包与写出包都由 \`cargo test --lib ${F.test}\` 跑产品真出口生成，不是手工拼的 XML。`)
  L.push('')
  L.push('## 口径（与 docx 往返账、与另一格式的账都不可并排比百分比）')
  L.push('')
  L.push(`- **${F.wordTable}** 是另一套词表，与 ${FORMAT_NAME === 'xlsx' ? 'ODS' : 'xlsx'} 那本账的 key 不同源；两本账各自独立。`)
  L.push('- 分母是**白名单部件里全部属性对**，不是「读手查问过的」：表格读手在 Rust，')
  L.push('  没有 TS 侧 attr/attrL 那样的统一漏斗可注入探针。这是整包普查。')
  L.push(`- 进分母的部件：${F.partDesc}。`)
  L.push(`  ${F.packageDesc}都不进分母——否则整份搬运会被算成 kept，那是假绿。`)
  L.push('- 默认源包由产品写手自己造，量的是**二次保存稳定性**；给 `--src` 换成外部真件后，')
  L.push('  量的是真件保真。两种输入不混在一个数字里。')
  L.push('- 归一与 docx 往返账同源：`true/1/on` 归一、关系 id 归一、`mc:Ignorable` 拆串、ISO 时刻归一。')
  L.push('  **不套用 docx 的 ST_OnOff 裸元素名单**（表格元素名不同）；漏补只会留假红，不会造假绿。')
  L.push('- 写出包里额外出现的对（写手自己造的、源里没有的）不进表：那是「写多了」，与这份账问的')
  L.push('  「源里在场的东西还在不在」是两件事。')
  L.push('')
  L.push('## 账')
  L.push('')
  L.push('| | 值 |')
  L.push('|---|---:|')
  L.push(`| 源 | ${SRC ? path.basename(SRC) : '产品夹具（二次保存）'} |`)
  L.push(`| 源包部件 / 写出包部件 | ${S.present.size} / ${O.present.size} |`)
  L.push(`| 分母对 | ${total} |`)
  L.push(`| 保留 | **${keptN}（${pct}%）** |`)
  L.push(`| 值变 | ${byBucket.value.length} |`)
  L.push(`| 掉了 | ${byBucket.lost.length} |`)
  L.push(`| 缺件 | ${byBucket.part.length} |`)
  L.push('')
  L.push('分族：只按承载它们的部件分，不套 docx 的 `w:*` 正文 / 图形壳口径。')
  L.push('一个对若出现在多个部件，会在各部件各计一次，所以分族表的「读到」合计可能大于分母。')
  L.push('')
  const partTotals = {}
  for (const r of rows) {
    for (const p of r.parts) {
      const b = (partTotals[p] ??= { read: 0, kept: 0, value: 0, lost: 0, part: 0 })
      b.read++
      b[r.bucket]++
    }
  }
  L.push('| 部件 | 读到 | 保留 | 值变 | 掉了 | 缺件 | 保留率 |')
  L.push('|---|---:|---:|---:|---:|---:|---:|')
  for (const p of Object.keys(partTotals).sort()) {
    const b = partTotals[p]
    L.push(`| \`${p}\` | ${b.read} | ${b.kept} | ${b.value} | ${b.lost} | ${b.part} | ${b.read ? ((b.kept / b.read) * 100).toFixed(1) : '—'}% |`)
  }
  L.push('')
  const block = (title, desc, list) => {
    L.push(`### ${title}（${list.length}）`)
    L.push('')
    L.push(desc)
    L.push('')
    L.push('| 对 | 源里出现 | 源值 | 写出值 | 口径 |')
    L.push('|---|---:|---|---|---|')
    for (const r of list.slice(0, 40)) {
      // 口径标注只给「非 kept」的对：夹具有些对本身 kept 但同名（如夹具的
      // cellStyle|name=normal、color|theme=1），给它们挂「架构限制」是误标，
      // 会污染夹具账文案（v0.211 踩过）。真件里那几族才是真的掉了/值变。
      const note = r.bucket === 'kept' ? '' : ((CAVEATS[FORMAT_NAME] ?? {})[r.key] ?? '')
      L.push(`| \`${r.key}\` | ${r.n} | ${r.srcValues.slice(0, 6).join(', ') || '—'} | ${r.outValues.slice(0, 6).join(', ') || '—'} | ${note ? `**已知口径**：${note}` : '—'} |`)
    }
    if (list.length > 40) L.push(`| …共 ${list.length} 条，完整清单见 \`${F.ledger}.json\` | | | | |`)
    L.push('')
  }
  block('掉了', '名字在写出包里一次都没出现。', byBucket.lost)
  block('值变', '名字在，但某个源值没写回去。', byBucket.value)
  block('缺件', '承载它的部件整个没写出来。', byBucket.part)
  block('保留', '这些是真的往返稳定。', byBucket.kept)
  L.push('## 边界')
  L.push('')
  L.push(`- **只做 ${FORMAT_NAME} 这一侧**：另一格式有独立账本（\`${FORMAT_NAME === 'xlsx' ? 'ods-roundtrip' : 'sheet-roundtrip'}.md\`），两套词表不混。`)
  // 只列本轮账本里**实际命中**的已知口径；修好之后自动不再出现这句解释。
  const caveats = CAVEATS[FORMAT_NAME] ?? {}
  const hitCaveats = Object.entries(caveats).filter(([k]) =>
    rows.some((r) => r.bucket !== 'kept' && r.key === k))
  if (hitCaveats.length) {
    L.push('- **已知口径**（逐对诊断过，只标注、不改四档数字）：')
    for (const [k, v] of hitCaveats) L.push(`  - \`${k}\`：${v}。`)
    L.push('  这些对已被逐族定性：要么是源包冗余，要么是读手 / 写手 / 第三方库的**架构限制**，')
    L.push('  都不是本轮能低风险修的。四档数字如实保留；这份账的百分比要配合这些标注读，')
  }
  L.push('- 不是真件长尾：默认源包由产品自己写出，读手不认的属性根本不会出现在源里。')
  L.push(`  给 \`--src\` 换成真实 ${F.ext} 才能量到「读手吃了多少」。`)
  L.push('- 没有读手查问集合，无法区分「读手主动读了」与「整包搬过来」；')
  L.push('  白名单部件 + 剔除整份搬运通道是当前的保守折中。')
  L.push('- 账本正文不写日期、路径与时间戳：同一 rev、同一夹具复跑逐字节相同。')
  L.push('')

  const md = L.join('\n')
  const json = {
    definition: {
      format: FORMAT_NAME,
      source: SRC ? path.basename(SRC) : 'fixture-second-save',
      numerator: 'all pairs in whitelisted parts (no reader probe)',
      buckets: ['kept', 'value', 'lost', 'part'],
      partsRegex: PART_RE.map((r) => r.source),
      onOffNormalised: true,
      bareElementPatched: false,
    },
    totals: {
      read: total,
      kept: keptN,
      value: byBucket.value.length,
      lost: byBucket.lost.length,
      part: byBucket.part.length,
      srcParts: S.present.size,
      outParts: O.present.size,
    },
    partTotals,
    pairs: Object.fromEntries(
      rows.map((r) => [r.key, { bucket: r.bucket, n: r.n, src: r.srcValues, out: r.outValues }]),
    ),
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(OUT_DIR, `${F.ledger}.md`), md)
  const js = `${JSON.stringify(json, null, 1)}\n`
  fs.writeFileSync(path.join(OUT_DIR, `${F.ledger}.json`), js)
  console.log(`SHEET|写盘 ${path.relative(REPO, path.join(OUT_DIR, `${F.ledger}.md`)).replace(/\\/g, '/')} 与 .json`)
  console.log(`SHEET|md5 md=${md5(md)} json=${md5(js)}`)
}

main().catch((e) => {
  console.error(`SHEET|失败 ${String(e && e.message ? e.message : e).slice(0, 300)}`)
  process.exitCode = 1
})
