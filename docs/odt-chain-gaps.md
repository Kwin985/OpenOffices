# ODT 链的第一次探针（v0.222）

> 这份文档记的是**方法**与**否定结果**，不是分数。ODT 没有账本（docx / pptx / xlsx / ods 都有），
> 所以这里量到的三条都是探针级结构事实，不能折算成任何百分比。

## 为什么先做探针而不是直接立账

`src/lib/odt.ts` 有 2482 行读写代码，是全仓**唯一既没有保真账、也没有往返账**的一环。但「立一本账」
和「找一处缺口」是两件事：

- 账本要求输入有代表性。ODT 手头**没有任何真件**（本机扫描为零），照 xlsx 那条路（拿真件跑外部入口）
  走不通；照 docx 那条路（手写一份 700 对的富夹具）则需要先把「真实 ODT 里有哪些属性」摸清。
- 而摸清这件事本身只需要一份**小而准**的夹具：把常见族各写一枚，看读手认不认、写手还发不发。
  这一趟就能把「该不该立账、立多大」的问题回答了。

于是先搭探针，不先铺量具。

## 探针怎么搭

复用产品**自己的包骨架**，只换 `content.xml`：

1. 先用 `prosemirrorToOdtBytes` 造一份只有一段的最小包，拿到 `mimetype` / `META-INF/manifest.xml` /
   `styles.xml` 的**产品形状**（这三件的合法性由产品自己保证，探针不重复造一遍）；
2. 把手写的富 `content.xml` 塞进去（段落对齐/缩进、加粗/斜体/下划线/删除线/字色/字号/高亮/上下标、
   有序与无序列表、合并表格、超链接）；
3. `odtToHtml` → HTML → TipTap schema → PM → `prosemirrorToOdtBytes`，再拿两份包逐格 / 逐样式对撞。

**为什么不用「产品写手造源包」那一路**（`ods-roundtrip` 的默认输入就是这么来的）：那是闭环自证——
写手不发的东西，账本也永远不会问。ODT 这一轮要答的恰恰是「写手发不发」，源包必须由人写。

Node 侧跑 `odtToHtml` 要先装 DOM：`@xmldom/xmldom` + 给原型补一个 `children` getter（与
`scripts/test-odt-*.mjs` 同一套装配）。**注意 xmldom 与浏览器的语义差**，见下面第三节。

## 一、ODF 的格位怎么算（这一条决定了两处真缺口）

ODF 的格位按**行内元素序**：每枚 `table:table-cell` / `table:covered-table-cell` 各占**一列**，
`table:number-columns-spanned` 只是「这一格跨了几列」的元数据，**不推进列位**。

这条口径容易搞反，两种读法都「看起来自洽」：

| 读法 | 对合规件的后果 |
|---|---|
| 每枚元素占一列（正确） | 锚点 + (cs-1) 枚占位 = cs 列 ✅ |
| 锚点按 cs 推进、占位格再各占一列 | 同一片合并区被数成 2cs-1 列 ❌ |

写侧漏发占位格（v0.221 的 ODS、本轮的 ODT）时，用第二种读法算出来反而「正好对」——**读写两侧
对称地错，往返自己看不见**。这就是为什么这两处缺口只能靠「对撞两个独立实现」或「人读文件」发现：
族级 / 属性级账本量的都是「源里说过的东西还在不在」，而这里丢的是**位置**。

## 二、三处真缺口与修法

### 2.1 表格合并区：跨列锚点后一枚占位都不发

写手铺了覆盖矩阵，但主循环 `while (c <= lastCol)` 里 `c += colspan` 直接跳过跨出去的列，
`covered.has()` 那一支只对「上一行纵向合并盖下来的位置」和「行首缺格」生效。

顺带一个更隐蔽的形状：行右缘取的是 `Math.max(...line.map(x => x.col))`，也就是**最右那格的左边**。
「整行都被上一行纵向合并盖住」时 `line` 是空的，行尾算成 0，那一行只补出 1 枚占位。

**修**：锚点后按 `colspan - 1` 逐枚补 `<table:covered-table-cell/>`；行右缘取
「各格跨越后的右缘」与「本行被盖住的位置 + 1」的最大值，循环改 `c < rowEnd`。

### 2.2 高亮：读手发错了形状，写手反而是好的

