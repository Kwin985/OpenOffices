# xlsx styles.xml 视觉语义保真 · 诊断与立项

> 触发：v0.210 真件回归，真实 xlsx 副本 R09 的属性级账 **33/103 = 32.0%**
> （夹具 65/65 100% 是「产品自写自出」的地板）。丢失集中在 `styles.xml`：
> 60 对只留 5 对。本文按「preserve / 读手 / 模型 / 包槽 / 写手」取证，给根因与方向。
> 取证基准 HEAD `e385e77`，rust_xlsxwriter 0.99.1。

## 一、根因：不是一个 bug，是三种不同性质的东西

把 70 对非 kept 按性质分三类，**只有第一类是"该修没修"**：

### 类 1 · 读手已建模、写手没接（真 bug，可修）

| 族 | 源值 → 写出 | 读手字段 | 断点 |
|---|---|---|---|
| `xf|fillId` / `fontId` / `borderId` / `numFmtId` | 0,10,11,12,13… → 塌成 0 | `CellStyle` 有 `cl/bg/bd/nf` | ~~写手只按 rgb 重建、主题色没读进来 ⇒ 索引塌缩~~ **【v0.217 更正】定性错误：被引用样式的 id 在往返中保真，红全是孤儿样式假红，见第八节** |
| `xf|applyAlignment` | 0,1 → 恒 1 | `ho/vo/wb` | crate 只在有对齐时才落 `applyAlignment`，源里显式的 0 保不住 |
| `patternFill|patternType` | gray125/none/solid → 少 solid | `StyleBook.fills` 只存一个颜色串 | patternType 没建模 |
| `sz|val` / `b|val` / 边框 double·medium | 11/13/15/18 → 11；double→thin | `fs/bl/bd` | 部分值在 `format_for()` 里被简化 |

### 类 2 · 第三方库架构限制（不可逐字节还原）

| 族 | 为什么不可修 |
|---|---|
| ~~`fgColor/bgColor/color|theme` + `|tint`~~ | **v0.214 更正：此条定性错误，theme 色其实可写回**。crate `Color::Theme(u8,u8)` 的 tint 常量与 Excel 源值**是同一个 double**（源 `0.399975585192419` vs crate `0.39997558519241921`，仅 15 位/17 位打印精度差）；穷举 R09 的 20 个 (theme,tint) 组合，**19 个**能精确映射到 crate 的离散 shade（如 color≥3 的 shade 1/2/3 = +0.8/+0.6/+0.4）。独立探针实证 `Color::Theme(4,3)` 写出 `theme="4" tint="0.39997558519241921"`。但要账面判 kept 还需账本对浮点做数值归一（字符串比对会判值变）。**本轮未落地产品改动**，原因见下一节：真件 R09 的 theme 色全在孤儿样式里，写代码零账面收益 |
| `charset|val` / `scheme|val` | crate 有 `set_font_charset` / `set_font_scheme`，但读手没建模、写手没接；接了也只是"写出同一个枚举值"，可修，但属类 1 的延伸 |
| `cellStyle|name/builtinId/xfId`（49 个本地化样式名） | crate `styles.rs:765-797` **只写死 Normal + Hyperlink，无公共写 API** |
| `tableStyle*` / `tableStyleElement*`（10 个表格样式） | crate 完全没有 tableStyle 写 API |
| `numFmt|formatCode/numFmtId`（41–44 会计格式） | 读侧 `builtin_numfmt` 表没覆盖这几个内置 id |
| `feature|name` / `ext|uri` / `slicerStyles` / `styleSheet|Ignorable` | x14 扩展与打包细节，模型无承载位 |

### 类 3 · 白名单普查口径放大 + 孤儿样式（假红）

分母是「白名单部件里**全部属性对**」——不是「读手查问过的」。Excel 亲笔样式表里
大量 `xf|applyProtection=0`、`applyNumberFormat=0`、`*_count` 这类**声明性/冗余**
属性，读手不需要、写手也不会发，但它们全进分母被判 lost。这与 docx 保真账的
「默认属性进分母」是同一口径现象（v0.203 的 70.1%→18.5%）。

**v0.212 补证：rgb 色族也是假红，不是读手漏读。** 逐节统计 R09 的 styles.xml：

| 节 | rgb | theme | 谁在用 |
|---|---:|---:|---|
| `fonts` | 12 | 8 | 字体定义 |
| `fills` | 7 | 24 | 填充定义 |
| `borders` | 17 | 4 | 边框定义 |
| `dxfs` | 0 | 43 | 条件格式（全 theme） |
| `cellXfs` / `cellStyleXfs` | 0 / 0 | 0 / 0 | 只是引用上面各表 |

