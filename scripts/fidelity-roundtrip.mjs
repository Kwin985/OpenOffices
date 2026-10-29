// 通用往返账：读 → 模型 → 写 → 普查写出包。
//
// 保真账本（scripts/fidelity-report.mjs）量的是「读手按名查问了哪些对」，它到「查问」
// 就停了。可产品里一条属性要活下来得走完三段：
//
//     docx ──读手──▶ HTML ──TipTap schema──▶ PM 模型 ──写手──▶ docx
//
// 任何一段断了，屏上可能看着完全正常，存盘就没了（v0.156 修的 `w:u` 线型与颜色就是
// 这样丢的：`<u style="…">` 在 HTML 里好端端的，可 underline mark 只认标签名，inline
// style 进不了模型，另存一次就只剩「有下划线」一比特）。
//
// 所以这份账换一套量法：不写断言、不逐族盯，而是把同一份夹具走完全程，然后**普查
// 写出包**，逐对问三件事——名字还在吗？值还对得上吗？整个部件还在吗？
//
//   保留  名字与全部源值都能在写出包里找到
//   值变  名字在，但某个源值没写回去（写回了个别的东西 —— 最隐蔽的单边）
//   掉了  名字在写出包里一次都没出现
//   缺件  连承载它的部件都没写出来
//
// 分子（"读到的"）只取 **源包里真在场 ∩ 探针记录过查问** 的对：读手查问了一个源里
// 根本没有的属性，不算业绩；没查问过的，那是保真账本的账，不在这里重复计。
//
// 用法：
//   pnpm exec vite-node scripts/fidelity-roundtrip.mjs
//   ... --ref HEAD --tmp tmp/roundtrip-mod --out docs
//
// 账本里不许出现任何文件路径：输入是内置夹具（scripts/lib/fixture.mjs），不带用户文件。
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import JSZip from 'jszip'
import { parseHTML } from 'linkedom'
import { getSchema } from '@tiptap/core'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { injectProbe, injectReaderReexport, materialize } from './lib/probe.mjs'
import { fixtureParts } from './lib/fixture.mjs'

const argv = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`)
  return i < 0 ? dflt : argv[i + 1]
}

const REPO = path.resolve(import.meta.dirname, '..')
const REF = flag('ref', 'HEAD')
const OUT_DIR = path.resolve(REPO, flag('out', 'docs'))
const MOD_DIR = path.resolve(REPO, flag('tmp', 'tmp/roundtrip-mod'))
const VERBOSE = argv.includes('--verbose')

// 与保真账本同一份部件清单：读手真吃进去的那几件。写出包多出来的部件（关系表、媒体）
// 不参与对账——那是打包细节，不是属性保真。
const PARTS = [
  'word/document.xml',
  'word/styles.xml',
  'word/numbering.xml',
  'word/footnotes.xml',
  'word/endnotes.xml',
  'word/comments.xml',
  'word/commentsExtended.xml',
]

// Word 自己的存档流水号：零渲染语义，按名字规则归噪音档（与保真账本同一条规则）
const NOISE = /^(rsid[A-Za-z]*|paraId|textId)$/

const local = (n) => (n.includes(':') ? n.slice(n.indexOf(':') + 1) : n)
const md5 = (s) => createHash('md5').update(s).digest('hex')
const url = (p) => `file:///${p.replace(/\\/g, '/')}`

// 写手那一半没有副本，靠这条断言把它钉在取样 rev 上：工作树脏了就拒绝跑。
// 归一换行再比——Windows 上 git 会把检出换成 CRLF，那不是内容变化。
function assertAtRef(rel) {
  const head = execFileSync('git', ['show', `${REF}:${rel}`], { cwd: REPO, encoding: 'utf8' })
  const disk = fs.readFileSync(path.join(REPO, rel), 'utf8')
  const norm = (s) => s.replace(/\r\n/g, '\n')
  if (norm(head) !== norm(disk)) {
    throw new Error(`${rel} 与 ${REF} 不一致：先提交再跑账（账本要按 rev 复现）`)
  }
}

