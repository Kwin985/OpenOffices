// pptx 保真账 · 多输入对照（v0.203）。
//
// 主账本（fidelity-report-pptx.mjs --selftest）只跑一份手写夹具，70.1% 这个数
// 自 v0.141 冻结至今没换过输入。v0.199 用 stress.pptx 换过一次，按对掉到
// 17.2%，但只有一份。这里把覆盖面铺开：用**产品自己的导出链**
// （src/lib/ppt.ts + pptx-export.ts）造几份形状不同的 pptx，逐份喂给同一个
// 量具，看「读手按名查问过」这件事在不同输入上稳不稳。
//
// 跑法：
//   pnpm exec vite-node scripts/pptx-corpus.mjs                       内置生成夹具
//   ... --corpus D:/真实pptx目录 --out docs/pptx-corpus.md            外部真件
//   ... --no-gen                                                     复用上次生成的语料
//   ... --limit 3                                                    只跑前 3 份
//
// 语料是生成物，落在 tmp/、不入库；生成器在本文件里，随时可重建。
// 报告只写文件名，不写路径与日期。外部真件与内置生成夹具不混在一个数字里。

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import JSZip from 'jszip'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(import.meta.dirname, '..')
const argv = process.argv.slice(2)
const argOf = (name, dflt = '') => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt
}
const CORPUS = argOf('corpus')
const OUT = path.resolve(REPO, argOf('out', CORPUS ? 'tmp/pptx-corpus-external/report.md' : 'docs/pptx-corpus.md'))
const LIMIT = Number(argOf('limit', '0'))
const NO_GEN = argv.includes('--no-gen')
const GEN_DIR = path.join(REPO, 'tmp/pptx-corpus')
const REPORT_DIR = path.join(REPO, 'tmp/pptx-corpus-report')

// 1x1 透明 PNG，够 pptxgenjs 认出是图片，不引入外部资源
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/eZ8AAAAASUVORK5CYII='

async function generate() {
  const { emptyDeck, newSlide } = await import(url(path.join(REPO, 'src/lib/ppt.ts')))
  const { deckToPptxBytes } = await import(url(path.join(REPO, 'src/lib/pptx-export.ts')))
  const shape = (i, over = {}) => ({
    id: `s${i}`, kind: 'text', x: 1 + i * 0.4, y: 1 + i * 0.3, w: 3, h: 0.8,
    text: `形状 ${i}`, ...over,
  })
  const mk = (layout, over = {}) => Object.assign(newSlide(layout), over)

  const cases = [
    {
      name: '01-title.pptx',
      deck: () => {
        const d = emptyDeck()
        d.title = '单页标题'
        d.slides = [mk('title', { title: '封面', body: '副标题' })]
        return d
      },
    },
    {
      name: '02-bullets.pptx',
      deck: () => {
        const d = emptyDeck()
        d.title = '要点三页'
        d.slides = [0, 1, 2].map((i) => mk('bullets', {
          title: `第 ${i + 1} 页`,
          body: ['第一条', '第二条', '第三条', '第四条'].join('\n'),
          transition: i === 0 ? 'fade' : i === 1 ? 'wipe' : 'push',
          anim: 'fade', animDir: 'bottom', advClick: true, animDur: 600,
        }))
        return d
      },
    },
    {
      name: '03-shapes.pptx',
      deck: () => {
        const d = emptyDeck()
        d.title = '文本框属性'
        d.slides = [mk('blank', {
          shapes: [
            shape(0, { bold: true, color: '#d43c4f', sizePt: 28, name: '标题框', alt: '说明文字' }),
            shape(1, { italic: true, underline: true, anchor: 'middle', wrap: false }),
            shape(2, { align: 'center', fill: '#fff5f5', outline: '#d43c4f', outlineW: 2 }),
          ],
        })]
        return d
      },
    },
    {
      name: '04-image.pptx',
      deck: () => {
        const d = emptyDeck()
        d.title = '图片版式'
        d.slides = [mk('image', { title: '配图页', image: TINY_PNG, notes: '演讲者备注' })]
        d.slides[0].shapes = [{ ...shape(9), kind: 'image', image: TINY_PNG, text: undefined }]
        return d
      },
    },
    {
      name: '05-dark-master.pptx',
      deck: () => {
        const d = emptyDeck()
        d.title = '深色母版'
        d.theme = 'dark'
        d.master = { bodyColor: '#e8ecf5', titleColor: '#5b8cff', majorFont: 'Microsoft YaHei', minorFont: 'Microsoft YaHei' }
        d.slides = [
          mk('title', { title: '深色封面', body: '副标题', bg: '#20283d', notes: '第一页备注' }),
          mk('bullets', { title: '内容', body: '要点一\n要点二', notes: '第二页备注' }),
        ]
        return d
      },
    },
    {
      name: '06-mixed.pptx',
      deck: () => {
        const d = emptyDeck()
        d.title = '混合多页'
        d.slides = [
          mk('title', { title: '开场', body: '副题', transition: 'split', autoAdvance: 5 }),
          mk('bullets', { title: '要点', body: '甲\n乙\n丙', anim: 'wipe', animDir: 'right', exitAnim: 'fade' }),
          mk('blank', { shapes: [shape(0), shape(1, { anim: 'fly', animDir: 'top' })] }),
        ]
        return d
      },
    },
  ]

  fs.mkdirSync(GEN_DIR, { recursive: true })
  const out = []
  for (const c of cases) {
    try {
      const bytes = await deckToPptxBytes(c.deck())
      fs.writeFileSync(path.join(GEN_DIR, c.name), bytes)
      out.push({ name: c.name, file: path.join(GEN_DIR, c.name) })
      console.log(`GEN   ${c.name}  ${bytes.length} 字节`)
    } catch (e) {
      console.log(`SKIP  ${c.name}  — 生成失败：${String(e.message || e).slice(0, 120)}`)
    }
  }
  return out
}

