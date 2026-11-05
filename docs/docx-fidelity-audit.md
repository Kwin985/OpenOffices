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

## v0.153（D12）——VML 形状壳余量全族 + 裁剪四边落到 CSS

**132 对上账、语料字面 137（宇宙字面 5,044）**；覆盖率**按对 58.1% → 77.4%、按字面
97.2% → 97.8%**；consulted 396 → 528，neverConsulted 286 → 154。

### 这一轮做了什么

老式形状（`w:pict`）那一整片：roundrect / line / rect / shapetype / group / textbox
六个形状壳、它们的填充（`v:fill`）、描边（`v:stroke`）、阴影（`v:shadow`）、图元路径
（`v:path` 的五个变换开关）、公式（`v:f`）、手柄（`v:h`）、画布坐标（`v:chExt`/`v:chOff`）、
遗留环绕（`w10:wrap`）与嵌入对象（`w:object` / `o:OLEObject`）。

读手新增 `VML_SHELL_ATTRS` 表与 `noteVmlShellMarks()`，跑正文前按名查问一遍（与
`noteDocumentMarks` / `noteShapeMarks` 同一格）。三条边界：

1. **只在 `w:pict` 子树里扫。** 全局扫会撞同 local name 的别家元素——OMML 的 `m:f`
   也叫 f、DrawingML 里也有 `a:cxnSpLocks`。撞名记出来的对是**假账**，宁可少扫。
2. **同一标签的多枚元素全扫。** 真实件一个 pict 里常有好几个 `v:shape` / `v:line`，
   各自带自己的 id/style；只认首枚等于把其余几枚的属性当不存在。旧读手是
   `findDesc(el,'shape')` 取首枚，这块本来就是欠账。
3. **gfxdata 五处一律不收**（v0.149 裁定延续）：shape/group/roundrect/line/rect 五处的
   Word 图元字节缓存，1,165 宇宙字面留在 neverConsulted 里不动。

**唯一落到屏上的是裁剪四边**：`v:imagedata` 的 `croptop/cropright/cropbottom/cropleft`
是 ST_Fraction（0..1 小数，Word 也发 `"5%"` 串），CSS `clip-path: inset()` 有直接对应物，
换算后挂 `<img>` 的 style，四边全 0 时不发。其余 128 对屏上零兑现、写侧也回不去
（包只发 DrawingML 内嵌图）——**单边通道**，探针里明写「输出不该有 croptop /
v:roundrect」而不是假装双向。

### 教训

1. **自己造的假账，自己查出来**：`bitmap()` 的 `blip` 是「a:blip 优先、无则
   v:imagedata」，而裁剪是 v:imagedata 独有的属性——照原样问一遍，账本上多出四枚
   「读手问 a:blip 要 cropbottom」的行。宇宙里没这几对，覆盖率一动不动，**只有把
   consulted 榜单摊开看才看得见**。改成按 local name 认回 VML 那一支。与「只在
   w:pict 里扫」是同一条原则：**问错对象比不问更坏**，因为它留下一笔看着像成绩的账。
2. **探针正则是我自己写错的**：断言 `clip-path: inset(` 带空格，产物是
   `clip-path:inset(`——第一版红在自己身上，不是产品上。改正则后全绿。
3. **漏 `--synth` 会写出缺一节的账本**：开轮那次干净腿没带 `--synth`，
   `docs/fidelity.md` 少了整段「Corpus provenance」，与 HEAD 差 41 行。备份到 tmp/
   后复位，正式腿记得带齐参数。

### 顺延清单（D13）

| 对（族） | 宇宙次数 | 备注 |
|---|---|---|
| `instrText\|space` | 1524 | 域指令的 xml:space，与 `t\|space` 同款噪声，倾向裁定不收 |
| `shape\|gfxdata` / `group\|gfxdata` / `roundrect\|gfxdata` / `line\|gfxdata` / `rect\|gfxdata` | 7+163+135+96+75 | **裁定不收**（v0.149）：Word 缓存的图元字节 |
| `t\|space` | 348 | **裁定不查**（v0.143 起），同前 |
| DrawingML 线端族（`prstDash\|val`、`tailEnd`/`headEnd` 各三枚、`srcRect` 四边） | 约 1,000 | 描边端头与裁剪框，屏上有半个对应物（border-style dashed / marker-end），需先定「兑不兑现」再扫 |
| 表与段落的零头（`tblOverlap\|val`、`vanish\|val`、`smartTag` 两枚、`spLocks\|noEditPoints`、`tblCellSpacing` 两枚） | 约 400 | 杂项，逐对裁决 |
| 批注族（`comment` 四枚、`commentReference\|id`、`comments(Ex)` 根 Ignorable） | 约 100 | 批注元数据，与 comments.xml 那条链同源，可一并扫 |
| `cnfStyle` 十三枚（条件格式的「哪一行哪一列」开关） | 520 | 一整族一个元素，屏上零兑现（无表样式条件格式），纯只读记账 |
| `endnotes`/`footnotes` 根 Ignorable | 148 | 与 v0.152 收的 numbering/styles 根 Ignorable 同款，两个部件各补一行 |

## v0.154（D13）——图片源裁剪框 / 表间距 / 隐藏文字 / 批注族改走漏斗

**33 对上账、语料字面 33（宇宙字面 1,452）**；覆盖率**按对 77.4% → 82.3%、按字面
97.8% → 97.9%**；consulted 528 → 561，neverConsulted 154 → 121。

### 这一轮做了什么

能兑现的三族 + 批注身份：

- **`a:srcRect` 四边**（292）：blipFill 的源裁剪框，千分比（25000 = 25%）→
  `clip-path: inset()`。与 v0.153 的 VML crop 是**同一件事的两代写法**（老式件用
  v:imagedata 的 0..1 分数、新式件用千分比整数），同折成 CSS，同时在场时按 VML 那一族。
  写侧发不出 → 单边通道，探针明写「输出不该有 srcRect」。
- **`w:tblCellSpacing`**（142）：→ `border-spacing`，且**必须同时切
  `border-collapse: separate`**（CSS 在 collapse 下忽略 border-spacing，Word 有间距时
  同样不共享格边）。写侧走 TBLPR 载荷补丁。
- **`w:vanish`**（88）：隐藏文字 → `visibility: hidden`（**不是 display:none**——Word 的
  隐藏文字不显示却仍占版面，display:none 会把布局一起改掉）。写侧是包里类型面暴露的
  原生槽 `IRunOptions.vanish`，与 v0.152 的 allCaps/border 同路数，不走库外断言。
- **批注族**（97）：从正则搬进 attr 漏斗（见下）。

纯只读记账：`cnfStyle` 十三枚（520，表条件格式落点开关）、脚注尾注两根 Ignorable（148）、
`smartTag` 两枚（160）、`tblOverlap` 与 `a:spLocks` 两枚（165）。

### 教训

1. **序是认真的，补丁锚点不能共用。** TBLPR 载荷那条补丁原本只有一套「插到第一个已知
   后续元素之前」的锚点（为 bandSize 写的，bandSize 排在 `w:tblW` **之前**）。把
   `w:tblCellSpacing` 接进同一串，它就被插到了 tblW 前面——而 CT_TblPrBase 的序里它排在
   tblW/jc **之后**。探针第一版跑出来 tblPr 长这样，肉眼看着「元素在、值对」，
   **只有把序摊开对才看得见**。改成两族各自一条登记 + 各自的锚点表。
2. **自己把自己绕进去一次**：`dt.cellSps` 里存的是**已序列化**的 XML 片段，补丁回调里
   又拿它去跑了一遍 `tblCellSpacingXmlOf`（那是吃载荷串的）→ 解析出空、整笔静默不发。
   与 bandMine 的口径不一致是根源（那边存的就是 XML）。教训：**同一个数组里的东西，
   存的是载荷还是片段，得在一处说死**。
3. **正则不进漏斗 = 账本盲区，这是第二次了**（第一次是 v0.147 的节属性）。批注的
   author/date/initials 一直在读、一直在用，可账本上从来没有——因为 `commentRowsOf`
   是正则。保真路径改用 `readComments`（parseXml + attr），兜底路径不动。

### 顺延清单（D14）

| 对（族） | 宇宙次数 | 备注 |
|---|---|---|
| `instrText\|space` | 1524 | 域指令的 xml:space，与 `t\|space` 同款噪声，倾向裁定不收 |
| `shape\|gfxdata` / `group\|gfxdata` / `roundrect\|gfxdata` / `line\|gfxdata` / `rect\|gfxdata` | 7+163+135+96+75 | **裁定不收**（v0.149）：Word 缓存的图元字节 |
| `t\|space` | 348 | **裁定不查**（v0.143 起），同前 |
| DrawingML 线端族（`prstDash\|val`、`tailEnd`/`headEnd` 各三枚、`srcRect` 已收） | 约 900 | 描边端头与箭头，屏上几乎没有对应物（CSS 的 marker-end 只对 SVG 生效），需先定「兑不兑现」再扫 |
| DrawingML 色彩与几何零头（`insideH`/`insideV` themeShade/themeTint、`alpha`\|val、`alphaOff`/`hueOff`/`satOff`、`prstClr`\|val、`tint`\|val、`xfrm`\|rot、`sizeRelH/V`\|relativeFrom） | 约 500 | 逐对裁决，多数屏上零兑现 |
| 阴影与三维（`outerShdw` 五枚、`reflection` 十三枚、`props3d` 三枚、`glow`\|rad、`blipFill`/`gradFill` 的 rotWithShape 与 flip） | 约 400 | 屏上零兑现（Web 没有 VML/DrawingML 的阴影与三维模型） |
| 杂项（`sym` 两枚、`pgNumType`\|start、`legacy` 三枚、`type`\|val、`prstTxWarp`\|prst、`col`\|w、`wAfter` 两枚、`h`/`rot`/`lightRig` 等） | 约 300 | 逐对裁决 |

## v0.155（D14）——符号出字 / 整篇底色 / 链接提示 / 图形变换 / 表单域与图形余量

**112 对上账、语料字面 121**；覆盖率**按对 82.3% → 98.7%、按字面 97.9% → 98.4%**；
consulted 561 → 673，neverConsulted 121 → **9**。

这一轮把 D14 顺延清单**一次清完**：清单上「逐对裁决」的几百对全部裁决掉，其中能兑现的
兑现、兑不了的只读记账。剩下的 9 对全在既有裁定「不收」名单里（见文末）。

### 这一轮做了什么

**读侧修掉三个「读到了但没落成输出」的洞**（账本上看不出来，因为一直是 consulted）：

- **`w:sym` 符号丢字**：老路 `case 'sym'` 只打 `this.warn('符号未导入')` 就 return，符号位
  上的 Wingdings 与项目符号整个消失。改读 `w:char`（十六进制码位）+ `w:font`，产出
  `<span style="font-family: Wingdings">&#xF0E0;</span>`。抓它的是探针的 MUST_NOT_SEE
  反向断言，账本永远不会报。
- **`themeRefCss` 的 shade/tint 从未被查问**：两枚 `attr()` 写在第三道 `return undefined`
  之后，主题解析不出时函数提前返回。表级 `insideH|themeShade`、`insideV|themeTint` 四对
  因此常年挂 neverConsulted。修法是把两枚属性提到三道 return **之前**恒查问——**查问与
  解析解耦**：解析不出仍然返回 undefined，但名字一定被问过。
- **块级 `w:sdt` 的 `sdtPr/id`**：`w:sdt` 两处分发，段落内的走 run 层、把整段/整表包住的
  走块层 `sequence()`。只补前者，块级控件的 `id|val` 依然问不到。

**读写两头新增的**：`w:background`（color/themeColor/themeShade，文档级，插入锚点是
`<w:body>` 之前）、`w:u` 的颜色三枚（→ `text-decoration-color`，**必须挂在 `<u>` 上**，
该属性不继承）、`w:hyperlink` 的 tooltip/tgtFrame（→ title/target）、段落余量五枚
（kinsoku/wordWrap/overflowPunct/suppressAutoHyphens/textDirection）、编号定义的
`styleLink`/`lvlRestart`/`lvlPicBulletId`。

**读侧兑现**：`w:em`/`w:ligatures`/`w:numSpacing`/`w:numForm`/`w:cntxtalts` →
`text-emphasis` / `font-variant-*`；`a:xfrm` 的 rot（÷60000）+ flipH/flipV → CSS
`transform`，与 srcRect 的 `clip-path` **并进同一个 style**。

**只读记账（占本轮七成）**：DrawingML 壳余量 52 对（色彩模型 prstClr/scrgbClr、虚线、
箭头两端、outerShdw/glow/reflection 光效全族、lightRig、props3d 挤出三枚、path、prstTxWarp、
textOutline、sizeRelH/V、wrapSquare、blipFill/gradFill 的 rotWithShape 与 flip）；
表单域 `w:ffData` 五枚；节余量七枚；表行 gridAfter/wAfter；`smartTag` 两枚；
`emboss`/`imprint`/`outline`；`aliases`、`creationId`、`fldChar@fldLock`、`ins@id`。

### 教训

1. **只在子树里扫，不按 local name 全树扫。** DrawingML 与 VML/OMML 有大量同名元素
   （`m:r`、`v:roundrect`、`a:prstClr` vs `v:prstClr`）。全树扫会在**错误的元素**上留下
   一笔「查问过」的账：数字好看、宇宙里根本不存在这对，覆盖率一动不动，只有把 consulted
   榜单摊开才看得见。所以整族只走 `allDesc(doc,'drawing')` 的子树。
2. **一个元素两个 local name 时两个都问。** universe 记的是 `props3d`，DrawingML schema
   里写的却是 `a:sp3d`，存盘两种都有。只问 schema 里那个名字，账上就是 0——selftest 报
   出来才发现的（三枚 `props3d|contourW/extrusionH/prstMaterial` 全红）。
3. **`w:background` 的锚点不是「第一个已知后续元素之前」，而是「`<w:body>` 之前」。**
   它是 CT_Document 的直接子元素、排在 body 前面；用通用锚点表会被插进 body 内部，
   Word 打开直接判损坏。
4. **生成器的块模型决定了量具的天花板。** 合成语料的上下文是一个个「开标签 + 关标签」的
   块，**不支持「嵌进另一块里的某元素」**。`w:col` 要出现在 `w:cols` **里面**，而带属性的
   那枚 `<w:cols>` 又必须留在 sectPr 的直系子级上（不然 `cols|num/space/equalWidth` 三对
   会掉出分子——试过一次，按对当场从 98.7% 掉到 98.2%）。完整回退，并在生成器里写了注释。
   **欠的是量具，不是产品**：真件里 `col|w`/`col|space` 是读的。

### 顺延清单（D15）

账上剩 9 对，**全部是既有裁定「不收」**，本轮无新增欠账：

| 对 | 语料字面 | 备注 |
|---|---:|---|
| `t\|space` | 348 | **裁定不查**（v0.143 起）：w:t 的 xml:space，纯序列化标记 |
| `instrText\|space` | 15 | 同上，域指令的 xml:space |
| `shape\|gfxdata` / `line\|gfxdata` / `rect\|gfxdata` / `roundrect\|gfxdata` / `group\|gfxdata` | 7+1+1+1+2 | **裁定不收**（v0.149）：Word 缓存的图元字节 |
| `col\|w` / `col\|space` | 1+1 | **量具限制**：生成器块模型不支持嵌入元素（见教训 4）。产品侧已读，真件语料上会自然上账 |

D15 若继续，方向不再是「扫榜」——榜单已经清了。可选的下一步：

- **把 `col|w`/`col|space` 的量具补上**：给生成器加一种「子上下文」能力（块里再开一个
  命名插槽），这是脚本层的活，与产品无关；补完按对可达 100%。
- **单边通道清单**：账本记的是「查问过」，不记「写得回」。目前已知单边至少有
  `a:srcRect`（v0.154）与本轮的 DrawingML 光效/三维/路径全族。要量化得另做往返探针
  （读→写→再读逐字段比对），这是比覆盖率更硬的一层。
- **变异腿扩大**：现在只有 `no-attr`/`no-attrL` 两条。可以加 `no-theme`（掐掉
  themeRefCss）验证主题链那批对的牙齿。

## v0.156（D15）——单边通道升双向四族 + 量具补子上下文与两条变异腿

覆盖率**按对 98.7% → 99.0%**（清掉 `col|w` / `col|space`），按字面 98.4% 不动。
这一轮换了靶子：账本只看「查问过没有」，剩下的洞它已经看不见了——**读得进、写不出**
的单边通道才是现在真正的缺口。

### 做了什么

**产品：四族从单边升双向**（走 charExtra 通道，与 v0.138 的 cs/lang、v0.152 的 bdr 同路）

