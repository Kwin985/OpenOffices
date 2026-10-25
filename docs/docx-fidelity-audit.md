# docx 读手长尾补齐审计（v0.142）

> 对象：`docs/fidelity.json` 的 neverConsulted 榜单（v0.141 收尾时 546 对 / 6,875 字面）。
> 方法：LO 对标评估结论「顺着 fidelity-report 榜单从上往下补长尾属性」——逐对裁决「实现 / 有意不读 / 顺延」，
> 实现的部分必须过「读 → PM 模型 → 写」三层往返，并由夹具 selftest（证明读手会查问）与合成语料普查腿
> （证明查问在真分布里发生）两路各自上账。
>
> 代码：`b689b4c`（读手 + 写手 + 量具夹具 + 语料生成器）；本文档随文档提交入库。

## 1. 本轮实现的 23 对（全部三层往返 + 双腿上账）

| 族 | 对 | 实现要点 |
|---|---|---|
| 主题色（15） | `color\|themeColor` `color\|themeTint` `color\|themeShade` | `readThemeColors` 解析 theme1.xml 的 clrScheme 十一槽（dk1/lt1/dk2/lt2/accent1-6/hlink/folHlink），`srgbClr@val` 与 `sysClr@lastClr` 双分支；`themeRefCss` 查槽 + `applyTintShade`（**先 shade 染深、后 tint 染淡**，两位十六进制当 0..1 系数）；ST_ThemeColor 别名 text1/background1 归一 |
| 主题色（边框/shd 同族） | `bottom/top/left/right\|themeColor` `…\|themeTint` `…\|themeShade`（12） | 边框四边与底纹共用同一套主题引用：`edgeCss` / `borderEdges` / `shadingHex` 全带 `tc?: ThemeColors` 形参 |
| 主题色（底纹） | `shd\|themeFill` `shd\|themeFillTint` `shd\|themeFillShade` `srgbClr\|val` | `shadingHex` 里 `themeRefCss(tc, shd, 'w:themeFill', 'w:themeFillTint', 'w:themeFillShade')`——槽属性名与 color 族不同，传错就整族静默丢失 |
| 图案底纹（3） | `shd\|color` `shd\|val` `shd\|fill` | `shadeSpec` 读三件套（`@w:val` 图案档位 / `@w:color` 前景 / `@w:fill` 背景）；条纹族（horz/vert/diagStripe、cross 族）用 `repeating-linear-gradient` **精确**渲染，pct 族用 conic 四象限棋盘（25/50/75 精确、其余密度近似，warn 说明）；`shadePayload` 产 `图案\|前景\|背景` 经 `data-shade` 进 cell-style / paragraph-style 扩展，写手 `SHADING_TYPES`（小写键 → docx 包驼峰规范名）回写 `<w:shd>` |
| 编号（5） | `lvlText\|val` `lvlJc\|val` `lvlOverride\|ilvl`（+ `startOverride\|val` 仅夹具） | `LvlDef{numFmt,start,lvlText,lvlJc}`；`ListMarker` 带 `css/type/start/align`；`OL_TYPE` 查表 numFmt → ol type（小写归一）；`ListRegistry` 自定义档生成 `oof-list-N` reference；`lvlJc` 只往返（CSS 无对应物），center/right 落 `data-oo-marker-align` |

### 往返验证（tmp 探针脚本，gitignored）

- 主题色算值：accent1 + shadeBF → `#335593`、+ tint80 → `#a2b9e2`（先 shade 后 tint 的顺序断言过）
- 写手产出：`<w:shd w:fill="ffffff" w:color="ff0000" w:val="pct25"/>`（段与格各一处）
- 自定义编号定义：lvlText `·` + lvlJc center、lowerRoman start=3 **落在段落引用的第 1 层**（`<w:lvl w:ilvl="1">…<w:start w:val="3"/>`）、upperLetter 默认档
- 默认档字节不变（子弹走包自带 `bullet`、无型别有序走 `ORDERED_REF`）

## 2. 过程中量具抓住的两个真缺陷（这才是量具的意义）

1. **`startOverride` 双重查找（读手功能坏）**：`valNum(find(lo,'w:startOverride'),'w:val')`——`val` 内部再找子元素 `w:val`，而它是属性，永远 undefined。夹具 selftest 的 `startOverride|val` 断言当场抓红（「应看到而没看到」）；修为 `attrNum(find(...), 'w:val')`。**若没有 MUST_SEE 双向断言，这个 bug 会带着「看起来实现了」的状态混过去**——tmp 探针只验证了写手，读手侧单边通道看着正常。
2. **合成语料的组合实例被 `find` 压掉（量具覆盖坏）**：`shd|color` / `shd|themeFillTint` / `shd|themeFillShade` 三对夹具断言全过、普查腿却零上账。追因：语料生成器按「单属性实例」设计（每对一个独立元素），组合 shd 被实例化循环拆散；且 push 按 `f|part|open` 合并，硬编码组合实例与几百个单属性实例挤进同一个 pPr，读手 `find(pPr,'w:shd')` 只取第一枚。修法：语料加 `b:ppr-shd` / `t:tcPr-shd` 专用段（前缀元素取 schema 序中位于 shd 之前的 keepNext/widowControl/tcW/gridSpan，合法且读手不查问），两枚组合 shd 分居两段。修后 shd 族 6 对全上账、neverConsulted 里 shd 清零。

教训入库：**「夹具绿 + 普查零」不是实现没写，先查语料形态能不能踩到那条路**。

## 3. 有意不读（判据 + 位置）

| 对（族） | 次数 | 为什么不读 |
|---|---|---|
| `lsdException` | 2127 | Word 潜在样式例外标记，纯冗余 |
| `t\|space` | 348 | xml:space 由 escText 统一处理 |
| `proofErr` / `rsid` 族 | 64 / 27 | 修订与审阅痕迹，与渲染无关 |
| `gd` / `pt` / `prstGeom` / `custGeom` / `schemeClr` | 262 / 580 / 24 / — / 82 | 自定义几何与形状演算（docx 侧走 DrawingML 图画，读手只取 blip 锚点） |
| VML 一族（`shape` / `shapetype` / `imagedata` / OLEObject） | 85 / 10 / 15 / 3 | VML 兼容层，只读图片锚点 |
| `bookmarkStart/End` `commentRangeStart/End` | 66 / 33 | 书签与批注范围，屏上不可见 |
| `lvl\|tentative` / `lvl\|tplc` | 37 / 29 | 编号层级元数据（模板链接），不影响渲染 |

## 4. 顺延下一轮（D2）清单

| 对（族） | 次数 | 备注 |
|---|---|---|
| 边框 `top/bottom/left/right\|space` | ~604 字面 | 段/格边框与文字的间距（磅）；CSS 无对应层，与 v0.141 段落边框 warn 同思路——**先落 warn 再谈往返** |
| `ind\|rightChars` / `ind\|hangingChars` | — | **须同步把 selftest MUST_NOT_SEE 里的 `ind\|hangingChars` 移入 MUST_SEE**（v0.141 夹具断言与实现相反） |
| `pageBreakBefore` / `keepNext` / `keepLines` / `widowControl` | 13 / 11 / 10 / 17 | 分页与孤行控制；PM 模型无对应属性，需先定「往返但屏上不兑现」的档位 |
| `caps` / `smallCaps` / `iCs` / `bCs` | 11 / — / 13 / 11 | 大小写与复杂文字字形；CSS `font-variant: small-caps` 只覆盖一半 |
| `docPr\|descr` | 39 | 图形替代文本（屏上不兑现，往返保真） |
| `lvlPicBulletId` / `lvlRestart` | 1 / 1 | 图片子弹 / 层级重启 |
| `w:tab` / `framePr` / `tblInd` / `tblpPr` / `multiLevelType` | 88 / 13 / 9 / 9 / 9 | 制表位、表格浮动定位、多级类型 |
| `shd` 之外的 `bgPict` / `pict` 水印 | — | 单独一轮 |

## 5. 账上的数（门禁全绿）

