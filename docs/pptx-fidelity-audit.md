# PPTX 属性覆盖账：35 对「未查问」逐枚裁定

`docs/pptx-fidelity.md` 只说「这 35 对没被读手按名问过」，不说**该不该问**。这份审计逐枚回
`src/lib/pptx-import.ts`（读手）与 `src/lib/ppt.ts`（模型）裁一遍，把它们分成两类：

- **真丢账**：文件里说了、模型有地方可放（或该有）、不加就等于丢信息 —— 12 对 / 28 字面
- **裁定不读**：流水号、内部记账、锁定标志、主题命名，或模型按别的口径已表达了同一件事 —— 23 对 / 57 字面

口径与 docx 那头一致：**分母**是夹具里真实存在的元素|属性字面对（77 对 / 217 字面），**分子**是
`pptxBytesToDeck` 那一趟里 `ga()` 被问到过的对。裁定不读的 23 对**仍然是账上的洞**，只是这个洞是
有意的；真丢账的 12 对是可开工的清单。

> ⚠️ **这批数是夹具宇宙**（盘上没有 pptx 真件语料，`scripts/fidelity-report-pptx.mjs` 头部已如实标注并
> 留 `--corpus` 口子）。下面「字面」一列只在夹具内成立，不能当成真件里的权重；按对（12 : 23）这一档
> 与语料无关，可以引用。

## 一、真丢账（12 对）——v0.140 已补，读写两侧 + 屏上观感

裁定时的原账（夹具 217 字面那一版）：

| `element|attribute` | 字面 | 文件里说的意思 | 读手现状 | 模型槽 | 后果 |
|---|---:|---|---|---|---|
| `cNvPr|name` | 9 | 形状名（选择窗格、动画目标、辅助技术都用它） | `spidOf` 只取 `cNvPr@id`，`name` 一次不问 | `SlideShape.id` 是 `newId()` 现编的 | 往返后形状名全变成 `s-xxxx`，选择窗格里认不出 |
| `cTn|dur` | 5 | 单条动画时长（毫秒） | 动画只读 `presetClass`/`presetSubtype`/`animEffect@filter`/`spTgt@spid`，不碰 `cTn@dur` | `SlideShape.anim` 只有效果与方向，无时长 | 导入的动画统一按导出默认时长播，节奏与原稿不同 |
| `bodyPr|anchor` | 2 | 文本在框内垂直锚点（`t/ctr/b`） | 读手整族不读 `bodyPr`（0 处查问） | 无垂直对齐槽 | 顶对齐的标题框在居中框里会跑到中间，屏上直接看得见 |
| `bodyPr|wrap` | 1 | `wrap="none"` = 文本不换行、溢出框外 | 同上，不读 | 无换行策略槽 | 「一行到底」的标签被折成多行 |
| `gridCol|w` | 2 | 表格列宽（EMU） | 表格只取行列文本与 `firstRow` | `SlideTableData` 只有 `rows`/`hasHeader` | 导入的表格按等分列宽排，原稿的列宽比丢了 |
| `tr|h` | 2 | 表格行高（EMU） | 同上 | 同上 | 行高按内容自适应，压扁或撑高 |
| `latin|typeface` | 2 | 主题字族（major/minor 的拉丁面） | `colorScheme` 只把 `clrScheme` 折成十六进制，`fontScheme` 一次不读 | `DeckTheme` 只有配色，无字族 | 换机器/换主题后字体回落，版式行宽会变 |
| `rPr|i` | 1 | 斜体 | `shapeStyleOf` 只认 `sz`/`b`/`solidFill`/`algn` | 只有 `bold` | 斜体文字导入后变正体，往返丢格式 |
| `rPr|u` | 1 | 下划线 | 同上 | 无下划线槽 | 下划线文字导入后丢线，往返丢格式 |
| `cNvPr|descr` | 1 | 替代文本（无障碍） | 与 `name` 同处，不问 | 无 alt 槽 | 屏幕阅读器拿不到图说，导出也不写回 |
| `transition|advClick` | 1 | 该页是否点击换页（`0` = 不响应点击） | `parseTransition` 读效果名与 `advTm`，不读 `advClick` | `Slide.autoAdvance` 只有自动换页秒数 | `advClick="0"` 且无 `advTm` 的页会变回「点击就翻」 |
| `tblPr|bandRow` | 1 | 表格隔行底纹标志 | 表格属性只问 `firstRow` | `hasHeader` 一个布尔 | 隔行底纹的表导入后不带这个标志，往返丢 |

