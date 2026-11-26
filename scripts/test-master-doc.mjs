// v0.237 守卫：主控文档（清单管理 + odoc 正文提取 + 展开合并）。
// 跑法：npx vite-node scripts/test-master-doc.mjs

import { addSubDoc, removeSubDoc, moveSubDoc, paragraphsFromOdoc, expandSubDocs } from '../src/lib/templates.ts'

const ok = []
const bad = []
const check = (n, c, extra = '') => (c ? ok : bad).push(n + (c || !extra ? '' : ` — ${extra}`))

// 清单管理（不可变）
const l0 = ['a.odoc', 'b.odoc']
check('追加', JSON.stringify(addSubDoc(l0, 'c.odoc')) === JSON.stringify(['a.odoc', 'b.odoc', 'c.odoc']))
check('去重追加', addSubDoc(l0, 'a.odoc') === l0)
check('空路径不加', addSubDoc(l0, '') === l0)
check('不改原数组', JSON.stringify(l0) === JSON.stringify(['a.odoc', 'b.odoc']))
check('移除', JSON.stringify(removeSubDoc(l0, 'a.odoc')) === JSON.stringify(['b.odoc']))
check('移除不存在返回等长新数组', removeSubDoc(l0, 'z').length === 2)
check('下移', JSON.stringify(moveSubDoc(l0, 'a.odoc', 1)) === JSON.stringify(['b.odoc', 'a.odoc']))
check('上移', JSON.stringify(moveSubDoc(l0, 'b.odoc', -1)) === JSON.stringify(['b.odoc', 'a.odoc']))
check('越界不动', moveSubDoc(l0, 'b.odoc', 1) === l0 && moveSubDoc(l0, 'a.odoc', -1) === l0)
check('不存在不动', moveSubDoc(l0, 'z', 1) === l0)

// odoc 正文提取
const odoc = (paras) => JSON.stringify({ app: 'openoffices', kind: 'doc', version: 1, content: { type: 'doc', content: paras.map((t) => ({ type: 'paragraph', content: t ? [{ type: 'text', text: t }] : undefined })) } })
check('提取段落', paragraphsFromOdoc(odoc(['甲', '乙'])) === '甲\n乙', paragraphsFromOdoc(odoc(['甲', '乙'])))
check('空段保留', paragraphsFromOdoc(odoc(['甲', '', '乙'])) === '甲\n\n乙')
check('非 odoc 拒绝', paragraphsFromOdoc(JSON.stringify({ app: 'other', kind: 'doc' })) === '')
check('坏 JSON 返回空', paragraphsFromOdoc('{bad') === '')
check('非段落节点跳过', paragraphsFromOdoc(JSON.stringify({ app: 'openoffices', kind: 'doc', content: { content: [{ type: 'bulletList' }, { type: 'paragraph', content: [{ text: '有' }] }] } })) === '有')

// 展开合并
check('按序合并', expandSubDocs(['甲', '乙']) === '甲\n\n乙', expandSubDocs(['甲', '乙']))
check('空份跳过', expandSubDocs(['甲', '', '乙']) === '甲\n\n乙')
check('全空返回空', expandSubDocs(['', '  ']) === '')

// 端到端：三份 odoc 按清单序展开
const parts = [odoc(['第一份']), odoc(['第二份A', '第二份B']), odoc(['第三份'])]
check('三份端到端展开', expandSubDocs(parts.map(paragraphsFromOdoc)) === '第一份\n\n第二份A\n第二份B\n\n第三份', expandSubDocs(parts.map(paragraphsFromOdoc)))


const fs = await import('node:fs')
const ui = fs.readFileSync(new URL('../src/components/DocEditor.tsx', import.meta.url), 'utf8')
check('工具条有「主控」入口', ui.includes("btn('主控'"))
check('面板有添加/展开/打开/排序/移除', ui.includes('masterAdd()') && ui.includes('masterExpand()') && ui.includes('openTab({ kind:') && ui.includes('moveSubDoc(') && ui.includes('removeSubDoc('))
check('清单存 meta.subDocs 可往返', ui.includes('patchMeta({ subDocs:'))
check('展开不写回子文档', ui.includes('原文未被改动'))

for (const n of ok) console.log(`  ✓ ${n}`)
for (const n of bad) console.log(`  ✗ ${n}`)
console.log(`\n主控文档：${ok.length} 通过 / ${bad.length} 失败`)
if (bad.length) process.exit(1)