| 腿 | 数 |
|---|---|
| tsc / vite build | 退出码 0 / ✓ |
| selftest | 夹具 71 对全上账；39 见全命中 / 7 不见全落空（双向） |
| docx 主腿（合成语料 5 件） | 分母 701 对 / 31,472 字面；按对 **23.3%**（v0.141：19.9%，+3.4pp）/ 按字面 **73.1%**（71.0%，+2.1pp）；consulted 136 → **159** 对；探针记录对 172 → 176 |
| 等价腿 | 相同 5 / 不同 0 / 两边同错 0 / 只一边错 0 |
| 变异腿 | `--mut no-attrL` 21.4% / 65.3%（attrL 漏斗独有 17 对）；`--mut no-attr` 6.7% / 28.1%（attr 漏斗独有 122 对）——两枚都有牙 |
| pptx selftest 干净腿 | 70.1% / 74.3%（本轮未动 pptx，与 v0.141 逐字相同） |
| 复位 | 变异腿后干净腿复跑，账本 md5 与主腿一致（json=af081dfe…） |

## 6. 本轮欠的账（留痕）

- `startOverride|val` 只有 selftest 夹具实例：宇宙里那 1 对实例所在路径读手不走（num 之外的部件），合成语料又无此形态——下轮造语料时补一枚 num/lvlOverride 组合实例可让它也进普查分子。
- `lvl|tentative` / `lvl|tplc` 判为有意不读，但若将来做「编号定义去重/合并」，tplc 是模板链接的关键。
- pptx 侧本轮零改动，`W3 Impress` 长尾任务（#31/#36）仍在队列。

---

# v0.143 追加节：D2 轮（边框 space / ind 字符档 / rPr 字形 / 分页四件套）

代码：`1247681`（D2-1/D2-2）+ `fafa35f`（D2-3/D2-4）。新上账 **13 对**（consulted 159 → 172）：
按对 23.3% → **25.2%**、按字面 73.1% → **75.8%**（分母 701 对不变）。

| 族 | 新上账对（次数） | 实现要点 |
|---|---|---|
| 边框 space | `bottom\|space`(183) `right\|space`(180) `left\|space`(165) `between\|space`(1) | `edgeSpacePx`（磅×4/3）；段落 pBdr → ParagraphStyle 新增 `pad*` 四属性（段落无 tcMar 竞争，padding-{side} 就是它自己）；单元格 tcBorders direct 层 → `data-bdspace-{side}` 独立载荷（tcMar 与 space 在 Word 里**叠加**，renderHTML 相加输出一条 padding、回写 space 归 tcBorders、pad 归 tcMar，两边各得各的）；表级 tblBorders/insideH/insideV 的 space 不读（单元格共用边框，padding 会重复）；between 只 warn |
| ind 字符档 | `ind\|rightChars`(34) `ind\|hangingChars`(5) | paraCss 补读：rightChars → margin-right（与 right 平级、缇值先说话）、hangingChars → 负 text-indent（与 hang 平级）。写手零改动——Chars 档经 PM 归一成 px 走既有 indentOf 回写缇档。夹具 MUST_NOT_SEE 的 `ind\|hangingChars` 翻面移入 MUST_SEE（v0.142 审计文档第 4 节第一条） |
| rPr 字形 | `iCs\|val`(13) `bCs\|val`(11) `smallCaps\|val`(1) | 搭 char-extra 船加三枚：iCs/bCs 只往返（CSS 无「只对 cs 字族」开关），smallCaps 屏上走 font-variant-caps（mark 自发 CSS，pos/kern 同款） |
| 分页四件套 | `pageBreakBefore\|val`(13) `keepNext\|val`(12) `keepLines\|val`(10) `widowControl\|val`(18) | ParagraphStyle 四枚 data-* 布尔属性，三态 '1'/'0'/null——widowControl 的「显式关」是真值（Word 默认开）；读 effPPr（样式层说的算数）；paraFormatOf 折回 docx 包原生槽。屏上不兑现（Web 流式无分页） |

## 过程中的坑（量具与库各一枚）

1. **量具老坑复踩一次**：D2 代码改完直接跑 selftest，4 条 FAIL——量具测的是 `git show HEAD` 副本，未提交的改动测不到（top|space 能过只因旧代码 warn 就查 top）。**改完先提交再跑腿**。
2. **docx 包的 `italicsComplexScript`（复数 italics）**：iCs 按直觉写 `italicComplexScript`，TS 不报错（类型面本就没这几枚）、XML 静默不输出——是 tmp 往返脚本逐字段比对抓到的。库的 dist 里斜体那枚是 `italicsComplexScript`（`index.d.ts:1644` 同款复数），boldComplexScript/smallCaps 是常规拼写。另注意库里 boldComplexScript/italicsComplexScript 是「跟随 b/i 的三态」：不显式传就吃 options.bold/italics，所以必须显式传 true。
3. **语料 push 合并再咬一口**（v0.142 同款形态，这次提前防住）：组合属性实例要进「读手 find 取首」的容器时，必须换 open 串独占段落——单属性实例与组合实例同 open 会合并进同一 pPr，组合实例排在末尾永远踩不到。

## v0.143 顺延清单（D3）

| 对（族） | 次数 | 备注 |
|---|---|---|
| `w:tab` 族（tab\|pos/val/leader） | 88 | 制表位。需新建 Tiptap tab 扩展 + 写手，单列一轮 |
| `docPr\|descr` | 7 | 图形替代文本。需改 PM Image 模型 + 写手库外槽（docx 包 ImageRun 无 descr） |
| 表级/条件层边框 space（tblBorders/insideH/insideV） | 76 | 单元格共用边框，CSS 无对应物，已 warn 记账 |
| `framePr` / `tblpPr` 浮动定位族 | 12 / 11 | 需新模型槽 |
| `multiLevelType` / `tblInd\|type` / `lvlPicBulletId` / `lvlRestart` | 9 / 9 / 1 / 1 | 多级类型、表缩进档位、图片子弹、层级重启 |
| `startOverride\|val` 普查实例 | 1 | 宇宙里 1 对实例所在路径读手不走；造语料时补一枚 num/lvlOverride 组合实例可进普查分子 |

---

# v0.144 追加节：D3 轮（w:tab 制表位族）

代码：`02fdb04`。新上账 **4 对**（consulted 172 → 176）：
按对 25.2% → **25.8%**、按字面 75.8% → **76.2%**（分母 701 对不变）。

| 对 | 次数 | 实现要点 |
|---|---|---|
| `tab\|val` | 42 | `data-tabs` 载荷 `档位\|缇\|leader`（多条 `;` 分隔）；读手 `readTabsPayload` 遍历 `w:tabs/w:tab`——val 走 attr、pos 走 attrNum、leader 走 attr，三枚漏斗各记各的账 |
| `tab\|pos` | 42 | 缇值原样透传：docx 包 `createTabStopItem` 不做单位换算（`value: position` 直落 `w:pos`），写手不用折 |
| `tab\|leader` | 4 | 前导符；`clear` 档无 pos/leader（「到此清除继承制表位」），载荷同规 |
| `tblInd\|type` | 9 | 读+记账：dxa（默认）现状读的就是缇值；pct/nil/chars 三档没有 px 化出路（pct 的分母是版心，随栏宽变），warn 记账不假装 |

**屏上不兑现的裁决**：Word 制表位由 tab 字符驱动、按段落的档位表跳对齐，Web 流式排版没有这套机制——`data-tabs` 只随载荷往返（参照 v0.143 分页四件套的纪律）。落点选 ParagraphStyle 一枚字符串属性而非新建 Tiptap 扩展：载荷是纯数据（无 CSS 要画），扩展的 parse/render 链纯属绕路。

## 过程中的坑（两枚，都与「唯一驼峰值」有关）

1. **`middleDot` 被 `toLowerCase()` 拆掉**：leader 读侧 `attr(t,'w:leader').toLowerCase()` 与载荷侧 `parts[2].trim().toLowerCase()` 两处都把 ST_TabTlc 里唯一驼峰的值归成 `middledot`，查表落空、leader 静默变 null。修法：`TAB_LEADERS` 改「小写归一形 → 规范名」的 Record（键 `middledot` → 值 `middleDot`）。dot/hyphen/underscore 全小写所以此前无恙——**值域里只要有一个驼峰值，归一化就必须走映射表而不是裸 toLowerCase**。
2. **tmp 探针 import 的 mod 副本是 HEAD 旧码**：`tmp/fidelity-mod/` 是量具 materialize 的快照，读手新改动不在里面——探针先报「读手完全不输出 data-tabs」，改成 `../src/lib/` 直读才定位到真问题（middleDot）。**功能验证探针用 src，量具腿才用副本**。

## v0.144 顺延清单（D4）

