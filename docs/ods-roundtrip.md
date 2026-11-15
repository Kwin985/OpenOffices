# ODS 属性级往返账（产品写出 → 读回 → 再写出）

> 复跑：`pnpm exec vite-node scripts/sheet-roundtrip.mjs --format ods`；
> 外部真件加 `--src <.ods> --out <tmp目录>`；`--no-dump` 可复用上一次 dump。
> 源包与写出包都由 `cargo test --lib dump_ods_roundtrip` 跑产品真出口生成，不是手工拼的 XML。

## 口径（与 docx 往返账、与另一格式的账都不可并排比百分比）

- **ODF（`table-cell|style-name` 那一套）** 是另一套词表，与 xlsx 那本账的 key 不同源；两本账各自独立。
- 分母是**白名单部件里全部属性对**，不是「读手查问过的」：表格读手在 Rust，
  没有 TS 侧 attr/attrL 那样的统一漏斗可注入探针。这是整包普查。
- 进分母的部件：`content.xml`、`styles.xml`、`Object N/content.xml`（图表对象）。
  打包细节（`mimetype`、`META-INF/manifest.xml`）都不进分母——否则整份搬运会被算成 kept，那是假绿。
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
| 源包部件 / 写出包部件 | 2 / 2 |
| 分母对 | 14 |
| 保留 | **12（85.7%）** |
| 值变 | 2 |
| 掉了 | 0 |
| 缺件 | 0 |

分族：只按承载它们的部件分，不套 docx 的 `w:*` 正文 / 图形壳口径。
一个对若出现在多个部件，会在各部件各计一次，所以分族表的「读到」合计可能大于分母。

| 部件 | 读到 | 保留 | 值变 | 掉了 | 缺件 | 保留率 |
|---|---:|---:|---:|---:|---:|---:|
| `content.xml` | 13 | 11 | 2 | 0 | 0 | 84.6% |
| `styles.xml` | 3 | 2 | 1 | 0 | 0 | 66.7% |

### 掉了（0）

名字在写出包里一次都没出现。

| 对 | 源里出现 | 源值 | 写出值 | 口径 |
|---|---:|---|---|---|

### 值变（2）

名字在，但某个源值没写回去。

| 对 | 源里出现 | 源值 | 写出值 | 口径 |
|---|---:|---|---|---|
| `style|name` | 5 | co1, co2, default, ro1, ro2 | co1, default, ro1, ro2 | **已知口径**：孤儿列样式 co2：源包为超出实际列范围的 col_widths 生成了没人引用的样式 |
| `table-column-properties|column-width` | 2 | 2.1167cm, 3.1750cm | 3.1750cm | **已知口径**：同上；2.1167cm 属于那个孤儿样式，不承载实际列宽语义 |

### 缺件（0）

承载它的部件整个没写出来。

| 对 | 源里出现 | 源值 | 写出值 | 口径 |
|---|---:|---|---|---|

### 保留（12）

这些是真的往返稳定。

| 对 | 源里出现 | 源值 | 写出值 | 口径 |
|---|---:|---|---|---|
| `table-cell|value-type` | 8 | string | string | — |
| `style|family` | 5 | table-cell, table-column, table-row | table-cell, table-column, table-row | — |
| `table-column-properties|break-before` | 2 | auto | auto | — |
| `table-row-properties|break-before` | 2 | auto | auto | — |
| `table-row-properties|row-height` | 2 | 0.6350cm, 0.7938cm | 0.6350cm, 0.7938cm | — |
| `table-row-properties|use-optimal-row-height` | 2 | 0 | 0 | — |
| `table-row|style-name` | 2 | ro1, ro2 | ro1, ro2 | — |
| `document-content|version` | 1 | 1.2 | 1.2 | — |
| `document-styles|version` | 1 | 1.2 | 1.2 | — |
| `table-column|number-columns-repeated` | 1 | 1 | 1 | — |
| `table-column|style-name` | 1 | co1 | co1 | — |
| `table|name` | 1 | 账样 | 账样 | — |

## 边界

- **只做 ods 这一侧**：另一格式有独立账本（`sheet-roundtrip.md`），两套词表不混。
- **已知口径**（逐对诊断过，只标注、不改四档数字）：
  - `style|name`：孤儿列样式 co2：源包为超出实际列范围的 col_widths 生成了没人引用的样式。
  - `table-column-properties|column-width`：同上；2.1167cm 属于那个孤儿样式，不承载实际列宽语义。
  这些是源包里不承载语义的冗余写法，写出时自然消失；**所以这份账的百分比
  不能读成「ODS 比 xlsx 差」**——分母里混进了源包冗余，两本账分母不同源。
- 不是真件长尾：默认源包由产品自己写出，读手不认的属性根本不会出现在源里。
  给 `--src` 换成真实 .ods 才能量到「读手吃了多少」。
- 没有读手查问集合，无法区分「读手主动读了」与「整包搬过来」；
  白名单部件 + 剔除整份搬运通道是当前的保守折中。
- 账本正文不写日期、路径与时间戳：同一 rev、同一夹具复跑逐字节相同。