| 族 | 读侧 | 写侧 |
|---|---|---|
| `w:u` 线型（`w:val` 十八档） | 新存 `uVal` | `underline.type`（原生槽） |
| `w:u` 颜色（`w:color`） | v0.155 已读 | `underline.color`（原生槽） |
| `w:em` 着重号型别 | v0.155 已读 | `emphasisMark`（**库外槽**） |
| `w:emboss` / `w:imprint` | v0.155 只记账 | 包里的原生布尔槽 |

线型与颜色此前**在屏上是画出来的**（`<u style="text-decoration-color: …">`），但 TipTap
的 underline mark 只认 `<u>` 标签名，inline style 进不了模型——**打开另存一次就没了**。
这是账本的第二层盲区：它记「查问过」，而这两枚确实查问过、也确实画了，丢在模型外它不管。

**量具一：spot 多了 `into` 字段。** `w:col` 必须是 `w:cols` 的子，而读手 `find` 取的是第一枚
`w:cols`；单开一个块去装主人，读手取的是别的那一枚——这两对挂了两轮。现在载荷可以嵌进同段
里第一枚同名元素的内部。

**量具二：变异腿两条变四条。**

| 腿 | 期望 | 实测 |
|---|---|---|
| `--mut no-theme` | 覆盖率**一动不动** | 99.0%/98.4%，consulted 集合与主腿**逐对相同、计数相同** |
| `--mut no-themeshade` | 覆盖率**下降** | 99.0% → 96.5%，掉 17 对（color/shd/四边/insideH/insideV/u 的 shade·tint） |

### 教训

1. **类型面没有 ≠ 实现没有。** `EmphasisMarkType` 只声明了 `DOT` 一个成员，可运行时
   `createEmphasisMark(type)` 就是把值原样写进 `w:em/@w:val`——circle/comma/underDot
   照传不误。判据必须是 dist 里的实现（`grep createEmphasisMark`），不是 `.d.ts`。
   同一条纪律 v0.138 起就在用（szCs/lang/pos/kern 全是这么定的）。
2. **「屏上画对了」不等于「存盘不丢」。** 这一族的洞是**只有往返探针抓得到**的：
   线型与颜色在 HTML 里看着完全正常，账本上也是 consulted，唯一暴露它的是「读 → 写 →
   看包里有没有」。保真账本到此为止，再往下要的是往返账。
3. **同一段里同一父元素的多笔载荷必须归并后嵌一次。** 第一版 `applyNest` 逐笔嵌，
   第二笔把「第一枚同名元素」认成了第一笔刚造出来的内部节点，嵌出
   `<w:col …><w:col …/></w:cols>` 这种错形套娃（标签还配不上）。按父元素名归并。
4. **`--mut no-theme` 是一条「不许动」的腿。** 变异腿不都是「必须掉分」——v0.155 那处
   「查问与解析解耦」的修法，正是靠这一腿守着：谁把 shade/tint 挪回三道 return 之后，
   主题解析不出来时这两枚就不查问了，这一腿立刻掉分。量具里既有 MUST_DROP 也有
   MUST_HOLD，与 selftest 的 MUST_SEE / MUST_NOT_SEE 同一套思路。

### 顺延清单（D16）

账上剩 **7 对**，全是既有裁定「不收」（`t|space`、`instrText|space`、`gfxdata` 五处），
**按对覆盖率已到顶**（99.0%，剩下的两成点数由噪声对占着）。

- **单边通道的总账还没做**：本轮只补了四族，已知单边还有 `a:srcRect`（v0.154）、
  DrawingML 光效/三维/路径全族、`ligatures`/`numSpacing`/`numForm`/`cntxtalts`（包里无槽，
  要上纸得新开 rPr 补丁机制）、`w:outline`（包里无槽）、hyperlink 的
  `tooltip`/`tgtFrame`（包里无槽）。要的是一份**通用往返账**（读 → 写 → 普查写出包），
  不是逐族的探针；本轮的 `tmp/check-d15.mjs` 是逐族探针那一档。
- **样式层的下划线色仍是单边**：`styleDefOf` 只发 `underline: {}`，样式定义里的
  `w:u` 颜色没上纸（`DocxStyleInfo.run` 上也没有这两个字段）。
- **`col|w` / `col|space` 已清**，生成器那条「块模型不支持嵌入元素」的限制随之解除。

## v0.157（D16）——往返账成立，顺带抓住两处真丢数据

覆盖率账到此换了靶子：保真账本问「读手按名查问了哪些对」，本轮开始问**下一句**——查问过、
也真读到了的东西，写回包里还在不在。按对覆盖率已到顶（99.0%，剩下 7 对全是既有裁定不收），
再往上扫榜只会扫到自己的噪声；而"读了写不回"这一层，账本一直是瞎的。

### 做了什么

**一份新账：`scripts/fidelity-roundtrip.mjs`**

一份夹具走完产品那条真路，然后普查写出包，逐对四选一：

| 档 | 判据 |
|---|---|
| 保留 | 名字在，且源的每个取值都能在写出包里找到 |
| 值变 | 名字在，但有源值没写回去 |
| 掉了 | 名字在写出包里一次都没出现 |
| 缺件 | 连承载它的部件都没写出来 |

分子只取 **源包里真在场 ∩ 探针记录过查问** 的对：查问了一个源里根本没有的属性不算业绩，
没查问过的属于保真账本，不在这里重复计。普查记的是**值分布**而不是"名字出现过"——同一个
属性在一篇里往往有好几种取值，只比名字会比出一堆假绿。

分两笔账（正文属性 148/263 = **56.3%**，图形壳 27/319 = 8.5%）：图形壳那一半是成心塞进去
照这条通道的（形状/文本框被读手展平成文字），混在一个百分比里什么也看不出来。

**抓到两处真丢数据**

1. **块级图片整张丢掉。** schema 里 `Image` 是 block 节点，读手把 `<img>` 发在块层，于是
   每张图在模型里都是顶层节点；写手的图片分支只有行内那一条，块级走末尾兜底 `para(node)`，
   而 `image` 节点没有 content——整张图被写成空段落。PM 里 5 张图，写出包 0 个 `w:drawing`。
2. **背景的字面色丢掉。** 有主题槽时写作侧不写字面色，于是
   `<w:background w:color="FFE699" w:themeColor="background1" w:themeShade="BF"/>` 一往返
   只剩主题三枚。主题槽确实压过字面色，但字面色是主题取不到时的兜底值。

### 教训

1. **探针按"我以为的形状"构造，就和产品各演各的。** 逐族探针（v0.155/v0.156 那批）构造 PM
   时把图放在段落里，因为行内才是"正常"写法；真实链路送进来的却是**块级**节点。两头都对，
   中间那条路没人走过。所以量具的输入必须来自**产品的真出口**，不能来自手搓的模型。
2. **`inline: false` 这类缺省值是隐形的契约。** 查 schema 形状不能查文档，要查实现：
   `grep inline node_modules/@tiptap/extension-image/dist/index.js` 才看得见那条缺省。
   同一条纪律 v0.156 用在 `EmphasisMarkType` 上（类型面只列 dot，运行时照传 circle）。
3. **量具自己也要能被量。** 把扩展清单、夹具、探针注入抽成模块之后，保真账本的 md5 逐字节
   不变（`cd953d32…`/`1c67668b…`）——这就是"搬移无损"的证明，比读 diff 可靠。同一份纪律
   换成"确定性"：账本正文里不写日期，复跑两次逐字节相同（`50ae1324…`/`4d316767…`）。
4. **账本要按 rev 复现，脏工作树就该拒绝跑。** 读手走副本（要注探针），写手与 schema 走产品
   源，所以补一条硬闸：`git show <rev>:file` 与磁盘逐字节比，不一致直接报错。否则工作树改
   一行，同一份账本第二天就换了数。
5. **归一化要先想清楚"哪部分是包内编号"。** 关系 id（`rId1` 到写出包成了 `rId8`，超链接那
   枚还会长成 `rIdWWcn…`）是包内重排的，逐字比全是假红；`true/1/on` 同理（ST_OnOff 两套
   写法）。但 `docPr/@id` 这类对象序号**不归一**——它确实被重排了，那笔差异是真实的账。

### 顺延清单（D17）

- **编号定义的元数据整族没落地**：`suff`/`lvlRestart`/`lvlPicBulletId`/`styleLink`/`tmpl`/
  `nsid` 读手都写进了 meta，可写出包的 `numbering.xml` 里一条都没有——补丁按指纹认领
  abstractNum，而列表被 ListRegistry 重建后指纹对不上，于是"认不出不贴"整篇跳过。这不是
  漏一枚，是整族。要动的是"导入的编号定义如何与重建的列表对应"这个设计。
- **`w:sym` 只读不写**：v0.155 修的是"读到了却丢字"，符号本身进模型了，但写手没有 `w:sym`
  的槽（包外），落纸要新开一个 rPr 补丁位。
- **`w:u` 的字面色**：主题槽在场时 `uColor` 记的是解析结果，字面色不单存一份（与背景那处
  同型，背景已修，下划线这一处还欠着）。
- **`cNvPr` 的图形级 `descr`**：写出包只留画布级（`wp:docPr`），图形级那一枚没回写。
- **页边距的换算精度**：`1800 → 1797`（缇 → 毫米 → 缇 的往返），`gridCol` 的 `2500 → 2505`
  同源。要保住得让 meta 存缇而不是毫米。
- **`w:cols` 的 `equalWidth`**：源里 0（逐栏宽度 2000/3000）往返成 1（等宽），逐栏 `w:col`
  从模型里没有出处。

## v0.158（D17）——编号定义整族落地

往返账**正文属性 56.3% → 62.4%**（164/263），图形壳 8.5% → 8.8%。这一轮动的都是上一轮那份
顺延清单上的条目，第一条是**整族**性质的。

### 编号定义的元数据：八对一起从「掉了」翻成「保留」

`w:abstractNum` 上的 `nsid`/`tmpl`/`styleLink`/`multiLevelType`，逐层 `w:lvl` 上的 `suff`/
`lvlRestart`/`lvlPicBulletId`/`tplc`/`tentative`——读手一条不少地读进了 meta，写出包里一个
都没有。

根子不在补丁，在**重建方式**：写手的 `ListRegistry` 只按「这一串列表在模型里的档位」造编号
定义，`listLevels` 把三层全用第 0 层那个符面。于是源里 `0:bullet|·;1:lowerLetter|%2.` 这种
多级定义被拍成 `0:bullet|·;1:bullet|·;2:bullet|·`。而 `patchNumberingXml` 靠内容指纹认领
定义、**前缀全等**才配——第二层对不上就整条跳过。不是漏一枚，是这一族全跳。

修法分两步：

1. **读手把每层自己的 `numFmt`/`lvlText` 存进 `DocxLvlMeta`**（新增 `fmt`/`text`）。从前这两枚
   只以合并串的形式活在 `fp` 里（`0:bullet|·;1:lowerLetter|%2.`），写手取不到「第 1 层是
   lowerLetter」这种信息。
2. **写手认领定义后照原样逐层发**。`defLvlsOf` 把逐层档位还原成包认得的形状，有一层认不出
   （不在 `LevelFormat` 那 63 档里）或层号跳着来就整条不认——与 `patchNumberingXml` 同一条
   「认不出就不贴」。源有几层写几层，**不足三层用按段档位补齐**（段落引用的层号被截到 2，
   写少了 Word 那一段没有档位可用；多出来的尾层不影响对位，比的是前缀）。

认领只比**第 0 层**：更深那几层本来就是被拍平拍没了的东西，拿它们当判据等于永远认不出。
第 0 层是屏上那一串真正用的档位，读手把它带进了模型（`<ol type>` / `<ul data-marker>`），
两边对得上。一份定义只给一串列表用，第二串不去抢（`patchNumberingXml` 也是一份定义只贴
一枚）。

顺带一个真收益：**多级列表的第二、三层档位不再被拍平**。源里第 2 层是罗马数字的，导出后
还是罗马数字——从前它们会跟着第 0 层一起变成十进制。

### 图片的两枚名字

写手把 alt 同时塞进 `name` 与 `descr`，而读手取 alt 是「descr 优先、name 兜底」——一来一回，
源里的对象名就被替代文本顶掉了（`图片 1` → `画布级替代文本`）。名字在 Word 的选择窗格与
定位里是要用的。图形级那枚 `descr` 更直接：包只发画布级，它整条没有。两枚都改走已有的
图片壳补丁（`data-img` 载荷），不新开机制。

### 页边距的换算精度

`1800 → 1797`、`851 → 850`。缇 → 毫米只留一位小数是**不可逆**的：1800 缇 = 31.7499…（浮点上
差一点到不了 31.75），`Math.round(317.4999)` 得 317 → 31.7 → 回算 1797。两位小数把往返误差
压到 0.3 缇以内。两处换算（保真导入的 `pageSetupOf` 与 `docxToDocMeta` 里的页面提取）用同
一把尺子，改一处忘另一处就会一边进一边出。`gridCol`/`tcW` 那 ±5 缇不是这一族——它在模型的
`colwidth`（整数像素）那一层量化掉的，改换算没用。

### 账本自身的三处假红

| 归一处 | 为什么是假红 |
|---|---|
| `lvlJc`/`jc` 的 `start`≡`left`、`end`≡`right` | ST_Jc 的两套写法（docx 库发 start，Word 发 left） |
| `mc:Ignorable` 按空格拆成一串前缀 | 写手比源多声明 `w15`/`wp14` 两个兼容前缀不是丢东西 |
| ISO 时刻按 `Date` 归一 | `…T10:00:00Z` 与 `…T10:00:00.000Z` 是同一刻 |

**假红比真红更坏**——它占着榜单，真信号就看不见了。归一只认名字（`start`/`end` 在别的属性
上是别的意思），不认值。

### 教训

1. **「整族掉了」通常不是 N 个 bug，是 1 个设计。** 八对一起挂在账上，逐对去找能找到八处
   各自的原因（`nsid` 没写、`suff` 没写…），而真因只有一个：编号定义是**按段重建**的，
   与源那份定义不是同一棵树，指纹因此对不上。修的是重建方式，不是八枚属性。
2. **判据不能取自己弄丢的那一维。** 用「所有层都对得上」去认领定义，而层信息正是被自己
   拍平拍没的——这判据永远为假。认领改比第 0 层，第 0 层是模型里真有的东西。
3. **human-readable 的串不是数据。** `fp`（`0:bullet|·;1:lowerLetter|%2.`）当初是拿来给
   人看、拿来比对的，写手要逐层的值时它就成了「有信息但取不出来」。该存字段就存字段。
4. **不可逆的换算要按往返误差定精度，不是按显示需要。** 一位小数在 UI 上够用，在往返上
   不够——UI 的尺子和保真的尺子不是同一把。

### 顺延清单（D18）

- **`w:sym` 只读不写**：符号进模型了（v0.155 修的是「读到了却丢字」），但写手没有 `w:sym`
  的槽（包外），落纸要新开 run 级补丁位。
- **`w:u` 的字面色**：与 `w:background` 同型，但 `docx` 的 `underline` 只有 `{type, color}`
  没有主题槽，`w:themeColor`/`w:themeTint` 同样要靠 run 级补丁。与 `w:sym` 是**同一条机制
  债**——先还它，两处一起通。
- **`gridCol`/`tcW` 的 ±5 缇**：模型的 `colwidth` 是整数像素，5000 缇 → 333 px → 4995 缇。
  要保住得让模型存缇，动的是 schema 不是写手。
- **`w:cols` 的 `equalWidth` 与逐栏 `w:col`**：模型没有分栏这个概念，源里 0（逐栏
  2000/3000）往返成 1（等宽）。
- **`ind|left` 的列表缩进覆盖**：编号层的缩进（720×(层+1)）盖掉了段落自身的缩进值。
- **`docPr|id` 的对象序号重排**：源 7/8/9/11/12，写出 1/7/8/11——不发图形的（形状、艺术字
  被展平成文字）不占号，序号就跟着重排了。
- **`lvlJc|val` 的 `center`**：归一只去掉了 `start` 那枚假红，剩下的 `center` 是真丢——
  模型只带第 0 层的对齐，深层的对齐带不回来。

## v0.159（D18）——run 级补丁位：`w:sym` 回真，`w:u` 的主题三枚跟着回来

### 这一轮做了什么

顺延清单上写的是「`w:sym` 与 `w:u` 的字面色是同一条机制债，都是包外槽，要 run 级补丁位」。
查了 `docx` 的实现，这条判断**只对了一半**：

| | 结论 | 依据 |
|---|---|---|
| `w:sym` | **不需要补丁位** | 包里有 `SymbolRun`：`super("w:sym")` + `xmlKeys = { char: "w:char", symbolfont: "w:font" }` |
| `w:u` 的主题三枚 | 确实要补丁位 | `createUnderline(type, color)` 只写 `w:val` 与 `w:color` |

所以 `w:sym` 那一半的真因不是「缺机制」，是**读手没把原值带进模型**：符号从前被当普通
文字发出去，屏上分毫不差，存盘变成 `w:t` + `rFonts`，`w:sym` 这枚元素整个消失。