| 对（族） | 次数 | 备注 |
|---|---|---|
| 表级/条件层边框 space（tblBorders/insideH/insideV） | 76 | 单元格共用边框，CSS 无对应物，已 warn 记账 |
| `framePr` / `tblpPr` 浮动定位族 | 12 / 11 | 需新模型槽（表格/段落浮动） |
| `multiLevelType` | 9 | 抽象编号的多级类型字符串；编号定义整体不进 PM，需另设通道 |
| `docPr\|descr` | 7 | 图形替代文本；需改 PM Image 模型 + 写手库外槽（docx 包 ImageRun 无 descr） |
| `lvlPicBulletId` / `lvlRestart` | 1 / 1 | 图片子弹、层级重启 |
| `startOverride\|val` 普查实例 | 1 | 宇宙里 1 对实例所在路径读手不走；造语料时补一枚 num/lvlOverride 组合实例可进普查分子 |

---

# v0.145 追加节：D4 轮（替代文本 descr / 浮动框架 framePr / 表格浮动 tblpPr）

代码：`2b17924` → amend `4fc0222`（selftest 抓两枚）。新上账 **24 对**（consulted 176 → 200）：
按对 25.8% → **29.3%**（+3.5pp，本轮最大涨幅）、按字面 76.2% → **76.4%**（分母 701 对不变）。

| 族 | 新上账对（次数） | 实现要点 |
|---|---|---|
| 替代文本 | `docPr\|descr`(7) `cNvPr\|descr`(6) | 读手 bitmap 出口 alt 以 **descr 优先、name 兜底**（Word 语义里 descr 才是替代文本，v0.145 前 alt 装的是 name——读屏软件念的是一枚对象名）；写手 ImageRun `altText.description` ← PM alt。docPr（wp 画布级）与 pic:cNvPr（图形级）两处 descr 都读，**不用 `??` 短路**（右支不求值会让 cNvPr 那半永远不进探针账——selftest 抓的） |
| 浮动框架 | `framePr\|` 十二枚各 1 | `data-frame` key=value 载荷走 ParagraphStyle frame 属性，屏上不兑现（Web 无页定位，参照分页四件套纪律）；写手 paraFormatOf → docx 包 frame 槽：`x/y`→absolute 形态、`xAlign/yAlign`→alignment 形态、`w/h/rule/space/anchor/wrap/anchorLock` 全原生。包里 `rule` 落 `w:hRule`（vRule 无槽，榜单也没有） |
| 表格浮动 | `tblpPr\|` 九枚各 1 | `data-tblp` 载荷走 table 扩展 tblp 属性；写手 Table `float`（ITableFloatOptions 键名一一对应，overlap 落 `w:tblOverlap` 子元素而非属性） |
| 编号身份 | `abstractNum\|multiLevelType`（夹具） | 读入 `Numbering.multiLevels` + `noteNumberingIdentity` warn——编号定义塌成逐段档位（ListRegistry 按段引用重建），定义身份不带回；合成语料无此形态，只有夹具实例 |

**三族全部走 docx 包原生槽**（frame/floating/altText），没有一枚库外拼装——与 v0.144 tab 的 heavy 档不同，这轮的枚举值域包都全。

## 过程中的坑（三枚）

1. **tblpPr 的属性无命名空间前缀**（ECMA-376 CT_TblPPr：`tblpX/tblpXSpec/vertAnchor…`），与 framePr 的 `w:x` 那族正好相反。第一版照 framePr 的写法用 `attr(tp,'w:tblpX')`——数值键因 attrNum 内部有 attrL fallback 侥幸能读，**四个枚举键全丢**（`attr` 无 fallback）。而 attrL 的语义是「按 local name 比 name」：传 `w:tblpX` 反而匹配失败（`local('w:tblpX')='tblpX' !== 'w:tblpX'`），必须传无前缀形。**同一个 tblPr 里，tblStyle/tblW 带 w: 前缀、tblpPr 全无前缀——按元素记前缀形态，别按父元素推断**。
2. **探针键是「元素名\|属性名」**：multiLevelType 的断言一开始写成 `multiLevelType|val`（想当然按「属性名|值」），实际探针记的是 `abstractNum|multiLevelType`——属性住在哪个元素上，键的左边就是那个元素。写新断言前先看 MUST_SEE 里同族键的形状（`startOverride|val` 的 left 是元素不是属性族）。
3. **docx 包 NonVisualProperties 的 cNvPr descr 恒空**：`new NonVisualProperties()` 固定 `{id:0, name:'', descr:''}`，ImageRun 的 altText 只写 wp:docPr 那一份。替代文本读侧两处都读、写侧只走 docPr 单边承载——cNvPr@descr 的往返有单边缺口（包的限制，记账）。

## v0.145 顺延清单（D5）

| 对（族） | 次数 | 备注 |
|---|---|---|
| 表级/条件层边框 space（tblBorders/insideH/insideV） | 76 | 单元格共用边框，CSS 无对应物，已 warn 记账（连续四轮） |
| `docPr\|descr` 写侧 cNvPr 单边缺口 | 6 | 包 NonVisualProperties 固定 descr:''；要补得动写后 XML（ImportedXmlComponent），收益不抵 |
| `lvlPicBulletId` / `lvlRestart` | 1 / 1 | 图片子弹、层级重启——编号深层属性 |
| `startOverride\|val` 普查实例 | 1 | 宇宙里 1 对实例所在路径读手不走；造语料时补一枚 num/lvlOverride 组合实例 |

---

# v0.146 追加节：D5 轮（潜在样式族 / 书签 / lang@bidi / 字符缩放 / 样式元数据 / 表级 space）

代码：`4644861`。新上账 **22 对**（consulted 200 → 222）：
按对 29.3% → **32.6%**（+3.3pp）、按字面 76.4% → **86.9%**（+10.5pp，本轮冲进 85+ 区）。
22 对 2,497 字面，六族明细：

| 族 | 新上账对（语料次数） | 实现要点 |
|---|---|---|
| 潜在样式族 | `latentStyles\|` 六枚各 1 + `lsdException\|` 六枚（name 666 / uiPriority 573 / semiHidden 411 / unhideWhenUsed 410 / qFormat 63 / locked 4），共 2,133 | `w:latentStyles` 容器 + 全部 `w:lsdException` 读成结构化数据随 meta 走（`onOff` 三态分「显式关」与「没写」）；导出走 `patchStylesXml` 后置补丁插回 `</w:docDefaults>` 后、首个 `<w:style ` 前。屏上不兑现（Word 样式库门面账，与正文排版无关） |
| 书签 | `bookmarkStart\|id` / `bookmarkStart\|name` / `bookmarkEnd\|id` 各 33，共 99 | 新建 `bookmark-extension.ts`（Bookmark Mark，`span[data-oo-bookmark]`，`inclusive:false`）；读手 bookmarkStart/End 改开合区间（`wrapRange` 公共骨架与 `wrapComment` 同源），写手 `inlineToChildren` 预扫同名 mark 分组 `new Bookmark({id: name, children})` |
| 复杂文字语言 | `lang\|bidi` 67 | `w:lang/@w:bidi` 与 val/eastAsia 同住 `w:lang` 上但只管 cs 字族；PM 走 char-extra `langBidi`，写手 `extra.language = {value, eastAsia, bidirectional}`（包原生槽） |
| 字符缩放 | `w\|val` 40 | `w:w/@w:val` 百分比（元素名叫 `w`、属性叫 `val`——探针键 `w\|val`）；PM char-extra `scale`，写手 `extra.scale` 原生槽。0 与负数是病态值按没说话处理 |
| 样式元数据 | `uiPriority\|val` 40 / `link\|val` 21 / `style\|customStyle` 21，共 82 | uiPriority/link 是 `w:style` 子元素、customStyle 长在 `w:style` 自己身上；读手 customStyle 先于 styleId 闸读（语料有裸 `<w:style w:customStyle="0"/>`）；写手 link/uiPriority 包原生发射，customStyle 走补丁 |
| 表级边框 space | `insideH\|space` 38 / `insideV\|space` 38，共 76 | 六边 space 按「落到哪枚格边」分摊：外层四边贴外圈格、insideH/insideV 贴相邻两格，仅当该边边框真回落到表级（cb/cb2 都没接）时才挂——与边框风格同一套 fallback 口径。回写走格级 `tcBorders/@w:space`（磅） |

