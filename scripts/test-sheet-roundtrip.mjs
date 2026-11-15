// v0.200：xlsx 属性级往返账的「量具有牙」验证。
//
// 第一版账本在夹具上是 65/65（二次保存稳定），一个永远 100% 的账本等于没量。
// 这里用与 docx 四条变异腿同样的思路：把写出包里 `<cols>` 整段删掉，账本必须
// 报出 lost；恢复后必须回到 65/65 且 md5 与基线逐字节相同。
//
// 跑法：node scripts/test-sheet-roundtrip.mjs（依赖 tmp/sheet-roundtrip/{src,out}.xlsx，
// 由 scripts/sheet-roundtrip.mjs 不带 --no-dump 跑一次生成）。

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import JSZip from 'jszip'
import { fileURLToPath } from 'node:url'

const REPO = fileURLToPath(new URL('..', import.meta.url))
const cli = path.join(REPO, 'node_modules/vite-node/dist/cli.mjs')
const DUMP = path.join(REPO, 'tmp/sheet-roundtrip')
const OUT = path.join(DUMP, 'out.xlsx')
const SRC_X = path.join(DUMP, 'src.xlsx')
// 变异腿全程只写 tmp，绝不碰 docs/ 主账本（与 v0.198/v0.199 的界线同一条）
const TEST_OUT = 'tmp/sheet-roundtrip-test'

const ok = []
const bad = []
const check = (name, cond, extra = '') => {
  ;(cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
}

if (!fs.existsSync(cli)) {
  console.error('缺 vite-node CLI')
  process.exit(1)
}

// 自包含：干净 clone 上没有 dump 产物时，自己跑一次产品真链路生成（内含 cargo test）。
// 不依赖任何预置的未入库文件。
if (!fs.existsSync(OUT) || !fs.existsSync(SRC_X)) {
  const gen = spawnSync(process.execPath, [cli, 'scripts/sheet-roundtrip.mjs', '--out', TEST_OUT], {
    cwd: REPO, encoding: 'utf8', timeout: 600_000, maxBuffer: 16 * 1024 * 1024,
  })
  if (gen.error || gen.status !== 0) {
    console.error('生成 dump 失败：' + ((gen.stdout || '') + (gen.stderr || '')).trim().split('\n').slice(-4).join(' '))
    process.exit(1)
  }
}

const run = () => spawnSync(
  process.execPath,
  [cli, 'scripts/sheet-roundtrip.mjs', '--no-dump', '--out', TEST_OUT],
  { cwd: REPO, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024 },
)
const lostOf = (text) => Number((text.match(/掉了=(\d+)/) || [0, 0])[1])
const keptOf = (text) => Number((text.match(/保留=(\d+)\//) || [0, 0])[1])
const md5Of = (text) => (text.match(/md5 md=([0-9a-f]+)/) || [0, ''])[1]

const backup = fs.readFileSync(OUT)

let baseline = run()
check('基线跑成', baseline.status === 0, (baseline.stderr || '').slice(-120))
check('基线保留 65/65', keptOf(baseline.stdout || '') === 65, (baseline.stdout || '').trim().split('\n')[1])
check('基线无掉对', lostOf(baseline.stdout || '') === 0)
const baselineMd5 = md5Of(baseline.stdout || '')
check('基线账本有 md5', /^[0-9a-f]{32}$/.test(baselineMd5))

// ---- 变异：写出包里删掉 <cols> 整段 ----
;(async () => {
  const z = await JSZip.loadAsync(backup)
  const part = 'xl/worksheets/sheet1.xml'
  const xml = await z.file(part).async('string')
  check('源写出包里有 cols 段', /<cols>[\s\S]*?<\/cols>/.test(xml))
  z.file(part, xml.replace(/<cols>[\s\S]*?<\/cols>/, ''))
  fs.writeFileSync(OUT, await z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))

  const mut = run()
  check('变异腿跑成', mut.status === 0)
  const mutLost = lostOf(mut.stdout || '')
  check('变异腿报出掉对', mutLost > 0, `掉了=${mutLost}`)
  check('变异腿保留数下降', keptOf(mut.stdout || '') < 65, `保留=${keptOf(mut.stdout || '')}`)

  // ---- 复位：写出包与账本都回到基线 ----
  fs.writeFileSync(OUT, backup)
  const restored = run()
  check('复位跑成', restored.status === 0)
  check('复位回到 65/65', keptOf(restored.stdout || '') === 65)
  check('复位无掉对', lostOf(restored.stdout || '') === 0)
  check('复位 md5 与基线逐字节相同', md5Of(restored.stdout || '') === baselineMd5,
    `${md5Of(restored.stdout || '')} vs ${baselineMd5}`)
  const again = run()
  check('干净腿两次复跑 md5 一致', md5Of(again.stdout || '') === baselineMd5)
  check('源包未被变异腿改动', fs.readFileSync(SRC_X).length > 0)
  check('报告落在 tmp 测试目录而非 docs',
    fs.existsSync(path.join(REPO, TEST_OUT, 'sheet-roundtrip.md')))

  console.log(`sheet-roundtrip: ${ok.length} 通过 / ${bad.length} 失败`)
  for (const b of bad) console.error('  FAIL ' + b)
  if (bad.length) process.exitCode = 1
})().catch((e) => {
  fs.writeFileSync(OUT, backup)
  console.error('sheet-roundtrip: 异常 ' + String(e.message || e))
  process.exitCode = 1
})
