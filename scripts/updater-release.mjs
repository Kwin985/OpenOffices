// 发版：本机构建带签名的更新包，并生成上传用的 latest.json。
//
// 为什么要有这个脚本：更新通道的信任根是 ~/.tauri 下的那把私钥（**不在仓库里，也没有备份就等于
// 全体老用户再也收不到更新**）。发版动作要同时做对四件事——开 createUpdaterArtifacts、给两个
// 环境变量、把 `.sig` 原文塞进清单、让 url 指向上架后的真实地址——手敲任意一步都可能悄悄做错，
// 而做错的表现是"用户端检查更新永远失败"，本机构建却全绿。
//
// 用法：
//   node scripts/updater-release.mjs --notes "本轮更新说明"
//   node scripts/updater-release.mjs --skip-build        # 只按现有产物重生成清单
//   node scripts/updater-release.mjs --base-url <url> --page-url <url>   # 更新源换到别处托管时
//
// 产物在 src-tauri/target/release/bundle/ 的 nsis/ 与 msi/ 下：安装包 .exe / .msi 各自带一份同名 .sig
// （tauri CLI 2.11 的 `createUpdaterArtifacts: true` 签的就是安装包本身；只有配成 `v1Compatible` 才会
// 另出 *.nsis.zip 那种老形状，更新器两种都收：updater.rs 先按字节嗅探 zip，不是 zip 就当 .exe 直接跑）。
// 加生成的 latest.json（更新源要放的那份清单）——安装包 + .sig + latest.json 一起上传，少一件就是
// 用户那边的"清单没返回"。
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt
}
/** 开关参数不能复用 arg：`--skip-build` 排在末尾时 argv[i+1] 是 undefined，arg() 会回落到默认值 false，于是"跳过了构建"反而又构建一遍 */
const flag = (name) => process.argv.includes(`--${name}`)

const conf = JSON.parse(readFileSync(`${root}src-tauri/tauri.conf.json`, 'utf8'))
const version = conf.version
const keyPath = process.env.OOF_UPDATER_KEY ?? `${homedir()}/.tauri/openoffices.updater.key`
const passPath = process.env.OOF_UPDATER_PASS ?? `${keyPath}.pass`

if (!flag('skip-build')) {
  if (!existsSync(keyPath)) {
    console.error(
      `找不到更新私钥：${keyPath}\n生成：pnpm tauri signer generate -w "${keyPath}"（然后把口令存进 ${passPath}）`,
    )
    process.exit(1)
  }
  const pass = existsSync(passPath) ? readFileSync(passPath, 'utf8').trim() : ''
  const r = spawnSync(
    process.execPath,
    [`${root}node_modules/@tauri-apps/cli/tauri.js`, 'build', '-c', JSON.stringify({ bundle: { createUpdaterArtifacts: true } })],
    {
      cwd: root,
      stdio: 'inherit',
      // 私钥与口令只进子进程环境，绝不打印；缺了口令时 CLI 会自己去问
      env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: readFileSync(keyPath, 'utf8'), TAURI_SIGNING_PRIVATE_KEY_PASSWORD: pass },
    },
  )
  if (r.status !== 0) {
    console.error(`构建失败（退出码 ${r.status}）：没有产物可发布，清单也没生成`)
    process.exit(r.status ?? 1)
  }
}

const bundle = `${root}src-tauri/target/release/bundle`
/**
 * 收集"某个目录里本轮版本的安装包 + 它的 .sig"。
 * 清单要按安装包种类分 key（`windows-x86_64-nsis` / `-msi` / 通用 `windows-x86_64`）：
 * 插件先找 `{os}-{arch}-{installer}` 再退到 `{os}-{arch}`， installer 取自 exe 里被 patch 进去的
 * bundle type——只发一种的话，用另一种装的用户会拿到不相干的包去装（MSI 装到 Program Files、
 * NSIS 装到 %LOCALAPPDATA%，混装就是两份安装）。
 */
function pick(dir, suffix) {
  if (!existsSync(dir)) return null
  const cands = readdirSync(dir).filter((f) => f.endsWith(suffix) && !f.endsWith('.sig'))
  const mine = cands.find((f) => f.includes(version)) ?? cands[0]
  if (!mine) return null
  if (!existsSync(`${dir}/${mine}.sig`)) {
    console.error(`${dir}/${mine} 旁边没有 .sig：这份包没被签名，发上去只会让用户端检查更新失败。`)
    process.exit(1)
  }
  if (cands.length > 1) console.log(`注意：${dir} 里有 ${cands.length} 份 ${suffix}，本次取 ${mine}（旧的建议清掉，免得传错）`)
  return { file: mine, sig: readFileSync(`${dir}/${mine}.sig`, 'utf8').trim() }
}

const baseUrl = arg('base-url', `https://github.com/Kwin985/OpenOffices/releases/download/${arg('tag', `v${version}`)}`)
const entries = []
const nsis = pick(`${bundle}/nsis`, '-setup.exe')
const msi = pick(`${bundle}/msi`, '.msi')
if (!nsis && !msi) {
  console.error(`没找到任何已签名的安装包（${bundle}/nsis/*-setup.exe(.sig) 或 ${bundle}/msi/*.msi(.sig)）。`)
  console.error('最常见原因是构建时没开 bundle.createUpdaterArtifacts，或私钥/口令没给到——本脚本会自动开前者。')
  process.exit(1)
}
if (nsis) entries.push(['windows-x86_64-nsis', nsis])
if (msi) entries.push(['windows-x86_64-msi', msi])
// 通用 key 给没通过安装包启动的形状（dev 跑的裸 exe、以及将来的其它取法）：拿 nsis 那份兜底
if (nsis) entries.push(['windows-x86_64', nsis])

const platforms = {}
for (const [target, a] of entries) platforms[target] = { url: `${baseUrl}/${a.file}`, signature: a.sig }

const manifest = {
  version,
  notes: arg('notes', ''),
  pub_date: new Date().toISOString(),
  platforms,
  // 更新器不认这个自定义字段，但我们检测层要它：没有它就只能告诉用户"有新版本"却给不出去哪拿。
  // 地址猜不出来就不写，宁可不给按钮（见 src/lib/update.ts 的 infoOf）。
  download_page: arg('page-url', `https://github.com/Kwin985/OpenOffices/releases/tag/${arg('tag', `v${version}`)}`),
}
const out = `${bundle}/latest.json`
writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`)

console.log(`\n清单：${out}`)
console.log(`版本 ${version}｜条目 ${Object.keys(platforms).join('、')}`)
console.log('上传这些到更新源（latest.json 放在 endpoints 指的那个地址上）：')
for (const [dir, a] of [[nsis && `${bundle}/nsis`, nsis], [msi && `${bundle}/msi`, msi]].filter(([, x]) => x)) {
  console.log(`  ${dir}/${a.file}`)
  console.log(`  ${dir}/${a.file}.sig`)
}
console.log(`  ${out}`)