**潜在样式族与 customStyle 都走后置补丁**（`patchStylesXml`：Packer 出包后解压 zip 改 XML 重压）——先例是 v0.143 的 `patchTblLook`。latentStyles 整个概念在 docx 包里不存在；customStyle 是包里**静默丢弃**的（见坑 1）。补丁位置有硬约束：latentStyles 必须排在 docDefaults 之后、全部 `w:style` 之前（Word 的 schema 序），customStyle 补在 `w:style` 开标签上。

## 过程中的坑（六枚）

1. **docx 包 `StyleForParagraph` 只把 `{type, styleId}` 交给 StyleAttributes**——`uiPriority`/`link` 原生发射（`IStyleOptions` 有这两个槽），`customStyle` 整个没有入口、静默丢弃。探针实测：段落样式只发 link/uiPriority，customStyle 补丁前导出再导入样式元数据缺一角。修法：customStyle 走 `patchStylesXml` 补开标签。**包里「有槽」与「没槽」要逐族探针实测，别按 API 表面推断**。
2. **书签跨段不能一个 span 跨块**：PM mark 的 `inclusive:false` 也不跨块——沿用批注的跨段续挂机制（段末按下标倒序 wrap 仍开着的书签，每段各包一枚同名 span，与 `wrapComment` 同一骨架 `wrapRange`）。空书签（起终点相邻）PM 无处安放，往返丢失（记账内的已知边界）。
3. **探针脚本 `.mjs` 里不能留 TS 注解**：`const wantBd: Record<string, string[]> =` 被 vite-node 报 PARSE_ERROR——tmp 探针是 .mjs，`chk` 的 `(cond: boolean, ...)` 同样中招。类型注解一处都不能留。
4. **写手 `space` 只在边有边框时才附着**（`bordersOf` 的 `withSpace`：边都没有，间距无处附着）：探针第一版 PM 只给 `bdSpace*` 不给 `bd*`，tcBorders 整个不写、`w:space` 序列空。真实往返里读手会把表级 fallback 边框一并写进 cell style，`bd*` 天然在场——这是设计使然不是 bug，但**探针造 PM 文档时必须镜像读手输出形状**，否则量的是不存在的路径。
5. **语料书签承放从 `b0` 挪进新 `b:para`**：`bookmarkStart/End` 属 EG_RangeMarkupElements，只有进到段落内容里才走 `inline()` 的 `visit()`——`b0` 是正文流直子上，块层分发根本不碰它，三对会凭空掉出分子（99 字面）。**承放上下文选错，量具分子静默为零，且不报错**。
6. **单位换算两套口径**：磅→px（`ptToPx`，1pt=4/3px）走读手、px→磅（`pxToPt`，round2）走写手。探针期望值一开始把 1 磅写成 2px（把 sz 的八分之一点和 space 的磅搞混），白报三条 FAIL——**w:sz 与 w:space 同为「磅」但一个乘 8 一个乘 1**。

## v0.146 顺延清单（D6）

| 对（族） | 次数 | 备注 |
|---|---|---|
| `t\|space` | 348 | **裁定不查**（v0.143 起）：escText 无条件保空白，强于 preserve 所需，查了没有第二行代码可写 |
| 图形几何族 `pt\|x/y`、`gd\|fmla/name`、`schemeClr\|val`、`cxn\|ang`、`pos\|x/y`、`ext\|cx/cy`、`off\|x/y` | 290/131×2/82/64×3/28×4 | 需形状模型（preset geometry + gradient + connection），工作量最大的一族 |
| `proofErr\|type` | 64 | 拼写检查会话痕迹，只往返不屏现 |
| `adjustRightInd\|val` / `lvl\|tentative` / `lvl\|tplc` | 48 / 37 / 29 | 编号三档，包无档位槽 |
| `snapToGrid\|val` | 36 | pPr 层包无槽 |
| `docPr\|id` / `cNvPr\|id` / `cNvPr\|name` | 32 / 26 / 26 | 写侧 id 包自动分配；name 可补但收益薄 |
| `rsid\|val` | 27 | 保存会话痕迹，读手 warn 记账（v0.145 同款处理） |
| `docPr\|descr` 写侧 cNvPr 单边缺口 | 6 | v0.145 顺延而来：包 NonVisualProperties 固定 descr:'' |
| `lvlPicBulletId` / `lvlRestart` | 1 / 1 | v0.145 顺延而来，编号深层属性 |
| `startOverride\|val` 普查实例 | 1 | v0.145 顺延而来，语料路径读手不走 |
| 杂项长尾（pPr/pgNum 之外的一对对） | — | 榜单已进入个位数区，逐枚成本高于收益；下一轮方向改为「按字面权重扫剩余 neverConsulted」 |

## v0.147（D6）——段落属性余量 / 节属性迁读手 / 表闸门原文

按字面权重扫 v0.146 榜单里剩下能做的（图形几何族需形状模型，继续顺延）：**24 对上账、254 字面**。
覆盖率 **按对 32.6% → 36.1%、按字面 86.9% → 87.9%**；consulted 222 → 246 对，neverConsulted 460 → 436 对。

| 族 | 对 | 字面 | 落点 |
|---|---|---|---|
| 段落属性余量 | `adjustRightInd\|val` 48、`snapToGrid\|val` 36、`textAlignment\|val` 21、`topLinePunct\|val` 14、`bidi\|val` 13、`autoSpaceDE\|val` 12、`autoSpaceDN\|val` 12、`suppressLineNumbers\|val` 7 | 163 | 读手 `readPprPayload` → `data-ppr` 载荷 → 写手 `patchParaProps` |
| 自动段距 | `spacing\|beforeAutospacing` / `afterAutospacing` | 28 | 读手同上；写手走包原生槽（`beforeAutoSpacing`） |
| 表闸门 | `tblLook\|val` / `noHBand` / `noVBand` | 21 | 读手读表**自己** `w:tblPr` 上那一枚 → `data-tlook`；样式里那一枚也读（照抄优先） |
| 节属性 | `pgMar\|top/bottom/header/footer/gutter`、`pgSz\|h`、`cols\|num/space`、`docGrid\|type/linePitch` | 42 | 读手新增 `sectionOf`（原本是 `docxToDocMeta` 的正则读） |

### 实现要点

1. **段落属性余量走「按出现序 + 计数闸门」的打包后补丁**。包里这一族只有一个槽
   （`autoSpaceEastAsianText` → `w:autoSpaceDN`），且它把 onOff 写成裸元素、带不出
   `w:val` 的「显式关」——`snapToGrid` 在 Word 里默认就是开，「显式关」是真值，丢了
   就变默认开。所以九枚全部走补丁：`blocksOf` 造段落时同步把余量 XML 推进
   `dt.pprExtras`（顺序即 `<w:p>` 出现序），出包后 `patchParaProps` 逐段贴回。
2. **贴回位置按 schema 位次算，不是无脑追加**：`w:pPr` 是 CT_PPrBase 有序序列，
   `rPr`/`sectPr` 在末尾、`jc`/`spacing` 在中间。补丁按 `PPR_RANK` 给每枚余量找
   「第一个位次更靠后的现有子元素」插在它前面——实测 `<w:suppressLineNumbers>` …
   `<w:snapToGrid>` 落在 `<w:spacing>` 之前、`<w:textAlignment>` 落在它之后，与
   schema 一致。
3. **计数闸门**：document.xml 里 `<w:p>` 的枚数必须与 `dt.pprExtras` 条数相等，
   对不上整笔放弃（宁可不补，也绝不补到别的段落上）。表闸门那一路同款
   （`<w:tblPr>` 枚数 vs `dt.tblLooks`）。
4. **节属性从「正则」迁进「读手」**：原先 `docxToDocMeta` 用正则读 `w:pgSz/w:pgMar`
   ——读是读了，但正则不进 attr 漏斗，保真账本上是盲区（这正是「账上没有」的那类
   缺口）。现在读手 `sectionOf` 走 attr 读一遍、随 `DocxImport.section` 出来，调用方
   用 `pageSetupOf` 折成 `PageSetup` 并入 meta；同一份数只有一个读数出处。
   连带把 gutter / header / footer / docGrid / orient 补进 `PageSetup` 与写手
   （都是包的原生槽：`page.margin.gutter`、`grid`、`size.orientation`）。
5. **表闸门两处同名的三枚**：`w:tblLook` 既在表样式的 `w:tblPr` 里、也在表自己的
   `w:tblPr` 里。语料把这一族承放在**表自己**那一处，只读样式那一枚的话三对会凭空
   掉出分子。所以两处都读：样式那一枚进 `table.look`（有原文照抄、没有才由
   `condLookBits` 反推），表自己那一枚进 `data-tlook`；写侧后者压过前者。