// ST_OnOff：true/1/on 与 false/0/off 是同一个布尔的两套写法，写手换一套不算丢
const BOOL_ON = new Set(['true', 'on'])
const BOOL_OFF = new Set(['false', 'off'])
function normValue(v) {
  const s = String(v).trim().toLowerCase()
  if (BOOL_ON.has(s)) return '1'
  if (BOOL_OFF.has(s)) return '0'
  // 关系 id 是**包内编号**：写手按自己的打包顺序重排（源里的 rId1 到写出包成了 rId8），
  // 超链接那一枚更狠——docx 库给它现编一个随机串（实测 `rIdNGYG-ok_KKGZMBu-YDYJA`，
  // 每次跑都不一样）。逐字比不但比出假红，还会让账本本身不可复现。一律归一成占位符：
  // 「有没有这枚关系」由名字本身记着。
  if (/^rid[-_0-9a-z]*$/i.test(s)) return 'rid#'
  return s
}

// 一份包 → 每个「元素|属性」对的值分布。分母与分子都走这一条（同一套遍历、同一个解析器），
// 免得两边口径不同时把差异记在属性头上。
function census(zip, parseXml, parts) {
  const pairs = new Map()
  const present = new Set()
  for (const part of parts) {
    const ent = zip.file(part)
    if (!ent) continue
    present.add(part)
    let root
    try {
      root = parseXml(zipText[part] ?? '')
    } catch {
      continue
    }
    const visit = (el) => {
      const p = local(el.name)
      // 命名空间前缀（v0.157）：正文属性（w:*）与图形壳（a:/v:/wp:/pic:/wps:）是两笔完全
      // 不同的账，混在一个百分比里看不出任何东西。前缀在迷你解析器里是原样留着的。
      const pfx = el.name.includes(':') ? el.name.slice(0, el.name.indexOf(':')) : ''
      for (const k of Object.keys(el.attrs ?? {})) {
        if (k === 'xmlns' || k.startsWith('xmlns:')) continue
        const key = `${p}|${local(k)}`
        let rec = pairs.get(key)
        if (!rec) {
          rec = { n: 0, values: new Map(), parts: new Set(), pfxs: new Set() }
          pairs.set(key, rec)
        }
        rec.n++
        rec.parts.add(part)
        rec.pfxs.add(pfx)
        const v = normValue(el.attrs[k])
        rec.values.set(v, (rec.values.get(v) ?? 0) + 1)
      }
      for (const c of el.children ?? []) if (typeof c !== 'string') visit(c)
    }
    visit(root)
  }
  return { pairs, present }
}

// 部件文本挂在这个旁路表上：census 的签名保持 (zip, parseXml, parts) 三件事，
// 读文本的活单独做一遍，省得把 async 漏进遍历里。
const zipText = {}

async function readParts(bytes) {
  const zip = await JSZip.loadAsync(bytes)
  for (const k of Object.keys(zipText)) delete zipText[k]
  for (const part of PARTS) {
    const ent = zip.file(part)
    if (ent) zipText[part] = await ent.async('string')
  }
  return zip
}

