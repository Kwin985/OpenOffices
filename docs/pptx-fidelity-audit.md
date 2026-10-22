# PPTX 属性覆盖账：35 对「未查问」逐枚裁定

`docs/pptx-fidelity.md` 只说「这 35 对没被读手按名问过」，不说**该不该问**。这份审计逐枚回
`src/lib/pptx-import.ts`（读手，723 行）与 `src/lib/ppt.ts`（模型）裁一遍，把它们分成两类：

- **真丢账**：文件里说了、模型有地方可放（或该有）、不加就等于丢信息 —— 12 对 / 28 字面
- **裁定不读**：流水号、内部记账、锁定标志、主题命名，或模型按别的口径已表达了同一件事 —— 23 对 / 57 字面

口径与 docx 那头一致：**分母**是夹具里真实存在的元素|属性字面对（77 对 / 217 字面），**分子**是
`pptxBytesToDeck` 那一趟里 `ga()` 被问到过的对。裁定不读的 23 对**仍然是账上的洞**，只是这个洞是
有意的；真丢账的 12 对是可开工的清单。

> ⚠️ **这批数是夹具宇宙**（盘上没有 pptx 真件语料，`scripts/fidelity-report-pptx.mjs` 头部已如实标注并
> 留 `--corpus` 口子）。下面「字面」一列只在夹具内成立，不能当成真件里的权重；按对（12 : 23）这一档
> 与语料无关，可以引用。

## 一、真丢账（12 对 / 28 字面）

| `element|attribute` | 字面 | 文件里说的意思 | 读手现状 | 模型槽 | 后果 |
|---|---:|---|---|---|---|
| `cNvPr|name` | 9 | 形状名（选择窗格、动画目标、辅助技术都用它） | `spidOf` 只取 `cNvPr@id`（:385），`name` 一次不问 | `SlideShape.id` 是 `newId()` 现编的 | 往返后形状名全变成 `s-xxxx`，选择窗格里认不出 |
| `cTn|dur` | 5 | 单条动画时长（毫秒） | 动画只读 `presetClass`/`presetSubtype`/`animEffect@filter`/`spTgt@spid`（:380–470），不碰 `cTn@dur` | `SlideShape.anim` 只有效果与方向，无时长 | 导入的动画统一按导出默认时长播，节奏与原稿不同 |
| `bodyPr|anchor` | 2 | 文本在框内垂直锚点（`t/ctr/b`） | 读手整族不读 `bodyPr`（0 处查问） | 无垂直对齐槽 | 顶对齐的标题框在居中框里会跑到中间，屏上直接看得见 |
| `bodyPr|wrap` | 1 | `wrap="none"` = 文本不换行、溢出框外 | 同上，不读 | 无换行策略槽 | 「一行到底」的标签被折成多行 |
| `gridCol|w` | 2 | 表格列宽（EMU） | 表格只取行列文本与 `firstRow`（:556–566） | `SlideTableData` 只有 `rows`/`hasHeader` | 导入的表格按等分列宽排，原稿的列宽比丢了 |
| `tr|h` | 2 | 表格行高（EMU） | 同上 | 同上 | 行高按内容自适应，压扁或撑高 |
| `latin|typeface` | 2 | 主题字族（major/minor 的拉丁面） | `colorScheme` 只把 `clrScheme` 折成十六进制（:182–194），`fontScheme` 一次不读 | `DeckTheme` 只有配色，无字族 | 换机器/换主题后字体回落，版式行宽会变 |
| `rPr|i` | 1 | 斜体 | `shapeStyleOf` 只认 `sz`/`b`/`solidFill`/`algn`（:100–110） | 只有 `bold` | 斜体文字导入后变正体，往返丢格式 |
| `rPr|u` | 1 | 下划线 | 同上 | 无下划线槽 | 下划线文字导入后丢线，往返丢格式 |
| `cNvPr|descr` | 1 | 替代文本（无障碍） | 与 `name` 同处，不问 | 无 alt 槽 | 屏幕阅读器拿不到图说，导出也不写回 |
| `transition|advClick` | 1 | 该页是否点击换页（`0` = 不响应点击） | `parseTransition` 读效果名与 `advTm`（:344–352），不读 `advClick` | `Slide.autoAdvance` 只有自动换页秒数 | `advClick="0"` 且无 `advTm` 的页会变回「点击就翻」 |
| `tblPr|bandRow` | 1 | 表格隔行底纹标志 | 表格属性只问 `firstRow`（:566） | `hasHeader` 一个布尔 | 隔行底纹的表导入后不带这个标志，往返丢 |