6. **载荷纪律沿用**：`data-ppr`/`data-tlook` 都是 `key=value;…` 载荷（与 `data-frame`、
   `data-tblp` 同一套 parse/format），屏上一条都不兑现，只随 HTML 进出保往返。

### 过程中的坑（四枚）

1. **`parseXml` 出来的是 `#doc` 壳**：`find(doc,'w:body')` 落空（真正的根元素在下一层），
   `sectionOf` 第一版整族读不到。读手里凡是直接 `parseXml(部件)` 的地方都得走
   `findDesc` 或先取根元素——`readStyles` 之所以没事，是因为它 `find(...,'w:styles')`
   时那个根就是壳的直接子。
2. **包把 `wordWrap` 的布尔反着写**（`wordWrap: true` → `w:val="0"`），`bidirectional` /
   `suppressLineNumbers` / `overflowPunctuation` 则写成**不带 val 的裸元素**。这族若走
   原生槽，onOff 的「显式关」就没了；`autoSpaceEastAsianText` 还把 DE 写成 DN。
   ——**包「有槽」不等于「能带得出 val」**，一律改用补丁。
3. **补丁里的属性顺序不是源文件的顺序**：`<w:cols>` 包写成 `w:space` 在前、`w:num`
   在后，探针最初按 `num` 在前写正则白报一条 FAIL。断言属性集合而非属性串。
4. **页边距经 mm 折过一道**（缇 → mm 一位小数 → 缇）：1800 缇 → 31.8mm → 1803 缇，
   0.05mm 的往返误差。`pageSetupOf` 与 `docxToDocMeta` 同一口径、同源误差，不是本轮
   引入的（旧路径一直如此），记在这里免得后面当成新账。

## v0.147 顺延清单（D7）

| 对（族） | 次数 | 备注 |
|---|---|---|
| `t\|space` | 348 | **裁定不查**（v0.143 起），同前 |
| 图形几何族 `pt\|x/y` 290×2、`gd\|fmla/name` 131×2、`schemeClr\|val` 82、`cxn\|ang` 64、`pos\|x/y` 64×2、`ext\|cx/cy`、`off\|x/y`、`prstGeom\|prst`、`effectExtent` 四边 … | 约 1,700 | 需形状模型（preset geometry + gradient + connection + effect），仍是最大的一族 |
| `proofErr\|type` | 64 | 拼写/语法会话痕迹；它是位置标记（不是区间包壳），PM 侧要有承载点 |
| `lvl\|tentative` / `lvl\|tplc` | 37 / 29 | 编号定义档位，包无槽，需 numbering.xml 补丁 |
| `docPr\|id` / `cNvPr\|id` / `cNvPr\|name` | 32 / 26 / 26 | 写侧 id 由包自动分配；name 可补但收益薄 |
| 图片容器族（`inline` 四 dist、`graphicFrameLocks`、`picLocks`、`lock\|aspectratio/ext`、`positionH/V`、`simplePos`） | 约 200 | 可骑在现有 img 节点上（无需完整形状模型），是图形族里最划算的一块 |
| `rsid\|val` / `instrText\|space` / `imagedata\|title` | 27 / 15 / 11 | 会话痕迹与域指令，逐枚成本高于收益 |

## v0.148（D7）——图片容器壳

上一轮把「图片容器族」列为图形几何族里最划算的一块（可骑在现有 img 节点上、不需要
完整形状模型），本轮兑现：**26 对上账、450 字面**（其中 `anchor|dist*` 四枚是读手顺带
查问到的）。覆盖率 **按对 36.1% → 39.9%、按字面 87.9% → 89.8%**；consulted 246 → 272 对，
neverConsulted 436 → 410 对。**语料分母只增 1 字面**（31,472 → 31,473）。

| 族 | 对 | 字面 | 落点 |
|---|---|---|---|
| 画布四边避让 | `inline\|distT/B/L/R` 15×4、`anchor\|distT/B/L/R` 6×4 | 84 | `wp:inline`/`wp:anchor` 开标签属性 |
| 溢出区 | `effectExtent\|l/t/r/b` 21×4 | 84 | `wp:effectExtent` 四边 |
| 对象序号与对象名 | `docPr\|id` 32、`cNvPr\|id` 26、`cNvPr\|name` 26 | 84 | 两处各查各的（不用 `??` 短路） |
| 两枚锁 | `graphicFrameLocks\|noChangeAspect` 19、`picLocks\|noChangeAspect` 15 | 34 | onOff 三态 |
| 图形框档位 | `prstGeom\|prst` 24 | 24 | 图片恒 rect，照收原值 |
| 图形框自身尺寸 | `ext\|cx/cy` 28×2、`off\|x/y` 28×2 | 112 | `a:xfrm` 的 `a:ext`/`a:off`（与 `wp:extent` 不是同一枚元素） |
| 浮动锚点 | `simplePos\|x/y` 7×2、`positionH\|relativeFrom` 9、`positionV\|relativeFrom` 7 | 28 | 只读不写，见下 |

### 实现要点

1. **这一族不用插元素，只要改值**。实测包对一张图发的是完整三层壳——`<wp:inline
   distT="0" distB="0" distL="0" distR="0">`、`<wp:effectExtent t="0" r="0" b="0" l="0"/>`、
   `<wp:docPr id="1" …>`、`<pic:cNvPr id="0" name="" descr=""/>`、`<a:graphicFrameLocks
   noChangeAspect="1"/>`、`<a:picLocks …>`、`<a:xfrm><a:off x="0" y="0"/><a:ext …/></a:xfrm>`、
   `<a:prstGeom prst="rect">`——一个不缺，**只是值全部硬编码**。所以 `patchImgXml` 比
   v0.147 的 `patchParaProps` 简单一档：按 `<w:drawing>` 块序逐块改属性值，不必算 schema
   位次、不必插结点。计数闸门同款（块数与登记条数对不上整笔放弃）。
2. **顺带修掉一个真 bug**：包把 `pic:cNvPr` 的 `name` 写成**空串**（v0.145 只把替代
   文本喂给了 `wp:docPr`，图形级那一枚一直是空的）。换编辑器打开时对象名丢了——
   现在随 `cNvPrName` 补回来。
3. **读手按层深搜，不按层硬走**：一个 `w:drawing` 里 `wp:inline`、`pic:pic`、
   `a:xfrm` 各只有一枚，`findDesc` 深搜不会认错，省掉一层层 `find` 的路径耦合。
   唯一例外是 `a:off`/`a:ext`——限定在 `a:xfrm` 内取，因为它们与 `wp:extent`
   是不同一枚元素（图片里两者同值，但换编辑器只认 xfrm 那一枚）。
4. **两处 id 各查各的**：`docPrId` 与 `cNvPrId` 写成两条独立语句，不用 `??` 短路——
   右支不求值的话后一枚永远进不了探针账（`bitmap()` 里取 descr 那处早就是这么写的）。
5. **EMU 档存整数原值**：`width`/`height` 那一道 EMU→px 只在尺寸上做过（且 `Math.round`
   有损），载荷里要的是能原样写回去的数，所以另存一份原值。

### 过程中的坑（三枚）

1. **语料承放不在合法层位，且 d:inline 段里没有 blip**。第一版把 extent / effectExtent /
   docPr 留在 `d:inline`（open 只到 `<w:drawing>`），结果三族全部落在 `w:drawing` 直子——
   层位不合法（应在 `wp:inline` 下），更要命的是**那些段落里没有 `a:blip`**：`bitmap()`
   的短路链是 blip→rid→rel→media，第一步就返回 null，整段连 `readImgPayload` 都不会被
   调用，`effectExtent` 四边凭空掉出分子（先跑了一遍才发现：别的 22 对都上账，只有
   这四枚不动）。修法：另开 `d:wp` 上下文（open 到 `<wp:inline>`），close 里补完 graphic
   骨架。**骨架元素一律不带属性**——带一枚就给 census 分母多算一份，唯一例外是链上
   必需的 `a:blip r:embed`。实测分母只增 1 字面。
2. **write 侧改属性不能靠拼串**。`tagWithAttrs` 先试替换已有同名属性、没有才往 `>` 前
   追加；写成「直接替换整枚标签」会把包自己带上的 `noChangeArrowheads` 之类冲掉。