读手把 `fo:background-color` 发成行内 `<span style="background-color: …">`，而 TipTap 的
`Highlight` 只按 `<mark>` 解析——高亮在「HTML → 模型」这一步就丢了。写手侧一直通
（`charStyleXml` 把 `highlight` mark 的色写成 `fo:background-color`），**两头对不上**。
改成与 docx 读手同一枚形状（`<mark data-color="…" style="background-color: …; color: inherit">`）。

### 2.3 下划线 / 删除线：`??` 兜底在测试 DOM 里静默失效

ODF 里这两族各有两枚同义属性（`style:text-underline-type` / `style:text-underline-style`，
删除线同理），读手原本写 `getAttribute('…-type') ?? getAttribute('…-style')`。

`getAttribute` 缺属性时**浏览器返回 `null`、`@xmldom/xmldom`（0.8.15）返回空串**，`??` 在 xmldom
下整枚兜底失效。于是「只写 `-style` 的合法 ODF」（LibreOffice 两枚都写，别家不一定）在测试里读不到、
在浏览器里读得到——**量具与产品量的不是同一件事**。改用 `||`。

> 推广：`getAttribute(...) ?? 兜底` 这个形状在本仓 ODT 读手里还有别处。凡是新增「两枚同义属性
> 取其一」的兜底，一律用 `||`；用 `??` 的必须确认那条路不依赖 `getAttribute` 的返回值。

## 三、这一轮被否掉的三个猜想（记下来，省下轮重复走）

1. **docx 合并表也有格位问题？** —— 没有。`gridSpan` / `vMerge` / 跨列格的 `tcW` /
   `w:tblGrid` 逐格对撞 0 差异（3×3、跨 2 列 2 行、不等宽 2000/4000/6000 缇都试过）。
   唯一「变宽」的现象是 **autofit 档**把跨列格的 `tcW` 均摊到所跨各列——这是对过 Word 53 臂的
   口径（`z_aut_row1_span` 行 1 跨 2 格 3600 缇 ⇒ 90|90|120），首存之后位形稳定，不是漂移。
2. **ODS 账本只有 14 对，是不是能力缺口？** —— 不是。写手支持单元格样式（`table-cell` 家族、
   border / background / vertical-align / padding / 数字格式），薄的是**默认夹具**：那份夹具里
   一个带格式的格都没有。薄账本是夹具问题，不是产品问题。
3. **pptx 导出是不是纯重排、往返必丢？** —— 不是纯重排。导出是「pptxgenjs 生成 + 解包注入」
   的混合体（`zip.file(name, next)` 只写改过的部件），两处已知的往返不对称（标题/正文槽导出成
   自由文本框导致再导入多两枚形状；母版占位矩形不回写 slideMaster）早已记在
   `docs/pptx-fidelity-audit.md` 末尾，不是新发现。

## 四、还没做的

- **ODT 仍未立账。** 本轮探针夹具（段落 + 行内三族 + 列表 + 合并表 + 超链接）已经够长成一份
  真账本的雏形：要立账就是把它扩到 100+ 对、配上 `--mut` 变异腿。**但先要答一个问题**：
  没有真件的情况下，账本的分数表示什么？docx 那条路的答案是「内置夹具的成绩，不可外推」——
  ODT 照抄这句话就行，价值在于**变异腿能抓住回归**，而不在于那个百分数。
- `fo:font-family` 读手仍不认（只认 `style:font-name` / `fo:font-name` / `style:font-name-asian`）。
  LibreOffice 写的是后者，第三方件可能只写前者，缺真件可证。
- ~~表级 `table:align` / `style:width` 写手不发~~ —— **v0.223 更正**：`table:align` 的写手一直是通的
  （`tableStyleXml` 发 `table:align="center|right|margins"`，只发 `style:name` 那枚只在「有缩进或有对齐」
  时才发），缺的是**读侧**：`tableStyleCss` 只读 `fo:margin-left`，一个方向都没读，写手因此永远拿不到
  非缺省档。v0.223 已补（读侧沿样式链读 `table:align`、模型 `data-talign`、docx 侧同一条 `w:jc`）。
  `style:width`（表宽）仍不发：列宽走的是 `table:table-column` + 首行 `colwidth` 那条路。