**这 12 对里，四对会直接改屏上观感**：`bodyPr|anchor`（垂直锚点）、`rPr|i`/`rPr|u`（斜体/下划线）、
`latin|typeface`（字族）；其余八对是往返保真度（名字/替代文本/列宽行高/动画时长/换行/翻页/隔行标志）。

## 二、裁定不读（23 对 / 57 字面）

| 族 | 对 | 字面 | 为什么不读 |
|---|---|---:|---|
| 动画时间轴内部 | `cTn|id`、`cTn|grpId`、`cTn|restart`、`cTn|fill`、`cTn|presetID`、`cond|delay`、`seq|concurrent`、`seq|nextAc`、`bldP|build`、`bldP|grpId`、`strVal|val` | 34 | 模型把动画表达成「揭示序 + 效果 + 方向」（`anim`/`animDir`），按 `spid` 认人、按 `presetClass` 分入场/退场。时间轴（并发分支、下一动作、延迟、重启、冻结）**整层不进模型**：不是读不到，是不打算表达。`cTn|id` 11 枚是这族最大的一笔，它只是 timing 树的内部流水号 |
| 锁定标志 | `spLocks|noGrp`、`graphicFrameLocks|noGrp` | 2 | 锁只影响编辑器里能不能拖动/组合，不参与渲染，写侧也不重建 |
| 主题/方案的命名 | `theme|name`、`clrScheme|name`、`fontScheme|name` | 3 | 名字不参与呈现；配色按 `srgbClr@val` 实值读，字族见上面 `latin|typeface`（那一枚是真丢账，名字不是） |
| 系统色名 | `sysClr|val` | 2 | `sysClr` 由 `val`（系统色名，如 `windowText`）+ `lastClr`（实值）两枚组成，读手取实值（:190、:206）⇒ 同一件事已表达 |
| drawing 分派与线帽 | `graphicData|uri`、`ln|cap` | 2 | `uri` 是内容类型标签，读手按子元素（`tbl`/`blip`/`c:chart`）分派，不看标签；线帽只影响描边端点，模型只有色与宽（`outline`/`outlineW`） |
| 保存会话记账 | `rPr|dirty`、`rPr|lang` | 2 | `dirty` 是「这层改过」的脏标记；`lang` 是拼写检查语言，都不进呈现 |
| 过渡速度 | `transition|spd` | 1 | 效果名已建模（`transition`），速度档在导出侧固定，模型无槽也不打算加 |
| 占位符序号 | `ph|idx` | 4 | 版式按 `ph@type` 映射（`phType`，:88–91）；`idx` 只在**同一页有多个同型占位符**时区分彼此，而本产品的版式模型是「一页一种版式」——这个区分无处可落 |

## 三、这份审计不回答什么

- **字面权重**：夹具是我按 schema 造的，`tr|h` 在真件里可能是每页几十枚，在夹具里只有 2 枚。要谈
  「先修哪一枚最划算」，得先有真件 pptx 语料（`--corpus` 那个口子）。
- **修哪一枚**：`rPr|i`/`rPr|u` 是 1 枚字面的小洞，却是屏上直接看得见的格式丢失；`cTn|id` 是 11 枚
  字面的大洞，却按设计不该读。**按字面量排序会把这两类搞反**，所以本表按「该不该读」分档、不按字面量排序。
- **写侧**：审计只裁读侧。上面 12 对真丢账里，写侧（`pptx-export.ts`）同样没有对应输出——补读侧时要
  同时看写侧，否则导入进来也存不回去。
