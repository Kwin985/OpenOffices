// ODS 属性级往返账的「量具有牙」验证（v0.201）。
//
// 与 xlsx 侧共用 scripts/lib/roundtrip-mut.mjs：删掉写出包里带 ro2 样式的整行，
// 账本的保留数必须下降；恢复后回到 12 kept 且 md5 与基线逐字节相同。
// 全程只写 tmp/ods-roundtrip-test/，不碰 docs/ 主账本。
//
// 跑法：node scripts/test-ods-roundtrip.mjs

import { mutationSuite } from './lib/roundtrip-mut.mjs'

try {
  const { ok, bad } = await mutationSuite('ods')
  console.log(`ods-roundtrip: ${ok.length} 通过 / ${bad.length} 失败`)
  for (const b of bad) console.error('  FAIL ' + b)
  if (bad.length) process.exitCode = 1
} catch (e) {
  console.error('ods-roundtrip: 异常 ' + String(e.message || e))
  process.exitCode = 1
}