- 合并区里的 `table:covered-table-cell` 占位格不带 `table:style-name`：读写两侧对称，往返不多丢东西，
  但 LibreOffice 打开那些格会退回默认框线。

## 五、查问面普查（v0.224）：43 对「源里在场、读手从未查问」

v0.222/223 的缺口都是「族级探针」撞出来的。这一轮换一套口径，把**读手查问了哪些「元素|属性」对**
整个记一遍（探针包在测试 DOM 的 `Element.prototype.getAttribute` 上，只记录不改返回值；源包普查
同一套解析器跑两遍、一遍不开记录），与源包真在场的对比。夹具 = LibreOffice 形状的手写富件
（段落/行内全排 + 表三族 + 列表档 + 链接/书签/脚注/批注 + 页面版式），95 对源对、**43 对从未查问**。

探针脚本不入库（`tmp/probe-odt-consult.mjs`，gitignored），方法与数字记在这里——它就是将来
ODT 账本的夹具雏形与分母来源。

### A. 本轮修掉（9 对）：docx 链已有槽、ODT 侧整族消失

| 族 | 源对 | 修法 |
|---|---|---|
| 字族兜底 | `text-properties\|font-family` | 兜底链末位补 `fo:font-family`（配对引号剥掉），沿用 `\|\|`（教训㊿） |
| locale | `language` / `country` / `language-asian` / `country-asian` / `language-complex` / `country-complex`（6 对） | language+country 合并成 docx 的 `"zh-CN"` 形状 → `data-lang` / `data-lang-ea` / `data-lang-bidi`（charExtra mark 接）；写侧把 mark 拆回两格，只有尾段像地区码才拆，`zh-Hans` 这类变体整串进 `fo:language` 不造非法 `fo:country` |
| 字符缩放 | `text-scale` | → `data-scale`（120% ↔ 120，与 `w:w` 同义） |
| 复杂文字字号 | `font-size-complex` | → `data-szcs`（半点，12pt ↔ 24） |

五族屏上都不兑现（CSS 无对应物），只往返——与 docx 链同一口径。守卫 `test-odt-run-extra.mjs`
18 条；负控（读手退回 HEAD）14 红 / 4 绿，绿的 4 条全是反例。

### B. docx 链有对应物、留待后续（按价值排序）

- `text-underline-style` / `-width` / `-color`（3 对）：docx 下划线载荷六格（线型;屏上色;字面色;主题三枚），
  ODT 只读 `type` ⇒ 下划线颜色/线宽丢。**下一波最顺手的一族**。
- `bookmark|name`（1）：docx 读手读 `w:bookmarkStart@w:name` 且有 `test-bookmark-ids` 守卫；ODT 书签名不读不写。
- `annotation|creator` / `|date`（2）：**写手反而发 `dc:creator`，读手不读**——又一次「两头对不上」，
  与 v0.222 高亮同款病。
- `list-level-properties|space-before` / `|min-label-width` / `|list-level-position-and-space-mode` +
  `list-level-style-number|num-suffix`（4 对）：列表标签几何与编号后缀；docx 列表有 ind/suff 对应。
- `text-transform`（1）：docx 有 caps/smallCaps 槽；ODT 的 `uppercase|lowercase|small-caps` 不读。
- `table-properties|width`（1）：表宽；docx 有 `w:tblW` 账。列宽那条路是通的，表级宽不是。
- `page-layout-properties|print-orientation`（1）：docx 页面设置有 orientation 槽。
- `paragraph-properties|keep-together` / `|hyphenate`（2）、`table-cell|value-type`（1）、
  `a|style-name` / `|visited-style-name` / `|type`（3）、`text-properties|font-weight-asian` /
  `|font-size-asian`（2，docx 无 szEa 槽）、`text-shadow` / `font-relief`（2，docx 槽是布尔近似）。

### C. 结构/身份对，不该读、记口径不追（10 对）

`office:version` ×2（写手自定）、`style|family` / `style|class`（写手按已知家族发）、
`font-face|name` / `|font-family` / `|font-family-generic` / `|font-pitch`（font-face-decls 壳，
写手重建）、`master-page|name`、`table|name`、`page-number|select-page`（页码格式的判据已在
footer 那一路按结构认，不认这枚枚举值）。
