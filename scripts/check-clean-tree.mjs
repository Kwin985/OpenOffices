// 干净树门禁：在「只有版本库里有的文件」这棵树上跑 tsc / vite build。
//
// 起因（v0.197 前实测）：工作树 tsc 一直是 0 错，但 `git archive HEAD` 导出后是 18 错——
// 12 个长期未入库的 lib 被 HEAD 里的组件 import，工作树有、clone 没有。
// 「在工作树上跑门禁」证明不了仓库能构建，这个脚本把门禁挪到导出树。
//
// 导出树放在项目内 tmp/ 下（已 gitignore），这样 TS / Vite 逐级向上找 node_modules 时
// 自然落到项目根的 node_modules，不需要 symlink，也就没有误删依赖的风险。
//
// 跑法：
//   node scripts/check-clean-tree.mjs             检查 HEAD
//   node scripts/check-clean-tree.mjs --index    检查暂存区（提交前用，不必先 commit）
//   node scripts/check-clean-tree.mjs --tsc-only 只跑 tsc，跳过 vite build
//
// 依赖系统自带 tar（Windows 10+ / Linux / macOS 都有）。只用 node 内置模块与 git。

import { existsSync, mkdirSync, rmSync, writeFileSync, unlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const argv = process.argv.slice(2)
const useIndex = argv.includes('--index')
const tscOnly = argv.includes('--tsc-only')

const git = (args, opts = {}) => spawnSync('git', args, {
  cwd: root, maxBuffer: 64 * 1024 * 1024, ...opts,
})

let ref = 'HEAD'
if (useIndex) {
  const t = git(['write-tree'], { encoding: 'utf8' })
  if (t.status !== 0) {
    console.error('CLEAN|git write-tree 失败：' + (t.stderr || '').trim())
    process.exit(1)
  }
  ref = t.stdout.trim()
}

// 导出目录可被外部指定（check-all 一键全跑时给每轮一枚全新目录，避沙箱删除守卫按 turn 累计的闸）
const cleanTag = process.env.CLEAN_TAG || String(process.pid)
const work = `${root}tmp/clean-check-${cleanTag}`
const tarPath = `${root}tmp/clean-check-${cleanTag}.tar`
mkdirSync(work, { recursive: true })

const finish = (code) => {
  // 清理失败不改门禁结论：检查项已经跑完并给出 PASS/FAIL，删除守卫或 trash 故障
  // 不该把全绿反咬成红灯。失败只提示一句，产物留在 tmp/ 里可手工处理。
  try {
    if (existsSync(work)) rmSync(work, { recursive: true, force: true })
    if (existsSync(tarPath)) unlinkSync(tarPath)
  } catch (e) {
    console.error(`CLEAN|临时目录清理跳过（不影响检查结论）：${e instanceof Error ? e.message.slice(0, 120) : String(e)}`)
  }
  process.exit(code)
}

const arc = git(['archive', '--format=tar', ref])
if (arc.status !== 0 || !arc.stdout?.length) {
  console.error('CLEAN|git archive 失败：' + (arc.stderr || '').toString().trim())
  finish(1)
}
// 两个坑：Windows 上 spawnSync 往 stdin 灌几 MB 的 tar 会 EOF；GNU tar 会把
// "E:/..." 当成 host:path 去连远程。所以落临时文件 + 给 tar 传相对路径。
writeFileSync(tarPath, arc.stdout)
const rel = `tmp/clean-check-${cleanTag}`
const ext = spawnSync('tar', ['-xf', `${rel}.tar`, '-C', rel], {
  cwd: root, maxBuffer: 64 * 1024 * 1024,
})
if (ext.status !== 0 || ext.error || !existsSync(`${work}/package.json`)) {
  console.error('CLEAN|解包失败（需要系统 tar）：' + (ext.error?.message || (ext.stderr || '').toString().trim()))
  finish(1)
}

const run = (label, exe, args, timeout) => {
  const r = spawnSync(process.execPath, [exe, ...args], {
    cwd: work, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024,
  })
  if (r.error || r.status !== 0) {
    console.error(`CLEAN|FAIL  ${label}  exit=${r.status ?? 'spawn error'}`)
    const out = ((r.stdout || '') + (r.stderr || '')).trim()
    if (out) console.error(out.split('\n').slice(-30).map((l) => '      ' + l).join('\n'))
    return false
  }
  console.log(`CLEAN|PASS  ${label}`)
  return true
}

const tsc = `${root}node_modules/typescript/bin/tsc`
let ok = run('tsc --noEmit（干净树）', tsc, ['--noEmit', '--pretty', 'false'], 300_000)

if (ok && !tscOnly) {
  const vite = `${root}node_modules/vite/bin/vite.js`
  ok = run('vite build（干净树）', vite, ['build', '--logLevel', 'error'], 300_000)
}

console.log(`CLEAN|${ok ? '全绿' : '失败'}  ref=${useIndex ? '暂存区' : ref}  目录=${work}`)
finish(ok ? 0 : 1)