真件有 **49 个 `cellStyleXfs`（本地化命名样式）+ 7 个 `cellXfs`，但单元格只引用
`s=1..6`**。写手只重建「实际被单元格引用的样式」，其余 49 个命名样式连同它们带的
29 个 `color|rgb`、7 个 `fgColor|rgb` 是**孤儿定义**——没有任何格子会用到，写出包
自然没有。这与 v0.202 ODS 的孤儿列样式 `co2` 完全同族，**不是架构限制也不是读手 bug**。

上一轮把 `fgColor|rgb` 定性成「dxf 前景色、dxf 没接」是错的：真件 `dxfs` 节 rgb 恰为 0，
那 7 个全在 `fills`。本轮已改正 CAVEATS 措辞。教训：**定性前先数清族在哪些节，
别凭属性名猜上下文**。

## 二、为什么不能整份搬运 styles.xml（(a) 方向不可行）

`xlsx_preserve` 只搬**读侧不认的侧通道部件**（表格 / 图片 / 透视 / 切片器 / 连接 / 查询表），
styles.xml 是读手消费的正向部件，压根不在搬运白名单。更重要的是**搬了必错位**：

- 源件 R09：`fonts=32, fills=42, borders=21, cellXfs=7, cellStyleXfs=49`
- 写出包：`fonts=1, fills=2, borders=5, cellXfs=6, cellStyleXfs=1`
- crate 的 `format_xf_index()`（`workbook.rs:2937`）按 Format 哈希**按写入顺序**重排索引；
  单元格 `s=` 因此从 `1,2,3,4,5,6` 变成 `1,2,3,4,5`。
- 读侧 `xlsx_style.rs:428` 一读到 `s=` 就解析成 `CellStyle`，**原始下标被丢弃**，
  没有从源索引到新索引的映射可用。

所以整份搬 styles.xml 会让它描述的表与新包里 cells 的 `s=` 指向完全不同的样式——
**视觉全乱，比现在更糟**。要保持必须连模型带写手重写索引分配，≥3 文件数百行。

## 三、方向判断

| 方向 | 判断 | 理由 |
|---|---|---|
| (a) 整份搬 styles.xml + 保住 s= | **否** | 上面第二节；错位风险最高 |
| (b) 补读 theme/tint/charset + 写手换 `Color::Theme` | **部分不可行** | tint 任意浮点写不回（类 2）；charset/scheme 可接但只触到 40 对；cellStyle/tableStyle 无 API。改动面 ≥3 文件 50–80 行 + 载荷 schema 变更，需重签五本账基线 |
| (c) 只诊断 + 口径分档 | **本轮已做** | CAVEATS 登记类 2/3 的族，账本自带解释；数字不变、基线不动 |

## 四、本轮实际交付（v0.211）

1. `scripts/sheet-roundtrip.mjs` 的 `CAVEATS.xlsx` 登记 25 族架构限制，真件账的
   掉了/值变表与边界段自带逐族解释；夹具账因这些对是 kept 而不受影响，
   md5 仍是 `0fd13292…`/`0e3e3f42…`。
2. 修了 CAVEATS 渲染的一处误标：原逻辑给所有同名对挂标注，会把夹具里 kept 的
   `cellStyle|name=normal` 标成"架构限制"；改为只给非 kept 的对挂。
3. 本文把根因、不可行方向、可行子集钉死，避免下一轮重复调研。

## 五、v0.214 立项复核：先做"谁在用"，别急着写修复

本轮试图落地 theme 色读写闭环（读侧建模 theme+tint → 写侧 `Color::Theme` →
账本浮点归一），**做完又全部回退**，因为数据推翻了立项前提：

**① theme 色可写回（更正 v0.211）**：穷举 R09 的 20 个 (theme,tint) 组合，
19 个能被 crate 的离散 shade 精确写出；独立探针实证 `Color::Theme(4,3)` 写出
`theme="4" tint="0.39997558519241921"`——与源 `0.399975585192419` 是同一个 double。
代码路径本身可行（读侧 `fill_themes`/`cl_theme` + 写侧 theme 优先 + `has_any`
纳入 theme 字段，都已实现并验证读手能读到）。

**② 但这些 theme 色在这份真件里全是孤儿样式，写回零收益**：
- R09 的 24 个 theme fill、字体 theme 色，都挂在 49 个命名样式（`cellStyleXfs`）上；
- 实际被单元格引用的 `cellXfs[1..6]` 的 `fillId/fontId` **全是 0**——格子只用边框与对齐；
- 所以写手重建时这些 theme 色根本不会出现在写出包，账面数字从 33/103 到 33/103
  没变（只值变/掉了互换一对）。**改代码救不回一个没人用的样式**。

