# ODS 合并区的格位账（v0.221）

> 一句话：ODF 的格位是按**格元素在行内的次序**算的，不是坐标。`table:number-columns-spanned`
> 只说明「锚点这一格横跨几列」，被它盖住的那些列**必须各有自己的 `table:covered-table-cell`
> 占位**。少了这一段，同一行右边所有内容在文件里就整体左移。

## 1. 旧行为与后果

`src-tauri/src/ods.rs` 的写侧在合并区起点写完锚点就直接 `c = m.end_column + 1` 跳过被盖住
的列——**一枚 covered 格都不发**（跨行合并的下方行会走到 `covered` 分支，那一支一直在，
所以只有锚点自己那一行是坏的）。

A1:C1 合并 + D1「右侧」写出来的行：

```xml
<table:table-row>
  <table:table-cell office:value-type="string"
      table:number-columns-spanned="3" table:number-rows-spanned="1"><text:p>合并</text:p></table:table-cell>
  <table:table-cell office:value-type="string"><text:p>右侧</text:p></table:table-cell>
</table:table-row>
```

行内只有两枚格：锚点之后紧跟的那一枚，在按次序定位的读手眼里就是第 2 列。用本产品的读手
读回来，「右侧」确实落在 `(0,1)`（观测原样）：

```
PROBE CELL r=0 c=0 v=Some(String("合并"))
PROBE CELL r=0 c=1 v=Some(String("右侧"))   ← 源件是 D1
```

影响面是**「合并区右边还有内容」的每一个行**。标题横跨首行那种排法不受影响（那一行只有
锚点），但表格里横跨若干列的「备注 / 合计」块右边还排了字时，那几格整体左移，落在别人的
位置或直接落进合并区。

第三方读手是否会同样错位：ODS 的格位本来就只能按次序推（没有坐标属性），本产品读手的表现
是可实测的那一份证据；LibreOffice / Excel 这一档**本轮没有实测**，按同一定位方式推断，不写成结论。

## 2. 修法

**写侧**：锚点之后按 `col_span - 1` 补一枚带 `number-columns-repeated` 的 covered 格。

**读侧**：两遍扫描（`read_ods_styles` 管样式/合并/公式，`read_ods_cell_side` 管批注/链接）
原来对「锚点占几列」的假设正好相反——第一遍是「锚点占 1 列，横跨的列由后续 covered 格逐枚
抵掉」，第二遍是 `col += repeat * spanned`（锚点自己吃掉整个跨度）。两边不可能同时对：

| 文件形状 | 第一遍（`+repeat`） | 第二遍（`+repeat*spanned`） |
|---|---|---|
| 带 covered 格（我们自己写、LibreOffice 写） | 对 | 右移 `spanned - 1` 列 |
| 省掉 covered 格（有的生成器只发锚点） | 左移 `spanned - 1` 列 | 对 |

统一成一份「欠账」记账（`pending_cover`）：锚点只前进 `repeat` 列，`spanned - 1` 记成欠账；
每遇到一枚 covered 格抵掉 `repeat`；**来了一枚正常格而欠账还没抵完**，说明这一份省了占位格，
就把剩下的欠账直接补进列位再落这一格。两种形状于是都对。

## 3. 守卫（都验过能红）

| 测试 | 盯什么 | 撤掉修复后红在哪 |
|---|---|---|
| `ods_merged_region_keeps_later_cells_in_place` | 写侧占位格 + 值/合并区/样式/批注四处格位 | 撤写侧补发 → 「占位格 0 ≠ 1」 |
| 同上（第二段断言） | 第二遍扫描的列位 | 退回 `col += repeat * spanned` → 「批注 (0,3) ≠ (0,2)」 |
| `ods_missing_covered_cells_still_advance` | 外来件省掉 covered 格时的兜底 | 撤兜底 → 「D1 样式读回」失败 |

合成件是 crate 自造的那份工作簿（A1:B3 三行两列合并 + C1 带底色与批注 + A4 内容），
不依赖任何外部文件。

## 4. 账本为什么一位不动

ODS 属性级往返账 **14/14（100%）**、md5 `6f9b676f` / `b73aacb8` 与基线逐字节一致——
因为那份夹具里没有合并区，写出的包本来就不含这一族。

这也说明一件事：**族级账本看不见格位错**。合并区缺占位格时，"属性|值"的集合一枚不少
（`number-columns-spanned` 还在、`style-name` 还在），错的是"这一格属于第几列"。
与 v0.220 那条「合并区非锚点格拿了锚点样式」是同一类盲区——只有逐格对撞才看得见。
往后凡是动格位/行列归属的改动，都要另配一条按格序的断言，不能只看账本分数。

## 5. 顺延

写侧的 covered 格仍然**不带 `table:style-name`**，读侧 `read_ods_styles` 也**不读**
covered 格上的样式（`if !covered { … }`）。两头是对称的，所以往返不额外丢东西；但要补，
得先回答「被盖住那一格的样式在 ODF 渲染里看不看得见」——这需要真 `.ods` 或一个 ODF 渲染器，
本机两样都没有，本轮不动手（v0.220 的 xlsx 那一版有真件可证，23 格是实测数）。

另一条：`read_ods_cell_side` 对「落在 covered 格上的批注/链接」是**记账不收**（位置说不准）。
带占位格之后这类格的位置其实能算出来，但那是另一条口径，动它要先定「批量外来件里这类格
到底该归谁」，不在本轮范围。
