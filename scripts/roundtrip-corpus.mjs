// docx 往返账 · 多输入对照跑批。
//
// 主账本（scripts/fidelity-roundtrip.mjs 不带参数）只跑一份人手夹具，88.5% 这个数
// 的覆盖面就是那份夹具的覆盖面。这个脚本不改变主账本，只做一件事：把任意一批
// docx 逐份喂给同一个量具，把每份的四档数字并排摆出来，并统计「哪些对在多份里
// 反复掉」——那才是长尾，而不是某一枚属性在单份夹具里的运气。
//
// 跑法：
//   node scripts/roundtrip-corpus.mjs --corpus D:/docs,./tmp/corpus \
//       --out docs/roundtrip-corpus.md --verbose
//   ... --only report       只跑文件名含 report 的
//   ... --limit 5           最多 5 份（调试用）
//
// 不给 --corpus 就直接报用法，不偷偷依赖 tmp/ 里的生成物。输出默认落在
// tmp/roundtrip-corpus/report.md，除非显式给 --out（要入库就指向 docs/）。
// 报告正文只写文件名，不写路径、不写日期。

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { aliasNote, isKnownAlias } from './lib/known-alias.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const cli = path.join(root, 'node_modules/vite-node/dist/cli.mjs')
const argv = process.argv.slice(2)
const argOf = (name, dflt = '') => {
  const key = name.startsWith('--') ? name : `--${name}`
  const i = argv.indexOf(key)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt
}

const corpusArg = argOf('--corpus')
const outPath = path.resolve(root, argOf('--out', 'tmp/roundtrip-corpus/report.md'))
const only = argOf('--only')
const limit = Number(argOf('--limit', '0'))
const verbose = argv.includes('--verbose')

if (!corpusArg) {
  console.error('用法：node scripts/roundtrip-corpus.mjs --corpus <dir>[,<dir>...] [--out <md>] [--verbose]')
  console.error('不给 --corpus 时不做任何事：脚本不依赖仓库里未入库的 tmp/ 生成物。')
  process.exit(2)
}
if (!existsSync(cli)) {
  console.error('找不到 vite-node CLI（先 pnpm install）')
  process.exit(2)
}

// 收集输入：跳过 roundtrip-* 输出目录，避免把自己上一趟的产物当新语料。
const files = []
for (const dir of corpusArg.split(',').map((s) => s.trim()).filter(Boolean)) {
  const abs = path.resolve(dir)
  if (!existsSync(abs)) {
    console.error(`CORPUS|跳过不存在的目录 ${path.basename(abs)}`)
    continue
  }
  const walk = (d, depth) => {
    for (const name of readdirSync(d).sort()) {
      if (name.startsWith('roundtrip-')) continue
      const p = path.join(d, name)
      const st = statSync(p)
      if (st.isDirectory() && depth < 2) walk(p, depth + 1)
      else if (/\.docx$/i.test(name) && (!only || name.includes(only))) files.push(p)
    }
  }
  walk(abs, 0)
}
const chosen = limit > 0 ? files.slice(0, limit) : files
if (!chosen.length) {
  console.error('CORPUS|没找到 .docx')
  process.exit(2)
}

mkdirSync(path.join(root, 'tmp/roundtrip-corpus'), { recursive: true })
const rows = []
const lostHits = new Map()
const valHits = new Map()
const t0 = Date.now()

const RX = {
  src: /ROUNDTRIP\|源包 部件=(\d+) 对数=(\d+)\s+读手查问=(\d+)\s+读到的=(\d+)/,
  rt: /ROUNDTRIP\|往返 保留=(\d+)\/(\d+)\(([\d.]+)%\) 值变=(\d+) 掉了=(\d+) 缺件=(\d+)/,
  w: /ROUNDTRIP\|\s+正文属性 保留=(\d+)\/(\d+)\(([\d.]+)%\)/,
  g: /ROUNDTRIP\|\s+图形壳\s+保留=(\d+)\/(\d+)\(([\d.]+)%\)/,
  lost: /^\s+LOST\s+(\w)\s+(\S+)\s+×(\d+)/,
  val: /^\s+VAL\s+(\w)\s+(\S+)\s+×(\d+)/,
}