具体改动：

1. **`data-sym` 载荷**（`char;font` 原值，char 不做大小写与补零的规整）→ `charExtra.sym`
   → 写手发 `SymbolRun`。只有「一个 run 一个字符」且 char/font 都在时才发：一枚 `w:sym`
   只表达一个码点，多字符硬发会吞字；`symbolfont` 缺省是 `Wingdings`，猜字体比写错更坏。
   带超链接或修订壳的符号不走这支（那两支的 children 类型不收 `SymbolRun`），退化为普通
   文字——字还在，`w:sym` 丢，这条边界写进注释。
2. **`data-u` 载荷两格 → 六格**：`线型;屏上色;字面色;themeColor;themeTint;themeShade`。
   屏上色只给编辑器画屏，字面色走包的原生槽，主题三枚走新开的补丁位。
3. **`patchUTheme`**：第五处打包后补丁。按 `<w:u>` 出现序贴属性串，计数闸门兜底；
   `(?=[\s/>])` 收边，避开 `w:unhideWhenUsed` / `w:uiPriority` 这些同前缀元素。
4. **`themeRefCss` 拆成 `themeRefParts` + `themeCssOf`**：前者查问三枚、回原值（`w:u`
   要把原值带进模型），后者纯解析。变异腿的注入锚点随之搬家。
5. **结构测试的三处陈旧口径**：三条断言拿 `<w:pos>` 当输入，而读手从 v0.151 起读
   `<w:position>`（`CT_RPr` 里没有 `w:pos`）——一直红着没人跑到，因为脚本不在常规门禁里。
   改对之后 53 项全绿，并补了符号与下划线主题色的十二条断言（含三条反例）。

### 账

| | 上一轮 | 这一轮 |
|---|---:|---:|
| 正文属性 | 164/263 = 62.4% | **169/263 = 64.3%** |
| 图形壳 | 28/319 = 8.8% | 28/319 = 8.8% |
| 合计 | 192/582 = 33.0% | **197/582 = 33.8%** |
| 值变 | 22 | 21 |

五对：`sym|char`、`sym|font`（掉了 → 保留）、`u|color`（值变 → 保留）、`u|themeColor`、
`u|themeTint`（掉了 → 保留）。

保真账**逐字节不变**（`95846f03…`/`aab9813c…`）——这一轮动的是写手与载荷形状，读手的
查问集一枚没动，账本 md5 就是这条断言的证明。往返账 md5 `a6eb5d52…`/`bfe80bf0…`，
两次复跑逐字节相同。

四条变异腿：`no-attrL` 51.8%/83.5%、`no-attr` 59.2%/42.1%（两条同前，数字一字未变——
说明这一轮没动漏斗路径）、`no-themeshade` 96.5%/98.3%（掉 28 对）、`no-theme`
**99.0%/98.4%，一动不动**（守 v0.155 的「查问与解析解耦」）。

### 教训

1. **顺延清单上的判断也要复核。** 清单说两处都要补丁位，查一眼 `dist/index.mjs` 就省掉
   一半的活。清单是「当时的判断」，不是判决书——写它的人当时也没空去读包的实现。
2. **同一枚元素的「字面」与「解析后」是两个槽，不是两种用途。** 把 `w:color` 与
   `w:themeColor` 合并成一个「屏上颜色」字段，写手就只能挑一个写回去——往返账上那笔
   `ff0000 → b4c7e7` 值变，就是合并的代价。载荷要**按槽分格**，不按用途分格。
3. **变异腿长在代码形状上。** 拆函数当场让 `no-theme` 的注入锚点失配（「命中 0 次」）。
   腿的价值在于它**会喊**：静默通过才可怕。代价是每次重构都要同步锚点——这是它该有的成本。
4. **测试脚本的口径会过期，而过期的断言不会自己变红。** 三条 `w:pos` 从 v0.151 起就不
   可能命中，红着躺了八轮没人知道。脚本不进常规门禁，「红是常态」这件事本身就该记一笔。
5. **机制建起来就该顺手泛化。** 补丁位这一轮只服务 `<w:u>`，而 `w:color` 上的主题三枚是
   同一个形状（1 对仍在掉了名单里）。下一轮把它泛化成 `patchElemAttrs(bytes, tag, extras)`。

### 顺延清单（D19）

- **run 级补丁位泛化**：`patchElemAttrs(bytes, tag, extras)`。`w:color` 的
  `themeColor`/`themeTint`/`themeShade`（1 对，掉了）是同一条形状——读手已有解析值、
  写手只有字面槽。顺带给 `w:shd` 一族做个判断（它是否也缺同型槽）。
- **`ind|firstLineChars` / `hangingChars`**（1 对）：字符单位的缩进。`pprExtraXml` 的
  通用载荷通道加两格即可，不必新开机制（`PPR_WRITE_ORDER` 里补位次）。
- **`insideH|space`**（1 对）：表格内边框的「边框与文字的距离」。`bordersXml` 走
  `cellBorder` 那条，space 在部分边里没写。
- 承接 D18 未动项：`gridCol`/`tcW` 的 ±5 缇（要动 schema，模型存整数 px）、`w:cols` 的
  `equalWidth` 与逐栏宽度、`ind|left` 的列表缩进覆盖、`docPr|id` 的对象序号重排、
  `lvlJc` 深层的 `center`。

---

## v0.160（D19）——补丁位泛化成任意元素：文字色的主题引用与缩进的字符档

| | 上一轮 | 这一轮 |
|---|---:|---:|
| 正文属性 | 169/263 = 64.3% | **174/263 = 66.2%** |
| 图形壳 | 28/319 = 8.8% | 28/319 = 8.8% |
| 合计 | 197/582 = 33.8% | **202/582 = 34.7%** |
| 掉了 | 364 | 359 |
| 值变 | 21 | 21 |

五对：`color|themeColor`、`color|themeTint`、`color|themeShade`、`ind|firstLineChars`、
`ind|hangingChars`（全部「掉了 → 保留」）。保真账按对仍 99.0%，md5 逐字节不变
（`95846f03…`/`aab9813c…`）——这一轮动的仍是写手与两枚载荷。往返账 md5 `0135a0d1…`/
`b36aa62d…`，两次复跑逐字节相同。

### 做成的两件事

1. **`patchUTheme` → `patchElemAttrs(bytes, tag, extras)`。** 第二处同形状需求（`w:color`
   也带那三枚主题引用）一来，泛化就是顺手的。两族的登记数组**分开**（`uThemes` 与
   `colorThemes`）：对位靠的是各自元素的出现序，合成一串就错。闸门成立的前提写进头注——
   脚注/批注那一支在我们的写手里走简单文本、不登记，所以枚数对得上。
2. **`w:ind` 的两枚字符档走既有 PPR 载荷通道**，只是键带 `ind` 前缀（`indFirstLineChars`），
   因为它们是**同一枚元素的两个属性**而不是两个元素。`pprOrder` 因此多一条**同名元素
   合并属性**：`w:ind` 在 `CT_PPrBase` 里是单枚，插第二枚会让 Word 只认后写的那一枚。

### 没做的一件事（以及为什么）

`w:color` 与 `w:u` 形状完全相同，但这一轮**没有**照搬「字面/解析分两格」。判据是：
**模型的 `textStyle.color` 是用户可编辑的单一事实源**。拆出字面槽之后，写盘取源里的
`ff0000`，用户在编辑器里改了色再存盘，出去的还是 `ff0000`。「改了色导出却不变」比账上
一笔值变坏得多，所以 `color|val` 继续挂着值变。

u 那边可以拆，是因为下划线颜色在编辑器里没有入口。**能不能被用户改**决定了同一形状的
两个槽该不该分——这条判据此前没写下来，这一轮补上。

### 教训

1. **泛化的时机是「第二处同形状需求出现」，不是第一处。** 第一处时只有一个样本，猜不出
   哪个维度该参数化（这一轮证明要参数化的是**元素名**，不是「属性串怎么拼」）。
2. **「单枚元素」这件事要在写侧显式处理。** `pprOrder` 从前只管插入，遇到包自己已经发了
   `<w:ind>` 的情形就会造出第二枚——Word 静默丢前一枚，缩进变样，而往返账只看值不看
   元素枚数，抓不到。**量具看不到的一类 bug，得靠读 schema（`maxOccurs`）来防。**
3. **同一个形状的两处，可以有不同的决定。** 文字色不拆字面槽、下划线拆，两者都对——差别
   在「用户能不能改」。纪律不是「照上一次做」，是「把判据说出来」。

### 顺延清单（D20）

- **`rFonts` 的 `asciiTheme`/`eastAsiaTheme`/`hAnsiTheme`**（3 对）：与 `w:color` 同一形状
  的第三处，补丁位已就绪（`patchElemAttrs(bytes, 'rFonts', …)`），缺的是读手把引用名带出来。
- **量具口径：`ST_OnOff` 的「裸元素在场」应归一成 `|val = 1`。** `caps|val`、`vanish|val`、
  `widowControl|val` 这几笔是账本自己的假红——头注里写着 `true/1/on` 归一，漏了「元素在场
  而无 `w:val`」这一档（包的 `createBold` 之类就是这么发的）。**先修账本再修产品**，否则
  假红占着榜单，真信号看不见（v0.157 那条教训的又一次）。
- **`insideH`/`insideV` 的 `space` 与主题三枚**（8 对）：要新开「表级边框原值」通道，与读手
  「表级边框分摊到格」的既定口径冲突（分摊后 padding 会重复计数）——**先定口径再动代码**。
- **`cnfStyle` 十二对**（表条件格式账）、**`fldChar` 三对**（域指令，模型无槽）。
- 承接未动项：`gridCol`/`tcW` 的 ±5 缇、`w:cols` 的 `equalWidth`、`ind|left` 的列表缩进覆盖、
  `docPr|id` 重排、`lvlJc` 深层 `center`。

---

## v0.161（D20）——先修账本：量具口径本身会造假红

| | 上一轮 | 这一轮 |
|---|---:|---:|
| 正文属性 | 174/263 = 66.2% | **189/273 = 69.2%** |
| 图形壳 | 28/319 = 8.8% | 28/319 = 8.8% |
| 合计 | 202/582 = 34.7% | **217/592 = 36.7%** |
| 掉了 | 359 | 355 |
| 值变 | 21 | 20 |

四对翻正（掉了 → 保留）：`caps|val`、`rFonts|asciiTheme`、`rFonts|eastAsiaTheme`、
`rFonts|hAnsiTheme`。另有十对是**分母补进来**的（此前根本不在账上）：`bCs|val`、
`iCs|val`、`smallCaps|val`、`pageBreakBefore|val`、`keepNext|val`、`keepLines|val`、
`snapToGrid|val` 等——源里那些裸 OnOff 元素此前不产生任何属性，census 看不见它们。
`vanish|val` 由「掉了」翻正、`widowControl|val` 由「值变」翻正。

保真账本按对仍 99.0%，md5 仍 `95846f03…`/`aab9813c…`。往返账 `18516b03…`/`bb5367ca…`，
两次复跑逐字节相同。

### 一、口径：`<w:vanish/>` ≡ `w:val="1"`

这一条**不改产品，改量具**。`ST_OnOff` 元素可以不写 `w:val`——`<w:vanish/>` 与
`<w:vanish w:val="1"/>` 是同一件事的两种写法，包的 `OnOffElement` 传 `true` 时发的就是
裸元素。普查只按属性取值，裸元素压根进不了 `values`：源写 `w:val="1"`、写出包发裸元素，
账上记一笔「掉了」，而两边的值一模一样。

修法是 `census` 对一张 `ST_OnOff` 元素名单（四十余枚）补一条：没写 `w:val` 时记一笔
`val=1`。动手前先把**漏了的后果**想清楚：漏掉的元素两边都不补，最多留一笔假红，
**不会造假绿**。方向是保守的——假红占着榜单比造假成绩好得多（v0.157 那条教训）。

同一条纪律的延伸：这条口径写进了结构测试（读账本 `definition.onOffBareElement` 自陈
字段 + 三对的状态）。**账本不自查，假红就一直占着榜单**——量具的输入是产品，量具本身
的口径却没人测。

### 二、真被库吞掉的一枚：`<w:caps/>`

一个 run 同时要小型大写与全大写时，写出包里只有 `<w:smallCaps/>`，`w:caps` 整个消失。
真因在包里（`RunProperties`，dist/index.mjs:10538）：

```js
if (options.smallCaps !== void 0) this.push(new OnOffElement("w:smallCaps", options.smallCaps));
else if (options.allCaps !== void 0) this.push(new OnOffElement("w:caps", options.allCaps));
```

是 `else if`，两枚在库里互斥——不是我们传错了，也不是模型没带。**这一笔假红能挂这么久，
是因为归一之前它和 `vanish`/`widowControl` 那几笔混在一起，看不出哪个是真的。**
「先修账本」的第一个回报就是这个：假红清掉，真信号才浮出来。

补法是一枚新的打包后补丁 `patchBeforeElem`（按 `<w:smallCaps>` 出现序在它前面插
`<w:caps/>`,`CT_RPrBase` 里 caps 排在 smallCaps 之前）。没有与 `patchElemAttrs` 合并——
那一族是「属性补进已有开标签」，这一族是「元素补进已有父的子女位」，动作不同；合并就得
在一个函数里同时参数化「插哪」与「插什么」。

登记放在 `withCharExtra` **内部**而不是 `childToRuns` 里：发 smallCaps 的路径有五条，
漏一条就整体错位。这跟「闸门对的是枚数」是同一件事的两面——**对位纪律的脆弱点永远是
「漏登记」，不是「贴错」**。

### 三、样式的主题字体引用：继承来的不算自己说过

`RunProps.fontThemes`（四枚 `*Theme` 原值）+ 写手按 styleId 补进该样式自己那枚
`<w:rFonts>`。与 `w:color`（v0.160）同一形状的第三处，但**通道不同**：那一族在
document.xml 的 run 上（补丁位按出现序），这一族在 styles.xml 的样式上（按 styleId）。

坑在 `styleList()` 是**沿 basedOn 链合并**的：Normal 的引用名会被摊到 Report /
ReportHead / ReportChar 上（写出包里这四枚各有 rFonts，源里只有 Normal 一枚）。摊出来
的那些不该凭空戴引用名——包自己会沿 basedOn 摊字体，再写一遍等于「用户在这一层也钉了
一次」。于是 `fontTheme` 只按 `info` 自己的 rPr 取（传 `NONE` = 不继承），链合并那一趟
不落这一格。

**「继承来的」与「自己说过的」是两件事**——这一条在编号定义那次（v0.158）已经付过一次
学费（认领只比第 0 层），这次是第二次。

### 教训

1. **量具的口径本身会造假红，而且不会自己喊。** 归一化表写的是 `true/1/on` 归一，漏了
   「元素在场而无 `w:val`」这一档——它安静地记了八轮假红。**账本要自查**（把口径写进
   `definition` 自陈字段 + 结构测试断言），否则「先修账本」这句话永远只是一句口号。
2. **假红清掉之前，真信号浮不出来。** `caps|val` 这一笔真丢与 `vanish|val` 那两笔假红
   混在同一张榜单上，八轮里没人分辨过。
3. **对位纪律的脆弱点是「漏登记」。** 五条路径发 smallCaps，登记漏一条就整体错位——所以
   登记放进 `withCharExtra`（唯一出口），不放进 `childToRuns`（五个调用点之一）。
4. **「继承来的」与「自己说过的」要分格**（第二次付这条学费）：链合并用于**屏上**（要
   的是最终生效值），按自己 rPr 取用于**存盘**（要的是源件写过什么）。两处用途不同，
   取数方式就该不同。

### 顺延清单（D21）

- **`insideH`/`insideV` 的 `space` 与主题三枚**（8 对）：要新开「表级边框原值」通道，与
  读手「表级边框分摊到格」的既定口径冲突（分摊后 padding 会重复计数）——**先定口径再动代码**。
- **`cnfStyle` 十二对**（表条件格式账）：模型无槽，要样式表级补丁。
- **`fldChar` 三对**（域指令，模型无槽）。
- **`outline|val`**（文字镂空）：与 emboss/imprint 同族，但**包里没有原生槽**
  （类型面那些 `outline?` 是 DrawingML 的图形轮廓，不是它）——只能走 run 级补丁位。
- 承接未动项：`gridCol`/`tcW` 的 ±5 缇、`w:cols` 的 `equalWidth`、`ind|left` 的列表缩进
  覆盖、`docPr|id` 重排、`lvlJc` 深层 `center`。

---

## v0.162（D21）——从「只记账」升成「只往返」：表条件格式的落点开关

