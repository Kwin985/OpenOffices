// xlsx 属性级往返账（v0.200）：产品真链路跑出来的两个包，逐对普查。
//
//   cargo test --lib dump_sheet_roundtrip   →  tmp/sheet-roundtrip/{src,out}.xlsx
//        （Rust 侧 sheet_dump.rs：产品写手造源包 → 产品读手读回 → 写手再写一次）
//   本脚本                                 →  docs/sheet-roundtrip.md / .json
//
// 跑法：
//   pnpm exec vite-node scripts/sheet-roundtrip.mjs                 默认夹具
//   ... --src D:/docs/真实.xlsx --out tmp/sheet-external           外部真件（不覆盖主账本）
//   ... --no-dump                                                  复用上一次 dump
//
// 与 docx 往返账的**口径差异必须说清**：那份账的分子是「源包在场 ∩ 读手探针查问过」，
// 因为 TS 读手有 attr/attrL 两枚漏斗可注入探针。xlsx 读手在 Rust（calamine +
// quick-xml），没有统一漏斗，所以这份账的分母是**白名单部件里全部属性对**——
// 是整包普查，不是「读手查问过的」。xlsx_preserve 整份搬运的部件、打包细节部件
// 都不进分母；否则整份搬运会算成 kept（假绿）。
//
// 归一化与 docx 往返账同源（true/1/on、关系 id、Ignorable 拆串、ISO 时刻）。
// 不套用 docx 的 ST_OnOff 裸元素名单：xlsx 的元素名不同，漏补只会留假红，
// 不会造假绿——保守方向。

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
const OUT_DIR = path.resolve(REPO, flag('out', SRC ? 'tmp/sheet-external' : 'docs'))
const DUMP_DIR = path.join(REPO, 'tmp/sheet-roundtrip')

const url = (p) => `file:///${p.replace(/\\/g, '/')}`
const local = (n) => (n.includes(':') ? n.slice(n.indexOf(':') + 1) : n)
const md5 = (s) => createHash('md5').update(s).digest('hex')