**这 12 对里，四对会直接改屏上观感**：`bodyPr|anchor`（垂直锚点）、`rPr|i`/`rPr|u`（斜体/下划线）、
`latin|typeface`（字族）；其余八对是往返保真度（名字/替代文本/列宽行高/动画时长/换行/翻页/隔行标志）。

### v0.140 的补法（提交 `5413253`）

读侧全部走既有的 `ga()` 漏斗（覆盖账自动记分子）；模型槽与渲染/导出同步加：

| 对 | 模型槽 | 屏上渲染 | 导出 |
|---|---|---|---|
| `rPr|i` / `rPr|u` | `SlideShape.italic` / `underline` | `font-style` / `text-decoration`（StaticSlide 与编辑器画布同一份） | pptxgenjs `italic` / `underline:{style:'sng'}`（点线/双线降级成单线，模型只有一枚布尔） |
| `bodyPr|anchor` | `SlideShape.anchor`（top/middle/bottom） | 弹性盒 `justify-content`（块内文本没有 CSS 垂直对齐） | `valign` |
| `latin|typeface` | `MasterStyle.majorFont` / `minorFont` | 形状文本随字族 | `pptx.theme` 的 `headFontFace`/`bodyFontFace` → theme1.xml 的 fontScheme |
| `cNvPr|name` | `SlideShape.name` | （不进画布） | 页内唯一时直接当 objectName——选择窗格里就是导入时的那个名；重名退回 `ooShapeN`（反查会认错人，宁可丢名字） |
| `cNvPr|descr` | `SlideShape.alt` | 图片 `alt` 属性 | image/chart 走原生 `altText`；文本/表格 pptxgenjs 不写，走解包注入 |
| `gridCol|w` / `tr|h` | `SlideTableData.colW` / `rowH`（**相对总和的分数**，和归一） | `<colgroup>` / `<tr>` 百分比 | 按表框实宽高折算回英寸（按和归一，手改过的 .opd 也翻得回来） |
| `tblPr|bandRow` | `SlideTableData.bandRow` | 隔行中性罩 | pptxgenjs 那行是注释掉的，只能注 `<a:tblPr bandRow="1"/>` |
| `cTn|dur` | `Slide.animDur`（正文逐条）+ `SlideShape.animDur`（形状） | （放映节奏随之对） | timing 树里效果行为的 `dur`；出场时长不捕（模型无槽，保持导出默认 500） |
| `transition|advClick` | `Slide.advClick`（只存 `false`） | — | `advClick="0"`；缺省与 `"1"` 同义都写 1 |
| `bodyPr|wrap` | `SlideShape.wrap`（只存 `false`） | `white-space: nowrap` 压过默认 pre-wrap | pptxgenjs `wrap:false` |

**验证**：夹具自检把这 12 枚从 `MUST_NOT_SEE` 搬进 `MUST_SEE`（自由文本框补 i/u/anchor/descr
当断言载体，表/图/母版/时长各加内容断言）；tmp 往返脚本（夹具 → 读 → 写 → 再读）逐字段比对，
12 枚全翻得回来。重跑后账本：已查问 42 → **54 对**（132 → 165 字面），未查问正好剩审计裁定的
**23 对 / 57 字面**。往返脚本还当场抓住过一个真 bug：descr 注入第一版把 `cNvPr` 标签结尾的 `>`
切掉了，自闭合与开标签两支全哑——图片那枚因为走原生 altText 反而看起来是好的。