| | 上一轮 | 这一轮 |
|---|---:|---:|
| 正文属性 | 189/273 = 69.2% | **202/273 = 74.0%** |
| 图形壳 | 28/319 = 8.8% | 28/319 = 8.8% |
| 合计 | 217/592 = 36.7% | **230/592 = 38.9%** |
| 掉了 | 355 | 342 |
| 值变 | 20 | 20 |

十三对一次性翻正（掉了 → 保留）：`cnfStyle|val` 与十二枚落点开关。保真账本按对仍
99.0%，md5 仍 `95846f03…`/`aab9813c…`；往返账 `57bd1179…`/`7cf688ae…`，两次复跑逐
字节相同。

（顺带纠正一处计数错误：D20 的顺延清单里写「`cnfStyle` 十二对」，漏数了 `val` 那一枚。
实际十三对。清单上的数字是会错的，动手前重新数一遍。）

### 记账与往返是两趟

这一族从 v0.154 起是**纯只读记账**：`noteCnfStyleMarks` 整树扫、十三枚按名查问、一个数
也不落地。记账管的是保真账本（「查问过哪些对」），与往返账不是一回事。

**升成「只往返」时记账那一趟要留着**——它还负责 `w:tcPr` 里那些**格级** cnfStyle 的
查问。格级这一轮不给通道：模型里没有「这一格落在表样式的哪一块」这个概念，硬加一枚只
往返的属性，不如先承认它是账。

于是两趟并存、各记各的，且**名单必须同源**——`CNF_STYLE_ATTRS` 原先是自己写死的一份
十三枚数组，改成直接指向 `cell-style.ts` 的 `CNF_KEYS`。两份名单迟早会走散，而走散那
天账本上会多出一对谁也说不清的假红。

### 载荷定序而不是 key=value

`data-cnf="000000100000;1;0;1;0;1;0;1;0;1;0;0;0"`，`CNF_KEYS` 的序即格序。与旁边的
`data-tblpr`（key=value）不同款，理由也写在旁边：十三枚是**固定集合**（不会像 ppr 那样
逐版增补），定序更短更稳；`val` 有形状可校验（不是 12 位 `0/1` 就整格丢，与
`parseTblPrPayload` 的「脏值整键丢」同款）。

### 第四笔 tblPr 补丁，第三张锚点表

`w:cnfStyle` 紧跟 `w:tblStyle`、排在 `w:tblpPr` 之前——与在场三族（tblLook 贴末位、
bandSize 在 tblW 前、cellSpacing 在 tblW 后）位次都不同，自带第三张锚点表
（v0.147 那条教训：同一套锚点表不能给两组元素共用）。

### 教训

1. **同一个函数的两条出口都要改。** `patchTblLook` 有两条返回路径（有编号定义时先走
   `patchNumberingXml` 再补、没有就直接补），我改了前一条漏了后一条，结构测试第一遍
   五条断言全红。**漏改不报错，只是安静地什么都不做**——这正是打包后补丁这类代码的
   典型失效方式。
2. **清单上的数字是会错的。** 「cnfStyle 十二对」漏数了 `val`。动手前重新数一遍，别把
   清单当判决书（v0.159 那条教训的另一面）。
3. **「只记账」升成「只往返」时，记账那一趟要留着。** 两趟读的是同一批名字但记的是两
   本账，砍掉记账那一趟等于从保真账本上抹掉 tcPr 里那些格级开关。

### 顺延清单（D22）

- **`insideH`/`insideV` 的 `space` 与主题三枚**（8 对）。**口径已定**（这一轮定的，不再
  含糊）：只加**存盘通道**（表级边框六边原值走 `data-tblb` 载荷 + 补丁回纸），
  **不动屏上分摊**。两者是两回事——分摊是 CSS（格边 padding），存盘是 OOXML 原件，
  不存在「padding 重复计数」的问题；此前担心的冲突是把两趟当成一趟才有的。
- **`fldChar` 三对**（域指令，模型无槽）；**`outline|val`**（文字镂空，包无原生槽）。
- 表/节一族：`tblStyle|val`、`col|w`/`col|space`（分栏）、`wAfter|*`、`gridAfter|val`、
  `pgNumType|*`、`smartTag|*`、`legacy|*`。
- 承接未动项：`gridCol`/`tcW` 的 ±5 缇、`w:cols` 的 `equalWidth`、`ind|left` 的列表
  缩进覆盖、`docPr|id` 重排、`lvlJc` 深层 `center`。

---

## v0.163（D22）——表级边框：存盘通道与屏上分摊是两本账

| | 上一轮 | 这一轮 |
|---|---:|---:|
| 正文属性 | 202/273 = 74.0% | **215/275 = 78.2%** |
| 图形壳 | 28/319 = 8.8% | 28/319 = 8.8% |
| 合计 | 230/592 = 38.9% | **243/594 = 40.9%** |
| 掉了 | 342 | 334 |
| 值变 | 20 | 17 |

八对目标全部翻正（掉了 → 保留）：`insideH`/`insideV` 的 `space` 与 `themeColor`/
`themeTint`/`themeShade`。顺带三对从「值变」回「保留」（`bottom|space`、`left|space`、
`right|space`），另有两对**此前根本不在分母里**（`insideH|color`、`insideV|color`）。
保真账本按对仍 99.0%，md5 仍 `95846f03…`/`aab9813c…`；往返账 `293c39a0…`/`9e797368…`，
两次复跑逐字节相同。

### 一、口径：分摊与原件是两趟，不是一趟的两半

前三轮的顺延清单都写着「与读手『表级边框分摊到格』的口径冲突，得先定口径」。这轮定死了：

- **分摊是 CSS**（表级六边的 space 落到格边 `bdSpace*` → 格边 padding），
- **存盘是 OOXML 原件**（`w:tblBorders` 六边各七枚属性）。

两趟各记各的，不存在冲突——此前担心的「padding 重复计数」是把两趟当成一趟才有的。所以
这一族**只加存盘通道**，屏上那一趟一个字不改。

反向的那半同样重要：**拿分摊后的值回写表级，等于把屏上的换算误差写成源件说过的话**。
pt↔px 两趟换算加上逐格覆盖之后，格边那个数与表级原件已经不是一个数。

### 二、整片替换，而不是属性补丁

包恒发 `<w:tblBorders>`——`new TableBorders(options.borders ?? {})` 给六枚
`DEFAULT_BORDER`（`single`/`4`/`auto`），值一个都不对；而六个槽里既装不下 `space` 也
装不下主题三枚（`createBorderElement` 只发 val/sz/color/space）。

所以这一族走**整片替换内容**而不是插元素、也不是补属性：`w:tblBorders` 里只有这六枚
孩子，六枚都是单枚元素，整片换与逐枚改等价，还能顺带把源件**没写的边撤掉**（包默认发
全六枚，撤掉比留着更接近源件）。与前四族同住 `<w:tblPr>`、同序登记，但动作不同——那
四族是「插一枚新元素」，这一族是「换掉一片已有元素的孩子」。

载荷 `data-tblb="single;4;000000;1;;;|…"`：边与边用 `|` 隔、边内七格用 `;` 隔，
`TBLB_EDGES`（CT_TblBorders 的元素序）× `TBLB_KEYS` 即格序；形状不对的格整格丢
（`sz` 收非负整数、`themeTint/Shade` 收两位 hex、`themeColor` 收字母数字……）。

### 三、顺带浮出水面的两枚：`??` 的右侧不是「一定会读」

`insideH|color` / `insideV|color` 此前**不在往返账的分母里**（不在「读手查问过」的
集合里，所以进不了 `src ∩ consulted`）。查下去是一处隐蔽的短路：

```js
const hex = themeRefCss(tc, b) ?? rgb2hex(`#${(attr(b, 'w:color') ?? '')…}`)
```

主题解析得出来时（`themeColors` 在场且槽名认得），`??` 右侧**根本不求值**——`w:color`
那枚属性等于没被读过。新那一趟无条件按名取原值，两对随即进账且都是「保留」。

**`??` 的右侧不是「一定会读」，而是「左边空了才读」。** 查问纪律（v0.155「查问与解析
解耦」）遇上短路求值会静默漏账——而且漏的方向是**分母变小**，账面上看是覆盖率不变，
看不出少了东西。凡是「主题解析优先、字面值兜底」的写法都同形，值得单独扫一遍。

### 教训

1. **「先定口径」不是拖延，但也不能无限期拖。** 这一族挂了三轮，定口径本身只花了半
   小时——结论还是「两趟各记各的」。含糊的代价是三轮不敢动，动的代价是半小时。
2. **「包发得出壳、只是值硬编码」有第三种解法：整片换。** 此前两族（图片容器壳 v0.148、
   表级边框这一族）都按「补属性」处理，而壳里全是单枚元素时，整片换更简单也更能撤掉
   不该有的东西。
3. **`??` 的右侧会被短路掉，查问纪律要防这一手。** 漏的方向是分母变小，账面上看不出来
   （v0.161「口径造假红」的另一面：这一处是**造假少**）。

### 顺延清单（D23）

- **`??` 短路那一族扫一遍**：`edgeCss` 之外的「主题优先、字面兜底」写法（`shadingHex`、
  `shadeSpec`、字色那一处）同样形——要么无条件取原值，要么把「查问」提到 `??` 之外。
- **`fldChar` 三对**（域指令，模型无槽）；**`outline|val`**（文字镂空，包无原生槽，
  只能走 run 级补丁位）。
- 表/节一族：`tblStyle|val`、`col|w`/`col|space`、`wAfter|*`、`gridAfter|val`、
  `pgNumType|*`、`smartTag|*`、`legacy|*`。
- 承接未动项：`gridCol`/`tcW` 的 ±5 缇、`w:cols` 的 `equalWidth`、`ind|left` 的列表
  缩进覆盖、`docPr|id` 重排、`lvlJc` 深层 `center`。

---

## v0.164（D23）——主题件跟着走：`theme1.xml` 透传 + 底纹的字面/主题双写

| | 上一轮 | 这一轮 |
|---|---:|---:|
| 正文属性 | 215/275 = 78.2% | **218/278 = 78.4%** |
| 图形壳 | 28/319 = 8.8% | 28/319 = 8.8% |
| 合计 | 243/594 = 40.9% | **246/597 = 41.2%** |
| 掉了 | 334 | 334 |
| 值变 | 17 | 17（正文 15、图形壳 2） |

三对新对进账：`shd|themeFill` / `shd|themeFillTint` / `shd|themeFillShade`，全「保留」；
底纹原有的三对（`val`/`color`/`fill`）原样保留。保真账本按对仍 99.0%，md5 仍
`95846f03…`/`aab9813c…`；往返账 `6793c9fa…`/`f0de790a…`，两次复跑逐字节相同。

### 一、探底时撞见的事：写出去的主题引用全是悬空的

量具跑到一半顺手看了一眼写出包的部件表：**没有 `word/theme/theme1.xml`**。而写手从
v0.150 起就在发 `w:themeColor`（表级边框）、v0.159 的 `w:u` 三枚、v0.160 的 `w:color`
三枚、v0.161 的样式 `w:asciiTheme` 一族——这些引用指着的就是这个件。包只发
document/styles/numbering/footnotes/comments 这几件，于是引用全部悬空：Word 只能拿自己的
默认主题顶上，**用户那套 accent 在导出后集体变色，而屏上是对的**。

账本看不见这一笔的原因值得记：`theme1.xml` 不在普查的部件清单里，而 document.xml 里
那几枚属性照样逐对「保留」。百分比是逐对的，**丢一整件部件不在任何一对里**。

修法三件缺一不可：部件本体（原样拷）、`document.xml.rels` 的 theme 关系、
`[Content_Types].xml` 的 Override。`DocMeta.themeXml` 从源件读、导出时放回；源件没有就
不凭空造一枚（`attachThemePart` 的三条断言钉住了这四件事）。

### 二、底纹：主题引用把字面值盖住了，模型只有一个格子

`shadingHex` / `shadeSpec` 的写法是「主题优先、字面兜底」：

```js
const fill = themed ?? attr(shd, 'w:fill') ?? ''
```

主题解析得出来时右侧根本不求值——`w:fill` / `w:color` 两枚等于没读过（保真账的分子少一笔）。
更要紧的是模型：`background` 装的是**解析后的屏上色**，源件那枚字面 fill 从此没有容身之处。
回写时包按 `background` 发 `w:fill`，源件的 `FFFFFF` 变成了 accent2+tint 解出来的 `e0bea8`。

A/B（同一份最小件：只一枚 clear 底纹，`w:fill="DEEAF6" w:themeFill="accent2"`）：

| rev | 没查问的 | HTML 上的载荷 |
|---|---|---|
| `8599a14`（v0.163） | `shd\|fill`、`shd\|color` | （无） |
| 本轮 | （无） | `fill=DEEAF6;themeFill=accent2;themeFillTint=99;bg=f8cbad` |

载荷 `data-shd="fill=FFFFFF;themeFill=accent2;themeFillTint=99;themeFillShade=BF;bg=e0bea8"`：
kv 形状（与 `data-ppr`/`data-frame` 同款），`bg` 是**导入那一刻的屏上色**——它是下面那道
判据的基准，不是 OOXML 属性。

### 三、补丁要「改名」而不是「追加」

`patchElemAttrs` 只追加（包压根不发那几枚属性）；底纹不行——包自己会发 `w:fill`，而且写的
正是解析后的色。再追加一枚 `w:fill` 就是非法 XML。所以另开一笔 `patchShdAttrs`：按
`<w:shd>` 出现序取开标签、**同名的改值、缺的追加**。`w:shd` 在 CT_PPrBase 与 CT_TcPrBase
里都是单枚元素，「合并」是硬要求（v0.160 那枚 `<w:ind>` 同一条纪律）。

登记两处：段落的 `paraFormatOf`（三个调用点都传 `dt`）与表格的格构造（格底纹在 `<w:tcPr>`
里，排在格内段落之前，所以必须先登记）。**只在真发得出 `<w:shd>` 时登记**——多一条少一条
都会让计数闸门整笔放弃，而放弃是静默的。

### 四、改过色的人不能被主题盖回去

`background` 是用户可改的单一事实源（与 `textStyle.color` 同一条）。载荷里的 `bg` 与当前
`background` 对不上 = 用户换过色，那时主题引用作废、按新色发。否则 Word 按主题解析，
用户的改色在屏上和纸上都看不见。

### 五、`??` 短路族：其余九处（七行）也恒查问

| 位置 | 两枚属性 | 旧写法为什么漏 |
|---|---|---|
| `edgeCss` | `w:color` | 主题解析得出就不求值（v0.163 只修了表级那一趟） |
| `shadingHex` | `w:fill` | 同上 |
| `shadeSpec` | `w:color` | 同上，且 clear 档在配色那几行**之前**就 return |
| `readRPr` | `w:ascii` / `w:hAnsi` | Word 两枚一起写，hAnsi 永不进账 |
| `readThemeColors` | `srgbClr\|val` / `sysClr\|lastClr` | 一槽写了 srgbClr 就不看 sysClr |
| `paraCss` 与表样式 `ind` | `w:left`/`w:start`、`w:right`/`w:end` | bidi 件两枚都写 |
| `fldChar` / `OLEObject` | `fldCharType`/`type`、`ProgID`/`Type` | 兼容写法永不进账 |

保真账本这几处**一动不动**（那几对在合成语料里已有别的路径查问过），变的是真实件的长尾。
证据在变异腿上：`no-attrL` 从 51.8% 抬到 **52.5%**——本轮新查问的这一批全走 `attr` 漏斗，
把 attrL 关掉时它们还在，覆盖率自然上去。`no-attr` 59.2%、`no-theme` 99.0%、
`no-themeshade` 96.5% 三腿与上轮一字不差（`no-theme` 必须不动，它守的是「查问与解析解耦」）。

### 教训

1. **账本看不见「部件级」的丢。** theme1.xml 不在普查清单里，引用悬空这件事在逐对的账上
   照样是「保留」。要盯这一层，得另开一本部件账，或者像本轮这样用结构测试钉住。
2. **`??` 的短路有两种：一种是右侧不求值，一种是更早的 return。** `shadeSpec` 的 clear 档
   在配色那几行之前就返回了——把「查问」写在解析之后，等于默认「这一档用不上就不问」。
   查问纪律要往函数**入口**放。
3. **补丁的动作要多问一句「包会不会自己发这一枚」。** 会发就得改名（`patchShdAttrs`），
   不会发才能追加（`patchElemAttrs`）。搞反的后果是非法 XML，而计数闸门不会替你发现。
4. **「改过色没有」这类判据要存基准值。** `bg` 这一格不是 OOXML 属性，是导入那一刻的
   屏上色——没有它就分不清「源件的字面色」与「用户刚换的颜色」。

### 顺延清单（D24）

- **边框的主题引用**（`top|themeColor` 等，`pBdr` 与 `tcBorders` 两族）：色是用户可改的
  单槽，按 v0.160 的判据不拆槽；真要做，得把本轮这套「bg 基准 + 改过就作废」一起搬过去。
- `fldChar` 三对（域指令，模型无槽）；`outline|val`（文字镂空，包无原生槽）。
- 表/节一族：`tblStyle|val`、`col|w`/`col|space`、`wAfter|*`、`gridAfter|val`、
  `pgNumType|*`、`smartTag|*`、`legacy|*`。
- 承接未动项：`gridCol`/`tcW` 的 ±5 缇、`w:cols` 的 `equalWidth`、`ind|left` 的列表
  缩进覆盖、`docPr|id` 重排、`lvlJc` 深层 `center`。
- **`theme1.xml` 进不进普查清单**要定口径：加进 `PARTS` 会让四十来对主题槽一次进分母且
  全「保留」，那是灌水；更可能是单开一本「部件账」（源包部件 ∩ 写出包部件）。

---

## v0.165（D24）——段落与逐格边框：块级补丁与「补丁跑了一半」

| | 上一轮 | 这一轮 |
|---|---:|---:|
| 正文属性 | 218/278 = 78.4% | **221/281 = 78.6%** |
| 图形壳 | 28/319 = 8.8% | 28/319 = 8.8% |
| 合计 | 246/597 = 41.2% | **249/600 = 41.5%** |
| 掉了 | 334 | 334 |
| 值变 | 17 | 17（正文 15、图形壳 2） |

三对新对进账：`top|themeColor` / `top|themeTint` / `top|themeShade`，全「保留」。
保真账本按对仍 99.0%、md5 仍 `95846f03…`/`aab9813c…`；往返账
`6575465…`/`740e12a…`，两次复跑逐字节相同。四条变异腿与上轮一字不差
（52.5 / 59.2 / 99.0 / 96.5）。

### 一、丢的不是三枚属性，是「这一笔颜色是谁说的」

上一轮修底纹时留着一条顺延：边框的主题引用。它和底纹同一个形状——`edgeCss` 里
「主题优先、字面兜底」：

```js
const hex = themeRefCss(tc, b) ?? rgb2hex(`#${literal}`) ?? '#000000'
```

主题解析得出来时，`w:color` 那枚字面色就没有出口。而 `bd*` 那一格装的是**解析后的
屏上色**（`#adbbd4`），源件写的是 `w:color="FF0000" w:themeColor="accent1"
w:themeTint="99" w:themeShade="BF"`。导出时包按屏上色发 `w:color="adbbd4"`——主题
引用整笔消失，字面色也被换成了它的解析结果。

夹具里加一枚带主题引用的 `w:pBdr/w:top` 之后，A/B 是这么分的：

| rev | `<w:top>` 的字节 |
|---|---|
| `77aa5df`（v0.164） | `w:val="single" w:color="adbbd4" w:sz="8" w:space="1"` |
| 本轮 | `w:val="single" w:color="FF0000" w:sz="8" w:space="1" w:themeColor="accent1" w:themeTint="99" w:themeShade="BF"` |

### 二、`<w:top>` 在包里长在三处，只能按块对位

前几族的补丁都是「按元素出现序贴第 i 枚」。边框不能这么干：`w:top` 同时是
`w:tblBorders`、`w:tcBorders`、`w:pBdr` 的子元素（`w:tcMar`/`w:tblCellMar` 里还有同名
的 `w:top`，只是属性不同），一个全局出现序根本分不清哪一枚属于谁。

所以这一族按**块**贴：先按块级标签（`<w:pBdr>` / `<w:tcBorders>`）切出块来，块内再按
边名找元素。计数闸门是「块数 === 登记数」，登记规则比前几族更窄——**只在真发得出这个
块时才 push**：

- 段落：`paraFormatOf` 里 `bd` 有值才登记（`w:pBdr` 发得出来才登记）；
- 逐格：表格那趟 `bordersOf(cell.attrs)` 有值才登记，且必须赶在格内段落之前
  （`<w:tcPr>` 在 XML 里排在格的 `<w:p>` 前面）。

两族分开两个数组（`paraBdrs` / `cellBdrs`），因为它们的块级标签不同、出现序也各走各的。

### 三、补丁跑了一半：第一枚属性没有前导空格

第一版 `mergeTagAttrs` 在 `add` 里逐枚抓 `\sw:xxx="…"`。而 `bdrExtraOf` 拼串时，
第一枚属性是不带前导空格的：

```
top|w:color="FF0000" w:themeColor="accent1" w:themeTint="99" w:themeShade="BF"
      ↑ 没有空格                     ↑ 有空格
