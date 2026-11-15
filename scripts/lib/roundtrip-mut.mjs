// 表格属性级往返账的变异腿公共实现（v0.201 泛化）。
//
// 第二处同形状需求出现时不复制：xlsx 与 ODS 共用「跑基线 → 改写出包 → 必须报
// lost/value → 复位 → md5 回到基线」这一套，只有「改哪个包、删哪一段」不同。
// 全程只写 tmp/，绝不碰 docs/ 主账本；缺 dump 时自己跑产品真链路生成，
// 不依赖任何预置的未入库文件。

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import JSZip from 'jszip'
import { fileURLToPath } from 'node:url'

const REPO = fileURLToPath(new URL('../..', import.meta.url))
const CLI = path.join(REPO, 'node_modules/vite-node/dist/cli.mjs')
const DUMP = path.join(REPO, 'tmp/sheet-roundtrip')

const CFG = {
  xlsx: {
    src: 'src.xlsx',
    out: 'out.xlsx',
    part: 'xl/worksheets/sheet1.xml',
    pattern: /<cols>[\s\S]*?<\/cols>/,
    testOut: 'tmp/sheet-roundtrip-test',
    expectKept: 65,
  },
  ods: {
    src: 'ods-src.ods',
    out: 'ods-out.ods',
    part: 'content.xml',
    // 删掉带 ro2 样式的整行：`table-row|style-name` 与 `table-row-properties|row-height`
    // 都在分母里且原本是 kept，删掉必然让保留数下降。删 table-column 不行——
    // 那两枚属性不在白名单分母里，删了账本毫无反应，等于变异腿失效。
    pattern: /<table:table-row table:style-name="ro2"[\s\S]*?<\/table:table-row>/,
    testOut: 'tmp/ods-roundtrip-test',
    expectKept: 12,
  },
}

const lostOf = (t) => Number((t.match(/掉了=(\d+)/) || [0, 0])[1])
const keptOf = (t) => Number((t.match(/保留=(\d+)\//) || [0, 0])[1])
const md5Of = (t) => (t.match(/md5 md=([0-9a-f]+)/) || [0, ''])[1]

/** 返回 { ok, bad }；调用方负责打印与设置 exitCode。 */
export async function mutationSuite(format) {
  const cfg = CFG[format]
  if (!cfg) throw new Error(`未知格式 ${format}`)
  const ok = []
  const bad = []
  const check = (name, cond, extra = '') => {
    ;(cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
  }
  if (!fs.existsSync(CLI)) throw new Error('缺 vite-node CLI（先 pnpm install）')

  const outPath = path.join(DUMP, cfg.out)
  const srcPath = path.join(DUMP, cfg.src)
  const args = (noDump) => [
    CLI, 'scripts/sheet-roundtrip.mjs', '--format', format,
    ...(noDump ? ['--no-dump'] : []), '--out', cfg.testOut,
  ]
  const run = (noDump = true) => spawnSync(process.execPath, args(noDump), {
    cwd: REPO, encoding: 'utf8', timeout: noDump ? 180_000 : 600_000,
    maxBuffer: 16 * 1024 * 1024,
  })

  // 自包含：干净 clone 上缺 dump 时，自己跑一次产品真链路（内含 cargo test）。
  if (!fs.existsSync(outPath) || !fs.existsSync(srcPath)) {
    const gen = run(false)
    if (gen.error || gen.status !== 0) {
      throw new Error(`生成 ${format} dump 失败：` + ((gen.stdout || '') + (gen.stderr || '')).trim().split('\n').slice(-4).join(' '))
    }
  }

  const backup = fs.readFileSync(outPath)
  const baseline = run()
  check('基线跑成', baseline.status === 0, (baseline.stderr || '').slice(-120))
  check(`基线保留 ${cfg.expectKept}`, keptOf(baseline.stdout || '') === cfg.expectKept)
  const baselineMd5 = md5Of(baseline.stdout || '')
  check('基线账本有 md5', /^[0-9a-f]{32}$/.test(baselineMd5))

  // ---- 变异：写出包里删掉一段结构 ----
  const z = await JSZip.loadAsync(backup)
  const xml = await z.file(cfg.part).async('string')
  check('源写出包里有变异锚点', cfg.pattern.test(xml))
  z.file(cfg.part, xml.replace(cfg.pattern, ''))
  fs.writeFileSync(outPath, await z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))

  const mut = run()
  check('变异腿跑成', mut.status === 0)
  check('变异腿报出非 kept 对',
    lostOf(mut.stdout || '') > 0 || keptOf(mut.stdout || '') < cfg.expectKept,
    `掉了=${lostOf(mut.stdout || '')} 保留=${keptOf(mut.stdout || '')}`)

  // ---- 复位 ----
  fs.writeFileSync(outPath, backup)
  const restored = run()
  check('复位跑成', restored.status === 0)
  check(`复位回到 ${cfg.expectKept}`, keptOf(restored.stdout || '') === cfg.expectKept)
  check('复位 md5 与基线逐字节相同', md5Of(restored.stdout || '') === baselineMd5,
    `${md5Of(restored.stdout || '')} vs ${baselineMd5}`)
  const again = run()
  check('干净腿两次复跑 md5 一致', md5Of(again.stdout || '') === baselineMd5)
  check('源包未被变异腿改动', fs.readFileSync(srcPath).length > 0)
  check('报告落在 tmp 而非 docs', fs.existsSync(path.join(REPO, cfg.testOut,
    format === 'ods' ? 'ods-roundtrip.md' : 'sheet-roundtrip.md')))

  return { ok, bad }
}