## 二、裁定不读（23 对 / 57 字面）

| 族 | 对 | 字面 | 为什么不读 |
|---|---|---:|---|
| 动画时间轴内部 | `cTn|id`、`cTn|grpId`、`cTn|restart`、`cTn|fill`、`cTn|presetID`、`cond|delay`、`seq|concurrent`、`seq|nextAc`、`bldP|build`、`bldP|grpId`、`strVal|val` | 34 | 模型把动画表达成「揭示序 + 效果 + 方向」（`anim`/`animDir`），按 `spid` 认人、按 `presetClass` 分入场/退场。时间轴（并发分支、下一动作、延迟、重启、冻结）**整层不进模型**：不是读不到，是不打算表达。`cTn|id` 11 枚是这族最大的一笔，它只是 timing 树的内部流水号 |
| 锁定标志 | `spLocks|noGrp`、`graphicFrameLocks|noGrp` | 2 | 锁只影响编辑器里能不能拖动/组合，不参与渲染，写侧也不重建 |
| 主题/方案的命名 | `theme|name`、`clrScheme|name`、`fontScheme|name` | 3 | 名字不参与呈现；配色按 `srgbClr@val` 实值读，字族见上面 `latin|typeface`（那一枚已补，名字不是） |
| 系统色名 | `sysClr|val` | 2 | `sysClr` 由 `val`（系统色名，如 `windowText`）+ `lastClr`（实值）两枚组成，读手取实值 ⇒ 同一件事已表达 |
| drawing 分派与线帽 | `graphicData|uri`、`ln|cap` | 2 | `uri` 是内容类型标签，读手按子元素（`tbl`/`blip`/`c:chart`）分派，不看标签；线帽只影响描边端点，模型只有色与宽（`outline`/`outlineW`） |
| 保存会话记账 | `rPr|dirty`、`rPr|lang` | 2 | `dirty` 是「这层改过」的脏标记；`lang` 是拼写检查语言，都不进呈现 |
| 过渡速度 | `transition|spd` | 1 | 效果名已建模（`transition`），速度档在导出侧固定，模型无槽也不打算加 |
| 占位符序号 | `ph|idx` | 4 | 版式按 `ph@type` 映射（`phType`）；`idx` 只在**同一页有多个同型占位符**时区分彼此，而本产品的版式模型是「一页一种版式」——这个区分无处可落 |

## 三、这份审计不回答什么

- **字面权重**：夹具是按 schema 造的，`tr|h` 在真件里可能是每页几十枚，在夹具里只有 2 枚。要谈
  「先修哪一枚最划算」，得先有真件 pptx 语料（`--corpus` 那个口子）。
- **修哪一枚**：`rPr|i`/`rPr|u` 是 1 枚字面的小洞，却是屏上直接看得见的格式丢失；`cTn|id` 是 11 枚
  字面的大洞，却按设计不该读。**按字面量排序会把这两类搞反**，所以本表按「该不该读」分档、不按字面量排序。
- **写侧**：审计只裁读侧。上面 12 对真丢账里，写侧（`pptx-export.ts`）同样没有对应输出——v0.140 已随读侧
  一并补（见第一节的导出列），但**编辑器 UI 没有为这 12 枚加 inspector 控件**：导入进来的值在
  重新导出时原样保留（patchShape 是展开赋值），用户想手改还得等下一轮。
- **两处既有往返不对称**（v0.140 之前就有，与本轮无关，记在此处备查）：
  1. 标题/正文版式槽导出成无占位符的文本框，再导入会多出两枚自由文本形状（`Text 0`/`Text 1`）；
  2. 母版的标题/正文占位矩形（`titleRect`/`bodyRect`）导出时不写回 slideMaster，再导入读到的是
     pptxgenjs 默认母版的几何。

---

## v0.175（D34）——一页一份 `.rels` 索引，覆盖率一分没动