// 读手真吃进去的部件。只列 xlsx 这一侧；ODS 两套命名空间第一版不做。
// 打包细节（Content_Types / _rels / docProps / theme / calcChain）与
// xlsx_preserve 整份搬运的侧通道部件都不进分母。
const PART_RE = [
  /^xl\/worksheets\/sheet\d+\.xml$/,
  /^xl\/styles\.xml$/,
  /^xl\/workbook\.xml$/,
  /^xl\/sharedStrings\.xml$/,
]

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
    if (SRC) env.SHEET_SRC_XLSX = path.resolve(SRC)
    else delete env.SHEET_SRC_XLSX
    const r = spawnSync(
      'cargo',
      ['test', '--manifest-path', path.join(REPO, 'src-tauri/Cargo.toml'), '--lib', 'dump_sheet_roundtrip', '--', '--nocapture'],
      { cwd: REPO, encoding: 'utf8', timeout: 600_000, maxBuffer: 16 * 1024 * 1024, env },
    )
    const text = (r.stdout || '') + (r.stderr || '')
    if (r.error || r.status !== 0 || !text.includes('SHEETDUMP|')) {
      console.error('SHEET|产品真链路 dump 失败：' + text.trim().split('\n').slice(-6).join(' ').slice(0, 400))
      process.exit(1)
    }
  }
  const srcPath = path.join(DUMP_DIR, 'src.xlsx')
  const outPath = path.join(DUMP_DIR, 'out.xlsx')
  if (!fs.existsSync(srcPath) || !fs.existsSync(outPath)) {
    console.error('SHEET|缺 tmp/sheet-roundtrip/{src,out}.xlsx，先跑一次不带 --no-dump')
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
  L.push('# xlsx 属性级往返账（产品写出 → 读回 → 再写出）')
  L.push('')
  L.push('> 复跑：`pnpm exec vite-node scripts/sheet-roundtrip.mjs`；外部真件加 `--src <.xlsx> --out <tmp目录>`。')
  L.push('> 源包与写出包都由 `cargo test --lib dump_sheet_roundtrip` 跑产品真出口生成，不是手工拼的 XML。')
  L.push('')
  L.push('## 口径（与 docx 往返账不同，别并排比百分比）')
  L.push('')
  L.push('- 分母是**白名单部件里全部属性对**，不是「读手查问过的」：xlsx 读手在 Rust，')
  L.push('  没有 TS 侧 attr/attrL 那样的统一漏斗可注入探针。这是整包普查。')
  L.push(`- 进分母的部件：\`xl/worksheets/sheetN.xml\`、\`xl/styles.xml\`、\`xl/workbook.xml\`、\`xl/sharedStrings.xml\`。`)
  L.push('  打包细节（Content_Types / _rels / docProps / theme）与 `xlsx_preserve` 整份搬运的')
  L.push('  侧通道部件都不进分母——否则整份搬运会被算成 kept，那是假绿。')
  L.push('- 默认源包由产品写手自己造，量的是**二次保存稳定性**；给 `--src` 换成外部真件后，')
  L.push('  量的是真件保真。两种输入不混在一个数字里。')
  L.push('- 归一与 docx 往返账同源：`true/1/on` 归一、关系 id 归一、`mc:Ignorable` 拆串、ISO 时刻归一。')
  L.push('  **不套用 docx 的 ST_OnOff 裸元素名单**（xlsx 元素名不同）；漏补只会留假红，不会造假绿。')
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
    L.push('| 对 | 源里出现 | 源值 | 写出值 |')
    L.push('|---|---:|---|---|')
    for (const r of list.slice(0, 40)) {
      L.push(`| \`${r.key}\` | ${r.n} | ${r.srcValues.slice(0, 6).join(', ') || '—'} | ${r.outValues.slice(0, 6).join(', ') || '—'} |`)
    }
    if (list.length > 40) L.push(`| …共 ${list.length} 条，完整清单见 \`sheet-roundtrip.json\` | | | |`)
    L.push('')
  }
  block('掉了', '名字在写出包里一次都没出现。', byBucket.lost)
  block('值变', '名字在，但某个源值没写回去。', byBucket.value)
  block('缺件', '承载它的部件整个没写出来。', byBucket.part)
  block('保留', '这些是真的往返稳定。', byBucket.kept)
  L.push('## 边界')
  L.push('')
  L.push('- **第一版只做 xlsx**：ODS 的 content.xml / styles.xml 是另一套命名空间与词表，')
  L.push('  key 映射翻倍，留到第二版。')
  L.push('- 不是真件长尾：默认源包由产品自己写出，读手不认的属性根本不会出现在源里。')
  L.push('  给 `--src` 换成真实 .xlsx 才能量到「读手吃了多少」。')
  L.push('- 没有读手查问集合，无法区分「读手主动读了」与「整包搬过来」；')
  L.push('  白名单部件 + 剔除 preserve 通道是当前的保守折中。')
  L.push('- 账本正文不写日期、路径与时间戳：同一 rev、同一夹具复跑逐字节相同。')
  L.push('')

  const md = L.join('\n')
  const json = {
    definition: {
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
  fs.writeFileSync(path.join(OUT_DIR, 'sheet-roundtrip.md'), md)
  const js = `${JSON.stringify(json, null, 1)}\n`
  fs.writeFileSync(path.join(OUT_DIR, 'sheet-roundtrip.json'), js)
  console.log(`SHEET|写盘 ${path.relative(REPO, path.join(OUT_DIR, 'sheet-roundtrip.md')).replace(/\\/g, '/')} 与 .json`)
  console.log(`SHEET|md5 md=${md5(md)} json=${md5(js)}`)
}

main().catch((e) => {
  console.error(`SHEET|失败 ${String(e && e.message ? e.message : e).slice(0, 300)}`)
  process.exitCode = 1
})