const url = (p) => `file:///${p.replace(/\\/g, '/')}`

async function collect() {
  if (CORPUS) {
    const dir = path.resolve(CORPUS)
    if (!fs.existsSync(dir)) {
      console.error('PPTXCORPUS|外部语料目录不存在：' + path.basename(dir))
      process.exit(2)
    }
    const walk = (d, depth) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory() && depth < 2) walk(p, depth + 1)
        else if (/\.pptx$/i.test(e.name) && !e.name.startsWith('~$')) out.push({ name: e.name, file: p })
      }
    }
    const out = []
    walk(dir, 0)
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }
  if (NO_GEN && fs.existsSync(GEN_DIR)) {
    return fs.readdirSync(GEN_DIR).filter((n) => /\.pptx$/i.test(n))
      .sort().map((n) => ({ name: n, file: path.join(GEN_DIR, n) }))
  }
  return generate()
}

async function main() {
  const cli = path.join(REPO, 'node_modules/vite-node/dist/cli.mjs')
  if (!fs.existsSync(cli)) {
    console.error('PPTXCORPUS|缺 vite-node CLI')
    process.exit(2)
  }
  let files = await collect()
  if (LIMIT > 0) files = files.slice(0, LIMIT)
  if (!files.length) {
    console.error('PPTXCORPUS|没有 .pptx 语料')
    process.exit(2)
  }
  fs.mkdirSync(REPORT_DIR, { recursive: true })

  const rows = []
  const neverHits = new Map()
  const consultedHits = new Map()
  const t0 = Date.now()
  for (const f of files) {
    const stem = path.basename(f.name, path.extname(f.name)).replace(/[^\w.-]/g, '_')
    const outDir = path.join(REPORT_DIR, stem)
    const clist = path.join(REPORT_DIR, `${stem}.clist.txt`)
    fs.writeFileSync(clist, f.file + '\n')
    const r = spawnSync(process.execPath, [
      cli, 'scripts/fidelity-report-pptx.mjs', '--clist', clist, '--out', outDir,
    ], { cwd: REPO, encoding: 'utf8', timeout: 300_000, maxBuffer: 16 * 1024 * 1024 })
    const text = (r.stdout || '') + (r.stderr || '')
    const head = text.match(/REPORT\|mode=(\w+) ref=\S+ 件=(\d+) 读成=(\d+) 分母对=(\d+) 字面=(\d+) 有效=(\d+) 已查问=(\d+)/)
    const cov = text.match(/REPORT\|覆盖率 按对=([\d.]+)% 按字面=([\d.]+)%/)
    const jsonPath = path.join(outDir, 'pptx-fidelity.json')
    if (r.error || r.status !== 0 || !head || !cov || !fs.existsSync(jsonPath)) {
      const why = text.trim().split('\n').slice(-2).join(' ').slice(0, 160)
      console.log(`SKIP  ${f.name}  — ${why}`)
      rows.push({ name: f.name, error: why })
      continue
    }
    const j = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
    for (const [k] of j.neverConsulted ?? []) neverHits.set(k, (neverHits.get(k) ?? 0) + 1)
    for (const [k] of j.consulted ?? []) consultedHits.set(k, (consultedHits.get(k) ?? 0) + 1)
    // 口径：stdout 的「已查问」是**字面次数**（consultedOccurrences），
    // 拿它去除以「分母对」会得出 >100% 的荒唐数。汇总一律用 JSON 里的
    // distinct 对：consultedPairs / meaningfulPairs，与 coverage.byPair 同源。
    const row = {
      name: f.name,
      readable: Number(head[3]),
      pairs: Number(j.totals.meaningfulPairs),
      literals: Number(j.totals.meaningfulOccurrences),
      consultedPairs: Number(j.coverage.consultedPairs),
      consulted: Number(j.coverage.consultedOccurrences),
      byPair: Number(j.coverage.byPair) * 100,
      byLiteral: Number(j.coverage.byOccurrence) * 100,
    }
    rows.push(row)
    console.log(`DONE  ${f.name}  分母=${row.pairs} 按对=${row.byPair.toFixed(1)}% 按字面=${row.byLiteral.toFixed(1)}% 查问对=${row.consultedPairs}`)
  }

  const ok = rows.filter((r) => !r.error)
  const sum = (k) => ok.reduce((a, r) => a + r[k], 0)
  const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) : '—')
  const med = ok.length ? [...ok].map((r) => r.byPair).sort((a, b) => a - b)[Math.floor(ok.length / 2)] : 0

  const L = []
  L.push('# pptx 保真账 · 多输入对照')
  L.push('')
  L.push('> 复跑：`pnpm exec vite-node scripts/pptx-corpus.mjs`（内置生成夹具）；')
  L.push('> 外部真件加 `--corpus <目录> --out <md>`。语料由**产品自己的导出链**')
  L.push('> （`deckToPptxBytes`）生成，落在 `tmp/`、不入库；不是手工拼的 XML，也不是真件。')
  L.push('> 报告只写文件名，不写路径与日期。')
  L.push('')
  L.push('## 口径')
  L.push('')
  L.push('- 每份 pptx 独立跑一遍 `fidelity-report-pptx.mjs`，量具、注入点（`ga`）与主账本同源。')
  L.push('- 分母是**这一份件里读手真吃进去的部件**（theme1 / slideMaster1 / slides / notesSlides）')
  L.push('  全树普查出来的「元素|属性」对；分子是读手按名查问过的对。')
  L.push('- **各份分母不同，单份百分比之间、以及与 `--selftest` 主账本 70.1% 都不可直接比较**；')
  L.push('  合计只是分子/分母分别求和的规模描述，不是统一口径覆盖率。')
  L.push('- 合计与逐份都用 **distinct 对**（`meaningfulPairs` / `consultedPairs`）；')
  L.push('  stdout 里的「已查问」是字面次数，混用会算出 >100% 的荒唐数。')
  L.push('- 这里量的是「读手查问过多少」，与 docx 往返账的「写回去多少」不是同一件事。')
  L.push('- **18% 上下不能读成「读手退化」**：`--selftest` 的手写夹具只放了读手关心的')
  L.push('  属性，所以 70.1%；产品导出链写出的 pptx 带大量默认 / 打包级属性')
  L.push('  （`a:` 细节、样式默认、命名空间声明），它们同样进全树分母，读手不查问是')
  L.push('  设计如此。两数之差量的是**分母口径**，不是读手能力。')
  L.push('')
  L.push('## 汇总')
  L.push('')
  L.push('| | 值 |')
  L.push('|---|---:|')
  L.push(`| 输入份数 | ${files.length} |`)
  L.push(`| 跑成 / 跳过 | ${ok.length} / ${rows.length - ok.length} |`)
  L.push(`| 合计分母对 | ${sum('pairs')} |`)
  L.push(`| 合计查问对（distinct） | ${sum('consultedPairs')} |`)
  L.push(`| 按对覆盖率（合计口径） | ${pct(sum('consultedPairs'), sum('pairs'))}% |`)
  L.push(`| 单份按对中位数 | ${med.toFixed(1)}% |`)
  if (ok.length) {
    const lo = [...ok].sort((a, b) => a.byPair - b.byPair)[0]
    const hi = [...ok].sort((a, b) => b.byPair - a.byPair)[0]
    L.push(`| 最低 / 最高 | ${lo.name} ${lo.byPair.toFixed(1)}% / ${hi.name} ${hi.byPair.toFixed(1)}% |`)
  }
  L.push(`| 用时 | ${((Date.now() - t0) / 1000).toFixed(1)}s |`)
  L.push('')
  L.push('## 逐份')
  L.push('')
  L.push('| 文件 | 分母对 | 字面 | 查问对 | 按对 | 按字面 |')
  L.push('|---|---:|---:|---:|---:|---:|')
  for (const r of rows) {
    if (r.error) { L.push(`| ${r.name} | — | — | — | 跳过 | — |`); continue }
    L.push(`| ${r.name} | ${r.pairs} | ${r.literals} | ${r.consultedPairs} | **${r.byPair.toFixed(1)}%** | ${r.byLiteral.toFixed(1)}% |`)
  }
  L.push('')
  const neverKeys = [...neverHits.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  L.push(`## 反复没被查问的对（${neverKeys.length} 枚）`)
  L.push('')
  L.push('| 对 | 没查问的份数 | 被查问过的份数 |')
  L.push('|---|---:|---:|')
  for (const [k, n] of neverKeys.slice(0, 30)) {
    L.push(`| \`${k}\` | ${n} | ${consultedHits.get(k) ?? 0} |`)
  }
  if (neverKeys.length > 30) L.push(`| …共 ${neverKeys.length} 枚，只列前 30 | | |`)
  L.push('')
  L.push('同一枚在多份里都没被查问，才是「读手盲区」的候选；只在一份里出现，')
  L.push('更可能是那份件的形状特有属性，别拿去当长尾排序。')
  L.push('')
  const skipped = rows.filter((r) => r.error)
  if (skipped.length) {
    L.push('## 跳过明细')
    L.push('')
    for (const r of skipped) L.push(`- \`${r.name}\`：${r.error}`)
    L.push('')
  }
  L.push('## 边界')
  L.push('')
  L.push('- 这仍**不是真件语料**：源件全由产品导出链生成，读手不认的属性根本不会出现在源里；')
  L.push('  分母被产品自己的写手限定住了。真实 PowerPoint / WPS 件会带来更多属性族。')
  L.push('- 单件账本落在 `tmp/pptx-corpus-report/<文件名>/`，不覆盖 `docs/pptx-fidelity.*` 主账本。')
  L.push('- 主账本 70.1%（内置手写夹具，77 对）与此表不同源；v0.199 用 `stress.pptx`')
  L.push('  换过一次输入得 17.2%，本表是那次单件实测的铺开版。')
  L.push('')
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, L.join('\n'))
  console.log(`PPTXCORPUS|写盘 ${path.relative(REPO, OUT).replace(/\\/g, '/')}`)
  console.log(`PPTXCORPUS|跑成 ${ok.length}/${files.length}；合计 ${sum('consultedPairs')}/${sum('pairs')}（${pct(sum('consultedPairs'), sum('pairs'))}%）`)
  process.exitCode = ok.length ? 0 : 1
}

main().catch((e) => {
  console.error(`PPTXCORPUS|失败 ${String(e && e.message ? e.message : e).slice(0, 300)}`)
  process.exitCode = 1
})