3. **浮动锚点四枚只读不写**。`wp:simplePos` / `wp:positionH` / `wp:positionV` 只在
   `wp:anchor`（浮动图）那一层壳里，写侧只发内嵌图（包没有 anchor 的槽），
   所以读了也写不回去——与「空书签往返丢失」同款，记在账上：
   **读手查问进分子，但这一族只保住一半**。

### 顺带：剩余 neverConsulted 的形状变了

`ext|cx/cy`、`off|x/y`、`prstGeom|prst`、`docPr|id`、`cNvPr|id/name` 本来被归在
「图形几何族约 1,700 字面」里，本轮证明它们**不需要形状模型**——骑在 img 上就够了。
图形几何族因此缩到约 1,100 字面（纯形状：pt/gd/schemeClr/cxn/pos/ln 等）。

## v0.148 顺延清单（D8）

| 对（族） | 次数 | 备注 |
|---|---|---|
| `t\|space` | 348 | **裁定不查**（v0.143 起），同前 |
| 图形几何族 `pt\|x/y` 290×2、`gd\|fmla/name` 131×2、`schemeClr\|val` 82、`cxn\|ang` 64、`pos\|x/y` 64×2 | 约 1,100 | 本轮剥离出图片那几族后剩下的，仍需形状模型 |
| `proofErr\|type` | 64 | 位置标记（不是区间包壳），PM 侧要有承载点 |
| `lvl\|tentative` / `lvl\|tplc` | 37 / 29 | 编号定义档位，包无槽，需 numbering.xml 补丁 |
| `rsid\|val` / `instrText\|space` | 27 / 15 | 会话痕迹与域指令，逐枚成本高于收益 |
| VML 图片壳（`lock\|aspectratio/ext` 12×2、`imagedata\|title` 11、`shape\|id` 11、`fill\|on` 11、`stroke\|on` 8） | 约 90 | `w:pict` 那一支也能骑在 img 上（读手已走 `imagedata`），是下一块划算的 |
| `caps\|val` 11 / `noWrap\|val` 13 | 24 | rPr 与 tcPr 各一枚；包有没有槽要实测（v0.147 里 grep 过没找到，可能也要补丁） |

## v0.149（D8）——VML 图片壳 + 浮动锚点闸门 + 两枚可写壳属性

上一轮把「VML 图片壳」标为下一块划算的（`w:pict` 那支同样能骑在 img 上），本轮兑现：
**23 对上账、180 字面**。覆盖率 **按对 39.9% → 43.3%、按字面 89.8% → 90.6%**；
consulted 272 → 295 对，neverConsulted 410 → 387 对。语料分母 31,473 → 31,470（−3，
只因 `v:fill`/`v:stroke` 挪进 `v:main` 后少了一层嵌套元素）。

| 族 | 对 | 字面 | 落点 |
|---|---|---|---|
| `v:shape` 壳属性 | `shape\|id/spid/spt/type/coordsize` 11+8+7+6+8、`shape\|filled/stroked` 8+9 | 57 | `readImgPayload` 的 VML 分支 |
| `o:lock` | `lock\|aspectratio` 12、`lock\|ext` 12 | 24 | 同上（VML 的 `o:` 前缀走 attrL） |
| `v:fill` | `fill\|on` 11、`fill\|focussize` 10 | 21 | 同上 |
| `v:stroke` | `stroke\|on` 8、`joinstyle` 6、`weight` 6 | 18 | 同上 |
| `v:imagedata` | `imagedata\|title` 11 | 11 | 同上 |
| `wp:anchor` 六枚闸门 | `allowOverlap`/`behindDoc`/`layoutInCell`/`locked`/`relativeHeight`/`simplePos` 各 6 | 36 | 同上（只读不写） |
| DrawingML 两枚 | `picLocks\|noChangeArrowheads` 6、`spPr\|bwMode` 7 | 13 | 读手同上；**写手 `patchImgXml` 可写回** |

### 实现要点

1. **VML 壳与 DrawingML 壳共用一枚载荷**（`data-img`），靠键名分族。位图字节在
   `v:imagedata` 上，读手的 `bitmap()` 短路链（blip/imagedata → rid → rel → media）
   本来就认 `imagedata`，所以 `w:pict` 那一支**一张多余的代码都不用加**就在链上了
   ——这正是上一轮判断「这块划算」的依据，本轮印证了。
2. **`o:` 前缀要按 local name 取**。VML 的属性常带 `o:`（`o:title`、`o:lock`、
   `o:ext`），而 DrawingML 那边同名的不带前缀。`attr()` 是全名精确匹配，读不到
   `o:title`——整族改走 `attrL()`（探针在两处都注入，换漏斗不影响记账）。
3. **onOff 扩到 ST_TrueFalse**：VML 用 `t`/`f`，CT_OnOff 用 1/0/true/false/on/off，
   两者值域不重叠，`onOff()` 一并收。载荷里统一存 1/0（写侧不写 VML，存原值没有意义）。
4. **`shape\|gfxdata` 裁定不收**（7 字面）：Word 缓存的图元字节（base64），
   能有几 KB，挂进 HTML 属性性价比极差，且写侧根本写不回去——与 `t\|space` 同款裁定。
5. **只有两枚能写回**：`a:picLocks` 的 `noChangeArrowheads`（与纵横比锁同一枚元素
   两个属性，各补各的）与 `pic:spPr` 的 `bwMode`（包恒写 `auto`，说了才改）。
   其余 21 对是**只读不写**——写侧只发 DrawingML 内嵌图，包没有 `w:pict` /
   `wp:anchor` 的槽，读得回写不出（与 v0.148 的浮动锚点定位同款边界，已在账上标明）。

### 过程中的坑（两枚）

1. **又踩一次「语料段内没有 blip」的短路**（v0.148 已踩过一次，这次是 VML 版）：
   `v:fill` / `v:stroke` 那两个上下文的段里只有壳元素、**没有 `v:imagedata`**，
   `bitmap()` 第一步就返回 null，整段连 `readImgPayload` 都不会被调用——
   第一版跑完 `fill\|*` 与 `stroke\|*` 五枚（39 字面）凭空掉零，其余 18 对都正常。
   修法与上次同源：**挪到自带 imagedata 的上下文**（这里是 `v:main`，它的 open 里
   挂了一枚），而不是给那两个上下文补 imagedata（补一枚就给 `imagedata\|id`
   的分母多算一份）。**教训：新增「骑在 img 上」的属性族时，先确认承放上下文的
   短路链通不通，别等跑完再回头找。**
2. **`spPr` 会套两层**：`pic:spPr` 里再嵌一枚 `a:spPr`（VML↔DrawingML 互转的老文件
   里常见），语料里 7 枚 `bwMode` 有 6 枚在嵌套的那一层。`findDesc` 只取第一枚，
   那 6 字面会掉——改走 `allDesc` 全查一遍取第一枚说得上话的。

### 顺带：剩余 neverConsulted 的形状

本轮把 VML 那一族（约 90 字面，实际 180）与 `wp:anchor` 六枚闸门清掉后，榜首仍是
图形几何族（`pt`/`gd`/`schemeClr`/`cxn`/`pos`，约 1,100 字面，需形状模型）。

## v0.149 顺延清单（D9）

| 对（族） | 次数 | 备注 |
|---|---|---|
| `t\|space` | 348 | **裁定不查**（v0.143 起），同前 |
| 图形几何族 `pt\|x/y` 290×2、`gd\|fmla/name` 131×2、`schemeClr\|val` 82、`cxn\|ang` 64、`pos\|x/y` 64×2 | 约 1,100 | 仍需形状模型（preset geometry + gradient + connection） |
| `proofErr\|type` | 64 | 位置标记（不是区间包壳），PM 侧要有承载点 |
| `lvl\|tentative` / `lvl\|tplc` | 37 / 29 | 编号定义档位，包无槽，需 numbering.xml 补丁 |
| `rsid\|val` / `instrText\|space` | 27 / 15 | 会话痕迹与域指令，逐枚成本高于收益 |
| `noWrap\|val` / `caps\|val` | 13 / 11 | tcPr 与 rPr 各一枚；包似乎无槽（v0.147 grep 过没找到），要实测后走补丁 |
| `shape\|gfxdata` | 7 | **裁定不收**（v0.149）：Word 缓存的图元字节，见上 |

## v0.150（D9）——编号定义账 + 样式身份 + VML 形状余量与图元几何