for (const f of chosen) {
  const name = path.basename(f)
  const stem = path.basename(name, path.extname(name)).replace(/[^\w.-]/g, '_')
  const out = path.join(root, 'tmp/roundtrip-corpus', stem)
  const args = [cli, 'scripts/fidelity-roundtrip.mjs', '--docx', f, '--out', out]
  if (verbose) args.push('--verbose')
  const r = spawnSync(process.execPath, args, {
    cwd: root, encoding: 'utf8', timeout: 180_000, maxBuffer: 16 * 1024 * 1024,
  })
  const text = (r.stdout || '') + (r.stderr || '')
  const rt = text.match(RX.rt)
  if (r.error || r.status !== 0 || !rt) {
    // 只取「失败」那一行的正文，别把子进程打印的绝对路径带进报告。
    const failLine = text.split('\n').find((l) => l.includes('ROUNDTRIP|失败'))
    let why = (failLine
      ? failLine.replace(/^.*ROUNDTRIP\|失败\s*/, '').trim()
      : text.trim().split('\n').slice(-1)[0] || r.error?.message || '未输出结论'
    ).slice(0, 160)
    // 合成语料里偶有非法 ST_UcharHexNumber（如 themeShade="0"），写手按规范拒绝。
    // 那是语料缺陷，不是读手/写手 bug，也不该为了让批次好看去改产品。
    if (/Invalid hex value/i.test(why)) {
      why = `源件含非法 2 位 hex 属性值，写手按 OOXML 规范拒绝（语料缺陷，非产品 bug）：${why.slice(-90)}`
    }
    console.log(`SKIP  ${name}  — ${why}`)
    rows.push({ name, error: why })
    continue
  }
  const src = text.match(RX.src)
  const w = text.match(RX.w)
  const g = text.match(RX.g)
  const row = {
    name,
    parts: Number(src?.[1] ?? 0),
    consulted: Number(src?.[3] ?? 0),
    read: Number(rt[2]),
    kept: Number(rt[1]),
    pct: Number(rt[3]),
    value: Number(rt[4]),
    lost: Number(rt[5]),
    part: Number(rt[6]),
    w: w ? `${w[1]}/${w[2]}` : '—',
    g: g ? `${g[1]}/${g[2]}` : '—',
  }
  rows.push(row)
  console.log(`DONE  ${name}  ${row.kept}/${row.read} ${row.pct.toFixed(1)}%  掉=${row.lost} 值变=${row.value}`)
  for (const line of text.split('\n')) {
    const l = line.match(RX.lost)
    if (l) lostHits.set(l[2], (lostHits.get(l[2]) ?? 0) + 1)
    const v = line.match(RX.val)
    if (v) valHits.set(v[2], (valHits.get(v[2]) ?? 0) + 1)
  }
}

const ok = rows.filter((r) => !r.error)
const sum = (k) => ok.reduce((a, r) => a + r[k], 0)
const totalRead = sum('read')
const totalKept = sum('kept')
const pctOf = (n, d) => (d ? ((n / d) * 100).toFixed(1) : '—')
const median = ok.length
  ? [...ok].map((r) => r.pct).sort((a, b) => a - b)[Math.floor(ok.length / 2)]
  : 0