这一轮**没有补任何一对属性**，改的是关系文件的读取结构。账本因此是最好的判据：
覆盖率、consulted 集合、selftest 双向断言若有一处动了，就是索引把某条关系喂漏了。

| | 上一轮 | 这一轮 |
|---|---:|---:|
| pptx 按对 / 按字面 | 70.1% / 74.3% | 70.1% / 74.3% |
| selftest 应见 / 不应见 | 42 / 19 | 42 / 19（全绿） |
| 探针记录对 | 54 | 54 |
| `--mut no-ga` | 42 条全红 | 42 条全红 |

### 一、三条路各读各解析同一份文件

`slideToDeckSlide` 里同一份 `ppt/slides/_rels/slideN.xml.rels` 被读三次：

1. 形状/图片的 `r:embed` → 旧 `parseRels(text)` 建一棵树，出 `Map<Id, Target>`；
2. 单页背景图 → 主流程再 `async('string')` 一次 → `bgOf` → `imageFromRid` →
   旧 `relsEntries(text)` 又建一棵树；
3. 演讲者备注 → `parseNotes` 里第三次 `async('string')` → 旧 `relsEntries` 第三棵树。

后两条每次调用都重新 `parseXml` 整棵关系树；60 页的件就是约 180 次「解压 + 建树」，
其中 ③ 即使这一页根本没有备注也照跑。

### 二、`slideRelsOf`：一次解析，两种视图

页入口读一次文本、`slideRelsOf(text)` 解析一次，产出
`{ present, byId: Map, entries: [{id,type,target}] }`：形状的 `r:embed` 用 `byId`，
备注按 `Type` 找 `notesSlide` 用 `entries`，背景图仍走 `imageFromRid` 但改查 `byId`。
`present` 保留旧代码「rels 文件不在场就跳过背景图」的判定；母版 rels 也走同一解析器
（全库一份，不值得为它再开一条「字符串 vs 索引」的分支）。

**等价纪律**：每枚 `Id` / `Type` / `Target` 仍走 `ga` 漏斗按名查问。
旧两份解析器查的是同一组名字，新的一份也是——查问次数从 3 次降到 1 次，
consulted **集合**一枚不少（账本存集合不存次数）。`--mut no-ga` 仍 42 条全红，
说明漏斗没有被这个重构绕过去。

### 三、性能：同进程 A/B

`scripts/bench-pptx-import.mjs` 造每页带背景图、形状图、备注与 rels 的合成 pptx，
把改前读手导出成副本（`git archive 36d27e8 src/lib | tar -x -C tmp/bench-old`；
v0.174 未改 pptx-import.ts，故那份即改前），两腿同进程同夹具交替顺序各 10 样本取中位：

| 页数 | A 改前 | B 本轮 | 降幅 | 导入结果签名相同 |
|---:|---:|---:|---:|---|
| 10 | 11.5ms | 4.9ms | **−57.5%** | ✓ |
| 120 | 68.1ms | 49.7ms | **−27.1%** | ✓ |

签名比页数 / 标题 / 备注 / 背景图在场与否（形状 id 带 `Date.now()`，两趟必然不同，不比）。
页数少时降幅更大，正合「每页固定开销」的形状：省掉的是 2 次解压 + 2 次建树，
与每页内容量无关。

### 四、门禁与账本元信息

tsc 0、build ✓；结构测试 173（docx runprops）+ 29（v0.173 功能）+ **63**（外壳，
本轮 +23）+ PDF 文本编辑全通过。docx 两本账与四条变异腿全不动（本轮没碰 docx 读手）。

**本账 `modules` 58 → 64**：这本账上次生成是 v0.141，此后陆续新增 lib 文件，
本轮是首次重跑，一次补齐累计的 6 个模块；不是本轮 +6。覆盖率与逐对清单逐字未动。
rst：`docs/pptx-fidelity.md` md5 `aed59e05…` / `.json` `0d57217c…`。