```

结果：`w:color` 整条被跳过，主题三枚照贴不误。写出来的字节是
`w:color="adbbd4" … w:themeColor="accent1"`——**补丁「成功了一半」**，而且不报错。

这个失效形状值得单记：它既不是全哑（那还能靠 `touched` 发现），也不是错位（那会被
计数闸门拦住），而是**同一枚元素上的一半属性生效、另一半静默丢掉**。端到端账本最终
会把它记成 `top|color` 的一笔值变——但那是跑完账才看得见的。修法是把「属性串可以不
带前导空格」这条写进 `mergeTagAttrs` 自己（`\` ${add}\``），而不是要求每个调用方记得加。

### 四、新开的读点会绕过变异腿的锚点

第一版的 `borderOrigin` 直接 `attr(box,'w:themeColor'/'themeTint'/'w:themeShade')`
各读一遍。跑变异腿时 `no-themeshade` 从 96.5% 抬到了 **97.7%**——那条腿注入的是
`themeRefParts` 里那两行 `attr`，而新读点不在注入范围内，于是「shade/tint 两枚根本
不查问」这个前提在边框这一族上不成立。

分数**往上**变，方向是审查者该警觉的那一边（往下跌才是「新代码没被覆盖」）。修法是
让 `borderOrigin` 走 `themeRefParts`——「按名查问这三枚」保持单一出口，变异腿才继续
说得上话。四条腿随后与上轮一字不差。

### 五、判据还是那一条：改过色就整笔作废

`data-bdr` 载荷按边分格：`edge;color;themeColor;themeTint;themeShade;screen`，
`screen` 是导入那一刻的屏上色（同 `data-shd` 的 `bg`）。导出时逐边比一次：当前
`bd*` 解析出来的色与 `screen` 对不上，就说明用户在编辑器里换过色——那条边的主题引用
与字面色**整笔作废**，按新色发。线型与粗细改了不影响颜色，照补。

反例也在结构测试里钉着：`bdTop` 换成 `#00ff00` 之后，包里既没有 `w:themeColor`，
`w:color` 也确实是 `00ff00`。

### 教训

1. **块级补丁与元素级补丁是两套对位**（v0.165）：`<w:top>` 这类「同一个本地名长在多个
   父下」的元素，全局出现序天然有歧义；要么按块切，要么给每处一个唯一锚。选块级是因为
   `pBdr`/`tcBorders` 本身是唯一的。
2. **「属性串的前导空格」是隐式契约**（v0.165）：`\sw:` 收边让第一枚属性静默掉队，
   而其余照贴。凡是逐枚解析拼串的地方，都要在自己入口里归一化，不要指望调用方记住。
3. **补丁的半失效比全失效更难发现**（v0.165）：全失效有 `touched` 兜着，半失效只有
   账本上的某一笔值变。结构测试要把「每一枚属性都到了」写成断言，而不是只看有没有补丁。
4. **新读点先问一句「变异腿还管得着它吗」**（v0.165）：覆盖率往上跳 1.2 个点不是成绩，
   是注入锚点漏了一块。把读点收回既有出口（`themeRefParts`）比给腿加锚点更省事。

### 顺延清单（D25）

- **字符边框 `w:bdr` 的主题引用**：与这一轮同形（`data-bdr` 那套可以整族搬），
  但它在 rPr 里、按 `<w:bdr>` 出现序贴，是第三条登记线。
- `w:pBdr/w:between`（第五边）与 `w:bar`：写手没有这两枚的原生槽，要补就不是「合并
  属性」而是「插元素」，与 `patchBeforeElem` 同族。
- `fldChar` 三对（域指令，模型无槽）；`outline|val`（文字镂空，包无原生槽）。
- 表/节一族：`tblStyle|val`、`col|w`/`col|space`、`wAfter|*`、`gridAfter|val`、
  `pgNumType|*`、`smartTag|*`、`legacy|*`。
- 承接未动项：`gridCol`/`tcW` 的 ±5 缇、`w:cols` 的 `equalWidth`、`ind|left` 的列表
  缩进覆盖、`docPr|id` 重排、`lvlJc` 深层 `center`。
- **`theme1.xml` 进不进普查清单**仍要定口径（部件账的可能性大于灌进 `PARTS`）。

---

## v0.166（D25）——字符边框：同一枚属性名的两种 grammar，与「没有可编辑槽就没有判据」

| | 上一轮 | 这一轮 |
|---|---:|---:|
| 正文属性 | 221/281 = 78.6% | **224/284 = 78.9%** |
| 图形壳 | 28/319 = 8.8% | 28/319 = 8.8% |
| 合计 | 249/600 = 41.5% | **252/603 = 41.8%** |
| 掉了 | 334 | 334 |
| 值变 | 17 | 17（正文 15、图形壳 2） |

三对新对进账：`bdr|themeColor` / `bdr|themeTint` / `bdr|themeShade`，全「保留」；
原有的 `bdr|val`/`sz`/`space`/`color` 四对原样保留，七对齐全。保真账本按对仍 99.0%、
md5 仍 `95846f03…`/`aab9813c…`；往返账 `bc4b00f…`/`b0592bc…`，两次复跑逐字节相同；
四条变异腿与上轮一字不差（52.5 / 59.2 / 99.0 / 96.5）。

### 一、先拆一个隐患：一个属性名挂两种 grammar

v0.152 起字符边框的载荷叫 `data-bdr`，语法是定序四格 `val;sz;space;color`；
v0.165 给段落/逐格边框新开的那一枚**也叫 `data-bdr`**，语法却是「按边分格」的
`top;FF0000;accent1;99;BF;adbbd4|left;auto;…`。

两枚今天不打架（一枚长在 `span`、一枚长在 `p`/`td`），但这正是那种「今天不打架、
明天换个入口就打架」的形状——同一个名字两种 grammar，读的人迟早按错的那一种解。
字符这一枚改名 `data-rbdr`（run border），段落/逐格那一枚保持 `data-bdr`。

改动只碰临时 HTML（文档存的是 .docx），不涉及任何已存文件。

### 二、字符边框只丢三枚：包里 `border` 有 color 槽

与段落/逐格不同，包的 `IRunOptions.border` 是 `{style,size,space,color}`——**颜色有槽**，
写手一直按字面色发得出来。真正掉队的只有 `w:themeColor/themeTint/themeShade` 三枚，
所以这一轮的范围比上一轮窄：不补 `w:color`，只补主题三枚。

### 三、这一族回到最简单的元素级追加

`<w:bdr>` 在 document.xml 里只长在 run 的 `w:rPr` 上——`w:tblBorders`/`w:tcBorders`/
`w:pBdr` 用的是逐边元素（`w:top`…），不会撞名。既然没有同名歧义、又不覆盖包自己写的
属性，就不需要块级那套：直接用 v0.164 的 `patchElemAttrs(bytes, 'bdr', extras)` 追加。

登记点选在 `withCharExtra`——它是发 `<w:bdr>` 的**唯一出口**（五条 run 路径都过这里），
与 caps 同一条纪律：只要发了这个元素就 push（空串占位），条数才对得上。

### 四、没有可编辑槽，就没有「用户改过色」这一档

上一轮的判据是「`screen` 与当前 `bd*` 的色对不上 = 用户改过色」。字符边框这里
**没有第二个槽**：载荷自己就是唯一事实源，界面上也没有改字符边框颜色的命令。
照搬那套 gate 只会写出一条永远不会命中的判据。

但「两槽」还有另一半用处——**屏上要画解析后的色**。主题引用优先是 Word 的语义，
字面色只是兜底；所以 `RunProps.bdr` 加了 `screen`（解析结果，只给屏上），`color`
仍是源件的字面色（只往存盘走）。两个槽各管一段，与 v0.159 的 `w:u` 同一套分工。

反例也在结构测试里：主题件里没有 clrScheme 时 `screen` 不存在，屏上落回 `#ff0000`，
而载荷里那枚 `FF0000` 始终不动。

### 教训

1. **同一枚属性名不许挂两种 grammar**（v0.166）：今天靠「长在不同节点上」不打架，
   明天换一个入口就打架。名字里带上宿主（`data-rbdr` vs `data-bdr`）比写注释可靠。
2. **「同形」不等于「同一套机制」**（v0.166）：字符边框与段落边框都是边框，但一个没有
   可编辑槽（不需要 gate）、一个没有同名歧义（不需要块级对位）。照搬上一轮的整套做法
   会多出两条永不命中的判据——先问「这一族缺的是哪一段」。
3. **登记点选唯一出口**（v0.166）：`withCharExtra` 管着五条 run 路径，caps 已经证明过
   这里是对的；`<w:bdr>` 与它同住，就跟着走。

### 顺延清单（D26）

- `w:pBdr/w:between`（第五边）与 `w:bar`：写手没有这两枚的原生槽，要补是「插元素」，
  与 `patchBeforeElem` 同族。
- `fldChar` 三对（域指令，模型无槽）；`outline|val`（文字镂空，包无原生槽）。
- 表/节一族：`tblStyle|val`、`col|w`/`col|space`、`wAfter|*`、`gridAfter|val`、
  `pgNumType|*`、`smartTag|*`、`legacy|*`。
- 承接未动项：`gridCol`/`tcW` 的 ±5 缇、`w:cols` 的 `equalWidth`、`ind|left` 的列表
  缩进覆盖、`docPr|id` 重排、`lvlJc` 深层 `center`。
- **`theme1.xml` 进不进普查清单**仍要定口径（部件账的可能性大于灌进 `PARTS`）。

---

## v0.167（D26）——段落第五边：`w:between` 要的是插元素，而且得把替身按住

| | 上一轮 | 这一轮 |
|---|---:|---:|
| 正文属性 | 224/284 = 78.9% | **230/290 = 79.3%** |
| 图形壳 | 28/319 = 8.8% | 28/319 = 8.8% |
| 合计 | 252/603 = 41.8% | **258/609 = 42.4%** |
| 掉了 | 334 | 334 |
| 值变 | 17 | 17（正文 15、图形壳 2） |

六对新对进账：`between|val` / `sz` / `space` / `color` / `themeColor` / `themeTint`，
全「保留」。保真账本按对仍 99.0%、md5 仍 `95846f03…`/`aab9813c…`；往返账
`f68416c…`/`671a409…`，两次复跑逐字节相同；四条变异腿与上轮一字不差。

### 一、它不是「又一条边」，是「两段之间的那条线」

`w:between` 画在**相邻两段之间**，而且只在两段的边框签名一致时才画（`betweenOfSiblings`
已经按这个口径读了：末段不画，中间隔一张表也断串）。读手把这条线落在**本段的下边框**
上——屏上不多一个元素，正好是「这一段下面有根线」。

麻烦在于这个替身：模型里 `bdBottom` 多了一条源件根本没有的 `w:bottom`。写手照常发它，
再补一枚 `w:between`，Word 里就是两根线。探针第一版正是这个形状：

```
<w:pBdr><w:top …/><w:bottom w:val="dotted" w:color="f8cbad"/>   ← 替身
        <w:between w:val="dotted" …/></w:pBdr>                  ← 真身
```

所以这一轮的动作是**两个**：把真身插回去，同时把替身按住（`betweenAsBottom`：屏上那条
下边框的色与载荷里的 `screen` 一致，就认定它是替身，`w:bottom` 不发）。判据与 v0.165/166
同一条——用户换过色就对不上，那时 between 作废、下边框照发。

### 二、四边那套「从 CSS 反推」在这里不成立

四条的线型/粗细可以从 `bd*` 的规范串反推（`2px dashed #ff0000`），`between` 没有 CSS 槽，
反推不出来。所以 `data-pbdr` 把 `val/sz/space` 三枚原件也带上：

```
data-pbdr="dotted;6;2;FF9900;accent2;99;;F8CBAD"      ← 画了（串中间那段）
data-pbdr="dotted;6;2;FF9900;accent2;99;;F8CBAD;1"    ← 没画（串尾那段，尾格 hidden=1）
```

两种情形两种纪律：画了的有替身可比（改色/删边就跟着走），没画的屏上什么都没有、原样带回。
顺带把「源件同时写了 bottom 与 between」这一档也接住了——那时读手本来就不画 between
（显式下边让它让位），载荷带 `hidden=1`，写侧照原样带回。

### 三、插入点：CT_PBdr 的序

`w:between` 在 CT_PBdr 里排在四条之后、`w:bar` 之前。于是块级补丁多了一种动作：块里没有
这一枚就**插**——有 `<w:bar>` 插在它前面，没有就落在 `</w:pBdr>` 前。这是 `patchBorderBlocks`
从「合并属性」长出来的第二种动作，与 v0.161 `patchBeforeElem` 同族（那边插兄弟元素，这边
插块内子元素）。

