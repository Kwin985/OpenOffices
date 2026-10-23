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