async function main() {
  const t0 = Date.now()
  const { count: modFiles, fromGit } = materialize(MOD_DIR, { repo: REPO, ref: REF })
  const applied = injectProbe(path.join(MOD_DIR, 'ooxml.ts'), '')
  applied.push(injectReaderReexport(path.join(MOD_DIR, 'docx-fidelity.ts')))
  const reader = await import(url(path.join(MOD_DIR, 'docx-fidelity.ts')))
  const { parseXml } = await import(url(path.join(MOD_DIR, 'ooxml.ts')))
  const seen = reader.__PROBE.seen

  // 写手与 schema 从产品源取。为什么不从副本取：副本目录是运行期新建的，vite 的依赖
  // 预构建第一次见到它就会重启，动态导入当场作废（"Request is outdated"）。所以改用
  // 「文件必须是干净的」这条硬闸代替取样——工作树与取样 rev 不一致就直接拒绝跑。
  // 账本要能"给定 rev 就给定答案"，写手这一半靠这条断言守住。
  assertAtRef('src/lib/docx.ts')
  assertAtRef('src/lib/doc-schema.ts')
  const writer = await import(url(path.join(REPO, 'src/lib/docx.ts')))
  const { docExtensions } = await import(url(path.join(REPO, 'src/lib/doc-schema.ts')))

  // ---- 1. 源包 ----
  const srcZip = new JSZip()
  for (const [p, c] of fixtureParts()) srcZip.file(p, c)
  const srcBytes = new Uint8Array(
    await srcZip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }),
  )
  await readParts(srcBytes)
  const src = census(await JSZip.loadAsync(srcBytes), parseXml, PARTS)

  // ---- 2. 读（探针在这一趟里记账）----
  seen.clear()
  const fid = await reader.docxToHtmlFidelity(srcBytes)
  const consulted = new Set(seen.keys())
  const meta = await writer.docxToDocMeta(srcBytes)
  // 与 DocEditor 打开 .docx 时那段装配逐句对应（v0.102 起）：写手拿到的 meta 就是这里这一份
  const merged = {
    ...meta,
    ...(fid.styles?.length ? { styles: fid.styles } : {}),
    ...(fid.latentStyles ? { latentStyles: fid.latentStyles } : {}),
    ...(fid.numbering ? { numbering: fid.numbering } : {}),
    ...(fid.section ? { page: { ...meta.page, ...writer.pageSetupOf(fid.section) } } : {}),
    ...(fid.background ? { background: fid.background } : {}),
    ...(fid.comments.length ? { comments: fid.comments } : {}),
  }

  // ---- 3. HTML → PM（TipTap 按 schema 的 parseHTML 规则做，与浏览器里同一套）----
  const schema = getSchema(docExtensions())
  const { document } = parseHTML(`<!doctype html><html><body>${fid.html}</body></html>`)
  const pmDoc = PMDOMParser.fromSchema(schema).parse(document.body).toJSON()

  // ---- 4. 写 ----
  const outBytes = await writer.prosemirrorToDocxBytes(pmDoc, merged)
  await readParts(outBytes)
  const out = census(await JSZip.loadAsync(outBytes), parseXml, PARTS)

  // ---- 5. 对账 ----
  const readPairs = [...consulted].filter((k) => src.pairs.has(k)).sort()
  const rows = []
  for (const key of readPairs) {
    const sp = src.pairs.get(key)
    const op = out.pairs.get(key)
    const noise = NOISE.test(key.slice(key.indexOf('|') + 1))
    let bucket
    if (!op) {
      bucket = [...sp.parts].every((p) => !out.present.has(p)) ? 'part' : 'lost'
    } else {
      const missing = [...sp.values.keys()].filter((v) => !op.values.has(v))
      bucket = missing.length ? 'value' : 'kept'
    }
    rows.push({
      key,
      bucket,
      noise,
      // 这笔属性只出现在 w:* 元素上，还是沾过图形壳（a:/v:/wp:/pic:/wps:/o:）
      ns: sp.pfxs.size === 1 && sp.pfxs.has('w') ? 'w' : 'other',
      srcN: sp.n,
      srcValues: sp.values,
      outValues: op?.values ?? new Map(),
    })
  }

  const real = rows.filter((r) => !r.noise)
  const byBucket = { kept: [], value: [], lost: [], part: [] }
  for (const r of real) byBucket[r.bucket].push(r)
  for (const b of Object.values(byBucket)) b.sort((a, c) => c.srcN - a.srcN || a.key.localeCompare(c.key))

  const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) : '—')
  const total = real.length
  const keptN = byBucket.kept.length
  const runMs = Date.now() - t0

  // 正文属性与图形壳分列（v0.157）：混在一起的那个百分比说明不了任何事——
  // 这份夹具一半是 VML/DrawingML 图形壳（本来就是"读了写不回"的档），
  // 正文那一半才是日常文档真正走的路
  const nsTotals = {}
  for (const r of real) {
    const b = (nsTotals[r.ns] ??= { read: 0, kept: 0, value: 0, lost: 0, part: 0 })
    b.read++
    b[r.bucket]++
  }

  console.log(
    `ROUNDTRIP|ref=${REF} 模块=${modFiles}${fromGit ? '(git)' : '(工作树)'} blocks=${fid.blocks} 注入=[${applied.join(',')}]`,
  )
  console.log(
    `ROUNDTRIP|源包 部件=${src.present.size} 对数=${[...src.pairs.keys()].filter((k) => !NOISE.test(k.slice(k.indexOf('|') + 1))).length}  读手查问=${consulted.size}  读到的=${total}`,
  )
  console.log(
    `ROUNDTRIP|往返 保留=${keptN}/${total}(${pct(keptN, total)}%) 值变=${byBucket.value.length} 掉了=${byBucket.lost.length} 缺件=${byBucket.part.length}  噪音对=${rows.length - total}  用时=${(runMs / 1000).toFixed(1)}s`,
  )
  for (const ns of ['w', 'other']) {
    const b = nsTotals[ns]
    if (!b) continue
    console.log(
      `ROUNDTRIP|  ${ns === 'w' ? '正文属性' : '图形壳  '} 保留=${b.kept}/${b.read}(${pct(b.kept, b.read)}%) 值变=${b.value} 掉了=${b.lost} 缺件=${b.part}`,
    )
  }
  console.log(`ROUNDTRIP|写出包 部件=${out.present.size}（${[...out.present].map((p) => p.replace('word/', '')).join(' ')}）`)
  if (VERBOSE) {
    for (const r of byBucket.lost) console.log(`  LOST ${r.key} ×${r.srcN}`)
    for (const r of byBucket.value) console.log(`  VAL  ${r.key} ×${r.srcN} 源=${[...r.srcValues.keys()].join(',')} 出=${[...r.outValues.keys()].join(',')}`)
  }

  writeLedger({ rows, byBucket, nsTotals, total, keptN, pct, src, out, consulted, runMs, modFiles, fromGit, fid })
}