### 四、一次及时的收手：别让无关缺口污染账本

夹具里那两段的上边框最初写了 `w:space="0"`。跑账时 `top|space` 多出一笔值变——写侧的
`borderSpacePt` 把 0 与「没写」并成一路（语义等价：`w:space` 缺省就是 0，但字面丢了）。
这跟 `between` 没有关系，收进本轮只会让「掉了 334 / 值变 17」这两条基线多一笔说不清的数。
于是夹具改回不带 `w:space`，另把这一档记进顺延：要收，就把它并进 `data-bdr` 的第 7 格
（与 `between` 的 `space` 同一个位置）。

### 教训

1. **「屏上的替身」也是一种单边通道**（v0.167）：读手为了屏上好看，把 A 元素画成 B 元素的
   样子；写手若两枚都发，纸上就多一根线。凡是「读的时候做过映射」的，写的时候要能认回
   那个映射（这里是 `screen` 基准）。
2. **能反推的才省字段**（v0.167）：四边的 val/sz 能从 CSS 反推，所以 v0.165 的载荷只存
   颜色；`between` 没有 CSS 槽，三个原件必须自带。同一族载荷不必长得一样，按「反推得
   出来吗」决定。
3. **实验性夹具先跑一遍账，别直接入库**（v0.167）：`space="0"` 那笔就是在入库前撞见的。
   它与本轮主题无关，收进来会把基线搅浑。

### 顺延清单（D27）

- **`pBdr`/`tcBorders` 的显式 `w:space="0"`**：写侧不发（语义等价、字面丢），要收就并进
  `data-bdr` 的第 7 格。
- `w:bar`（第六条边）：与 `between` 同族，但写侧连「屏上替身」都没有，要单独定判据。
- `fldChar` 三对（域指令，模型无槽）；`outline|val`（文字镂空，包无原生槽）。
- 表/节一族：`tblStyle|val`（夹具没给 TableGrid 定义，`data-tstyle` 那一路从没被端到端
  跑过）、`col|w`/`col|space`、`wAfter|*`、`gridAfter|val`、`pgNumType|*`、`smartTag|*`、
  `legacy|*`。
- 承接未动项：`gridCol`/`tcW` 的 ±5 缇、`w:cols` 的 `equalWidth`、`ind|left` 的列表
  缩进覆盖、`docPr|id` 重排、`lvlJc` 深层 `center`。
- **`theme1.xml` 进不进普查清单**仍要定口径（部件账的可能性大于灌进 `PARTS`）。

---

## v0.168（D27）——边框族收尾：显式 `w:space="0"` 与第六条边 `w:bar`

| | 上一轮 | 这一轮 |
|---|---:|---:|
| 正文属性 | 230/290 = 79.3% | **236/296 = 79.7%** |
| 图形壳 | 28/319 = 8.8% | 28/319 = 8.8% |
| 合计 | 258/609 = 42.4% | **264/615 = 42.9%** |
| 掉了 | 334 | 334 |
| 值变 | 17 | 17（正文 15、图形壳 2） |

六对新对进账：`bar|val` / `sz` / `space` / `color` / `themeColor` / `themeTint`，全「保留」；
`top|space` 的那笔值变也回到「保留」（`0` 这一档现在写得回去）。保真账本按对仍 99.0%、
md5 仍 `95846f03…`/`aab9813c…`；往返账 `a1ab86e…`/`bce98a2…`，两次复跑逐字节相同；
四条变异腿与上轮一字不差。

### 一、`w:space="0"`：语义上没用，字面是源件说过的话

`borderSpacePt` 把「显式 0」与「没写」并成一路——写成 CSS 都是 0 padding，Word 缺省也是 0。
语义上没错，字面上丢了一枚源件真写过的属性（上一轮就是它把 `top|space` 顶成值变）。

修法是给 `data-bdr` 补第 6 格 `space`，**只记 `"0"` 这一档**（非零值 padding 那条链本来
能原样还原，记了是重复）。写回时多一道守卫：用户把内边距调大了（`pad*`/`bdSpace*` > 0），
以用户为准，载荷里的 0 不能用——否则「把边距拉开」这个动作会在导出时被打回原形。

### 二、一个没想到的岔子：「有话说」的闸门把这条边整个挡在门外

第一版只加了「记 space」，跑夹具却没见到 `<w:top w:space="0">`。原因是 `borderOrigin`
有一道**取舍闸门**：字面色与屏上色一致、三枚主题引用都没有 → 这条边「什么都不用补」，
整条不载荷。而「只有 space=0 有话说」的边恰好落在这个条件里——载荷里连这条边都不存在，
第 6 格自然无从谈起。

闸门因此放宽成「`space === '0'` 也算有话说」。这一笔值得记：**载荷的取舍条件本身就是一
道闸**，加字段时得回头问「这条边进得来吗」。

### 三、`w:bar`：没有替身，所以最省事

段落侧边的竖线（合同/公文里的「条」）。`borderEdges` 一直把 `<w:bar>` 顺带算出来，但没
人用——屏上没画过它，也就没有 v0.167 那种「替身」问题。

于是它比 `between` 简单一整圈：没有 `screen`、没有 `hidden`、没有判据，载荷
`data-pbar`（前七格与 `data-pbdr` 同一套定序）有值就插一枚，位置在 CT_PBdr 序的末尾
（between 之后）。

### 四、边框族到此闭环

| 元素 | 屏上 | 存盘通道 |
|---|---|---|
| 四边 `w:top/left/bottom/right` | CSS border（`bd*` 槽，用户可改） | `data-bdr`（按边分格，带 screen 判据） |
| 第五边 `w:between` | 借下边框画（有替身） | `data-pbdr`（九格，hidden 区分画没画） |
| 第六条 `w:bar` | 无 | `data-pbar`（七格，无判据） |

三种载荷三种形状，不是不统一，而是三者的「屏上有没有替身、能不能反推」各不相同。

### 教训

1. **「CSS 表达不了」与「值不重要」是两件事**（v0.168）：`w:space="0"` 在语义上是空操作，
   但它是源件的字面。判据是「写手能不能自己推出来」，不是「语义上重不重要」。
2. **加字段先看闸门**（v0.168）：载荷的取舍条件会把「只有这一枚属性有话说」的边整个挡在
   外面。加第 N 格时，回头把那个条件也读一遍。
3. **没有屏上替身的元素最省事**（v0.168）：不用 screen、不用 hidden、不用判据——「有就插
   一枚」反而不会错。前两轮的复杂度全是替身带来的。

### 顺延清单（D28）

- `fldChar` 三对（域指令，模型无槽）；`outline|val`（文字镂空，包无原生槽）。
- 表/节一族：`tblStyle|val`（夹具没给 TableGrid 定义，`data-tstyle` 那一路从没端到端跑过）、
  `col|w`/`col|space`、`wAfter|*`、`gridAfter|val`、`pgNumType|*`、`smartTag|*`、`legacy|*`。
- 承接未动项：`gridCol`/`tcW` 的 ±5 缇、`w:cols` 的 `equalWidth`、`ind|left` 的列表
  缩进覆盖、`docPr|id` 重排、`lvlJc` 深层 `center`。
- **`theme1.xml` 进不进普查清单**仍要定口径（部件账的可能性大于灌进 `PARTS`）。

---

## v0.169（D28）——表样式：把一条从没跑过的路跑通，顺带补上「首行该粗不粗」

| | 上一轮 | 这一轮 |
|---|---:|---:|
| 正文属性 | 236/296 = 79.7% | **238/297 = 80.1%** |
| 图形壳 | 28/319 = 8.8% | 28/319 = 8.8% |
| 合计 | 264/615 = 42.9% | **266/616 = 43.2%** |
| 掉了 | 334 | **333** |
| 值变 | 17 | 17（正文 15、图形壳 2） |

两对进账：`tblStyle|val` 从「掉了」变「保留」，`tblStylePr|type`（条件层型名）新进分母且
保留。保真账本按对仍 99.0%、md5 仍 `95846f03…`/`aab9813c…`；往返账
`b95288d…`/`139cd5f…`，两次复跑逐字节相同；四条变异腿与上轮一字不差。

### 一、为什么这条路一直没跑过

夹具里三张表都写着 `<w:tblStyle w:val="TableGrid"/>`，可 `styles.xml` 里**没有这枚定义**。
读手挂标签的条件是「这个 id 认得出」：

```js
const owner = styleId && this.book.byId.has(styleId) && !SUBSTITUTED_TABLE_STYLES.has(styleId) ? styleId : ''
```

认不出就不挂（挂上去是一枚指向不存在定义的引用）——于是 `data-tstyle` 从来没出现过，
`w:tblStyle` 也就从来没被写回去。这条账在「掉了」里躺了很多轮，不是写手不会写，是**输入
里没有让它出场的东西**。

补上定义之后三件一起验：`w:tblStyle` 的**引用**、`styles.xml` 里的**定义**
（`w:name`/`w:basedOn`/`w:tblStylePr`）、以及条件层的型名。三件全部原样回来。

### 二、顺带撞见的真问题：首行该粗不粗

`w:tblStylePr` 里的 `w:rPr/w:b`（首行加粗）此前只走了一半：它进了样式快照、跟着
`styles.xml` 回去，**屏上从没兑现**——表里首行看着是常规字重，而 Word 打开是粗的。
这正是 v0.164 那条「屏上对、纸上不对」的镜像：这次是纸上对、屏上不对。

修法是给 `baseRunProps` 加一个 `seed`（比段落样式更弱的一层），由表格那趟按位置算出
条件层的 run 传进格内段落：

```js
const condRun = condRunFor(look, conds, ri, ri === last, c.gc, c.colspan, acct.length)
```

`CondCell` 因此多了 `bold` 一枚（条件层的 run 目前只有它）。位置梯子复用
`condLadderAppearance`——底纹、边框、行高三族早就共用它，run 是第四族。

### 三、账本对这一次修复一无所知

修完跑账：逐字节相同。原因是**账本按属性记，元素级的增删它看不见**——`<w:b/>` 是裸元素、
一个属性都没有，`b|val` 那对只统计「写了 val 的那些」，所以「多了/少了整个 `w:b`」不进账。

这条不是账本的 bug，是它的口径边界：它量的是「源件说过的属性回来了没有」，量不了
「源件没说过的东西有没有多出来」。这一次靠结构测试钉住（四张表两两对照 tblLook 闸门）。

### 四、还没接的那一半

表样式**自己**的 `w:rPr`（非条件层、常驻的那份）仍然没上屏——它不与位置相关，得在
`cellBlocks` 之外另接一条（表级 seed）。真件里它常用来定表内字号，顺延里记下了。

### 教训

1. **「从没跑过」与「跑不过」要分开**（v0.169）：`tblStyle` 这条账挂了多轮，看着像写手的
   缺口，其实是夹具里缺一枚定义。补输入比补代码先做。
2. **账本按属性记，元素级增删看不见**（v0.169）：裸 `<w:b/>` 不产生任何属性对。这类修复
   只能靠结构测试，别指望百分比会动。
3. **镜像的 bug 长得一样**（v0.169）：v0.164 是「屏上对、纸上不对」（主题件悬空），这一次
   是「纸上对、屏上不对」（条件层 run 没上屏）。判据都该是「两边说的是不是同一件事」。

### 顺延清单（D29）

- 表样式自己的 `w:rPr`（常驻 run）接到表内文字上。
- `fldChar` 三对（域指令，模型无槽）；`outline|val`（文字镂空，包无原生槽）。
- 表/节一族：`col|w`/`col|space`、`wAfter|*`、`gridAfter|val`、`pgNumType|*`、`smartTag|*`、
  `legacy|*`。
- 承接未动项：`gridCol`/`tcW` 的 ±5 缇、`w:cols` 的 `equalWidth`、`ind|left` 的列表
  缩进覆盖、`docPr|id` 重排、`lvlJc` 深层 `center`。
- **`theme1.xml` 进不进普查清单**仍要定口径（部件账的可能性大于灌进 `PARTS`）。

---

## v0.169（D28）——表样式：把一条从没跑过的路跑通，顺带补上「首行该粗不粗」

| | 上一轮 | 这一轮 |
|---|---:|---:|
| 正文属性 | 236/296 = 79.7% | **238/297 = 80.1%** |
| 图形壳 | 28/319 = 8.8% | 28/319 = 8.8% |
| 合计 | 264/615 = 42.9% | **266/616 = 43.2%** |
| 掉了 | 334 | **333** |
| 值变 | 17 | 17（正文 15、图形壳 2） |

两对进账：`tblStyle|val` 从「掉了」变「保留」，`tblStylePr|type`（条件层型名）新进分母且
保留。保真账本按对仍 99.0%、md5 仍 `95846f03…`/`aab9813c…`；往返账
`b95288d…`/`139cd5f…`，两次复跑逐字节相同；四条变异腿与上轮一字不差。

### 一、为什么这条路一直没跑过

夹具里三张表都写着 `<w:tblStyle w:val="TableGrid"/>`，可 `styles.xml` 里**没有这枚定义**。
读手挂标签的条件是「这个 id 认得出」：

```js
const owner = styleId && this.book.byId.has(styleId) && !SUBSTITUTED_TABLE_STYLES.has(styleId) ? styleId : ''
```

认不出就不挂（挂上去是一枚指向不存在定义的引用）——于是 `data-tstyle` 从来没出现过，
`w:tblStyle` 也就从来没被写回去。这条账在「掉了」里躺了很多轮，不是写手不会写，是**输入
里没有让它出场的东西**。

补上定义之后三件一起验：`w:tblStyle` 的**引用**、`styles.xml` 里的**定义**
（`w:name`/`w:basedOn`/`w:tblStylePr`）、以及条件层的型名。三件全部原样回来。

### 二、顺带撞见的真问题：首行该粗不粗

`w:tblStylePr` 里的 `w:rPr/w:b`（首行加粗）此前只走了一半：它进了样式快照、跟着
`styles.xml` 回去，**屏上从没兑现**——表里首行看着是常规字重，而 Word 打开是粗的。
这正是 v0.164 那条「屏上对、纸上不对」的镜像：这次是纸上对、屏上不对。

修法是给 `baseRunProps` 加一个 `seed`（比段落样式更弱的一层），由表格那趟按位置算出
条件层的 run 传进格内段落：

```js
const condRun = condRunFor(look, conds, ri, ri === last, c.gc, c.colspan, acct.length)
```

`CondCell` 因此多了 `bold` 一枚（条件层的 run 目前只有它）。位置梯子复用
`condLadderAppearance`——底纹、边框、行高三族早就共用它，run 是第四族。

### 三、账本对这一次修复一无所知

修完跑账：逐字节相同。原因是**账本按属性记，元素级的增删它看不见**——`<w:b/>` 是裸元素、
一个属性都没有，`b|val` 那对只统计「写了 val 的那些」，所以「多了/少了整个 `w:b`」不进账。

这条不是账本的 bug，是它的口径边界：它量的是「源件说过的属性回来了没有」，量不了
「源件没说过的东西有没有多出来」。这一次靠结构测试钉住（四张表两两对照 tblLook 闸门）。

### 四、还没接的那一半

表样式**自己**的 `w:rPr`（非条件层、常驻的那份）仍然没上屏——它不与位置相关，得在
`cellBlocks` 之外另接一条（表级 seed）。真件里它常用来定表内字号，顺延里记下了。

### 教训

1. **「从没跑过」与「跑不过」要分开**（v0.169）：`tblStyle` 这条账挂了多轮，看着像写手的
   缺口，其实是夹具里缺一枚定义。补输入比补代码先做。
2. **账本按属性记，元素级增删看不见**（v0.169）：裸 `<w:b/>` 不产生任何属性对。这类修复
   只能靠结构测试，别指望百分比会动。
3. **镜像的 bug 长得一样**（v0.169）：v0.164 是「屏上对、纸上不对」（主题件悬空），这一次
   是「纸上对、屏上不对」（条件层 run 没上屏）。判据都该是「两边说的是不是同一件事」。

### 顺延清单（D29）

- 表样式自己的 `w:rPr`（常驻 run）接到表内文字上。
- `fldChar` 三对（域指令，模型无槽）；`outline|val`（文字镂空，包无原生槽）。
- 表/节一族：`col|w`/`col|space`、`wAfter|*`、`gridAfter|val`、`pgNumType|*`、`smartTag|*`、
  `legacy|*`。
- 承接未动项：`gridCol`/`tcW` 的 ±5 缇、`w:cols` 的 `equalWidth`、`ind|left` 的列表
  缩进覆盖、`docPr|id` 重排、`lvlJc` 深层 `center`。
- **`theme1.xml` 进不进普查清单**仍要定口径（部件账的可能性大于灌进 `PARTS`）。