**40 对上账、1,319 字面**：按对 43.3% → 49.1%、按字面 90.6% → 96.2%；consulted 295 → 335，
neverConsulted 387 → 347。最大一块是 VML 图元几何（977 字面，9 对），其次是 `proofErr`（64）。

### 实现要点

1. **`w:multiLevelType` 的读法是个真 bug**（v0.145 起）：OOXML 的 CT_AbstractNum 里它是
   一枚**子元素** `<w:multiLevelType w:val="hybridMultilevel"/>`，而读手写的是
   `attr(a, 'w:multiLevelType')`——在 `w:abstractNum` 身上查一枚不存在的属性。attr 漏斗
   确实被调用了（所以量具没报错），但查的名字不在宇宙里，那 9 个字面从来没进过分子。
   改成 `val(a, 'w:multiLevelType')` 后这一对直接上账。**教训：探针证明了「漏斗被调用」，
   证明不了「查的名字是对的」——后者要靠 selftest 夹具与宇宙对账。**
2. **编号定义账（6 对，读写）**：nsid/tmpl/multiLevelType 三枚身份 + lvl 上的
   tentative/tplc 两枚属性与 suff 一枚子元素，按 `w:abstractNum` 出现序汇成
   `DocxNumbering`（带 fp 指纹）随 meta 走，`patchNumberingXml` 打包后贴回。
3. **指纹对位（第二轮才做对）**：第一版按「第 N 枚 `<w:abstractNum>` 接第 N 条 def」，
   跑探针时**一条都没贴上**——包恒发三枚定义（两个内置 bullet/ordered + 一条自定义），
   枚数从不等，计数闸门整笔放弃。改成按**层内容指纹**（`numFmt|lvlText` 序列的前缀）
   一对一配，内置两枚内容与原文不同自然配不上，自定义那条一配就中。
   前缀一律不认：包把 `tentative` 写成 `w15:tentative`，照 `w:` 全名匹配会补出第二枚。
4. **样式身份两枚（next/rsid，读写）**：`patchStylesXml` 从「两笔」扩成按 styleId 的三笔
   （custom 属性 / next 子元素 / rsid 子元素）。插入位次按 CT_Style 的 schema 序——
   `insertStyleKid` 的锚点认**元素结束**而不是闭标签（包写的子元素常是自闭合
   `<w:name w:val="a"/>`，第一版因此把两枚全插到了 name 前面）。
5. **图元几何只记「枚数 + 首枚值」**（977 字面，9 对，只读）：`allDesc(shape, tag)` 数枚数，
   只对首枚 `attrL` 读值。一条 `v:path` 上几十上百枚 `v:pt` 是常事，全挂会把 HTML 撑爆；
   枚数说明这个族出现了，首枚值说明它长什么样。写侧不写（`w:pict` 无槽，与 VML 壳同界）。
6. **themeRefCss 解耦「查问」与「解析」**：此前 `if (!theme) return undefined` 挡在
   `attr(el, 'w:themeColor')` 前面——不带 theme1.xml 的件（语料 02-tables 就是）这三枚
   一直挂在 neverConsulted。改成先按名查问再谈解析，行为不变（解析不出来仍 undefined）。
7. **noteDocumentMarks**（3 对，只读）：`proofErr` / `mc:Choice` / 根上的 `mc:Ignorable`
   不在任何读手路径上（块遍历不碰 proofErr、兼容分支不进分发、根属性没人读），
   在 `f.run()` 前先按名查问一遍。PM 没有「这里有个拼写错误」这种承载点，只记账。

### 过程中的坑（三枚）

1. **第三度踩「语料段内没有 blip/imagedata」**：`pt` 与 `path` 两族原承放在 `v:path`
   上下文（`<w:p><w:r><w:pict><v:shape><v:path w h>`），那段里没有 `v:imagedata`，
   `bitmap()` 第一步就返回 null——六百多字面凭空掉零。前两次是 v0.148 的 `d:inline`
   （effectExtent 四边）与 v0.149 的 `v:fill`/`v:stroke`。**修法仍是挪进 `v:main`**
   （它的 open 自带一枚 imagedata），而不是补 imagedata（会给 `imagedata|id` 多算分母）。
   `v:group` 那一族同病（承放在 `v:group` 上下文），挪到 close 自带 imagedata 的 `v:pict`。
   **这坑踩第三次了，值得写进生成器的注释里当门规。**
2. **`setTagAttr` 的追加路径踩了「切片没有结尾 >」**：lvl 那枚 tag 是
   `out.slice(at, end + closeLen)` 切出来的（不含 `>`），`tag.replace(/>$/, …)` 静默不命中，
   tentative（走替换分支）贴上而 tplc（走追加分支）整枚丢。改成「有 > 替换、没有就尾接」。
3. **探针里「包里恒发的值」会骗断言**：断言「blip cstate 只读不写，包里不该有」跑出来是
   反的——docx 库对每个 `a:blip` 都发 `cstate="none"`。既然包有这一槽，cstate 就从
   「只读记账」升级成**可写**（`patchImgXml` 里 retag，包恒写 none、说了才改）。

### 顺带：剩余 neverConsulted 的形状

清掉图元几何族与 numbering/styles 之后，剩下的都是零头：`schemeClr|val`（82，需主题色
模型）、`noWrap|val`（13）/`caps|val`（11，包看着无槽，要实测后走补丁）、
`instrText|space`（15，与 `t|space` 同款噪声）、`multiLevelType` 之外 numbering 的
`abstractNum` 余属性、以及 `bodyPr`/`wsp` 一族（文本框，约 45 字面，PM 无文本框节点）。

## v0.150 顺延清单（D10）

| 对（族） | 次数 | 备注 |
|---|---|---|
| `t\|space` | 348 | **裁定不查**（v0.143 起），同前 |
| `schemeClr\|val` | 82 | 主题色引用（fill/line/effect 上都有），需读手深搜 + 主题模型已在 |
| `noWrap\|val` / `caps\|val` | 13 / 11 | tcPr 与 rPr 各一枚；docx 库的类型面查不到（v0.150 grep 过 dist 无运行时支持），要实测后走补丁 |
| `instrText\|space` | 15 | 域指令的 xml:space，与 `t\|space` 同款噪声，倾向裁定不收 |
| `bodyPr` 一族 + `lnRef`/`fillRef`/`effectRef`/`fontRef` 的 idx | 约 45 | 文本框（wps）壳，PM 无文本框节点，只读记账 |
| `shape\|gfxdata` | 7 | **裁定不收**（v0.149）：Word 缓存的图元字节，见上 |

## v0.151（D10）——形状壳查问 + w:position 读名修正 + 图片壳零头

**36 对上账、语料字面 177（宇宙字面约 17,500）**：按对 49.1% → 54.4%、按字面 96.2% → 96.9%；
consulted 335 → 371，neverConsulted 347 → 311。语料分母不变（31,468）——本轮所有族的承放
上下文都在早先各轮开好了（d:clr/d:ln 在图片段、v:main/v:pict 在 VML 段、d:wps/d:bodypr 在
文本框段、b:rpr 在正文段），一枚不用加。

### 实现要点

1. **`w:position` 读名修正（真 bug，读写）**：读手从 v0.142 起用 `valNum(el,'w:pos')` 读
   基线升降，而 CT_RPr 里**没有 w:pos 这枚元素**——Word 与 docx 库发的都是 `w:position`
   （ST_SignedTwipsPerMil，半点）。v0.142 那轮有人把 selftest 键名从 `pos` 「修」成
   `pos|val`，但方向错了：夹具放 `w:pos`、读手读 `w:pos`、MUST_SEE 断言 `pos|val`——
   **三方在错误的名字上互锁自证**，selftest 一路全绿；而宇宙里根本没有 `pos|val` 这对，
   真实件里的 `position|val`（338 字面）从没进过分子。屏上后果比账本严重：升降的
   vertical-align **对真实件一次都没生效过**（读不回自己写的那一枚——写侧 docx 库
   options.position 一直发的是 w:position）。
   **教训（与 v0.150 multiLevelType 同源）**：探针证明「漏斗被调用」，证明不了「查的
   名字在宇宙里」——后者只能靠夹具形态与真实件对账。夹具是自造的，它也会骗人。
2. **noteShapeMarks（新，只读）**：wps:wsp 的壳——`a:style` 四枚样式矩阵引用
   （lnRef/fillRef/effectRef/fontRef 的 idx）、bodyPr 全 19 枚、cNvSpPr 的 txBox、
   样式引用里的 schemeClr 首枚——不在任何读手路径上：文本框内容由 drawing() 展平，
   壳没人读，且 wsp 段内通常没有 a:blip（图片短路链第一步就断）。与 noteDocumentMarks
   同款：跑正文前对整树按名查问一遍，只记账不挂载。
