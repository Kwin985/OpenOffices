// 全量结构测试汇总跑批。
//
// 仓库里每轮新增的 test-*.mjs 一直是「一份一份手工 npx vite-node」跑的，没有统一入口，
// CI 也就无从挂起。这个 runner 只做三件事：按文件名排序逐份跑、把跳过项说清理由、
// 有任何一份非零退出就把整批判红。
//
// 跑法：
//   node scripts/run-tests.mjs                     跑全部（外部产物依赖的默认跳过）
//   node scripts/run-tests.mjs --list             只列清单与跳过理由
//   node scripts/run-tests.mjs --only vml         只跑文件名含 vml 的
//   node scripts/run-tests.mjs --include-optional 连外部产物依赖的一起跑
//
// 设计约束：只用 node 内置模块 + 已在 devDependencies 里的 vite-node，
// 不依赖 tmp/ 或任何未入库文件，干净 clone 上可直接跑。

import { existsSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const cli = `${root}node_modules/vite-node/dist/cli.mjs`
const argv = process.argv.slice(2)

if (!existsSync(cli)) {
  console.error('RUN|找不到 vite-node CLI：' + cli + '（先 pnpm install）')
  process.exit(1)
}

const argOf = (flag) => {
  const i = argv.indexOf(flag)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : ''
}
const only = argOf('--only')
const listOnly = argv.includes('--list')
const includeOptional = argv.includes('--include-optional')

// 需要仓库外预构建产物的脚本：默认跳过，不因为环境缺件把整批判红。
// test-collab 要一个真的 WebSocket 中继进程（cargo build --example relay），
// 或由 RELAY_BIN 指向任意可执行文件。
const relayBin = process.env.RELAY_BIN
  ?? `${root}src-tauri/target/debug/examples/relay${process.platform === 'win32' ? '.exe' : ''}`
const OPTIONAL = new Map([
  ['test-collab.mjs', {
    ready: () => existsSync(relayBin),
    why: '需 cargo build --example relay，或设 RELAY_BIN 指向已构建的中继',
  }],
])

const files = readdirSync(`${root}scripts`)
  .filter((f) => /^test-.*\.mjs$/.test(f))
  .filter((f) => !only || f.includes(only))
  .sort()

if (listOnly) {
  for (const f of files) {
    const o = OPTIONAL.get(f)
    console.log(`  ${f}${o ? '  [可选] ' + o.why : ''}`)
  }
  console.log(`RUN|共 ${files.length} 份，可选 ${[...OPTIONAL.keys()].filter((f) => files.includes(f)).length} 份`)
  process.exit(0)
}

let pass = 0
let fail = 0
let skip = 0
const failures = []
const started = Date.now()

for (const f of files) {
  const o = OPTIONAL.get(f)
  if (o && !includeOptional && !o.ready()) {
    console.log(`SKIP  ${f}  — ${o.why}`)
    skip++
    continue
  }
  const t0 = Date.now()
  const r = spawnSync(process.execPath, [cli, `scripts/${f}`], {
    cwd: root,
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024,
  })
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  if (r.error || r.status !== 0) {
    console.log(`FAIL  ${f}  (${secs}s, exit=${r.status ?? 'spawn error'})`)
    const tail = ((r.stderr || '') + (r.stdout || '')).trim().split('\n').slice(-12).join('\n')
    if (tail) console.log(tail.split('\n').map((l) => '      ' + l).join('\n'))
    failures.push(f)
    fail++
  } else {
    console.log(`PASS  ${f}  (${secs}s)`)
    pass++
  }
}

console.log('')
console.log(`RUN|${files.length} 份：${pass} 通过 / ${fail} 失败 / ${skip} 跳过，用时 ${((Date.now() - started) / 1000).toFixed(1)}s`)
if (failures.length) console.log('RUN|失败清单：' + failures.join(', '))
process.exitCode = fail ? 1 : 0
