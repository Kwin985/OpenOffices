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
| `xf|fillId` / `fontId` / `borderId` / `numFmtId` | 0,10,11,12,13… → 塌成 0 | `CellStyle` 有 `cl/bg/bd/nf` | 写手 `format_for()` 只按读到的 rgb 语义重建 Format；填充主题色等没读进来 ⇒ 索引塌缩 |
| `xf|applyAlignment` | 0,1 → 恒 1 | `ho/vo/wb` | crate 只在有对齐时才落 `applyAlignment`，源里显式的 0 保不住 |
| `patternFill|patternType` | gray125/none/solid → 少 solid | `StyleBook.fills` 只存一个颜色串 | patternType 没建模 |
| `sz|val` / `b|val` / 边框 double·medium | 11/13/15/18 → 11；double→thin | `fs/bl/bd` | 部分值在 `format_for()` 里被简化 |

### 类 2 · 第三方库架构限制（不可逐字节还原）

| 族 | 为什么不可修 |
|---|---|
| `fgColor/bgColor/color|theme` + `|tint` | crate `Color::Theme(u8, u8)` 的 shade 是**离散 0–5**，`attributes()` 写回它自己硬编码的 tint 常量（如 `-0.34998626667073579`）；Excel 源件是任意浮点（如 `0.399975585192419`）。换 Theme 会写出**不同的数字**，账照判值变，甚至把原本 kept 的主题色写漂流 |
| `charset|val` / `scheme|val` | crate 有 `set_font_charset` / `set_font_scheme`，但读手没建模、写手没接；接了也只是"写出同一个枚举值"，可修，但属类 1 的延伸 |
| `cellStyle|name/builtinId/xfId`（49 个本地化样式名） | crate `styles.rs:765-797` **只写死 Normal + Hyperlink，无公共写 API** |
| `tableStyle*` / `tableStyleElement*`（10 个表格样式） | crate 完全没有 tableStyle 写 API |
| `numFmt|formatCode/numFmtId`（41–44 会计格式） | 读侧 `builtin_numfmt` 表没覆盖这几个内置 id |
| `feature|name` / `ext|uri` / `slicerStyles` / `styleSheet|Ignorable` | x14 扩展与打包细节，模型无承载位 |

### 类 3 · 白名单普查口径放大（假红）

分母是「白名单部件里**全部属性对**」——不是「读手查问过的」。Excel 亲笔样式表里
大量 `xf|applyProtection=0`、`applyNumberFormat=0`、`*_count` 这类**声明性/冗余**
属性，读手不需要、写手也不会发，但它们全进分母被判 lost。这与 docx 保真账的
「默认属性进分母」是同一口径现象（v0.203 的 70.1%→18.5%）。

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

## 五、下一轮若要做类 1 的修复（立项建议）

**目标**：把 `xf|fillId/fontId/borderId/numFmtId` 的塌缩从 56 次降到可解释范围。

**前提**：先解决"索引丢失"——`xlsx_style.rs` 读 `s=` 时把源 `xf` 下标存进
`CellStyle`（新增一个可选字段），写手按"尽量复用同一套样式表"的顺序构造 Format，
而不是每个格子新建。这是类 1 的**根**，其余族都是叶。

**代价**：载荷 schema 变更 ⇒ 夹具账 md5、`roundtrip-mut.mjs` 的 `expectKept=65`、
五本账 provenance 都要重签；且要有 docx/pptx 账零影响的对照证据。
**不属于"顺手修"，独立成轮。**

## 边界

- 只有 1 份真 xlsx、单一来源，本文的族分布不代表 xlsx 文件的总体。
- 未做真机 Excel 打开写出包的视觉对撞——账面丢 70 对不等于屏上一定看得出差别，
  特别是类 3 的声明性属性。
- 六条旧诚实边界（宏沙箱 / 协同鉴权 / PDF 改字形变等）一条未动。