**③ 合成件验证还撞上另一个独立问题**：造了 theme 色被单元格实际引用的合成件，
`read_xlsx_sync` 返回的 `cells_with_style=0`。**【v0.215 更正】** 上一轮归因成
"sheet 名匹配失败"是错的：两件的 `workbook.xml`/rels 完全一样（都是 Sheet1/rId1）；
真件 R09 有 48 个 styled_cells，账本可信。真因是**产品码不建模 theme 色，
`has_any()` 把只有主题色的样式过滤掉**——是真产品缺口，不是量具 bug。

**结论与下一轮立项**：
1. **不要为了这份真件的 32% 去写 theme 色修复**——它的 theme 族是假红，
   写回也进不了账。这再次印证"百分比低 ≠ 该修"。
2. 真正值得做的是用一个 theme 色真正参与往返的合成件验证读写闭环。
3. 类 1 的 s= 索引丢失仍是根，但**只有在样式真被引用时**才有意义。
4. v0.214 本轮产品代码零改动、五本账基线全不动。

## 六、v0.215 落地：theme 色读写闭环（合成件验证）

**v0.214 的"下一轮立项"已在本轮完成**：重落 theme 建模，用自包含的 Rust
单元测试（`xlsx::tests::theme_color_roundtrip`）钉住——

- **测试夹具**：crate 自己写一份「A1 用 theme=4 shade=3 填充 + theme=1 shade=2 字体」
  的源件（主题色被单元格实际引用），走产品读手 → 写手 → 读写出包 styles.xml。
- **断言**：读手读到 `bg_theme=Some((4,3))`、`cl_theme=Some((1,2))`；写出包含
  `theme="4"`、`tint="0.39997558519241921"`、`theme="1"`。测试通过。
- **实现**：读侧 `FontInfo.cl_theme` + `StyleBook.fill_themes` + `theme_shade()` 反推
  （15/17 位同一 double、1e-9 容差）+ `style_for` 传递；写侧 `format_for` 里
  `Color::Theme` 优先；`has_any()` 纳入两个 theme 字段（这是 v0.214 漏掉、导致
  合成件 styled_cells=0 的关键）；前端 `fs.ts` interface 同步（**【v0.216 更正】**
  此处说"Univer 无主题色槽"是错的——实际有 `th` 槽，详见第七节；但接显示会破坏
  存盘保真的 tint，故判死不做，界面显示仍是未接边界）。

**账本影响**：夹具账 md5 **完全不变**（`0fd13292…`，65/65）——夹具是产品自写自出、
没有 theme 色；真件账仍 33/103=32%（theme 是孤儿样式，写回进不了账）；五本账
md5 全基线、表格变异腿各 12/12。**无需重签任何账本**。

**价值**：修的是真产品缺口——用户打开主题色填充的表格，此前样式被 `has_any()`
过滤掉、屏上和存盘都丢；现在能读进载荷、写回保真。与真件账数字无关。

## 边界

- 只有 1 份真 xlsx、单一来源，本文的族分布不代表 xlsx 文件的总体。
- 未做真机 Excel 打开写出包的视觉对撞——账面丢 70 对不等于屏上一定看得出差别，
  特别是类 3 的声明性属性。
- 六条旧诚实边界（宏沙箱 / 协同鉴权 / PDF 改字形变等）一条未动。

## 七、v0.216 屏上显示主题色：查明并判死（不做）

v0.215 落地了存盘保真后，剩一个问题：用户打开主题色表格，屏上能不能显示正确颜色？
此前我说"Univer 无主题色槽"——**这是错的，没查 d.ts 就下了结论**。本轮查证后判死。

### 事实（Univer 0.25.1，从 npm 包 d.ts 取证）

- `IColorStyle` **确实有主题色槽**：`th?: ThemeColorType`（定义于
  `packages/core/.../i-style-data.d.ts`，本地 `node_modules/@univerjs/presets/lib/umd/index.js`
  bundle 里也能找到 `ThemeColorType` 枚举、`Lo=[rgb,th]` 验证器）。
- `ThemeColorType` 枚举值与 Excel/OOXML 主题色索引**完全一致**：
  `DARK1=0, LIGHT1=1, DARK2=2, LIGHT2=3, ACCENT1=4 … ACCENT6=9,
  HYPERLINK=10, FOLLOWED_HYPERLINK=11`。