---

## v0.170（D29）——页码型别与起始值：从「只读记账」升成往返

| | 上一轮 | 这一轮 |
|---|---:|---:|
| 正文属性 | 238/297 = 80.1% | **240/297 = 80.8%** |
| 图形壳 | 28/319 = 8.8% | 28/319 = 8.8% |
| 合计 | 266/616 = 43.2% | **268/616 = 43.5%** |
| 掉了 | 333 | **331** |
| 值变 | 17 | 17（正文 15、图形壳 2） |

两对从「掉了」变「保留」：`pgNumType|fmt`、`pgNumType|start`。保真账本按对仍 99.0%、
md5 仍 `95846f03…`/`aab9813c…`；往返账 `75f2d72…`/`371687d…`，两次复跑逐字节相同。

### 一、它在顺延里躺了十五轮，其实包一直有槽

v0.155 把这枚记成「只读」：`attr(pgn,'w:fmt'); attr(pgn,'w:start')` 两行读出来就扔，
注释写着「写侧没有对应槽（包只发纸型/页边距/分栏数这几枚）」。这一轮翻包的
`ISectionPropertiesOptions` 才发现：

```ts
pageNumbers?: IPageNumberTypeAttributes   // 直接落成 <w:pgNumType>
```

`createPageNumberType` 把 `formatType` 原样写进 `w:fmt`、`start` 写进 `w:start`。
所以这一轮没写任何打包后补丁，只是把渠道打通：`DocxSection.pageNum` → `PageSetup.pageNum`
→ `resolvePage` → `sections[].properties.page.pageNumbers`，两枚值原样过。

两条读腿都补了：读手那条走 `attr` 漏斗（进保真账本），`docxToDocMeta` 那条仍是正则
（回退导入路径，否则从 mammoth 开局进来的件会丢这一档）。

### 二、包的无条件 push 与「没写就别发」

跑探针时发现件里多了一枚 `<w:pgNumType/>`——包的 `SectionProperties` 构造器是
`this.root.push(createPageNumberType(pageNumbers))`，**没有 if**：没给 pageNumbers 也照样落一个空元素。
Word 读它等于「全是默认」，渲染没差别，但这是源件没说过的一句话。

于是加了一笔 `dropEmptyPgNum`：没有 pageNum 时把**空的**那一枚从包里摘掉（有属性的不动）。
账本对这类事完全瞎（裸元素没有属性），只能靠结构测试钉——与 v0.169 那条同一条边界。

### 三、no-attr 腿动了 0.2 个点，得说清楚

`no-attr` 从 59.2% 到 **59.4%**。原因是新读的两枚里，`start` 走的是 `attrNum`，而
`attrNum = attr ?? attrL`——`attr` 被注入掉之后它从 `attrL` 那一路照样读得到。所以这一对
在 no-attr 腿上仍然算「查问过」。不是腿坏了，是这条读法本来就有两条路（数值档的统一写法）。

### 教训

1. **「只读记账」要定期复查「包里真没有槽吗」**（v0.170）：`pgNumType` 在顺延清单里躺了
   十五轮，理由写得很像回事（「包只发纸型/页边距/分栏数」），实际包有 `pageNumbers`。
   翻一眼 `.d.ts` 的成本，比写一笔打包后补丁低得多。
2. **包的「无条件 push」会给每个件多一枚空元素**（v0.170）：账本看不见（没有属性），
   只有探针/结构测试看得见。这类噪声值得单独摘掉——它不影响渲染，但影响「这份文件像不像
   源件」。

### 顺延清单（D30）

- 表样式自己的 `w:rPr`（常驻 run）接到表内文字上。
- `fldChar` 三对（域指令，模型无槽）；`outline|val`（文字镂空，包无原生槽）。
- 表/节一族：`col|w`/`col|space`、`wAfter|*`、`gridAfter|val`、`smartTag|*`、`legacy|*`。
- 承接未动项：`gridCol`/`tcW` 的 ±5 缇、`w:cols` 的 `equalWidth`、`ind|left` 的列表
  缩进覆盖、`docPr|id` 重排、`lvlJc` 深层 `center`。
- **`theme1.xml` 进不进普查清单**仍要定口径（部件账的可能性大于灌进 `PARTS`）。

---

## v0.171（D30）——表样式的那一半：常驻 run 上屏，层序要摆对

| | 上一轮 | 这一轮 |
|---|---:|---:|
| 正文属性 | 240/297 = 80.8% | **241/298 = 80.9%** |
| 图形壳 | 28/319 = 8.8% | 28/319 = 8.8% |
| 合计 | 268/616 = 43.5% | **269/617 = 43.6%** |
| 掉了 | 331 | 331 |
| 值变 | 17 | 17（正文 15、图形壳 2） |

`i|val` 进分母且保留。保真账本按对仍 99.0%、md5 仍 `95846f03…`/`aab9813c…`；往返账
`493f292…`/`704461d…`，两次复跑逐字节相同；四条变异腿与上轮一字不差（52.5 / 59.4 /
99.0 / 96.5）。

### 一、v0.169 只接了条件层，常驻那半还在纸上

表样式对文字有两份说法：**常驻**的 `w:style/w:rPr`（整张表都吃）与**条件层**的
`w:tblStylePr/w:rPr`（按位置吃）。v0.169 接了后一半（首行加粗），前一半依旧只进样式快照、
跟着 `styles.xml` 回去——Word 里是斜体的表，打开我们这边是正体。

这一轮把它接上：`tableStyleRun` 沿样式链读一遍 `w:rPr`，当成 `baseRunProps` 的 seed。

### 二、层序：表样式最弱，段落样式压过它

Word 的次序是 **字符 > 段落 > 表**。`baseRunProps(chain, pPr, tc, seed)` 本来就是
「先 seed、再逐层盖」，所以把表样式当 seed 正好——不用改合并逻辑。

结构测试把这一条钉死：表样式说斜体、段落样式写 `<w:i w:val="0"/>`，那一格的文字**不该**
斜体。`TableNormal` 不进链（Word 会用自己的定义换掉它，照抄等于把别家的默认写成用户的
声明），与 `styleCondCells` 同一条纪律。

### 三、这一轮账本为什么动了：裸 onOff 的归一

夹具里给表样式加了 `<w:i/>`（裸元素，没有 `w:val`）。普查那条「元素在场而无 `w:val` 记
`val=1`」的口径（v0.161 修的）把它记成 `i|val=1`；写出包里格内 run 也带 `<w:i/>`，同样
归一，于是 `i|val` 这一对从「宇宙里没有」变成「进分母且保留」。

换句话说：**账本这一动不是我们多写了属性，而是夹具多了一种写法，恰好落在那条归一化口径上**。
显示那一半（`<em>`、以及「段落压过表」的反例）仍然只能靠结构测试。

### 教训

1. **「接了条件层」不等于「接了样式层」**（v0.171）：同一个 `w:style` 里两份 rPr，位置不同、
   优先级不同、连触发条件都不同。v0.169 修完条件层就以为这一族完了，其实只走了一半。
2. **层序要拿反例钉**（v0.171）：只测「表样式生效」测不出「谁压谁」——段落样式显式写
   `w:i w:val="0"` 的那一格才是尺子。
3. **账本的每一次变动都要能说出「为什么是这一对」**（v0.171）：这次是裸 onOff 的归一化带来的，
   与写手新写的字节无关。说不清就说明口径里有暗礁。

### 顺延清单（D31）

- `fldChar` 三对（域指令，模型无槽）；`outline|val`（文字镂空，包无原生槽）。
- 表/节一族：`col|w`/`col|space`、`wAfter|*`、`gridAfter|val`、`smartTag|*`、`legacy|*`。
- 承接未动项：`gridCol`/`tcW` 的 ±5 缇、`w:cols` 的 `equalWidth`、`ind|left` 的列表
  缩进覆盖、`docPr|id` 重排、`lvlJc` 深层 `center`。
- **`theme1.xml` 进不进普查清单**仍要定口径（部件账的可能性大于灌进 `PARTS`）。

---

## v0.172（D31）——表行余量：补丁长到「容器可能不存在」这一档

| | 上一轮 | 这一轮 |
|---|---:|---:|
| 正文属性 | 241/298 = 80.9% | **246/300 = 82.0%** |
| 图形壳 | 28/319 = 8.8% | 28/319 = 8.8% |
| 合计 | 269/617 = 43.6% | **274/619 = 44.3%** |
| 掉了 | 331 | **328** |
| 值变 | 17 | 17（正文 15、图形壳 2） |

三对从「掉了」变「保留」：`gridAfter|val`、`wAfter|w`、`wAfter|type`；另外夹具新增了
`trHeight|val` / `trHeight|hRule` 两对（都保留）。保真账本按对仍 99.0%、md5 仍
`95846f03…`/`aab9813c…`；往返账 `cf81f26…`/`da817a7…`，两次复跑逐字节相同；四条变异腿
与上轮一字不差。

### 一、它在 v0.155 是「纯只读记账」

`w:trPr` 里的 `w:gridAfter`（这一行末尾空过几格）与 `w:wAfter`（行末留白：宽与档位）从
v0.155 起就被读出来扔掉了，注释写「包没有这两枚元素的槽」。这一轮把它们接上：`data-trpr`
kv 载荷（`gridAfter=0;wAfterW=120;wAfterType=dxa`）随 `<tr>` 进出。

### 二、补丁的第三档：容器自己也可能不存在

前几族的落点分别是「改一枚已有元素的属性」（v0.164 shd）「整片替换一个块」（v0.163
tblBorders）「往块里插一枚子元素」（v0.167 between/bar）。这一族多一档麻烦：**连
`<w:trPr>` 本身都可能没有**——包只在行有高度/表头属性时才发它。

于是补丁有两种落点：
- 行里已有 `<w:trPr>`：按 CT_TrPr 的序插在 `cantSplit`/`trHeight`/`tblHeader` 之前
  （那几枚排在 gridAfter/wAfter 之后）；
- 没有：现开一枚 `<w:trPr>`，位置必须是 `<w:tr>` 的第一个孩子。

两种都在结构测试里钉着（第一行带行高走前一条，第二行不带走后一条）。

### 三、登记：一行一格，含嵌套表的行

`dt.rowPrs` 与 document.xml 里每个 `<w:tr>` 一一对应、同序。嵌套表的内层行在 `blocksOf`
里先入账，而 XML 里外层 `<w:tr>` 也排在前面——两边都是文档序，天然对齐。计数闸门照旧：
枚数对不上整笔放弃。

### 教训

1. **插入类补丁要问「容器在不在」**（v0.172）：`<w:trPr>`、`<w:pPr>` 这类容器都是「有内容
   才发」的，补丁得自带「现开一枚」的分支；开出来的位置还得符合 schema（第一个孩子）。
2. **锚点表按 schema 序，不按现状**（v0.172）：现在包里只有 trHeight，不代表将来不会多
   一枚 cantSplit；锚点写成「第一个已知后续元素」比「接在末尾」稳。

### 顺延清单（D32）

- `fldChar` 三对（域指令，模型无槽）；`outline|val`（文字镂空，包无原生槽）。
- `col|w`/`col|space`（不等宽分栏，模型没有逐栏宽）；`smartTag|*`、`legacy|*`（兼容残留）。
- 承接未动项：`gridCol`/`tcW` 的 ±5 缇、`w:cols` 的 `equalWidth`、`ind|left` 的列表
  缩进覆盖、`docPr|id` 重排、`lvlJc` 深层 `center`。
- **`theme1.xml` 进不进普查清单**仍要定口径（部件账的可能性大于灌进 `PARTS`）。

---

## v0.173（D32）——读手不动一对属性，只把 8 棵树收成 1 棵

| | 上一轮 | 这一轮 |
|---|---:|---:|
| 正文属性 | 246/300 = 82.0% | 246/300 = 82.0% |
| 图形壳 | 28/319 = 8.8% | 28/319 = 8.8% |
| 合计 | 274/619 = 44.3% | 274/619 = 44.3% |
| 掉了 / 值变 | 328 / 17 | 328 / 17 |
| 保真按对 / 字面 | 99.0% / 98.4% | 99.0% / 98.4% |

这一轮**没有补任何一对属性**，改的是读手的调用结构：`docxToHtmlFidelity` 里 7 个
「跑正文前按名查问」的只读扫描（v0.150 文档标记 / v0.151 形状壳 / v0.153 VML 壳 /
v0.154 cnfStyle / v0.155 DrawingML）与正文 `run()`、文档背景、节属性，
各自 `parseXml(documentXml)` 一次——**同一份 `word/document.xml` 建 8 棵树，7 棵查完即丢**。
v0.153 的注释已经承认「各 parse 一次是浪费」，后面几族一路叠到 8 份。

### 一、账本为什么只动了 `modules` 一行

两本账的 `measured.modules` 数的是 `src/lib` 下的模块数（探针 materialize 的取样范围）。
本轮新增 `outline.ts` 与 `format-painter.ts`，**59 → 61**，`docs/fidelity.md`、
`docs/fidelity.json`、`docs/fidelity-roundtrip.md` 各有一行随之变化。这是元信息，
不是覆盖对：consulted 集合、neverConsulted、四档分值、掉了/值变的逐对清单**逐字未动**。

为什么覆盖率敢不动：探针注入在 `ooxml.ts` 的 `attr`/`attrL` 漏斗上，量的是
「读手按名查问过哪些对」。7 个 `note*` 仍各自遍历、各自按名查问，与它们拿的是不是
同一棵 `XEl` 树无关；账本存的是集合，不存查问先后。所以「8 棵树合成 1 棵」不该
碰任何一个百分比——**反过来，如果这轮的数字动了，那就是改错了地方**。

### 二、共享可变树时，读者要分「改动前 / 改动后」

`run()` 里的 `applyThemeFonts(doc, theme)` 会**就地**给 `rFonts` 补具名字体属性
（v0.138）。优化前 `docBackgroundOf` / `sectionOf` 各自新 parse 一棵未改动的树；
共享同一棵之后若仍放在 `run()` 之后，它们读到的就是被改过的树。

这一轮把两族**移到 `run()` 之前**，读未经改动的树，与优化前逐字同义。
纯只读的 7 个 `note*` 也在 `run()` 前，语义同样不变。
教训：**「只读扫描」与「就地落地」共用一棵树时，顺序就是语义**；判据不是
「跑通了」，是「两本账与变异腿一字不动」。

### 三、性能的三把尺（夹具纯合成，不冒充真件）

`scripts/bench-docx-parse.mjs`：静态数 `parseXml(documentXml)` 调用点（**8 → 1**）、
同一串 XML 建 8 棵树 / 1 棵树的微基准、端到端 `docxToHtmlFidelity` 预热 2 趟 +
5 趟中位。N=500 / 2000 / 8000 段：

| N | 改前 | 改后 | 变化 |
|---:|---:|---:|---:|
| 500 | 61.5ms | 34.0ms | −44.7% |
| 2000 | 191.4ms | 99.3ms | −48.1% |
| 8000 | 897.7ms | 389.9ms | **−56.6%** |

微基准 N=8000 的 8 树 / 1 树是 525.9ms / 61.0ms（8.62×），端到端省下的 507.8ms
与这个差值同量级。2× 规模对照仍近线性，不是 O(n²) 被顺手修掉。

### 四、门禁

tsc 0、build ✓；结构测试 runprops **173**、本轮新功能 **29**、PDF 文本编辑全通过；
往返账 `01f93dfe…`/`da817a7…` 两次复跑逐字节相同；四条变异腿
**52.5 / 59.4 / 99.0 / 96.5** 与上轮一字不差，写完用干净腿复位到
`d52d234a…`/`3bd39cf8…`（`no-theme` 必须不动，说明新读点没有绕过注入锚点）。

### 顺延清单（D33）

- 差距评估的第一档（见 `docs/wps-gap-assessment.md`）：**图形壳 8.8%** 整族设计、
  Writer 视图缩放 / 独立打印预览 / 内容区右键菜单、Impress 母版编辑与缩放、PDF 查找替换。
- D32 原账不动：`fldChar` 三对、`outline|val`、`col|w`/`col|space`、`smartTag|*`、
  `legacy|*`、±5 缇、`w:cols` `equalWidth`、`ind|left`、`docPr|id`、`lvlJc`；
  `theme1.xml` 进不进普查清单仍要定口径。

---

## v0.174（D33）——查问顺序整个变了，账本一分没动

| | 上一轮 | 这一轮 |
|---|---:|---:|
| 正文属性 | 246/300 = 82.0% | 246/300 = 82.0% |
| 图形壳 | 28/319 = 8.8% | 28/319 = 8.8% |
| 合计 | 274/619 = 44.3% | 274/619 = 44.3% |
| 掉了 / 值变 | 328 / 17 | 328 / 17 |
| 保真按对 / 字面 | 99.0% / 98.4% | 99.0% / 98.4% |
| 探针记录对 / 已查问字面 | 715 / 23396 | 715 / 23396 |

