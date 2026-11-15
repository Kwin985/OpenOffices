// xlsx 属性级往返账的「量具有牙」验证（v0.200 建 / v0.201 泛化）。
//
// 变异逻辑已抽到 scripts/lib/roundtrip-mut.mjs，ODS 侧共用同一副骨架
// （test-ods-roundtrip.mjs）。这里只负责选格式、打印与退出码。
//
// 跑法：node scripts/test-sheet-roundtrip.mjs

import { mutationSuite } from './lib/roundtrip-mut.mjs'

try {
  const { ok, bad } = await mutationSuite('xlsx')
  console.log(`sheet-roundtrip(xlsx): ${ok.length} 通过 / ${bad.length} 失败`)
  for (const b of bad) console.error('  FAIL ' + b)
  if (bad.length) process.exitCode = 1
} catch (e) {
  console.error('sheet-roundtrip(xlsx): 异常 ' + String(e.message || e))
  process.exitCode = 1
}