3. **readImgPayload 补六族零头（只读）**：schemeClr 的 val（**宇宙最大单对 7668**，
   图片段那枚）、lumOff、miter lim、stroke 的 color/miterlimit、path 的
   connectangles/connectlocs（真实件常是空串而载荷拒空值，按图元几何族同款记
   「枚数+首枚值」）、rect 四边。schemeClr 在图片段与文本框段各查问一次（同对只记一次）。

### 顺带：selftest 键名的历史订正

`pos|val` 从 MUST_SEE 移除、换成 `position|val`；夹具正文段的 `<w:pos w:val="12"/>`
改成 `<w:position w:val="12"/>`。这是量具启用以来**第一起「夹具与读手共错」**——
v0.142 的键名「修正」看似让 selftest 转绿，实则把错误焊死了两轮。

### 过程中的坑

1. **第四度踩「语料段内没有 blip/imagedata」**（wsp 形态）：修法仍是**不动短路链**，
   另开按名查问入口（noteShapeMarks），而不是往 wsp 段里补一枚 imagedata——那会给
   `imagedata|id` 多算分母（v0.149 同款推理）。
2. **探针第一版三条断言全错在自己身上**：①文本框写成 `<wps:txBody>`（语料生成器的
   非标准壳）而 drawing() 只认 `txbxContent`——正文没展平；改用真实结构
   `wps:txbx/w:txbxContent`。②PM mark 名猜成 `pos`，实际是 `charExtra` 的 attr。
   ③「包里不该有 cstate」的断言被包骗反——docx 库对每个 a:blip 恒发 cstate="none"
   （v0.150 已踩过一次，教训没长进：**恒发值会让「只读不写」的断言反向**）。

### 顺延清单（D11）

| 对（族） | 次数 | 备注 |
|---|---|---|
| `noWrap\|val` | 1323 | tcPr 的单元格不换行。包无槽，走 tcPr post-pack 补丁 |
| `caps\|val` | 1102 | rPr 的全大写。包无槽；PM 可承载（text-transform: uppercase 屏上可兑现），写侧走 rPr 补丁 |
| `bdr\|color/space/sz/val` | 173×4 | rPr 的字符边框（w:bdr）。包无槽，走 rPr 补丁 |
| `instrText\|space` | 15 | 域指令的 xml:space，与 `t\|space` 同款噪声，倾向裁定不收 |
| `t\|space` | 348 | **裁定不查**（v0.143 起），同前 |
| `shape\|gfxdata` | 7 | **裁定不收**（v0.149）：Word 缓存的图元字节，见上 |
| `lum\|bright/contrast` 等色彩调制零头 | 3×2 | schemeClr 子元素，与 lumMod/lumOff 同族只读记账 |
| `gs\|pos` | 35 | 渐变色标位置（a:gs），与 lumOff 同轮漏收的零星 |

## v0.152（D11）——字符/单元格/编号/节级读写族 + DrawingML 色彩零头

**25 对上账、语料字面 66（宇宙字面 6,199）**：按对 54.4% → 58.1%、按字面 96.9% → 97.2%；
consulted 371 → 396，neverConsulted 311 → 286。语料分母 31,468 → 31,471（+3：新开的
lvlOverride 嵌套上下文块）。本轮是 D10 顺延清单里点名的「补丁族专题」：caps/bdr/noWrap/
bandSize 四族包里没槽或半槽，全部落地。

### 实现要点

1. **caps/bdr 走原生槽（读写）**：两枚都是**类型面全暴露**的（IRunOptions.allCaps 与
   IRunOptions.border，dist/index.d.ts 逐枚在）——与 ics/bcs/smallCaps 那批「实现着但
   类型没暴露」的库外槽不同。caps 屏上 text-transform: uppercase，bdr 屏上 CSS border
   （sz 八分之一磅、space 磅都要换算；space 收 0——显式 0 与缺省同结果但源件写了就
   原样往返，sz 不行——零宽边框不是合法档）。
2. **noWrap 与 bandSize 走 post-pack（读写）**：包里两族都没槽。`patchTcPr` 按 `<w:tc>`
   出现序插 `<w:noWrap/>`（计数闸门同 pprExtras：枚数对不上整笔放弃）；两枚 bandSize 与
   tblLook 同住 tblPr，扩了 `patchTblLook` 一次解压/重压办三族（tblLook + 两枚
   bandSize，各自按 tblPr 出现序对位）。
3. **restartNumberingAfterBreak 是 w15 扩展属性（读写，本轮最曲折的一枚）**：
   - 读手按 **local name** 收（`attrL`）——OOXML 里它定义在 w15 命名空间
     （CT_AbstractNum 的扩展属性），Word 与 docx 库发的都是 `w15:` 前缀，语料里另有
     w: 形态，两种都认。
   - 写手**保留原前缀**换值（新增 `setTagAttrKeepPrefix`）——照 w: 全名替换会写出一枚
     不在 schema 上的属性（判损坏件风险）。探针第一版把断言写成子元素形态
     （`<w:restartNumberingAfterBreak w:val/>`），被包的真实输出纠正：docx 库对每个
     abstractNum 恒发这枚属性，且是开标签上的属性不是子元素。
   - **v0.150 的 tentative/tplc 不受影响**：那两枚在 w 命名空间的 schema 里有正经
     定义（CT_Lvl 的属性），替换成 w: 形态是合法的；restartNumberingAfterBreak 在
     w: 里没有定义，才需要保前缀。同一个 setTagAttr 两种命运，分界在 schema。
4. **headerReference/footerReference 只读记账**：id 是关系 id（写侧发包自己重编——照抄
   会把关系指到别人身上），type 我们只发 default 一档（first/even 读回来也没处写，
   PM 没有「首页另版页眉」这个节点）。与浮动锚点四枚同界。
5. **语料结构修正白捡一对**：`startOverride|val` 从 v0.142 起读手就写着
   （`w:num/w:lvlOverride/w:startOverride`），但语料把它与 lvlOverride **平级**摆——
   读手在 lvlOverride 里找它，平级那枚永远找不到，86 字面一直挂 NC。挪进正确的嵌套
   上下文后直接上账，读手代码一行没动。**教训：neverConsulted 不全是「读手没查」，
   也可能是「查问路径对但语料结构假」**——与 v0.150 的 multiLevelType（读手查错名字）
   正好一对镜像。

### 过程中的坑

1. **探针第一版三条断言错在「属性 vs 子元素」上**：restartNumberingAfterBreak 我按
   「CT_AbstractNum 的三枚身份都是子元素（nsid/multiLevelType/tmpl）」的思维定势写了
   子元素断言，实际它是开标签上的**属性**（且 w15: 前缀）。查包的真实输出才纠正。
   **v0.150 刚踩过 multiLevelType 的反面（以为属性其实是子元素），这轮踩了同族硬币的
   另一面——思维定势比无知更难防。**
2. **bdr 的 space=0 被自己的条件吞了**：写手 `/^\d+$/.test(space) && Number(space) > 0`
   把显式 0 筛掉——包里 createBorderElement 对 undefined 才不写，0 是写的。探针断言
   four-in-one 才发现少一枚。sz 保持 >0（零宽边框非法），space 收 0。
3. **README 锚点事故差点第三度重演**：插 v0.152 节时第一次 Edit 把 `## 性能（v0.3）`
   当锚点但新内容里也含它——改成「v0.151 节尾整段原样吐回 + 新节 + 锚点」的写法，
   diff 验证纯新增 45 行才罢休。

### 顺延清单（D12）

| 对（族） | 宇宙次数 | 备注 |
|---|---|---|
| `instrText\|space` | 1524 | 域指令的 xml:space，与 `t\|space` 同款噪声，倾向裁定不收 |
| VML 形状壳余量（roundrect/textbox/group/path/shapetype 一族） | 约 2,000 | 纯只读记账、机械但量大——v:shape 七枚之外的老式形状各族，单开一轮扫完 |
| `t\|space` | 348 | **裁定不查**（v0.143 起），同前 |
| `shape\|gfxdata` / `group\|gfxdata` / `roundrect\|gfxdata` | 7+163+135 | **裁定不收**（v0.149）：Word 缓存的图元字节 |