### 一、v0.173 收了解析，没收遍历

上一轮把 `document.xml` 的 8 次 `parseXml` 收成 1 次，但入口那 7 处调用里的
**5 个 `note*` 只读扫描仍各自 `allDesc(doc, tag)` 把全树摊平一遍**。

**动手前重新数了一遍**（v0.162「清单上的数字会错」）：旧写法不是注释里沿用的
「7 个扫描」，而是 **5 个 `note*` 函数、16 个 `allDesc` 调用点 + 1 个 `findDesc`**：
文档标记 2、形状壳 7、VML 壳 4、cnfStyle 1、DrawingML 2。
「7」是「5 个 note* + 文档背景 + 节属性」的**入口调用数**，两种口径别混。

更贵的是 VML / Drawing 两族的形状：
`for (每个 pict/drawing) for (25 个标签) allDesc(容器, 标签)` —— 每个容器把
自己的子树摊平 25 遍，图形密集的件上重复访问成百上千倍。

### 二、一次索引，六条等价纪律

`buildDocIndex(doc)` 一趟递归收齐：全局按 local name 分组的后代、
每个 pict/drawing 自己的后代（**不含容器自身**，与 `allDesc` 同义）、
深度优先第一枚 `schemeClr`。5 个 `note*` 改为 `tagOf(idx, name)` 查表，
VML / Drawing 改为「每个容器一趟、按 `local(el.name)` 分派同一张表」。

六条纪律（账本逐条验）：① `#doc` 壳不进索引、`w:document` 进；② 匹配仍按
local name（前缀无关）；③ VML 只在 pict 子树、Drawing 只在 drawing 子树；
④ 嵌套容器的后代对每一层祖先都算；⑤ `schemeClr` 只问第一枚；
⑥ 每枚属性的按名查问一次不少。**索引只读，建在 `applyThemeFonts` 之前**，
与 v0.173「背景/节属性读改动前的树」同一条顺序纪律。

### 三、查问顺序变了，为什么账还敢不动

旧写法是「按标签分组、每个标签内按文档序」；新写法是「按文档序、每个元素按标签」。
**账本存的是 consulted 集合，不存顺序**，所以顺序变化不该碰任何百分比。
反过来，这一轮的数字要是动了，就是索引漏了某一族元素——账本自己会喊。

实测：保真 99.0% / 98.4%、探针记录对 **715**、已查问字面 **23396** 全不动；
往返四档分值全不动。唯一变动仍是 `modules` **61 → 63**（新增 `view-zoom.ts`
与 `context-menu.ts`），三个账本文件各一行。

### 四、性能判据：同进程 A/B，不取两次独立运行的差

跨进程复跑的绝对值随机器负载浮动很大（同一份改后代码两次跑出 323.1ms 与
255.7ms）。所以把改前读手导出成副本，在**同一进程、同一夹具**上交替顺序跑，
两腿各 10 样本取中位：

| 夹具 | A（改前 36d27e8） | B（本轮） | 降幅 | HTML 逐字相同 |
|---|---:|---:|---:|---|
| 纯文字 N=8000 | 330.3ms | 250.4ms | **−24.2%** | ✓ |
| 图形密集 N=1600 | 271.0ms | 194.0ms | **−28.4%** | ✓ |

副本重建：`git archive 36d27e8 src/lib | tar -x -C tmp/bench-old`
（脚本 `scripts/bench-docx-parse.mjs` 末段自动检测副本并加跑 A/B）。
**HTML 逐字相同**是第二条硬闸：`note*` 只上账不改屏，两腿的输出若有一个字不同，
就是索引把某族元素喂错了地方。

### 五、门禁

tsc 0、build ✓；结构测试 runprops **173** + v0.173 功能 **29** + v0.174 外壳 **40**
+ PDF 文本编辑全通过；往返账 `fdef3380…`/`da817a7…` 两次复跑逐字节相同；
四条变异腿 **52.5 / 59.4 / 99.0 / 96.5** 一字不差，mut 腿写完用干净腿复位到
`964753f5…`/`7ecc64d6…`。

### 顺延清单（D34）

- 差距评估第一档剩余：**图形壳 8.8%** 整族设计、Writer 独立打印预览与标尺、
  Impress 母版编辑与缩放、PDF 查找替换。
- D32/D33 原账不动：`fldChar` 三对、`outline|val`、`col|w`/`col|space`、
  `smartTag|*` / `legacy|*`、±5 缇、`w:cols` `equalWidth`、`ind|left`、
  `docPr|id`、`lvlJc`；`theme1.xml` 进不进普查清单仍要定口径。

---

## v0.175（D34）——docx 读手一寸未动，账本只跟了一次模块数

本轮改的是 Writer 打印预览与 **pptx** 的关系文件读取（见 `docs/pptx-fidelity-audit.md`
的 v0.175 节），docx 读手、写手、schema 一律没碰。两本账照跑作回归：

| 腿 | 数 |
|---|---|
| 保真 | **99.0% / 98.4%**，探针记录对 715，已查问字面 23396 |
| 往返 | 正文 246/300 = 82.0%、图形壳 28/319 = 8.8%、合计 274/619 = 44.3%；掉 328、值变 17 |
| 四条变异腿 | 52.5 / 59.4 / 99.0 / 96.5，与上轮一字不差；mut 后干净腿复位到 `a749b93d…`/`d5aa905f…` |
| 往返账 md5 | `def87db8…`/`da817a7…`，两次复跑逐字节相同 |

**唯一变动**：三份 docx 账本各一行 `modules` **63 → 64**（新增 `src/lib/print-preview.ts`）。
与前两轮同一条纪律：modules 数的是 `src/lib` 模块数，是元信息不是覆盖对；
变异腿复位后仍回到同一个 md5。

### 顺延清单（D35）

- 差距评估第一档剩余：**图形壳 8.8%** 整族设计、Writer 标尺 / 可交互状态栏 /
  逐页翻页预览、Impress 母版编辑与缩放、Calc 视图缩放、PDF 查找替换。
- D32–D34 原账不动：`fldChar` 三对、`outline|val`、`col|w`/`col|space`、
  `smartTag|*` / `legacy|*`、±5 缇、`w:cols` `equalWidth`、`ind|left`、
  `docPr|id`、`lvlJc`；`theme1.xml` 进不进普查清单仍要定口径。

---

## v0.176（D35）——兜底导入的批注重锚，从逐 id 扫全文到一次预扫

| | 上一轮 | 这一轮 |
|---|---:|---:|
| 正文属性 | 246/300 = 82.0% | 246/300 = 82.0% |
| 图形壳 | 28/319 = 8.8% | 28/319 = 8.8% |
| 合计 | 274/619 = 44.3% | 274/619 = 44.3% |
| 掉了 / 值变 | 328 / 17 | 328 / 17 |
| 保真按对 / 字面 | 99.0% / 98.4% | 99.0% / 98.4% |

### 一、改的是兜底路径，不是保真读手

`docxToCommentHtml` 只在 mammoth 兜底导入时走（保真导入按区间原位包 span，
不进这个函数，也不进保真账本）。所以这一轮**账本必不可能动覆盖对**——
它量的不是这条链。改的是它内部 `anchorOf(id)` 的形状：

```
每个批注 ×（全文正则 exec + docXml.slice(bodyStart) 大串复制 + 全文 indexOf）
```

`commentAnchorsOf(docXml, joinT)` 一趟 `matchAll` 收齐所有
`commentRangeStart/End` 并按 id 配对，变成 O(全文 + 各锚点片段)。
HTML 里包 span 的替换循环**一字未动**：相同锚文本会嵌套是既有语义，
本轮不借性能优化顺手改它（要改就单独立账、单独立断言）。

### 二、等价性：把改前算法复刻一份逐例对撞

`scripts/test-comment-anchor.mjs` 里 `legacyAnchors` / `legacyHtml` 是改前实现的
逐字复刻，两边不共用实现；九种形状 + 两条源码形状断言共 **12 项**：
正常三枚、跨段、缺 End、全文无 `</w:p>`、重复 id 只认第一对、属性乱序、
实体解码、空锚、相同锚文本的嵌套语义不变。

四条等价纪律：① 每个 id 只认第一对；② 仍取 Start 之后第一个同 id End；
③ `indexOf('</w:p>', start) < endAt` 原样保留（**含 indexOf 返回 -1 时
`-1 < endAt` 为真的边界**，这一条最容易在重写时丢）；④ `joinT` 由调用方传入，
与旧路径同一份实现。

### 三、性能：同进程 A/B

`scripts/bench-comment-anchor.mjs` 造合成 docx（1600 填充段 + C 条批注），
改前副本 `git archive HEAD src/lib | tar -x -C tmp/bench-docx-old`，
两腿同夹具交替顺序各 10 样本取中位，并逐字比对输出 HTML 与 comments：

| 批注数 | A 改前 | B 本轮 | 降幅 | 输出逐字相同 |
|---:|---:|---:|---:|---|
| 50 | 5.1ms | 3.6ms | **−28.1%** | ✓ |
| 800 | 153.3ms | 102.7ms | **−33.0%** | ✓ |

800 条仍要 102.7ms：省掉的是 docXml 那一半，HTML 替换循环还在每次整串拼接，
按上面的语义原因留到下一轮。跨进程端到端：50/200/800 条为
3.4 / 7.4 / 104.5ms（5 趟中位），与 A/B 同量级。

### 四、门禁与账本元信息

tsc 0、build ✓；结构测试 runprops **173** + 外壳 **63** + PDF 替换 **23** +
批注等价 **12** + PDF 文本编辑全通过。docx 两本账、四条变异腿
（52.5 / 59.4 / 99.0 / 96.5）与上轮一字不差，mut 后干净腿复位到
`1979f813…` / `72ff93c1…`，往返账 `ed7a2737…` / `da817a7…` 两次复跑一致。
pptx 账 70.1% / 74.3% 与 42/19 双向断言全绿，`--mut no-ga` 42 条全红后复位
`d06e404b…` / `b7e4d706…`。

**五份账本唯一变动**：`modules` **64 → 65**（新增 `src/lib/pdf-replace.ts`），
覆盖率与逐对清单逐字未动。

### 顺延清单（D36）

- 差距评估第一档剩余：**图形壳 8.8%** 整族设计、Writer 标尺 / 可交互状态栏 /
  逐页翻页预览、Impress 母版编辑与缩放、Calc 视图缩放；
  **pdf-lib 按需加载**仍等 `src/lib/pdf-text-edit.ts` 那条线自行入库。
- D32–D35 原账不动：`fldChar` 三对、`outline|val`、`col|w`/`col|space`、
  `smartTag|*` / `legacy|*`、±5 缇、`w:cols` `equalWidth`、`ind|left`、
  `docPr|id`、`lvlJc`；`theme1.xml` 进不进普查清单仍要定口径。

---

## v0.177（D36）——第一族图形壳整族往返：14 对从「掉了」转「保留」

| | 上一轮 | 这一轮 |
|---|---:|---:|
| 正文属性 | 246/300 = 82.0% | 246/300 = 82.0% |
| **图形壳** | **28/319 = 8.8%** | **42/319 = 13.2%** |
| **合计** | **274/619 = 44.3%** | **288/619 = 46.5%** |
| 掉了 / 值变 | 328 / 17 | **314** / 17 |

这是往返账开账以来第一次因为「补了一族」而动分值（此前几轮动的都是 `modules`
元信息）。**逐对列名**（对 `git show HEAD:docs/fidelity-roundtrip.json` 做 bucket 差分）：

```
anchor|distT  anchor|distB  anchor|distL  anchor|distR
anchor|allowOverlap  anchor|behindDoc  anchor|layoutInCell
anchor|locked  anchor|relativeHeight  anchor|simplePos
positionH|relativeFrom  positionV|relativeFrom
simplePos|x  simplePos|y                        —— 共 14 对，全部 lost → kept
```

### 一、顺延清单上的「包没有槽」是判断，不是判决书

读手 v0.148/v0.149 把这十枚属性读进了 `data-img` 载荷，注释写着
「写侧只发内嵌图（包没有 `wp:anchor` 的槽）」，于是整族挂账多轮。
翻 `node_modules/docx/dist/index.d.ts` 才看见 `CoreImageOptions.floating?: IFloating`，
包实现的 `Anchor` 类本来就发 `<wp:anchor distT=… allowOverlap=… relativeHeight=…>`。
**与 v0.159 的 SymbolRun、v0.170 的 pageNumbers、v0.172 的 gridAfter 同一条学费**，
隔了若干轮又交一次：动手前先翻实现，别信清单上的理由。

三段接通：读手按 `wp:anchor` 元素在载荷里标 `anKind=anchor`，并把
`relativeHeight` 从 `onOff` 改成数值读取（它是 unsignedInt 层级号，真件里常是
`251658240`，用 onOff 会整枚丢）；写手 `imageRunOf` 据此给 `ImageRun` 传 `floating`；
`patchImgXml` 按载荷原值回填十枚属性 + `wp:simplePos/@x|y`（包发出的
`simplePos` 恒 0、`relativeHeight` 在 zIndex 为 0 时退化成图片高度，都不是源件的话）。

`positionH/V|relativeFrom` 两对是 `floating.horizontalPosition/verticalPosition`
按 `posH/posV` 映射包枚举顺带带出来的，不是另写的补丁；认不出的基准落 `page`。

### 二、中途两笔「值变」当场清掉

只传 `floating` 而不补 `wp:simplePos` 坐标时，账上 `simplePos|x/y` 从「掉了」
变成「值变」（元素出现了、`x/y` 是包硬编码的 0，源是 360/720）。这类假绿比掉了
更难看——名字在就以为回来了。按载荷 `spX/spY` 补完后，值变回到 17，
14 对全是干净的 `lost → kept`。

### 三、变异腿往上跳 0.1 个点，是读点换了漏斗

第一遍把 `relativeHeight` 写成 `attrNum(...)` 后，`--mut no-attr` 从
**59.4% → 59.5%**、探针记录对 416 → 417。`attrNum` 是 `attr ?? attrL` 两条路，
旧的 `onOff(attr(...))` 只走 `attr` 一条；注入掉 attr 的腿靠 attrL 多问到这一对。
**覆盖率往上跳不是成绩**（v0.165 那条教训）。改回 `attr` 单漏斗 + `Number()` 后，
四条腿回到 52.5 / 59.4 / 99.0 / 96.5、记录对 416，保真账 99.0% / 98.4% /
探针记录对 715 全程不动，干净腿复位 `1979f813…` / `72ff93c1…`。

### 四、性能与一处语义修复（同一条链的另一端）

`docxToCommentHtml` 的 HTML 替换循环改成「原始 html 里一次规划 + 分段拼接」，
替掉每枚批注两遍整串复制。同进程 A/B：50 条 **4.7 → 2.4ms（−49.7%）**、
800 条 **147.2 → 10.0ms（−93.2%）**，输出逐字相同。相同锚文本的第二枚批注
不再命中刚插进去的 span（旧写法两枚套成嵌套），这一条**单独立账**：
`test-comment-anchor.mjs` 第 9 例改为断言「两枚各自独立」，13 项全绿。

### 五、门禁

tsc 0、build ✓；结构测试 173 + 63 + 29 + 23 + **26**（浮动图完整链路）+
**13**（批注等价）+ PDF 文本编辑全通过。`scripts/test-anchor-roundtrip.mjs`
走的是产品真出口（夹具 → 读手 → HTML → TipTap schema → PM → 写手 → 解包），
不是手搓模型；26 项含「内嵌图没被误伤」。

往返账 `3f202013…` / `f29e31ac…` 两次复跑逐字节相同。**保真账、pptx 账与 HEAD
逐字节相同**；本轮没有新增 `src/lib` 文件，`modules` 保持 65。

### 顺延清单（D37）

- 图形壳剩余族：`shape`(20) / `bodyPr`(19) / `rect`(15) / `fill`(14) / `line`(14)
  / `reflection`(13) / `shadow`(13) 等 VML 老式形状族——模型无槽、写手写不出，
  仍要整族设计，别按榜单逐个打补丁。
- `positionH/V` 的 `posOffset` 与环绕档位（包只发 0，另立一轮）；
  浮动图的屏上锚点摆放（Web 流式排版没有环绕，壳只保真不上屏）。
- 第一档剩余：Writer 标尺 / 可交互状态栏 / 逐页翻页预览、Impress 母版编辑与缩放、
  Calc 视图缩放；**pdf-lib 按需加载**仍等 `pdf-text-edit.ts` 那条线入库。
- D32–D36 原账不动：`fldChar` 三对、`outline|val`、`col|w`/`col|space`、
  `smartTag|*` / `legacy|*`、±5 缇、`w:cols` `equalWidth`、`ind|left`、
  `docPr|id`、`lvlJc`；`theme1.xml` 进不进普查清单仍要定口径。