const L = []
L.push('# docx 往返账 · 多输入对照')
L.push('')
L.push('> 复跑：`node scripts/roundtrip-corpus.mjs --corpus <dir> --out <md> --verbose`')
L.push('> 每份 docx 独立走完「读手 → HTML → TipTap schema → PM → 写手 → 普查」，量具与')
L.push('> 主账本同源，只是换了输入。分母仍只覆盖 `PARTS` 的 7 个部件；各份的「读到的」')
L.push('> 不同，所以**单份百分比之间、以及与主账本 88.5% 之间都不可直接比较**。')
L.push('> 报告只写文件名，不写路径与日期。已逐对诊断过的「口径假红」会在末节单列，')
L.push('> 它们判 lost 只是写法不同，不是真丢；名单见 `scripts/lib/known-alias.mjs`。')
L.push('')
L.push('## 汇总')
L.push('')
L.push('| | 值 |')
L.push('|---|---:|')
L.push(`| 输入份数 | ${chosen.length} |`)
L.push(`| 跑成 | ${ok.length} |`)
L.push(`| 跳过 | ${rows.length - ok.length} |`)
L.push(`| 合计保留 | ${totalKept}/${totalRead}（${pctOf(totalKept, totalRead)}%） |`)
L.push(`| 合计值变 / 掉了 / 缺件 | ${sum('value')} / ${sum('lost')} / ${sum('part')} |`)
L.push(`| 单份保留率中位数 | ${median.toFixed(1)}% |`)
if (ok.length) {
  const low = [...ok].sort((a, b) => a.pct - b.pct)[0]
  const high = [...ok].sort((a, b) => b.pct - a.pct)[0]
  L.push(`| 最低 / 最高 | ${low.name} ${low.pct.toFixed(1)}% / ${high.name} ${high.pct.toFixed(1)}% |`)
}
L.push(`| 用时 | ${((Date.now() - t0) / 1000).toFixed(1)}s |`)
L.push('')
L.push('合计只是把各份的分子 / 分母分别求和，用来描述规模，**不是统一口径下的覆盖率**；')
L.push('各份分母不同，中位数与逐份表比这个合计更能说明问题。')
L.push('')
L.push('## 逐份')
L.push('')
L.push('| 文件 | 源部件 | 读到的 | 保留 | 值变 | 掉了 | 缺件 | 保留率 | 正文 | 图形壳 |')
L.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
for (const r of rows) {
  if (r.error) {
    L.push(`| ${r.name} | — | — | — | — | — | — | 跳过 | — | — |`)
    continue
  }
  L.push(`| ${r.name} | ${r.parts} | ${r.read} | ${r.kept} | ${r.value} | ${r.lost} | ${r.part} | **${r.pct.toFixed(1)}%** | ${r.w} | ${r.g} |`)
}
L.push('')
if (verbose && (lostHits.size || valHits.size)) {
  L.push('## 反复掉 / 值变的对（按出现份数）')
  L.push('')
  L.push('| 对 | 掉了的份数 | 值变的份数 | 口径 |')
  L.push('|---|---:|---:|---|')
  const keys = [...new Set([...lostHits.keys(), ...valHits.keys()])]
    .sort((a, b) => (lostHits.get(b) ?? 0) - (lostHits.get(a) ?? 0) || a.localeCompare(b))
  for (const k of keys.slice(0, 25)) {
    const note = aliasNote(k)
    L.push(`| \`${k}\` | ${lostHits.get(k) ?? 0} | ${valHits.get(k) ?? 0} | ${note ? `**已知口径假红**：${note}` : '—'} |`)
  }
  L.push('')
  L.push(`共 ${keys.length} 个对在至少一份里掉过或值变过；只列前 25。`)
  L.push('各份夹具的属性宇宙本就不同，所以「出现份数」普遍偏低是常态——这张表找的是')
  L.push('**跨夹具反复掉的同一枚**（如 `tblLook` 四兄弟），不是按份数排优先级。')
  const aliasHit = keys.filter(isKnownAlias)
  L.push('')
  L.push(`其中 **${aliasHit.length} 枚是已逐对诊断过的口径假红**${aliasHit.length ? `（\`${aliasHit.join('`, `')}\`）` : ''}：`)
  L.push('`w:tblLook` 的 `w:val` 位掩码与逐位 ST_OnOff 属性是同一组开关的两种写法，')
  L.push('写出包只发 `w:val` 不丢语义；为凑数字补写显式属性反而会写出与掩码打架的坏件。')
  L.push('**跨夹具复现 ≠ 真丢**，剩下那些才值得逐对看「读手 / 模型 / 包槽 / 写手」四处。')
  L.push('')
}
const skipped = rows.filter((r) => r.error)
if (skipped.length) {
  L.push('## 跳过明细')
  L.push('')
  for (const r of skipped) L.push(`- \`${r.name}\`：${r.error}`)
  L.push('')
}
L.push('## 边界')
L.push('')
L.push('- 这不是真实语料长尾，只看「换一份输入，账本会不会变」；合成件的覆盖面仍是合成件的。')
L.push('- 「读到的」= 源包在场 ∩ 读手查问过；某份里读手根本没问的属性不进它的分母。')
L.push('- 写手由产品源加载，量具用 `assertAtRef()` 逐字节守卫；工作树不干净时整批会拒跑。')
L.push('- 单件账本落在 `tmp/roundtrip-corpus/<文件名>/`，不覆盖 `docs/fidelity-roundtrip.*`。')
L.push('')
mkdirSync(path.dirname(outPath), { recursive: true })
writeFileSync(outPath, L.join('\n'))
console.log(`CORPUS|写盘 ${path.relative(root, outPath).replace(/\\/g, '/')}`)
console.log(`CORPUS|合计 ${totalKept}/${totalRead}（${pctOf(totalKept, totalRead)}%）跑成 ${ok.length}/${chosen.length}`)
process.exitCode = ok.length ? 0 : 1