// ---- 6. 写账本 ---------------------------------------------------------------

function writeLedger(d) {
  const { rows, byBucket, nsTotals, total, keptN, pct, src, out, consulted, runMs, modFiles, fromGit, fid } = d
  const L = []
  L.push('# docx 往返账（读 → 模型 → 写）')
  L.push('')
  L.push(`取样 rev \`${REF}\`（${modFiles} 个模块${fromGit ? '，取自 git' : '，取自工作树'}）。`)
  L.push('')
  L.push('账本里**不写日期**：同一 rev、同一份夹具复跑必须逐字节相同，否则 `diff` 出来的')
  L.push('就不再是保真的变化。')
  L.push('')
  L.push('保真账本回答「读手按名查问了哪些对」。这份账回答**下一句**：查问过、也读到了的东西，')
  L.push('写回包里还在不在。两份账的分母口径相同（同一套「元素|属性」对、同一个解析器、同一份部件清单），')
  L.push('所以可以并排看：保真账本高的地方而这里低，就是一条单边通道。')
  L.push('')
  L.push('## 怎么算的')
  L.push('')
  L.push('一份夹具走完产品里那条真实的路：')
  L.push('')
  L.push('```')
  L.push('docx ──读手──▶ HTML ──TipTap schema──▶ PM 模型 ──写手──▶ docx')
  L.push('```')
  L.push('')
  L.push('- **读到的** = 源包里真在场的对 ∩ 探针记录过查问的对。查问了一个源里根本不存在的')
  L.push('  属性不算业绩；源里有、读手没查的，那是保真账本的账，不在这里重复计。')
  L.push('- **普查** = 用读手自己那枚迷你解析器遍历整棵树，记每个对的**值分布**（同一个属性')
  L.push('  在文档里可能出现好几种取值，只比名字会比出一堆假绿）。')
  L.push('- 逐对四选一：')
  L.push('')
  L.push('| 档 | 判据 | 意思 |')
  L.push('|---|---|---|')
  L.push('| 保留 | 名字在，且源的每个取值都能在写出包里找到 | 这一段真的双向 |')
  L.push('| 值变 | 名字在，但有源值没写回去 | 写回了别的东西——最隐蔽的单边 |')
  L.push('| 掉了 | 名字在写出包里一次都没出现 | 模型或写手没有这条槽 |')
  L.push('| 缺件 | 连承载它的部件都没写出来 | 整件丢失，比掉了更早一步 |')
  L.push('')
  L.push('- `true/1/on` 与 `false/0/off` 归一（ST_OnOff 的两套写法，写手换一套不算丢）；')
  L.push('  关系 id（`rId1` 之类）归一成占位符——那是包内编号，写手按自己的打包顺序重排，')
  L.push('  逐字比只会比出假红；Word 的存档流水号（`rsid*`/`paraId`/`textId`）按名字规则剔出分母。')
  L.push('')
  L.push('## 账')
  L.push('')
  L.push('| | 值 |')
  L.push('|---|---:|')
  L.push(`| 读到的对 | ${total} |`)
  L.push(`| 保留 | **${keptN}（${pct(keptN, total)}%）** |`)
  L.push(`| 值变 | ${byBucket.value.length} |`)
  L.push(`| 掉了 | ${byBucket.lost.length} |`)
  L.push(`| 缺件 | ${byBucket.part.length} |`)
  L.push(`| 源包部件 | ${src.present.size} |`)
  L.push(`| 写出包部件 | ${out.present.size} |`)
  L.push('')
  L.push(`探针在这一趟里记到 ${consulted.size} 个查问对；源包在场而有 ${total} 个既在场又被查问，构成上面的分母。`)
  L.push('')
  L.push('## 分两笔账：正文属性与图形壳')
  L.push('')
  L.push('一个混起来的百分比说明不了任何事。这份夹具里一半是 VML / DrawingML 的图形壳，')
  L.push('那是**成心**放进去照「读了写不回」的（形状与文本框被读手展平成文字，壳就没有容身之处）；')
  L.push('日常文档真正走的是正文那一半。所以分列：')
  L.push('')
  L.push('| 族 | 读到的 | 保留 | 值变 | 掉了 | 保留率 |')
  L.push('|---|---:|---:|---:|---:|---:|')
  for (const [ns, label] of [
    ['w', '正文属性（`w:*`）'],
    ['other', '图形壳（`a:`/`v:`/`wp:`/`pic:`/`wps:`/`o:`）'],
  ]) {
    const b = nsTotals[ns]
    if (!b) continue
    L.push(`| ${label} | ${b.read} | ${b.kept} | ${b.value} | ${b.lost} | **${pct(b.kept, b.read)}%** |`)
  }
  L.push('')
  L.push('口径说明：一个对算正文，当且仅当它在源包里**只**出现在 `w:*` 元素上（沾过图形壳就算图形壳）。')
  L.push('对名按 local name 归并（与保真账本同口径），所以 `fill|type` 这种两族同名的会并成一笔。')
  L.push('')

  const block = (title, note, list, view) => {
    L.push(`### ${title}（${list.length}）`)
    L.push('')
    if (note) {
      L.push(note)
      L.push('')
    }
    if (!list.length) {
      L.push('（空）')
      L.push('')
      return
    }
    L.push('| 对 | 源里出现 | 源值 | 写出值 |')
    L.push('|---|---:|---|---|')
    for (const r of list.slice(0, view ?? 40)) {
      const sv = [...r.srcValues.keys()].slice(0, 4).join(', ') || '—'
      const ov = [...r.outValues.keys()].slice(0, 4).join(', ') || '—'
      L.push(`| \`${r.key}\` | ${r.srcN} | ${sv} | ${ov} |`)
    }
    if (list.length > (view ?? 40)) L.push(`| …共 ${list.length} 条，完整清单见 \`docs/fidelity-roundtrip.json\` | | | |`)
    L.push('')
  }

  block(
    '掉了',
    '名字一次都没写出来。这里每一行都是一条**单边通道**：读手读了，模型或写手没有它的槽。',
    byBucket.lost,
  )
  block(
    '值变',
    '名字在，但某个源值没写回去。比「掉了」更隐蔽——普查看着它在场，屏上也像那么回事。',
    byBucket.value,
  )
  block('缺件', '承载它的部件整个没写出来。', byBucket.part, 20)
  block(
    '保留',
    '这些是真的双向。列出来是为了让「保留」也可核对，而不是一个孤零零的百分比。',
    byBucket.kept,
    24,
  )

  L.push('## 边界')
  L.push('')
  L.push('- **只有一份输入。** 输入是内置夹具（`scripts/lib/fixture.mjs`），与 `--selftest` 断言')
  L.push('  用的同一份。它的长处在「每枚属性都是人手放的」（所以每一条差异都可追），短处是')
  L.push('  「覆盖面就是这份夹具的覆盖面」——它不代表真实语料的长尾。')
  L.push('- **HTML → PM 用的是产品真 schema**（`src/lib/doc-schema.ts`，编辑器与量具共用的那一份），')
  L.push('  DOM 由 linkedom 提供（仅量具依赖）。换 schema 就换答案，所以 schema 必须是同一份。')
  L.push('- **不判对错，只判「回不回得来」。** 值变那一档里，有些是写手刻意规范化（单位换算、')
  L.push('  等价写法），有些是真丢。裁哪一条得逐对看，账本不替人裁决。')
  L.push('- 写出包里额外出现的对（写手自己按模型造的、源里没有的）不进表：那份差异属于')
  L.push('  「写多了」，与这份账问的「读到的丢了没」是两件事。')
  L.push('')
  L.push(`确定性：输入固定、遍历有序、无时间戳进正文，同一 rev 复跑逐字节相同（md5 见下）。`)
  L.push('')
  const md = L.join('\n')
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(OUT_DIR, 'fidelity-roundtrip.md'), md)

  const json = {
    ref: REF,
    definition: {
      numerator: 'source-present ∩ probe-consulted',
      buckets: ['kept', 'value', 'lost', 'part'],
      parts: PARTS,
      onOffNormalised: true,
    },
    totals: {
      read: total,
      kept: keptN,
      value: byBucket.value.length,
      lost: byBucket.lost.length,
      part: byBucket.part.length,
      consulted: consulted.size,
      srcParts: src.present.size,
      outParts: out.present.size,
      htmlBlocks: fid.blocks,
    },
    pairs: Object.fromEntries(
      rows
        .slice()
        .sort((a, c) => a.key.localeCompare(c.key))
        .map((r) => [
          r.key,
          {
            bucket: r.bucket,
            noise: r.noise || undefined,
            n: r.srcN,
            src: [...r.srcValues.keys()].sort(),
            out: [...r.outValues.keys()].sort(),
          },
        ]),
    ),
  }
  const js = `${JSON.stringify(json, null, 1)}\n`
  fs.writeFileSync(path.join(OUT_DIR, 'fidelity-roundtrip.json'), js)
  console.log(`ROUNDTRIP|写盘 ${path.relative(REPO, path.join(OUT_DIR, 'fidelity-roundtrip.md')).replace(/\\/g, '/')} 与 .json`)
  console.log(`ROUNDTRIP|md5 md=${md5(md)} json=${md5(js)}`)
}

main().catch((e) => {
  console.error(`ROUNDTRIP|失败 ${String(e && e.message ? e.message : e).slice(0, 300)}`)
  process.exitCode = 1
})