### 为什么仍然判死（三条硬约束）

1. **`IColorStyle` 无 tint 槽**：定义只有 `rgb` + `th`，注释写的是
   "RGB color **or** theme color"——两者互斥。Excel 主题色的明暗档
   （tint 0.4/0.6/0.8 等）在 Univer 里**无处安放**。
2. **style 对象是强 schema**：`STYLE_KEYS` 精确列出允许字段，没有 index signature。
   想在 style 里藏原始 `(theme, tint)` 做回写保真的方案不成立——自定义字段不会被透传。
3. **屏上回写会破坏 v0.215 的存盘保真**：接 `th` 后，用户编辑别的格子再保存，
   `workbookToPayload → flattenStyle` 只能读回 `th`（无 tint），tint 被抹掉——
   这正是 v0.199 教训「屏上值回写 = 把换算误差写成源件的话」的场景。

另外，Univer 默认主题配色（primary/gray 系）与 Excel Office 主题
（ACCENT1-6）方案不同，即使接 `th` 显示，颜色也未必与 Excel 一致。

### 结论

**不接屏上主题色显示**，保持"存盘保真、屏上暂不显示"的当前状态。
这是有据的判死（同 v0.205 Calc 缩放：查实 API 限制后明确移出清单），
不是无限顺延。若将来 Univer 支持主题色 + tint 且配色可对齐，再重新评估。
产品代码零改动、账本零改动。

## 八、v0.217 类 1 的 s= 索引：决定性对照实验——语义保真，红是孤儿假红

用户点名 ① xlsx styles 类 1（s= 索引丢失）为下一优先级。本轮用合成件做
**决定性对照**，一次性定性，不再反复。

### 实验设计

真件 R09 里被 `s=1..6` 实际引用的 cellXfs，`fillId/fontId/numFmtId` **全是 0**，
只有 borderId 是 1-4。账本 `xf|fillId` 源值 `2,3,4…32`、`xf|fontId` 的 `1…19`、
`xf|numFmtId` 的 `9,41-44`——全在**未被任何单元格引用的孤儿样式**（49 个
cellStyleXfs 命名样式 + 未用的 cellXfs）里。所以"塌缩 56 对"很可能是孤儿假红。

为排除"单一真件否定一类能力"的风险，造了一个**每个样式都被引用、且 id 全非0**
的合成件（s=1..5：fillId=2..6、fontId=0..4、numFmtId=164..168、borderId=1），
走产品读手 → 写手往返。

### 结果：语义完全保真

- 读手 `style_for(1..5)` 全部读到完整 CellStyle：bg 颜色、粗/斜/字号、numfmt、border 都在；
  `parse_sheet` 拿到 5 个带样式 cell。
- 写手往返后，写出包 `cellXfs[1..5]` 的 fillId=2..6、numFmtId=164..168、borderId=1
  全部保留，单元格 `s=1..5` 引用不变（fontId 差 1 是 crate 默认字体偏移，语义等价）。

**结论：s= 索引链不是 bug。** `parse_sheet` 把 `s=` 解析成 CellStyle（语义载体），
写手用 CellStyle 重建样式表、重新分配索引并同步改写单元格 `s=`——索引数字变了没关系，
语义等价就是保真。所谓"索引丢失"只是读侧不保留原始 xf 数字，而这个数字**写手本来
就不该复用**（crate 按 Format 哈希重排，复用源索引反而会错位）。

### 定性更正

- 类 1 首行 "`xf|fillId/fontId/...` 塌缩 = 写手没接" **定性错误**：
  被引用样式的这些 id 在往返中保真；账本的红全是孤儿样式假红（同 v0.212 rgb、v0.214 theme）。
- v0.211 立的"先解决索引丢失、写手按源顺序重建"这条立项**方向错误**，应撤销：
  没有"源索引到新索引映射"的需求，因为写手同步改写 `s=` 即可。
- 这一族红应从"真 bug"重分类为**口径假红**：账本对 styles.xml 全表普查，把
  未被单元格引用的孤儿 cellXfs/cellStyleXfs 属性算进分母。与 v0.202 ODS co2 同族。

### 落地

- 自包含 Rust 单测 `referenced_xf_indexes_keep_semantics` 钉住"被引用样式语义保真"
  （crate 造合成件 → 读手 → 写手 → 断言 fill/numfmt/border 非0值保留），不依赖未入库文件。
- 产品代码零改动、五本账零改动——**无需"修"一个不存在的问题**。
- 这轮的价值：用对照实验撤销了一条错误的立项方向，避免下一轮对着孤儿样式写产品码。
