# xlsx 属性级往返账（产品写出 → 读回 → 再写出）

> 复跑：`pnpm exec vite-node scripts/sheet-roundtrip.mjs --format xlsx`；
> 外部真件加 `--src <.xlsx> --out <tmp目录>`；`--no-dump` 可复用上一次 dump。
> 源包与写出包都由 `cargo test --lib dump_sheet_roundtrip` 跑产品真出口生成，不是手工拼的 XML。

## 口径（与 docx 往返账、与另一格式的账都不可并排比百分比）

- **OOXML（`c|s` 那一套）** 是另一套词表，与 ODS 那本账的 key 不同源；两本账各自独立。
- 分母是**白名单部件里全部属性对**，不是「读手查问过的」：表格读手在 Rust，
  没有 TS 侧 attr/attrL 那样的统一漏斗可注入探针。这是整包普查。
- 进分母的部件：`xl/worksheets/sheetN.xml`、`xl/styles.xml`、`xl/workbook.xml`、`xl/sharedStrings.xml`。
  打包细节（Content_Types / _rels / docProps / theme）与 `xlsx_preserve` 整份搬运的侧通道部件都不进分母——否则整份搬运会被算成 kept，那是假绿。
- 默认源包由产品写手自己造，量的是**二次保存稳定性**；给 `--src` 换成外部真件后，
  量的是真件保真。两种输入不混在一个数字里。
- 归一与 docx 往返账同源：`true/1/on` 归一、关系 id 归一、`mc:Ignorable` 拆串、ISO 时刻归一。
  **不套用 docx 的 ST_OnOff 裸元素名单**（表格元素名不同）；漏补只会留假红，不会造假绿。
- 写出包里额外出现的对（写手自己造的、源里没有的）不进表：那是「写多了」，与这份账问的
  「源里在场的东西还在不在」是两件事。

## 账

| | 值 |
|---|---:|
| 源 | 产品夹具（二次保存） |
| 源包部件 / 写出包部件 | 4 / 4 |
| 分母对 | 65 |
| 保留 | **65（100.0%）** |
| 值变 | 0 |
| 掉了 | 0 |
| 缺件 | 0 |

分族：只按承载它们的部件分，不套 docx 的 `w:*` 正文 / 图形壳口径。
一个对若出现在多个部件，会在各部件各计一次，所以分族表的「读到」合计可能大于分母。

| 部件 | 读到 | 保留 | 值变 | 掉了 | 缺件 | 保留率 |
|---|---:|---:|---:|---:|---:|---:|
| `xl/sharedStrings.xml` | 2 | 2 | 0 | 0 | 0 | 100.0% |
| `xl/styles.xml` | 24 | 24 | 0 | 0 | 0 | 100.0% |
| `xl/workbook.xml` | 14 | 14 | 0 | 0 | 0 | 100.0% |
| `xl/worksheets/sheet1.xml` | 25 | 25 | 0 | 0 | 0 | 100.0% |

### 掉了（0）

名字在写出包里一次都没出现。

| 对 | 源里出现 | 源值 | 写出值 | 口径 |
|---|---:|---|---|---|

### 值变（0）

名字在，但某个源值没写回去。

| 对 | 源里出现 | 源值 | 写出值 | 口径 |
|---|---:|---|---|---|

### 缺件（0）

承载它的部件整个没写出来。

| 对 | 源里出现 | 源值 | 写出值 | 口径 |
|---|---:|---|---|---|

### 保留（65）

这些是真的往返稳定。

| 对 | 源里出现 | 源值 | 写出值 | 口径 |
|---|---:|---|---|---|
| `c|r` | 8 | a1, a2, a3, a4, a5, a6 | a1, a2, a3, a4, a5, a6 | — |
| `c|t` | 8 | s | s | — |
| `row|r` | 8 | 1, 2, 3, 4, 5, 6 | 1, 2, 3, 4, 5, 6 | — |
| `row|spans` | 8 | 1:1 | 1:1 | — |
| `col|customWidth` | 2 | 1 | 1 | — |
| `col|max` | 2 | 1, 2 | 1, 2 | — |
| `col|min` | 2 | 1, 2 | 1, 2 | — |
| `col|width` | 2 | 10.7109375, 16.42578125 | 10.7109375, 16.42578125 | — |
| `patternFill|patternType` | 2 | gray125, none | gray125, none | — |
| `row|customHeight` | 2 | 1 | 1 | — |
| `row|ht` | 2 | 18, 22.5 | 18, 22.5 | — |
| `xf|borderId` | 2 | 0 | 0 | — |
| `xf|fillId` | 2 | 0 | 0 | — |
| `xf|fontId` | 2 | 0 | 0 | — |
| `xf|numFmtId` | 2 | 0 | 0 | — |
| `borders|count` | 1 | 1 | 1 | — |
| `calcPr|calcId` | 1 | 124519 | 124519 | — |
| `calcPr|fullCalcOnLoad` | 1 | 1 | 1 | — |
| `cellStyle|builtinId` | 1 | 0 | 0 | — |
| `cellStyle|name` | 1 | normal | normal | — |
| `cellStyle|xfId` | 1 | 0 | 0 | — |
| `cellStyles|count` | 1 | 1 | 1 | — |
| `cellStyleXfs|count` | 1 | 1 | 1 | — |
| `cellXfs|count` | 1 | 1 | 1 | — |
| `color|theme` | 1 | 1 | 1 | — |
| `dimension|ref` | 1 | a1:a8 | a1:a8 | — |
| `dxfs|count` | 1 | 0 | 0 | — |
| `family|val` | 1 | 2 | 2 | — |
| `fileVersion|appName` | 1 | xl | xl | — |
| `fileVersion|lastEdited` | 1 | 4 | 4 | — |
| `fileVersion|lowestEdited` | 1 | 4 | 4 | — |
| `fileVersion|rupBuild` | 1 | 4505 | 4505 | — |
| `fills|count` | 1 | 2 | 2 | — |
| `fonts|count` | 1 | 1 | 1 | — |
| `name|val` | 1 | calibri | calibri | — |
| `pageMargins|bottom` | 1 | 0.75 | 0.75 | — |
| `pageMargins|footer` | 1 | 0.3 | 0.3 | — |
| `pageMargins|header` | 1 | 0.3 | 0.3 | — |
| `pageMargins|left` | 1 | 0.7 | 0.7 | — |
| `pageMargins|right` | 1 | 0.7 | 0.7 | — |
| …共 65 条，完整清单见 `sheet-roundtrip.json` | | | | |

## 边界

- **只做 xlsx 这一侧**：另一格式有独立账本（`ods-roundtrip.md`），两套词表不混。
- 不是真件长尾：默认源包由产品自己写出，读手不认的属性根本不会出现在源里。
  给 `--src` 换成真实 .xlsx 才能量到「读手吃了多少」。
- 没有读手查问集合，无法区分「读手主动读了」与「整包搬过来」；
  白名单部件 + 剔除整份搬运通道是当前的保守折中。
- 账本正文不写日期、路径与时间戳：同一 rev、同一夹具复跑逐字节相同。
