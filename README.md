# OpenOffices — 开源办公套件

> 天下苦 WPS / Office 久矣。这是一个用 **Rust + Tauri 2** 构建、完全由开源内核驱动的本地办公套件，
> 目标是文档（Writer）、表格（Calc）、演示（Impress）三件套，数据全程不出本机。

## 文档在哪里

> 2026-10-16 拆分：这份 README 原来 10,316 行 / 1,943,030 字节，其中 161 节逐轮笔账（每轮的前置实测读数、判据、押错点名、量具坑）连同架构与路线图搬出 1,901,085 字节 = 97.8%，README 只留 41,929 字节的项目说明、当前发行、技术栈与开发入口。搬出去的每一段按原行区间整节落件，**一字未改**（每册写完立刻回读并与源文那一段逐字节比对；字节守恒账见本节收尾）。

| 文件 | 收录 | 行 | 字节 |
| --- | --- | --- | --- |
| [docs/ledger/01-v0.17-v0.59.md](docs/ledger/01-v0.17-v0.59.md) | 43 节：v0.17 发布工程 ～ v0.59 工作簿默认字体那一层 | 1,704 | 200,107 |
| [docs/ledger/02-v0.60-v0.81.md](docs/ledger/02-v0.60-v0.81.md) | 21 节：v0.60 缺省行高往返 ～ v0.81 标注写回那本账 | 1,506 | 196,941 |
| [docs/ledger/03-v0.82-v0.96.md](docs/ledger/03-v0.82-v0.96.md) | 17 节：v0.82 下载与安装分两拍 ～ v0.96 非表族整块流排 | 1,436 | 194,451 |
| [docs/ledger/04-v0.97-tbl-p17.md](docs/ledger/04-v0.97-tbl-p17.md) | 16 节：v0.97 文字深化一期 ～ 段落缩进按属性名继承 | 1,252 | 200,950 |
| [docs/ledger/05-v0.98-v0.124.md](docs/ledger/05-v0.98-v0.124.md) | 33 节：段落读侧第二笔 ～ xlsx 图表次轴 v0.124 | 1,312 | 199,915 |
| [docs/ledger/06-v0.125-odt-b38.md](docs/ledger/06-v0.125-odt-b38.md) | 18 节：xlsx 图表轴刻度 v0.125 ～ ODT 列表头尾包装层 b38 | 464 | 186,320 |
| [docs/ledger/07-odt-b39-b44-t40-t43.md](docs/ledger/07-odt-b39-b44-t40-t43.md) | 11 节：ODT 页眉页脚首页另版 b39 ～ 列表符面族 b44（含 t40～t43） | 378 | 185,772 |
| [docs/ledger/08-odt-b45-b46.md](docs/ledger/08-odt-b45-b46.md) | 2 节：符面专字前置 b45 ～ 符面专字第一笔账 b46 | 41 | 37,454 |
| [docs/ledger/09-t44.md](docs/ledger/09-t44.md) | 1 节：解析侧那枚长任务的前置实测 t44（只量不改产品） | 21 | 21,856 |
| [docs/ledger/10-odt-b47.md](docs/ledger/10-odt-b47.md) | 1 节：符面专字的屏上/纸面通道前置 b47（只量不改产品） | 12 | 23,026 |
| [docs/ledger/11-odt-b48.md](docs/ledger/11-odt-b48.md) | 1 节：符面专字接进 `meta.styles` 之前的消费点闸位前置量 b48（只量不改产品） | 16 | 20,741 |
| [docs/ledger/12-odt-b49.md](docs/ledger/12-odt-b49.md) | 1 节：符面专字接进 `meta.styles` 第四型与 `::marker` 规则那一枝的实现 b49（实现轮） | 21 | 36,515 |
| [docs/ledger/13-odt-b50.md](docs/ledger/13-odt-b50.md) | 1 节：第四型接上之后的候选窄口径普查 b50（只量不改产品） | 16 | 29,996 |
| [docs/ledger/14-odt-b51.md](docs/ledger/14-odt-b51.md) | 1 节：私有区符面在屏上到底有没有墨的前置实测 b51（只量不改产品） | 28 | 42,167 |
| [docs/ledger/15-odt-b51i.md](docs/ledger/15-odt-b51i.md) | 1 节：私有区符面「字符被拒而整口吞专账」的落点实现 b51i（实现轮：窄口径三处） | 28 | 46,955 |
| [docs/ledger/16-odt-b52.md](docs/ledger/16-odt-b52.md) | 1 节：专字规则与私有区符面的纸面那一半前置 b52（只量不改产品） | 15 | 23,704 |
| [docs/architecture.md](docs/architecture.md) | 架构：模块图 + 各层职责 + 逐轮就地改口 | 260 | 194,791 |
| [docs/roadmap.md](docs/roadmap.md) | 路线图：未勾 462 枚 / 已勾 169 枚 | 1,707 | 375,027 |

> 各册正文里的 `@10027`、`README 新增本节 @8304` 那类行号引用指的是拆分前的 README，如今按节名定位；读数、判据、押错点名本身一字未动。

- **收尾（本轮只搬字不改账）**：README `10,316 行 / 1,943,030 字节` → `358 行 / 44,888 字节`（CR 字节=0）；搬出 1,901,085 字节 + 留下 41,929 字节 + 段间换行 16 = 1,943,030，与原件逐字节守恒（原件 md5 `b2d54435b1a1e6bede91f3d5cc83ee8c`）；上文各轮收尾里引用的成品行数与字节数是拆分前 README 的历史读数，照原样留着不回填。
- **重复长行与全树尺（尺用前先校牙，无牙必须写进账）**：一把尺（逐行去空白后长度 >80 字符、键也去空白）跑三个面——拆分前的 README 单件 出现枚=3,632 / 去重值枚=3,627 / 重复值枚=4 / 重复出现总枚=9（原件取 `git cat-file -p HEAD:README.md` 的 blob，md5 `b2d54435b1a1e6bede91f3d5cc83ee8c`、CR 字节=0）；拆分后的全树（README + 11 枚 docs 册）=3,677 / 3,672 / 4 / 9；本条落件后再复算=3,678 / 3,673 / 4 / 9，只比上一面多本条自己那一枚长行。三面「重复值」那一栏始终是同样 4 枚而拆分造成的新重复枚=0，逐枚点名且枚枚在原件里本就重复：`cargo test --lib` 那行在 `docs/ledger/03-v0.82-v0.96.md` 内 3 次、`**本轮不占版本号**…` 与 `Rust 一个字没动…`各在 `docs/ledger/04-v0.97-tbl-p17.md` 内 2 次、`style:align` 该落那一行一枚住 `docs/ledger/02-v0.60-v0.81.md` 一枚住 `docs/roadmap.md`。校牙三枝各打合不合：① 往内存件注入两枚「全树只出现一次」的长行（住 `docs/architecture.md` 的前 24 字符「lib/sheet-print-ui.ts  【…」 与 住 `docs/architecture.md` 的前 24 字符「lib/sheet-print-setup.ts…」，长度=1,084 与 3,590 字符；点名里那 24 字符的「」已换成【】，免得打破全篇引号开闭差）⇒ 重复值枚 4→6 有牙=True；② 注入一枚全树不存在的新长行 ⇒ 仍=4 不误报=True；③ 注入一枚短行 `## 路线图` ⇒ 出现枚与重复值枚一字不动（短行落在 >80 那一池之外）。③ 就是这一枝的账：先前那一腿报「注入后重复枚不动 ⇒ 这把尺无牙」，凭③ 改口为「注入物没进到尺的池子里」而不是「尺坏」。尺谱也要并排打：同一棵拆分后的树按未去空白的原样长度算得 出现枚=3,971 / 去重值枚=3,966 / 重复值枚=4，与去空白尺差 294 枚（缩进续行因此过槛）；而「滤用原样、键用去空白」那把混尺在原件单件上给 出现枚=3,926 / 去重值枚=3,920 / 重复值枚=5——旧日志里那两枚 3,966 与「重复枚=5」分别住在这两把尺谱下，本轮按未复现点名而不改写旧账。全树尺搬迁前后同致：最长行 12,098 字符、>400 字符长行 370 枚（本条落件后=12,098 / 371）。md 件枚 2→12、行 10,177、字节 1,909,143 是搬出件自己新增的册头与回链。本条落件后 README 为 `359 行 / 47,527 字节`（CR 字节=0；上文那枚 `358 行 / 44,888 字节` 是装配那一趟的读数，本条新增 2,639 字节，两枚数各归各趟而不互相覆盖）。
- **t44 落件（本轮只量不改产品）**：新增 [docs/ledger/09-t44.md](docs/ledger/09-t44.md) 一册一节。本表 行 那一栏沿用 01..08 那把尺（全文件 `wc -l` 减 3，即册头三行不计），故 09 那行写 21 而全文件 24；字节那一栏一直是全文件 `wc -c` 的逐字同值（09=21,856）。roadmap 那一行同时改口为 未勾 431 枚 / 已勾 160 枚 / 1,667 行 / 321,161 字节（`grep -c` 现量，装配前基线 424/160；本轮勾 0 枚而新开 7 枚）。本条落件后 README 为 `361 行 / 48,808 字节`（CR 字节=0、「」开闭差=0、反引号 854 为偶，`wc -c` 与 python 两把尺同值）；那一枚自指数按 b46 那条修法先把数换进正文再复算，而本轮收敛靠的是那把闸而不是「等长」：占位 `NNN,NNN` 比真数 `48,494` 长一枚字符，换完全件少 1 字节 ⇒ 只押等长会把换之前的 48,495 写进正文而那一趟磁盘真值是 48,494；本册末条补上现算读数那一句后，两件各长一截而「写进正文」这一行本身也要占字节，故本条末尾的数是联合迭代再收敛后的现算值。
- **b47 落件（本轮只量不改产品）**：新增 [docs/ledger/10-odt-b47.md](docs/ledger/10-odt-b47.md) 一册一节（ODT 列表符面「专字」那一半的屏上/纸面通道前置实测）。本表 行 那一栏沿用 01..09 那把尺（全文件 `wc -l` 减 3，即册头三行不计），故 10 那行写 12 而全文件 15；字节那一栏一直是全文件 `wc -c` 的逐字同值（10=23,026）。architecture 那一行改口为 260 行 / 185,693 字节——本轮在那一册**新增** `lib/doc-style-css.ts` 一条而不是改口，因为该册从来没有那一条（装配腿押错，逐枚见 10 册收尾条）；roadmap 那一行同时改口为 未勾 439 枚 / 已勾 160 枚 / 1,675 行 / 328,926 字节（`grep -c` 现量，装配前基线 431/160；本轮勾 0 枚、收窄 5 枚、新开 8 枚）。下文「路线图」那一节的底数一并从 t44 留下的 424 枚改口到现量值——那是装配腿查出的一枚同册不同致（地图行写 431 而正文写 424），本轮把两处统一到同一把尺而不回填旧账。本条落件后 README 为 `363 行 / 50,464 字节`（CR 字节=0、「」开闭 72 开 / 72 闭 差=0、反引号 866 为偶，`wc -c` 与 python 两把尺同值）；那两枚自指数按 b46/t44 那条口径跑在**已经把数换进件**的正文上，而本表那一行与 10 册收尾条互为对方的数 ⇒ README↔10 册联合迭代到同致。
- **b48 落件（本轮只量不改产品）**：新增 [docs/ledger/11-odt-b48.md](docs/ledger/11-odt-b48.md) 一册一节（`meta.styles` 消费点榜与 kind 闸位的前置量）。本表 行 那一栏沿用 01..10 那把尺（全文件 `wc -l` 减 3，即册头三行不计），故 11 那行写 16 而全文件 19；字节那一栏一直是全文件 `wc -c` 的逐字同值（11=20,741）。architecture 那一行同时改口为 260 行 / 187,409 字节（本轮 185,693→187,409，+1,716 字节而 行 枚不变）——本轮在那一册**就地改口两条**而不新增条目：`lib/doc-style-css.ts` 那条补上家的形状（两枚白筛 `continue` 之后一段默认枝，而探针对 list／paragraph／无 kind 三枚**出口逐字相同**）与 31 枚消费点的闸位榜，`lib/odt.ts` 那条补上管子已通到界面（`DocEditor.tsx:539..541`/`:2249`/`:614`/`:552`）而真要动的仍是读手与家两处；roadmap 那一行同时改口为 未勾 446 枚 / 已勾 160 枚 / 1,682 行 / 334,111 字节（`grep -c` 与 `wc` 现量，装配前基线 439/160；本轮勾 0 枚、收窄 2 枚、新开 7 枚）。本条落件后 README 为 `365 行 / 52,080 字节`；那两枚自指数按 b46/t44/b47 那条口径跑在**已经把数换进件**的正文上，而本表那一行与 11 册收尾条互为对方的数 ⇒ README↔11 册联合迭代到同致。
- **b49 落件（本轮是实现轮：管 + 家两处各接一半）**：新增 [docs/ledger/12-odt-b49.md](docs/ledger/12-odt-b49.md) 一册一节（ODT 读手把符面专字填进 `meta.styles` 第四型，`styleCssOf` 立 `list` 枝出 scoped `::marker{font-family}` 规则）。本表 行 那一栏沿用 01..11 那把尺（全文件 `wc -l` 减 3，即册头三行不计），故 12 那行写 21 而全文件 24；字节那一栏一直是全文件 `wc -c` 的逐字同值（12=36,515）。产品改动面四件（`git diff --stat` 现量 +64/−7）：`src/lib/odt.ts`、`src/lib/doc-style-css.ts`、`src/lib/docx.ts`、`src/components/DocEditor.tsx`，而写手不吃第四型（`h1|6.1/6.2` 件面 `oo-bullet` 与「符面专字」两头命中枚=0，`h1|6.3` 探针臂在同一条路命中=1 ⇒ 是闸不是路断）。architecture 那一行同时改口为 260 行 / 188,977 字节——本轮在那一册**就地改口两条**（`lib/odt.ts`、`lib/doc-style-css.ts`）而不新增条目，故 行 枚不变；roadmap 那一行同时改口为 未勾 444 枚 / 已勾 165 枚 / 1,685 行 / 342,173 字节（`grep -c` 与 `wc` 现量，装配前基线 446/160；本轮勾 5 枚、收窄 3 枚、新开 3 枚）。下文「路线图」那一节的底数一并改到同一把尺而不沿用上一轮的数。本条落件后 README 为 `367 行 / 53,954 字节`（CR 字节=0、「」开闭 75 开 / 75 闭 差=0、反引号 938 为偶）；那两枚自指数按 b46/t44/b47/b48 那条口径跑在**已经把数换进件**的正文上，而本表那一行与 12 册收尾条互为对方的数 ⇒ README↔12 册联合迭代到同致（迭代 2 趟而末趟两件字节不再变）。
- **b50 落件（本轮只量不改产品）**：新增 [docs/ledger/13-odt-b50.md](docs/ledger/13-odt-b50.md) 一册一节（ODT 列表符面「专字」第四型接上之后的候选窄口径普查：两口专字／无闸消费点／id 三池／存—重开那一层，四腿全离线而不建 dev 树）。本表 行 那一栏沿用 01..12 那把尺（全文件 `wc -l` 减 3，即册头三行不计），故 13 那行写 16 而全文件 19；字节那一栏一直是全文件 `wc -c` 的逐字同值（13=29,996）。architecture 那一行同时改口为 260 行 / 192,031 字节（本轮 188,977→192,031 而 行 枚不变）——本轮在那一册**就地改口两条**而不新增条目：`lib/doc-style-css.ts` 那条把 b47 时代两句「今天出不了规则」「ODT 读手不填——93/93 件键不在场」标注成已翻面并补 `c3|A` 的 33/26/7 现量闸位榜与 `c4|4.3`/`c4|4.4` 的家不去重和按 id 单键连坐，`lib/odt.ts` 那条补「字符闸下游整口吞专字」那一族（`c1|1.5` 夹具一口 Symbol 无账 + `c2|2.6b` 真件 6 枚件 71 口层）与 b51 落点；roadmap 那一行同时改口为 未勾 451 枚 / 已勾 165 枚 / 1,692 行 / 351,439 字节（`grep -c` 与 `wc` 现量，装配前基线 444/165；本轮勾 0 枚、收窄 3 枚、新开 7 枚）。本条落件后 README 为 `369 行 / 55,965 字节`（CR 字节=0、「」开闭差=0、反引号为偶）；那两枚自指数与本册字节按 b46/t44/b47/b48/b49 那条口径跑在**已经把数换进件**的正文上，而本表那一行与 13 册收尾条互为对方的数 ⇒ README↔13 册两把尺联合迭代到两件字节不再变（迭代趟数只落在 `tmp/b50/z1_log.txt` 的 `z1|定点` 那一格而写在本件之外——件字节不能吃趟数的宽度，否则「两件字节不再变」那把判据被自己抖坏）。
- **b51 落件（本轮只量不改产品）**：新增 [docs/ledger/14-odt-b51.md](docs/ledger/14-odt-b51.md) 一册一节（ODT 列表符面「专字」私有区那一族在屏上到底有没有墨的前置实测：c1 真件普查 + c2 本机在册性 + s1 屏上注入代理臂 + s1b 补尺腿，起了 dev 树而只跑屏上，没扫纸面、没跑门面、没碰写侧）。本表 行 那一栏沿用 01..13 那把尺（全文件 `wc -l` 减 3，即册头三行不计），故 14 那行写 28 而全文件 31；字节那一栏一直是全文件 `wc -c` 的逐字同值（14=42,167）。roadmap 那一行同时改口为 未勾 454 枚 / 已勾 165 枚 / 1,695 行 / 357,259 字节（`grep -c` 与 `wc` 现量，装配前基线 451/165；本轮勾 0 枚、收窄 2 枚、就地改口 2 枚、新开 3 枚）；architecture 那一行改口为 260 行 / 192,486 字节（本轮在那一册**就地改口一条**而不新增条目，`行` 枚不变：`lib/odt.ts` 那条尾部把「判据须含屏上有没有墨那一趟前置」补成前置已跑、落点按裁定收窄成只松私有区那一半）。本轮另把 README 自身的底数不同致改口：`## 路线图` 那一句自 b50 落件起停在「未勾 444 枚」而地图那一行写 451（同册不同致一枚，装配腿 `a1|3.3` 点名），本轮按同一把尺统一到现量值。本条落件后 README 为 `372 行 / 58,178 字节`（CR 字节=0、「」开闭差=0、反引号为偶）；那两枚自指数与本册字节按 b46/t44/b47/b48/b49/b50 那条口径跑在**已经把数换进件**的正文上，而本表那一行与 14 册收尾条互为对方的数 ⇒ README↔14 册两把尺联合迭代到两件字节不再变（迭代趟数只落在 `tmp/b51/assemble_log.txt` 而写在本件之外——件字节不能吃趟数的宽度，否则「两件字节不再变」那把判据被自己抖坏）。
- **b51i 落件（本轮是实现轮：窄口径三处而只动一枚产品件）**：新增 [docs/ledger/15-odt-b51i.md](docs/ledger/15-odt-b51i.md) 一册一节（ODT 列表符面「专字」私有区那一族「字符被闸拒而整口字体账一起吞掉」的落点实现：`r1` 吞账对照腿 + `d1` 24 臂夹具 + `e5` 三枚变异 + `f1` 92 枚件 + `s1` 屏上走产品真管线 + `h1` 写侧往返 + `i1`／`i2` + `x1` 跨轮 + `g1` 合判）。本表「行」那一栏沿用 01..14 那把尺（全文件 `wc -l` 减 3，即册头三行不计），故 15 那行写 28 而全文件 31；字节那一栏一直是全文件 `wc -c` 的逐字同值（15=46,955）。architecture 那一行同时改口为 260 行 / 193,680 字节（本轮 192,486→193,680 而行枚不变）——本轮在那一册只就地改口 `lib/odt.ts` 那一条的尾部，把 b51 时代的「落点三处」换成「三处已落」加后果读数，而不新增条目；roadmap 那一行同时改口为 未勾 453 枚 / 已勾 169 枚 / 1,698 行 / 367,427 字节（`grep -c` 与 `wc` 现量，装配前基线 454/165；本轮勾 4 枚、收窄 6 枚、新开 3 枚）。本条落件后 README 为 `374 行 / 60,032 字节`（CR 字节=0、「」开闭差=0、反引号为偶）；那两枚自指数与本册字节按 b46/t44/b47/b48/b49/b50 那条口径跑在**已经把数换进件**的正文上，而本表那一行与 15 册收尾条互为对方的数 ⇒ README↔15 册两把尺联合迭代到两件字节不再变（迭代趟数只落在 `tmp/b51i/assemble_log.txt` 而写在本件之外——件字节不能吃趟数的宽度）。
- **b52 落件（本轮只量不改产品）**：新增 [docs/ledger/16-odt-b52.md](docs/ledger/16-odt-b52.md) 一册一节（ODT 列表符面「专字」那一族的纸面通道前置实测：`c1` 件面两副读手 92 枚语料 + `s1` 屏上走产品真管线五臂 + `s2` 纸面件面十枚件 + `s3` 纸面墨尺同矩形 + `g1` 合判；起了 dev 树而只跑屏上与自家出纸，没跑门面、没扫 docx、没碰写侧）。本表「行」那一栏沿用 01..15 那把尺（全文件 `wc -l` 减 3，即册头三行不计），故 16 那行写 15 而全文件 18；字节那一栏一直是全文件 `wc -c` 的逐字同值（16=23,704）。architecture 那一行改口为 260 行 / 194,791 字节（本轮 193,680→194,791 而行枚不变）——本轮在那一册只就地改口 `lib/odt.ts` 那一条的尾部，把 b47 时代那句「纸上不落这口名字」换成「字体名榜增量才是凭据而 Type3 段枚不通用」而不新增条目；roadmap 那一行同时改口为 未勾 462 枚 / 已勾 169 枚 / 1,707 行 / 375,027 字节（`grep -c` 与 `wc` 现量，装配前基线 453/169；本轮勾 0 枚、收窄 3 枚、新开 9 枚）。下文「路线图」那一节的底数一并改到同一把现量尺而不沿用上一轮的数。本条落件后 README 为 376 行 / 61,889 字节（CR 字节=0、「」开闭差=0、反引号为偶）；那两枚自指数与本册字节按 b46/t44/b47/b48/b49/b50/b51/b51i 那条口径跑在**已经把数换进件**的正文上，而本表那一行与 16 册收尾条互为对方的数 ⇒ README↔16 册两把尺联合迭代到两件字节不再变（迭代趟数只落在 `tmp/b52/assemble_log.txt` 而写在本件之外——件字节不能吃趟数的宽度）。


## 已实现（v0.2）

- **应用外壳**：类 WPS 首页、多标签工作区（标签右键菜单）、最近文件（持久化）、新建/打开/另存为、
  快捷键（Ctrl+O/S/Shift+S/W/N/Tab 切换）、拖拽文件到窗口打开、关闭前未保存确认、暗色/亮色主题、
  Workspace 懒加载（主包 8MB → 250KB）
- **表格（Calc）**：Univer 表格内核（中文界面、公式计算、工具栏），xlsx / xls / ods 读取与 xlsx / ods 写出，
  并支持导出 PDF（A4 横向，数据侧重排自绘网格）；
  第二轮新增社区高级预设五件套——**筛选排序、排序、条件格式、数据验证、查找替换**
  （注：Univer `preset-sheets-advanced` 属商业版，本项目只用 Apache-2.0 社区预设）
- **文档（Writer）**：TipTap 富文本（标题/加粗/斜体/下划线/删除线/对齐/列表/引用/代码块/表格/图片/链接），
  第二轮新增**字色、多色高亮、实时字数统计、打印/导出 PDF（系统打印对话框）**，
  颜色与高亮映射进 docx（`w:color` / `w:shd`）；docx 导入（mammoth）、docx 导出（docx）、
  ODT 双向（JSZip 直写/直读 ODF）、自有 `.odoc`（JSON）存档
- **演示（Impress-lite）**：自研轻量幻灯片编辑器——标题/要点/图片/空白四种版式、6 套主题色、
  页序调整、缩略图侧栏、全屏放映（←/→/空格翻页、N 切换备注、Esc 退出）；
  **pptx 导出**（pptxgenjs）与 **pptx 导入解析**（jszip + DOMParser，含图片提取还原），
  自有 `.opd`（JSON）存档格式；v0.15 起支持导出 PDF（每页一张全出血）

## 母版与备注（v0.4）

- **pptx 母版还原**：导入时解析 `slideMaster` + `theme1.xml`——背景（纯色/背景图）、主题配色
  （`clrScheme` 经 `clrMap` 映射，标题取 accent1、正文取 dk1）、标题/正文占位符几何（EMU → 相对定位），
  编辑画布、缩略图、放映与 pptx 导出全链路使用还原结果；单页背景覆盖（`slide.bg`）优先于母版
- **演讲者备注**：编辑区常驻备注面板，随 `.opd` 存档；pptx 导出经 pptxgenjs `addNotes` 写入
  notesSlide，导入时回收（自动剔除 sldNum/日期/页脚等占位噪声）；放映中按 **N** 浮现当页备注
- **往返保证**：自有导出 → 再导入的母版底色、备注、单页背景、要点内容均无损（Node 端 21 项结构断言 + 桌面 CDP 冒烟覆盖）

## 动画与演讲者视图（v0.5）

- **切页动画**：每页可选淡入/推入/擦除/劈开四种切换效果，放映时以 CSS 动画播放；导出经 JSZip
  后处理向 OOXML 注入 `<p:transition>`（pptxgenjs 原生不支持），导入时反向解析识别；
  与母版/备注同享 `.opd` ⇄ pptx 无损往返
- **演讲者视图**：放映中按 **P**（或点按钮）打开独立 Tauri 第二窗口——当前页大图、下一页预览、
  备注全文与计时器；跨窗口经 Tauri 事件总线实时同步，任一侧结束放映双向联动关闭

## 逐条动画与自动换页（v0.6）

- **要点逐条入场**：每页可选淡入/飞入/擦除三种逐条效果，放映与演讲者视图同步揭示——
  方向键/空格先揭示下一条，揭示完毕再换页（v0.7 起随 pptx 原生 timing 树往返，见下）
- **自动换页计时**：每页可设 1~3600 秒到点自动换页，导出写入 OOXML `<p:transition advTm>`、
  导入反向解析，与切换动画同族往返；末页计时器不触发

## PowerPoint 原生 timing 树（v0.7）

- **逐条入场导出**：含逐条动画的页向 slideN.xml 注入 PowerPoint 原生 `<p:timing>`——
  mainSeq 内每段一个 `clickEffect`（`set` 可见性 + 入场行为），`bldLst/bldP build="p"` 驱动逐段构建；
  淡入→`animEffect filter="fade"`、擦除→`wipe(down)`、飞入→`ppt_y` 位移动作，与 `<p:transition advTm>` 共存且顺序符合 schema
- **逐条入场导入**：解析任意来源 pptx 的 timing 树，按 `bldP`+`animEffect` 滤镜/`ppt_*` 动作识别
  fade/wipe/fly 并还原为本地逐条放映；无 `bldP` 的整形效果不误判为逐条
- **形状定位**：pptxgenjs 不给形状可预测 id，导出后处理按正文首行文本反查所在 `<p:sp>` 的 `cNvPr id` 作为 `spid`

## xlsx 样式与合并往返（v0.8）

- **样式通道**：单元格载荷新增 `s`（加粗/斜体/字号/字色/底色）与 `merges` 合并区，
  xlsx ⇄ Univer 全链路映射——导入时样式去重注册进快照 `styles`（`oo{n}` id 引用），
  保存时反向解析回写 `rust_xlsxwriter` `Format`
- **样式读取**：calamine 不公开样式 API，故用 `zip` + `quick-xml` 直接解 xlsx 的
  `styles.xml` / `sheet.xml`（字体、填充、cellXfs、mergeCells），与 calamine 的值读取按坐标缝合；
  两 crate 均已在依赖树中，产物体积零增量
- **合并单元格**：导入映射为 Univer `mergeData`（单格"合并"自动过滤）；导出时合并区先行
  `merge_range` 写入左上值与格式，被覆盖格子跳过不重复写
- **边界行为**：空值但带底色的格子从样式表补回保留；往返丢失的仅样式细节以外的少数格式维度
  （边框/对齐/数字格式暂未纳入）

## 动画方向/出场 + PowerPoint 实机回归（v0.9）

- **入场方向**：飞入/擦除支持上下左右四向——UI 每页可选「从上方/右侧/下方/左侧」，`.opd` 存
  `animDir`；pptx 导出映射为原生 `presetSubtype` 方向位（上1/右2/下4/左8），飞入按方向选
  `ppt_x`/`ppt_y` 轴与 `#+y+1` 类屏外起点，擦除滤镜取扫过反方向（从下方→`wipe(up)`）
- **逐条出场**：每页可选「出场 · 淡出」；放映揭示满后每击退一条（FIFO，步数 = 2×段数），
  CSS `fill-mode: forwards` 保持退场隐藏；pptx 导出追加 `presetClass="exit"` 的
  `animEffect transition="out" filter="fade"` clickEffect，与入场共用同一 `bldP`
- **导入识别**：timing 树解析优先 `presetSubtype` 位、其次 wipe 滤镜反查、再次飞入 `strVal`
  符号轴判向；`exit` clickEffect 识别为出场动画
- **实机回归**：导出的 pptx 由本机 PowerPoint 16.0（COM 无界面）打开不修复并另存，重存文件
  保留全部 6 个 clickEffect、`presetSubtype="8"`、`build="p"`、`advTm`——方向与出场被
  PowerPoint 原生接受；该重存文件再经我们的导入器仍识别 fly/left/fade，双向往返闭环

## 文档页眉页脚与目录（v0.10）

- **页眉页脚设置**：工具栏「页眉页脚」面板——页眉/页脚文本 + 页码开关，随 `.odoc` 的 `meta`
  存储；编辑界面在纸面上/下缘实时渲染预览条（页码显示占位 `[页码]`）
- **docx 导出**：页眉写入 section `headerReference`（右带细线），页脚含页码时生成原生
  `PAGE` 域（"第 X 页"）；`features.updateFields` 让 Word 打开即刷新域
- **目录节点**：TipTap 原子节点（NodeView 不存正文），按标题 1-4 实时汇总、点击滚动跳转；
  导出映射为 Word 原生 TOC 域（`\o "1-4" \u` + 标题段落大纲级别），本机 Word 16.0 实机确认
  更新域后生成"第一章 起源 · 第 1 页"式条目；另配 `settings.xml` updateFields
- **docx 导入**：mammoth 不读页眉页脚，用 JSZip 直读 `sectPr` 的 `headerReference`/
  `footerReference`（取 `w:type="default"` 项）抽文本并识别 PAGE 域；Word 重存的规范化
  docx 亦被容错解析，双向闭环
- **许可注记**：表格图表经调研确认 Univer 图表插件属 `@univerjs-pro` 商业授权，社区版
  不可用，故图表继续单列并评估 VChart（Apache-2.0）自绘路线

## 文档批注（v0.11）

- **批注模型**：`meta.comments`（id/作者/日期/内容/已解决）+ 正文 `comment` mark 按 `cid`
  锚定选区；随 `.odoc` 持久化，侧栏实时汇总
- **批注侧栏**：选中文字「新建批注」→ 输入内容确定；卡片支持定位滚动、解决/重新打开、删除
  （同步移除正文锚点）；原文被删的孤儿批注标注"原文已删除"；正文锚点黄色高亮
- **docx 导出**：写原生 `word/comments.xml` 批注部件 + 正文 `w:commentRangeStart/End`（
  `commentReference` 须包在 `w:r` 内）；`resolved` 经 `commentsExtended.xml` 落盘（docx 库要求
  存在 `parentId` 才生成该部件，以 `-1` 触发且不产出伪造父链接）；每个批注全局只写一组 range
  ——同 id 多组 range 会被 Word 判定文档损坏；孤儿批注不写入 docx
- **docx 导入**：JSZip 直读 `comments.xml`（内容/作者/日期）与 `document.xml` 的单段落
  range 锚文本，在 mammoth HTML 中把锚点包成 `span[data-oo-comment]` 还原为 mark；
  跨段/被格式打断的锚点降级为侧栏未定位条目；`w14:paraId` 属性式与 `w15` 式都容错
- **实机回归**：本机 Word 16.0（COM）打开导出文件不修复，`Comments.Count=3`，作者、
  批注正文、`Scope.Text` 锚文本（含 `&` 实体）全部正确；规范重存回测因当日 Word COM
  SaveAs 环境故障顺延（见开发备注）

## PDF 查看与导出（v0.12）

- **PDF 查看**：新增 `pdf` 标签种类，pdfjs-dist（Apache-2.0）渲染——上下页、缩放 50%~300%、
  worker 分离加载；cmaps/standard_fonts 由 `scripts/copy-pdfjs-assets.mjs` 在 dev/build 前复制到
  `public/pdfjs`（gitignore）；pdf 只读、不可新建，打开/拖拽/最近文件全支持
- **文档导出 PDF**：Rust `export_pdf` 命令走 WebView2 原生 `PrintToPdf`（`with_webview`（稳定
  API，非 unstable）取 `ICoreWebView2_7`，`ICoreWebView2Environment6.CreatePrintSettings` 设
  背景色/页边距），无对话框、按 `@media print` 样式矢量出图；实机验证 4 页分页、54 个编号
  段落齐全、高亮底色保留（`print-color-adjust: exact`）
- **顺带修复真实数据丢失 bug**：TipTap 3 `getJSON` 的文本节点是**顶层 `text`** 而非
  `attrs.text`，docx 导出此前只读后者——应用真实保存的文档导出 docx 正文全空；历史结构测试
  用同错格式造夹具故未暴露。现两者兼容、夹具改用应用真实产物格式重建，本机 Word 16.0 只读
  回归通过（Pages=3、批注锚文本与正文正确）
- **范围**：表格/演示导出 PDF 暂未纳入；文字选择复制已由 v0.23 TextLayer 补齐，全文搜索见 v0.24

## 表格图表（v0.13）

- **渲染路线**：Univer 图表插件属 `@univerjs-pro` 商业授权不可用，改用 **VChart**（MIT）
  自绘——图表数据渲染成 PNG 后经社区绘图预设（`UniverSheetsDrawingPreset`，Apache-2.0）以
  **浮动图片**（`FOverGridImage`）落在网格上；VChart 走动态导入独立分包（约 548KB gzip），
  仅首次插入/还原图表时加载
- **插入与刷新**：选中 ≥2行×2列 数据区（首行系列名、首列类别）→「插入图表」对话框，
  柱形/条形/折线/面积/饼/环形 × 标准/堆叠/百分比堆叠分组；改数据后「刷新图表」按引用
  重读现值重出 PNG；图表随拖拽/缩放保留锚点
- **xlsx 原生往返（写）**：`write_xlsx` 用 `rust_xlsxwriter` 生成真图表部件
  （chartN.xml + drawing 锚点），保存的文件 Excel 可直接编辑图表；数据引用按 A1 区间写
  `numRef/strRef`，不带缓存值，Excel 打开即按实时网格计算
- **xlsx 原生往返（读）**：`xlsx_chart.rs` 以 zip + quick-xml 解析任意来源 xlsx 的
  `barChart/lineChart/pieChart/doughnutChart/areaChart`——系列名/类别/数值引用、标题
  （含 `&` 实体还原）、`oneCellAnchor/twoCellAnchor` 锚点与 EMU 尺寸，数值再从实时网格取值解析
  （不信缓存），重开文件图表按位置尺寸还原
- **实机回归**：本机 Excel 16.0（COM 只读）打开应用保存的三图表文件——`ChartObjects=3`，
  柱形 51×2 + 饼 5、系列数与标题正确；cargo 12 项测试含列形+饼双图表写读往返断言

## ODF 原生格式（v0.14）

- **ODS 写出**：新增 `ods.rs`——`write_ods` 命令把与 xlsx 共用的工作簿载荷直接生成 ODF 包
  （mimetype 首条不压缩 + manifest + content.xml/styles.xml），单元格值（文本/数值/布尔）、
  粗体斜体字号字色底色（自动样式去重 `ce1..`）、合并区（spanned + covered-table-cell）、
  稀疏行列全部按 ODF 规范落盘
- **按扩展名分流保存**：修复此前 `.ods` 路径会被写入 xlsx 字节的 bug——表格保存按目标扩展名
  在 `write_xlsx` / `write_ods` 间路由，另存为对话框同时提供两种过滤器；ODS 不含图表时状态栏提示
- **ODT 双向**：前端 `lib/odt.ts`（JSZip + DOMParser，零新依赖）实现 ProseMirror JSON ↔ ODT——
  导出覆盖标题(H1-H4)/粗斜下删/字色高亮等字符样式（`C1..` 去重）/对齐/有序无序列表/代码块/引用/
  表格合并/图片内嵌（`Pictures/`）/超链接/页眉页脚含 PAGE 页码域；导入按样式表反解析回 HTML 挂进编辑器
- **范围限制**：ODS 读侧仍走 calamine 值通道（ODF 样式/合并暂不解析回 Univer，ODT 不含目录域）；
  ODT 导出以应用自身能力子集为准，未覆盖脚注/锚定框架等
  （**v0.40 修订**：脚注/尾注这一档已经补上——ODF 1.2 内联写法导出、旧版 `text:note` 外壳也读得进，见 v0.40 一节）
  （**v0.86 修订**：批注这一档也已补上——`office:annotation` 读写往返 + 打开自动开侧栏，见 v0.86 一节；
  resolved 状态与目录域仍不往返）
  （**v0.89 记账**：ODT 的**列宽两头都不往返**——写侧零枚 `table:table-column`、读侧不解析 `style:column`/`table:style`
  那一层的宽度；本轮明写不开：本机无 ODF 第三方应用、ODF 1.2 RelaxNG 三个源全 404 ⇒ 写出的形状无人可裁，
  见 v0.89 一节）
  （**b28 修订**：这一档的**读侧**那一半已经接住——列宽住在列样式里（`style:table-column-properties` 的
  `style:column-width`），读手现在按列槽把它摊到首行格子的 `colwidth` 上，判据是三头合裁；**只剩写侧那一半**：
  自家写手仍不发 `<table:table-column>`，见「ODT 表格列宽第一笔账」一节）
  （**b29 修订**：ODT 读侧的**文本节**那一层也接住了——`text:section` 按规格是块容器而不是排版单位，读手现在把它的
  孩子平铺进同一股文档流（不产包装、不产排版节、隐藏/条件那一档本轮不求值），77 枚真件里 7 件 14 节的 2,429 字
  第一次上屏而其余 70 枚一字不变；写侧仍无节通道（写手零枚 `text:section`），见「OpenOffices ODT 文本节第一笔账」一节）
  （**b30 修订**：ODT 读侧的**分页档**也分家了——`fo:break-before="page"` 那一枝从前一命中就 `return` 掉整枚段而把该块自己的字丢了，
  现在「换页标记」与「这块的字」各算各的账：空分页段只出标记（自家写手发的正是空段，多出 `<p></p>` 会让往返凭空多一枚空段），带字的
  分页段两头都出，`case 'h'` 第一次沿同一条样式链吃这一层而值闸只吃字面 `page`；77 枚真件里 10 件的 356 字第一次落屏、其余 67 枚一字
  不变且无凭空的空段。表级那一枝与 `column`/`auto` 两档仍不吃（语料枚枚 `auto`、无账可还），见「OpenOffices ODT 分页档吞字第一笔账」一节）
  （**b31 修订**：ODT 读侧的**老式内联锚**那一档有了出口——`text:note`（ODF 1.0/1.1 与不少转换器的写法：锚自己住在正文流里、
  正文套在自己的 `text:note-body` 里、不发独立引用枚）从前与 ODF 1.2 的两枚外壳共用一枚 `break` 而正文永远没人取，
  现在它按 `text:note-class` 分脚注/尾注并出同一形状的注出口；77 枚真件里 5 件的 9 枚注第一次落屏（`c2`/`c3` 口径 1,946 字）
  而其余 72 枚逐字节不变，判据是三头合裁（`g1` 合=10 取舍=2 不合=0），见「OpenOffices ODT 老式内联锚注正文第一笔账」一节；
  写侧仍只发 ODF 1.2 那一形（`text:note` 枚=0），注正文里非直接子段那一层（`text:list` 等）b31 明写不吃而 **b32 已接上块容器递归**——`text:list` 那一枝按文档顺序一枚块一行（1 件 13 字、行 26→27），index 壳与注内的表仍明不吃（**b37 已改口径**：index 壳这一层两头都吃了——`text:index-body` 的孩子按文档序平铺进文档流、注正文同吃，而 `*-source` 与两族模板是生成规格不吃，77 枚真件里 2 件的 3 枚壳纸面 19 块 639 字第一次有账，见「OpenOffices ODT 索引壳第一笔账」一节；注内的表仍明不吃），见「OpenOffices ODT 注正文块层第一笔账」一节）
- **验证**：calamine（真实读侧实现）读回自写 ODS 值/布尔/稀疏/转义断言；zip 布局断言（mimetype 首条
  Stored）；CDP 冒烟全程走应用真实链路——打开夹具 ODS → Univer 改值 → 保存分流 → 解包断言 → 重开显新值；
  ODT 导出/导入/编辑器加载/原地写回（含图片）全链路；本机无 LibreOffice 且 WPS COM（KWPS）与 Word 一样
  存在自动化挂起故障，ODF 实机回归以结构断言替代

## PDF：表格与演示导出（v0.15）

- **共享打印覆盖层**：新增 `lib/pdfprint.ts`——把任意 DOM 挂成 `#oof-print-host` 打印覆盖层，
  临时注入打印样式后调 `export_pdf` 落盘再清理；关键一处是打印时必须放开外壳的
  `html,body{height:100%;overflow:hidden}`，否则整个应用被裁成一屏、多页内容全丢
- **export_pdf 支持纸张与边距**：Rust 侧新增 `margins`（英寸，`None` 用默认 0.5/0.6）与
  `page`（纸张宽高）参数，走 `ICoreWebView2PrintSettings`；实测 `@page size` 在 PrintToPdf
  下不生效，且 PageWidth/PageHeight 语义是「纵向纸」边长、`Orientation` 再整体转置，
  故横向须先交换宽高
- **演示导出**：`PptEditor` 用 `createRoot` 把每张幻灯片挂进离屏容器，`StaticSlide` 复用
  放映版式，每页 1280×720px 对应 338.7×190.5mm 零边距纸，出片即 960×540pt 全出血，
  与放映视图同字号比例（em 基准 17px）；图片幻灯片等解码完成后再打印
- **表格导出**：Univer 是 canvas 渲染，PrintToPdf 抓不到，改走保存同源的工作簿载荷——
  `lib/sheet-print.ts` 纯函数把 `WorkbookPayload` 自绘成 HTML 网格（值、粗体/斜体/字号
  pt→px/字色/底色、合并 `rowspan/colspan` 覆盖矩阵、`colgroup` 列宽、每表分页），A4 横向输出；
  超过 2000 行 × 120 列截断并在页尾提示
- **范围限制**：表格 PDF 不含图表（浮动图片不在载荷里）与边框/数字格式/对齐等样式子集之外
  的属性；演示 PDF 不经 pptx 中转，直接以网页排印复刻放映比例
- **验证**：cargo 15 项测试；tsc 与 `pnpm build` 全绿；CDP 冒烟用 pdf.js 读回导出文件断言——
  样张三页 960×540 全出血、演示三页标题与要点齐全、图片幻灯片 image 算子仅落在图页、
  表格夹具值/样式/合并 HTML 断言 + 导出 841.9×595（A4 横向）+ 填满后 3 页分页、
  文档导出（不传新参数）None 分支回归通过

## 文件关联与端到端加密同步（v0.16）

- **文件关联**：`bundle.fileAssociations` 声明四组扩展名（表格/文档/演示/PDF，PDF 为 Viewer
  只读语义），Windows 安装器写注册表后双击即把文件路径作为进程参数传给应用
- **单实例转发**：接入 `tauri-plugin-single-instance`——二次启动不再开新进程，把 argv 中
  过滤出的文件路径 emit `oof://open-paths` 给已开窗口并还原聚焦主窗；首启路径则进启动状态，
  前端挂载时经 `take_startup_files` 一次取走（与拖拽打开、最近文件共用同一 `openPath` 链路）
- **argv 过滤纯函数**：只认 `OPEN_EXTS`（与前端 `kindOfPath` 保持一致）匹配的扩展名、去引号、
  大小写不敏感，拒绝无扩展名与 `--flag` 类参数；Rust 3 项单测覆盖
- **端到端加密同步**：新增 `lib/sync.ts`，纯 WebCrypto 零新依赖——口令经 PBKDF2-SHA256
  （15 万次迭代 + 16B 随机盐）派生 AES-256-GCM 密钥，把「最近打开」密封成 `.oosync`
  JSON 文本信封（salt/iv/data 均 base64），丢进任何网盘即可完成跨设备搬运；解密校验
  app/kind/v 字段，口令错误或文件被篡改由 GCM tag 兜底报「解密失败」，条目按形状过滤；
  `mergeRecents` 按路径去重保新、时间倒序截 30 条落盘。口令不落盘、应用无密钥，真端到端
- **首页操作**：最近打开区新增口令输入框与「导出加密副本 / 从加密副本合并」按钮及状态行
- **验证**：cargo 18 项测试全绿（含 3 个新单测）；tsc 与 `pnpm build` 全绿；CDP 冒烟——
  信封形状、加解密往返、错误口令拒绝、非法条目过滤、非同步文件识别、mergeRecents 去重
  计数与持久化共 7 断言全 true；双实例真实冒烟——二次 `openoffices.exe <文件>` 启动后自行
  退出，主窗口标签与最近记录出现该文件，连开两文件两标签，期间 CDP page 目标与进程数恒 1

## 发行说明：v0.96.0 —— v0.95.0 之后的 26 枚提交打成一次发行（接管两血统合并 + ODT 读侧 b28~b46 + 接管量具 t40~t43），本轮按用户点名占版本号

- **家规的例外由用户点名**：笔账轮一律不占版本号——b28~b46 十九笔与 t40~t43 四批都在 `0.95.0` 那一串下过账（每一节的收尾都写着「本轮不占版本号」）。这一轮是发行轮而 bump 由明确指令触发（「发布一个 release 版本，并推送」+ 追问后选定 `0.96.0`），产品源文除 bump 自身外一字不碰。
- **发行号为什么不一次追平**：接管那份在制品里的 28 节标题自称 v0.98–v0.125（归属已按 `4c05eba` 改口为本线自己的在制品而不是并发会话），若一次追平就要跨 30 个号，而那批轮次各自的验证腿没在本机重跑（路线图「接管只合到两头不退化」那一枚仍挂着）⇒ 取 `0.96.0` = release 通道上已发布的 v0.95.0 的下一个号；两套编号并存的账不靠一次 tag 抹平（见下面「两套编号」那一条，收窄而不勾）。
- **版本文件四枚的读数**：`package.json:4`、`src-tauri/Cargo.toml:3`、`src-tauri/tauri.conf.json:4`、`src-tauri/Cargo.lock` 里 `name = "openoffices"` 那条目各命中 `0.95.0` 一枚；`Cargo.lock` 全文那一串只此一枚（改后残留=0 ⇒ 不存在第二处同值要跟着改，而这一格按家规把「集合枚数」与「残留数」并排打而不是只报改成功）；四件改后 CR 字节=0，`git diff --numstat` 四件各 `1 1`（净零）；复读 `package.json=0.96.0 | tauri.conf.json=0.96.0 | Cargo.toml=0.96.0 | Cargo.lock=0.96.0`。
- **这一版装了什么（范围现量而不凭回忆）**：`git rev-list --count v0.95.0..HEAD` = 26 枚而 `git diff --shortstat v0.95.0..HEAD` = 32 files changed / 12,126 insertions / 490 deletions；分四组——① 接管两枚（`732d448` 代码合并、`72f8e95` README 合并基座按行集比对找）、② ODT 读侧十九笔 b28~b46（表格列宽、文本节、分页档吞字、老式内联锚注正文、注正文块层、块级框、图内题注、页眉页脚档层、表外壳、索引壳、列表头尾包装层、首页另版、列表按层取档、编号形状出口、起号两家与型别写侧、段落基准字号、符面字符、专字三层可达性（只量不改产品）、符面专字）、③ 接管量具四批 t40~t43（docx 屏上/纸面两腿、表宽族那两枚闸回补、合并件闸门全树回核、ODT 列表与字号两腿）、④ 归属改口一枚（`4c05eba`，「另一会话持有 dev 树」是误记）。
- **代码分布按目录小计**：`src/lib` 16 件 3,602 增 / 302 删、`src/components` 6 件 1,743 / 66、`src/index.css` 418 / 1、`src-tauri` 7 件 4,433 / 60、`README.md` 1,929 / 61；`git diff --diff-filter=A` 的新增件共 7 枚 = `src/lib/bullet-char.ts`（b44 立的符面模型槽）+ `doc-style-css.ts` + `pdf-forms.ts` + `revision-extension.ts` + `table-cond.ts` + `src-tauri/src/xlsx_names.rs` + `xlsx_preserve.rs`（那枚 3,128 行的表格保留式写回）。
- **新增直接依赖一枚**：`package.json` 在 `v0.95.0..HEAD` 里唯一的 1 插入是 `"xml-js": "1.6.11"`——把它从 `docx` 的传递依赖提为直接依赖，为绕开 docx 库 `ImportedXmlComponent.fromXmlString` 把顶层 JSON 对象当根那一处缺陷（见 README 里 v0.114 那一节）；许可按本机现量 `node_modules/xml-js/package.json` 的 `license` 字段 = MIT，合家规的 MIT/Apache 红线。
- **发布前三腿在 bump 后的最终源文上复跑**：`pnpm exec tsc --noEmit` 退出码=0 而输出字节=0（无诊断行）；`cargo test --lib`（在 `src-tauri`，bump 触发重编）打印 `test result: ok. 127 passed; 0 failed; 11 ignored; 0 measured; 0 filtered out; finished in 0.19s`；`pnpm build` 打印 `✓ built in 2.77s`，最大 chunk `SheetEditor-DXnkHwgO.js` 6,556.79 kB（gzip 1,806.26 kB）而 `Some chunks are larger than 500 kB` 那一族警告照旧挂着——不是本轮引入（v0.26 起的分包形状）。
- **CI 与资产这一版实际出了什么**：tag push `v*` 命中 `.github/workflows/release.yml` 的 `linux` job（`ubuntu-22.04`，`timeout-minutes: 30`）并由 `tauri-apps/tauri-action@v0` 建 Release 上传 Linux 包；`windows` job 的条件是 `github.event_name == 'workflow_dispatch' && inputs.build_windows` 而 `build_windows` 默认 false ⇒ 这一枚 tag 只出 Linux，Windows 那两件是本机补的（见下面两枚条）；tag 路径不跑 `cargo test --lib`（那道闸是 `if: inputs.run_tests`，只在手动触发时开）⇒ Rust 测试那一行读数只能住在本机腿。workflow 顶部那条计费注释写的仍是「私有仓库每月 2000 Actions 分钟、Windows runner 按 2× 计」的口径，注释没跟着仓库转公开改过，所以只当注释读。
- **第一趟 CI 红在第 9 步而不是第 12 步**：run `38845558102`（head `074b3e3`，03:26:51Z 触发）`linux` job 读 `completed/failure` 而步序逐枚点名 `9 Install frontend deps failure` + `10 Type check skipped` + `11 Rust tests skipped` + `12 Build bundles and publish release skipped`，`windows` 整 job skipped ⇒ Release 压根没建出来（这一格的意义是：红在装依赖那一层，与产品源文和打包链一寸关系也没有）。匿名 API 读不到 CI 原话日志（`GET /actions/runs/38845558102/logs` 回 `403 Must have admin rights to Repository`）⇒ 归因走「本机原样复现那一步的命令」：`pnpm install --frozen-lockfile` 读 `ERR_PNPM_OUTDATED_LOCKFILE Cannot install with "frozen-lockfile" because pnpm-lock.yaml is not up to date with <ROOT>/package.json` 再 `1 dependencies were added: xml-js@1.6.11`。
- **锁件那三行、和我写错的那一枚数**：修复只动 `pnpm-lock.yaml` 一枚（`pnpm install --lockfile-only`，单 hunk `@@ -100,0 +101,3 @@` 给根 importer 补 `xml-js` 的 `specifier`/`version`，3 插入 / 0 删除、5,793 → 5,796 行、249,938 → 250,002 字节即 `+64`）而复验用同一把闸 `pnpm install --frozen-lockfile --offline` 读 `Done in 847ms` 退出码=0（根因与「本地能装 ≠ 锁件与 package.json 同致」那条口径记在「发布工程」那节的 CI 第二例）；修复提交首版 `b107b94` 的消息里我把 `+64` 写成 `+90`（凭印象而没有复算），按家规不静默 amend 而先问 ⇒ 用户点名「改掉」，`git reset --soft HEAD~1` 重写为 `56b3bfd` 并当场证明树没动（`b107b94^{tree}` == `56b3bfd^{tree}` == `c9b1abb31baa262d2249f2a9e61418605fa2974a`）。
- **tag 挪过一次而两把尺同读**：第一版 `v0.96.0` 指在 `074b3e3`（那棵树在 CI 里编不过）⇒ 用户点名「把 tag 挪到修复件」，走 `git push origin :refs/tags/v0.96.0` 删远端再重推，附注件消息补记第一趟失败与挪位；收尾 `git for-each-ref` 与 `git ls-remote --tags` 两头同读 `v0.96.0` 的附注件 `7e69bae` 剥皮 → `56b3bfd`，本地 `HEAD` 同指 `56b3bfd` ⇒「tag 只能按版本文件自己说了什么打」之外还要加一句「而且得指在编得过的树上」。
- **第二趟 CI 与 Linux 三件**：run `38846077309`（head `56b3bfd`，03:33:05Z 触发）`completed/success` 而步序逐枚 `9 Install frontend deps success` + `10 Type check success` + `11 Rust tests skipped`（tag 路径没开 `run_tests`）+ `12 Build bundles and publish release success`；Release `id=414513564` `OpenOffices v0.96.0` `draft=false` `published_at=2026-10-16T03:42:45Z`，Linux 三件 `deb 12,205,460` / `rpm 12,206,322` / `AppImage 90,257,912` 字节（03:42:46–51Z 上传，uploader `github-actions[bot]`）；`body字节=0` ⇒ GitHub 那一页正文是空的，上面这些账没写进 Release 说明（开一枚未勾）。
- **v0.95.0 那一边资产枚=3 全 Linux（这一格是「这次别忘了」的出处）**：`releases/tags/v0.95.0` 现读 `id=410590943` `资产枚=3` = `deb 12,080,512` + `rpm 12,081,736` + `AppImage 90,143,224`，三枚 uploader 全 `github-actions[bot]` 而 Windows 那一族枚=0；本版按同一把尺 `资产枚=5`。这不是那一轮的构建失败而是那条 workflow 的形状（推 tag 只打 Linux、Windows 挪到手动勾选，见「发布工程」的 Actions 分钟止血那枚条）⇒ 漏的其实是「发版必带 Windows 两件」那道闸压根不存在，本轮把它开成未勾。
- **Windows 两件在本机怎么出的**：`pnpm tauri build`（release profile + WiX + NSIS）日志 456 行 / 非空 450 行，尾段逐行「Finished `release` profile [optimized] target(s) in 5m 05s」 →「Info Patching …openoffices.exe with bundle type information: msi」→「Running light to produce …OpenOffices_0.96.0_x64_en-US.msi」→ 同一次 Patching 换 nsis →「Running makensis to produce …OpenOffices_0.96.0_x64-setup.exe」→「Finished 2 bundles at:」而「EXIT=0 2026-10-16T11:45:43+08:00」；件面 `msi 11,677,696 字节 md5=81aec8025340`、`setup.exe 10,312,784 字节 md5=a0948fdb0784`、内层 `src-tauri/target/release/openoffices.exe 16,856,064 字节 md5=21386ca2737b`；`candle`/`light`/`makensis` 的工具住在 `%LOCALAPPDATA%/tauri/{WixTools314,NSIS}`（v0.17 那轮首次联网拉的）⇒ 这一腿断网也跑得动，它是「本机补 CI 不出 Windows」而不是「CI 的 `build_windows` 闸被动过」（那份 workflow 一寸没碰）。
- **上传那一腿堵在凭据上而堵的不是构建**：先是 `gh auth status` 读 `The token in keyring is invalid` 而我不能替用户鉴权 ⇒ 把不需要凭据的那半（本机出件）先跑完、两件备在盘上；用户在本机 `gh auth login -h github.com` 走浏览器授权（回显 `✓ Logged in as Kwin985` 与 `! You were already logged in to this account`），复核 `gh auth status` 得 `✓ Logged in to github.com account Kwin985 (keyring)` 而 scopes `gist, read:org, repo, workflow`；`gh release upload v0.96.0 <setup.exe> <msi> --clobber` 退出码=0 无 stdout，事后 `资产枚=5` 且两枚 Windows 件的远端 `size` 与本机字节同致（10,312,784 / 11,677,696）、`updated_at=03:46:05Z / 03:46:06Z`、uploader `Kwin985` 而 CI 那三枚 `github-actions[bot]` ⇒ 同一枚榜里就看得出哪几枚是谁传上去的。
- **release `created_at` 早于 run `created_at`（两轮同形而不判合）**：本版 release created `03:32:46Z` 而触发它的 run created `03:33:05Z`（早 19 秒），v0.95.0 同形（release `12:35:19Z` 对 run `12:35:30Z`，早 11 秒）⇒ 归因为这条发布通道的固有读数而不是本轮动作，凡引用发布时刻一律取 `published_at`。
- **范围两处读数与「端点差不等于逐枚和」那一格**：tag 落点 `git rev-list --count v0.95.0..v0.96.0` = 28 枚（节题与提交消息里的 26 枚指 bump 之前的内容轮）；`git diff --shortstat` 三读 `v0.95.0..bc6a873` = 32 件 / 12,126 插入 / 490 删除、`v0.95.0..HEAD` = 36 件 / 12,147 / 494、`bc6a873..HEAD` = 6 件 / 23 / 6，而两枚提交的 numstat 之和也是 23/6 ⇒ 端到端那一趟少 2/2。归因现量：`074b3e3` 删掉的两行是路线图那枚「发行号与账目编号两套并存」，`git grep -c` 同一串对 `v0.95.0` 报 rc=1（不在）而对 `bc6a873` 报枚=1（在）⇒ 那两行本身就是本范围的新增，端到端比对看不见「先加后删」那一对。
- **自动更新清单这一版仍欠（Windows 那半枚已补）**：`latest.json` 不由 CI 产出（`bundle.createUpdaterArtifacts` 未开且仓里没有签名 secret），要 `pnpm release:updater`（`scripts/updater-release.mjs`）在本机签名并上传，而签名口令与私钥只在这台机器上 ⇒ 动它之前要用户点头，本轮没动它。
- **两套编号那一枚按现状收窄而不勾**：README 里 `（v0.96）` @4778、`（v0.97）` @4876、`（v0.98）` @6778 一路到 v0.125 是接管那份在制品的轮次名，而这次发行的号也叫 v0.96 ⇒ 同一枚字面从今天起有两种意思（一次发行 / 一轮账）；那枚路线图项从「版本文件落后 30 个号」收窄成「发行号追到 0.96.0 而轮次名仍领先到 v0.125 且 v0.96 那一格撞名」，追平与改名两件事一件也没做，所以判「未勾」。
- **收尾**：README 新增本节 + 路线图那一枚就地收窄 + 就地改口三处（本节那两枚由未来时换成实测账、归属措辞按 `4c05eba` 把「并发那 28 节」改成「接管那份在制品的 28 节」、发布工程那节补 CI 干净安装闸的第二例） + 修一枚装配遗留（「负长度」那枚未勾项的续行被后来插进来的三条隔开三行，搬回它本应在的位置而不改判据）+ 路线图 **开 3**（发版预检没跑 `--frozen-lockfile`、「发版必带 Windows 两件」那道闸不存在、Release 正文 `body字节=0`）；本轮占版本号（四枚版本文件同改，这是笔账轮家规的唯一例外而凭用户点名）；`main` 与附注 tag `v0.96.0` 按用户点名推远端，CI 两趟（第一趟红在锁件、第二趟成功）出 Linux 三件，Windows 两件由本机 `pnpm tauri build` 补出并 `gh release upload` 传讫 ⇒ 本版资产枚=5；仍欠的只有 `latest.json` 那一腿（签名口令在用户手上）；未勾 421 → 424、已勾 160（基线 160）不变，成品 10,316 行 / 1,943,030 字节 / CR 字节=0 而「」开闭差与基线同值（−2，3,395 开 / 3,397 闭）而反引号 44,660 为偶。

## 发行说明：v0.128–v0.137 —— 十轮合记（ODS 图表读写 / 全量拼写词典 / PDF 原地改字 / 实时协同 / VBA 子集 / ODS 记账收尾 / 表格侧 VBA / Rust 后端加固 / 协同传输层加固 / 表格规则侧通道），按用户点名「欠着的全做」立项，工作树未提交、未占版本号

`docs/gap-closure.md` 第九节原列五件「还欠着的」，连同收尾轮一共六轮，全部做在本机工作树上。版本文件四枚一寸没碰（仍 0.96.0），只按家规在代码注释里记轮次名。v0.134 把 Excel 那侧的 VBA 对象模型接上、让表格编辑器也能跑 VBA 宏；v0.135 回头审计并加固 Rust 后端（协同中继的启停与锁、xlsx 读侧一处每格分配）；v0.136 接手 v0.135 记下的那笔欠账——协同连接没有心跳，服务端因此加不了读超时——并把协同会话在前端那一半的生命周期（监听器、中继归属、断线重连）一并收干净；v0.137 是这十轮里最末一轮，补的是一类更安静的欠账：表格规则（条件格式/数据验证/筛选）那条「取是纯函数、Node 里就能测」的侧通道一个测试都没有，补测试的过程中翻出两侧同一处判据 bug。

### 1. ODS 图表读写（v0.128，`src-tauri/src/ods_chart.rs` 981 行）

ODF 把图表放在嵌入对象（`Object N/content.xml`）里，此前「需要真机夹具才敢写」的那一条，这一轮带着 LibreOffice 存出来的带图表 ODS 做完了读写两头：读侧扫主 `content.xml` 的 `<draw:frame>` 与 `<table:shapes>` 两种挂法（只认 `<draw:object>`，`<draw:object-ole>` 是二进制 OLE 不认），`Object N` 缺部件时静默跳过；写侧把图表编成 `Object N/content.xml` 并在表里嵌框，**编目录与嵌框共用同一套编号**（`object_dir`），否则 `href` 指空。图型映射只认 ODF 有的那几族，surface/bubble/gantt 交回 None——读侧跳过并记账、写侧由 `ods_chart_write_accounts` 报「这一张图不在文件里」，不静默丢。单测 7 枚（地址分/合、两种挂法、`writes_back_readably`、编号共享、`object_round_trips_through_a_real_ods` 真件往返）。

### 2. 全量拼写词典（v0.132，`src/lib/spell.ts` 686 行）

拼写检查从「规则 + 错词表」扩到**英文全量词典**（`word-list`，27.4 万词），但分两档画两种线：确认档（typo/repeat/pair）误报为零默认开；疑似档（unknown，词典里没有）**有误报所以默认关**——人名、品牌、术语会被划上，因此单独开关、一键加进「我的词典」。中文仍不走词典（拿几千词的词表硬当词典＝满屏误报），中文做的是重复词组这条零误报规则；`segmentit` 只用于分词边的重复词判定，不用于错字。

### 3. PDF 真·原地改字（v0.129，`src/lib/pdf-text-edit.ts` 296 行）

v0.28 起的「加字」是 FreeText 注解叠在原文字上；这一轮做**改字**：按 pdf.js 的文字项几何找到原字的那一枚，用 `/DA` 同款字体与字号在原位重画替换文本，旧的那一枚从内容流里抹掉。诚实边界写在代码注释里：**不重排内容流**——替换文本比原文长时按原位左对齐画出、不推移后续文字，这与 Word 的流式改字是两回事，所以面板上叫「改字」不叫「编辑」。中文字体经 `@pdf-lib/fontkit` 嵌入，UTF-16BE + BOM 的 `PDFHexString` 装正文（直接塞 `PDFString` 会被当 WinAnsi，中文落成乱码）。端到端 `scripts/test-pdf-text-edit.mjs`（107 行）全部通过，含「嵌了中文字体的文件 pdfjs 照样打得开」。

### 4. 实时协同编辑（v0.130，`src/lib/collab.ts` 356 行 + `src-tauri/src/ws_relay.rs` 573 行）

Yjs CRDT（`yjs` + `y-prosemirror` + `y-protocols` + `lib0`，四枚新直接依赖）做冲突消解，传输层是**手写的 RFC 6455 中继**（零 Rust 新依赖）：房间级广播、presence 在线状态，`ws_relay_start/stop/running` 三枚命令挂 capabilities。DocEditor 工具栏一枚「协同」按钮即开关，房间号缺省取文档路径。诚实边界：中继**无鉴权、无持久化**——进程退出即丢断线期间的改动，要当生产用得加 token 与落库。y-prosemirror 的默认 cursor builder 只设内联 `border-color`，边框宽/样式留给 CSS，这里把上/右/下三边宽度清零只留左边一条线（不翘尾、不撑行高）——与上游 recipe 的偏离写在 `index.css` 注释里。`scripts/test-collab.mjs`（239 行）端到端全通过，含「不同房间互不干扰」。**这一轮还顺手修掉一枚暗 bug**：`new Function` 的参数表里带 `'eval'` 在 strict mode 下是 SyntaxError，`runMacro` 与新的 `runVba` 两头都中——即此前所有宏本来就跑不起来。

### 5. VBA 子集（v0.131，`src/lib/vba-{lex,parse,emit,rt}.ts` 合计 2,962 行 + `vba.ts` 107 行）

手写四层：词法（`:` 分隔 / `_` 续行 / `Rem` / `&H` 字面量）→ 递归下降解析 → 转译成 JS → 对象模型与运行时（`Application`/`Documents`/`ActiveDocument`/`Selection`/`Range`/`Find`/`Collection`/`Dictionary`）。三条硬规矩：① 标识符统一 `$` 前缀绕开 JS 关键字、运算符全走 `__vba.*` 辅助函数（VBA 的 `&`/`=`/`And` 与 JS 不同）；② **按名传参转成尾随 options 对象**（`Find.Execute Replace:=wdReplaceAll`）——丢名字就丢语义；③ **不支持的构造带行号报错，不猜**（`GoTo`/`Type`/`Property`/多维数组/日期字面量/`[A1]` 简写）。`On Error Resume Next` 展开成逐语句 try/catch，VBA 字符偏移（1 起尾排他）经 `TextMap` 换算成 ProseMirror 位置。`scripts/test-vba.mjs`（570 行）**114/114**，含 UI 一键样例真跑 `Find.Execute Replace:=wdReplaceAll` 把 `old old new old` 换成 `new new new new`。Excel 侧的 `Workbook`/`Worksheet`/`Cells` 没接，记在路线图。

### 6. ODS 记账收尾（v0.133，本轮）

审计这一批时查出两处**面向用户的错话/静默丢失**，都修了：

- **SheetEditor 的 ODS 丢失提示是过期的**：还写着「ODS 暂不含图表」「ODS 暂不含筛选、数据验证与条件格式」，而图表（ods_chart.rs）与条件格式（ods_cf.rs）v0.128 起真往返。改成只报真正丢失的筛选与数据验证；页面设置那句仍准确（ODF 的 page-layout 这一层没有）。
- **条件格式写侧静默丢规则**：`write_ods_cond_formats` 对色阶/数据条/图标集与非表达式判定（大于/前 10 项/重复值…）是裸 `continue`，不记账——报「已保存」而文件里少东西，正是 v0.63 立下的契约禁止的。修法是把「落不落得下」提成写手与记账共用的同一把尺（`cf_writable`），新立 `ods_cf_write_accounts` 按原因分三箱计数（图型族 / 判定族 / 残规则），挂进 `write_ods_sync` 与图表账同一条汇合路；单测 `write_accounts_split_by_reason` 钉「尺说写得出的那一条，账里一个字都不报」。
- 顺手两处：`macro.ts` 头注还写「VBA 不是这一版的目标」（v0.131 已做成，改成两层分流说明）；`spell.ts` 补版本号 v0.132；`ods_chart.rs` 一枚 `mut` 警告清零——**清它的时候押错一格**：改成尾表达式形式撞了 E0597（借 `zip` 的迭代器临时量留到块尾而 `zip` 先 drop），复跑 `cargo test --lib` 当场红出来，改回「收进局部再返回」并把这枚反复记在这里；收尾 `touch src/lib.rs` 重编，warning 枚=0。

### 7. 表格侧 VBA（v0.134，`src/lib/sheet-macro.ts` 384 行 + `src/lib/vba-rt.ts` 工作簿对象模型 + `src/components/SheetEditor.tsx` 宏面板）

v0.131 只做了 Word 那一侧的对象模型；这一轮把 Excel 那侧接上，让表格编辑器也能跑 VBA 宏。三层：

- **适配层 `sheet-macro.ts`**：把 Univer 的门面（`FWorksheet`/`FRange`，全线 0 基）收成一份与宿主无关的 `SheetMacroApi`（`sheetNames`/`activeSheet`/`readCell`/`readRange`/`writeRange`/`usedRange`/`sheetSize`/`selection`/`selectRange`/`backgroundColor`/`setBackgroundColor`/`undo`/`redo`/`path`），`sheetApiOf(univer)` 走 facade 接上。接口能在 vite-node 里用假实现测，所以对象模型与适配层分离，运行时不必碰 Univer 类型。
- **工作簿对象模型（vba-rt.ts，v0.134 加）**：`Workbooks`/`Workbook`/`Worksheets`/`Worksheet`/`SheetRange`/`SheetRows`/`SheetColumns`/`SheetCells`/`SheetSelection`，RGB 与颜色常量（`vbRed`/`RGB`），`Range`/`Cells` 全局寻址、A1 记法、`For Each` 迭代区域、二维数组整体赋值（`Range("A1:B2").Value` 取整片再写回）、`End(xlDown)` 一族、`Interior.Color`、`UsedRange`、`Application.Undo`。文档侧的那一份（`ActiveDocument`/`Selection`/`Find`…）**行为不变**——两个宿主走同一个内核、两套对象模型不互通。
- **SheetEditor 宏面板**：工具栏一枚「宏」按钮即开关，选宏/新建/保存/删除/运行/VBA 转译预览，改动标脏；表格侧**只有 VBA**（没有 JS 宏引擎），所以面板只认 `Sub … End Sub`，内置两条 VBA（A 列求平均并标红、给已用区域首行上底色）既是能用的工具也是活样例。

`scripts/test-vba-book.mjs`（端到端，61/61）用 `FakeBook` 假实现跑 A1 寻址读写、UsedRange、选区、Interior.Color、For Each、二维数组赋值、全局 Cells/Range 寻址、错误路径（越界/坏地址/未实现）。本轮一处**语义更正**：`IsNumeric(null)` 原随 `tonum(null)=0` 误判为真，导致空白格被当数字累加（`If IsNumeric(Cells(i,1).Value)` 把全空尾行全算成数）；改为空白格 `IsNumeric` 返 false（`tonum(null)` 仍 =0 供求和用，两回事）。

改为空白格 `IsNumeric` 返 false（`tonum(null)` 仍 =0 供求和用，两回事）。

### 8. Rust 后端加固（v0.135，`src-tauri/src/ws_relay.rs` + `src-tauri/src/xlsx.rs`）

按「找薄弱点」的思路审了一遍 Rust 侧：生产代码（不含 `mod tests`）里 panic 面一共 18 处，其中 12 处集中在协同中继，其余文件各 0~2 处。这一轮修的是审计里够得上「真问题」的那几处，不是把 `unwrap` 机械清零——**release 是 `panic = "abort"`**，一枚 panic 就是整个应用退出，所以网络那一侧的局部故障不该有这个爆炸半径。

- **`stop()` 不 join accept 线程** ⇒ 「关了又开」会短暂并存两个 accept 线程，老线程退出前接到的连接注册进**旧**房间表（新表看不见它）⇒ 那个连接成孤儿，同屋的人永远转发不到它。改法：`Relay` 存 `JoinHandle`，`start()` 起新线程前先把上一轮的信号发出并 join 掉。
- **`running()` 会说谎** ⇒ accept 线程也会**自己**退出（`accept` 返回非 `WouldBlock` 的错），那一路上 `shutdown` 还留着 `Some`，单看它就把「已经死了」报成「在跑」，界面一直显示协同已开启。改法：加一面 `Arc<AtomicBool>` 的「还活着」旗，线程退出前自己落旗，`running()` 两个条件都要。
- **锁一律走污染容忍的 `lock()` 辅助** ⇒ 本模块从不把房间表留在「改了一半」的状态，污染不代表数据坏了；而 `panic = "abort"` 下，一个连接线程 panic 会带着其余线程的 `.unwrap()` 一起炸。
- **`xlsx.rs` 读侧一处每格分配**：图表取数网格原先写成 `grids.entry(name.clone())` 且**在格循环里**，百万格又带图表的簿子就是百万次 `String` 分配 + 百万次哈希，而这一格里要的从来是同一张表。改法：循环外取一次 `&mut Grid`。

**考虑过但没做**（写下来免得下次重走）：按包围盒 `height*width` 给 `cells`/`seen` 预分配——稀疏表（A1 与 ZZ1000000 各一格）的包围盒能到百万级而实际只有两格，照它 reserve 会一次性吃掉几十 MB；省下的只是几次扩容的 memcpy，赌的是稀疏表上的内存，不划算。同理**没有**给连接加读超时：前端那会儿不发心跳，加超时会把空闲（但健康）的协同会话掐断——要加就得客户端 ping 与服务端超时一起加。这笔欠账 v0.136 还上了（见下节）。

### 9. 协同传输层加固（v0.136，`src-tauri/src/ws_relay.rs` + `src/lib/collab.ts`）

上一轮审计时留了一笔欠账：前端 `collab.ts` 完全不发心跳，服务端因此**不能**给连接加读超时——加了就会把空闲但健康的协同会话掐断。这一轮把两端一起补上，顺带把协同会话在前端那一半的生命周期审了一遍。

服务端（`ws_relay.rs`）：

- **`read_frame` 现在区分「读超时」与「真断了」**。早先一律返回 `None`，于是「这阵子没读到帧」和「对端关了」是同一个值，服务端没法只清死连接。现在返回 `io::Result<Option<..>>`：`Ok(None)` 是协议错（不用再探活），`Err(TimedOut/WouldBlock)` 是超时（还能再探一次），其余 `Err` 才是 EOF/连接重置。
- **读超时 + 探活 + 踢人**：30 秒没动静发一枚 RFC 6455 的 ping（浏览器与 Node 都会自动回 pong），连续三次没回声才关门。只踢「不答话的」：这是半开连接（对端进程没了、网断了）唯一能自己清干净的办法，否则同屋的人会一直往一个死连接写帧。
- **应用层 ping/pong（载荷首字节 2/3）只回声、不广播**。这是全模块唯一一处看载荷内容的地方，理由记在代码里：N 个客户端各发各的心跳，一旦进转发就变成 N² 帧——这是这套中继唯一能自我打垮的地方。
- **房间空了就把条目删掉**。房间名跟着文件路径走，开十个文件就是十条；删之前还要再看一眼房里是不是仍然空的，否则会把这一瞬间刚进房的那位变成孤儿。

前端（`collab.ts`）：

- **监听器不再累积**：`start()` 每次都挂一份 `ydoc.on('update')`/`awareness.on('update')`，而 `stop()` 从不摘——第五次开协同起，一次按键会往房里发五遍同样的帧。现在两个处理器存成字段，`stop()` 摘掉。
- **中继归属不再误判**：原写法在「中继已经在跑、但本会话还不知道端口」时会再调一次 `ws_relay_start` 并把 `ownRelay` 置真，于是**这个窗口退出协同时会把同进程里其他窗口的协同一起停掉**。改法：起之前先问在不在跑，只有「起之前不在跑」才是这一趟起的、才由我们收摊。
- **断线自动重连**：`onclose` 原来只把界面置红，协同再也回不来。现在退避重连（500ms 起、翻倍、8 秒封顶，连败 8 次才报错），并新增 `retrying` 态——它是「没在协同里」但不是「失败」，界面不报红。
- **重连后补推全量状态**：y-protocols 的握手是不对称的——收到 step1 的一方只回 step2（「你缺的」），不会回头发自己的 step1，所以「我多出来的」（正是断线那几分钟里改的）只有自己推过去对面才会知道。
- **心跳**：15 秒一枚应用层 ping，45 秒没收到任何一帧就判定连接已废并触发重连。

**测试怎么落地的**：连接参数做成可注入的（`ConnCfg`），Rust 侧单测把 90 秒压成 60ms×3，于是「死连接被清出去、房间被回收」能在 300ms 内真的跑一遍；「会答话的连接不被踢」是配着写的反例——只测前者的话，「把所有连接都踢了」的实现同样会过。`examples/relay.rs` 多接一个可选的 `read_timeout_ms` 参数，让 Node 侧端到端脚本也能用短超时中继验证「空闲但健康的连接不会被探活误杀」。

### 10. 表格规则侧通道：补测试 + 修两侧同一处判据（v0.137，`scripts/test-sheet-rules.mjs` + `src/lib/sheet-rules.ts` + `src-tauri/src/xlsx_rules.rs`）

`src/lib/sheet-rules.ts` 的头注自己写着「取是纯函数、在 Node 里就能测」——这句话跨语言写在那里，意思是别的侧通道（VBA、PDF 改字、协同）都有端到端脚本钉着，唯独这条没有。这轮先把它的行为钉住，钉的时候翻出一个真 bug。

**补的测试**（`scripts/test-sheet-rules.mjs`，63 项断言）：归一化（`normColor`/`normDateValue`/`dateOfIso`/`listOf`/`aggregateNotes`）、取（`extractRules` 三类资源各自的顺序、坏数据、边界记账——表不在了/建过滤器失败/门面缺方法，各收成一句人话而不是抛出去）、放（假门面 `applySheetRules` + `buildDataValidation` 的各类型、倒序区间、区外筛选）、往返一致性，以及下面那个魔法值的边界。放侧用一个 `Proxy` 假 builder 把门面调用录进数组，断言直接对着「调了什么、参数是什么」写——比断言最终 DOM 稳，也不必起 Univer。

**翻出的 bug**：两侧判定「下拉来源是字面选项还是区域引用」都用 `includes(':')`/`contains(':')` 猜。时间类下拉选项（`08:00,12:00`）含冒号却不是引用，判错就整串被当成区域名交出去——写侧写出的 `formula1` 不带引号，Excel 打开是一条无效公式，**下拉整个没了**。改法是真的去看冒号两边是不是单元格：新增 `is_cell`（Rust）/ `isCellRef`（TS），认 `A1`、`$A$1`、`Sheet1!A1`、`'我的 表'!A1`（表名前缀只看最后一个 `!` 之后），列 1~3 位、行 1~7 位，认不出的一律不算——与 `rects_of` 那边「认不出的形状不猜」同口径。

**误判方向是挑过的**：`=`/`$` 开头仍然一律算引用。这两条只会**多算**，而多算的代价（走 `*_formula`/`requireValueInRange` 入口，最多这一条规则不生效并进边界账）远小于**漏算**（把 `Sheet1!A1:A3` 当字面值按逗号切，变成三个莫名其妙的「选项」）。两边的新单测都按这个不对称性写了正反两面：`ref_detection_tells_literals_from_ranges` 里 `08:00,12:00`、`2026-01-01`、`1:2:3`、`A:A` 全部要求判成「不是引用」。

**一处魔法值收窄**：`value !== 'abc'` 里那个 `'abc'` 是 Univer 给文本类条件的**初值**（面板上新建「包含文本」却没填内容时模型里就是这一串），不是判定值，存进文件会写出一条 `text="abc"` 的规则。提成带注释的常量 `TEXT_PLACEHOLDER`，注释里写明代价是「用户真把判定文本写成 abc 时这一条不落盘」——这是已知的、故意接受的代价，由测试里那两行（`abc` 丢 / `abcd` 留）钉住：哪天 Univer 换了初值，那两行会红，而不是悄悄多存或少存一批规则。

### 这一批的验证（七道闸门，全绿）

`npx tsc --noEmit` 退出码 0 / `npx vite build` ✓ / `cargo test --lib` **147 passed / 0 failed**（v0.136 新增 3 条：心跳只回声不广播、沉默的连接被清出且房间回收、会答话的连接不被踢；v0.137 新增 2 条：引用判据的正面与反面、单元格形状的边界）/ `cargo clippy --lib` 28 条（全为 `map_or`/`too many arguments`/`manually reimplementing div_ceil` 一类风格级，无正确性问题）/ `vite-node scripts/test-sheet-rules.mjs` **63/63**（v0.137 新增）/ `vite-node scripts/test-vba.mjs` **114/114** / `vite-node scripts/test-vba-book.mjs` **61/61** / `node scripts/test-collab.mjs` **12/12** / `test-pdf-text-edit.mjs` 全部通过。

### 明确不做的（写下来是为了下次别纠结）

协同中继的生产化（鉴权 + 落库）、宏沙箱进 Worker/独立进程、VBA 的 `GoTo`/`Type`/`Property`/多维数组/日期字面量/`[A1]` 简写（v0.134 接上 Workbook/Worksheet/Cells 首版后仍不认，撞上带行号报错）、PDF 的重排式改字（现在「原位改字」覆盖大多数场景）、中文分词式拼写检查。路线图里「VBA 的 Excel 对象模型」那枚 v0.134 已接上并勾掉，未勾 426 → 425、已勾 160 不变。

- **收尾**：README 新增本节（`## 发行说明：v0.128–v0.133`）+ 架构节补 12 枚新模块条目（Rust 三枚：ods_chart / ods_cf / ws_relay；前端九枚：identity / macro / vba-lex / vba-parse / vba-emit / vba-rt / vba / spell / collab / pdf-text-edit）+ 路线图两处就地收窄（`.ods` 那枚改名为「筛选/数据验证/页面设置」并记图表与条件格式已往返；双轨编号那枚的轮次名从 v0.125 更到 v0.133、差距从 30 个号到 37 个号）+ 就地改口一处（v0.96.0 发行节「两套编号」那条补 v0.133 起的再收窄）；产品源文改动六件——`src/components/SheetEditor.tsx`（ODS 丢失提示改口）、`src-tauri/src/ods_cf.rs`（共用尺 + 记账函数 + 单测，约 90 行）、`src-tauri/src/ods.rs`（挂账一行）、`src-tauri/src/ods_chart.rs`（`mut` 警告）、`src/lib/macro.ts` 与 `src/lib/spell.ts`（头注两处）；本轮不占版本号（四枚版本文件一寸没碰，仍 0.96.0），未提交；未勾 424 → 426、已勾 160 不变，README 现 10,374 行 / 1,969,494 字节 / CRLF 10,374 枚而孤立 CR 与孤立 LF 各 =0（本轮插入后曾留下 1 枚孤立 CR 与 14 枚孤立 LF，规范化时修掉并复算）而「」开闭差与基线同值（−2，3,426 开 / 3,428 闭）而反引号 45,066 为偶

- **收尾（v0.134）**：README 本节加第七节「表格侧 VBA」+ 验证行加 `test-vba-book.mjs` 61/61 + 「明确不做的」摘掉已接上的 Excel 对象模型 + 架构节补 `lib/sheet-macro.ts` 一枚 + 路线图「VBA 子集还差 Excel 那一侧的对象模型」那枚勾掉（改 `[x]` 并记 v0.134 首版）；产品源文改动——`src/lib/sheet-macro.ts`（新，384 行，Univer facade → 可测 `SheetMacroApi`）、`src/lib/vba-rt.ts`（工作簿对象模型约 +400 行 + `IsNumeric` 空白格语义更正）、`src/lib/vba.ts`（入口 `runVbaBook` + `VBA_BOOK_SAMPLE`）、`src/lib/vba-emit.ts`（全局名白名单加 Excel 那批 + 声明过变量按下标走）、`src/lib/macro.ts`（表格侧宏存储 `loadSheetMacros`/`saveSheetMacros`/`newSheetMacro` + 内置两条 VBA）、`src/components/SheetEditor.tsx`（「宏」按钮 + 宏面板，改动标脏）；`scripts/test-vba-book.mjs` 新（端到端 61/61，用 `FakeBook` 假实现）；本轮不占版本号（四枚版本文件一寸没碰，仍 0.96.0），未提交；未勾 426 → 425、已勾 160 不变
- **收尾（v0.136）**：README 本节加第九节「协同传输层加固」+ 标题扩到 v0.128–v0.136 九轮合记 + v0.135 那节「没做」里读超时那一条就地改口（欠账已还）+ 验证行补 `cargo test` 145 与 `test-collab` 12/12；产品源文改动五件——`src-tauri/src/ws_relay.rs`（`read_frame` 分超时/EOF、读超时探活与踢人、应用层 ping/pong 不广播、空房回收、`ConnCfg` 可注入、三条新单测）、`src-tauri/examples/relay.rs`（可选 `read_timeout_ms` 参数）、`src/lib/collab.ts`（监听器不再累积、中继归属修正、应用层心跳、退避重连与 `retrying` 态、重连后补推全量）、`src/components/DocEditor.tsx`（协同面板认 `retrying` 态：房间名可编辑性判据反过来写、`重连…` 按钮与提示）、`src-tauri/src/ods_chart.rs`（清掉一条只在测试段用到的 `serde_json::Value` 导入，`cargo build` 上那条 unused import 警告随之消失）；`scripts/test-collab.mjs` 加四组断言与第二个（短超时）中继实例；本轮不占版本号（四枚版本文件一寸没碰，仍 0.96.0），未提交；未勾 426 → 425、已勾 160 不变
- **收尾（v0.137）**：README 本节加第十节「表格规则侧通道」+ 标题扩到 v0.128–v0.137 十轮合记 + 上一轮插入时留下的双标题符号（`### ### 这一批的验证`）修掉并把「六道闸门」改口成七道 + 验证行补 `cargo test` 147 与 `test-sheet-rules.mjs` 63/63；产品源文改动两件——`src-tauri/src/xlsx_rules.rs`（`is_ref` 不再靠 `contains(':')` 猜，新增 `is_cell` 并配两条单测）、`src/lib/sheet-rules.ts`（同一把尺子写成 `isRangeRef`/`isCellRef`，那个 `abc` 占位串提成带注释的 `TEXT_PLACEHOLDER`）；`scripts/test-sheet-rules.mjs` 新（63 项断言，假门面用 `Proxy` 录 builder 调用）；本轮不占版本号（四枚版本文件一寸没碰，仍 0.96.0），未提交；未勾 426 → 425、已勾 160 不变


## 发行说明：v0.138 —— 四组件「真精深」挖深一轮（Writer 长尾字符属性 / Calc 样式两层链 / Impress 属性漏斗与首份覆盖账 / PDF 几何双实现互证），按用户点名「只做现有四个组件，往『真，精，深』方向上挖，给出解决方案并执行」立项，四笔账七提交（c95f59c / 07657f2 / ed6decc / 05a566e / 19164bc / 8f26726 / 7ac5bdc）连同本账一节均已落盘，不占版本号

一句立项：不扩格式、不加部件、不占版本号，四个现有组件各挑一枚能量化「深没深」的账做到底。四笔的判据都不是「功能加了」，而是「量具上的数动了或者量具本身新建了」。Writer 与 Calc 是既有 fidelity 榜单驱动，Impress 与 PDF 是给没有量具的组件补量具——补的过程中量具各抓出一个真问题。

### 1. Writer：fidelity 榜单 never-consulted 长尾属性落地（v0.138 W1，`c95f59c`，六文件 +1,256/−21）

按榜单字面量从大到小落地，不按好不好做排：`rFonts@asciiTheme/hAnsiTheme/eastAsiaTheme/cstheme`（81,978 枚）新增 `readTheme` 读 `word/theme/theme1.xml` 的 major/minor × latin/ea/cs 六槽，`applyThemeFonts` 在 document/styles/numbering 三棵树上把主题引用就地解析成具名属性（只填缺的）——Word 的 Normal 样式只写主题引用，不解析整篇掉回浏览器默认字体；`rFonts@hint`（136,408 枚）新增 East Asian Width=Ambiguous 子集表（引号/破折号/希腊/西里尔/罗马数字等 28 段），`hint=eastasia` 时含混字符单独成段、东亚字体排栈首，相邻同类合并，default/单族/同名三种形状不切段；`w:pos`/`w:kern`（30,074 枚）pos → vertical-align（半点折 px、两位小数，与上下标同时出现时不兑现），kern=0 → `font-kerning:none`；`szCs`/`cs`/`lang`/`langEa`（约 228,000 枚）读进 RunProps 随 `data-*` 发 HTML，新建 `src/lib/char-extra.ts` 的 CharExtra mark 接住 pos/kern 的屏上一半（inline style 过不了 TipParse，只能走 mark 的 renderHTML），`docx.ts` 读回写 rPr——cs/hint 走 docx 库的 font 对象，szCs/lang/pos/kern 四枚在库里实现着但类型面没暴露，按库外槽并（判据是 `node_modules/docx` 的 RunProperties 构造器，不是猜的）。测试 `scripts/test-docx-runprops.mjs` 新（39 项），fidelity selftest 夹具加主题部件与新属性、10 枚 pair 从 MUST_NOT_SEE 移入 MUST_SEE。**覆盖率账没重跑**：313 枚语料不在盘（`D:/docs` 已不在），老账（120 对 / 17.6%）原样留在 `docs/fidelity.json`，本轮分子增量以 39 项单测和 selftest 那 10 枚搬家为证——写下来是为了下次别把老账当成新账念。

### 2. Calc：cellXfs 的 apply* 两层链语义与内建数字格式表（v0.138 W2，`ed6decc`，`src-tauri/src/xlsx_style.rs` +332/−9，单测 13 项）

`cellXfs` 的 `applyFont/applyFill/applyBorder/applyNumberFormat/applyAlignment` 与 `xfId→cellStyleXfs` 链此前的实现是「自槽缺省当常规值」，和规条（「该组与父不同时 applyX 应为 true」）打架。按 [MS-OE376] Part 4 §3.8.45 定案改成**三态合并**：`XfRec` 的五个 apply 槽从 `bool` 改 `Option<bool>`（None=缺省、Some(false)=显式抑制、Some(true)=显式应用），`merge_slot(own, base, apply)` 对 None 且自槽正是常规缺省值（fontId/fillId/borderId=0、numFmtId=0）时回落基样式——因为 cellXfs 里 apply* 的缺省值是 **false**（该组与基样式「连着」）而 cellStyleXfs 里缺省值是 **true**，显式 `="0"` 一律回落；和规文件两种模型结论相同，分歧只落在不和规件上，对自家 round-trip 零影响（`rust_xlsxwriter` 的 `xf_formats[0]` 恒为 `Format::default()`，实测）。对齐组另有判据：`applyAlignment` 缺省时看的是「alignment 子元素整枚缺席」而不是某个属性没写。内建数字格式表补 12/13/37/38/48 五枚，**收录判据是量的不是猜的**：探针测试写六种格式用 calamine 读回类型——日期/时间格式交回 `Data::DateTime`（值已字符串化 ⇒ 模式在屏上不活 ⇒ 不收），分数、科学计数、带括号/红字数值档交回 Float（模式活着 ⇒ 收），5-8/41-44 货币、14-22 日期、45-47 时间、23-36 会计变体保持不映射；`numfmt` 对非数值走文本段直通，格式串挂在字符串值上不会双重格式化。**就地更正**：上一稿这里写「dxf 链没接、`numFmtId≥164` 自定义格式串没进样式快照」——两条都写错了，回读代码后更正：`<numFmts>` 早已读进 `StyleBook.numfmts` 且 `style_for` 的第 648 行就把它送进 `CellStyle.nf`；`parse_dxfs` 与 `cfRule/@dxfId` 那条链也早就在（`xlsx_rules.rs`）。**真正没做的是 dxf 里的 `<numFmt>`**——见补记一节，本轮已补。屏上值照旧走 calamine 的字符串化（自定义串进了载荷，落不落屏是另一条链）。

### 3. Impress：读侧属性收拢成单漏斗 + 首份属性覆盖账（v0.138 W3，`05a566e` + `19164bc`）

`src/lib/pptx-import.ts` 31 处 `getAttribute` + 2 处 `getAttributeNS` 收拢成 `ga()` 一枚漏斗：普通名走 `getAttribute`，`r:` 前缀的回落 `getAttributeNS(R_NS, …)`——浏览器 DOMParser 与 node 侧 `@xmldom/xmldom` 对 `r:embed` 的行为差一根毫毛（一个认 qualified name、一个要 namespace），漏斗把差别关在一处；`clrMap` 二十来枚 OOXML 属性名与 `r:` 名混排，也照单全收。首份覆盖账 `scripts/fidelity-report-pptx.mjs`（794 行）与 docx 版同骨架、四处不同：漏斗只认 `ga` 一枚、分母范围=theme1/slideMaster1(+rels)/全部 slides(+rels)/全部 notesSlides（slideLayouts 读手一次不读、themeN/slideMasterN 的 N>1 不读，进了只是噪音）、入口 `pptxBytesToDeck`、node 侧 `globalThis.DOMParser = DOMParser`。三腿齐全：selftest 双向断言（MUST_SEE 30 枚全命中、MUST_NOT_SEE 31 枚全落空）、`--clean-pass` 等价腿、`--mut no-ga` 变异腿。等价腿的坑：`newId()` 带 `Date.now()` ⇒ 两趟必然不同，`stripIds()` 抹了再比。首份账 `docs/pptx-fidelity.md`：**夹具为宇宙**（无 pptx 语料在盘，报告头部如实标注、留 `--corpus` 口子），77 对 / 217 字面、已查问 42 对（54.5% 按对、60.8% 按字面）；未查问榜首 `cTn|id`（11 枚，timing 内部流水号——读手按 spid 认人不用它），随后 `cNvPr|name`（形状名模型里没这一层）、表格 `gridCol|w` 与 `tr|h`（列宽行高真丢账）、主题 `latin|typeface`（字族整族不读）。

### 4. PDF：几何双实现互证，量具抓出一个真问题（v0.138 W4，`7ac5bdc`）

`PdfViewer.loadPageGeom` 里那段内联几何（字号取 trm 纵向量、覆盖盒上升 0.85 下降 0.25、PDF 左下→未旋转左上→显示空间三步换算）抽成 `pdf-geo.ts` 的 `textItemBox` 纯函数，组件改调它、本地 `TextGeom` 接口换成导入的 `TextItemGeom`（单一事实来源）。新量具 `scripts/test-pdf-geo-cross.mjs`（92 项全过）把**我们这套纯函数 vs pdfjs-dist 的 PageViewport**（`convertToViewportPoint` / `convertToPdfPoint` / TextLayer 自己用的 `Util.transform(vp, item)`）两条互不依赖的实现对表——两边对不上，意味着要么我们算错（框偏、盖歪），要么对渲染器行为的理解错了。五条腿：A 9×9 网格 × 4 旋转采样点对（正逆两向，mapPoint/unmapPoint 不导出，用零尺寸矩形走公开 API 触达同一函数）；B `displaySize` ↔ viewport 尺寸；C pdf-lib 造带 `/Rotate` 的真件、pdfjs 读回后逐行对（显示基线起点落盒、盒随旋转换互换、`item.width` ↔ pdf-lib 独立步进两份 metrics 差 ≤1.08%、写回 cover 矩形往返）；D 播种随机矩形往返 800 例（LCG 不靠 `Math.random`，跑两遍结果一致）；E `normRot` ↔ 渲染器有效旋转（从 `vp.transform` 反读，不靠我们自己的判据）。两条变异实测有牙：rot=90 映射写错 → 7 项挂；`normRot` 回退旧规则 → 4 项非和规值挂。**量具量出一个真问题并修掉**：旧 `normRot` 是「四舍五入到最近 90°」（45→90），而 pdf.js 的 PageViewport 是 `switch` 精确匹配——非 90 倍数一律按 0 渲染（实测 45→0、135→0、450→90、−90→270；pdf-lib 的 `reduceRotation` 同为「非 90 倍数→0」，三方一致）。非和规 `/Rotate` 上框按 90° 算、页面按 0° 渲，屏幕必然偏；改成与渲染器逐字对齐，和规件上两规则等价、零风险。没做：互证只覆盖横排文字（`item.width` 按水平步进建模，竖排/斜排是近似值——注释里写明受影响的是盖底与命中覆盖面、不是写回位置）；Helvetica 两份 metrics 的 1.08% 差放在容差里如实报差，没有「修齐」的念头（那不是我们的数）。

### 5. 补记：dxf 的数字格式不再丢（v0.138 续，`3e14ed1`）

上轮「Calc 没接 dxf 链」是**记错的**（上面已就地更正）；回读代码后找到的**真**缺口在另一处：
dxf 只解了底纹/字色/粗/斜/下划线/删除线七枚，`<numFmt>` 一个字不读。于是「大于 0 显示成 0.0%」
这类**只配数字格式、一个色也不描**的条件格式，打开再存一次格式串就永久没了——**这是数据丢失不是显示问题**，
所以补上。

- **读侧**：`parse_dxfs` 收 styles.xml 顶层的 `<numFmts>` 表，`<numFmt>` 按三档取：内联 `formatCode` →
  numFmts 表（按 id）→ 内置表（按 id）；三处都没有就留空，不猜。三档不是凭空设计的——实测
  `rust_xlsxwriter` 在 dxf 里**内联串且不给 dxf 配 numFmts 表**（`<dxf><numFmt numFmtId="164" formatCode="0.0%"/></dxf>`，
  而同一次写件里单元格侧是正经写 `<numFmts>` 表 + `cellXfs` 引用 164 并带 `applyNumberFormat="1"`），
  Excel 侧只写 id 的件也见得到。
- **写侧**：`dxf_format` 加 `set_num_format`。只带 nf 的规则原来连 Format 都没有 ⇒ rust_xlsxwriter
  压根不生成 dxf ⇒ 存盘就丢这一条。
- **判空**：`is_empty_style` 加 `nf`。不加这一条，只配数字格式的 dxf 会被判空、`cfRule` 上整枚 `fmt`
  被丢掉——往返测试专门压它（两条变异各咬 2 项）。
- **ODS 侧顺手**：`ods_cf.rs::cf_style_of` 把 `CellStyle.nf` 一起搬过来（它原注释写着「数字格式没开口」）；
  **边框与对齐仍不开口**——Univer 的条件格式高亮那六枚 `set*` 里没有它们，开了也是存着不用。
- **屏上诚实边界**：Univer 的 CF 高亮只有底纹/字色/粗/斜/下划线/删除线六枚 `set*`，**没有数字格式槽**
  ⇒ `nf` 屏上不活，只服务存盘往返。写在 `CondFormatStyle.nf` 的类型注释与 `buildCf` 里。
- **单测 5 项**（`cargo test --lib` 152 → **157**）：三档取值、查不到的 id 留空、`cfRule` 只带 nf 不被判空、
  真正的空 dxf 仍不占 fmt、**写件→读回**往返。

### 这一批的验证（七道闸门）

`cargo test --lib` **157 passed / 0 failed**（v0.138 新增 5：dxf 数字格式三档/不猜/判空/空 dxf/往返） / `cargo clippy --lib` 29 条（全为 `map_or` / `too many arguments` 一类风格级，无正确性问题）/ `tsc --noEmit` 退出码 0 / `vite build` ✓ / docx selftest 双向断言过（46 对 / 115 次，应看到 26 枚全命中、不该看到 7 枚全落空）/ pptx selftest 77 对 42 查问 / 六套 node 脚本全过：`test-sheet-rules.mjs` 63/63、`test-vba.mjs` 114/114、`test-vba-book.mjs` 61/61、`test-collab.mjs` 12/12、`test-pdf-text-edit.mjs` 全过、`test-pdf-geo-cross.mjs` 92/92。

### 明确不做的（写下来是为了下次别纠结）

dxf 的边框与对齐两族（`CondFormatStyle` 仍只开底纹/字色/粗斜下删/数字格式八枚槽）、Writer 侧 313 枚语料不在盘时的全量覆盖率重跑、pptx 语料不在盘时的覆盖账全量跑（夹具为宇宙并留口子）、PDF 竖排/斜排文字的轴对齐盒精确化、重排式 PDF 改字（v0.129 已判「原位改字覆盖大多数场景」）。


## 发行说明：v0.139 —— 上一节「明确不做的」五条里清掉四条（dxf 两族 / PDF 竖排盒 / docx 覆盖率重跑 / pptx 覆盖账审计）

一句立项：v0.138 结尾那份「明确不做的」清单当待办用。四条各自独立，判据都不是「代码动了」，是**量具上的数动了**或者**账从「不知道」变成「知道」**。四笔提交 `a68ae17` / `e3ddf5d` / `c446b39` / 本节。

### 1. dxf 的边框族整个走通来回、对齐族读侧收拢写侧记账（`a68ae17`）

`CondFormatStyle` 开 `bd/ho/vo/wb` 四槽。边框读（`parse_dxfs` 补 `border` 分支：四边 + 颜色、自闭合的空边不占位、空 `border` 标志不泄漏）→ 载荷 → 写（`dxf_format` 补边框族，与 `format_for` 同一副走法，只色无样式的边不计 `any`），整个往返 e2e 钉住；对齐族读侧按单元格侧同白名单收（`center`→`middle`、`wrapText` 三态），写侧 `rust_xlsxwriter` 的 dxf **没有** alignment 分支（crate 文档明说条件格式不可改对齐）——不耍聪明补字节，走 `cf_write_accounts` 边界账一箱一句话。`ods_cf` 透传四槽（`wb` 在三态与 ODS bool 间换算）。`cargo test --lib` 157 → **164**，clippy 29 → 30（新增一枚与 `format_for` 同形的 `type_complexity`，风格级）。

### 2. PDF 竖排文字的盒跟着文字方向换轴（`e3ddf5d`）

`textItemBox` 重写为「真盒四角取轴对齐包围」：从 pdf-lib 造件 + pdfjs 4.10.38 读回实证 `transform` 前四元是按字号缩放的旋转矩阵——`(a,b)` 步进方向、`(c,d)` 字身方向，`width` 是沿步进的步进（**方向无关**，同一串横排竖排报同一个数）。盒 = 起点沿步进走 `width`、沿字身铺开 `0.85/0.25×size`；横排输出与旧行为**逐位一致**，竖排长边贴步进、字头朝向由 inset 体现，斜排取旋转后真盒的包围（比旧的水平近似贴真墨迹）。互证脚本加 F 腿（112 项）：基线起点贴起步边、距下沉侧 `0.25×size`、盒尺寸随页旋转互换、真盒四角含得住、`width` 方向无关、写回 cover 矩形往返——全部断言从渲染器自己的量（`Util.transform` 后的 `tx`）出发。改字脚本补竖排端到端腿（盒贴方向、新文字落原点、按横排画是已知代价，方向保持留待下一档，已钉住）。**92 → 204 项互证全绿**。

### 3. docx 覆盖率全量重跑：语料不在盘，就把语料钉成可重建的（`c446b39` + 本节）

上一节写着「313 枚语料不在盘（`D:/docs` 已不在），老账（120 对 / 17.6%）原样留着」——这条是真问题：**分母不可复核，账就没法重跑**，而 v0.138 W1 落地的十枚长尾属性正等着这一跑。

做法不是「找一份别的语料凑」，是**把宇宙冻结进库**：旧账（`040dffb` 那一跑）见过的 701 对 `element|attribute` 连同字面计数写进 `docs/fidelity-universe.json`，再由 `scripts/gen-docx-fidelity-corpus.mjs` 按 `count/100` 缩放生成 5 个合成 docx。**幂等靠固定输入**：同一个宇宙文件跑多少遍都是同一批件、同一批字面。承放位置不是均匀撒的，逐族按读手源码定死——`sectPr` 打头（`contentTwipsOf` 找的是第一个）、`rFonts` 三棵树（`applyThemeFonts` 走 document/styles/numbering）、OMML 不带前缀（`findL` 按全名精确匹配，带 `m:` 就找不到）、`bitmap()` 的短路链要真 rels + 真 PNG（任一环断则 `extent`/`docPr`/`shape@style` 三族一起掉）、`tblStylePr` 与条件行高只有「表上 `w:tblStyle` 引用了带条件块的样式」才会被查问（造一枚表格样式 + 一张引用它的表）。生成器自带自检：`missing` 非空即 exit 1，现为 **701/701、零缺失、零多余**。

报告脚本加 `--synth` 旗：JSON 记语料出处（`rebuiltBy`/`universe`/`scale`/对齐全景/字面漂移），MD 播「Corpus provenance」节，白纸黑字写明**按对与旧账可比、按字面不可比**。

跑出来的账（三腿 + 普查腿 + 变异腿）：

| 腿 | 数 |
|---|---|
| 分母（普查脚本独立解析，第二台解析器） | 701 对 / 31,455 字面（缩放期望 31,321，**+0.43%**） |
| 探针腿 | 已查问 **136 对 / 16,869 字面**；按对 **19.9%**、按字面 **71.0%**（旧：120 对 17.6% / 50.7%） |
| selftest | 46 对 / 115 次查问，应看到 26 枚全命中、不该看到 7 枚全落空 |
| 等价腿 | 5/5 字节相同（探针不扰动产品） |
| 变异腿 `--mut no-attrL` | 按对 19.9% → **18.2%**、按字面 71.0% → **63.3%**（漏一枚漏斗，账必须掉） |

**逐对比对旧账**：跳变 18 对（全部能指到代码行：`readRPr` 那族的 `rFonts|hint`/`rFonts|cs`/`szCs|val`/`lang@val`/`lang@eastAsia`/`kern|val`/`spacing|val` 七枚 + 四个主题槽 `asciiTheme`/`hAnsiTheme`/`eastAsiaTheme`/`cstheme`，加 `OLEObject|Type`、`footnote|id`、`endnote|id`、`ins|author`、`ins|date`、`tblW|type`、`tblW|w`）；掉出只有 **2 对**，且都是读手**有意不读**：`bookmarkStart|name`（`visit()` 对 `bookmarkStart` 直接 return，名字一次不问）与 `tblLook|val`（代码注释里就写着「`w:val` 那枚十六进制从不被读」，闸门只吃四位 `firstRow`/`firstColumn` 这些）。**零档位错乱**。

按字面 50.7% → 71.0% 这一跳要拆开说：一部分是读手真长（上面 18 对的字面都很大，`rFonts|hint` 单枚 136,408），一部分是**口径变了**（按对可比、按字面不可比）——所以这个数只跟它自己那一列比，不拿去跟旧账比。

### 4. pptx 覆盖账全量审计：35 对未查问逐枚裁「真丢账 vs 裁定不读」（本节）

pptx 那本账 v0.138 只说了「哪 35 对没被问过」，没说该不该问。逐枚回 `pptx-import.ts`（723 行）与 `ppt.ts` 裁一遍，落成 `docs/pptx-fidelity-audit.md`：

- **真丢账 12 对 / 28 字面**：`cNvPr|name`（9）、`cTn|dur`（5）、`bodyPr|anchor`（2）、`gridCol|w`（2）、`tr|h`（2）、`latin|typeface`（2）、`bodyPr|wrap`、`rPr|i`、`rPr|u`、`cNvPr|descr`、`transition|advClick`、`tblPr|bandRow`。其中**四对会直接改屏上观感**（垂直锚点、斜体、下划线、主题字族），其余八对是往返保真度。
- **裁定不读 23 对 / 57 字面**：动画时间轴内部 11 对（`cTn|id` 11 枚是最大的一笔，timing 树内部流水号）、锁定标志 2、主题/方案命名 3、系统色名 2（`sysClr@val` 是色名，读手取 `lastClr` 实值）、`graphicData|uri` 与 `ln|cap` 2、保存会话记账 2（`dirty`/`lang`）、过渡速度 1、占位符序号 1（版式按 `ph@type` 映射，`idx` 没有落点）。

审计里有两条结论值得单独记：**按字面量排序会把两类搞反**——`cTn|id` 11 枚字面最大却不该读，`rPr|i` 1 枚字面最小却屏上看得见；以及**写侧同样没有这 12 对的输出**，补读侧要同时看写侧，否则读进来也存不回去。

### 这一批的验证（八道闸门）

`cargo test --lib` **164 passed / 0 failed**（v0.139 新增 7：dxf 边框四槽读/写/往返 3 + 对齐族 4） / `cargo clippy --lib` 30 条（全为风格级，无正确性问题） / `tsc --noEmit` 退出码 0 / `vite build` ✓ / docx 覆盖率四腿（selftest 46 对 · 等价 5/5 · 合成 701 对 19.9% · 变异 18.2%） + 独立普查腿（701 对 / 31,455 字面，与探针腿分毫不差） / pptx 三腿（selftest 77 对 42 查问 · clean-pass · `--mut no-ga`） / PDF 互证 204 项全绿 / 六套 node 脚本全过（`test-sheet-rules` 63/63、`test-vba` 114/114、`test-vba-book` 61/61、`test-collab` 12/12、`test-pdf-text-edit`、`test-pdf-geo-cross` 204/204）。

### 明确不做的（这一节只留三条，其余已在上文兑现）

- **合成语料不等于真件语料**：按对可比、按字面不可比，已写进 `docs/fidelity.md` 的出处节；真件重跑仍要等一份可发布的 docx 语料（`--corpus` 口子一直开着）。
- **PDF 改字仍按横排画**：竖排盒已准，但写回时方向不保持（端到端腿钉住了这个已知代价）。
- **pptx 那 12 对真丢账一枚没修**：本轮只做审计，不动读手——**v0.140 已闭**，见下一节。


## 发行说明：v0.140 —— pptx 审计裁出的 12 对真丢账补完（读写两侧 + 屏上观感）

一句立项：v0.139 第 4 节把 pptx 的 35 对未查问裁成「真丢账 12 / 裁定不读 23」，并写明「补读侧要同时看写侧」。这一节就是那 12 对的施工。判据同上一节：**量具上的数动了**——夹具自检里这 12 枚从 `MUST_NOT_SEE` 搬进 `MUST_SEE`，未查问档从 35 对掉到 23 对，一对不多一对不少。

### 1. 屏上直接看得见的四对：斜体、下划线、垂直锚点、主题字族（`5413253`）

`shapeStyleOf` 过去只认 `sz`/`b`/`solidFill`/`algn`，斜体下划线整族不问；`bodyPr` 一次不查；`fontScheme` 一次不读。四对全部补读（走既有的 `ga()` 漏斗，账自动记分子），模型开 `SlideShape.italic`/`underline`/`anchor`、`MasterStyle.majorFont`/`minorFont`，渲染（StaticSlide + 编辑器画布）与导出同步：斜体/下划线落 `font-style`/`text-decoration`，锚点用弹性盒表达（块内文本没有 CSS 垂直对齐），字族导出落 `pptx.theme` 的 `headFontFace`/`bodyFontFace` → theme1.xml 的 fontScheme。下划线只表达单线（点线/双线降级），锚点只收 `t/ctr/b`（`just`/`dist` 在 CSS 里无处安放）。

### 2. 往返保真八对：形状名、替代文本、列宽行高、隔行底纹、动画时长、点击换页、不换行

- `cNvPr|name`：页内唯一时直接拿它当 objectName——PowerPoint 选择窗格里就是导入时的那个名；重名才退回 `ooShapeN`（反查按名认人，重名会指错形状，宁可丢名字）。
- `cNvPr|descr`：image/chart 有原生 `altText`，文本/表格 pptxgenjs 不写——走既有的解包注入路子。**这一枚当场抓住一个真 bug**：第一版注入把 `cNvPr` 标签结尾的 `>` 切掉了，自闭合与开标签两支全哑，而图片那枚因为走原生通道看起来是好的——tmp 往返脚本（读→写→再读逐字段比对）不跑这一趟根本发现不了。
- `gridCol|w`/`tr|h`：模型存**相对总和的分数**而不是 EMU（换页宽照样翻得回来），渲染进 `<colgroup>`/`<tr>` 百分比，导出按表框实宽高折算回英寸。
- `tblPr|bandRow`：pptxgenjs 写永空 `tblPr`（bandRow 那行在它源码里是注释），只能注。
- `cTn|dur`：入场时长进模型（页级 `Slide.animDur` 管正文逐条、形状级管自己那枚），导出替换 timing 树里的硬编码 `dur="500"`；出场时长不捕（模型无槽，保持默认）。
- `transition|advClick`：`"0"` 且无 `advTm` 的页以前导出后会变回「点击就翻」，现在 `advClick="0"` 跟着走；模型只存 `false`（缺省与 `"1"` 同义）。
- `bodyPr|wrap`：`wrap="none"` 进模型，渲染压过默认 pre-wrap，导出走 pptxgenjs `wrap:false`。

夹具随之扩容：自由文本框补 i/u/anchor/descr 当断言载体（占位符那支按设计不取字符样式，只有真进形状层的 sp 才算数），表/图/母版/时长各加内容断言——「查问过」与「真的落进模型」两件事分开断。

### 3. 账上的数与两处记下的账

| 腿 | 数 |
|---|---|
| 分母（夹具宇宙） | 77 对 / 222 字面（夹具本身 +5 字面：自由文本框补的 i/u/anchor/descr 与一枚 solidFill） |
| 探针腿 | 已查问 42 → **54 对**（132 → 165 字面）；按对 54.5% → **70.1%**、按字面 60.8% → **74.3%** |
| 未查问 | 35 → **23 对 / 57 字面**，与审计裁定的「不读」名单逐枚相同 |
| 等价腿 | 1/1 相同（探针不扰动产品） |
| 变异腿 `--mut no-ga` | 自检 42 条断言转红（漏斗拔掉，MUST_SEE 全灭） |
| 往返（tmp 脚本） | 12 枚字段读→写→再读全部一致；另抓住 descr 注入 bug 一枚 |

两处**既有**往返不对称记入审计文档备查（与本轮无关）：标题/正文槽导出后无占位符身份，再导入会多出两枚自由文本形状；母版的 `titleRect`/`bodyRect` 导出不写回 slideMaster。

### 明确不做的（这一节）

- **12 枚没有 inspector 控件**：导入进来的值重新导出时原样保留（`patchShape` 是展开赋值，不会冲掉），但用户想手改斜体/锚点/列宽还得等下一轮。
- **出场动画时长仍不捕**：模型只有一枚入场时长槽；`transition|spd`（过渡速度档）维持裁定不读。
- **pptx 真件语料仍不在盘**：这一账的 Universe 还是夹具；`--corpus` 口子开着，真件数要以真件语料重跑为准。

## 发行说明：v0.141 —— 导入链两处热点实测提速 + v0.140 欠的控件补上（含一次 index.css 误抹的完整恢复）

一句立项：v0.140 结尾「明确不做的」第一条是「12 枚没有 inspector 控件……等下一轮」——逐枚数下来，形状条上放得下的有 11 枚（第 12 枚 `latin|typeface` 是母版级主题字族，不占形状条），这一节就是那 11 枚；顺手把量具自己在两条导入链上数出来的两处热点做掉。判据同前：性能是预热后 6 趟的中位数（3 趟时方差到过 200ms，不取单趟），控件那 11 枚走 v0.140 建好的往返脚本逐字段比对。

### 1. 性能：两处热点，两个数（`04852a3`）

- **pptx 读手 376 → 124ms（−67%）**：读手过去整棵树过 xmldom 的 DOMParser，这一轮换成自有视图树 `PEl`（`{name, attrs, kids, text}`；`kids` 是方法不是属性——树只在建时走一遍），配 `textOf` / `firstDesc`（**命中即返**，替掉 `descendantsByName(...)[0]` 那种先把全树收进数组再取第零个的写法）；属性读取仍全部汇在既有的 `ga()` 漏斗，`r:` 前缀走本地名回退。DOMParser 从读手移除，量具账本随之改口：**分母腿与读手不再共用一个 parser**——两腿各用各的，一方的命名空间/实体怪癖不带着另一方一起错（`r:` 回退两处都对得上：读手按本地名、分母按 `getAttributeNS`）。
- **docxToHtmlFidelity 450 → 375ms（−17%）**：`findDesc` 改命中即返的递归；`parseXml` 在标签没有 `=` 时共享一张冻结的空属性表（不再每标签分配一个对象）；`tagWordEnd` / `inQuotes` 改字符码比较。
- 2× 规模对照（段落数 ×2、幻灯片数 ×2）耗时 1.6–1.7× 增长 ⇒ 两处都不是 O(n²)。
- 读手换了实现，两份账本的数字一屏没动（pptx 70.1% / 74.3%、docx 合成 19.9% / 71.0%，与 v0.140 / v0.139 逐字相同）——提速没有换来语义漂移，这本身就是判据。

### 2. v0.140 欠的 11 枚控件：从「导得进、写得出」到「改得动」

形状属性条一次补全（列/行数 > 6 不给逐枚入口——属性条会挤成两行还看不清是哪一列；占比模型照常读写，不受影响）：

- **斜体 / 下划线 / 垂直锚点 / 不换行**：按钮与下拉进形状条。降级规则不变：下划线只表达单线，锚点只收 t/ctr/b。
- **列宽% / 行高%**：数字入口 + 「等分」。坑在必须归一：`colW`/`rowH` 存的是**占表总宽/高的分数**，导出按这个和折回英寸——用户把一列改成 0.5 而其余仍是 0.5+0.5，落盘时整张表就被拉宽出框。`setTableSpan`（ppt.ts）改一列、其余按原比例让位，和恒为 1，值域钳在 [0.05, 0.9]。
- **隔行底纹 / 形状名 / 替代文本 / 入场时长 / 点击换页**：隔行底纹走 v0.140 那条解包注入落盘（pptxgenjs 那行在它源码里是注释）；形状名是 PowerPoint 选择窗格与动画目标认人的名字、替代文本是屏幕阅读器念的图说，两枚此前都「导得回、没处改」；入场时长未设 = 导出 500ms（PowerPoint 的默认）；点击换页缺省与「开」在文件里同义，关掉才写 `advClick="0"`。

样式进 `index.css`：`.ppt-bar-group` / `.ppt-bar-label` / `.ppt-bar-text` 三件套管组内挨紧、组间留缝（否则一列四个数字框看起来像四个无关的控件），`.ppt-btn-italic` / `.ppt-btn-underline` 给按钮字形，`.tool-num` 给两枚数字框。

### 3. 一次误抹与完整恢复：index.css

`git checkout -- src/index.css` 把工作树上**未提交**的改动整个抹掉了——那文件里同时躺着另一条线的拼写/项目符号样式与本轮新增的类。恢复分三步，每步可复算：

1. **转录重放**：以 `git show HEAD:src/index.css` 为底，把会话转录里全部 Edit/Write/python 片段按序叠回去，任何一步对不上就停、不猜。
2. **构建产物反向补回**：更早几轮的编辑不在转录里，从 10-22 22:57 那次构建产物按声明捞回（选择器归一化后比对）。
3. **逐条声明级复核**：dist 里 587 条规则补回后 **0 缺失**；补回的 60 条中 46 条与前段逐字一致、13 条是压缩器等值变换（`none`↔`0 0`、rgba↔8 位 hex、`left bottom`↔`0 100%`、`flex:1 1 100%`↔`flex:100%`）、1 条真独有（`.doc-content table td` 的边框与内距，已并回同选择器规则并注明出处）。重复块收敛后 4570 → 4091 行，事故横幅删除；剩余同名规则逐对声明级比对，全是既有结构（HEAD 自带 4 处）或互补声明。

教训记进 memory：**带未提交改动的文件永不 `git checkout --`**；要回退先备份。

### 4. 账上的数

| 腿 | 数 |
|---|---|
| tsc / vite build | 退出码 0 / ✓（chunk 大小与 pdf-lib 动态导入两条提示为既有） |
| pptx 四腿 | selftest 54 对（42 命中 / 19 落空）· clean-pass · 等价 1/1 · `--mut no-ga` 自检 42 条断言全红 |
| pptx 覆盖 | 按对 **70.1%** / 按字面 **74.3%**（分母 77 对 / 222 字面，与 v0.140 逐字相同） |
| docx 四腿 + 普查腿 | selftest 46 对（26 命中 / 7 落空）· 等价 5/5 · 合成 701 对 **19.9% / 71.0%**（5 件全读成）· `--mut no-attrL` 18.2% / 63.3% · `--mut no-attr` 6.6% / 28.1%；普查 701 对 / 31,455 字面与探针腿分毫不差，账本文件与 HEAD 逐字节相同 |
| 性能（预热 + 6 趟中位） | docxToHtmlFidelity 450→375ms（−17%）· pptxBytesToDeck 376→124ms（−67%）· 2× 规模 1.6–1.7× |
| 往返（tmp 脚本） | 12 枚字段读→写→再读一致（v0.140 建的脚本，本轮回归） |

### 明确不做的（这一节）

- **出场动画时长仍不捕**：模型只有一枚入场时长槽（v0.140 裁过，维持）。
- **列/行数 > 6 的表格不给逐枚入口**：属性条放不下；模型读写不受影响。
- **pptx 真件语料仍不在盘**：这一账的 Universe 还是夹具（v0.140 同款欠账，`--corpus` 口子开着）。
- **push 仍没成功**：代理对 github.com:443 返 CONNECT 502（api.github.com 通、codeload 301、直连 443 超时），本地领先 origin/main 的提交继续攒着；网络一恢复 `git push origin main` 一条命令的事。


## 发行说明：v0.142 —— docx 读手长尾补齐：主题色 / 图案底纹 / 编号三族 23 对上账

一句立项：LO 对标评估的结论是「下一步顺着 fidelity-report 榜单从上往下补长尾属性」——这一节就是榜单头部裁下来的一轮：主题色 clrScheme 十一槽、shd 图案三件套、编号 lvlText/lvlJc/startOverride 三族，全部打通「读 → PM 模型 → 写」三层往返，覆盖率按对 19.9% → **23.3%**、按字面 71.0% → **73.1%**（合成语料 701 对分母不变，consulted 136 → 159 对）。裁决表（含有意不读与顺延清单）在 `docs/docx-fidelity-audit.md`。

### 1. 主题色族：clrScheme 十一槽 + tint/shade 算式

Word 的默认样式几乎从不写具名颜色，只写 `themeColor="accent1"` 一类引用——不解析 theme1.xml，整篇文档的色都掉回浏览器默认。这一轮补上：

- `readThemeColors` 解析 clrScheme 十一槽（dk1/lt1/dk2/lt2/accent1-6/hlink/folHlink），`srgbClr@val` 与 `sysClr@lastClr` 双分支都走 attrL 漏斗（宇宙里只有前者，后者由夹具覆盖）。
- `applyTintShade`：**先 shade 染深、后 tint 染淡**（Word 的顺序，反了整族色值都偏），两位十六进制当 0..1 系数；`themeRefCss` 按元素查槽，`w:color` / 边框四边 / `w:shd@w:themeFill`（槽名不同，传错整族静默丢失）共用一套。
- 算值实测：accent1 + shadeBF → `#335593`、+ tint80 → `#a2b9e2`。

### 2. 图案底纹族：val/color/fill 三件套往返

`w:shd` 的语义是「图案档位 + 前景 + 背景」三件套，此前只读背景一色：

- 条纹族（horz/vert/diagStripe、cross 族）用 `repeating-linear-gradient` **精确**渲染；pct 族用 conic 四象限棋盘，25/50/75 精确、其余密度近似并 warn。
- 往返载荷 `data-shade`（`图案|前景|背景`）经 cell-style / paragraph-style 扩展进 PM 模型；写手 `SHADING_TYPES` 小写键 → docx 包驼峰规范名，段与格都回写 `<w:shd w:val="pct25" w:color="ff0000" w:fill="ffffff"/>`。
- clear/无图案档逐字节回到 v0.142 之前的行为（只有背景一色）。

### 3. 编号族：lvlText / lvlJc / startOverride

- 自定义编号定义（`oof-list-N` reference）现在带 lvlText 符面与 lvlJc 对齐往返（lvlJc 屏上无对应物，center/right 落 `data-oo-marker-align` 只往返）；numFmt → ol type 查表小写归一。
- **起始号落层修复**：`w:num/w:lvlOverride/w:startOverride` 此前双重查找（`valNum` 把元素又当容器找子属性）永远读不到；修好后嵌套罗马数字串的 start=3 正确落在段落引用的那一层（`<w:lvl w:ilvl="1">…<w:start w:val="3"/>`）。

### 4. 量具自己抓到的两个缺陷（这一节的真正卖点）

- **读手侧功能坏**：`startOverride` 双重查找是夹具 selftest 的 MUST_SEE 断言当场抓红的——tmp 探针只验证了写手，读手这条单边通道「看着正常」。没有双向断言，这个 bug 会带着「已实现」的状态混过去。
- **语料侧覆盖坏**：`shd|color` 等三对夹具全过、普查腿却零上账。追因：语料按「单属性实例」设计，组合 shd 被拆散；且 push 按 open 合并，组合实例与几百个单属性实例挤进同一个 pPr，读手 `find(pPr,'w:shd')` 只取第一枚。修法（`b:ppr-shd` / `t:tcPr-shd` 专用段，前缀元素取 schema 序中位于 shd 之前的合法元素）让 shd 族 6 对全上账。教训：**「夹具绿 + 普查零」不是实现没写，先查语料形态能不能踩到那条路**。

### 5. 账上的数

| 腿 | 数 |
|---|---|
| tsc / vite build | 退出码 0 / ✓ |
| selftest | 夹具 71 对全上账；39 见全命中 / 7 不见全落空（双向） |
| docx 主腿（合成语料 5 件） | 分母 701 对 / 31,472 字面；按对 **23.3%**（+3.4pp）/ 按字面 **73.1%**（+2.1pp）；consulted 136 → **159** 对 |
| 等价腿 | 相同 5 / 不同 0 / 两边同错 0 / 只一边错 0 |
| 变异腿 | `--mut no-attrL` 21.4% / 65.3%（attrL 漏斗独有 17 对）；`--mut no-attr` 6.7% / 28.1%（attr 漏斗独有 122 对） |
| pptx selftest 干净腿 | 70.1% / 74.3%（本轮未动 pptx，与 v0.141 逐字相同） |
| 复位 | 变异腿后干净腿复跑，账本 md5 与主腿一致 |

### 明确不做的（这一节）

- **边框 space 族（~604 字面）顺延**：段/格边框与文字的间距，CSS 无对应层，按 v0.141 的 warn 先例下一轮先落 warn 再谈往返。
- **caps/smallCaps/iCs/bCs、pageBreakBefore/keepNext/keepLines/widowControl 顺延**：PM 模型无对应属性，需先定「往返但屏上不兑现」的档位；`ind|hangingChars` 还牵着一枚 MUST_NOT_SEE 断言要同步翻面。
- **lsdException/proofErr/rsid/VML/custGeom 一族判为有意不读**：2127 + 348 + 91 字面的冗余，与渲染无关。
- **push 仍没成功**：网络通了但非交互环境取不到 Windows 凭据（`fatal: User cancelled dialog` / `terminal prompts disabled`），本地领先 origin/main 的提交继续攒着（本轮后 22 个）；网络与凭据一恢复 `git push origin main` 一条命令的事。


## 发行说明：v0.143 —— docx 长尾第二轮：边框间距 / ind 字符档 / 复杂文字字形 / 分页四件套（13 对上账）

一句立项：v0.142 审计文档列了 D2 顺延清单，这一节照单开工——四族全部过「读 → 模型 → 写」三层往返，覆盖率按对 23.3% → **25.2%**、按字面 73.1% → **75.8%**（分母 701 对不变，consulted 159 → 172）。裁决与顺延清单见 `docs/docx-fidelity-audit.md` 的 v0.143 追加节。

### 1. 边框与文字的间距：w:space（528 字面，本轮最大单项）

`w:top/@w:space` 一族是「边框线离框内内容多远」（磅）。CSS 的 padding 正是 border 盒与内容盒的距离，语义同形——但段落与单元格的落点不同，因为**单元格已有 tcMar 竞争同一条 padding**：

- **段落**（pBdr）：没有「内边距」这一层，space 是唯一来源，ParagraphStyle 新增 `pad*` 四属性直接落 padding-{side}，读回从同一条 CSS 解析，无歧义。
- **单元格**（tcBorders）：tcMar 与 space 在 Word 里是**叠加**的，CSS 一条 padding 表达不了叠加——space 走独立 `data-bdspace-{side}` 载荷，渲染时与 pad* 相加输出一条 padding，回写时 space 归 `w:tcBorders/@w:space`、pad 归 `w:tcMar`，两边各得各的，往返无损。表级 tblBorders/insideH/insideV 的 space 不读（单元格共用边框，padding 会重复计数），between 边 warn。

### 2. ind 字符档：hangingChars 与 rightChars（39 字面）

Word「缩进」对话框「按字符」那一列写的就是这族（0.01 字符 = 字号的百分之一）。补齐后与既有 leftChars/firstLineChars 同一纪律：**缇值整枚没写才让字符档说话**。写手零改动——Chars 档经 PM 归一成 px，走既有的 indentOf 回写缇档（与 v0.141 的 leftChars 同设计）。夹具里 `ind|hangingChars` 从 MUST_NOT_SEE **翻面移入 MUST_SEE**（v0.142 审计文档点名要翻的一条）。

### 3. rPr 字形族：iCs / bCs / smallCaps（25 字面）

复杂文字（阿拉伯/希伯来/泰文）的粗斜与小型大写。iCs/bCs 搭 char-extra 的船只往返（CSS 没有「只对 cs 字族生效」的开关），smallCaps 屏上直接走 font-variant-caps（mark 自发 CSS，pos/kern 同款）。写手侧发现 docx 包的坑：**斜体那枚叫 `italicsComplexScript`（复数 italics）**——写单数 `italicComplexScript` TS 不报错、XML 静默不输出，是 tmp 往返脚本逐字段比对抓到的；另两枚 boldComplexScript/smallCaps 是常规拼写，且库里这两枚是「跟随 b/i 的三态」，必须显式传 true。

### 4. 分页四件套：pageBreakBefore / keepNext / keepLines / widowControl（53 字面）

段前分页、与下段同页、段内不分页、孤行控制。Web 流式排版没有分页，屏上不兑现——ParagraphStyle 四枚 data-* 布尔属性只保往返，三态 '1'/'0'/null（**widowControl 的「显式关」是真值**：Word 默认就是开，关掉必须带得回来）。样式层说的（w:style 里带 keepNext）经 effPPr 合并上账；paraFormatOf 折回 docx 包原生槽。

### 5. 账上的数

| 腿 | 数 |
|---|---|
| tsc / vite build | 退出码 0 / ✓（9.78s） |
| selftest | 夹具 91 对全上账；51 见全命中 / 5 不见全落空（双向） |
| docx 主腿（合成语料 5 件） | 分母 701 对 / 31,472 字面；按对 **25.2%**（v0.142：23.3%，+1.9pp）/ 按字面 **75.8%**（73.1%，+2.7pp）；consulted 159 → **172** 对 |
| 等价腿 | 相同 5 / 不同 0 / 两边同错 0 / 只一边错 0 |
| 变异腿 | `--mut no-attrL` 23.3% / 68.0%（attrL 漏斗独有 17 对）；`--mut no-attr` 7.6% / 30.5%（attr 漏斗独有 129 对） |
| pptx selftest 干净腿 | 70.1% / 74.3%（本轮未动 pptx，逐字相同） |
| 复位 | 变异腿后干净腿复跑，账本 md5 与主腿一致 |
| 往返（tmp 脚本） | 边框 space 段/格（含 tcMar 叠加与回写分工）、ind 字符档、iCs/bCs/smallCaps、分页四件套（含样式层与显式关）逐字段一致 |

### 明确不做的（这一节）

- **w:tab 制表位族（88 字面）顺延**：需新建 Tiptap tab 扩展 + 写手回写，单列一轮（D3 头名）。
- **docPr|descr（7 字面）顺延**：图形替代文本要改 PM Image 模型 + 写手库外槽（docx 包 ImageRun 没有 descr），收益不抵成本。
- **表级/条件层边框 space（76 字面）不读**：单元格共用边框，padding 近似会重复计数，已 warn 记账。
- **framePr/tblpPr 浮动定位族顺延**：需新模型槽。
- **push 仍没成功**：代理对 github.com:443 返 CONNECT 502，本地领先 origin/main 的提交继续攒着（本轮后 25 个）；网络一恢复 `git push origin main` 一条命令的事。


## 发行说明：v0.144 —— docx 长尾第三轮 D3：w:tab 制表位族（4 对上账）

一句立项：D2 顺延清单的头名——制表位族 88 字面（tab|pos 42 / tab|val 42 / tab|leader 4），外加 tblInd|type 读账。做完覆盖率按对 25.2% → **25.8%**、按字面 75.8% → **76.2%**（分母 701 对不变，consulted 172 → 176）。裁决与顺延清单见 `docs/docx-fidelity-audit.md` 的 v0.144 追加节。

### 1. w:tab 三枚：档位 / 缇 / 前导符

读手 `readTabsPayload` 遍历 `w:tabs/w:tab`：val 走 attr、pos 走 attrNum、leader 走 attr，三枚漏斗各记各的账。屏上不兑现的裁决同 v0.143 分页四件套——Word 制表位由 tab 字符驱动、按段落的档位表跳对齐，Web 流式排版没有这套机制。落点选 ParagraphStyle 一枚 `data-tabs` 字符串属性（载荷 `档位|缇|leader`，多条分号分隔）而不是新建 Tiptap 扩展：载荷是纯数据、没有 CSS 要画，扩展的 parse/render 链纯属绕路。写手 paraFormatOf 折回 docx 包原生 `tabStops`——`createTabStopItem` 不做单位换算，position 即缇，原样透传；leader 的 heavy 档不在包的 LeaderType 值域里，与库外槽同款断言绕过。

### 2. tblInd|type：读 + 记账

表缩进档位 dxa（默认，现状读的就是缇值）之外的 pct/nil/chars 三档没有 px 化出路（pct 的分母是版心、随栏宽变），warn 记账不假装。

### 3. 账上的数

| 腿 | 数 |
|---|---|
| tsc / vite build | 退出码 0 / ✓（11.15s） |
| selftest | 夹具 94 对全上账；54 见全命中 / 5 不见全落空（双向） |
| docx 主腿（合成语料 5 件） | 分母 701 对 / 31,472 字面；按对 **25.8%**（v0.143：25.2%，+0.6pp）/ 按字面 **76.2%**（75.8%，+0.4pp）；consulted 172 → **176** 对 |
| 等价腿 | 相同 5 / 不同 0 / 两边同错 0 / 只一边错 0 |
| 变异腿 | `--mut no-attrL` 23.9% / 68.5%（attrL 漏斗独有 17 对）；`--mut no-attr` 7.8% / 30.7%（attr 漏斗独有 132 对） |
| pptx selftest 干净腿 | 70.1% / 74.3%（本轮未动 pptx，逐字相同） |
| 复位 | 变异腿后干净腿复跑，账本 md5 与主腿一致 |
| 往返（tmp 脚本） | 制表位四档（left+dot / center / right+hyphen / decimal+middleDot / clear）逐字段一致 |

### 明确不做的（这一节）

- **表级/条件层边框 space（76 字面）继续顺延**：单元格共用边框，CSS 无对应物，已 warn 记账（连续三轮的账）。
- **docPr|descr（7 字面）继续顺延**：需改 PM Image 模型 + 写手库外槽（docx 包 ImageRun 没有 descr）。
- **framePr/tblpPr 浮动定位族（23 字面）继续顺延**：需新模型槽。
- **multiLevelType / lvlPicBulletId / lvlRestart（合计 11 字面）顺延**：编号定义的深层属性，编号定义整体不进 PM，需另设通道。
- **push 仍没成功**：非交互环境取不到 Windows 凭据（`terminal prompts disabled`），本地领先 origin/main 的提交继续攒着（本轮后 27 个）；凭据恢复后 `git push origin main` 一条命令的事。


## 发行说明：v0.145 —— docx 长尾第四轮 D4：替代文本 / 浮动框架 / 表格浮动（24 对上账）

一句立项：D3 顺延清单整包——descr 族 13 字面 + framePr 12 + tblpPr 9 + multiLevelType 读账，**三族全部走 docx 包原生槽**（altText/floating/frame），覆盖率按对 25.8% → **29.3%**（+3.5pp，长尾轮最大涨幅）、按字面 76.2% → **76.4%**（分母 701 对不变，consulted 176 → 200）。裁决与顺延清单见 `docs/docx-fidelity-audit.md` 的 v0.145 追加节。

### 1. 替代文本 descr：docPr 画布级 + cNvPr 图形级

Word 语义里 `descr` 才是替代文本（读屏软件念的那段），`name` 只是对象名——此前 alt 装的一直是 name。读手 bitmap 出口改为 descr 优先、name 兜底（老文件观感不回退），写手 ImageRun `altText.description` ← PM alt。docx 包的 `NonVisualProperties` 固定 `descr:''`——写侧只走 docPr 单边承载，cNvPr@descr 的往返有单边缺口（包的限制，记账）。

### 2. framePr / tblpPr：纸面定位族，屏上不兑现

段落浮动框架与表格浮动都是「页相对定位」，Web 流式排版没有页这一层——与 v0.143 分页四件套同款纪律：`data-frame` / `data-tblp` 载荷只往返。写手两族都走包原生槽：paraFormatOf → `frame`（alignment 形态优先于 absolute，Word 语义里 x 与 xAlign 互斥）；Table → `float`（ITableFloatOptions 键名一一对应，overlap 落 `w:tblOverlap` 子元素）。

### 3. multiLevelType：读 + 记账

编号定义的身份属性（hybridMultilevel 等）描述「这份定义是否设计成多级联动」，而模型把编号定义塌成逐段档位（ListRegistry 按段引用重建），身份带不回来——读入 + warn，不假装。

### 4. 账上的数

| 腿 | 数 |
|---|---|
| tsc / vite build | 退出码 0 / ✓（63s） |
| selftest | 夹具 78 对全上账；73 见全命中 / 5 不见全落空（双向） |
| docx 主腿（合成语料 5 件） | 分母 701 对 / 31,472 字面；按对 **29.3%**（v0.144：25.8%，+3.5pp）/ 按字面 **76.4%**（76.2%，+0.2pp）；consulted 176 → **200** 对 |
| 等价腿 | 相同 5 / 不同 0 / 两边同错 0 / 只一边错 0 |
| 变异腿 | `--mut no-attrL` 27.0% / 68.6%（attrL 漏斗独有 21 对）；`--mut no-attr` 10.0% / 30.8%（attr 漏斗独有 143 对） |
| pptx selftest 干净腿 | 70.1% / 74.3%（本轮未动 pptx，逐字相同） |
| 复位 | 变异腿后干净腿复跑，账本 md5 与主腿一致 |
| 往返（tmp 脚本） | descr 三变体（docPr/cNvPr/回落 name）、framePr 两形态 + 脏数据取舍、tblpPr 十枚逐字段一致 |

### 明确不做的（这一节）

- **表级/条件层边框 space（76 字面）继续顺延**：单元格共用边框，CSS 无对应物，已 warn 记账（连续四轮的账）。
- **cNvPr@descr 写侧单边缺口不补**：docx 包 NonVisualProperties 固定 descr:''，要补得动写后 XML（ImportedXmlComponent 后处理），收益不抵成本。
- **framePr/tblpPr 屏上不兑现**：页相对定位在 Web 里没有对应物，强行 absolute 会脱离文档流造成错位——只保往返是更诚实的近似。
- **lvlPicBulletId / lvlRestart（2 字面）顺延**：编号深层属性，与 multiLevelType 同因。
- **push 仍没成功**：非交互环境取不到 Windows 凭据（`terminal prompts disabled`），本地领先 origin/main 的提交继续攒着（本轮后 29 个）；凭据恢复后 `git push origin main` 一条命令的事。


## 发行说明：v0.146 —— docx 长尾第五轮 D5：潜在样式族 / 书签 / 样式元数据（22 对上账）

一句立项：按字面权重扫剩余 neverConsulted——潜在样式族 2,133 字面（latentStyles 容器六属性 + lsdException 六属性）打头，带书签三对 99、样式元数据三枚 82、表级边框 space 76（insideH/insideV）、lang@bidi 67、字符缩放 40，合计 22 对 2,497 字面。覆盖率按对 29.3% → **32.6%**（+3.3pp）、按字面 76.4% → **86.9%**（+10.5pp，冲进 85+ 区；分母 701 对不变，consulted 200 → 222）。裁决与顺延清单见 `docs/docx-fidelity-audit.md` 的 v0.146 追加节。

### 1. 潜在样式族：Word 样式库门面账，走后置补丁回写

`w:latentStyles`（容器六属性）+ 全部 `w:lsdException`（六属性）描述「Word 样式库里哪些内建样式露面、排第几档」，与正文排版无关——读成结构化数据随 meta 走，导出时 `patchStylesXml` 补丁插回 `</w:docDefaults>` 后、首个 `<w:style ` 前（Word 的 schema 序）。onOff 三态分得开「显式 0 关」与「没写」。docx 包连 latentStyles 的概念都没有，补丁是先例 v0.143 `patchTblLook` 的同一手法（Packer 出包后解压 zip 改 XML 重压）。

### 2. 书签：跨段续挂 + 空区间记账

新建 `bookmark-extension.ts`（Bookmark Mark，`span[data-oo-bookmark]`，`inclusive:false`）。读手 bookmarkStart/End 改开合区间，与批注同一骨架（`wrapRange`）；跨段书签每段各包一枚同名 span（PM mark 不跨块）；空书签（起终点相邻）PM 无处安放，往返丢失——记账内的已知边界。写手 `inlineToChildren` 预扫同名 mark 首到尾分组，包 `Bookmark` 原生发射（w:id 自动重排、w:name 承载锚点名）。

### 3. 样式元数据 + lang@bidi + 字符缩放 + 表级 space

- **样式元数据三枚**：`uiPriority`/`link` 是 `w:style` 子元素、`customStyle` 长在 `w:style` 自己身上。前两个包原生发射；customStyle 包里**静默丢弃**（`StyleForParagraph` 只传 `{type, styleId}` 给 StyleAttributes——探针实测），走补丁上开标签。读手 customStyle 先于 styleId 闸读（语料有裸 `<w:style w:customStyle="0"/>`）。
- **lang@bidi**（67）：`w:lang/@w:bidi` 只管 cs 字族，与 val/eastAsia 同住 `w:lang`；写手 `extra.language.bidirectional` 原生槽。
- **字符缩放**（40）：`w:w/@w:val` 百分比，元素名叫 `w`——探针键 `w|val`；写手 `extra.scale` 原生槽。
- **表级边框 space**（76）：六边按「落到哪枚格边」分摊（外层四边贴外圈格、insideH/insideV 贴相邻两格），仅当该边边框真回落到表级时才挂；回写走格级 `tcBorders/@w:space`（磅）。Word 对该族两侧语义未经门面实测，数据往返不受影响。

### 4. 账上的数

| 腿 | 数 |
|---|---|
| tsc / vite build | 退出码 0 / ✓ |
| selftest | MUST_SEE **100 枚全命中**（新增 22 枚）/ MUST_NOT_SEE 5 枚全落空（双向）；夹具查问对 164 |
| docx 主腿（合成语料 5 件） | 分母 701 对 / 31,472 字面；按对 **32.6%**（v0.145：29.3%，+3.3pp）/ 按字面 **86.9%**（76.4%，+10.5pp）；consulted 200 → **222** 对 |
| 等价腿 | 相同 5 / 不同 0 / 两边同错 0 / 只一边错 0 |
| 变异腿 | `--mut no-attrL` 30.2% / 79.1%；`--mut no-attr` 10.7% / 33.5% |
| pptx selftest 干净腿 | 70.1% / 74.3%（读手未动，账本只动模块数 57→58） |
| 复位 | 变异腿后干净腿复跑，账本 md5 与主腿一致 |
| 往返（tmp 脚本） | 六族读写双向：latentStyles 七值 + lsdException 两形态、书签三形态（单段/跨段两枚/空区间）、lang 三枚 + w:w、样式元数据三枚、表级 space 六边分摊逐格一致 |

### 明确不做的（这一节）

- **`t|space`（348 字面）继续裁定不查**：escText 无条件保空白，强于 preserve 所需——查了没有第二行代码可写（v0.143 起的旧裁定，本轮重申）。
- **图形几何族顺延**（`pt|xy`/`gd|fmla,name`/`schemeClr|val`/`cxn|ang`/`pos|xy`/`ext|xy`/`off|xy`，约 1,228 字面）：需形状模型（preset geometry + 渐变 + 连接点），长尾里最大的一坨，单开一轮。
- **编号三档 + snapToGrid 顺延**（adjustRightInd 48 / lvl|tentative 37 / lvl|tplc 29 / snapToGrid 36）：包无档位槽，要库外拼装，收益不抵。
- **docPr|cNvPr 的 id/name 写侧不补**（32/26/26）：id 包自动分配，name 可补但读屏语义薄。
- **空书签往返丢失是已知边界**：起终点相邻的区间在 PM 里无处安放（mark 总得包住点内容）。
- **push 仍没成功**：非交互环境取不到 Windows 凭据（`terminal prompts disabled`），本地领先 origin/main 的提交继续攒着（本轮后 32 个）；凭据恢复后 `git push origin main` 一条命令的事。


## 发行说明：v0.147 —— docx 长尾第六轮 D6：段落属性余量 / 节属性迁读手 / 表闸门（24 对上账）

一句立项：按字面权重扫剩余 neverConsulted，图形几何族需形状模型继续顺延，取余下能做的三族——段落属性余量 163 字面（adjustRightInd / snapToGrid / textAlignment / topLinePunct / bidi / autoSpaceDE / autoSpaceDN / suppressLineNumbers）、自动段距 28、表闸门 21、节属性 42，合计 **24 对 254 字面**。覆盖率按对 32.6% → **36.1%**（+3.5pp）、按字面 86.9% → **87.9%**（+1.0pp；分母 701 对不变，consulted 222 → 246）。

### 这一轮做了什么

- **段落属性余量（九枚）**：`w:pPr` 里那批「说了也不改屏上排版」的直接属性（编号右边缩进跟随、对齐文档网格、首尾标点压缩、段落从右往左、中西文/数字自动间距、本段不编号、行内文字上下对齐）收成 `data-ppr` 载荷往返；`w:spacing` 上的两枚自动段距同路。包里这一族只有一个槽（还把 onOff 写成裸元素、带不出 `w:val` 的「显式关」），故九枚全部走**打包后补丁**：造段落时同步登记余量（顺序即 `<w:p>` 出现序），出包后按 **CT_PPrBase 的 schema 位次**插回各自的 `<w:pPr>`（`<w:snapToGrid>` 落在 `<w:spacing>` 前、`<w:textAlignment>` 落在它后）。**计数闸门**：`<w:p>` 枚数与登记条数对不上就整笔放弃——宁可不补，也绝不补到别的段落上。
- **节属性迁进读手**：`w:pgSz/w:pgMar/w:cols/w:docGrid` 原先由 `docxToDocMeta` 用**正则**读——读是读了，但正则不进 attr 漏斗，保真账本上是盲区（「账上没有」的那类缺口）。现在读手 `sectionOf` 走 attr 读一遍、随 `DocxImport.section` 出来折成 `PageSetup` 并入 meta，同一份数只有一个读数出处。连带把 **装订线 / 页眉页脚距纸边 / 文档网格 / 纸张方向**补进页面设置与写手（都是包的原生槽）。
- **表闸门原文（`w:tblLook` 三枚）**：它既在表样式的 `w:tblPr` 里、也在表自己的 `w:tblPr` 里——语料承放在**表自己**那一处，只读样式那枚的话三对会凭空掉出分子。两处都读：样式那一枚照抄优先（没有才由条件层反推），表自己那一枚进 `data-tlook`，写侧后者压过前者。

### 门禁数字

| 项 | 结果 |
|---|---|
| tsc / build | 0 错 / 通过 |
| selftest 双向 | MUST_SEE **124 枚全命中**（新增 24），MUST_NOT_SEE 1 枚（`t\|space`）全落空 |
| 干净腿（合成语料） | 按对 **36.1%** / 按字面 **87.9%**（consulted 246 对） |
| 等价腿 | 相同 5 / 不同 0 / 只一边错 0 |
| 变异腿有牙 | `--mut no-attrL` 33.7%/80.2%、`--mut no-attr` 11.9%/33.7% |
| 变异后复位 | 干净腿 md5 与主腿逐字节一致 |
| pptx | 按对 70.1% / 按字面 74.3% 不动 |

### 明确不做的（这一节）

- **`t\|space`（348 字面）继续裁定不查**：escText 无条件保空白，强于 preserve 所需（v0.143 起的旧裁定）。
- **图形几何族继续顺延**（`pt\|xy` / `gd\|fmla,name` / `schemeClr\|val` / `cxn\|ang` / `pos\|xy` / `ext\|xy` / `off\|xy` / `prstGeom` / `effectExtent` …，约 1,700 字面）：需形状模型，长尾里最大的一坨。
- **`proofErr\|type`（64）顺延**：它是位置标记而不是区间包壳，PM 侧要新找承载点。
- **编号档位 `lvl\|tentative` / `lvl\|tplc`（37/29）顺延**：包无槽，需 numbering.xml 补丁。
- **docPr/cNvPr 的 id/name（32/26/26）顺延**：id 由包自动分配，name 收益薄。
- **页边距往返经 mm 折一道**（缇 → mm 一位小数 → 缇）有 0.05mm 级误差，`pageSetupOf` 与旧正则腿同口径同源，非本轮引入。
## 发行说明：v0.148 —— docx 长尾第七轮 D7：图片容器壳（26 对上账）

上一轮把「图片容器族」列为图形几何族里最划算的一块（可骑在现有 img 节点上、不需要完整形状模型），本轮兑现。

**一张位图在 OOXML 里不是「一个 `<img>`」而是三层壳**，除位图字节与尺寸外的属性屏上一条都不兑现（Web 流式排版没有文字环绕、没有对象名、图片框恒矩形），但换编辑器打开时它们决定图贴在哪个锚上：

| 族 | 上账 |
|---|---|
| 画布四边避让（`wp:inline`/`wp:anchor` 的 distT/B/L/R） | 8 对 84 字面 |
| 溢出区（`wp:effectExtent` 四边） | 4 对 84 字面 |
| 对象序号与对象名（`wp:docPr@id`、`pic:cNvPr@id/name`） | 3 对 84 字面 |
| 两枚锁（`graphicFrameLocks` / `picLocks` 的 noChangeAspect） | 2 对 34 字面 |
| 图形框档位（`a:prstGeom@prst`） | 1 对 24 字面 |
| 图形框自身尺寸（`a:xfrm` 的 `a:off`/`a:ext`） | 4 对 112 字面 |
| 浮动锚点（`simplePos`、`positionH/V`） | 4 对 28 字面（**只读不写**） |

- **读手**：`readImgPayload` 把整层壳收成 `data-img` 载荷挂在 `<img>` 上（EMU 档存整数原值，onOff 档存 1/0）；各层走 `findDesc` 深搜（一个 `w:drawing` 里同名元素各只有一枚），只有 `a:off`/`a:ext` 限定在 `a:xfrm` 内取——它们与 `wp:extent` 不是同一枚元素
- **写手**：`patchImgXml` 按 `<w:drawing>` 出现序逐块**改值**。实测包把三层壳一个不缺地发出来了（`<wp:inline dist*=0>`、`effectExtent` 四边 0、两枚 locks 恒 1、`pic:cNvPr name=""`），**只是值全部硬编码**，所以这一族比上一轮的段落余量简单一档——不必算 schema 位次、不必插结点。计数闸门同款（块数与登记条数对不上整笔放弃）
- **顺带修掉一个真 bug**：包把 `pic:cNvPr` 的 `name` 写成空串（v0.145 只把替代文本喂给了 `wp:docPr`），换编辑器打开时对象名丢了——现在随 `cNvPrName` 补回来

**明确不做**：浮动锚点四枚（`wp:simplePos`/`positionH`/`positionV`）只读不写——写侧只发内嵌图，包没有 `wp:anchor` 的槽，那一层壳出不来（与「空书签往返丢失」同款，记在账上）；图形几何族（pt/gd/schemeClr/cxn/pos）仍需形状模型，继续顺延。

| 门禁 | 结果 |
|---|---|
| 覆盖率（合成语料） | 按对 36.1% → **39.9%**、按字面 87.9% → **89.8%**（consulted 246 → 272 对） |
| selftest 双向 | MUST_SEE **146 枚全命中**（新增 22）、MUST_NOT_SEE 1 枚全落空 |
| 等价腿 | 5/5 逐字节相同 |
| 变异腿 | no-attrL 37.2%/81.9%、no-attr 14.5%/35.0% |
| 变异后复位 | md5 与主腿一致 |
| pptx | 70.1% / 74.3% 不动 |
| 语料分母 | 只增 1 字面（新上下文的骨架一律不带属性，唯一例外是链上必需的 `a:blip r:embed`） |

### v0.149（D8）——VML 图片壳 / 浮动锚点闸门 / 两枚可写壳属性

兑现上一轮标出的「VML 图片壳」：`w:pict` 那一支同样能骑在 img 节点上。**23 对上账、180 字面**，
覆盖率 **按对 39.9% → 43.3%、按字面 89.8% → 90.6%**；consulted 272 → 295 对。

| 族 | 字面 | 往返 |
|---|---|---|
| `v:shape` 壳属性（id / spid / spt / type / coordsize / filled / stroked） | 57 | 只读 |
| `wp:anchor` 六枚闸门（allowOverlap / behindDoc / layoutInCell / locked / relativeHeight / simplePos） | 36 | 只读 |
| `o:lock` 两枚（aspectratio / ext） | 24 | 只读 |
| `v:fill` 两枚（on / focussize） | 21 | 只读 |
| `v:stroke` 三枚（on / joinstyle / weight） | 18 | 只读 |
| `v:imagedata` 的 title | 11 | 只读 |
| `a:picLocks` 的箭头锁、`pic:spPr` 的黑白模式档位 | 13 | **读写** |

- **共用一枚载荷**：VML 壳与 DrawingML 壳都挂在 `data-img` 上，靠键名分族——读手的
  `bitmap()` 短路链本来就认 `v:imagedata`，`w:pict` 那一支一张多余代码都不用加就在链上了。
- **只读不写的 21 对**：写侧只发 DrawingML 内嵌图，包没有 `w:pict` / `wp:anchor` 的槽，
  读得回写不出（与上一轮的浮动锚点定位同款边界，已在账上标明）。
- **明确不做**：`shape|gfxdata`（7 字面）裁定不收——Word 缓存的图元字节（base64），
  能有几 KB，挂进 HTML 属性性价比极差，且写侧根本写不回去（与 `t|space` 同款裁定）。

**门禁**：tsc 0、build ✓；selftest MUST_SEE **169 枚全命中（新增 23）** / MUST_NOT_SEE 1 枚全落空；
等价腿 5/5；变异腿有牙（no-attrL 38.4%/82.1%、no-attr 16.7%/35.6%）；变异后干净腿复位 md5 与
主腿一致；pptx 70.1% / 74.3% 不动。语料分母 31,473 → 31,470。

**过程中的坑**：①又踩一次「语料段内没有 blip」的短路（`v:fill` / `v:stroke` 上下文段里没有
`v:imagedata`，`bitmap()` 第一步返回 null，五枚 39 字面凭空掉零）——修法是挪到自带 imagedata
的 `v:main`，而不是补一枚 imagedata（那会给 `imagedata|id` 的分母多算一份）；②`spPr` 会套两层
（`pic:spPr` 里再嵌一枚 `a:spPr`），7 枚 `bwMode` 有 6 枚在嵌套层，`findDesc` 只取第一枚会掉，
改走 `allDesc` 全查。

- **push 仍没成功**：非交互环境取不到 Windows 凭据（`terminal prompts disabled`），本地领先 origin/main 的提交继续攒着（本轮后 45 个）；凭据恢复后 `git push origin main` 一条命令的事。


### v0.150（D9）——编号定义账 / 样式身份 / VML 形状余量与图元几何

按字面权重扫剩余 neverConsulted 的**大块与低成本族**：**40 对上账、1,319 字面**，覆盖率
**按对 43.3% → 49.1%、按字面 90.6% → 96.2%**；consulted 295 → 335 对，neverConsulted 387 → 347。

| 族 | 字面 | 往返 |
|---|---|---|
| VML 图元几何（`v:pt` x/y、`v:gd` fmla/name、`v:cxn` ang、`v:pos` x/y、`v:path` w/h） | 977 | 只读 |
| `w:proofErr` 的 type（拼写/语法检查标记） | 64 | 只读 |
| `w:lvl` 的 tentative / tplc | 66 | **读写** |
| `w:style` 的 rsid | 27 | **读写** |
| `w:style` 的 next（后续段落样式） | 9 | **读写** |
| `nsid` / `tmpl` / `multiLevelType`（编号定义身份） | 27 | **读写** |
| `w:lvl/w:suff` | 4 | **读写** |
| VML 形状余量（shape 的 path/fillcolor、`o:useLocalDpi`、`o:attr` 一对） | 19 | 只读 |
| `v:group` 五枚（id / spid / coordorigin / coordsize / style） | 14 | 只读 |
| DrawingML 零星（`a:blip` cstate、`a:ext` uri、`wp:inline` anchorId/editId、`a:lumMod`、`a:ln` w） | 24 | cstate 读写、余只读 |
| 表边框 `insideH/insideV` 的 themeColor 一族 | 8 | 只读 |
| 文档级标记（`document|Ignorable`、`Choice|Requires`） | 9 | 只读 |

- **顺手修一个真 bug**：`w:multiLevelType` 是一枚**子元素**（`<w:multiLevelType w:val>`），
  v0.145 起读手写的却是 `attr(a,'w:multiLevelType')`——在 `w:abstractNum` 身上查一枚不存在
  的属性，那 9 个字面从来没进过分子。同轮补上定义身份（nsid/tmpl）与层属性
  （tentative/tplc/suff），按 `w:abstractNum` 出现序汇成 `DocxNumbering` 随 meta 走。
- **编号账怎么贴回去**：包的 numId/abstractNumId 是自己发的（与原文未必同号），所以
  `patchNumberingXml` 按**层内容指纹**（`numFmt|lvlText` 序列的前缀）在包里认「原文那一条」，
  认不出来就不贴（宁缺毋滥）。前缀一律不认——包把 tentative 写成 `w15:tentative`，
  照全名匹配会补出第二枚。
- **图元几何只记「枚数 + 首枚值」**：一条 `v:path` 上几十上百枚 `v:pt` 是常事，全挂会把
  HTML 撑爆；枚数说明这个族在这里出现了，首枚值说明它长什么样。**只读不写**——写侧只发
  DrawingML 内嵌图，`w:pict` 那一支出不来（与 VML 壳同一条边界）。
- **样式身份两枚可写**：`patchStylesXml` 扩成按 styleId 的三笔（custom/next/rsid），
  next 与 rsid 按 CT_Style 的 schema 序插（乱序写会被 Word 判损坏件）。
- **themeRefCss 把「按名查问」与「解析」解耦**：此前没带 theme1.xml 的件在这函数里
  `if (!theme) return` 就出了门，`insideH/insideV` 的 themeColor 一族一直挂在
  neverConsulted 里——查问与解析是两件事，前者是账本的分子。
- **明确不做**：`t|space`（348）继续裁定不收（escText 无条件保留空白，强于 preserve
  所需）；`shape|gfxdata`（7）base64 图元字节不收；`proofErr`/`Choice`/`Ignorable`
  三族**只读记账**——PM 没有「这里有个拼写错误」这种承载点，读手查问上账、写侧不写。

**门禁**：tsc 0、build ✓；selftest MUST_SEE **206 枚全命中（新增 37）** / MUST_NOT_SEE 1 枚全落空；
等价腿 5/5；变异腿有牙（no-attrL 40.6%/83.0%、no-attr 20.4%/40.3%）；变异后干净腿复位 md5 与
主腿一致；语料分母 31,470 → 31,468。

**过程中的坑**：①`pt`/`path` 两族原承放在 `v:path` 上下文——那段（`<w:shape><v:path>`）里没有
`v:imagedata`，`bitmap()` 在短路链第一步就返回 null，六百多字面凭空掉零（**第三度**踩「语料段内
没有 blip/imagedata」，前两次是 v0.148 的 `d:inline` 与 v0.149 的 `v:fill`/`v:stroke`）；修法仍是
挪进自带 imagedata 的 `v:main`。②编号补丁第一版按「第 N 个 abstractNum 接第 N 条 def」——包恒发
三枚定义（两个内置 + 自定义），枚数从不等，整笔放弃；改指纹匹配后单层自定义列表立刻命中。
③`v:group` 承放在 `v:group` 上下文，那段也没有 imagedata——一并挪到 `v:pict`（其 close 自带一枚）。

### v0.151（D10）——形状壳查问 / `w:position` 读名修正 / 图片壳零头

按字面权重扫剩余 neverConsulted：**36 对上账、语料字面 177（宇宙字面约 1.75 万）**，覆盖率
**按对 49.1% → 54.4%、按字面 96.2% → 96.9%**；consulted 335 → 371 对，neverConsulted 347 → 311。

| 族 | 语料字面 | 往返 |
|---|---|---|
| `a:schemeClr` 的 val（主题色槽位名，宇宙 7668——最大单对） | 82 | 只读 |
| `a:bodyPr` 一族 19 枚（文本框文本盒属性） | 43 | 只读 |
| `a:lnRef`/`a:fillRef`/`a:effectRef`/`a:fontRef` 的 idx（样式矩阵引用） | 16 | 只读 |
| `v:rect` 四边（textbox 老式件文字盒） | 12 | 只读 |
| `a:lumOff` val、`a:miter` lim、`v:stroke` color/miterlimit、`v:path` 连接几何 | 12 | 只读 |
| `w:position`（rPr 基线升降，读名修正） | 3 | **读写** |
| `wps:cNvSpPr` 的 txBox | 2 | 只读 |

- **本轮最大单对是个「查了白查」**：`a:schemeClr` 的 val 在宇宙里有 7668 次（fill/line/
  effect 三处都长这样），但读手从没按名查问过它——屏上不兑现（Web 没有主题色概念），
  写侧也写不出（包不发 schemeClr），**只读记账**。图片段那枚由 `readImgPayload` 收，
  文本框段那枚由 `noteShapeMarks` 收（两处都查问，同对只记一次）。
- **`w:position` 读名修正——又一处「漏斗被调用、名字是错的」**：读手从 v0.142 起读
  `w:pos`，而 CT_RPr 里**没有这枚元素**——Word 与 docx 库发的都是 `w:position`
  （ST_SignedTwipsPerMil）。后果不是「少赚 338 字面」：屏上的 vertical-align 升降
  **对真实件一次都没生效过**（读不回自己写的那一枚），而夹具里放的恰是 `w:pos`、
  MUST_SEE 断言的是 `pos|val`——夹具与读手在错误的名字上互锁自证，selftest 一路全绿。
  与 v0.150 的 `multiLevelType` 同款病，病根同源：**探针证明「漏斗被调用」，
  证明不了「查的名字在宇宙里」**——后者靠夹具形态与真实件对账。
- **形状壳（wsp）第四形态的同款坑**：文本框的**内容**由 `drawing()` 展平成段落，
  壳本身不在任何读手路径上，且 wsp 段内通常没有 `a:blip`——图片短路链第一步就断
  （v0.148 的 `d:inline`、v0.149 的 `v:fill`/`v:stroke`、v0.150 的 `v:path` 之后
  **第四度**踩「语料段内没有 blip/imagedata」）。修法仍是**不动短路链**：新增
  `noteShapeMarks`，跑正文前对整树按名查问一遍（与 `noteDocumentMarks` 同款只读记账）。
- **明确不做**：`caps|val`（1102）/`noWrap|val`（1323）/`bdr` 一族（692）留 D11——
  三族都要 rPr/tcPr 的 post-pack 补丁（包里没槽），单开一轮做得完；`t|space`、
  `shape|gfxdata` 维持裁定不收。

**门禁**：tsc 0、build ✓；selftest MUST_SEE **241 枚全命中（净增 35：+36 新对 −1 错名
`pos|val`）** / MUST_NOT_SEE 1 枚全落空；等价腿 5/5；变异腿有牙（no-attrL 40.8%/83.1%、
no-attr 25.5%/41.0%）；变异后干净腿复位 md5 与主腿一致；语料分母不变（31,468——本轮
新族的承放上下文早先各轮已开好，一枚不用加）。

### v0.152（D11）——字符/单元格/编号/节级读写族 + DrawingML 色彩零头

按字面权重扫剩余 neverConsulted 的**补丁族专题**：**25 对上账、语料字面 66（宇宙字面
6,199）**，覆盖率**按对 54.4% → 58.1%、按字面 96.9% → 97.2%**；consulted 371 → 396 对，
neverConsulted 311 → 286。

| 族 | 语料字面 | 往返 |
|---|---|---|
| `w:caps` + `w:bdr` 四枚（全大写与字符边框） | 19 | **读写**（原生槽） |
| `w:tcPr/w:noWrap`（单元格不换行） | 13 | **读写**（patchTcPr） |
| `w:abstractNum/@restartNumberingAfterBreak` | 4 | **读写**（保前缀补丁） |
| `w:tblStyleColBandSize`/`w:tblStyleRowBandSize`（表级条件格式尺寸） | 4 | **读写**（补丁） |
| `w:docGrid/@w:charSpace`（每字符网格宽度） | 2 | **读写**（原生槽） |
| headerReference/footerReference 的 id/type | 8 | 只读 |
| `w:num/@w:durableId` + styles/numbering 根 `mc:Ignorable` | 3 | 只读 |
| `w:hyperlink/@w:history` | 3 | 只读 |
| `a:ln` cap/cmpd、`a:shade` val、`a:gs` pos、`a:lum` bright/contrast | 9 | 只读 |
| `w:num/w:lvlOverride/w:startOverride`（语料结构修正） | 1 | **读写**（v0.142 起） |

- **caps/bdr 是两枚「类型面全暴露」的原生槽**（`IRunOptions.allCaps` 与
  `IRunOptions.border`）——包里实现着、类型也写着，与 ics/bcs/smallCaps 那批「实现着
  但类型没暴露」的库外槽不同，这次走的是正规军。caps 屏上兑现 `text-transform:
  uppercase`，bdr 屏上兑现 CSS border（sz 是八分之一磅、space 是磅，两枚都要换算；
  space 收 0——显式 0 与缺省同结果，但源件写了就原样往返）。
- **noWrap 与 bandSize 走 post-pack**：包里两族都没槽。`patchTcPr` 按 `<w:tc>` 出现序插
  `<w:noWrap/>`（计数闸门同 pprExtras）；两枚 bandSize 与 tblLook 同住 tblPr、扩了
  `patchTblLook` 一次解压/重压办三族。
- **`restartNumberingAfterBreak` 是一枚 w15 扩展属性**：OOXML 里它定义在 w15 命名空间
  （CT_AbstractNum 的扩展属性），Word 与 docx 库发的都是 `w15:` 前缀——读手按 **local
  name** 收（w:/w15: 两种形态都认），写手**保留原前缀**换值（照 w: 全名替换会写出一枚
  不在 schema 上的属性，判损坏件风险）。探针第一版断言写成子元素形态，被包的真实输出
  纠正——这枚属性包里对所有定义恒发。
- **语料结构修正一对**：`startOverride|val` 从 v0.142 起读手就写着
  （`w:num/w:lvlOverride/w:startOverride`），但语料把它与 lvlOverride **平级**摆——
  读手在 lvlOverride 里找它，平级那枚永远找不到，86 字面一直挂 NC。挪进正确的嵌套
  上下文（`n:lvloverride-kids`，w:num 里带 abstractNumId 让读手那道闸够得着）后直接
  上账，读手代码一行没动。
- **明确不做**：`instrText|space`（1524）与 `t|space` 同款域指令噪声，倾向裁定不收；
  VML 形状壳全族余量（roundrect/textbox/group/path 一族约 2,000 字面）留 D12——纯只读
  记账、机械但量大，单开一轮。

**门禁**：tsc 0、build ✓；selftest MUST_SEE **265 枚全命中（+24）** / MUST_NOT_SEE 1 枚
全落空；等价腿 5/5；变异腿有牙（no-attrL 42.8%/83.3%、no-attr 27.1%/41.1%）；变异后干净腿
复位 md5 与主腿一致；语料分母 31,468 → 31,471（+3：新开的 lvlOverride 嵌套上下文块）。

### v0.153（D12）——VML 形状壳余量全族 + 裁剪四边落到 CSS

按字面权重扫剩余 neverConsulted 的**老式形状专题**（v0.152 顺延清单里点名的那一族）：
**132 对上账、语料字面 137（宇宙字面 5,044）**，覆盖率**按对 58.1% → 77.4%、按字面
97.2% → 97.8%**；consulted 396 → 528 对，neverConsulted 286 → 154。

| 族 | 宇宙字面 | 往返 |
|---|---|---|
| `v:roundrect` 十二枚（圆角矩形：arcsize/coordsize/填充描边/身份） | 1,063 | 只读 |
| `v:line` 十四枚（直线：from/to 两端点、allowincell） | 654 | 只读 |
| `v:rect` 十一枚（矩形：v0.151 已收四边，补余量） | 620 | 只读 |
| `v:shape` 十枚（adj/alt/bullet/connectortype/coordorigin/ole 等） | 444 | 只读 |
| `v:shadow` 十三枚（VML 阴影：dir/dist/kx/sx/algn 等） | 263 | 只读 |
| `v:fill` 十二枚（type/color2/colors/recolor/rotate 等） | 227 | 只读 |
| `v:shapetype` 十枚（形状模板：oned/preferrelative/path） | 174 | 只读 |
| `w10:wrap` 四枚（遗留环绕锚点与边） | 161 | 只读 |
| `v:path` 六枚（五个变换开关与 connecttype） | 296 | 只读 |
| `v:stroke` 四枚（dashstyle/endarrow/endcap/startarrow） | 60 | 只读 |
| `v:group` 三枚（editas/spt/anchorId） | 214 | 只读 |
| 画布与手柄余量（chExt/chOff/h/f/rot/hiddenLine/lock/cxnSpLocks/textbox 十六枚） | 802 | 只读 |
| 渐变取景框（fillRect/fillToRect/lin 八枚） | 47 | 只读 |
| **v:imagedata 裁剪四边** | 8 | **读写（读侧渲染）** |
| `w:object`/`o:OLEObject` 五枚（原始尺寸与三个身份号） | 11 | 只读 |

- **只有裁剪四边落到了屏上**：VML 的 `croptop/cropright/cropbottom/cropleft` 是
  ST_Fraction（0..1 的小数，Word 也发 `"5%"` 这种串），CSS 的 `clip-path: inset()` 有直接
  对应物——换算后挂在 `<img>` 的 style 上，四边全 0 时不发。这是老式壳里唯一能被看见的
  一族；其余 128 对**屏上零兑现、写侧也回不去**（包只发 DrawingML 内嵌图），是纯只读
  记账，与 v0.150 的 proofErr、v0.151 的 wsp 壳同款，写在注释与审计里而不是含糊过去。
- **扫表只在 `w:pict` 子树里走**：VML 老式形状只住这一支，全局扫会撞同 local name 的
  别家元素（OMML 的 `m:f`、DrawingML 的 `a:cxnSpLocks`）——撞名记出来的对是假账，宁可
  少扫也不记假账。
- **同一标签的多枚元素全扫**：真实件一个 pict 里常有好几个 `v:shape`/`v:line`，各自带
  自己的 id/style，只认首枚等于把其余几枚当不存在。
- **gfxdata 五处一律不收**（v0.149 裁定的延续）：Word 缓存的图元字节，1,165 宇宙字面
  留在 neverConsulted 里不动。
- **一处自检出来的假账**：`bitmap()` 的 `blip` 是「a:blip 优先、无则 v:imagedata」，而
  裁剪是 v:imagedata 独有的属性——照原样问一遍会在账本上留四枚「读手问 a:blip 要
  cropbottom」的假名（覆盖率不受影响，但榜单会多四枚没意义的行）。改成按 local name
  认回 VML 那一支。

**门禁**：tsc 0、build ✓；selftest MUST_SEE **397 枚全命中（+132）** / MUST_NOT_SEE 1 枚
全落空；变异腿有牙（no-attrL 42.8%/83.3%、no-attr 46.5%/41.6%）；变异后干净腿复位 md5 与
主腿一致；语料分母仍 31,471（本轮只动读手，语料未改）。

### v0.154（D13）——图片源裁剪框 / 表间距 / 隐藏文字 / 批注族改走漏斗

按字面权重扫剩余 neverConsulted 的**「能兑现的余量 + 批注身份」**：**33 对上账、语料
字面 33（宇宙字面 1,452）**，覆盖率**按对 77.4% → 82.3%、按字面 97.8% → 97.9%**；
consulted 528 → 561 对，neverConsulted 154 → 121。

| 族 | 宇宙字面 | 往返 |
|---|---|---|
| `a:srcRect` 四边（blipFill 的源裁剪框，千分比） | 292 | 读侧渲染（写侧无槽） |
| `w:tblCellSpacing` 的 w 与 type（表级单元格间距） | 142 | **读写**（TBLPR 补丁） |
| `w:vanish`（隐藏文字） | 88 | **读写**（原生槽） |
| `w:cnfStyle` 十三枚（表条件格式落点开关） | 520 | 只读 |
| 批注族（comment 四枚 / commentEx done / 两根 Ignorable / commentReference id） | 97 | 读侧（改走漏斗） |
| 脚注与尾注两根 `mc:Ignorable` | 148 | 只读 |
| `w:smartTag` 两枚（智能标记壳） | 160 | 只读 |
| `w:tblOverlap` + `a:spLocks` 两枚 | 165 | 只读 |

- **隐藏文字用 `visibility: hidden` 而不是 `display: none`**：Word 的隐藏文字不显示却
  **仍占版面**（行高与分页照算），用 display:none 会把布局一起改掉。写侧是包里类型面
  暴露的原生槽（`IRunOptions.vanish`），与 v0.152 的 allCaps/border 同路数。
- **单元格间距必须同时切 `border-collapse: separate`**：CSS 的 border-spacing 在 collapse
  下被忽略，而 Word 有间距时同样不共享格边。写侧与 bandSize **分居 `w:tblW` 两侧**
  （CT_TblPrBase 序：bandSize 在前、tblCellSpacing 在后），所以单列一条登记与自己的
  插入锚点——共用「插到第一个已知后续元素之前」那一套会写出序不对的元素。
- **`a:srcRect` 是裁剪的两代写法里的新式那一支**：老式件用 `v:imagedata` 的 crop
  （0..1 的分数），新式件用 `a:srcRect`（千分比整数），两者都折成 `clip-path: inset()`，
  同时在场时按 VML 那一族。写侧发不出这一枚——**单边通道**，探针里明写「输出不该有
  srcRect」而不是假装双向。
- **批注族从正则搬进了 attr 漏斗**：`commentRowsOf` 是正则读的，读是读了但**进不了
  保真账本**（与 v0.147 之前节属性那一处欠账同一款）。保真路径新建 `readComments` 走
  parseXml + attr，补出 author/date/initials、两份部件根的 Ignorable 与「已解决」标记；
  mammoth 兜底路径仍用 `commentRowsOf`。

**门禁**：tsc 0、build ✓；selftest MUST_SEE **432 枚全命中（+35）** / MUST_NOT_SEE 1 枚
全落空；变异腿有牙（no-attrL 44.1%/83.3%、no-attr 50.1%/41.8%）；变异后干净腿复位 md5 与
主腿一致；语料分母仍 31,471。


### v0.155（D14）——符号出字 / 整篇底色 / 链接提示 / 图形变换 / 表单域与图形余量

这一轮不再是「扫榜补长尾」，而是**把剩下的榜单一次清干净**：**112 对上账、语料字面 121**，
覆盖率**按对 82.3% → 98.7%、按字面 97.9% → 98.4%**；consulted 561 → 673 对，
neverConsulted 121 → **9 对**（剩下的全在「明确不做」名单里）。

| 族 | 对数 | 往返 |
|---|---:|---|
| DrawingML 图形壳余量（色彩模型 / 虚线 / 箭头 / 光效 / 三维 / 路径 / 文字轮廓） | 52 | 只读 |
| `w:background` 整篇底色 + `w:u` 下划线色 + `w:sym` 符号 | 8 | **读写**（底色走后置补丁） |
| 编号定义余量（styleLink / lvlRestart / lvlPicBulletId / numPicBullet / numIdMacAtCleanup / legacy 三枚） | 8 | 半读写 |
| 段落余量五枚（kinsoku / wordWrap / overflowPunct / suppressAutoHyphens / textDirection） | 5 | **读写** |
| 表单域 `w:ffData`（appearance / calcOnExit / entryMacro / default / maxLength） | 5 | 只读 |
| 表条件格式 shade/tint 四枚（insideH / insideV） | 4 | 读侧修 bug |
| 字符开关五枚（em / ligatures / numSpacing / numForm / cntxtalts） + emboss/imprint/outline | 8 | 读侧兑现/记账 |
| 节余量七枚（type / pgSz@code / pgNumType 两枚 / cols@equalWidth / rtlGutter / formProt） | 7 | 只读 |
| `a:xfrm` 三枚（rot / flipH / flipV） | 3 | 读侧兑现 |
| 表行余量（gridAfter / wAfter 两枚） | 3 | 只读 |
| `w:hyperlink` 的 tooltip 与 tgtFrame | 2 | **读写** |
| `w:smartTag` 两枚（块层分发补漏） | 2 | 只读 |
| 零头七枚（aliases / creationId / fldChar@fldLock / sdt@id / ins@id / styleLink 外的样式面） | 7 | 半读写 |

- **`w:sym` 此前是「读到了，字丢了」**：老路只打一条「符号未导入」的 warn 就 return，
  符号位上的 Wingdings 字与项目符号整个消失。现在读 `w:char`（十六进制码位）与 `w:font`，
  产出 `<span style="font-family: Wingdings">&#xF0E0;</span>`。这类「认得出元素名却
  没落成输出」的洞**账本上看不出来**（它一直是 consulted），只有探针的 MUST_NOT_SEE
  反向断言抓得住。
- **整篇底色是文档级，锚点不在 body 里**：`w:background` 在 CT_Document 序里排在
  `w:body` **之前**，所以后置补丁的插入点是「`<w:body>` 之前」——不是那张「插到第一个
  已知后续元素之前」的通用表。写侧 color（去 `#`、大写）与 themeColor 二选一。
- **`themeRefCss` 的 shade/tint 长期没被查问**：两枚属性写在第三道 `return undefined`
  之后，主题解析不出来时函数提前返回，属性根本没问过——表级 `insideH|themeShade`、
  `insideV|themeTint` 这四对因此常年挂在 neverConsulted 上。修法是把两枚属性提到三道
  return **之前**恒查问：查问与解析解耦，解析不出仍然返回 undefined。
- **DrawingML 的壳属性只在 `w:drawing` 子树里扫**：52 对里有 prstClr/scrgbClr 两种色彩
  模型、outerShdw/glow/reflection 的光效全族、lightRig 的 rig/dir、props3d 的挤出三枚。
  全树按 local name 扫会撞上 OMML 的 `m:r`、VML 的 `v:roundrect` 这种同名元素——**问错
  对象比不问更坏**：账上多一笔看着像成绩的假账，覆盖率一动不动。`props3d` 与 `sp3d`
  两个 local name **都问**：schema 里叫 `a:sp3d`，存盘写的是 `a:props3d`，宇宙记后者。
- **`a:xfrm` 折成 CSS transform**：rot 是六万分之一度（除以 60000 得度），flip 后接
  `scaleX(-1)`，与 v0.153 的 srcRect 裁剪**并进同一个 style**——两个 `clip-path` 各写
  一遍会互相覆盖。
- **块级内容控件要单独读 `sdtPr/id`**：`w:sdt` 有两处分发，段落内的走 run 层，把整段或
  整表包住的走块层 `sequence()`。只补前者，块级控件的 `id|val` 依然问不到——这条是
  selftest 报出来的，不是想出来的。
- **`col|w` / `col|space` 留在 neverConsulted，欠的是量具不是产品**：合成语料的块模型
  不支持「嵌进另一块里的某元素」。要让读手 `find(sect,'w:cols')` 拿到那枚带 `w:col`
  子元素的 cols，就得把节里其余所有元素也塞进 cols 内部，它们的直接子元素路径全断
  （试过一次，`cols|num/space/equalWidth` 三对当场掉出分子，遂完整回退）。真件里这两对
  是读的，已在审计的顺延清单里写明。

**门禁**：tsc 0、build ✓；selftest MUST_SEE **540 枚全命中（+108）** / MUST_NOT_SEE 1 枚
全落空；变异腿有牙（no-attrL 51.5%/83.5%、no-attr 59.2%/42.1%）；变异后干净腿复位 md5 与
主腿一致（`d29f097f…` / `fba730a8…`）；语料分母 31,471 → 31,482（新增承重块带来的字面增量）。
剩余 9 对全在「不收」名单：`t|space`、`instrText|space`、`gfxdata` 五处、`col` 两枚。


### v0.156（D15）——单边通道升双向四族 + 量具补子上下文与两条变异腿

榜单清完之后，账本已经看不见剩下的洞了——**它只记「查问过没有」，不记「写不写得回」**。
这一轮换了靶子：**把读得进、写不出的单边通道挑四条补成真双向**，顺手把量具自己欠的两笔
（合成语料放不下 `w:col`、变异腿只有两条）也还了。覆盖率按对 **98.7% → 99.0%**（清掉
`col` 两枚），按字面 98.4% 不动。

| 族 | 此前 | 现在 |
|---|---|---|
| `w:u` 的**线型**（`w:val` 十八档） | 只有「有下划线」这一比特上纸 | **读写**（`underline.type`） |
| `w:u` 的**颜色**（`w:color`） | 挂 `<u>` 的 inline style，过不了 TipParse，存盘即丢 | **读写**（`underline.color`） |
| `w:em` 着重号型别（dot / circle / comma / underDot） | 纯记账 | **读写**（`emphasisMark`，库外槽） |
| `w:emboss` / `w:imprint` 浮雕与阴文 | 纯记账 | **读写**（包里的原生槽） |

- **「读到了、存盘却丢」是账本的第二层盲区**：线型与颜色一直在读、一直在画（`<u style=
  "text-decoration-color: …">`），可 TipTap 的 underline mark 只认 `<u>` 这个标签名，
  inline style 根本进不了模型——**打开另存一次就没了**。修法是让它们随 `data-u` 载荷走
  charExtra 通道（与 v0.138 的 cs/lang、v0.152 的 bdr 同一条路），屏上那一半改由 mark
  自己发 CSS。
- **`w:em` 是库外槽**：docx 包的 `EmphasisMarkType` 只声明了 `DOT` 一个成员，可它运行时
  就是把传进去的值原样写进 `w:em/@w:val`——circle/comma/underDot 三档照传不误。类型面
  没有 ≠ 实现没有，判据是 dist 里的 `createEmphasisMark`，不是猜的。
- **`w:outline`（镂空）继续纯记账**：包里没有这一枚的槽（`effect` 是 `w:effect`，另一回事），
  CSS 也只有 `-webkit-text-stroke` 这种不在标准里的近似，硬画会画出与 Word 不像的样子。
- **合成语料的 spot 多了 `into` 字段**：块模型原本只有「开标签 + 载荷 + 闭标签」一层，
  载荷之间一律是兄弟。可 `w:col` 生来就是 `w:cols` 的子，而读手 `find` 取的是第一枚
  `w:cols`——单开一个块去装主人，读手取的是别的那一枚。现在载荷可以直接嵌进同段里第一枚
  同名元素内部，`col|w` / `col|space` 两对就此上账（此前挂了两轮）。
- **变异腿从两条加到四条**：`--mut no-theme` 让主题恒解析不出来，**覆盖率必须一动不动**
  （这是 v0.155 那处「查问与解析解耦」的回归闸——谁把 shade/tint 挪回 return 之后，这一腿
  当场掉分，实测两腿的 consulted 集合逐对相同）；`--mut no-themeshade` 还原旧写法，
  **覆盖率必须下降**（实测 99.0% → 96.5%，掉 17 对）。

**门禁**：tsc 0、build ✓；selftest MUST_SEE **540 枚全命中** / MUST_NOT_SEE 1 枚全落空；
往返探针 `tmp/check-d15.mjs` 全绿（四族读侧进模型 + 写侧回得了纸）；变异腿四条
（no-attrL 51.8%/83.5%、no-attr 59.2%/42.1%、no-theme 不动、no-themeshade 96.5%）；
干净腿复位 md5 与主腿一致（`cd953d32…` / `1c67668b…`）。账上剩 **7 对**，全是既有裁定
「不收」：`t|space`、`instrText|space`、`gfxdata` 五处。


## 文档保真：往返账（v0.157）

保真账本量到「读手按名查问了哪些对」就停了。可一条属性要活下来得走完三段：

```
docx ──读手──▶ HTML ──TipTap schema──▶ PM 模型 ──写手──▶ docx
```

任何一段断了，屏上都可能看着完全正常，存盘就没了。这一轮把第三问变成一份账：
`scripts/fidelity-roundtrip.mjs` 让同一份夹具走完这条路，然后**普查写出包**，逐对判四档
（保留 / 值变 / 掉了 / 缺件）。不写断言、不逐族盯——**要的就是不知道哪里会掉**。

| 族 | 读到的 | 保留 | 值变 | 掉了 | 保留率 |
|---|---:|---:|---:|---:|---:|
| 正文属性（`w:*`） | 263 | 148 | 29 | 86 | **56.3%** |
| 图形壳（`a:`/`v:`/`wp:`/`pic:`/`wps:`/`o:`） | 319 | 27 | 3 | 289 | 8.5% |
| 合计 | 582 | 175 | 32 | 375 | 30.1% |

图形壳那一行不是坏消息而是既定事实：形状与文本框被读手展平成文字，壳本来就没有容身之处；
夹具又成心塞满了它们（512 行夹具里一半是 VML 与 DrawingML），就是为了照这条通道。混在一个
百分比里什么也看不出来，所以分列。

**第一趟账就照出两处真丢数据**：

- **块级图片被整张丢掉**。schema 里 `Image` 是 block 节点（`@tiptap/extension-image` 的
  `inline` 缺省 `false`），读手又把 `<img>` 发在块层，于是每张图在模型里都是顶层节点；
  而写手的图片分支只有行内那一条，块级走末尾兜底 `para(node)`——`image` 节点没有 content，
  整张图被写成一枚空段落。PM 里 5 张图，写出包 **0 个 `w:drawing`**。此前的逐族探针都是按
  行内构造的 PM，两头对着演，谁也没碰到真实形状。已补块级分支（`imageRunOf` 两处共用）。
- **背景的字面色丢了**。源里 `<w:background w:color="FFE699" w:themeColor="background1"
  w:themeShade="BF"/>`，写出包只剩主题那三枚。写作侧判断是「有主题槽就不写字面色」——
  OOXML 里主题槽确实压过字面色，可字面色是主题取不到时的兜底值，一并写回才算原样。

**为跑通这条路还的三笔债**：

- 扩展清单从 `DocEditor.tsx` 搬进 `lib/doc-schema.ts`。HTML 进模型是 TipTap 按 schema 的
  `parseHTML` 规则做的——量具另抄一份清单，测的就是另一套规则，抄的那份一漂移账就成了假账。
- 夹具与探针注入搬进 `scripts/lib/`：`--selftest` 与往返账共用一份，改一处不会漏另一处。
  搬完之后账本 md5 逐字节不变（`cd953d32…`/`1c67668b…`），搬移本身也有了证明。
- 加 `linkedom`（devDependency，仅量具用）。node 侧没有 `document`，而 PM 的 DOMParser 要有
  DOM 才转得动 HTML。换 schema / 换 DOM 就换答案，所以两边都锁死。

**门禁**：tsc 0、build ✓（5556 模块）；selftest 540 枚全命中 / 1 枚全落空；账本复跑逐字节
相同（`50ae1324…` / `4d316767…`，正文里不写日期——否则明天就对不上）。写手与 schema 从产品
源取，靠「工作树必须与取样 rev 一致」这条硬闸钉住，脏了直接拒绝跑。

D17 顺延：编号定义的元数据（`suff`/`lvlRestart`/`styleLink`/`tmpl`/`nsid`）在列表被重建时
整族没落地；`w:sym` 只读不写；`w:u` 的字面色被主题色覆盖后不再保留；`cNvPr` 的图形级
`descr` 只留画布级；页边距走「缇 → 毫米 → 缇」丢精度（1800 → 1797）；`w:cols` 的
`equalWidth` 从 0 变 1（逐栏宽度没写回）。


## v0.158（D17）——编号定义整族落地，照片的两枚名字也回得去了

往返账**正文属性 56.3% → 62.4%**（164/263），图形壳 8.5% → 8.8%。这一轮动的都是上一轮
那份顺延清单上的条目，其中一条是**整族**性质的。

### 编号定义的元数据：整族从「掉了」翻成「保留」

`w:abstractNum` 上的 `nsid`/`tmpl`/`styleLink`/`multiLevelType`，逐层 `w:lvl` 上的 `suff`/
`lvlRestart`/`lvlPicBulletId`/`tplc`/`tentative`——读手一条不少地读进了 meta，可写出包里
一个都没有。八对同时从「掉了」翻到「保留」。

根子不在补丁，在**重建方式**：写手的 `ListRegistry` 按「这一串列表在模型里的档位」造编号
定义，三层全用第 0 层那个符面。于是源里 `0:bullet|·;1:lowerLetter|%2.` 这种多级定义，被
拍成 `0:bullet|·;1:bullet|·;2:bullet|·`。而 `patchNumberingXml` 靠内容指纹认领定义，第二层
对不上就**整条跳过**——不是漏一枚，是这一族全跳。

改法是让源定义的逐层档位参与重建：读手把每层自己的 `numFmt`/`lvlText` 存进 `DocxLvlMeta`
（从前它们只活在 `fp` 那串合并文本里，写手取不到逐层的值），写手认领定义后**照原样逐层
发**，不足三层再用按段档位补齐（段落引用的层号被截到 2，写少了 Word 那一段没有档位可用）。
认领只比第 0 层——更深那几层本来就是被拍平拍没了的东西，拿它们当判据等于永远认不出；
一份定义只给一串列表用，第二串不去抢。

顺带一个真收益：多级列表的第二、三层档位不再被拍平。源里第 2 层是罗马数字的，导出后
还是罗马数字。

### 图片的两枚名字

| 属性 | 此前 | 现在 |
|---|---|---|
| `wp:docPr/@name`（对象名） | 被替代文本顶掉（`图片 1` → `画布级替代文本`） | 单存一份带回 |
| `pic:cNvPr/@descr`（图形级替代文本） | 整条没写 | 随图片壳补丁回写 |

写手把 alt 同时塞进 `name` 与 `descr`，而读手取 alt 时是「descr 优先、name 兜底」——
一来一回，源里的对象名就被替代文本覆盖了。名字在 Word 的选择窗格与定位里是要用的。

### 页边距的换算精度

`1800 → 1797`、`851 → 850`。缇 → 毫米只留一位小数是**不可逆**的：1800 缇 = 31.7499…（浮点上
差一点到不了 31.75），截成 31.7，回算只剩 1797。两位小数把往返误差压到 0.3 缇以内，取整后
都能回到原值。

### 账本自身的三处假红

`lvlJc` 的 `start`≡`left`、`end`≡`right`（ST_Jc 的两套写法）；`mc:Ignorable` 按空格拆成一串
命名空间前缀（写手多声明两个兼容前缀不是丢东西）；ISO 时刻按 `Date` 归一（`…T10:00:00Z`
与 `…T10:00:00.000Z` 是同一刻）。假红比真红更坏——它会把真信号盖住。

**门禁**：tsc 0、build ✓（5556 模块）；selftest 540 枚全命中 / 1 枚全落空；四条变异腿
`no-attrL` 51.8%、`no-attr` 59.2%、`no-themeshade` 96.5% 三腿下降，`no-theme` 一腿**逐对
不动**（675 对计数全同）；保真账本复位后 md5 仍是 `95846f03…`/`aab9813c…`，往返账两次复跑
逐字节相同。

D18 顺延：`w:sym` 只读不写（要上纸得新开 run 级补丁位）；`w:u` 的字面色（与 `w:background`
同型，但 `docx` 的 `underline` 没有主题槽，同样要靠 run 级补丁）；`gridCol`/`tcW` 的
±5 缇（模型的 `colwidth` 是整数像素，量化损失在模型那一层）；`w:cols` 的 `equalWidth`
与逐栏宽度（模型没有分栏这个概念）；`ind|left` 的列表缩进覆盖；`docPr|id` 的对象序号重排。


## v0.159（D18）——run 级补丁位：符号回真，下划线的主题色也跟着回来

往返账**正文属性 62.4% → 64.3%**（169/263），整体 33.0% → 33.8%，值变 22 → 21。
五对从「掉了/值变」翻成「保留」，是上一轮顺延清单里点名的那条**机制债**。

### 顺延清单说「两处是同一条债」，实际上只对了一半

清单上写着「`w:sym` 只读不写、`w:u` 的字面色，两处都是包外槽，要 run 级补丁位」。查了
`docx` 的实现才发现 `w:sym` 根本不需要补丁——包里有原生 `SymbolRun`：

```
constructor(char = "", symbolfont = "Wingdings") { super("w:sym"); … xmlKeys = { char: "w:char", symbolfont: "w:font" } }
```

它一直就在那儿。缺的不是机制，是**读手没把原值带进模型**：`w:sym` 从前被当普通文字
发出去（`<span style="font-family: Wingdings">&#xF0FC;</span>`），屏上看着分毫不差，
存盘就变成 `w:t` + `rFonts`——`w:sym` 这枚元素整个消失。往返账第一次跑就点出
`sym|char` 与 `sym|font` 两笔「掉了」，而只看屏幕永远看不出来。

改法是让读手把 `char`/`font` 原值装进 `data-sym` 载荷（`F0FC;Wingdings`），写手认出
这枚载荷就发 `SymbolRun`。**只在「一个 run 一个字符」时发**：一枚 `w:sym` 只表达一个
码点，多字符硬发会吞字，退化成普通文字反而字还在；`char` 与 `font` 缺一也不发
（`SymbolRun` 的 `symbolfont` 缺省是 `Wingdings`，猜一个字体比写错更坏）。

### 下划线的「字面」与「主题」是两个槽

`w:u` 常写成 `w:color="FF0000" w:themeColor="accent1" w:themeTint="99"`——三枚是三个槽：
字面值是给不认主题的读者兜底，主题引用是主。读手此前把它们解析成一个「屏上颜色」，
写手再把这个解析值写回 `w:color`，于是往返账上记着 `ff0000 → b4c7e7` 一笔**值变**：
主题算出来的色把源里的字面值顶掉了。

这一轮把载荷从两格扩到六格：`线型;屏上色;字面色;themeColor;themeTint;themeShade`。
屏上色（解析值）只给编辑器画屏用，字面色走包的 `underline.color` 原生槽，主题三枚走
新开的 **run 级补丁位**——包只有 `{type, color}` 两枚槽，`createUnderline` 里只写
`w:val` 与 `w:color`。

补丁位本身很薄：`patchUTheme` 按 `<w:u>` 在 `word/document.xml` 里的**出现序**贴回属性串，
对位靠**计数闸门**——条数对不上就整笔放弃（宁可不补，也绝不补到别的 run 上）。匹配用
`<w:u(?=[\s/>])` 收边，免得把 `w:unhideWhenUsed`、`w:uiPriority` 这些同前缀元素算进来。
这是本项目第五处打包后补丁（`w:pPr`、`w:tblLook`/`w:tcPr`、图片壳、编号定义之后）。

### 顺带修的三处测试口径

结构测试里有三条断言拿 `<w:pos>` 当输入，而读手从 v0.151 起读的是 `<w:position>`
（`CT_RPr` 里根本没有 `w:pos` 这枚元素）——那三条从 v0.151 之后一直红着，只是脚本不在
常规门禁里，没人跑到。改成 `w:position` 之后 53 项全绿，顺带补了符号与下划线主题色的
十二条断言（含三条反例：多字符不发 `w:sym`、无字面不写 `w:color`）。

**门禁**：tsc 0、build ✓（5556 模块）；结构测试 53 项全绿；四条变异腿 `no-attrL` 51.8%、
`no-attr` 59.2%、`no-themeshade` 96.5% 三腿下降，`no-theme` 一腿**覆盖率一动不动**
（99.0%/98.4%，守着「查问与解析解耦」）；保真账本复位后 md5 仍是 `95846f03…`/`aab9813c…`
（这一轮改的是写手与载荷形状，读手的查问集一枚没动），往返账 md5 `a6eb5d52…`/`bfe80bf0…`
两次复跑逐字节相同。

D19 顺延：run 级补丁位该泛化成 `patchElemAttrs(bytes, tag, extras)`——`w:color` 上的
themeColor/themeTint/themeShade 还是同一个形状（1 对仍在掉了名单里）；`w:ind` 的
`firstLineChars`/`hangingChars`（字符单位缩进，1 对，PPR 通道加两格即可）；
`insideH|space`（表内边框间距，1 对）；其余承接 D18 未动项（`gridCol`/`tcW` 的 ±5 缇、
`w:cols` 的 `equalWidth`、`ind|left` 的列表缩进覆盖、`docPr|id` 重排、`lvlJc` 深层 `center`）。

## v0.160（D19）——补丁位泛化成任意元素：文字色的主题引用与缩进的字符档

往返账**正文属性 64.3% → 66.2%**（174/263），整体 33.8% → 34.7%，掉了 364 → 359，
值变 21 不变。五对从「掉了」翻成「保留」：`color|themeColor`、`color|themeTint`、
`color|themeShade`、`ind|firstLineChars`、`ind|hangingChars`。保真账本按对仍是 99.0%
（这一轮动的是写手与两枚载荷，读手查问集一枚没动）。

### 补丁位从「一个元素」泛化成「任意元素」

上一轮的 `patchUTheme` 只认 `<w:u>`。这一轮有了第二处同形状的需求（`w:color` 也带
`themeColor/themeTint/themeShade` 三枚），于是把它参数化成 `patchElemAttrs(bytes, tag,
extras)`——匹配 `<w:{tag}(?=[\s/>])`、按出现序贴属性串、计数闸门照旧。**两族的登记数组
分开**（`dt.uThemes` 与 `dt.colorThemes`）：对位靠的是各自元素在 `document.xml` 里的
出现序，合成一串就对不上了。

闸门能成立有个前提：脚注/尾注/批注那一支在我们的写手里走**简单文本**（不带
`charExtra`，也就不会登记），所以 `document.xml` 里的 `w:color` 枚数正好等于登记条数。
这条前提写进了函数头注——哪天脚注也开始走 `childToRuns`，闸门会先喊。

### 文字色这次**故意不拆**字面槽

`w:color` 与 `w:u` 长得一模一样（`w:val="FF0000" w:themeColor="accent1"`），但这一轮没有
照搬 u 那套「字面/解析分两格」的做法。理由只有一条：**模型的 `textStyle.color` 是用户
可编辑的单一事实源**。拆成字面槽之后，写盘取的是源里的 `ff0000`，用户把颜色改成红色再
存盘，出去的还是 `ff0000`——「改了色导出却不变」比一笔「值变」的账坏得多。所以
`color|val` 那笔值变（源 `ff0000` → 出 `adbbd4`）继续挂着，主题三枚由补丁位补回，
Word 打开时仍是主题说了算。

（u 那边可以拆，是因为下划线颜色在编辑器里没有入口——有没有这一条「能不能被用户改」
的判据，决定了同一形状的两个槽该不该分。）

### 缩进的字符档：合并而不是另起一枚

`w:ind` 在 `CT_PPrBase` 里是**单枚**元素。写手自己发的那一枚常常已经带着 `w:left` /
`w:firstLine`（模型折算出来的），再插一枚新的会让 Word 只认后写的那一枚，先写的整枚
被丢——缩进会静默变样。所以 `pprOrder` 多了一条**同名元素合并属性**：命中同名就把
属性并进去，已有的同名属性不覆盖（以包自己那一枚为准）。导出结果是一枚：

```
<w:ind w:left="420" w:right="210" w:firstLine="450" w:firstLineChars="200" w:hangingChars="0"/>
```

留一条已知边界：`firstLine`（缇）与 `firstLineChars`（百分之一字符）是**同一枚首行槽的
两套记法**，同时出现时 Word 取哪一档规范里没写死。数值上两者等价（字符档就是用同一
底数折出来的 450 缇），差异只在用户之后改了字号：字符档会跟着字号走，缇值不会。
这一条如实记在账上，没有替源件选。

### 门禁

tsc 0、build ✓（5556 模块）；结构测试 **53 → 66 项**全绿（新增十三条约一半是反例：
没有 `textStyle.color` 时不凭空写 `w:color`、`pPr` 里只允许一枚 `w:ind`）；四条变异腿
`no-attrL` 51.8%/83.5%、`no-attr` 59.2%/42.1%、`no-themeshade` 96.5%/98.3% 三腿下降，
`no-theme` 一腿**一动不动**（99.0%/98.4%）；保真账本 md5 仍 `95846f03…`/`aab9813c…`，
往返账 `0135a0d1…`/`b36aa62d…` 两次复跑逐字节相同。

D20 顺延：**`rFonts` 的 `asciiTheme`/`eastAsiaTheme`/`hAnsiTheme`**（3 对，与 `w:color`
同一形状的第三处，补丁位已就绪，缺的是读手把引用名带出来）；**量具口径**——`ST_OnOff`
的「裸元素在场」应归一成 `|val = 1`（`caps|val`、`vanish|val`、`widowControl|val` 这几笔
是账本自己的假红，账本头注里写的 `true/1/on` 归一漏了这一档）；`insideH`/`insideV` 的
`space` 与主题三枚（8 对，要新开「表级边框原值」通道，与读手「分摊到格」的口径冲突，
得先定口径）；`cnfStyle` 十二对（表条件格式账）；`fldChar` 三对（域指令，模型无槽）。


## v0.161（D20）——先修账本，再修两处「看着丢了其实没丢」和一处真被库吞掉

往返账**正文属性 66.2% → 69.2%**（174/263 → 189/273），整体 34.7% → 36.7%，掉了
359 → 355。四对从「掉了」翻成「保留」：`caps|val`、`rFonts|asciiTheme`、
`rFonts|eastAsiaTheme`、`rFonts|hAnsiTheme`。另有十对是**账本自己漏记**后补进分母的
（`bCs|val`、`iCs|val`、`smallCaps|val`、`pageBreakBefore|val`、`keepNext|val`、
`keepLines|val`、`snapToGrid|val` 等），`vanish|val` 与 `widowControl|val` 由假红翻正。
保真账本按对仍是 99.0%，md5 仍 `95846f03…`/`aab9813c…`（读手新查问的四枚属性早就在
`applyThemeFonts` 那一趟的分子里，账本一枚没动）。

### 一、量具口径：`<w:vanish/>` 就是 `w:val="1"`

`ST_OnOff` 的元素可以不写 `w:val`——`<w:vanish/>` 与 `<w:vanish w:val="1"/>` 是同一件事
的两种写法，包的 `OnOffElement` 传 `true` 时发的就是裸元素。而往返账的普查只按**属性**
取值，裸元素压根进不了 `values`：源里写 `w:val="1"`、写出包发 `<w:vanish/>`，账上就记
一笔「掉了」，两边的值一模一样。

于是 `census` 对一张 `ST_OnOff` 元素名单（四十余枚）补一条：**没写 `w:val` 时记一笔
`val=1`**。名单漏了的后果想清楚了才动手——漏掉的元素两边都不补，最多留一笔假红，
**不会造假绿**，方向是保守的（v0.157：假红占着榜单比造假成绩好得多）。

这一条同时也补了分母：源里那些裸 OnOff 元素此前根本不在账上，现在按「在场」计，十对
一次性进账且全部保留。

顺带把这条口径写进了结构测试（读 `docs/fidelity-roundtrip.json` 的 `definition` 自陈
字段与三对的状态）——**账本不自查，假红就一直占着榜单**。

### 二、真被库吞掉的一枚：`<w:caps/>`

一个 run 同时要小型大写与全大写时，写出包里只有 `<w:smallCaps/>`，`w:caps` 整个消失。
查包的 `RunProperties`：

```js
if (options.smallCaps !== void 0) this.push(new OnOffElement("w:smallCaps", options.smallCaps));
else if (options.allCaps !== void 0) this.push(new OnOffElement("w:caps", options.allCaps));
```

**`else if`**——两枚在库里互斥，不是我们传错了。补法是一枚新的打包后补丁
`patchBeforeElem`：按 `<w:smallCaps>` 出现序在它**前面**插 `<w:caps/>`（`CT_RPrBase`
里 caps 排在 smallCaps 之前，反了就是 Word 认不得的 rPr）。

登记放在 `withCharExtra` **内部**而不是 `childToRuns` 里：发 smallCaps 的路径有五条
（普通 run / 超链接 / 修订插入 / 修订删除 / 符号），漏登记一条就整体错位——这跟
「闸门对的是枚数」是同一件事。

### 三、样式的主题字体引用：继承来的不算自己说过

Word 的 `Normal` 样式只写 `asciiTheme="minorHAnsi"` 这类引用名，具名字体要靠主题部件
解析。读手（v0.138 起）把解析值落在 `fonts` 上，屏上要它——但**引用名本身也是源件说过
的话**，写回时只写解析值，就把「跟着主题走」改成了「钉死 Calibri」：换主题时整篇不再
跟着变。

所以 `RunProps` 多一份 `fontThemes`（四枚原值），写手按 styleId 补进该样式自己那枚
`<w:rFonts>`。这里有个坑：`styleList()` 是**沿 basedOn 链合并**的，Normal 的引用名会被
摊到 Report / ReportHead / ReportChar 上（写出包里这四枚样式各有 rFonts，而源里只有
Normal 一枚）。摊出来的那些不该凭空戴上引用名——包自己会沿 basedOn 摊字体，再在子样式
上写一遍等于「用户在这一层也钉了一次」。于是 `fontTheme` **只按 `info` 自己的 rPr 取**
（传 `NONE` = 不继承），链合并那一趟不落这一格。

### 门禁

tsc 0、build ✓；结构测试 **66 → 79 项**全绿（新增十三条约三成是反例：只要 caps 时整份
只有一枚、子样式不凭空戴 `Theme=`、账本的裸 OnOff 归一已生效）；四条变异腿
`no-attrL` 52.3%/87.2%、`no-attr` 59.2%/42.1%、`no-themeshade` 96.5%/98.3% 三腿下降，
`no-theme` 一腿**一动不动**（99.0%/98.4%）；往返账 `18516b03…`/`bb5367ca…` 两次复跑逐
字节相同。

D21 顺延：**`insideH`/`insideV` 的 `space` 与主题三枚**（8 对，要新开「表级边框原值」
通道，与读手「分摊到格」的口径冲突，得先定口径）；**`cnfStyle` 十二对**（表条件格式账，
模型无槽，要样式表级补丁）；`fldChar` 三对（域指令）；`outline|val`（文字镂空，与
emboss/imprint 同族但**包里没有原生槽**，只能走 run 级补丁位）；承接未动项：
`gridCol`/`tcW` 的 ±5 缇、`w:cols` 的 `equalWidth`、`ind|left` 的列表缩进覆盖、
`docPr|id` 重排、`lvlJc` 深层 `center`。


## v0.162（D21）——表条件格式的落点开关：从「只记账」升成「只往返」

往返账**正文属性 69.2% → 74.0%**（189/273 → 202/273），整体 36.7% → 38.9%，掉了
355 → 342，值变 20 不变。十三对一次性从「掉了」翻成「保留」：`cnfStyle|val` 与十二枚
落点开关（`firstRow` / `lastRow` / `firstColumn` / `lastColumn` / `oddHBand` /
`evenHBand` / `oddVBand` / `evenVBand` / 四角四枚）。保真账本按对仍 99.0%，md5 仍
`95846f03…`/`aab9813c…`——新那一趟读的是 `attrL`，与记账那一趟同一批属性名，分子一枚
没增。

（顺带纠正一处上轮的计数：此前顺延清单里写「`cnfStyle` 十二对」，漏数了 `val` 那一枚，
实际是十三对。）

### 记账与往返是两趟，不是一趟

这一族从 v0.154 起就是**纯只读记账**：`noteCnfStyleMarks` 整树扫 `w:cnfStyle`、十三枚
按名查问，一个数也不落地。记账管的是保真账本（「读手查问过哪些对」），与管往返的那本
不是一回事——**升成「只往返」时，记账那一趟要留着**，因为它还负责 `w:tcPr` 里那些**格级**
cnfStyle 的查问（格级这一轮没有通道，也不打算给：模型里没有「这一格落在表样式哪一块」
这个概念，硬加一个只往返的属性不如先承认它是账）。

于是两趟并存、各记各的，且**名单必须同源**——`CNF_STYLE_ATTRS` 原先是自己写死的一份
十三枚数组，这一轮改成直接指向 `cell-style.ts` 的 `CNF_KEYS`。两份名单迟早会走散，
而走散的那天，账本上会多出一对谁也说不清的假红。

### 载荷是定序格串，不是 key=value

`data-cnf="000000100000;1;0;1;0;1;0;1;0;1;0;0;0"`——十三格，`CNF_KEYS` 的序即格序，
空槽留空。与旁边的 `data-tblpr`（key=value）不同款，理由也写在那儿：十三枚是**固定
集合**（不会像 `ppr` 那样逐版增补），定序更短也更稳；`val` 是十二枚开关压成的一位串，
本身就有形状可校验（不是 12 位 `0/1` 就整格丢，与 `parseTblPrPayload` 的「脏值整键丢」
同款口径）。

### 第四笔 tblPr 补丁，第三张锚点表

`w:cnfStyle` 在 `CT_TblPrBase` 里紧跟 `w:tblStyle`、排在 `w:tblpPr` 之前——与已经在场的
三族（tblLook 贴末位、bandSize 排在 tblW 前、cellSpacing 排在 tblW 后）位次都不同，
所以自带第三张「插到第一个已知后续元素之前」的锚点表（v0.147 那条教训：同一套锚点表
不能给两组元素共用）。

这里摔了一跤，值得记下：`patchTblLook` 有**两条返回路径**（有编号定义时走
`patchNumberingXml` 之后再补、没有就直接补），我改了前一条、漏了后一条。结构测试第一遍
五条断言全红——**「同一个函数的两条出口」是这类补丁最容易漏改的地方**，而且它不会
报错，只是安静地什么都不做。

### 门禁

tsc 0、build ✓；结构测试 **79 → 88 项**全绿（新增九条约一半是反例：位串形状不对就丢
那一格、同一枚上其余开关照发）；四条变异腿数字与上轮一字不差（`no-theme` 仍一动不动）；
保真账 md5 逐字节不变；往返账 `57bd1179…`/`7cf688ae…` 两次复跑逐字节相同。

D22 顺延：**`insideH`/`insideV` 的 `space` 与主题三枚**（8 对——口径已定：只加**存盘
通道**（表级边框六边原值走 `data-tblb` 载荷 + 补丁回纸），**不动屏上分摊**，两者是两回
事，不存在冲突）；`fldChar` 三对（域指令，模型无槽）；`outline|val`（文字镂空，包无
原生槽）；`tblStyle|val`、`col|w`/`col|space`（分栏）、`wAfter|*`、`gridAfter|val`、
`pgNumType|*`、`smartTag|*`、`legacy|*`；承接未动项：`gridCol`/`tcW` 的 ±5 缇、
`w:cols` 的 `equalWidth`、`ind|left` 的列表缩进覆盖、`docPr|id` 重排、`lvlJc` 深层
`center`。

## v0.163（D22）——表级边框：存盘通道与屏上分摊是两本账

往返账**正文属性 74.0% → 78.2%**（202/273 → 215/273），整体 38.9% → 40.9%，掉了
342 → 334，值变 20 → 17。八对目标全部翻正（`insideH`/`insideV` 的 `space` 与
`themeColor`/`themeTint`/`themeShade`）；顺带三对从「值变」回「保留」（`bottom|space`、
`left|space`、`right|space`），另有两对**此前根本不在账上**（`insideH|color`、
`insideV|color`）。保真账本按对仍 99.0%，md5 仍 `95846f03…`/`aab9813c…`。

### 挂在清单上三轮的那 8 对，卡在「口径」而不是「代码」

前三轮的顺延清单都写着「与读手『表级边框分摊到格』的口径冲突，得先定口径」。这轮定死了：
**分摊是 CSS（格边 padding），存盘是 OOXML 原件，两趟各记各的，不存在冲突**——此前担心
的「padding 重复计数」是把两趟当成一趟才有的。于是这一族**只加存盘通道**：`data-tblb`
载荷带走六边原值，屏上那一趟（`tbSpace` → 格边 `bdSpace*`）一个字不改。

反过来也成立：**拿分摊后的值回写表级，等于把屏上的换算误差写成源件说过的话**。pt↔px
两趟换算 + 逐格覆盖之后，格边那个数和表级原件已经不是一个数了。

### 整片替换，而不是属性补丁

包恒发 `<w:tblBorders>`——`new TableBorders(options.borders ?? {})` 给六枚 `DEFAULT_BORDER`
（`single` / `4` / `auto`），值一个都不对；而六个槽里既装不下 `space` 也装不下主题三枚
（`createBorderElement` 只发 val/sz/color/space）。所以这一族走**整片替换内容**：
`w:tblBorders` 里只有这六枚孩子、六枚都是单枚元素，整片换与逐枚改等价，还能顺带把源件
**没写的边撤掉**（包默认发全六枚，撤掉比留着更接近源件）。

载荷 `data-tblb="single;4;000000;1;;;|…"`：边与边用 `|` 隔、边内七格用 `;` 隔，
`TBLB_EDGES`（CT_TblBorders 的元素序）× `TBLB_KEYS` 即格序，形状不对的格整格丢。

### 顺带浮出水面的两枚

`insideH|color` / `insideV|color` 此前**不在往返账的分母里**。查下去是一处隐蔽的短路：

```js
const hex = themeRefCss(tc, b) ?? rgb2hex(`#${(attr(b, 'w:color') ?? '')…}`)
```

主题解析得出来时 `??` 右侧**根本不求值**——`w:color` 那枚属性等于没被读过，于是这一对
既不在保真账的「查问过」里、也不在往返账的分母里。新那一趟无条件按名取原值，两对随即
进账且都是「保留」。**`??` 的右侧不是「一定会读」，而是「左边空了才读」**——查问纪律
遇上短路求值会静默漏账。

### 门禁

tsc 0、build ✓；结构测试 **88 → 101 项**全绿（新增十三条约四成是反例：包的硬编码默认
已被整片替换、只发载荷里有的边、脏格整格丢、全空的边不进表）；四条变异腿数字与上轮一字
不差（`no-theme` 仍一动不动）；往返账 `293c39a0…`/`9e797368…` 两次复跑逐字节相同。

D23 顺延：`fldChar` 三对（域指令，模型无槽）；`outline|val`（文字镂空，包无原生槽，只能
走 run 级补丁位）；表/节一族 `tblStyle|val`、`col|w`/`col|space`、`wAfter|*`、
`gridAfter|val`、`pgNumType|*`、`smartTag|*`、`legacy|*`；**上面那处 `??` 短路**值得
单独扫一遍别处还有没有（凡是「主题解析优先、字面值兜底」的写法都同形）；承接未动项：
`gridCol`/`tcW` 的 ±5 缇、`w:cols` 的 `equalWidth`、`ind|left` 的列表缩进覆盖、
`docPr|id` 重排、`lvlJc` 深层 `center`。

## v0.164（D23）——主题件跟着走：`theme1.xml` 透传与底纹的字面/主题双写

往返账**正文属性 78.2% → 78.4%**（215/275 → 218/278），整体 40.9% → 41.2%，掉了 334 不动、
值变 17 不动。三对新对进账（`shd|themeFill`/`themeFillTint`/`themeFillShade`，全「保留」）。
保真账本按对仍 99.0%，md5 仍 `95846f03…`/`aab9813c…`。

### 写出去的主题引用，一直指着不存在的件

量具顺手看了一眼写出包的部件表：**没有 `word/theme/theme1.xml`**。而写手从 v0.150 起就在发
`w:themeColor`（表级边框）、v0.159 的 `w:u`、v0.160 的 `w:color`、v0.161 的样式
`w:asciiTheme`——这些引用指着的就是它。引用悬空时 Word 拿自己的默认主题顶上：**用户那套
accent 导出后集体变色，屏上却是对的**。账本看不见这一笔（`theme1.xml` 不在普查清单里，
document.xml 里那几枚属性照样逐对「保留」）——百分比是逐对的，丢一整件部件不在任何一对里。

`attachThemePart` 补的是三件：部件本体、`document.xml.rels` 的 theme 关系、
`[Content_Types].xml` 的 Override。源件没有主题件就不凭空造一枚。

### 底纹：主题引用把字面值盖住了

`themed ?? attr(shd,'w:fill')` 的右侧在主题解析得出来时不求值——两枚都等于没读过；模型里
`background` 又只装解析后的屏上色，源件那枚 `FFFFFF` 从此没有容身之处（回写时变成
accent2+tint 解出来的 `e0bea8`）。新载荷 `data-shd="fill=FFFFFF;themeFill=accent2;…;bg=e0bea8"`
把字面值与主题三枚一起带走，`bg` 是导入那一刻的屏上色。

回写是新开的一笔打包后补丁 `patchShdAttrs`：包自己会发 `w:fill`（而且写的就是解析后的色），
所以这一族是**改名**不是追加——`w:shd` 在 pPr/tcPr 里都是单枚，多一枚就是非法 XML。

**改过底纹色的人不能被主题盖回去**：`background` 与载荷里的 `bg` 对不上就整笔作废、按新色发。

### `??` 短路族扫一遍：九处恒查问

`edgeCss`、`shadingHex`、`shadeSpec`，以及 `w:ascii`/`w:hAnsi`、`srgbClr`/`sysClr`、
`w:left`/`w:start`、`fldCharType`/`type`、`ProgID`/`Type`——旧写法都是「左边空了才读右边」。
保真账本一动不动（合成语料里另有路径查问过），变的是真实件的长尾：`no-attrL` 变异腿
51.8% → **52.5%**，正是这批新查问的证据。

### 门禁

tsc 0、build ✓；结构测试 **101 → 118 项**全绿（含反例：不给第二枚 `w:fill`、改过色就不补
主题引用、源件没主题件就不造、载荷脏键整键丢）；四条变异腿里 `no-attr`/`no-theme`/
`no-themeshade` 与上轮一字不差（`no-theme` 必须不动）；往返账 `6793c9fa…`/`f0de790a…`
两次复跑逐字节相同。

D24 顺延：边框的主题引用（`pBdr` 与 `tcBorders`——色是用户可改的单槽，要做就把本轮这套
「bg 基准 + 改过就作废」搬过去）；`fldChar` 三对；`outline|val`；表/节一族
（`tblStyle|val`、`col|w`/`col|space`、`wAfter|*`、`gridAfter|val`、`pgNumType|*`、
`smartTag|*`、`legacy|*`）；承接未动项 `gridCol`/`tcW` 的 ±5 缇、`w:cols` 的 `equalWidth`、
`ind|left` 的列表缩进覆盖、`docPr|id` 重排、`lvlJc` 深层 `center`。另有一件要定口径：
`theme1.xml` 进不进普查清单（加进 `PARTS` 会让四十来对主题槽一次进分母且全「保留」——
那是灌水；更可能是单开一本部件账）。
## v0.165（D24）——段落与逐格边框：主题引用按块补回，以及「补丁跑了一半」

往返账**正文属性 78.4% → 78.6%**（218/278 → 221/281），整体 41.2% → 41.5%，掉了 334 不动、
值变 17 不动。三对新对进账（`top|themeColor`/`themeTint`/`themeShade`，全「保留」）。
保真账本按对仍 99.0%，md5 仍 `95846f03…`/`aab9813c…`；四条变异腿与上轮一字不差。

### 边框的颜色：屏上色有槽，源件说的那三枚没有

`edgeCss` 是「主题优先、字面兜底」：主题解析得出来时，`w:color` 那枚字面色就没有出口；
而 `bd*` 那一格只装得下**解析后的屏上色**。导出时包按屏上色发 `w:color`，源件的
`w:themeColor="accent1" w:themeTint="99" w:themeShade="BF"` 整笔消失，字面色也被换成
了解析结果（`FF0000` → `adbbd4`）。

新载荷 `data-bdr` 按边分格：`edge;color;themeColor;themeTint;themeShade;screen`。`screen`
是导入那一刻的屏上色，写侧拿它当「用户改过色没有」的判据——对不上就整笔作废，否则
Word 按主题解析，用户换的颜色在屏上、在纸上都看不见。

### 为什么这一族不能按元素出现序贴

`w:top` 在包里同是 `w:tblBorders`、`w:tcBorders`、`w:pBdr` 的子元素（`w:tcMar` 里还有
同名的一枚），全局出现序分不清谁是谁。所以按**块**切：先切 `<w:pBdr>` / `<w:tcBorders>`，
块内再按边名找。闸门是「块数 === 登记数」，而登记只在真发得出这个块时才 push——段落走
`paraFormatOf`、逐格走 `bordersOf`，两族两本账。

### 一个只成功了一半的补丁

第一版逐枚抓 `\sw:xxx="…"`，而拼串时第一枚属性没有前导空格：`w:color` 整条被跳过，
主题三枚照贴不误——写出来的字节是 `w:color="adbbd4" … w:themeColor="accent1"`。
**既不是全哑**（那还有 `touched` 兜着），**也不是错位**（那会被计数闸门拦住），
而是同一枚元素上一半属性生效、另一半静默丢掉。修法是把归一化写进 `mergeTagAttrs`
自己，而不是要求每个调用方记得加那个空格。

### 新读点会绕过变异腿的锚点

第一版的 `borderOrigin` 自己 `attr(...)` 读三枚主题属性，`no-themeshade` 那条腿当场从
96.5% 抬到 **97.7%**——注入锚点在 `themeRefParts` 里，新读点不在射程内。覆盖率**往上**
跳不是成绩，是腿漏了一块。把读点收回 `themeRefParts` 之后，四条腿与上轮一字不差。

### 门禁

tsc 0、build ✓；结构测试 **118 → 131 项**全绿（含反例：改过色就不补主题引用、删掉的边
不补、缺 `screen` 的段整段丢、脏键整键丢；以及「每一枚属性都到了」那几条——只断言
「补丁跑过」是抓不住半失效的）。

D25 顺延：字符边框 `w:bdr` 的主题引用（同形，可整族搬）；`w:pBdr/w:between` 与 `w:bar`
（要补的是元素不是属性，与 `patchBeforeElem` 同族）；`fldChar` 三对；`outline|val`；
表/节一族（`tblStyle|val`、`col|w`/`col|space`、`wAfter|*`、`gridAfter|val`、
`pgNumType|*`、`smartTag|*`、`legacy|*`）；承接未动项 `gridCol`/`tcW` 的 ±5 缇、
`w:cols` 的 `equalWidth`、`ind|left` 的列表缩进覆盖、`docPr|id` 重排、`lvlJc` 深层
`center`。另有一件要定口径：`theme1.xml` 进不进普查清单。
## v0.166（D25）——字符边框的主题三枚：先给属性名分家，再谈补丁

往返账**正文属性 78.6% → 78.9%**（221/281 → 224/284），整体 41.5% → 41.8%，掉了 334 不动、
值变 17 不动。三对新对进账（`bdr|themeColor`/`themeTint`/`themeShade`，全「保留」），
连同原有的 `val`/`sz`/`space`/`color` 四对，字符边框七对齐全。保真账本 md5 仍
`95846f03…`/`aab9813c…`；四条变异腿与上轮一字不差。

### 一个属性名，两种 grammar

v0.152 起字符边框的载荷叫 `data-bdr`，语法是定序四格 `val;sz;space;color`；上一轮给段落/
逐格边框新开的那一枚也叫 `data-bdr`，语法却是「按边分格」。两枚今天不打架（一个长在
`span`、一个长在 `p`/`td`），但同一个名字挂两种 grammar，读的人迟早按错的那一种解。
字符这一枚改名 `data-rbdr`，段落/逐格保持 `data-bdr`。改动只碰临时 HTML，不涉及已存文件。

### 这一族缺的比上一轮少

包的 `IRunOptions.border` 有 `color` 槽，写手一直按字面色发得出来——真正掉队的只有主题
三枚。于是补丁也不一样：`<w:bdr>` 在 document.xml 里只长在 run 的 `rPr` 上（表级/段落/
逐格边框用的是逐边元素 `w:top`…），没有同名歧义，也不覆盖包自己写的属性，所以直接回到
`patchElemAttrs` 的**元素级追加**，不需要上一轮那套块级对位。登记点选在 `withCharExtra`
——它是发这个元素的唯一出口（五条 run 路径都过这里），与 caps 同一条纪律。

### 没有可编辑槽，就没有「用户改过色」这一档

上一轮的判据是「`screen` 与当前 `bd*` 的色对不上 = 用户改过色」。字符边框没有第二个槽：
载荷就是唯一事实源，界面上也没有改这个颜色的命令——照搬那套 gate 只会写出一条永远不
命中的判据。

但两槽分工的另一半仍然有用：**屏上要画解析后的色**（主题优先是 Word 的语义，字面色只是
兜底）。`RunProps.bdr` 因此多了一个 `screen`（解析结果，只给屏上），`color` 仍是源件的
字面色、只往存盘走——与 v0.159 的 `w:u` 同一套分工。

### 门禁

tsc 0、build ✓；结构测试 **131 → 138 项**全绿（含反例：没主题三格就不补、脏格整格丢、
主题件里没有 clrScheme 时屏上落回字面色而载荷不动）。

D26 顺延：`w:pBdr/w:between` 与 `w:bar`（要插元素不是合并属性）；`fldChar` 三对；
`outline|val`；表/节一族（`tblStyle|val`、`col|w`/`col|space`、`wAfter|*`、`gridAfter|val`、
`pgNumType|*`、`smartTag|*`、`legacy|*`）；承接未动项 `gridCol`/`tcW` 的 ±5 缇、
`w:cols` 的 `equalWidth`、`ind|left` 的列表缩进覆盖、`docPr|id` 重排、`lvlJc` 深层
`center`。另有一件要定口径：`theme1.xml` 进不进普查清单。
## v0.167（D26）——段落第五边 `w:between`：真身插回去，替身按住

往返账**正文属性 78.9% → 79.3%**（224/284 → 230/290），整体 41.8% → 42.4%，掉了 334 不动、
值变 17 不动。六对新对进账（`between|val`/`sz`/`space`/`color`/`themeColor`/`themeTint`，
全「保留」）。保真账本 md5 仍 `95846f03…`/`aab9813c…`，四条变异腿与上轮一字不差。

### 它不是「又一条边」

`w:between` 画在**相邻两段之间**，只在两段边框签名一致时才画。读手把它落在**本段的下边框**
上（屏上正好是「这一段下面有根线」），于是模型里 `bdBottom` 多了一条源件根本没有的
`w:bottom`——照常发它、再补一枚 `w:between`，Word 里就是两根线。第一版探针正是这个形状。

所以这一轮的动作是两个：把真身插回 `<w:pBdr>`（CT_PBdr 的序在四条之后、`w:bar` 之前），
同时把替身按住——屏上那条下边框的色与载荷里的 `screen` 一致，就认定它是替身，`w:bottom`
不发；对不上说明用户换过色，那时 between 作废、下边框照发。

### 四边那套「从 CSS 反推」在这里不成立

四条边的线型/粗细能从 `bd*` 的规范串反推，`between` 没有 CSS 槽，反推不出来。所以
`data-pbdr` 把 `val/sz/space` 原件一起带上，并用尾格 `hidden` 区分两种情形：

```
dotted;6;2;FF9900;accent2;99;;F8CBAD      ← 画了（串中间那段）：屏上有替身可比
dotted;6;2;FF9900;accent2;99;;F8CBAD;1    ← 没画（串尾/被显式下边顶掉）：原样带回
```

### 一次及时的收手

夹具里那两段的上边框最初写了 `w:space="0"`，跑账时 `top|space` 多出一笔值变——写侧把
`0` 与「没写」并成一路（`w:space` 缺省就是 0，语义等价但字面丢）。这与 between 无关，
收进来只会把「掉了 334 / 值变 17」这条基线搅浑。夹具改回不带 `w:space`，这一档记进顺延。

### 门禁

tsc 0、build ✓；结构测试 **138 → 147 项**全绿（含反例：改过色就不补 between、替身那条
下边框不发、串尾那一段原样带回、插入位置在四条之后）。

D27 顺延：`pBdr`/`tcBorders` 的显式 `w:space="0"`（并进 `data-bdr` 第 7 格即可）；
`w:bar`（第六条边，写侧连替身都没有，得单独定判据）；`fldChar` 三对；`outline|val`；
表/节一族（`tblStyle|val`、`col|w`/`col|space`、`wAfter|*`、`gridAfter|val`、`pgNumType|*`、
`smartTag|*`、`legacy|*`）；承接未动项 `gridCol`/`tcW` 的 ±5 缇、`w:cols` 的 `equalWidth`、
`ind|left` 的列表缩进覆盖、`docPr|id` 重排、`lvlJc` 深层 `center`。另有一件要定口径：
`theme1.xml` 进不进普查清单。
## v0.168（D27）——边框族收尾：显式 `w:space="0"` 与第六条边 `w:bar`

往返账**正文属性 79.3% → 79.7%**（230/290 → 236/296），整体 42.4% → 42.9%，掉了 334 不动、
值变 17 不动。六对新对进账（`bar|val`/`sz`/`space`/`color`/`themeColor`/`themeTint`，全「保留」），
`top|space` 的那笔值变也回到「保留」。保真账本 md5 仍 `95846f03…`/`aab9813c…`，四条变异腿
与上轮一字不差。

### `w:space="0"`：语义上没用，字面是源件说过的话

`borderSpacePt` 把「显式 0」与「没写」并成一路——写成 CSS 都是 0 padding，Word 缺省也是 0。
语义没错，字面上丢了一枚源件真写过的属性。修法是给 `data-bdr` 补第 6 格 `space`，只记 `"0"`
这一档（非零值 padding 那条链本来就能还原）。写回时多一道守卫：用户把内边距调大了就以用户
为准，载荷里的 0 不能用。

### 一个没想到的岔子

第一版只加了「记 space」，夹具里却见不到 `<w:top w:space="0">`——`borderOrigin` 有一道取舍
闸门（字面色与屏上一致、没有主题引用 → 这条边「什么都不用补」，整条不载荷），而「只有
space=0 有话说」的边恰好落在闸门外面。**载荷的取舍条件本身就是一道闸**，加字段时得回头
问一句「这条边进得来吗」。

### `w:bar`：没有屏上替身，所以最省事

段落侧边的竖线（合同/公文里的「条」）。屏上从没画过它，也就没有 `between` 那种「替身」问题
——没有 `screen`、没有 `hidden`、没有判据，`data-pbar` 有值就插一枚，位置在 CT_PBdr 序的末尾。

边框族到此闭环：四边走 `data-bdr`（按边分格 + screen 判据）、第五边走 `data-pbdr`（九格 +
hidden）、第六条走 `data-pbar`（七格 + 无判据）。三种形状不是不统一，是三者「屏上有没有
替身、能不能反推」各不相同。

### 门禁

tsc 0、build ✓；结构测试 **147 → 155 项**全绿（含反例：用户调过边距就不写 0、没 bar 载荷
就不插、bar 位置在 between 之后）。

D28 顺延：`fldChar` 三对；`outline|val`；表/节一族（`tblStyle|val`、`col|w`/`col|space`、
`wAfter|*`、`gridAfter|val`、`pgNumType|*`、`smartTag|*`、`legacy|*`）；承接未动项
`gridCol`/`tcW` 的 ±5 缇、`w:cols` 的 `equalWidth`、`ind|left` 的列表缩进覆盖、
`docPr|id` 重排、`lvlJc` 深层 `center`。另有一件要定口径：`theme1.xml` 进不进普查清单。
## v0.169（D28）——表样式：把一条从没跑过的路跑通，顺带补上「首行该粗不粗」

往返账**正文属性 79.7% → 80.1%**（236/296 → 238/297），整体 42.9% → 43.2%，掉了 334 → **333**、
值变 17 不动。`tblStyle|val` 从「掉了」变「保留」，`tblStylePr|type` 新进分母且保留。
保真账本 md5 仍 `95846f03…`/`aab9813c…`，四条变异腿与上轮一字不差。

### 为什么这条路一直没跑过

夹具里三张表都写着 `<w:tblStyle w:val="TableGrid"/>`，可 `styles.xml` 里**没有这枚定义**。
读手挂标签的条件是「这个 id 认得出」，认不出就不挂（挂上去是一枚指向不存在定义的引用）——
于是 `data-tstyle` 从来没出现过，`w:tblStyle` 也就从来没被写回去。这条账在「掉了」里躺了
很多轮，不是写手不会写，是输入里没有让它出场的东西。补上定义后三件一起验：引用、定义
（`w:name`/`w:basedOn`/`w:tblStylePr`）、条件层型名——全部原样回来。

### 顺带撞见的真问题：首行该粗不粗

`w:tblStylePr` 里的 `w:rPr/w:b`（首行加粗）此前只走了一半：进了样式快照、跟着 styles.xml
回去，**屏上从没兑现**——表里首行看着是常规字重，Word 打开却是粗的。这是 v0.164 那条
「屏上对、纸上不对」的镜像。

修法是给 `baseRunProps` 加一个 `seed`（比段落样式更弱的一层），表格那趟按位置算出条件层的
run 传进格内段落；位置梯子复用 `condLadderAppearance`（底纹/边框/行高早就共用它，run 是
第四族）。

### 账本对这次修复一无所知

修完跑账逐字节相同——**账本按属性记，元素级的增删它看不见**：`<w:b/>` 是裸元素、一个属性
都没有，`b|val` 那对只统计写了 val 的那些。这不是账本的 bug，是它的口径边界：它量「源件
说过的属性回来了没有」，量不了「源件没说过的东西有没有多出来」。这次靠结构测试钉住。

### 门禁

tsc 0、build ✓；结构测试 **155 → 159 项**全绿（含反例：次行不该加粗、tblLook 闸门关掉就
不加粗）。

D29 顺延：表样式自己的 `w:rPr`（常驻 run）接到表内文字上；`fldChar` 三对；`outline|val`；
表/节一族（`col|w`/`col|space`、`wAfter|*`、`gridAfter|val`、`pgNumType|*`、`smartTag|*`、
`legacy|*`）；承接未动项 `gridCol`/`tcW` 的 ±5 缇、`w:cols` 的 `equalWidth`、`ind|left` 的
列表缩进覆盖、`docPr|id` 重排、`lvlJc` 深层 `center`。另有一件要定口径：`theme1.xml` 进不进
普查清单。
## v0.170（D29）——页码型别与起始值：从「只读记账」升成往返

往返账**正文属性 80.1% → 80.8%**（238/297 → 240/297），整体 43.2% → 43.5%，掉了 333 → **331**、
值变 17 不动。`pgNumType|fmt` 与 `pgNumType|start` 两对从「掉了」变「保留」。保真账本 md5 仍
`95846f03…`/`aab9813c…`。

### 它在顺延清单里躺了十五轮，其实包一直有槽

v0.155 把这枚记成「只读」：读出来就扔，注释写「写侧没有对应槽（包只发纸型/页边距/分栏数）」。
这一轮翻 `ISectionPropertiesOptions` 才发现 `pageNumbers?: IPageNumberTypeAttributes`——直接落成
`<w:pgNumType>`，`formatType` 原样写进 `w:fmt`、`start` 写进 `w:start`。

所以这一轮没写任何打包后补丁，只是把渠道打通：`DocxSection.pageNum` → `PageSetup.pageNum` →
`resolvePage` → `sections[].properties.page.pageNumbers`。两条读腿都补了（读手走 `attr` 漏斗进
账本，`docxToDocMeta` 那条正则留给回退导入路径）。

### 包的「无条件 push」

跑探针时件里多了一枚 `<w:pgNumType/>`——包的 `SectionProperties` 构造器是无条件 push，没给
pageNumbers 也照样落一个空元素。Word 读它等于全是默认、渲染没差别，但那是源件没说过的一句话。
加了一笔 `dropEmptyPgNum`：没有 pageNum 时把空的那一枚摘掉，有属性的不动。账本对这类事完全瞎
（裸元素没有属性），只能靠结构测试钉。

### no-attr 腿动了 0.2 个点

59.2% → **59.4%**：新读的 `start` 走 `attrNum`，而 `attrNum = attr ?? attrL`——`attr` 被注入掉
之后仍能从 `attrL` 读到。不是腿坏了，是数值档本来就有两条路。

### 门禁

tsc 0、build ✓；结构测试 **159 → 165 项**全绿（含反例：没声明就不发 `w:pgNumType`、元素位置要
在 `pgMar` 之后 `cols` 之前）。

D30 顺延：表样式自己的 `w:rPr`（常驻 run）接到表内文字；`fldChar` 三对；`outline|val`；
表/节一族（`col|w`/`col|space`、`wAfter|*`、`gridAfter|val`、`smartTag|*`、`legacy|*`）；
承接未动项 `gridCol`/`tcW` 的 ±5 缇、`w:cols` 的 `equalWidth`、`ind|left` 的列表缩进覆盖、
`docPr|id` 重排、`lvlJc` 深层 `center`。另有一件要定口径：`theme1.xml` 进不进普查清单。
## v0.171（D30）——表样式的那一半：常驻 run 上屏，层序要摆对

往返账**正文属性 80.8% → 80.9%**（240/297 → 241/298），整体 43.5% → 43.6%，掉了 331 不动、
值变 17 不动。`i|val` 进分母且保留。保真账本 md5 仍 `95846f03…`/`aab9813c…`，四条变异腿与
上轮一字不差。

### v0.169 只接了条件层，常驻那半还在纸上

表样式对文字有两份说法：常驻的 `w:style/w:rPr`（整张表都吃）与条件层的 `w:tblStylePr/w:rPr`
（按位置吃）。上一轮接了后一半（首行加粗），前一半依旧只进样式快照、跟着 styles.xml 回去——
Word 里是斜体的表，打开我们这边是正体。

这一轮把它接上：`tableStyleRun` 沿样式链读一遍 `w:rPr`，当成 `baseRunProps` 的 seed。

### 层序：表样式最弱

Word 的次序是 **字符 > 段落 > 表**。`baseRunProps` 本来就是「先 seed、再逐层盖」，所以把表样式
当 seed 正好。结构测试用反例钉死：表样式说斜体、段落样式写 `<w:i w:val="0"/>`，那一格**不该**
斜体。`TableNormal` 不进链（Word 会用自己的定义换掉它）。

### 这一轮账本为什么动了

夹具给表样式加了裸元素 `<w:i/>`。普查那条「元素在场而无 `w:val` 记 `val=1`」的口径（v0.161）
把它记成 `i|val=1`；写出包里的 run 也带 `<w:i/>`，同样归一 → `i|val` 从「宇宙里没有」变成
「进分母且保留」。**这一动不是我们多写了属性，是夹具多了一种写法。** 显示那一半（`<em>`、
以及「段落压过表」的反例）仍然只能靠结构测试。

### 门禁

tsc 0、build ✓；结构测试 **165 → 167 项**全绿。

D31 顺延：`fldChar` 三对；`outline|val`；表/节一族（`col|w`/`col|space`、`wAfter|*`、
`gridAfter|val`、`smartTag|*`、`legacy|*`）；承接未动项 `gridCol`/`tcW` 的 ±5 缇、
`w:cols` 的 `equalWidth`、`ind|left` 的列表缩进覆盖、`docPr|id` 重排、`lvlJc` 深层 `center`。
另有一件要定口径：`theme1.xml` 进不进普查清单。
## v0.172（D31）——表行余量：补丁长到「容器可能不存在」这一档

往返账**正文属性 80.9% → 82.0%**（241/298 → 246/300），整体 43.6% → 44.3%，掉了 331 → **328**、
值变 17 不动。`gridAfter|val`、`wAfter|w`、`wAfter|type` 三对从「掉了」变「保留」，另有两对
`trHeight|*` 随夹具新增进账。保真账本 md5 仍 `95846f03…`/`aab9813c…`，四条变异腿与上轮一字不差。

### 它在 v0.155 是「纯只读记账」

`w:trPr` 里的 `w:gridAfter`（这一行末尾空过几格）与 `w:wAfter`（行末留白：宽与档位）读出来就扔，
注释写「包没有这两枚元素的槽」。这一轮接上：`data-trpr` kv 载荷随 `<tr>` 进出。

### 补丁的第三档：容器自己也可能不存在

前几族的落点分别是「改属性」（v0.164 shd）、「整片替换」（v0.163 tblBorders）、「往块里插
子元素」（v0.167 between/bar）。这一族多一档麻烦：**连 `<w:trPr>` 本身都可能没有**——包只在
行有高度/表头属性时才发它。

于是补丁有两种落点：行里已有 `<w:trPr>` 就按 CT_TrPr 的序插在 `cantSplit`/`trHeight`/`tblHeader`
之前；没有就现开一枚，位置必须是 `<w:tr>` 的第一个孩子。两条都在结构测试里钉着。

### 门禁

tsc 0、build ✓；结构测试 **167 → 173 项**全绿（含两条反例：没载荷就不开 trPr、`w:type` 缺省
不发）。

D32 顺延：`fldChar` 三对；`outline|val`；`col|w`/`col|space`（不等宽分栏）；`smartTag|*`、
`legacy|*`；承接未动项 `gridCol`/`tcW` 的 ±5 缇、`w:cols` 的 `equalWidth`、`ind|left` 的列表
缩进覆盖、`docPr|id` 重排、`lvlJc` 深层 `center`。另有一件要定口径：`theme1.xml` 进不进普查清单。

## v0.173（D32）——对标 WPS 重新评估：补两处高频外壳，把导入链的 8 棵树收成 1 棵

一句立项：用户点名「评估已有组件和 WPS 还有哪些差距，继续完善功能和优化性能」。
这一轮出一份**当前状态**的差距评估、补两处用户天天撞的功能、做一处能报出前后数的性能优化。
仓库原有 `docs/lo-gap-assessment.md`（对 LibreOffice，2026-10-21）与 `docs/gap-closure.md`
（2026-10-17 补齐方案）的数据已过期：那时 docx 属性级覆盖还是 17.6% / 50.7%，
P2 里列的拼写、协同、VBA、PDF 改字后来都落地了。

### 一、差距评估：`docs/wps-gap-assessment.md`（新）

按四组件 + 外壳逐项对照 WPS 桌面版常见功能面，档位 A/B/C/D，另列「本项目有而 WPS
桌面版没有对等价位」与「没量 / 不确定」。三条结论：

- **主链路能用**，四组件的打开 → 编辑 → 保存 → 导出 PDF 全通；
- **深度差在「写回去」**：docx 读手保真按对 **99.0%**（已到顶），往返账却只有
  正文 **82.0%**、图形壳 **8.8%**、合计 **44.3%**——图形壳是最大单点欠账，
  且它不是 N 个 bug，是「模型没有槽」的整族设计缺口；
- **广度差在外壳**：无 Ribbon/菜单栏、内容区无右键菜单、无独立打印预览、
  Writer/Impress/Calc 无视图缩放、Impress 无母版编辑。WPS 的云 / AI / 模板 / 移动端
  按定位明确不追。

### 二、功能：导航窗格与格式刷（两处此前四组件全无）

- **文档结构图**：`src/lib/outline.ts` 立 `outlineOf` / `activeOutlinePos`，
  `toc-extension.ts` 的目录节点改为复用同一份遍历（**单一事实源**，不许两处各写一遍
  `doc.descendants`）；Writer 左侧侧栏按标题 1–4 汇总、点击跳转、当前节高亮、随编辑刷新。
  **关着时连一次全文遍历都不跑**——导航不能变成每键一次的全量扫描。
- **格式刷**：`src/lib/format-painter.ts` 立纯函数。单击取源格式 → 拖选目标即刷，
  双击锁定连刷，Esc / 再点按钮退出；是「替换」不是「叠加」（先清可刷 mark 再重设）。
  只刷字符外观与非默认对齐，**批注 / 书签 / 修订 / 超链接这类带身份的 mark 整列排除**
  （复制它们等于在目标上造第二枚同 id 的锚，或把别人的修订署名搬过去）；缩进、行距、
  段距不搬（与页面上下文绑定的数值，照搬会把版心搬歪）。按钮 tooltip 里写明这些边界。
  Esc 只挂在 window 一处：待刷时焦点可能在工具条按钮上，编辑器的按键钩子接不到。

### 三、性能：同一份 `document.xml` 从 8 次 `parseXml` 收成 1 次

`docxToHtmlFidelity` 里有 7 个「跑正文前按名查问」的只读扫描（文档标记 / 形状壳 /
VML 壳 / cnfStyle / DrawingML），加上正文 `run()`、文档背景、节属性——**8 处各自
`parseXml(documentXml)` 一次**，同一份最大部件被扫 8 遍、建 8 棵树，7 棵查完即丢。
v0.153 的注释自己写过「各 parse 一次是浪费」，后面几族一路叠到 8 份。

这一轮入口只建一次 `doc`，7 个 note*、正文、背景、节属性共用。顺序纪律：
`docBackgroundOf` / `sectionOf` 移到 `run()` **之前**读——`run()` 里的
`applyThemeFonts` 会就地补 rFonts 的具名字体属性，让这两族读改动前的树，与优化前逐字同义。

判据脚本 `scripts/bench-docx-parse.mjs` 三把尺（静态调用点、8 树/1 树微基准、
端到端预热 2 趟 + 5 趟中位；夹具纯合成、STORE 压缩）：

| N 段 | 改前 | 改后 | 变化 |
|---:|---:|---:|---:|
| 500 | 61.5ms | 34.0ms | −44.7% |
| 2000 | 191.4ms | 99.3ms | −48.1% |
| 8000 | **897.7ms** | **389.9ms** | **−56.6%** |

微基准同一串 XML 建 8 棵树 / 1 棵树：N=8000 为 525.9ms / 61.0ms（8.62×），
端到端省下的 507.8ms 与这个差值同量级。静态计数 `parseXml(documentXml)` **8 → 1**。

### 四、门禁与账上的数

| 腿 | 数 |
|---|---|
| tsc / build | 0 / ✓（chunk 大小与 pdf-lib 动态导入两条提示为既有） |
| 结构测试 | runprops **173**、v0.173 新功能 **29**、PDF 文本编辑全通过 |
| 保真账 | **99.0% / 98.4%** 一字不动；`modules` 59 → **61**（新增两个 lib 文件，唯一变动） |
| 往返账 | 正文 **246/300 = 82.0%**、图形壳 **28/319 = 8.8%**、合计 **274/619 = 44.3%**；掉 328、值变 17，全部不动；md5 `01f93dfe…`/`da817a7…` 两次复跑逐字节相同 |
| 四条变异腿 | **52.5 / 59.4 / 99.0 / 96.5**，与上轮一字不差；写完已用干净腿复位（`d52d234a…`/`3bd39cf8…`） |
| 提交 | `c2b9a0f`（代码）+ 本笔（文档与账本） |

一句话判据：**改了读手的调用结构，两本账的覆盖率与分值一分没动**——提速没有换来语义漂移。

### 五、顺延（D33）与明确不做的

- 评估文档第一档照旧：**图形壳 8.8%** 整族设计、Writer 视图缩放 / 独立打印预览 /
  内容区右键菜单、Impress 母版编辑与缩放、PDF 查找替换；
  D32 原账不动：`fldChar` 三对、`outline|val`、`col|w`/`col|space`、`smartTag|*`、
  `legacy|*`、±5 缇、`w:cols` `equalWidth`、`ind|left`、`docPr|id`、`lvlJc`，
  `theme1.xml` 进不进普查清单仍要定口径。
- **不做**：WPS 云 / AI / 模板商城 / 移动端 / 100+ 语言 UI（定位差异）；
  本轮性能数字是合成夹具，不冒充真件打开耗时；也没跑真机 WPS 对撞（本机只有
  Word 16.0 / PowerPoint 16.0 的 COM 回归链路）。
- **push 仍没成功**：代理对 github.com:443 返 CONNECT 502，本地继续领先 origin/main；
  网络恢复后 `cd /e/OpenOffices && git push origin main`。

## v0.174（D33）——外壳再补两处，把导入链剩下的 7 趟全树摊平收成 1 份索引

一句立项：接着 `docs/wps-gap-assessment.md` 第一档顺延继续做。上一轮补的是
「一眼认不出的 WPS」里最显眼的两处（导航窗格、格式刷），这一轮补**视图缩放**与
**内容区右键菜单**；性能承接 v0.173——解析收成 1 次之后，剩下的重复全树遍历也收掉。

### 一、Writer 视图缩放（`src/lib/view-zoom.ts`）

七档刻度（50/75/100/125/150/175/200%），加减按钮、下拉、100% 复位与
**Ctrl+滚轮**四个入口共用同一串刻度（滚轮也走档位，不会出现「滚出 1.1 而下拉里
没这一项」的错位）。只作用于屏上 `.doc-page`，**打印与导出 PDF 永远 100%**：
版心几何本来就由 React 内联 style 驱动，所以 `@media print` 里用
`zoom: 1 !important` 把内联值压回去。Ctrl+滚轮监听挂在 `.doc-scroll` 而非 window，
别的标签/面板不会跟着缩放。

### 二、内容区右键菜单（`src/lib/context-menu.ts`）

条目表是纯函数：按「有没有选区、光标在不在表格、导航开没开、格式刷待刷没刷」
决定出现哪些项与哪些灰掉；命令执行留在组件一处。撤销/重做、剪切/复制/粘贴/全选、
查找替换、格式刷、导航开关、插入分页符，表格语境再多「插行/删行」。
剪切复制走 `textBetween` + 剪贴板 API，粘贴走 `{type:'text'}` 节点而不是字符串
（字符串会被当 HTML 解析，内容里的 `<` 会吞字）；剪贴板不可用给状态栏提示、
不假装成功。点菜单外或 Esc 收起，菜单开着才订阅事件。

### 三、性能：5 个 `note*` 的重复全树遍历 → 一份索引

v0.173 把 `document.xml` 的 8 次 `parseXml` 收成 1 次，但 7 处入口里的
**5 个 `note*` 只读扫描仍各自 `allDesc(doc, tag)` 摊平全树**（16 个调用点）；
VML / Drawing 两族更贵——「每个 pict/drawing × 25 个标签 × 一次子树摊平」。

这一轮 `buildDocIndex(doc)` 一趟递归收齐三样：全局按 local name 分组的后代、
每个 pict/drawing 自己的后代（**不含容器自身**，与 `allDesc` 同义）、深度优先的
第一枚 `schemeClr`。5 个 `note*` 改为查表/按标签一趟分派。
**重新数过**：旧写法是 5 个函数、16 个 `allDesc` 调用点（外加 1 个 `findDesc`），
不是注释里沿用的「7 个扫描」——7 是「5 个 note* + 背景 + 节属性」的入口调用数。

判据用**同进程 A/B**：把改前读手导出成副本（`git archive 36d27e8 src/lib |
tar -x -C tmp/bench-old`），两腿在同一进程、同一夹具上交替顺序各跑 10 样本取中位，
机器负载对两边相同；顺带逐字比对两腿 HTML：

| 夹具 | A（改前） | B（本轮） | 降幅 | HTML 逐字相同 |
|---|---:|---:|---:|---|
| 纯文字 N=8000 | 330.3ms | 250.4ms | **−24.2%** | ✓ |
| 图形密集 N=1600（每段 pict+drawing 各一枚） | 271.0ms | 194.0ms | **−28.4%** | ✓ |

跨进程复跑的绝对值随机器负载浮动（纯文字改前 353.9ms / 改后 255.7ms，
图形密集 327.9ms / 205.8ms），所以判据取同进程 A/B，不取两次独立运行的差。

### 四、门禁与账上的数

| 腿 | 数 |
|---|---|
| tsc / build | 0 / ✓ |
| 结构测试 | runprops **173**、v0.173 功能 **29**、v0.174 外壳 **40**、PDF 文本编辑全通过 |
| 保真账 | **99.0% / 98.4%**，探针记录对 **715**、已查问 **23396** 全不动；只 `modules` **61 → 63**（新增两个 lib 文件） |
| 往返账 | 正文 246/300 = 82.0%、图形壳 28/319 = 8.8%、合计 274/619 = 44.3%，掉 328 / 值变 17 全不动；md5 `fdef3380…`/`da817a7…` 两次复跑逐字节相同 |
| 四条变异腿 | **52.5 / 59.4 / 99.0 / 96.5** 一字不差；mut 腿写完已用干净腿复位到 `964753f5…`/`7ecc64d6…` |
| 提交 | `5d8c30d`（代码）+ 本笔（文档与账本） |

**这一轮最硬的判据**：查问顺序整个变了（按文档序分派，不再按标签分组），
两本账的覆盖率、分值、探针记录对却一分没动——说明索引收齐了每一枚元素与属性，
没有漏账；HTML 逐字相同说明提速没换来语义漂移。

### 五、顺延（D34）与明确不做的

- 评估第一档剩余：Writer **独立打印预览**、标尺、Impress 母版编辑与缩放、
  PDF 查找替换；最大一块仍是**图形壳往返 8.8%** 的整族设计（289 对同源，模型无槽）。
- D32/D33 原账不动：`fldChar` 三对、`outline|val`、`col|w`/`col|space`、
  `smartTag|*` / `legacy|*`、±5 缇、`w:cols` `equalWidth`、`ind|left`、
  `docPr|id`、`lvlJc`；`theme1.xml` 进不进普查清单仍要定口径。
- **不做**：右键菜单里的「字体/段落模态对话框、粘贴为纯文本」这类需要新面板的项；
  任意百分比缩放（档位制已够用，且免去下拉错位）；本轮 A/B 数字仍是合成夹具，
  不冒充真件打开耗时。

## v0.175（D34）——独立打印预览 + pptx 一页一份 `.rels` 索引

一句立项：接着 `docs/wps-gap-assessment.md` 第一档顺延做。Writer 的导航/格式刷/
缩放/右键已补齐，这一轮补**独立打印预览**；性能换到演示侧，收掉 pptx 导入里
同一份 `.rels` 被解压解析三遍的固定开销。

### 一、Writer 独立打印预览（`src/lib/print-preview.ts`）

状态切换式，不另画一份文档：**同一棵 DOM 切到只读**——`editor.setEditable(false)`、
一条 CSS 规则把 `editor-pane` 的所有直接子级（两条工具条 + 全部内联面板）收起来，
只留纸面与预览条；侧栏另按一条规则隐藏。预览条给缩放（复用 v0.174 那份
`zoomControls`，两处不各写一遍刻度）、打印、导出 PDF、关闭，Esc 也可退出。
页数估算从状态栏那行 `Math.ceil(docH / …)` 抽成 `estimatePages`，状态栏与预览条
共用一份口径。预览态不弹编辑右键菜单；`window.print()` 仍走既有 `@media print`，
`zoom:1 !important` 保证纸面不被预览缩放带偏。

**诚实边界**：这是**单张纸面的只读镜像 + 缩放**，不是逐页翻页的真预览；
分页由 Chromium 的打印样式决定，屏幕上不重排、不切页。这句写在 lib 与 tooltip 里。

### 二、性能：同一页 `.rels` 从 3 次解压 + 3 次建树收成 1 份索引

`slideToDeckSlide` 里三条路各读各解析同一份 `slideN.xml.rels`：
① 形状/图片的 `r:embed`（旧 `parseRels`）；② 单页背景图
（`relsText` → `bgOf` → `imageFromRid` → 旧 `relsEntries`）；③ 演讲者备注
（`parseNotes` 里再读一次文件 → 旧 `relsEntries`）。后两条每调用一次都重建整棵关系树。

这一轮 `slideRelsOf(text)` 在页入口解析一次，给出 `byId` / `entries` 两种视图，
三处共用；母版 rels 也走同一个解析器（全库只有一份，不值得为它再开一条分支）。
每枚 `Id` / `Type` / `Target` 仍走 `ga` 漏斗按名查问——**查问次数少了，集合一枚不少**。

判据 `scripts/bench-pptx-import.mjs`：合成 pptx（每页带背景图、形状图、备注与
rels），同进程 A/B（改前读手副本 `git archive 36d27e8 src/lib | tar -x -C tmp/bench-old`，
v0.174 未改 pptx-import.ts，故那份即改前），交替顺序各 10 样本取中位：

| 页数 | A（改前） | B（本轮） | 降幅 | 导入结果签名相同 |
|---:|---:|---:|---:|---|
| 10 | 11.5ms | 4.9ms | **−57.5%** | ✓ |
| 120 | 68.1ms | 49.7ms | **−27.1%** | ✓ |

签名比的是页数 / 标题 / 备注 / 背景图在场与否（形状 id 带 `Date.now()`，不比）。
端到端当前读手：10 页 7.3ms、40 页 16.2ms、120 页 67.8ms（5 趟中位）。

### 三、门禁与账上的数

| 腿 | 数 |
|---|---|
| tsc / build | 0 / ✓ |
| 结构测试 | runprops **173** + v0.173 功能 **29** + 外壳 **63**（本轮 +23）+ PDF 文本编辑全通过 |
| docx 保真 / 往返 | **99.0% / 98.4%**、**82.0% / 8.8% / 44.3%**（掉 328、值变 17）全不动；往返账 `def87db8…`/`da817a7…` 两次复跑一致；四条变异腿 52.5 / 59.4 / 99.0 / 96.5 一字不差，mut 后干净腿复位到 `a749b93d…`/`d5aa905f…` |
| pptx 保真 | **70.1% / 74.3%**、selftest 42 应见 / 19 不应见双向断言全绿；`--mut no-ga` 42 条全红（探针有牙），复位到 `aed59e05…`/`0d57217c…` |
| 账本变动 | 五份账本各一行 `modules`：docx 三本 **63 → 64**（新增 `print-preview.ts`）、pptx 两本 **58 → 64**（这本账自 v0.141 后首次重跑，一次补齐累计模块数） |

### 四、一处**发现但按房规没落地**的优化（留给下一轮）

构建一直挂着 `INEFFECTIVE_DYNAMIC_IMPORT`：`src/lib/pdf-text-edit.ts` 静态取了
`rgb`，而 `PdfViewer` / `pdf-pages` 都动态 `import('pdf-lib')` ⇒ 整份 pdf-lib 被焊进
PdfViewer chunk。实测把它改成纯动态后，**PdfViewer chunk 1,196,014 → 816,820 字节
（−31.7%）**、警告消失、主包不变，pdf-lib 独立成 382,487 字节的按需 chunk。

但 **`src/lib/pdf-text-edit.ts` 是工作树里另一条线未跟踪的新文件**（302 行不是本轮写的）。
按房规「绝不代他们提交」，本轮**已完整还原那两行改动、不入库**，只把结论与复算方法记在这里：
等那条线自行入库后，把顶部 import 改成 `import type { PDFDocument, PDFFont } from 'pdf-lib'`、
在 `applyTextEdits` 的 `if (!edits.length) return` 之后加 `const { rgb } = await import('pdf-lib')`，
再 `npm run build` 看 `PdfViewer-*.js` 的大小即可。本轮 `git status` 里该文件仍是 `??`。

### 五、顺延（D35）与明确不做的

- 第一档剩余：**图形壳往返 8.8%** 整族设计、Writer 标尺 / 可交互状态栏 / 逐页翻页预览、
  Impress 母版编辑与缩放、Calc 视图缩放、PDF 查找替换。
- D32–D34 原账不动：`fldChar` 三对、`outline|val`、`col|w`/`col|space`、
  `smartTag|*` / `legacy|*`、±5 缇、`w:cols` `equalWidth`、`ind|left`、
  `docPr|id`、`lvlJc`；`theme1.xml` 进不进普查清单仍要定口径。
- **不做**：预览里的逐页翻页 / 多页并排（要自己算分页，屏幕与打印会两套结果）；
  打印预览里再开一套模态设置面板；本轮 A/B 数字仍是合成夹具，不冒充真件打开耗时。

## v0.176（D35）——PDF 查找替换 + docx 批注锚文本单次预扫

一句立项：接着 D35 顺延做。前三轮一直在 Writer 外壳与导入链上挖，这一轮换到
**PDF 组件**补一个 WPS 高频缺口；性能换成兜底导入链上的一处 O(批注数 × 全文)。

### 一、PDF 查找替换（`src/lib/pdf-replace.ts`）

搜索条多一枚「替换为…」输入框与「替换 / 全部替换」两个按钮。命中在 `runSearch`
里多带一枚 `from`（切自 `PageText.full`，保留原始大小写）；替换时
`replacementPlan` 按「页 + 原文」给每处命中编号，`locateReplace` 在文字项几何序列里
按编号定位覆盖区间、并集成一个盒，再排进**既有改字队列** `textEdits`——
保存（Ctrl+S）时才由 `applyTextEdits` 写回，与手动改字同一条链路。

**为什么不用 `Match.bItem` 去索引几何**：`loadPageGeom` 会丢掉 `textItemBox` 返回
null 的项，两边下标未必一一对应；`locateReplace` 改用 **geoms 自己的 str 拼串**
定位，自洽。底色仍从已渲染画布采样（页面没渲出来兜白），旋转档位照旧取 `/Rotate`。

**诚实边界**：定位不了的一处如实跳过并报数，不假装成功；写回前页面仍显示原文，
所以搜索结果不清空；替换走的是「盖底色 + 画新字」的内容流改字，新字明显长于原字
时不自动缩放（与手动改字同一条限制）。大小写折叠沿用搜索的 `toLowerCase`，
长度会变的 Unicode 折叠长尾未处理。

### 二、性能：`docxToCommentHtml` 的锚文本从「逐批注扫全文」到「一次预扫」

mammoth 兜底路径里 `anchorOf(id)` 对每个批注各跑一次全文正则、一次
`docXml.slice(bodyStart)` 大串复制、一次全文 `indexOf` —— O(批注数 × 全文)。
`commentAnchorsOf` 一趟 `matchAll` 收齐所有 `commentRangeStart/End` 并按 id 配对，
变成 O(全文 + 各锚点片段)。**HTML 里包 span 的替换循环一字未动**，
不碰「相同锚文本会嵌套」这类既有语义（那是另一笔账）。

等价纪律四条：每个 id 只认第一对 Start/End；仍取 Start 之后第一个同 id End；
`indexOf('</w:p>', start) < endAt` 跨段判据原样保留（含返回 -1 时 `-1 < endAt`
为真的边界）；`joinT` 与旧路径同一份实现。`scripts/test-comment-anchor.mjs`
把**改前算法原样复刻**一份，对九种边界逐例对撞输出 HTML（12 项全绿）。

判据 `scripts/bench-comment-anchor.mjs`（合成 docx，同进程 A/B 用改前副本
`git archive HEAD src/lib | tar -x -C tmp/bench-docx-old`，交替顺序各 10 样本）：

| 批注数 | A（改前） | B（本轮） | 降幅 | 输出逐字相同 |
|---:|---:|---:|---:|---|
| 50 | 5.1ms | 3.6ms | **−28.1%** | ✓ |
| 800 | 153.3ms | 102.7ms | **−33.0%** | ✓ |

800 条时仍要 102.7ms，因为 HTML 替换循环还在每次整串拼接——这一层按上面说的
语义原因留到下一轮，数字不粉饰。

### 三、门禁与账上的数

| 腿 | 数 |
|---|---|
| tsc / build | 0 / ✓（`INEFFECTIVE_DYNAMIC_IMPORT` 是 v0.175 已记录、按房规留给另一条线的既有项） |
| 结构测试 | runprops **173** + 外壳 **63** + PDF 替换 **23** + 批注等价 **12** + PDF 文本编辑全通过 |
| docx 保真 / 往返 | **99.0% / 98.4%**、**82.0% / 8.8% / 44.3%**（掉 328、值变 17）全不动；往返 `ed7a2737…`/`da817a7…` 两次一致；四条变异腿 52.5 / 59.4 / 99.0 / 96.5，复位 `1979f813…`/`72ff93c1…` |
| pptx 保真 | 70.1% / 74.3%、42/19 全绿，`--mut no-ga` 42 条全红后复位 `d06e404b…`/`b7e4d706…` |
| 账本变动 | 五份账本各一行 `modules` **64 → 65**（新增 `pdf-replace.ts`），覆盖率与逐对清单逐字未动 |

房规复核：`src/lib/pdf-text-edit.ts` 仍是工作树里另一条线**未跟踪**的文件，
本轮只 import 它现有的 `sampleBackdrop` / `applyTextEdits` / `TextEdit`，
没有改它、没有代提交（`git status` 里仍是 `??`）。

### 四、顺延（D36）与明确不做的

- 第一档剩余：**图形壳往返 8.8%** 整族设计、Writer 标尺 / 可交互状态栏 /
  逐页翻页预览、Impress 母版编辑与缩放、Calc 视图缩放；
  **pdf-lib 按需加载**仍等 `pdf-text-edit.ts` 那条线自行入库。
- D32–D35 原账不动：`fldChar` 三对、`outline|val`、`col|w`/`col|space`、
  `smartTag|*` / `legacy|*`、±5 缇、`w:cols` `equalWidth`、`ind|left`、
  `docPr|id`、`lvlJc`；`theme1.xml` 进不进普查清单仍要定口径。
- **不做**：替换时自动缩放/重排新字（要动内容流排版，另立一轮）；
  相同锚文本的嵌套 span 语义（保真优先，留作独立 bug）；
  `docxToCommentHtml` 的 HTML 拼接循环（同上）；本轮 A/B 仍是合成夹具。

## v0.177（D36）——正面碰图形壳：浮动图整族往返，账本第一次真的动了

一句立项：连续几轮把外壳补齐后，评估里最大的一块欠账一直是**图形壳往返 8.8%**。
这一轮不按 289 对逐个打补丁，而是挑一族同源、能整族闭环的做掉；顺带清掉上一轮
明确留下的两笔（HTML 拼接循环、相同锚文本嵌套）。

### 一、`wp:anchor` 浮动图：翻 `.d.ts` 才发现包一直有槽

读手 v0.149 就把六枚闸门（`allowOverlap` / `behindDoc` / `layoutInCell` / `locked` /
`relativeHeight` / `simplePos`）与四边避让存进 `data-img` 载荷，注释却写着
「写侧只发内嵌图（**包没有 `wp:anchor` 的槽**）」——顺延清单上的这句判断躺了很多轮。
翻 `node_modules/docx/dist/index.d.ts` 才看见 `CoreImageOptions.floating?: IFloating`，
而包实现的 `Anchor` 类本来就发 `<wp:anchor distT=… distB=… allowOverlap=…>`。
**教训 11 又应验了一次：清单上的「包没有槽」是判断，不是判决书。**

这一轮三段接通：
- **读手**：`data-img` 加一枚 `anKind=anchor`（源件是浮动图才标）；
  `relativeHeight` 从 `onOff` 改成数值读取（它是 unsignedInt 层级号，真件里常是
  `251658240`，用 onOff 解析会整枚丢掉），并把它从 `IMG_ONOFF_KEYS` 里摘出去。
- **写手**：`imageRunOf` 按 `anKind` 给 `ImageRun` 传 `floating`（位置基准按
  `posH/posV` 映射包的枚举，认不出的落 `page`），包这才发 `<wp:anchor>` 而不是 `<wp:inline>`。
- **post-pack**：`patchImgXml` 按载荷原值回填十枚属性 —— 包发出的 `simplePos` 恒 0、
  `relativeHeight` 在 zIndex 为 0 时会退化成图片高度，都不能当源件说过的话；
  `wp:simplePos/@x|y` 也按 `spX/spY` 回填（包硬编码 0）。

`scripts/test-anchor-roundtrip.mjs` 走**完整链路**（夹具 docx → 读手 HTML → TipTap
schema → PM → 写手 → 解包），逐枚对撞 26 项，并钉住「内嵌图没被误伤」。

**账本这次真的动了，而且每一对都说得出为什么**：

| | 上一轮 | 这一轮 |
|---|---:|---:|
| 图形壳 | 28/319 = 8.8% | **42/319 = 13.2%** |
| 合计 | 274/619 = 44.3% | **288/619 = 46.5%** |
| 掉了 | 328 | **314** |
| 值变 | 17 | 17（没新增） |

14 对从「掉了」转「保留」：`anchor|distT/B/L/R`、`anchor|allowOverlap/behindDoc/
layoutInCell/locked/relativeHeight/simplePos` 十枚，`positionH|relativeFrom` /
`positionV|relativeFrom` 两枚（floating 的位置选项顺带带出），
`simplePos|x/y` 两枚（回填补丁）。中途曾因 `simplePos|x/y` 只出现名字、值是 0
而变成两笔「值变」，补完 x/y 后回到 17 —— **没有把「掉了」粉饰成「值变」**。

### 二、变异腿往上跳了一下，是读点漏了锚点（当场修回）

第一遍把 `relativeHeight` 改成 `attrNum` 后，`--mut no-attr` 腿从 **59.4% → 59.5%**、
探针记录对 416 → 417。原因：`attrNum` 是 `attr ?? attrL` 两条漏斗，旧的
`onOff(attr(...))` 只走 `attr` 一条；注入掉 attr 的腿靠 attrL 多问到了这一对。
**覆盖率往上跳不是成绩，是读点换了漏斗**（教训 1）。改回 `attr` 单漏斗 +
`Number()` 解析后，四条腿回到 **52.5 / 59.4 / 99.0 / 96.5**、记录对 416，
保真账 99.0% / 98.4% 与探针记录对 715 全程一字未动。

### 三、性能：批注 HTML 从每枚复制整串到一次规划 + 分段构建

上一轮留下的 `docxToCommentHtml` 替换循环：每枚批注都
`outHtml.slice(0, idx) + span + outHtml.slice(...)`，是 O(批注数 × HTML) 的整串复制。
这一轮改成「在**原始 html** 里为每枚批注认领自己那一处 → 排序 → 一次分段拼接」，
构建成本 O(HTML)。同一锚文本的第 n 枚批注认领第 n 次出现，顺带修掉
**旧写法两枚批注套成嵌套 span** 的 bug（单独立账：测试第 9 条从「嵌套语义不变」
改成「两枚各自独立」，13 项全绿）。逆序批注各自从头找，不按 id 推进游标，
免得漏掉文档里排在前面的锚点。

同进程 A/B（`scripts/bench-comment-anchor.mjs`，改前副本 + 输出逐字对撞）：

| 批注数 | A 改前 | B 本轮 | 降幅 | 输出逐字相同 |
|---:|---:|---:|---:|---|
| 50 | 4.7ms | 2.4ms | **−49.7%** | ✓ |
| 800 | 147.2ms | 10.0ms | **−93.2%** | ✓ |

端到端 800 条从上一轮的 104.5ms → **10.7ms**。

### 四、门禁与账上的数

| 腿 | 数 |
|---|---|
| tsc / build | 0 / ✓ |
| 结构测试 | runprops **173** + 外壳 **63** + v0.173 功能 **29** + PDF 替换 **23** + 浮动图往返 **26** + 批注等价 **13** + PDF 文本编辑全通过 |
| 保真账 | **99.0% / 98.4%**、探针记录对 715、四条变异腿全不动；`docs/fidelity.*` 与 HEAD 逐字节相同 |
| 往返账 | 见上表；`3f202013…` / `f29e31ac…` 两次复跑逐字节相同；**只有这一本账变了**（14 对） |
| pptx 账 | 70.1% / 74.3%、42/19 全绿，`--mut no-ga` 42 条全红后复位，与 HEAD 逐字节相同 |
| 账本 `modules` | **65 不动**（本轮没有新增 `src/lib` 文件，只改了已有模块与 scripts） |

### 五、顺延（D37）与明确不做的

- 第一档剩余：**图形壳 13.2% 的下一族**（`shape` 20 / `bodyPr` 19 / `rect` 15 /
  `fill` 14 / `line` 14 等 VML 老式形状族，模型无槽、写手写不出，仍要整族设计）；
  Writer 标尺 / 可交互状态栏 / 逐页翻页预览；Impress 母版编辑与缩放、Calc 视图缩放；
  **pdf-lib 按需加载**仍等 `pdf-text-edit.ts` 那条线自行入库。
- D32–D36 原账不动：`fldChar` 三对、`outline|val`、`col|w`/`col|space`、
  `smartTag|*` / `legacy|*`、±5 缇、`w:cols` `equalWidth`、`ind|left`、
  `docPr|id`、`lvlJc`；`theme1.xml` 进不进普查清单仍要定口径。
- **不做**：`positionH/V` 的 `posOffset` 与环绕档位（包只发 posOffset=0，另立一轮）；
  把浮动图在屏上真按锚点摆放（Web 流式排版没有环绕，壳只保真不上屏）；
  Impress 视图缩放本轮没做（顺延，不冒充已补）。

## 发行说明 v0.178 —— Impress 缩放、图片壳整族往返、写手单次解包

### 一、Impress 视图缩放（D37 顺延里挂了四轮的一项）

`PptEditor` 工具条加一组七档缩放（50%–200%）：加减按钮 / 下拉 / 100% 复位 /
Ctrl+滚轮走**同一串刻度**，共用 Writer 的 `src/lib/view-zoom.ts`（新增
`stageZoomStyle` 作单一事实源，见 `scripts/test-impress-zoom.mjs` 28 项）。

只改屏幕上那张 `.ppt-stage` 的 CSS `zoom`。`deckToPptxBytes` 吃的是 deck 数据、
PDF 走离屏 `.ppt-print-page`、放映走另一棵 `StaticSlide`，三者都不读缩放值；
`@media print` 另有 `zoom: 1 !important` 兜底。形状拖动仍按舞台自身的
`getBoundingClientRect()` 折分数——CSS zoom 等比缩放这个矩形，比例不变。
监听挂在 `.ppt-stage-wrap` 而非 window，放映覆盖层压在上面时滚轮不会漏进去。

### 二、图片壳整族往返（承接 v0.177，账本再动 10 对）

上一轮在 `wp:anchor` 上打通 14 对。这一轮扫「读手已存载荷、写手漏接」的清单，
挑出**包本来发得出壳、只是属性漏接或元素名不同**的一族，四枚壳一次接通：

| 壳 | 源件说的 | 包发的 | 动作 |
|---|---|---|---|
| `wp:inline` | `anchorId` / `editId` | 壳在，两枚属性不发 | `tagWithAttrs` 追加（不造元素） |
| `a:srcRect` | `t/r/b/l` 裁剪四边 | `<a:srcRect/>` 空壳 | 按载荷补属性 |
| `a:xfrm` | `rot` / `flipH` / `flipV` | `<a:xfrm>` 带 off/ext | 按载荷补属性 |
| `wp:wrapSquare` | `wrapText="bothSides"` | 恒发 `<wp:wrapNone/>` | **整片换**（元素名 + 值一起回来） |

`a:xfrm` 的变换三枚屏上由 `imgTransformCss` 折成 CSS transform，此前只读不写；
现在用 `attrL` 单漏斗把同一份原值存进 `data-img`。环绕档位走 `retagWrap`，
只在浮动图那一支做——内嵌图本来没有环绕元素，不凭空插一枚。

**10 对全部 `lost → kept`**：`inline|anchorId`、`inline|editId`、
`srcRect|b/l/r/t`、`xfrm|flipH/flipV/rot`、`wrapSquare|wrapText`。

| | v0.177 | v0.178 |
|---|---:|---:|
| 图形壳 | 42/319 = 13.2% | **52/319 = 16.3%** |
| 合计 | 288/619 = 46.5% | **298/619 = 48.1%** |
| 掉了 / 值变 | 314 / 17 | **304** / 17（没新增） |

逐对变动都能说出「为什么是这一对」，没有把「掉了」粉饰成「值变」。
保真账 **99.0% / 98.4%**、探针记录对 715、四条变异腿 52.5 / 59.4 / 99.0 / 96.5
一字不动——新读点与既有屏上读点同走 `attrL`，没绕过量具锚点（v0.177 的教训）。
`scripts/test-image-shell.mjs` 32 项走完整链路（夹具 → 读手 → PM → 写手 → 解包），
并逐块钉住「不带载荷的 drawing 仍是空壳」。

### 三、性能：写手 post-pack 从「每个补丁各自解包」收成一次

`prosemirrorToDocxBytes` 的补丁链上 13 个函数此前各自 `JSZip.loadAsync(bytes)`
→ 改一枚部件 → `generateAsync()` 重压**整份包**。探针数出来：夹具上一份文档
要解包 15 次、打包 15 次，占端到端 **20.5%**（其中打包 36.1ms）。

现在主链建一枚 `PackSession`（`loadZipOf` / `finishPatch`），所有补丁在同一 zip
实例上读写、只标脏，末尾 `generateAsync` 一次。JSZip 的 `file(name, data)` 会
替换条目，下一枚补丁读到的是刚改过的文本——与原来「打包→解包」的串行链逐字同义。
补丁仍保留 `sess` 缺省时的独立路径，A/B 对照腿与直接调用方都还能用。

判据 `scripts/bench-docx-pack.mjs`（改前副本 `git archive HEAD src/lib`，
两腿**同进程交替顺序**各 10 样本，比的是逐部件字符串而非压缩字节）：

| | 改前 | 本轮 | 变化 |
|---|---:|---:|---|
| 端到端（夹具） | 60.5ms | **28.4ms** | **−53.1%** |
| 逐部件字符串 | — | — | ✓ 完全相同 |

签名里归一了两类天然不可复现量：`docProps/core.xml` 的时间戳、docx 包给超链接
发的随机 `rId`（与保真账同一口径）。不归一就会假红。

### 四、门禁与账上的数

| 腿 | 数 |
|---|---|
| tsc / build | 0 / ✓ |
| 结构测试 | runprops **173** + 外壳 **63** + v0.173 功能 **29** + PDF 替换 **23** + 浮动图往返 **26** + 批注等价 **13** + **图片壳 32** + **Impress 缩放 28** + PDF 文本编辑全通过 |
| 保真账 | **99.0% / 98.4%**、记录对 715、四条变异腿不动；`docs/fidelity.*` 与 HEAD 逐字节相同 |
| pptx 账 | 70.1% / 74.3%、自检 42/19 全绿、`--mut no-ga` 42 条全红后复位；两本与 HEAD 逐字节相同 |
| 往返账 | 见上表；`2f3f0770…` / `c72c0d33…` 两次复跑逐字节相同；**只有这一本账变了**（10 对） |

`modules` 保持 **65**：本轮没新增 `src/lib` 文件（缩放复用 `view-zoom.ts`）。

### 五、顺延清单（D38）

- 图形壳剩余 265 对：`shape`(20) / `bodyPr`(19) / `rect`(15) / `fill`(14) /
  `line`(14) / `reflection`(13) / `shadow`(13) 等 **VML 老式形状族**——模型无槽、
  写手写不出 `w:pict`，要整族设计；`sizeRelH`/`sizeRelV` 是 wp14 扩展，
  包完全不发，得先建 `wp:anchor` 的插入锚点表（本轮刻意没碰，零插元素是本轮的安全边界）。
- `positionH/V` 的 `posOffset`；浮动图在屏上按锚点摆放。
- Writer 标尺 / 可交互状态栏 / 逐页翻页预览；Impress 母版编辑、Calc 视图缩放；
  **pdf-lib 按需加载**仍等 `src/lib/pdf-text-edit.ts` 那条线自行入库。
- D32–D37 原账不动：`fldChar` 三对、`outline|val`、`col|w`/`col|space`、
  `smartTag|*` / `legacy|*`、±5 缇、`w:cols` `equalWidth`、`ind|left`、
  `docPr|id`、`lvlJc`；`theme1.xml` 进不进普查清单仍要定口径。
- **诚实边界**：A/B 数字来自纯合成夹具（STORE 压缩），不是真件打开耗时；
  CSS zoom 的拖动比例自洽是代码级推理，没有真机浏览器对撞；Impress 缩放只做了
  视图档位，没做「适应窗口 / 适应页宽」这类自动档。

## 发行说明 v0.179 —— Writer 标尺、图片载荷单次索引、a:ln 整族

### 一、Writer 标尺（D38 里挂了五轮的一项）

新增 `src/lib/ruler.ts`：刻度（每 2mm 小格 / 10mm 大格并标厘米）、三枚缩进
标记位置、拖动换算全是纯数值，Node 侧可断言（`scripts/test-writer-ruler.mjs` 36 项）。
Writer 工具条加「标尺」开关，水平标尺挂在 `.doc-page` 内随内联 zoom 一起缩放，
0 点对齐版心左边缘；三枚滑块（首行 / 左 / 右）可拖，写回走 `setIndent` 单一出口，
拖动吸附到 1mm 网格，拖「左」时首行跟着走保持相对偏移。垂直标尺给上下边距刻度。

关着时一次刻度计算都不跑；打开时只读当前段落的三枚属性，不遍历全文。
预览态与 `@media print` 都把标尺藏掉（屏幕辅助不上纸）。

**口径边界**：标尺拖动按 1mm 网格，工具条「缩进」按钮按 `INDENT_STEP_PX=32px`，
两个入口步长不同但都走绝对设定 `setIndent`，互不冲突；标尺只做了固定版心的
刻度与三枚滑块，多栏时按整版心显示，没有逐栏标尺。

### 二、性能：图片载荷从「每张图几十次深搜」收成一份子树索引

`bitmap()` / `readImgPayload()` / `imgClipCss()` / `imgTransformCss()` 此前对
**同一枚 `w:drawing`/`w:pict`** 各做几十次 `findDesc` / `allDesc`，其中
`allDesc` 每次都 `descend(el).filter(...)` 重新摊平整棵子树。v0.174 的
`buildDocIndex` 只服务 7 个只读记账的 `note*`，图片渲染主链没吃到那张索引。

现在每枚 drawing 建一份 `ImgIndex`（`imageIndexOf` 一次前序遍历按 local name
分组），`firstOf`/`allOf` 查表。`descend` 与 `findDescIn` 同为前序 DFS，所以
`arr[0]` 就是原「第一枚」、`arr` 就是原 `allDesc` 那一串。**只换怎么找到元素**：
所有 `attr`/`attrL`/`attrNum` 的按名访问一字不动，探针查问集合才不变——
保真账 99.0% / 98.4% / 记录对 715、四条变异腿 52.5 / 59.4 / 99.0 / 96.5
全部与上轮一字不差。

判据 `scripts/bench-img-payload.mjs`：改前副本与产品源同进程交替顺序各 10 样本，
比的是**两腿 HTML 逐字相同**（± 时间戳无关，读手产物没有随机量）。

| | 改前 | 本轮 | 变化 |
|---|---:|---:|---:|
| 200 张图（图片密集夹具） | 67.8ms | **56.3ms** | **−17.1%** |

三次独立复跑 −24.8% / −24.5% / −20.3%，区间 **−17~−25%**（机器负载有浮动，
不取单次最好看的数字写进结论）。

**顺手修了一把旧尺**：`scripts/bench-docx-pack.mjs` 此前靠手工
`git archive HEAD src/lib` 造对照副本，v0.178 提交后 HEAD 已是优化后的版本，
副本与产品源越差越多（本轮加 `a:ln` 后语义等价直接假红）。现在脚本从
**当前产品源**生成对照腿，只做三处机械改写把 `PackSession` 退回
「每个补丁各自解包/打包」，逐条验数（13 / 13 / 1 处），两腿同源、只差一件事。
复跑：语义等价 ✓、**72.2 → 35.2ms（−51.3%）**。

### 三、a:ln 整族往返（账本再动 3 对）

读手早把 `lnW/lnCap/lnCmpd` 存进 `data-img`，注释却写「包写不出 a:ln」。
翻 `.d.ts` 的 `CoreImageOptions` 才发现 `outline` 是原生槽——
`ShapeProperties` 见到 `outline` 才 push `<a:ln>`（教训 33 的第七次应验）。

按载荷条件传一枚最小 `outline` 发壳，**三枚属性由 `patchImgXml` 按源件字面
回填**：包的枚举键是 `FLAT`/`SINGLE`，OOXML 字面是 `flat`/`sng`，直接传给包会
写错值；`retag` 已有则改、没有则补，零插元素、零新读点、零新函数。

| | v0.178 | v0.179 |
|---|---:|---:|
| 图形壳 | 52/319 = 16.3% | **55/319 = 17.2%** |
| 合计 | 298/619 = 48.1% | **301/619 = 48.6%** |
| 掉了 / 值变 | 304 / 17 | **301** / 17（没新增） |

`ln|w` / `ln|cap` / `ln|cmpd` 三对全部 `lost → kept`。`scripts/test-image-shell.mjs`
扩到 40 项，钉住「cap 不是 FLAT 枚举键」「只有带载荷那一块补了三枚」「写手侧
不自己拼 `<a:ln>` 字符串」。

### 四、门禁与账上的数

| 腿 | 数 |
|---|---|
| tsc / build | 0 / ✓ |
| 结构测试 | runprops **173** + 外壳 **63** + v0.173 功能 **29** + **标尺 36** + PDF 替换 **23** + 浮动图 **26** + 批注等价 **13** + 图片壳 **40** + Impress 缩放 **28** + PDF 文本编辑全通过 |
| 保真账 | **99.0% / 98.4%**、记录对 715、四条变异腿不动；只有 `modules` 65 → **66**（新增 `ruler.ts`）这行元信息 |
| pptx 账 | 70.1% / 74.3%、自检 42/19 全绿、`--mut no-ga` 42 条全红后复位；同样只有 `modules` 一行 |
| 往返账 | 见上表；`ccc19b39…` / `e86e017f…` 两次复跑逐字节相同；**3 对** `lost → kept` |

### 五、顺延清单（D39）

- 图形壳剩余 **262 对**：VML 老式形状族 `shape`(20) / `bodyPr`(19) / `rect`(15) /
  `fill`(14) / `line`(14) / `reflection`(13) / `shadow`(13) 仍是模型无槽、写手发不出
  `w:pict` 的整族缺口；`a:headEnd` / `a:tailEnd` / `a:outerShdw` / `a:glow` /
  `a:reflection` 包**连构造器都没有**（只有 `a:ln` / `a:solidFill` 有发射器），
  要发就必须新建插入通道与 `wp:anchor` 的 schema 锚点表——本轮刻意没碰，
  零插元素仍是安全边界。`sizeRelH`/`sizeRelV` 是 wp14 扩展，同理。
- `wp:posOffset`：包发的 `0` 可改成源值 360/720，但值在**元素文本**里（不是属性）、
  读手没有载荷键（新读点会走 `attr`/`attrL` 漏斗之外的路径）、且往返账压根没有
  这一对——动 0 对。要修得先定「文本值算不算一对」的口径。
- Writer 可交互状态栏 / 逐页翻页预览；Impress 母版编辑、Calc 视图缩放
  （**落点在预存改动文件 `SheetEditor.tsx`，按房规换落点或只记结论**）；
  **pdf-lib 按需加载**仍等 `src/lib/pdf-text-edit.ts` 那条线入库。
- D32–D38 原账不动：`fldChar` 三对、`outline|val`、`col|w`/`col|space`、
  `smartTag|*` / `legacy|*`、±5 缇、`w:cols` `equalWidth`、`ind|left`、
  `docPr|id`、`lvlJc`；`theme1.xml` 进不进普查清单仍要定口径。
- **诚实边界**：两把 A/B 尺都是纯合成夹具，不是真件打开耗时；标尺的拖动交互
  只有纯函数与源码级断言，没有真机浏览器对撞；`a:ln` 只保真三枚属性，
  源件描边里的 `a:solidFill/a:schemeClr` 填充仍没回写（包发的是 `a:noFill`）。

## 发行说明 v0.180（可交互状态栏 / 线端族插入通道 / 打开路径单次解包）

本轮三件事都有硬判据。仍是「代码 + 文档」两笔提交、逐文件 add，没碰那 7 个
任务无关的预存改动与 `pdf-text-edit.ts` 等未跟踪文件。

### 一、Writer 可交互状态栏（D39 里挂了六轮）

- 新增 `src/lib/status-bar.ts`：条目表、`字数 N · 字符 M` / `约 N 页` 文案、
  消息首行与悬停提示、缩放百分比全是纯函数。状态首行转调 `fail-msg.ts` 的
  `statusText/statusTip`，页数转调 `print-preview.ts` 的 `estimatePages`（预览条
  同源），缩放转调 `view-zoom.ts` 的 `zoomPct`——不复制第二份口径。
- UI 从「工具条尾部三段不可点的 span」改成 editor-pane 底部独立一条
  `.doc-status-bar`：消息 / 统计 / 页数（点击开预览）/ 修订 / 拼写 / 历史版本 /
  缩放三枚（− / 100% / ＋）。每个 action 都映射到**既有入口**，没发明新面板；
  静态条目渲染成 span 而不是 disabled button。
- 纯函数不碰 `Date` / `Intl`：`toLocaleTimeString()` 由调用方算好传进来，数字也
  不做千分位格式化（locale 不同输出就不同，逐字断言会假红）。预览态由已有的
  `.is-preview` 通配规则藏掉，`@media print` 显式 `display:none`——
  `visibility:hidden` 会留 28px 空位。`test-writer-status-bar.mjs` 36 项。

### 二、`a:ln` 线端族：第一次为子元素新建插入通道

- D39 把 `a:headEnd` / `a:tailEnd` 判成「包连构造器都没有，要新建插入通道 +
  `wp:anchor` 锚点表」。本轮探查发现**不需要那张锚点表**：v0.179 的
  `CoreImageOptions.outline` 已让 `<a:ln>` 这枚父壳发得出来，四枚子元素只要按
  CT_LineProperties 的 schema 序（`fill → prstDash → miter → headEnd → tailEnd`）
  插在 `</a:ln>` 之前即可，天然满足位次。
- 读手补 7 枚载荷键（`dashVal` / `he*` / `te*`），`miterLim` 本来就在（v0.151 存了
  但写手没接）。全部走 `attrL` 单漏斗，与 `noteDrawingMarks` 的
  `DRAWING_SHELL_ATTRS` 同批键——查问集合不变。
- 写手 `patchImgXml` 在单个 `w:drawing` 块内插：`tagWithAttrs` 生成自闭合子元素、
  幂等守卫（已有同名元素改为改属性而非再插，否则第二枚同名子元素 = 非法 XML）、
  自闭合 `<a:ln/>` 与有内容 `<a:ln>…</a:ln>` 两态都处理。零新模型槽、零
  `mc:AlternateContent`、零 wp14、零 `a:effectLst` 整片。
- **8 对全部 `lost → kept`**：`headEnd|len/type/w`、`tailEnd|len/type/w`、
  `prstDash|val`、`miter|lim`。图形壳 **55/319 → 63/319（17.2% → 19.7%）**、
  合计 **301/619 → 309/619（48.6% → 49.9%）**、掉了 301 → 293、值变仍是 17。
  `test-line-ends.mjs` 28 项（完整链路 + schema 序 + 幂等 + 按块对位）。

### 三、打开 .docx：两个入口共享一次解包

- 此前 `docxToDocMeta` 与 `docxToHtmlFidelity` 各自 `JSZip.loadAsync(bytes)`，
  `word/document.xml`、`word/theme/theme1.xml`、`word/_rels/document.xml.rels`
  三份部件各解压 + 转 UTF-8 两次。v0.173 收的是读手内部「同一份 document.xml
  parseXml 8 次」，本轮收的是**跨入口的 zip 解包**，两层不同。
- `openDocxZip(bytes)` 建一枚会话（zip 实例 + 带 Map 缓存的 `read`），两个入口都收
  可选 `shared` 参数。**不传就走原来的各自解包路径**——A/B 两腿同源、只差一个
  参数，不再依赖会过期的手工 `git archive` 副本（v0.179 的教训）。
  `docxToDocMeta` 的 `theme1.xml` 也改走共享 `read`（缺件返回空串，与原来的
  `if (themeFile)` 门逐字同义）。
- 判据 `scripts/bench-docx-open.mjs`：同进程交替顺序各 10 样本取中位，两腿
  `JSON.stringify(meta)` 与读手关键字段**逐字相同**；`JSZip.loadAsync`
  **2 → 1** 次、部件文本解压 **24 → 18** 次。

| 夹具 | 改前 | 本轮 | 降幅 |
|---:|---:|---:|---:|
| 原夹具 21KB | 7.4ms | 6.7ms | −9.1% |
| ×20 270KB | 59.4ms | 52.9ms | −10.9% |
| ×60 793KB | 140.1ms | 131.8ms | −5.9% |

  大件上 document.xml 的解析成本两腿都要付，收益百分比被稀释；省掉的
  「一整包解包 + 6 次部件解压」是固定收益，不随放大倍数变。数字写实测区间
  **−6~11%**，不挑最好看的一次。`test-docx-zip-session.mjs` 16 项。

### 门禁与账本

- tsc 0、build ✓；十三组结构测试全绿（173+63+29+36+**36**+23+26+13+40+28+
  **28**+**16** + PDF 文本编辑）。
- 保真 docx 99.0% / 98.4%、探针记录对 715、四条变异腿 52.5 / 59.4 / 99.0 /
  96.5 一字不动；pptx 70.1% / 74.3%、42/19 全绿、`--mut no-ga` 42 条全红后复位。
- 往返账 `520b9933…` / `ded1baa5…` 两次复跑一致。四本账的 `modules`
  **66 → 67**（新增 `status-bar.ts` 的元信息，不是覆盖对）。
- 两组既有断言因本轮改动过期，按纪律**改断言不改代码**：状态栏搬进 lib 后
  `test-writer-shell.mjs` 的「组件里 `estimatePages` 出现 ≥2 次」改成「组件一处 +
  lib 转调一处」；`test-image-shell.mjs` 的「全文不许出现 `<a:ln` 字符串」收窄到
  **发壳路径 `imageRunOf`**（post-pack 的查找正则与注释不算手搓壳）。

### 顺延（D40）

- 图形壳剩 **254 对**：`a:effectLst` 那一整片（`outerShdw` 5 / `reflection` 13 /
  `glow` 1 / `sp3d` 3 / `props3d` 3 …）要新建整片并插在 `a:ln` 之后、
  `a:spLocks` 之前，**不能复用本轮 `a:ln` 内插的锚点表**（同一形状两处位次不同，
  与 v0.169 的 `insertTblPrKids` 两张表同理）；VML 老式形状族仍是模型无槽。
- `wp:posOffset` 值在元素文本里、读手没载荷键、账本压根没这一对——动 0 对，
  要修先定「文本值算不算一对」的口径。
- Writer 逐页翻页预览；Impress 母版编辑；Calc 缩放（落点在预存改动
  `SheetEditor.tsx`，按房规换落点或只记结论）；**pdf-lib 按需加载**仍等
  `pdf-text-edit.ts` 入库（两行，照 v0.175 节复算）。D32–D39 长尾原账不动。
- **诚实边界**：本轮及历轮 A/B 数字都是合成夹具，不是真件打开耗时；状态栏交互
  与预览/打印隐藏只有源码级断言，没做真机浏览器对撞；线端族只保真四枚子元素
  的属性，源件描边里的 `a:solidFill/a:schemeClr` 填充仍没回写（包发的是
  `a:noFill`）；共享会话只在主打开链接入，mammoth 回退路径的
  `docxToCommentHtml` 仍自解一次。

## 发行说明 v0.181（效果整片 / 逐页翻页预览 / ODT 导入单次物化）

三件事都有硬判据。仍是「代码 + 文档」两笔提交、逐文件 add，没碰那 7 个预存改动
与 `pdf-text-edit.ts` 等未跟踪文件。

### 一、`a:effectLst` 效果整片：第二张插入锚点表

- D40 说这一族「要新建整片并插在 `a:ln` 之后、`a:spLocks` 之前，不能复用 v0.180
  的 `a:ln` 内插锚点表」——确实如此：v0.180 那张表的落点是 `</a:ln>` **内部**
  （子元素），而 effectLst 是 `a:ln` 的**兄弟**。本轮在 `patchImgXml` 里另起一张
  `['a:scene3d','a:sp3d','a:extLst','a:spLocks']` 锚点表：找第一枚排在
  effectLst 之后的在场兄弟插在它前面；写出包实际只发到 `a:ln`，退化到
  `</pic:spPr>` 前——那也正好是 `a:ln` 之后，schema 位次成立。
- 读手补 19 枚载荷键（`outerShdw` 5 / `glow` 1 / `reflection` 13），`attrL`
  单漏斗、与 `DRAWING_SHELL_ATTRS` 同批键；属性名→键名的规则抽成
  `cell-style.ts` 的 `EFFECT_ATTRS` + `effectKey`，读写手共用一份，避免
  「存了 `osBlurRad`、写手找 `osBlur`」这种不报错的静默漏接。
- 写手用 `tagWithAttrs` 生成三枚自闭合元素、幂等守卫（已有整片改为改属性）。
  `a:glow` 写成自闭合、不带 `<a:schemeClr>`——否则 `schemeClr|val` 会从 lost
  变 value，把「掉了」粉饰成「值变」。
- **刻意不碰三维族**：夹具把 `scene3d`/`sp3d`/`props3d` 塞进了 effectLst
  内部，按 CT_ShapeProperties 它们应是 effectLst 之后的兄弟，`props3d` 甚至
  不是 OOXML 元素名。复刻就是写一份结构非法的坏件，另立一轮。
- **19 对全部 `lost → kept`**：图形壳 **63/319 → 82/319（19.7% → 25.7%）**、
  合计 **309/619 → 328/619（49.9% → 53.0%）**、掉了 293 → 274、值变仍是 17。
  `test-effect-lst.mjs` 26 项。

### 二、Writer 逐页翻页预览（D40 顺延）

- 没有写分页算法：复用屏幕上分页参考线的 `--pgh`（就是 `effPx.h`）与
  `estimatePages` 同一份页高，把「第 n 页」翻成滚动量。`print-preview.ts` 新增
  `pageScrollTop` / `pageOfScrollTop` / `clampPage` 三枚纯函数（zoom 七档互逆），
  `PreviewUi` 多一枚 `showPager`。
- 预览条变成「◀ 第 n / N 页（约）▶」，点击走 `scrollRef.scrollTo`；滚动时反向
  回写页码，`previewTargetRef` 在 smooth scroll 期间挡住中间帧，免得页码一路
  跳回起点。非预览态 `onScroll` 直接返回，不白跑。
- **诚实边界**：等距页距定位 ≠ 真分页。表格/图片跨页、孤行控制一概不模拟，
  纸面断页仍由 Chromium 的 `@media print` 决定；页码保留「约」字。
  `test-print-pager.mjs` 29 项。

### 三、ODT 导入：两棵主树只物化一次

- `odtToHtml` 此前 `cdoc`（content.xml）与 `sdoc`（styles.xml）被
  `Array.from(getElementsByTagName('*'))` 各物化 3~5 次；`findLocal` 更是
  「找第一枚也要先摊平整棵子树」。本轮把两棵树各预物化一次复用，其余子树
  只查一次、**不缓存**（给它们挂 WeakMap 在基准里是纯亏损）；`findLocal`
  改成遍历 HTMLCollection 早停。
- `odtToHtml(bytes, {cacheDesc:false})` 保留改前路径——A/B 两腿同源、只差
  一个参数，不依赖会过期的手工副本。夹具来自产品真出口
  `prosemirrorToOdtBytes`，另往 `styles.xml` 注入 N 枚空具名样式放大 sdoc
  （只放大节点数，不改两腿语义）。node 侧用 `@xmldom/xmldom` 并补一个
  `children` getter（linkedom 的 `localName` 带命名空间前缀，不适配 ODT）。
- 判据 `scripts/bench-odt-desc.mjs`：两腿 `{html, meta, warnings}` **逐字相同**，
  `getElementsByTagName('*')` 调用 **14 → 8** 次；同进程交替各 14 样本取中位。

| 夹具 | 改前 | 本轮 | 降幅 |
|---:|---:|---:|---:|
| 1 段 | 3.8ms | 4.5ms | 噪声覆盖 |
| 400 段 | 11.6ms | 9.9ms | −15.0% |
| 1200 段 | 26.3ms | 22.0ms | −16.3% |

  复跑一次 400/1200 段为 −8.1% / −18.4%，写区间 **−8~18%**；小件 4~6ms
  受 GC 噪声覆盖，不冒充有降幅。`test-odt-desc.mjs` 17 项（含空文档、
  无 `styles.xml` 等边界）。

### 门禁与账本

- tsc 0、build ✓；十六组结构测试全绿。
- 保真 docx 99.0% / 98.4%、记录对 715、四条变异腿 52.5 / 59.4 / 99.0 / 96.5
  一字不动，**`docs/fidelity.*` 与 HEAD 逐字节相同**；pptx 70.1% / 74.3%、
  42/19 全绿、`--mut no-ga` 42 条全红后复位。
- 往返账 `70f83a6d…` / `a1961f82…` 两次复跑一致。`modules` 保持 **67**
  （本轮没有新增 `src/lib` 文件）。
- 既有断言因本轮改动过期，按纪律**改断言不改代码**：`test-writer-shell` 的
  `PreviewUi` 对象多了 `showPager`、诚实边界注释换了口径。

### 顺延（D41）

- 图形壳剩 **235 对**：三维族 `sp3d`(3) / `props3d`(3) / `lightRig`(2) 要先
  定「夹具结构非法、真件应写成 effectLst 之后的兄弟」的口径再动；VML 老式
  形状族 `shape`(20) / `bodyPr`(19) / `rect`(15) / `fill`(14) / `line`(14)
  仍是模型无槽、写手发不出 `w:pict`。`wp:posOffset` 动 0 对的口径问题照旧。
- Impress 母版编辑（背景/配色可单轮闭环，占位矩形要第二套拖拽状态机）；
  Calc 缩放（落点在预存改动 `SheetEditor.tsx`，按房规换落点）；
  **pdf-lib 按需加载**仍等 `pdf-text-edit.ts` 入库。D32–D40 长尾原账不动。
- **诚实边界**：本轮及历轮 A/B 都是合成夹具，不是真件打开耗时；效果整片只
  回写三枚自闭合元素的属性，源件描边里的 `a:solidFill/a:schemeClr` 填充仍
  没回写；翻页预览只有纯函数与源码级断言，没做真机浏览器对撞；ODT 的
  node 判据依赖 DOM polyfill，浏览器端收益未实测。

## 发行说明 v0.182（不等宽分栏 / Impress 母版配色 / pptx 导出少写回）

本轮换到**正文族**动账（前五轮都在图形壳），另补一项连续顺延的功能与一处导出链热点。
仍是「代码 + 文档」两笔提交、逐文件 add，没碰那 7 个预存改动与
`pdf-text-edit.ts` 等未跟踪文件。

### 一、不等宽分栏（`w:cols` / `w:col`），3 对

- 包本来就有 `createColumns({equalWidth:false, children: Column[]})` 原生槽
  （`docx` 9.7.1），**post-pack 不用新建插入通道**：读手 `sectionOf` 把
  `w:cols/@equalWidth` 与逐枚 `w:col/@w|@space` 从「只读记账」升成带值载荷，
  `DocxSection` / `PageSetup` 加同形 `colsLayout`，`pageSetupOf` 与
  `resolvePage` 原样透传（缇，**不做 mm 换算**——换算误差会写成源件没说过的话），
  写手按载荷生成 `new Column({width, space})` 序列。
- 一处字面回填：包的 `equalWidth` 是 boolean、序列化成 `w:equalWidth="false"`，
  而 OOXML 的 ST_OnOff 字面是 `"0"`。与 v0.179 的 `FLAT/flat` 同款——只让包
  发壳，字面由 `patchColsOnOff` 按源件回填；不等宽分支不再传 `separate`，
  免得包发出非法的 `w:sep="false"`。
- Writer 页面设置面板补「不等宽」开关与逐栏宽输入（缇）。**屏上 CSS columns
  只能等宽**，逐栏宽只用于 docx 往返、不屏现（title 里写明）。
- **3 对全部落地**：`col|w` / `col|space` 两对 `lost → kept`，
  `cols|equalWidth` 一对 `value → kept`（不是把掉了粉饰成值变，是值变修好）。
  正文 **246/300 → 249/300（82.0% → 83.0%）**、合计
  **328/619 → 331/619（53.0% → 53.5%）**、掉了 274 → 272、值变 17 → 16。
  `test-columns.mjs` 25 项。

### 二、Impress 母版配色面板（D41 顺延）

- `MasterStyle` 的 8 字段、`.opd` 序列化/解析、pptx 导出六字段落点、导入回读、
  舞台/缩略图/放映的配色链**全是现成的**，本轮只补 UI：工具条「母版配色」
  开关 + 条件面板（底色 / 标题色 / 正文色 / 背景图 / 清除 / 恢复主题），
  复用 `.ppt-seq-panel` 与 `.ppt-shape-color`，CSS 零改动。
- 写入抽成 `ppt.ts` 的 `withMaster`（**换 master 引用**——`StaticSlide` 是 memo，
  原地改字段缩略图与放映不会重渲染）与 `stageColors`（母版 > 主题、
  单页背景只盖底色的优先级链），两个纯函数供结构测试钉。
- 背景图上传另起一枚 `fileRef`，不走写单页 `s.image` 的 `pickImage`；
  改 `bg` 不触发 `luminance` 重算（那只在 pptx 导入时算一次），
  `deck.theme` 也不动。**占位矩形仍不开放编辑**（要第二套拖拽状态机）。
  `test-impress-master.mjs` 33 项（含 `.opd` 往返与配色优先级）。

### 三、pptx 导出：没改过的 slide 不再回写

- `deckToPptxBytes` 在 `pptx.write()` 后解包注入动画/alt；旧写法对**进了循环
  但内容没变**的 slide 也 `zip.file(name, xml)` 写回。JSZip 对未被替换的条目
  复用原有压缩数据，替换过就得重新 DEFLATE——末尾那次 `generateAsync`
  因此把整包（含媒体、theme、其它 slide）重压一遍。
- 现在先留一份 `original`，只在 `next !== original` 时写回；真有
  `<p:transition>` / `<p:timing>` 注入的页照旧写回（专门有断言钉这条）。
- `deckToPptxBytes(deck, {legacyWriteBack:true})` 保留旧写法作 A/B 对照腿，
  两腿同源只差一个开关。判据 `scripts/bench-pptx-export.mjs`：两腿 zip 的
  部件名集合 + 逐部件字符串**逐字相同**（`docProps/core.xml` 时间戳按既有
  口径排除）；同进程交替各 10 样本取中位。

| 夹具 | 改前 | 本轮 | 降幅 |
|---:|---:|---:|---:|
| 4 页 | 8.7ms | 7.4ms | −15.3% |
| 24 页 | 14.8ms | 14.4ms | −2.6% |
| 80 页 | 38.4ms | 37.4ms | −2.5% |

  复跑一次为 −3.0% / −20.2% / −6.2%，写区间 **−3~20%**；这类夹具的收益
  上限就是「未改 slide 数 × slide XML 重压成本」，页多时 `pptx.write()` 主导、
  比例被稀释，10ms 级噪声也明显。`test-pptx-export.mjs` 12 项。

### 门禁与账本

- tsc 0、build ✓；十九组结构测试全绿。
- 保真 docx 99.0% / 98.4%、记录对 715、四条变异腿 52.5 / 59.4 / 99.0 / 96.5
  一字不动，**`docs/fidelity.*` 与 HEAD 逐字节相同**；pptx 70.1% / 74.3%、
  42/19 全绿、`--mut no-ga` 42 条全红后复位。
- 往返账 `699706e8…` / `94685d37…` 两次复跑一致。`modules` 保持 **67**
  （本轮没有新增 `src/lib` 文件）。

### 顺延（D42）

- 图形壳剩 **235 对**：三维族 `sp3d`(3) / `props3d`(3) / `lightRig`(2) 要先定
  「夹具结构非法、真件应写成 effectLst 之后兄弟」的口径；VML 老式形状族
  `shape`(20) / `bodyPr`(19) / `rect`(15) / `fill`(14) / `line`(14) 仍是
  模型无槽、写手发不出 `w:pict`。`wp:posOffset` 动 0 对的口径问题照旧。
- 正文长尾：`fldChar|fldCharType`(3 个源值) / `fldChar|fldLock`、`outline|val`、
  `smartTag|*`、`legacy|*`、±5 缇、`ind|left` 列表缩进覆盖、`docPr|id`、
  `lvlJc`、`w:color` 字面 val；`theme1.xml` 口径未定。
- Impress 占位矩形编辑（第二套拖拽状态机）；Calc 缩放（落点在预存改动
  `SheetEditor.tsx`，按房规换落点）；**pdf-lib 按需加载**仍等
  `pdf-text-edit.ts` 入库。D32–D41 长尾原账不动。
- **诚实边界**：本轮及历轮 A/B 都是合成夹具，不是真件打开耗时；不等宽分栏
  屏上仍按等宽显示，逐栏宽只往返；ODT 写手的 `style:columns` 没跟着扩，
  不等宽只走 docx；母版配色只有纯函数与源码级断言，没做真机浏览器对撞；
  pptx 导出的降幅在 10ms 级有明显噪声，结构性收益是未改 slide 不再回写。

## v0.183（节余量 / numbering legacy 两族 + 清除格式 + 写手部件文本单例解压）

承接 D42：连续两轮在正文族上动手，这一轮把「只读记账」里最容易闭环的五对一次性收掉。

**保真：5 对 `lost → kept`，正文 83.0% → 84.7%**

| 族 | 对数 | 机制 |
|---|---:|---|
| `type\|val` / `pgSz\|code` | 2 | `docx` 9.7.1 本来就有 `sections[].properties.type` 与 `page.size.code` 两个原生槽；读手把已有的 `attr` 查问升成带值载荷，`DocxSection` / `PageSetup` / `resolvePage` 原值透传，写手直接传槽——**post-pack 一行不用动** |
| `legacy\|legacy` / `legacySpace` / `legacyIndent` | 3 | 读手 `readNumbering` 把三枚 `attr` 升成载荷，`patchOneAbstractNum` 的 `insertKid` 锚点表里本来就写着 `'legacy'/'lvlJc'`；写手按 CT_Lvl 序插在 `lvlPicBulletId` 之后、`lvlJc` 之前 |

- 两族都沿用 v0.182 的「只读记账 → 带值载荷」路数，且**查问集合一字未变**：仍是原来的
  `attr(...)` 单漏斗（没换 `attrNum`，那是 `attr ?? attrL` 两条路，会撬动 `--mut no-attr`
  的记录对），保真账 `docs/fidelity.*` 与 HEAD 逐字节相同。
- 节起法走 `Object.values(SectionType)` 白名单，自造档不写（宁可少一枚，不赌坏件）；
  `paperCode` 非数值不写。三枚 legacy 原值 `1/0/0` 直传、不做 onOff 归一——源件没说过
  的话不替它说。`test-section-legacy.mjs` 30 项（含「无源值的件不凭空多出来」与按块对位）。

**功能：Writer 清除格式**（D42 里挂了几轮的「右键菜单刻意不放」清单项）
- 右键菜单与工具条各一个入口，都走 `runCtx('clearFormat')`：`format-painter.ts` 新增
  `clearableMarkNames`，与格式刷同源，**只摘字符外观 mark**（粗斜/字色/高亮/字号…）+
  三个样式标签；批注锚 / 书签 / 修订 / 超链接这类带身份的标记整列保留，标题节点也不
  转回段落——清掉别人的标注属于「删除批注」，不是「清除格式」。无选区时不灰掉，清的是
  光标处后续输入会带上什么格式。`test-clear-format.mjs` 23 项。

**性能：写手 post-pack 同一份 `document.xml` 从 17 次解压收成 5 次**
- v0.178 的 `PackSession` 省了「整包解包 + 重压」，但十余个补丁仍各自
  `zip.file('word/document.xml').async('string')`。探针量出 JSZip **对同一条目二次
  `async` 仍会重新 inflate**（首次 1.24ms / 二次 1.53ms），链上 17 次部件解压占端到端
  6.8%。现在会话按部件名缓存当前文本：`partText` 查表、`setPart` 写回时**同步更新**，
  下一枚补丁读到的仍是刚写下的内容（等价性关键）。
- 缓存只在 `zip === sess.zip` 的共享路径生效；A/B 对照腿 `{legacyPartText:true}` 不建
  缓存表，两腿同源只差一个参数。`bench-docx-parts.mjs` 的判据是逐部件字符串逐字相同
  （归一 `core.xml` 时间戳与超链接随机 `rId`）+ 同一条链上的解压次数。
- **数字不粉饰**：解压次数 **17 → 5** 是确定的结构性事实；端到端只在「文字 ×40」
  放大档两次复跑稳定 **+12.7% / +13.1%**，小件与超大件档在 ±3% 噪声里（大件被 Packer
  序列化与高压缩比稀释），不冒充全档降幅。`test-docx-part-cache.mjs` 15 项。
- 顺手修了一把旧尺：`bench-docx-pack.mjs` 的对照腿硬编码「13 个补丁」，v0.182 加了
  `patchColsOnOff` 后就过期了（这把尺几轮没重跑）。改成从当前产品源动态取补丁数、
  第二处仍校验「读写配对」相等；复跑语义等价 ✓、−44.9%。

**门禁**：tsc 0、build ✓；22 组结构测试全绿（新增 30 + 23 + 15 项）。保真 99.0%/98.4%、
记录对 715、四条变异腿 52.5 / 59.4 / 99.0 / 96.5 一字不动；pptx 70.1/74.3、42/19 全绿、
`--mut no-ga` 42 条全红后复位；往返账 `1aedef8f…`/`782fc0efa…` 两次复跑一致，
5 对逐对说得清且 out 等于 src 原值。`modules` 保持 **67**（没新增 `src/lib` 文件）。

### 顺延（D43）

- 图形壳剩 **235 对**：三维族 `sp3d`/`props3d`/`lightRig` 要先定「夹具结构非法、
  真件应写成 effectLst 之后兄弟」的口径；VML 老式形状族仍是模型无槽、写手发不出
  `w:pict`。`wp:posOffset` 动 0 对（值在元素文本里、账本无此对）；`sizeRelH/V` 真件要
  `mc:AlternateContent`。
- 正文长尾：`fldChar|fldCharType`(3 个源值) / `fldChar|fldLock`、`outline|val`、
  `smartTag|*`(2)、±5 缇、`ind|left` 列表缩进覆盖、`docPr|id`、`lvlJc`、
  `w:color` 字面 val；`theme1.xml` 口径未定。`legacy|*` 与 `type|val`/`pgSz|code`
  v0.183 已补。
- Impress 占位矩形编辑（第二套拖拽状态机）；Calc 视图缩放（落点在预存改动
  `SheetEditor.tsx`，按房规换落点或只记结论）；**pdf-lib 按需加载**仍等
  `pdf-text-edit.ts` 入库。D32–D42 长尾原账不动。
- **诚实边界**：本轮及历轮 A/B 都是合成夹具，不是真件打开耗时；节起法与纸型档位号
  屏上零兑现、只走 docx 往返（ODT 链没扩）；清除格式只有纯函数与源码级断言，
  没做真机浏览器对撞；部件文本缓存的端到端收益只在放大档稳定，结构性收益是省
  12 次 inflate；本轮曾试过 pptx 导入 `descendantsByName` 索引化，实测在同一子树
  只查一次的链上**反而慢 9%**，已按「不粉饰数字」完整回退、未提交。

## v0.184（两族「值变」修复 + PDF 首页末页 + pptx 动画链早停）

承接 D43。前几轮都在补「掉了」的属性，这一轮改修**名字在、值不对**的两笔——
`value → kept` 是修好值变，不是把掉了粉饰成值变。

**保真：2 对 `value → kept`，正文 84.7% → 85.3%**

| 族 | 原值 → 旧写出 | 机制 |
|---|---|---|
| `color\|val` | `ff0000` → `adbbd4` | 源件把字面色与主题三枚一起写；读手此前只留主题解析后的屏上色，字面值整枚忘了存。把 `data-ctheme` 从 3 格扩成 5 格（`ref;tint;shade;lit;base`），写手用现成的 `mergeTagAttrs` **同名改值**回填（追加会造出第二枚 `w:val` = 非法 XML）。`base` 是导入时屏上色，用户后来改过色就不回填旧字面值 |
| `lvlJc\|val` | `center,left` → `left,start` | 读手把 `w:lvlJc` 存进 `LvlDef` 走屏上链，但 numbering.xml 补丁链的 `DocxLvlMeta` 没带这一枚，包恒发 `start`。复用同一次 `val()` 查问升成带值载荷，`patchOneAbstractNum` 照 `suff` 那段按 ilvl **改值**（包恒发该元素，不是插元素） |

- 两族都**复用既有 `attr`/`val` 查问**，没新开漏斗；`docs/fidelity.*` 与 HEAD
  **逐字节相同**，四条变异腿与记录对 392/416/715/685 一字不动。
- 逐对说得清：`color|val` 的 out 就是 `ff0000`，`lvlJc|val` 的 out 覆盖
  `center/left/start`；掉了仍 267、值变 16 → **14**。`test-value-fidelity.mjs` 24 项
  （含陈旧守卫、按块对位、无源值不凭空造）。顺手把 `test-docx-runprops` 里
  硬编码 3 格载荷的旧断言改成 5 格口径。

**功能：PDF 首页 / 末页 + 页码钳制单一出口**
- 工具条原有「上一页 / 页码输入 / 下一页」，钳制散在 `Math.max(1,…)`、
  `Math.min(numPages,…)` 与「越界就不跳」三处，且没有首页/末页。现在
  `pdf-geo.ts` 加 `pageNav(cur,total)` 一次算全四枚目标页与两端可用状态，
  钳制**转调** Writer 打印预览那份 `clampPage`（不重写一遍）；`gotoPage` 内部
  统一夹回 `[1,N]`。新增 ⏮ / ⏭ 两枚按钮。`test-pdf-nav.mjs` 34 项。

**性能：pptx 导入动画链改成「命中即停」**
- `animEffectOf` 原先 `descendantsByName(c,'anim').some(a =>
  descendantsByName(a,'attrName').some(…))` 嵌套两次把整棵子树按名摊平成数组；
  出场判定也先收齐所有 `animEffect`。现在 `hasFlyXY` / `hasExitEffect`
  一次前序遍历、命中即返回、零数组物化。**不建缓存、不改数据结构**——
  与 v0.183 试过又回退的惰性索引化划清界线（那条在每子树只查一次的链上慢 9%）。
  `inAnim` 门是等价性关键：`attrName` 必须是某枚 `anim` 的后代，否则会把 fade 误判成 fly。
- 判据：`{legacyAnimScan:true}` 让两腿同源只差一个参数，Deck 稳定序列化
  （Map 展开 + 键排序 + 随机 id 归一）**逐字相同**；夹具来自产品真出口
  `deckToPptxBytes`，覆盖 fade/wipe/fly 三支与出场。`bench-pptx-anim.mjs` +
  `test-pptx-anim.mjs` 25 项。
- **数字不粉饰**：端到端 4/24/60 页为 −6.3% / +2.2% / +0.1%（噪声内，
  这处开销被 XML 解析与文本提取盖住）；把两腿遍历算法复刻成第二条腿对撞的
  **纯遍历段**才是确定收益：60 anim 命中首枚 **−66.8%**、全不命中 **−66.9%**、
  200 anim 命中末枚 **−42.0%**，三种形状布尔结果逐字相同。

**门禁**：tsc 0、build ✓；25 组结构测试全绿（新增 24 + 34 + 25 项）。
保真 99.0%/98.4% 且与 HEAD 逐字节相同；pptx 70.1/74.3、42/19 全绿、
`--mut no-ga` 42 条全红后复位；往返账 `c450f28c…`/`b1978355…` 两次复跑一致。
两把旧尺复跑：`bench-docx-pack` 语义等价 ✓ / −50.0%、`bench-docx-parts`
部件解压 **18 → 5**（比上轮多 1 次，因新增 `patchColorLits` 补丁）。
`modules` 保持 **67**（没新增 `src/lib` 文件）。

### 顺延（D44）

- 图形壳剩 **235 对**：三维族 `sp3d`/`props3d`/`lightRig` 要先定「夹具结构非法」
  口径（删 `props3d` 会动往返账分母、留它就得发非法元素）；VML 老式形状族
  仍是模型无槽。`wp:posOffset` 动 0 对的口径问题照旧；`sizeRelH/V` 真件要
  `mc:AlternateContent`。
- 正文长尾：`fldChar` 三对、`outline|val`、`smartTag|*`、±5 缇、`ind|left`
  显式 0、`docPr|id`、`name|val`(`text1`)、`startOverride|val`；`theme1.xml`
  口径未定。`color|val`/`lvlJc|val` v0.184、`legacy|*`/`type|val`/`pgSz|code`
  v0.183、`col|w`/`col|space`/`w:cols equalWidth` v0.182 已补。
- Impress 占位矩形编辑（第二套拖拽状态机）；Calc 缩放（落点在预存改动
  `SheetEditor.tsx`，按房规换落点）；**pdf-lib 按需加载**仍等
  `pdf-text-edit.ts` 入库。D32–D43 长尾原账不动。
- **诚实边界**：本轮及历轮 A/B 都是合成夹具；`color|val` 的字面色只走 docx
  往返、屏上仍显示主题解析色；PDF 页码只有纯函数与源码级断言，没做真机
  浏览器对撞；动画早停的端到端收益在噪声内，确定收益只在纯遍历段。

## v0.185（样式显式零两族 `value→kept` + 自动缩放两档 + pptx 文本拼接零数组）

承接 D44。这轮修的是**样式链上「显式 0」被吞**——它不是「没写」，
而是 Word 用来压掉上一层样式继承缩进的声明。两对 `value → kept`，
仍是修好值变，不是把掉了粉饰成值变。

**保真：2 对 `value → kept`，正文 85.3% → 86.0%**

| 族 | 源值 → 旧写出 | 机制 |
|---|---|---|
| `ind\|left` | `0, 420` → 只有 `420` | 显式 0 在 `styles.xml` 的 Normal 样式 `w:ind` 上（**不是段落**）。读手 `styleList()` 的 `if (left)` 把 0 当 falsy 吞掉，写手对内建样式又根本不发 `<w:ind>`。现在读手只认**本层自己 pPr 的属性表**，存两枚只往返布尔；写手按 styleId 在 styles.xml 补回那枚显式 0 |
| `ind\|right` | `0, 210` → 只有 `210` | 同上，同一枚 `<w:ind>` 上的第二格 |

- **归属纪律**：只认 `info.pPr`，不认 `styleView` 合并后的链视图（v0.161
  主题字体引用同款）——`ReportHead` 是 basedOn `Normal` 的子样式，父层那枚 0
  若摊到子层再写一遍，就把「跟着父层走」改成了「钉死在子层」。直接读已解析
  元素的属性表，**不走 `attr`/`attrL` 漏斗**：`w:left/w:right` 在屏上那条链
  里已经查问过，读手查问仍是 672，`docs/fidelity.*` 与 HEAD **逐字节相同**，
  四条变异腿 52.5 / 59.4 / 99.0 / 96.5 与记录对 392/416/715/685 一字不动。
- **写回按 CT_PPrBase 序**：`ind` 位次 32（`spacing` 之后、`jc`/`outlineLvl`/
  `rPr`/`sectPr` 之前），没有 `<w:pPr>` 不凭空造、自闭合的换成有内容形态；
  已有 `<w:ind>` 只补**缺的**同名属性，不覆盖也不追加第二枚。陈旧守卫天然
  成立：用户后来改缩进走的是段落直接格式（document.xml 的 pPr），会压过样式
  那枚 0，不是把旧值写回改过的文档。
- 正文 **258/300 = 86.0%**、合计 **340/619 = 54.9%**、值变 **14 → 12**
  （正文 12 → 10）、掉了仍 267、图形壳 82/319 不动。`test-style-ind-zero.mjs`
  42 项（含父层不误记、`w:start="0"` 新式写法不误认、按 styleId 对位、
  用户改过缩进不覆盖）。

**功能：适应页宽 / 适应整页，PDF 与 Impress 共用一份纯函数**

- `view-zoom.ts` 新增 `fitZoom(pageW,pageH,viewW,viewH,mode,padding)`、
  `nearestZoomStep`、`FitMode`；三种口径定在一处：页面尺寸必须**未缩放**
  （PDF 用 `getViewport({scale:1})`、Impress 用 `rect/当前 zoom` 还原）、容器
  扣内边距、结果不在这里夹档位（PDF 是连续 scale、Impress 是七档下拉）。
  非法尺寸一律回 1，不产生 0 / Infinity 缩放。
- PDF 工具条加 ↔ / ⤢，按自己的 `[0.5,3]` 夹一次；Impress 加同两枚按钮，
  扣掉 `.ppt-stage-wrap` 的 26px padding 后落到**最近一档**（否则 select 里
  没有这个百分比会显示空白）。**Writer 未接**——它的纸面宽是固定版心，
  自动档没有新的可用信息，别为了对称硬塞。`test-fit-zoom.mjs` 45 项。

**性能：pptx 导入文本拼接不再摊平数组**

- `paragraphText(p)` 原为 `descendantsByName(p,'t').map(textOf).join('')`：
  每个形状每个段落都要把整棵子树摊平成两个数组，是导入里最热的一条路径。
  改成一次前序、`a:t` 命中即拼接并累加，零中间数组。与 v0.184 早停同族
  但不同处——这里是「命中即拼接」而不是「命中即返回」，同样不建缓存。
  `a:t` 是叶子，命中后不再递归，否则 `textOf` 已含后代文本会重复计一遍。
- 表格单元格那处仍是按格摊平，**本轮刻意不动**（不是逐段热路径，改了会让
  范围失控）。`{legacyParaText:true}` 让两腿同源只差一个参数，Deck 稳定
  序列化逐字相同，夹具来自产品真出口 `deckToPptxBytes`。
- **数字不粉饰**：端到端 4/24/60 页 **−3.0% / +1.7% / +1.4%（噪声内）**，
  这处开销被 XML 解析与 zip 解压盖住；把两腿遍历算法复刻成第二条腿对撞的
  **纯遍历段**才是确定收益：4 run×3 噪声×200 段 **−22.6%**、
  20 run×6 噪声×120 段 **−5.0%**、80 run×10 噪声×40 段 **−11.6%**，
  三种形状文本逐字相同。`test-pptx-paratext.mjs` 21 项 +
  `bench-pptx-paratext.mjs`。

**门禁**：tsc 0、`tsc && vite build` ✓（`pnpm run build` 里的
`copy-pdfjs-assets.mjs` 清理 `public/pdfjs` 被环境的安全策略按批量删除拦下，
改跑等价两步，如实记）；**29 组结构测试全绿**（新增 42 + 45 + 21 项，
另把 `test-impress-zoom` / `test-pptx-anim` 两条钉死整串导入/整串类型字面量的
旧断言改成按关键名判）。保真 99.0%/98.4% 且与 HEAD 逐字节相同、四条变异腿
不动；pptx 70.1/74.3、42/19 全绿、`--selftest --mut no-ga` 42 条全红后复位；
往返账 `8cdac69a…`/`a3932552…` 两次复跑一致。两把旧尺：`bench-docx-pack`
语义等价 ✓ / −45.6%、`bench-docx-parts` 部件解压 **18 → 5** 且语义等价 ✓。
`modules` 保持 **67**。

### 顺延（D45）

- 图形壳剩 **235 对**：三维族 `sp3d`/`props3d`/`lightRig` 要先定「夹具结构
  非法」口径；VML 老式形状族仍是模型无槽。`wp:posOffset` 动 0 对、
  `sizeRelH/V` 真件要 `mc:AlternateContent`。
- 正文长尾：`fldChar` 三对、`outline|val`、`smartTag|*`、±5 缇、`docPr|id`、
  `name|val`(`text1`)、`startOverride|val`；`theme1.xml` 口径未定。
  `ind|left`/`ind|right` 显式 0 v0.185、`color|val`/`lvlJc|val` v0.184、
  `legacy|*`/`type|val`/`pgSz|code` v0.183 已补。
- Impress 占位矩形编辑（第二套拖拽状态机）；Calc 缩放（落点在预存改动
  `SheetEditor.tsx`，按房规换落点）；**pdf-lib 按需加载**仍等
  `pdf-text-edit.ts` 入库（本轮 build 仍见 `INEFFECTIVE_DYNAMIC_IMPORT` 警告）；
  **Writer 的自动缩放两档未接**。D32–D44 长尾原账不动。
- **诚实边界**：本轮及历轮 A/B 都是合成夹具；显式 0 只走 docx 链、ODT 未扩，
  且只认 `w:left/w:right` 字面（`w:start/w:end` 新式写法不认）；自动缩放只有
  纯函数与源码级断言，没做真机浏览器对撞，Impress 的 `rect/zoom` 还原依赖
  CSS zoom 等比缩放这一假设；文本拼接的端到端收益在噪声内，确定收益只在
  纯遍历段。

## v0.186（书签 `w:id` 两族 `value→kept` + 母版占位矩形编辑 + 写手零正则）

承接 D45。这轮修的也是「名字在、值不对」，而且比前两轮更实在：
**写出包里三对书签的 `w:id` 全是 1**，Word 里几枚书签同号就分不开，
是真坏件而不只是账本上一笔值变。

**保真：2 对 `value → kept`，正文 86.0% → 86.7%**

| 族 | 源值 → 旧写出 | 机制 |
|---|---|---|
| `bookmarkStart\|id` | `7, 9` → `1` | 读手 `bookmarkStart/End` 分支**已查问过** `w:id`，只是没进模型。写手 `new Bookmark({ id: 书签名 })` 把数字令牌传成了名字，docx 库于是每枚恒发 `w:id="1"`。现在载荷扩成「书签名;源 id」两格，post-pack 按名对位改回 |
| `bookmarkEnd\|id` | `7, 9` → `1` | 同上，与 Start 栈式配对，共享同一个目标 id |

- **按书签名对位，不按出现序**：读手把跨段书签拆成每段一枚同名 span，
  写出发出的两枚 `_Cross` 都该回到源 id `9`，Word 才认得出是一枚跨段书签。
  `patchBookmarkIds` 里 Start 改自身并压栈、End 弹栈改同一个值，嵌套与多枚
  都不串位；没有映射（用户新建）、孤立 End、标签没写 `w:id` 一律不动。
- `data-oo-bookmark` 是整串字符串槽，扩成两格**零 schema 改动**；写手按
  **最后一个**分号拆（书签名含分号也不丢），`Bookmark` 组件仍只收纯名字。
  `w:id` 复用已有查问，读手查问仍 **672**，`docs/fidelity.*` 的覆盖率与四条
  变异腿一字不动。`test-bookmark-ids.mjs` 31 项（含源 id 换成 21/33 也按名
  对位、嵌套栈式配对、`xmlAttr` 转义、无源值不凭空造）。
- 正文 **260/300 = 86.7%**、合计 **342/619 = 55.3%**、值变 **12 → 10**、
  掉了仍 267、图形壳 82/319 不动。

**功能：Impress 母版占位矩形编辑（评估文档里挂了多轮的缺口）**

- 新增 `src/lib/master-rect.ts`（**`modules` 67 → 68**，本轮唯一新增的 lib 文件）：
  归一化 0..1 的 `rectFor` / `dragRect` / `rectStyle`，缺省矩形与
  `pptx-export.ts` 那两组英寸默认值同源（导出侧 `rect.x * W`）。
- PptEditor 加**第二套拖拽状态机**：占位矩形不是 `SlideShape`，没有 id 给
  `patchShape` 用，落点是 `deck.master.titleRect/bodyRect`。位移按舞台宽高折成
  比例（与形状拖拽同款，CSS zoom 自动抵消），写回复用 v0.182 的
  `patchMaster` **唯一出口**（换 master 引用，memo 化的缩略图/放映才重渲染），
  不另开一条 `edit(d => d.master = …)`。工具条「占位框」开关 + 两枚虚线框
  与右下角缩放手柄；关着时一次拖拽状态都不建。`test-master-rect.mjs` 52 项。
- **Writer 的自动缩放两档仍未接**，D45 的这条顺延原样保留。

**性能：写手 `tagWithAttrs` / `retag` 去掉动态正则编译**

- 两处原先每次调用都 `new RegExp(...)` 现编译——图片壳补丁一个
  `<w:drawing>` 要 retag 十几枚，每枚属性还要再编译一次。改成纯字符串定位，
  **零动态正则、零临时数组**；改前算法原样留成 `legacyRetag:true` 对照腿
  （两腿同源只差一个参数），产物逐部件字符串归一后逐字相同。
- **纯函数段（真实形状：每枚 drawing 单独 13 次 retag）20 / 200 / 1000 drawing
  三档稳定 −79.0% / −79.2% / −79.1%**，产物 hash 一致；
  **端到端 25.4 → 27.8ms（−9.3%，噪声内，不冒充降幅）**——小夹具只有 5 张图，
  这处开销被 XML 解析与序列化盖住。`test-docx-retag.mjs` 24 项 +
  `bench-docx-retag.mjs`。
- 两处**判据修正**照实记：基准原先只累加产物长度会假绿（长度相同值不同也过），
  改成逐字符滚 hash；「把 1000 个 drawing 拼成一个大串」不是产品形状
  （`patchImgXml` 是逐块切出来改的），按单块重测才有上面那组稳定数字。
- **一处语义修正单独列出，不算性能收益**：改前 `String.replace(re, '$1"'+v+'"')`
  会把载荷值里的 `$&` 当替换模式展开、写出坏件（`descr` 是用户文本，可能带
  `$`）；本轮字符串拼接按字面写入。没有拿真件实测过这一形状。

**门禁**：tsc 0、`tsc && vite build` ✓（`pnpm run build` 的 pdfjs 资源清理仍被
环境安全策略的批量删除守卫拦下，与上轮同）；**32 组结构测试全绿**
（新增 31 + 52 + 24 项；另把 `test-docx-part-cache` 的 opts 字面量、
`test-impress-master` 的面板文案两条过期断言按新口径改，不改产品代码凑测试）。
保真 99.0%/98.4%、四条变异腿 52.5 / 59.4 / 99.0 / 96.5 与记录对
392/416/715/685 一字不动；pptx 70.1/74.3、42/19 全绿、
`--selftest --mut no-ga` 42 条全红后复位；往返账
`a1cb9635…`/`9df6c593…` 两次复跑一致。两把旧尺：`bench-docx-pack`
语义等价 ✓ / −53.5%、`bench-docx-parts` 部件解压 **18 → 19 → 5**
（新增书签补丁多一次读，语义等价 ✓）。
- **账本元信息**：`docs/fidelity.*` 与 `docs/pptx-fidelity.*` 这轮**不再与 HEAD
  逐字节相同**——唯一差异是 provenance 的 `modules` 67 → 68（新增
  `master-rect.ts`），覆盖率与变异腿数字一字不动。按「账本要能给定 rev 就给定
  答案」把四份随 rev 更新入库，不攒元信息差。

### 顺延（D46）

- 图形壳剩 **235 对**：三维族 `sp3d`/`props3d`/`lightRig` 要先定「夹具结构
  非法」口径；VML 老式形状族仍是模型无槽。`wp:posOffset` 动 0 对、
  `sizeRelH/V` 真件要 `mc:AlternateContent`。
- 正文长尾：`fldChar` 三对、`outline|val`、`smartTag|*`、±5 缇、`docPr|id`、
  `docPr|name`、`name|val`(`text1`)、`startOverride|val`；`theme1.xml` 口径未定。
  `bookmark*|id` v0.186、`ind|left`/`ind|right` v0.185、
  `color|val`/`lvlJc|val` v0.184 已补。
- Impress 占位矩形编辑 v0.186 已补；Calc 缩放（落点在预存改动
  `SheetEditor.tsx`，按房规换落点）；**pdf-lib 按需加载**仍等
  `pdf-text-edit.ts` 入库；**Writer 自动缩放两档未接**。D32–D45 长尾原账不动。
- **诚实边界**：本轮及历轮 A/B 都是合成夹具；书签 `w:id` 只走 docx 链、ODT 未扩；
  占位矩形只有纯函数与源码级断言，没做真机拖拽对撞，`rect/zoom` 还原依赖
  CSS zoom 等比缩放这一假设；写手零正则的端到端收益在噪声内，确定收益只在
  纯函数段；`$&` 那处修正没拿真件实测。

## v0.187（修订/编号两族 `value→kept` + Writer 自动缩放档 + 写手补丁链正则收尾）

承接 D46。两族都是「名字在、值不对」，而且都能复用**已经查问过**的源值，
所以保真账与四条变异腿仍是逐字节不动的那一组数字。

**保真：2 对 `value → kept`，正文 86.7% → 87.3%**

| 族 | 源值 → 旧写出 | 机制 |
|---|---|---|
| `ins\|id` | `7` → `1` | 写手给修订壳的 id 是 `dt.revId++`（从 1 起）。读手在 `w:ins/w:del` 分支**已查问过** `w:id`，但按「重编不该由我们决定」留成只读记账。本轮由 `docxToDocMeta` 从源包正则提取原值存进 `DocMeta.revIds`，`patchRevIds` 按 `<w:ins>/<w:del>` 出现序前缀对位**同名改值** |
| `startOverride\|val` | `3` → `1` | 包对每个重建出来的 `<w:num>` 恒发 `<w:startOverride w:val="1"/>`。读手把原值按 `<w:num>` 出现序存进 `DocxNumbering.starts`（复用已有 `attrNum` 查问），`patchNumOverrides` 前缀对位改回去 |

- **`ins|id` 不改读手、不碰 `revision-extension.ts`**：那份 mark 只有
  author/date，且是工作树里的预存改动，按房规不能动。走 `docxToDocMeta`
  这条**正则读**的部件（教训⑤：正则读的不进保真账）把源值带进 meta，
  零新增查问对、零模型改动。写出包比源包多出来的修订（跨段拆开）保持
  包自己的号，不凭空造令牌。
- **编号只存序不存号**：与 v0.150 的 `patchNumberingXml` 同一条纪律——
  包的 `numId`/`abstractNumId` 会重排，按号认会贴错定义。`starts` 按
  `<w:num>` 出现序先占一格（连没有 numId 的 num 也占，避免整体错位），
  只对源里说过的那几串改值，认不出的整块不动。
- 正文 **262/300 = 87.3%**、合计 **344/619 = 55.6%**、值变 **10 → 8**、
  掉了仍 267、图形壳 82/319 不动、读手查问仍 672。`test-rev-start.mjs`
  28 项（含源值换 21/5 仍按序对位、ins/del 混排、空串占位、编号串比写出包长）。

**功能：Writer 自动缩放两档，三处 UI 收齐**

- **判断修正**：v0.185 写「纸面固定版心，自动档没有新信息」偏保守——纸面宽
  确实固定，但**视口宽随侧栏开合与窗口大小变化**，「适合页宽」有实际意义。
  现在 PDF / Impress / Writer 共用同一份 `fitZoom`：Writer 用未缩放的
  `effPx.w/h` + `scrollRef` 视口，结果落到**最近档位**（档位制下拉不显示
  没有的百分比）。`test-fit-zoom.mjs` 补 4 项接线断言（共 49 项）。
- Impress 占位矩形 v0.186 已补；剩下 Calc 缩放（落点在预存改动文件，
  按房规换落点）、版式库/SmartArt 仍未做。

**性能：写手补丁链最后三处循环内动态正则收干净**

- v0.186 收掉 `tagWithAttrs`/`retag` 后，`mergeTagAttrs`、
  `patchStyleIndZeros`、`pprOrder` 三处仍在循环里 `new RegExp(...)`。
  本轮共用 `hasAttrNamed`（字符串定位 + 空白收边，与 `tagWithAttrs`
  同一套口径），旧算法原样留成 `legacyAttrScan:true` 对照腿，
  两腿同源只差一个参数、产物逐部件字符串归一后逐字相同。
- **纯函数段 2 万 / 10 万 / 40 万次属性判定 −80.2% / −79.5% / −79.0%**，
  结果逐字相同；**端到端 26.2 → 28.0ms（−7.1%，噪声内，不冒充降幅）**。
  `test-docx-attrscan.mjs` 24 项 + `bench-docx-attrscan.mjs`。
- 三条旧断言按新口径改（书签补丁链尾变量、`patchStyleIndZeros` 的过滤
  形态、opts 新增开关），**不改产品代码凑测试**。

**门禁**：tsc 0、`tsc && vite build` ✓（`pnpm run build` 的 pdfjs 资源清理
仍被环境安全策略的批量删除守卫拦下，与前两轮同）；**34 组结构测试全绿**
（新增 28 + 24 项 + 自动缩放 4 项）。保真 99.0%/98.4% 且与 HEAD
**逐字节相同**、四条变异腿 52.5 / 59.4 / 99.0 / 96.5 与记录对
392/416/715/685 一字不动；pptx 70.1/74.3、42/19 全绿、
`--selftest --mut no-ga` 42 条全红后复位；往返账
`4e310316…`/`adca5fb6…` 两次复跑一致。两把旧尺：`bench-docx-pack`
语义等价 ✓ / −53.2%、`bench-docx-parts` 部件解压 **19 → 21 → 5**
（两个新补丁各多一次读，预期且语义等价 ✓）。`modules` 保持 **68**
（没新增 lib 文件，两份保真账的 provenance 不用动）。

### 顺延（D47）

- 图形壳剩 **235 对**：三维族 `sp3d`/`props3d`/`lightRig` 要先定「夹具结构
  非法」口径；VML 老式形状族仍是模型无槽。`wp:posOffset` 动 0 对、
  `sizeRelH/V` 真件要 `mc:AlternateContent`。
- 正文长尾：`fldChar` 三对、`outline|val`（要先定 rPr 内的 schema 位次 +
  新建 charExtra 槽，包没原生槽）、`smartTag|*`、±5 缇、`docPr|id`/
  `docPr|name`（VML 与图形壳没生成 `data-img` 载荷，是老问题不是新 bug）、
  `name|val`(`text1`)、`theme1.xml` 口径未定。`ins|id`/
  `startOverride|val` v0.187、书签两族 v0.186、显式 0 v0.185 已补。
- Calc 缩放（**落点在预存改动 `SheetEditor.tsx`，换落点或只记结论**）；
  **pdf-lib 按需加载**仍等 `pdf-text-edit.ts` 入库；版式库 / SmartArt /
  3D / Fontwork、页面边框 / 水印 / 邮件合并 / 公式编辑器 / 数据透视表未做。
  Writer 自动缩放档、Impress 占位矩形已补。D32–D46 长尾原账不动。
- **诚实边界**：本轮及历轮 A/B 都是合成夹具；`startOverride` 按出现序前缀
  对位，真件里多串列表未实测；`ins|id` 只走 docx 链、ODT 未扩，且原值是
  写手侧从源包正则读来的，不是读手模型；Writer 自动档与占位框都只有纯函数
  与源码级断言，没做真机浏览器对撞；零正则的端到端收益在噪声内，确定收益
  只在纯函数段。

## v0.188（`docPr` 两族 `value→kept` + 文档属性读写链 + `patchImgXml` 惰性遍历）

承接 D47。这轮把「写手侧从源包正则取原值」这条路再走一次（第三个用户），
并顺手修掉一处**另存即丢元数据**的坏件。

**保真：2 对 `value → kept`，合计 55.6% → 55.9%**

| 族 | 源值 → 旧写出 | 机制 |
|---|---|---|
| `docPr\|id` | `7,8,9,11,12` → `1,7,8,11`（两枚空壳） | WPS 形状与艺术字被读手展平成文字后没有 `data-img` 载荷，包为那两枚发出 `id="1"`。`docxToDocMeta` 从源包按 `<wp:docPr>` 出现序正则取原值，`patchDocPr` 前缀对位改回 |
| `docPr\|name` | `图片 1…艺术字` → 少了「形状 1」「艺术字」，多一个空串 | 同上，同一枚元素上的第二格 |

- **零新增查问 / 不动读手**：这两对读手在 `readImgPayload` 里早查问过，只是
  展平后的形状没走那条路。源包是**正则读**的（不进保真账），读手查问仍 672，
  `docs/fidelity.*` 与 HEAD **逐字节相同**，四条变异腿 52.5 / 59.4 / 99.0 /
  96.5 与记录对 392/416/715/685 一字不动。`patchDocPr` 复用 `tagWithAttrs`
  做同名改值 / 缺则追加，绝不追加第二枚同名属性；源里空串占位不回写。
- 图形壳 **82/319 = 25.7% → 84/319 = 26.3%**、合计 **344/619 = 55.6% →
  346/619 = 55.9%**、值变 **8 → 6**、正文 262/300 = 87.3% 不动、掉了仍 267。
  `modules` 仍 **68**（没新增 lib 文件）。

**功能：文档属性（标题 / 主题 / 作者 / 关键词 / 备注）**

- 修的是坏件：`new Document` 原先把 `creator` / `title` 硬编码成
  `OpenOffices` / `OpenOffices 文档`，导入别人的文档另存一次，原作者与标题
  就被冲掉。现在 `docxToDocMeta` 从 `docProps/core.xml` 正则读五格进
  `DocMeta.docProps`，写手走 docx 包的 `IPropertiesOptions` 原生槽
  （包自己转义，不手拼 XML），没写过的格用 `DEFAULT_DOC_PROPS` 回落。
- DocEditor 工具条加「文档属性」按钮 + 五格可编辑面板，`patchMeta` 回写，随
  `.odoc` 与 docx 往返。`parseCoreProps` / `docPropsOf` 放在 `src/lib/docx.ts`
  里，不新增 lib 文件（`modules` 不变）。`test-docpr-props.mjs` 37 项覆盖
  实体还原、缺省回落、端到端写出 core.xml、用户改值、源码级接线。

**性能：`patchImgXml` 不再物化整块 XML 数组**

- 改前 `[...xml.matchAll(/<w:drawing>…/g)]` 把每一项都是**整块 XML** 的元素
  收进一个数组，只为先数够不够再逐块改。改后产品路径直接用惰性迭代器
  边走边拼，计数闸门移到末尾（块数对不上就丢弃已算结果，语义等价）。
  `legacyBlockScan:true` 是物化数组的对照腿，两腿同源只差一个参数、
  逐部件字符串归一后逐字相同。
- **纯函数段 50 / 500 / 2000 drawing −7.9% / −7.3% / −6.7%**（收益比前几轮
  小，如实写）；**端到端 25.7 → 28.1ms（−9.4%，噪声内，不冒充降幅）**。
  `test-img-lazy.mjs` 11 项 + `bench-img-lazy.mjs`。只动 `patchImgXml` 这一处，
  `patchBorderBlocks` / `patchNumOverrides` 两处同类物化**顺延**，不算全链优化。

**门禁**：tsc 0、`tsc && vite build` ✓（`pnpm run build` 的 pdfjs 资源清理仍
被环境安全策略的批量删除守卫拦下）；**36 组结构测试全绿**（新增 37 + 11 项；
三条旧断言按新口径改：主链链尾变量、`patchImgXml` 的迭代器形态，不改产品代码
凑测试）。保真 99.0%/98.4% 且与 HEAD 逐字节相同、四条变异腿不动；
pptx 70.1/74.3、42/19 全绿、`--selftest --mut no-ga` 42 条全红后复位；
往返账 `17c3e44b…`/`3f07bccd…` 两次复跑一致。两把旧尺：`bench-docx-pack`
语义等价 ✓ / −55.3%、`bench-docx-parts` 部件解压 **21 → 22 → 5**
（`docxToDocMeta` 多读一次 core.xml，预期且语义等价 ✓）。

### 顺延（D48）

- 图形壳剩 **233 对**：三维族 `sp3d`/`props3d`/`lightRig` 要先定「夹具结构
  非法」口径；VML 老式形状族仍是模型无槽。`wp:posOffset` 动 0 对、
  `sizeRelH/V` 真件要 `mc:AlternateContent`。
- 正文长尾：`fldChar` 三对、`outline|val`（要先定 rPr 内 schema 位次 +
  charExtra 槽）、`smartTag|*`、±5 缇、`name|val`(表单域 `text1`)、
  `docPr|descr`、`theme1.xml` 口径未定。`docPr|id`/`name` v0.188、
  `ins|id`/`startOverride|val` v0.187、书签两族 v0.186 已补。
- 写手 `patchBorderBlocks` / `patchNumOverrides` 两处 `[...matchAll]` 仍物化
  数组（本轮只动了最热的 `patchImgXml`）；Calc 缩放（落点在预存改动
  `SheetEditor.tsx`，按房规换落点）；**pdf-lib 按需加载**仍等
  `pdf-text-edit.ts` 入库；版式库 / SmartArt / 3D / Fontwork、页面边框 /
  水印 / 邮件合并 / 公式编辑器 / 数据透视表未做。D32–D47 长尾原账不动。
- **诚实边界**：本轮及历轮 A/B 都是合成夹具；`docPr` 与文档属性两处的源值
  都是写手侧正则读来的（不进保真账），ODT 链没跟着扩；文档属性只有纯函数、
  端到端与源码级断言，没做真机 WPS 对撞；惰性遍历的端到端收益在噪声内，
  确定收益只在纯函数段且只有一处落地。

## v0.189（表单域整片字面往返 + PDF 页序重排 + 写手补丁链两处惰性化）

承接 D48。这轮换了个保真思路：前三轮都在给**身份型令牌**逐个改值，本轮改
「读手展平掉的**一整片结构**」按字面搬回，一次补 **8 对**（历轮单轮第二多），
正文首次上 **90%**。

**保真：8 对 `lost/value → kept`，正文 87.3% → 90.0%**

| 族 | 旧账 | 这 8 对为什么是一族 |
|---|---|---|
| `fldChar\|fldCharType`(begin/separate/end)、`fldChar\|fldLock` | lost | Word 表单域是五枚连续 run：`begin`(带 `ffData`) → `instrText` → `separate` → 结果文字 → `end`。读手只渲染结果文字，模型与 docx 包都没有表单域的槽 |
| `name\|val`(Text1)、`appearance\|val`、`calcOnExit\|val`、`entryMacro\|val`、`default\|val`、`maxLength\|val` | 1 对 value + 5 对 lost | 全在 `ffData` 里：名字 / 外观 / 退出重算 / 宏 / 文本域默认值与长度上限。壳回来它们就都回来 |

- **第四次走「写手侧源包正则」**：`formFieldsOf(docXml)` 在单个 `<w:p>` 边界内
  取出「结果文字 + 前三枚 run + end 一枚 run」的**字面原件**，存进
  `DocMeta.formFields`；`patchFormFields` 按**结果文字**在写出包里找回那枚 run，
  前后贴回壳。正则读的部件不进保真账、读手源码零改动、查问仍 **672**，
  `docs/fidelity.*` 与 HEAD **逐字节相同**，四条变异腿 52.5 / 59.4 / 99.0 /
  96.5 一字不动。
- **三道守卫**：写出包已有 `w:fldChar` 就整体不动（幂等，不叠第二套域）；
  结果文字被用户改过就认不出，**宁缺毋滥**跳过（不凭空造域）；插入区间按
  cursor 单调前进，多个域各插一次不重叠。写出段落与源件剥掉包发的 `rPr` /
  `xml:space` 后**逐字相同**（`test-form-fields.mjs` 43 项）。
- 正文 **262/300 → 270/300 = 90.0%**、合计 **346/619 55.9% →
  354/619 57.2%**、值变 **6 → 5**、掉了 **267 → 260**、图形壳 26.3% 不动。
  `modules` 仍 **68**（纯函数放在既有 `docx.ts`，没新增 lib 文件）。

**功能：PDF 页序重排（上移 / 下移）**

- `reorderPageOrder(total, selected, delta)` 是纯函数：选中页整体朝一个方向
  挪 |delta| 格，非选中页保持相对顺序；首页上移 / 末页下移 / 全选 / 没选页
  都不动。`movePagesInPlace` 用 pdf-lib 的 `removePage` + `insertPage` 只摘
  页树节点、**不复制页面**（标注、表单域与资源跟着原对象走），页序没变就
  不写盘。PDF 页签加「↑ 上移 / ↓ 下移」，复用 `pageOp`（未选中时对当前页生效）。
- `test-pdf-page-order.mjs` 28 项：纯函数边界（连续选区、不连续选区、
  |delta|=2、越界过滤、输出恒为排列）+ **pdf-lib 内存往返**（四页不同尺寸
  按新序落位、反向挪一次回到原序），不是只钉源码。

**性能：写手补丁链最后两处物化收干净**

- v0.188 只改了最热的 `patchImgXml`；本轮 `patchNumOverrides`（**够数即停**，
  `starts` 只有几枚不必扫完全部 `<w:num>`）与 `patchBorderBlocks`（**块数闸门
  从循环前移到循环末尾**，对不上就整笔丢弃、不写盘）都换惰性迭代。三处共用
  `legacyBlockScan:true` 一个对照腿开关，两腿逐部件字符串归一后逐字相同。
- **纯函数段 A**（够数即停）50/500/2000 块 **−78.9% / −97.6% / −99.4%**；
  **纯函数段 B**（只省数组分配）**−6.7% / −6.7% / −7.3%**；
  **端到端 28.7 → 27.2ms（−5.5%，噪声内，不冒充整链收益）**。
  A 的高降幅来自「starts 只 2 枚、全文放大到 2000 块」的合成形状，真件
  `w:num` 远没这么多；`patchBorderBlocks` 循环内按边名编译的 `edgeRe` 仍在，
  顺延，不冒充「正则也收干净了」。

**门禁**：tsc 0、`tsc && vite build` ✓（`pnpm run build` 的 pdfjs 资源清理仍被
环境安全策略的批量删除守卫拦下）；**39 组结构测试全绿**（新增 43 + 28 + 14 项，
三条旧断言按「逐笔接上一笔」新口径改，不改产品代码凑测试）。保真 99.0%/98.4%
且与 HEAD 逐字节相同、四条变异腿不动；pptx 70.1/74.3、42/19 全绿、
`--selftest --mut no-ga` 42 条全红后复位；往返账 `5aef0217…`/`5426c9d6…`
两次复跑一致。两把旧尺语义等价 ✓，`bench-docx-parts` 部件解压
**22 → 23 → 5**（新增表单域补丁多一次读，预期）。

### 顺延（D49）

- 图形壳剩 **233 对**：三维族 `sp3d`/`props3d`/`lightRig` 要先定「夹具结构
  非法」口径；VML 老式形状族仍是模型无槽。`wp:posOffset` 动 0 对、
  `sizeRelH/V` 真件要 `mc:AlternateContent`。
- 正文长尾：`outline|val`（要先定 rPr 内 schema 位次 + charExtra 槽）、
  `smartTag|*`、±5 缇、`docPr|descr`（包把 alt 顶进来，归属口径未定）、
  `theme1.xml` 口径未定；编号 id 三族是**引用图**（源 1 个 abstractNum、
  写出 3 个），前缀改值会写出断裂且不是坏件，**按纪律不碰**。
  `fldChar`/`ffData` 一族 v0.189、`docPr|id`/`name` v0.188、
  `ins|id`/`startOverride|val` v0.187、书签两族 v0.186 已补。
- Calc 缩放（落点在预存改动 `SheetEditor.tsx`，按房规换落点或只记结论）；
  **pdf-lib 按需加载**仍等 `pdf-text-edit.ts` 入库（本轮 build 仍见
  `INEFFECTIVE_DYNAMIC_IMPORT`）；版式库 / SmartArt / 3D / Fontwork、
  页面边框 / 水印 / 邮件合并 / 公式编辑器 / 数据透视表未做；
  `patchBorderBlocks` 循环内 `edgeRe` 顺延。D32–D48 长尾原账不动。
- **诚实边界**：本轮及历轮 A/B 都是合成夹具；表单域壳是写手侧从源包按字面
  搬回的（不改模型、不进保真账），用户改过结果文字就不贴回，ODT 链没扩，
  真件里多个表单域 / 复选框 / 下拉域未实测；PDF 页序只在 pdf-lib 内存夹具
  与源码级断言验证，没做带真实标注与表单域的文件对撞；惰性遍历的端到端
  收益在噪声内，确定收益只在纯函数段。

## v0.190（整片通道泛化 + `smartTag` 两族 + 页面边框读写链 + 补丁链正则收尾）

承接 D49。保真只动 2 对，但把 v0.189 的**一次性机制泛化成共用通道**（教训⑪：
第二处同形状需求出现时才抽）；另补上挂了多轮的 WPS 缺口页面边框，收掉写手
补丁链最后一处循环内动态正则。

**保真：2 对 `lost → kept`，正文 90.0% → 90.7%**

| 族 | 源值 → 旧写出 | 为什么是一族 |
|---|---|---|
| `smartTag\|element` / `smartTag\|uri` | `address` / `urn:schemas-microsoft-com:office:smarttags` → 整枚壳没了 | Word 2003 的「认出这是地址」包裹壳，读手 v0.154 起就下钻照旧、两枚属性只读记账；模型与包都没槽，展平成结果文字后壳一并丢 |

- **通道泛化**：`formFieldsOf` / `patchFormFields` → `literalWrappersOf` /
  `patchLiteralWrappers`，两类壳统一成 `{ marker, before, after, text }`，
  按**源包出现序**排好让补丁用单调 cursor 一次走完。`marker` 让每片各判各的
  幂等——顺带修掉 v0.189「写出包有任何 `<w:fldChar` 就整笔不贴」的**跨类误伤**：
  现在包发的普通域（无 `ffData`）不再让表单域壳整笔跳过，已有 `smartTag` 也
  不影响表单域。表单域 marker 收窄成 `<w:ffData>` 而不是 `<w:fldChar`。
- **零新增查问**：写手侧从源包正则读（不进保真账），读手源码一行没动，查问
  仍 **672**，`docs/fidelity.*` 与 HEAD **逐字节相同**，四条变异腿 52.5 / 59.4 /
  99.0 / 96.5 一字不动。`modules` 仍 **68**。
- 正文 **270/300 → 272/300 = 90.7%**、合计 **354/619 57.2% → 356/619 57.5%**、
  掉 **260 → 258**、值变仍 5、图形壳 26.3% 不动。
- **判断复查（不改口）**：`.d.ts` 里 `outline` 有多处命中，逐个看过是图形描边、
  段落 `outlineLevel` 与 `Wpg` 媒体，**不是 `IRunOptions`**。D49 记的「镂空没有
  原生槽」成立，本轮没为凑数字动它。

**功能：页面边框（标题/正文之外的 WPS 缺口，修的是坏件）**

- 包**有**原生槽 `IPageBordersOptions`，但层级与键名都容易踩坑：挂在
  `properties.page.borders`（不是 `properties.borders`），选项键是
  `pageBorderTop/Right/Bottom/Left`（不是 OOXML 的 `top/left/...`）。第一次
  接错只发出空 `<w:pgBorders/>`，dump 写出包才发现；改用包导出的类型钉死。
- 读侧 `pageBordersOf` 从源包 `document.xml` 正则读四边的统一值（零新增查问、
  读手零改动），写侧走包原生槽让包自己发 XML（不手拼），DocEditor 页面设置
  面板加开关 + 线型/颜色/线宽，随 `.odoc` 与 docx 真双向。**导入带边框的
  docx 另存一次不再把边框冲掉**；默认路径不发 `pgBorders`，账本不受扰。
- 只认四档线型（single/dotted/dashed/double），认不出宁缺毋滥；四边统一一套
  值，源件四边各异的不假装还原。屏上纸面与打印预览**不画**边框。

**性能：写手补丁链最后一处循环内动态正则收干净**

- `patchBorderBlocks` 里按边名编译的 `edgeRe`（每块每 chunk 一次
  `new RegExp`）换成 `findEdgeTag` 字符串定位 + `slice` 拼接；
  `legacyEdgeScan:true` 复刻改前路径供 A/B，两腿逐部件字符串归一逐字相同。
- **纯函数段 50 / 500 / 2000 块 −26.7% / −27.1% / −26.1%**（收益比前几轮小，
  如实写）；**端到端 27.4 → 29.6ms（+8.2%，噪声内，不写成降幅）**。
  顺带修掉 `edge` 含正则元字符时被当模式解析的隐患。

**工程改进**：三条钉死链尾变量名的旧断言（连续三轮过期）改成**动态链校验**——
核心补丁链 12 笔，每笔的输入必须等于上一笔的输出名，以后插新补丁只要接上
就不再红；`test-block-lazy.mjs` 里「edgeRe 顺延」那条也按新口径改。

**门禁**：tsc 0、`tsc && vite build` ✓（`pnpm run build` 的 pdfjs 资源清理仍被
环境安全策略的批量删除守卫拦下）；**42 组结构测试全绿**（新增 31 + 34 + 20 项，
另按新口径更新 4 条过期断言，不改产品代码凑测试）。保真 99.0%/98.4% 且与
HEAD 逐字节相同、四条变异腿不动；pptx 70.1/74.3、42/19 全绿、
`--selftest --mut no-ga` 42 条全红后复位；往返账 `355d70bc…`/`fa96ade6…`
两次复跑一致。两把旧尺语义等价 ✓，部件解压 **23 → 5**（本轮没新增部件读）。

### 顺延（D50）

- 图形壳剩 **233 对**：三维族 `sp3d`/`props3d`/`lightRig` 要先定「夹具结构
  非法」口径；VML 老式形状族仍是模型无槽。`wp:posOffset` 动 0 对、
  `sizeRelH/V` 真件要 `mc:AlternateContent`。
- 正文长尾：`outline|val`（要先定 rPr 内位次 + 新建 charExtra 槽，本轮复查
  确认包没原生槽）、`smartTag` 之外的 `w:sdt` 壳、±5 缇、`docPr|descr`、
  `theme1.xml` 口径未定；编号 id 三族是引用图、按纪律不碰。`smartTag` v0.190、
  表单域一族 v0.189、`docPr|id`/`name` v0.188 已补。
- Calc 缩放（落点在预存改动 `SheetEditor.tsx`，按房规换落点或只记结论）；
  **pdf-lib 按需加载**仍等 `pdf-text-edit.ts` 入库（本轮 build 仍见
  `INEFFECTIVE_DYNAMIC_IMPORT`）；版式库 / SmartArt / 3D / Fontwork、
  水印 / 邮件合并 / 公式编辑器 / 数据透视表未做；pptx 表格单元格文本仍按格
  摊平。页面边框只在 docx 链，ODT 未扩。D32–D49 长尾原账不动。
- **诚实边界**：本轮及历轮 A/B 都是合成夹具；整片壳按结果文字认领，用户改过
  结果文字就不贴回，真件里 smartTag 嵌套/多枚未实测；页面边框只有合成夹具与
  端到端断言，没做真机 WPS/Word 对撞，屏上不画、四边统一、只认四档；
  零正则的端到端是**变慢 8.2%（噪声内）**，确定收益只在纯函数段。

## v0.191（超链接两族 `lost→kept` + ODT 文档属性链 + pptx 表格文本零数组）

承接 D50。这轮保真换了条更干净的路：前几轮都是「写手侧从源包正则搬字面」，
本轮是**模型里本来就有载荷、只是写手没接**——补完就是真双向。另把挂了多轮的
ODT 文档属性顺延落地，收掉 pptx 导入最后一处摊平数组。

**保真：2 对 `lost → kept`，正文 90.7% → 91.3%**

| 族 | 源值 → 旧写出 | 为什么是一族 |
|---|---|---|
| `hyperlink\|tooltip` / `hyperlink\|tgtFrame` | `悬停提示` / `blank` → 两枚都没了 | 读手 v0.155 早把两枚属性兑现成 HTML `<a title/target>`，TipTap 的 link mark 也自带这两格；`IExternalHyperlinkOptions` 只收 `children` + `link`，写手没接 |

- **从模型取，不是从源包取**：`childToRuns` 在有 `href` 的分支里用
  `markAttr(child,'link','title'/'target')` 登记进 `DocTrack.linkExtras`，
  `patchHyperlinkAttrs` 按 `<w:hyperlink>` 出现序、复用 `tagWithAttrs` 补回
  `w:tooltip` / `w:tgtFrame`（已有同名属性只改值、不叠第二枚）。
  与前几轮「字面搬回」最大的不同是**屏上替身能认回**：改 PM 的 link mark，
  写出包就是改后的新值，不再冒出源包旧字面。
- **两道守卫**：源件没写过的链接整枚跳过，不凭空造属性；`target="_blank"`
  是 TipTap 在没写 target 时补的默认值，与「源件显式写 `_blank`」同形，认不出
  就不补（真件里这一档会漏，如实记在边界里）。
- **零新增查问**：读手源码一行没动、查问仍 **672**，`docs/fidelity.*` 与 HEAD
  **逐字节相同**，四条变异腿 52.5 / 59.4 / 99.0 / 96.5 一字不动，`modules` 仍 68。
- 正文 **272/300 → 274/300 = 91.3%**、合计 **356/619 57.5% → 358/619 57.8%**、
  掉 **258 → 256**、值变仍 5、图形壳 26.3% 不动。

**功能：ODT 文档属性（D50 顺延，修的是坏件）**

- docx 侧 v0.188 已有 `DocMeta.docProps` 读写链，但 ODT 导出**根本不发
  `meta.xml`**——导入别人的 .odt 另存一次，标题/主题/作者/关键词/备注全没。
  现在写侧 `odtMetaXml` 生成 ODF 标准的 `office:document-meta` 五格并在
  manifest 里声明 `meta.xml`，读侧 `parseOdtMetaProps` 解析回同一份
  `DocMeta.docProps`，DocEditor 现有的「文档属性」面板直接可用（真双向）。
- 只发非空格（没话说的件不发空元素），字符串定位不编译动态正则，
  `keyword` 只发一枚整体串；`test-odt-docprops.mjs` 23 项覆盖实体转义、
  外部 .odt 的 meta.xml、改值再导出、缺省回落与部件接线。

**性能：pptx 表格单元格文本零数组（v0.185 顺延）**

- 改前 `descendantsByName(tc,'t').map(textOf).join('')` 把整棵子树摊成两个数组；
  本轮 `tableCellText` 一次前序、命中 `a:t` 即拼接。**语义严格等价**：命中后
  仍下钻（改前的 `descendantsByName` 会把嵌套 `t` 也单收一枚），不插段落换行，
  性能优化没顺手改语义。`legacyTblText:true` 是改前对照腿。
- **纯函数段 −9.6% / −6.5% / −0.9%**（收益小，如实写）；**端到端 3/20/60 行
  +4.5% / −0.7% / −4.4%，在噪声内，不冒充整链收益**。基准把树构造移出计时、
  两腿各用一份独立同形的预构造池，避免 `textOf` 缓存让后跑的一腿白捡便宜。

**门禁**：tsc 0、`tsc && vite build` ✓（`pnpm run build` 的 pdfjs 资源清理仍被
环境安全策略的批量删除守卫拦下）；**45 组结构测试全绿**（新增 23 + 23 + 16 项；
1 条钉死链尾的旧断言改成与其它三条一致的**动态链校验**，不改产品代码凑测试）。
保真 99.0%/98.4% 且与 HEAD 逐字节相同、四条变异腿不动；pptx 70.1/74.3、
42/19 全绿、`--selftest --mut no-ga` 42 条全红后复位；往返账
`8c8fc661…`/`c06a2ac2…` 两次复跑一致。两把旧尺语义等价 ✓，部件解压
**23 → 24 → 5**（新增超链接补丁多一次读，预期）。

### 顺延（D51）

- 图形壳剩 **233 对**：三维族 `sp3d`/`props3d`/`lightRig` 要先定「夹具结构
  非法」口径；VML 老式形状族仍是模型无槽。`wp:posOffset` 动 0 对、
  `sizeRelH/V` 真件要 `mc:AlternateContent`。
- 正文长尾：`outline|val`（要先定 rPr 内位次 + 新建 charExtra 槽，v0.190 复查
  确认包没原生槽）、`w:sdt` 内容控件壳、±5 缇、`docPr|descr`、`theme1.xml`
  口径未定；编号 id 三族是引用图、按纪律不碰。`hyperlink|tooltip`/`tgtFrame`
  v0.191、`smartTag` 两族 v0.190、表单域一族 v0.189 已补。
- Calc 缩放（落点在预存改动 `SheetEditor.tsx`，按房规换落点或只记结论）；
  **pdf-lib 按需加载**仍等 `pdf-text-edit.ts` 入库（本轮 build 仍见
  `INEFFECTIVE_DYNAMIC_IMPORT`）；版式库 / SmartArt / 3D / Fontwork、
  水印 / 邮件合并 / 公式编辑器 / 数据透视表未做。ODT 链目前只扩了文档属性，
  docPr / 表单域 / smartTag / 页面边框仍未扩。D32–D50 长尾原账不动。
- **诚实边界**：本轮及历轮 A/B 都是合成夹具；超链接按出现序对位，真件里链接
  数在导入后变多/变少未实测，`tgtFrame="_blank"` 与 TipTap 默认值同形会漏；
  ODT 的 `meta.xml` 只认 `dc:`/`meta:` 标准前缀与单枚 keyword，没做真机
  LibreOffice/WPS 对撞；pptx 表格零数组的端到端收益在噪声内，纯函数段也只有
  个位数，保留它是为收掉顺延项且语义严格等价，不冒充提速。

## v0.192（批注 `initials` `lost→kept` + 页面边框屏上预览 + `patchElemAttrs` 惰性遍历）

承接 D51。保真只动 1 对，但补的是挂了两轮的**外壳观感**：v0.190 做的页面边框
读写链只随 docx 往返、屏上不画，本轮把纸面也画出来（教训㉓）；顺带收掉写手
补丁链最后一类「先数一遍再逐块改」的物化数组。

**保真：1 对 `lost → kept`，正文 91.3% → 91.7%**

- `comment|initials`（`ZS`）：`DocComment.initials` 字段和读手 v0.154 的解析
  **早就有**，包 `ICommentOptions.initials` 也是原生槽，只差写手
  `anchored.map` 没把这一格传给 `new Comment`——导入别人的 docx 另存一次，
  批注作者姓名缩写就没了。补一行，且是**真双向**：改模型里的 initials 写出包
  就是新值；没写过的批注不凭空造一枚。
- **零新增查问**：读手源码一行没动、查问仍 **672**，`docs/fidelity.*` 与 HEAD
  **逐字节相同**，四条变异腿 52.5 / 59.4 / 99.0 / 96.5 一字不动，`modules` 仍 68。
- 正文 **274/300 → 275/300 = 91.7%**、合计 **358/619 57.8% → 359/619 58.0%**、
  掉 **256 → 255**、值变仍 5、图形壳 26.3% 不动。
- **探过但放弃（记清口径）**：`outline|val` / `ligatures|val` / `numForm|val` /
  `numSpacing|val` 四枚 rPr 字符特性同根，但读手只把它们变成屏上
  `font-variant-*` CSS、**没进模型载荷**；补回来要新建槽、定 CT_RPr 位次，且
  按 `<w:rPr>` 出现序对位会在「包给每个 run 都发 rPr」时错位，不为凑数字赌坏件。
  `headerReference` / `footerReference` 四对是只读记账（rId 由包重编），发空引用
  会指向不存在的部件，按「假红比真红更坏」不碰。

**功能：页面边框屏上预览（v0.190 遗留的口径修正）**

- v0.190 的读写链只随 `.odoc`/docx 往返，「屏上纸面与打印预览都不画」。本轮
  `pageBorderCss(pb)` 把四档线型映射成 CSS、`w:sz`（八分之一磅）折成 px、脏色
  回落黑，纸面 `.doc-page` 加内联 `border`；打印时内联优先级高于 `@media print`
  里的 `border:none`，所以打印预览也带框。面板文案同步改成「屏上纸面与打印预览
  同步显示」。
- 只认四档、不画 `w:space` 内边距；屏上是 CSS 近似，没做真机 WPS/Word 对撞。

**性能：`patchElemAttrs` 不再物化开标签数组**

- 写手补丁链里最后一类 `[...xml.matchAll(...)]`（按标签名找开标签、先数够不够
  再逐块补属性）换成惰性迭代器，计数闸门从循环前移到循环末尾（块数不符就整笔
  丢弃、已拼的局部串不写盘）。`legacyElemScan:true` 复刻改前路径供 A/B，
  两腿逐部件字符串归一后逐字相同。
- **纯函数段 50 / 500 / 2000 标签 −7.2% / −1.0% / −3.4%**（收益小，如实写）；
  **端到端 31.8 → 31.4ms（−1.2%，噪声内，不冒充整链收益）**。

**门禁**：tsc 0、`tsc && vite build` ✓（`pnpm run build` 的 pdfjs 资源清理仍被
环境安全策略的批量删除守卫拦下）；**47 组结构测试全绿**（新增 12 + 10 项，
另把页面边框测试扩了 8 项，无过期断言——动态链校验已覆盖新增补丁）。
保真 99.0%/98.4% 且与 HEAD 逐字节相同、四条变异腿不动；pptx 70.1/74.3、
42/19 全绿、`--selftest --mut no-ga` 42 条全红后复位；往返账
`a5a3afc2…`/`a0dbd1da…` 两次复跑一致。两把旧尺语义等价 ✓，部件解压仍
**24 → 5**（本轮没新增部件读）。

### 顺延（D52）

- 图形壳剩 **233 对**：三维族 `sp3d`/`props3d`/`lightRig` 要先定「夹具结构
  非法」口径；VML 老式形状族仍是模型无槽。`wp:posOffset` 动 0 对、
  `sizeRelH/V` 真件要 `mc:AlternateContent`。
- 正文长尾：`outline|val` 与 rPr 字符特性四枚（要先新建载荷槽 + 定 CT_RPr 位次，
  见上）、`w:sdt` 内容控件壳、±5 缇、`docPr|descr`、`theme1.xml` 口径未定；
  编号 id 三族是引用图、按纪律不碰。`comment|initials` v0.192、
  超链接两族 v0.191、`smartTag` 两族 v0.190、表单域一族 v0.189 已补。
- Calc 缩放（落点在预存改动 `SheetEditor.tsx`，按房规换落点或只记结论）；
  **pdf-lib 按需加载**仍等 `pdf-text-edit.ts` 入库（本轮 build 仍见
  `INEFFECTIVE_DYNAMIC_IMPORT`）；版式库 / SmartArt / 3D / Fontwork、
  水印 / 邮件合并 / 公式编辑器 / 数据透视表未做。ODT 链目前只扩了文档属性，
  页面边框 / docPr / 表单域 / smartTag / 超链接两枚仍未扩。D32–D51 长尾原账不动。
- **诚实边界**：本轮及历轮 A/B 都是合成夹具；批注 initials 只有合成夹具与
  端到端断言，真件里多作者/多批注未实测；页面边框屏上只是 CSS 近似，与 Word
  的页边距 `offsetFrom` 口径不同，没做真机对撞；`patchElemAttrs` 惰性化的
  端到端收益在噪声内、纯函数段也只有个位数，保留它是为收掉顺延项且语义
  严格等价，不冒充提速。

## v0.193（部件级字面元信息五族 + ODT 页面边框读写链 + 补丁链六处惰性化）

承接 D52。前几轮的「写手侧从源包正则读 + post-pack 贴回」一直只落在
`document.xml`，本轮一次推到**三个部件**，用一条共用通道带回 5 对；功能项
把 D52 顺延的 ODT 页面边框补成真双向；性能项收掉写手补丁链最后六处
「先数一遍再逐块改」的物化数组。

**保真：5 对 `lost → kept`，正文首次上 93.0%**

- 五族分在三个部件：`word/numbering.xml` 的 `num|durableId` /
  `numPicBullet|numPicBulletId` / `numIdMacAtCleanup|val`，`word/styles.xml`
  的 `style|default`，`word/commentsExtended.xml` 的 `creationId|id`。
  全是「包不会自己发、读手只读记账、模型没槽」的元信息；写出包里
  `<w:num>` 少了持久会话号、Normal 样式少了 `w:default="1"`、批注扩展少了
  创建会话号，另存一次就没了。
- 通道 `MetaExtras` 只分两种同形状：① `byId` 按**身份属性**认领
  （`w:numId` / `w:styleId`）——身份令牌按名字对位、认不出就跳过，绝不用
  出现序（写出包有 3 个 `w:num`、源件只有 1 个，按序会贴错人），且**只补缺
  不覆盖**（包或用户写过的算新事实）；② `roots` 在部件根容器闭标签前按
  **源包出现序**贴自闭合字面片，逐片判幂等。`patchMetaExtras` 一支补丁共用
  同一只 zip / 同一份文本缓存，末尾只标一次脏。
- 写手侧由 `docxToDocMeta` 正则读三个部件（不进保真账、读手源码零改动），
  读手查问仍 **672**、`docs/fidelity.*` 与 HEAD **逐字节相同**、四条变异腿
  52.5 / 59.4 / 99.0 / 96.5 一字不动、`modules` 仍 68。
- 正文 **275/300 → 279/300 = 93.0%**、图形壳 **84/319 → 85/319 = 26.6%**
  （`creationId` 是 `w15:` 前缀，按分族规则算图形壳）、合计
  **359/619 58.0% → 364/619 58.8%**、掉 **255 → 250**、值变仍 5。
- **探过但放弃**：`tblpPr|overlap` 与 `tblOverlap|val` 是同义的两枚表示
  （包把属性写成子元素，`tblOverlap|val` 已 kept），为凑数字补回一枚非法属性
  不值；`w:sdt` 壳 / `proofErr` / `a:ext` 与现有两种形状都不同，不硬塞通道。

**功能：ODT 页面边框（D52 顺延，修的是坏件）**

- v0.190 的 docx 页面边框走包原生槽，但 ODT 导出的
  `style:page-layout-properties` **根本不发 `fo:border`**——导入带边框的
  `.odt` 另存一次边框就没了。写侧 `odtPageBorderAttrs` 把四档线型、
  `w:sz`（八分之一磅→pt）、字面色与 `w:space`（→`fo:padding`）写成 ODF
  属性串；读侧 `parseOdtPageBorderAttrs` 反解回同一个 `PageBorders` 模型，
  DocEditor 现有页面设置面板与 docx 写手直接共用（真双向）。
- 默认路径一个属性都不发（不污染无边框件）；只认四档线型 +
  `#rrggbb` + pt/cm/mm，认不出的件返回 undefined 不硬造档位；屏上仍是
  CSS 近似、四边统一，不做 `offsetFrom` 口径。

**性能：写手补丁链六处物化数组收干净**

- `patchParaProps` / `patchBeforeElem` / `patchColorLits` / `patchShdAttrs` /
  `patchTrPr` / `patchTcPr` 的 `[...matchAll]` 换成惰性迭代器，与 v0.192 的
  `patchElemAttrs` 共用 `legacyElemScan` 对照腿。数量闸门从「循环前比长度」
  搬进**循环头**：`i <= extras.length` 多跑一次对账，块数不足 / 多出一块都
  照旧整笔不动、已拼的局部串不写盘（两腿逐部件归一逐字相同）。
- 纯函数段 50 / 500 / 2000 块 **−7.3% / −3.7% / −5.9%**（收益小，如实写），
  逐字符 hash 一致且把「块数不足 / 多出」两种失败形状也逐腿对撞；
  **端到端 31.2 → 34.0ms（+9.2%，变慢，噪声内，未粉饰）**。

**门禁**：tsc 0、`tsc && vite build` ✓；**50 组结构测试全绿**（新增 31 + 27
+ 11 项，1 条钉死链尾的旧断言改成动态链校验）；保真 99.0% / 98.4% 且与 HEAD
逐字节相同、四条变异腿数字一字不动；pptx 70.1 / 74.3 且 `no-ga` 42 条全红后
复位；往返账 `1a019f16…` / `a77591df…` 两次复跑一致；两把旧尺语义等价 ✓，
部件解压 **24 → 28 → 6**（`docxToDocMeta` 多读三个部件 + 补丁读，预期）。
`pnpm run build` 的 pdfjs 资源清理仍被环境安全策略拦下，改跑等价两步验证。

- **诚实边界**：五族都是写手侧按源包字面搬回（不改模型、ODT 链未扩），
  身份键变了就认不出、宁可不贴，但**根级片与模型无关**——用户删掉对应编号
  后那两枚全局元信息仍会贴回，这一条没有陈旧守卫；真件里多 `w:num` /
  多枚 `creationId` 未实测。ODT 页面边框只有合成夹具与端到端断言，没做真机
  LibreOffice / WPS 对撞，第三方件四边分写时只认 top。惰性化的端到端是
  **变慢 9.2%（噪声内）**，确定收益只在纯函数段且只有个位数。

## v0.194（rPr 字符特性四枚 + ODT 超链接 title/target + 读手 styleView 去重）

承接 D53。正文侧 lost 只剩 9 对，其中四枚 rPr 字符特性是挂了多轮的最大一组；
本轮把它的**位次口径**定下来一次带回 4 对，另补上 D53 顺延的 ODT 超链接两枚，
再收掉读手里一处「同一段算两次样式视图」的重复计算。

**保真：4 对 `lost → kept`，正文 93.0% → 94.3%**

- `ligatures|val` / `numForm|val` / `numSpacing|val` / `outline|val`（外加同片的
  `w:cntxtalts`，账本里没这一对）：读手 v0.155 起把它们只兑现成屏上的
  `font-variant-*` CSS，**没进 HTML/PM 载荷**；`RunProps` 里虽有字段，docx 包
  的 `.d.ts` 也没有 `IRunOptions` 的对应槽（v0.190 复查过 `outline` 的命中全是
  图形/段落描边）。D53 写「要先新建载荷槽 + 定 CT_RPr 位次」——本轮定的是
  **位次而不新建槽**：走写手侧从源包留下字面，按**结果文字**认领写出包里
  那一枚 run，贴回它的 `<w:rPr>`。
- 位次口径：`w:outline` 是 CT_RPrBase 标准元素，插在第一枚
  `emboss`/`imprint`/`shadow`/`noProof` 之前；`ligatures`/`numForm`/
  `numSpacing`/`cntxtalts` 是 Word 2010+ 的 OpenType 扩展，Word 自己放在 rPr
  末尾，于是插在 `</w:rPr>` 前。夹具写的是无前缀 `w:` 字面，按源件原样搬回。
- 三道守卫与 `literalWrappers` 同款：已有同名元素（按**元素名**判，不是整串
  字面）不覆盖、结果文字被用户改过就认不出宁可不贴、插入区间按 cursor 单调
  前进。`patchRPrFeatures` 与其余补丁共用同一只会话。
- 读手源码零改动、查问仍 **672**，`docs/fidelity.*` 与 HEAD **逐字节相同**，
  四条变异腿 52.5 / 59.4 / 99.0 / 96.5 一字不动，`modules` 仍 68。
- 正文 **279/300 → 283/300 = 94.3%**、合计 **364/619 58.8% → 368/619 59.5%**、
  掉 **250 → 246**、值变仍 5、图形壳 26.6% 不动。

**功能：ODT 超链接 title / target（D53 顺延，修的是坏件）**

- v0.191 把 docx 的 `w:tooltip`/`w:tgtFrame` 从 PM link mark 接回写出包，
  但 ODT 写手只发 `xlink:href`、读手只读 `xlink:href`——导入带提示 / 目标
  框架的 `.odt` 另存一次这两枚就没了。ODF 的 `<text:a>` 有 `xlink:title` 与
  `office:target-frame-name` 两枚标准属性，正好同义：写侧从 link mark 取
  `title`/`target`（只发非空格），读侧读回 HTML `<a title/target>`，PM link
  mark 与 DocEditor 直接可用（**真双向**：改 mark 写新值、旧字面不留）。
- 默认路径一个属性都不发，`href` 仍走原来的转义，没设这两枚的件产出与
  改前逐字相同；新增属性走含引号转义的 `esc`，第三方 .odt 的两枚也能读回。

**性能：读手 styleView 每段两次 → 一次**

- `effPPrOf()` 与 `paragraph()` 对同一个 styleId 各算一次 `styleView`（链合并 +
  `mergePPr`），结果完全相同。本轮把 `view` 从 `effPPrOf` 一并带出来给
  `paragraph` 复用：**不引入跨段落共享的可变树**，纯去重复计算。
  `legacyStyleView:true` 复刻改前路径供同进程 A/B，两腿导入结果逐字相同。
- 原始夹具 7.1 → 7.2ms（**−1.4%，变慢，噪声内**）；放大语料 50 / 500 /
  2000 段 **−3.7% / −5.0% / −4.3%（噪声内，未粉饰）**。

**门禁**：tsc 0、`tsc && vite build` ✓；**53 组结构测试全绿**（新增 33 + 20
+ 12 项，1 条钉死链尾的旧断言改成动态链校验）；保真 99.0% / 98.4% 且与 HEAD
逐字节相同、四条变异腿一字不动；pptx 70.1 / 74.3 且 `no-ga` 42 条全红后
复位；往返账 `30e28284…` / `bd1415a4…` 两次复跑一致；两把旧尺语义等价 ✓，
部件解压 **28 → 29 → 6**（新增 rPr 补丁多一次读，预期）。`pnpm run build`
的 pdfjs 资源清理仍被环境安全策略拦下，改跑等价两步验证。

- **诚实边界**：rPr 四枚是写手侧按源包字面搬回，**不是真双向**——用户改不了
  这些 OpenType 档位，改过结果文字就不贴回；夹具是无前缀 `w:` 写法，真件里
  它们常带 `w14:`/`w15:` 命名空间与 `mc:Ignorable`，没做真机 Word 对撞，
  `outline` 插在 `emboss` 前是按 CT_RPrBase 序推理而非实测。ODT 两枚只有合成
  夹具与端到端断言，没做真机 LibreOffice / WPS 对撞。styleView 去重的收益
  全在噪声内，保留它是因为语义严格等价且去掉一处明显的重复计算。

## v0.195（正文长尾清尾四对 + Writer 批注筛选 + 读手 mergePPr 空链短路）

承接 D54。正文侧 lost 只剩 6 对（其中 `tblpPr|overlap` 是同义表示），本轮
一次把能做的 4 对全带回，往返账**首次破 60%**；另补一个挂了多轮的外壳小缺口
与一处读手重复计算。

**保真：4 对 `lost → kept`，正文 94.3% → 95.7%**

- `formProt|val` / `rtlGutter|val`（sectPr 元信息）、`proofErr|type`（body
  直子裸元素）、`id|val`（`w:sdt` 内容控件壳）：全是包不会自己发、读手只读
  记账的字面残片。写手侧从源包 `document.xml` 留下字面，统一成一条
  `LiteralPlacement` 通道按锚点贴回——`before`/`after`/`beforeParagraph`/
  `afterParagraph` 四种落点，逐片判幂等、认不出就跳过；同一部件的片合成
  一趟读、按序应用、一趟写（片与片之间有定位依赖）。
- **位次口径**：夹具把 `formProt`/`rtlGutter` 写在 `pgNumType` 与 `pgMar`
  之间，这在 CT_SectPr 序里非法。本轮按**标准序**贴回：`formProt` 放
  `cols` 之后、`rtlGutter` 放 `docGrid` 之前，不复刻结构非法坏件；
  `w:sdt` 壳按结果文字认领段落，开壳插在 `<w:p>` 前、闭壳插在 `</w:p>` 后。
- **探过但放弃（口径写清）**：`comments|Ignorable` 账本记 lost，但写出包
  `word/comments.xml` 根**自己就发了** `mc:Ignorable="w14"`——这是普查口径
  造成的假红，不是真丢件；按「假红比真红更坏」不补，也不多读一个部件。
  `tblpPr|overlap` 与已 kept 的 `tblOverlap|val` 是同义表示，仍不碰。
- 读手源码零改动、查问仍 **672**，`docs/fidelity.*` 与 HEAD **逐字节相同**，
  四条变异腿 52.5 / 59.4 / 99.0 / 96.5 一字不动，`modules` 仍 68。
- 正文 **283/300 → 287/300 = 95.7%**、合计
  **368/619 59.5% → 372/619 60.1%**、掉 **246 → 242**、值变仍 5、
  图形壳 26.6% 不动。

**功能：Writer 批注侧栏筛选（挂了多轮的外壳缺口）**

- 批注一多，侧栏里「已解决」的卡片会把待办淹掉。加「只看未解决」复选框与
  「按作者」下拉，头部把「显示全部 / 显示 N」分开，筛空时给提示；筛选只影响
  侧栏显示，**不改动文档里的批注**。作者名按卡片显示口径归一（没写 author
  的显示「我」），下拉与卡片不能两套房。
- 纯函数 `filterDocComments` 放已有 `src/lib/docx.ts`，不新增 lib 文件
  （`modules` 不变、两份保真账 provenance 不受扰）。

**性能：读手 `mergePPr` 空链短路**

- 段落没有自己的 `w:pPr` 时，`mergePPr([view.pPr, undefined])` 本来就原样
  返回 `view.pPr`；这一趟函数调用 + 数组创建可以省掉。`legacyMergePPr:true`
  复刻改前路径供同进程 A/B，与 v0.194 的 `legacyStyleView` 是两个独立开关，
  两腿导入结果逐字相同（含 20 / 200 组放大语料）。
- 原始夹具 7.7 → 7.9ms、50 / 500 / 2000 组 **−0.8% / +0.9% / −2.4%**，
  **全在噪声内，不冒充提速**；保留它是因为语义严格等价且去掉一处明显的重复计算。

**门禁**：tsc 0、`tsc && vite build` ✓；**56 组结构测试全绿**（新增 30 + 21
+ 12 项，3 条旧断言按新口径改：1 条改动态链校验、2 条改可选参数/返回结构）；
保真 99.0% / 98.4% 且与 HEAD 逐字节相同、四条变异腿一字不动；pptx 70.1 / 74.3
且 `no-ga` 42 条全红后复位；往返账 `3e0c9bdd…` / `5c4251fe…` 两次复跑一致；
两把旧尺语义等价 ✓，部件解压 **29 → 30 → 6**（新补丁按部件合成一趟读，预期）。
`pnpm run build` 的 pdfjs 资源清理仍被环境安全策略拦下，改跑等价两步验证。

- **诚实边界**：四枚都是写手侧按源包字面搬回（不改模型、ODT 链未扩、非真
  双向），锚点认不出就宁可不贴；sectPr 位次是按 CT_SectPr 推理而非真机 Word
  对撞，真件里分节多、多枚 `proofErr` / `sdt` 未实测。批注筛选只有纯函数与
  源码级断言，没做真机浏览器对撞。mergePPr 短路的收益全在噪声内。

## v0.196（VML 老式形状整片往返 + PDF 插入/复制页 + 写手零动态正则收尾）

**保真：一次补 176 对，往返账首次上 88.5%**

- **判断修正（README / 审计 / 评估三处都写明）**：D55 挂了多轮的
  「VML 老式形状族模型无槽、写手发不出 `w:pict`」只说明**不能靠包的原生槽
  重建**，不等于「搬不回来」。读手把 `<w:pict>` / `<w:object>` 展平成一行可见
  占位文字，写手侧从源包按段落边界留下**整段字面**贴回即可——与 v0.189
  表单域、v0.190 smartTag、v0.195 字面片同源，不需要模型槽。
- `vmlShapesOf` 从 `document.xml` 提取三段（两枚 `w:pict` + 一枚 `w:object`），
  `patchVmlShapes` 用读手为嵌入对象生成的占位文字段认领位置，**替换**成三段
  字面（`〔嵌入对象…，内容未提取〕` 这个屏上替身认回来，不留下多余空行）。
- **rId 重映射是本轮最容易写坏件的一处**：源包 `rId1` 指向 `media/image1.png`，
  写出包同号 `rId1` 却指向 `styles.xml`。照搬字面会写出断裂引用，所以按
  **关系类型**找写出包的 image 关系（`rId8`）再替换；写出包没有 image 关系就
  跳过带 `r:id` 的段，其余照贴。写出包根已由 docx 包声明
  `xmlns:v` / `xmlns:o` / `xmlns:w10`，贴回去不是未声明前缀的坏件（补丁仍做
  守卫，缺一个前缀就整笔不贴）。
- 另外三道守卫：写出包已有 `w:pict`/`w:object` 整笔不动（幂等）；锚点认不出
  就整笔不贴；非贪婪 `<w:p>` 截断的半截片（VML 文字框内嵌段落那种）没有闭
  标签，宁可跳过。产品链验证三段逐字与源件相同（仅 rId 换号）、XML 解析零
  错误、占位文字消失。
- 逐对变化 **176 对全是 `lost → kept`**，没有消失的对、没有新值变：正文
  **287/300 95.7% → 289/300 96.3%**、图形壳 **85/319 26.6% → 259/319 81.2%**、
  合计 **372/619 60.1% → 548/619 88.5%**、掉 **242 → 66**、值变仍 5、
  读手查问仍 **672**、`modules` 仍 **68**（纯函数放已有 `docx.ts`）。

**功能：PDF 页签「插入空白页 / 复制选中页」**

- 两个新操作都落在「选中页整体之后」，`insertAfterIndex` 把 1-based 最大页号
  直接当 0-based 插入位置；未选中时对当前页生效，沿用 `pageOp` 的写标注→
  覆盖写回→重载流程。空白页尺寸取第 1 页、一次最多 20 页；复制页用
  `copyPages` 从同一字节另载的源文档拷，避免自拷贝共享可变页树，标注/表单域/
  资源随页对象一起复制。26 项断言含 pdf-lib 内存往返（页序与尺寸逐位对撞）。

**性能：写手最后两处动态正则收干净**

- `parseCoreProps`（core.xml 五格）与 sectPr 数值属性 `twipsAttrOf` 原本每次
  调用各编译一枚 `new RegExp`，改成字符串定位；与改前算法严格等价（取第一枚
  匹配、非数字不算匹配继续往后找、内容为空就跳过这一格）。对照腿由
  `docxToDocMeta` 的 `legacyMetaRegex` 开关切换，两腿同源只差这一件事。
- 纯函数段 2 千 / 2 万 / 8 万趟 **−42.4% / −43.7% / −43.3%**，逐字符 hash
  一致；端到端 `docxToDocMeta` 1.57 → 1.57ms（**−0.2%，zip 解压主导，噪声内**），
  两腿产物逐部件归一逐字相同。归一里补了随机 hyperlink `rId`（`newId()` 生成的
  字母串，不只是 `rId1` 那种数字），否则会假报不等价。

**门禁**：tsc 0、`tsc && vite build` ✓；**59 组结构测试全绿**（新增 38 + 26
+ 34 项，4 条旧断言按新口径改：读写数目允许只读部件、入口签名改「关键名在场」、
链尾改动态链校验、`copyPages` 断言收窄到 `movePagesInPlace` 函数体）；保真
99.0% / 98.4% 且与 HEAD 逐字节相同、四条变异腿 52.5 / 59.4 / 99.0 / 96.5 一字
不动；pptx 70.1 / 74.3 且 `no-ga` 42 条全红后复位；往返账 `34c6c58d…` /
`e18c56a3…` 两次复跑一致；两把旧尺语义等价 ✓，部件解压 **30 → 32 → 7**
（VML 补丁只读一次 rels 找 image 关系，预期）。`pnpm run build` 的 pdfjs 资源
清理仍被环境安全策略拦下，改跑等价两步验证。

- **诚实边界**：VML 三段是写手侧按源包字面搬回，**不是真双向**——用户改不了
  老式形状，ODT 链没跟着扩；占位段认不出（真件没有 `w:object`，或用户删了
  嵌入对象）就整笔不贴；带 VML 文字框内嵌段落的真件会被半截片守卫跳过；
  真件多段 VML / 多枚 image 关系未实测，没做真机 Word 对撞。PDF 两个新操作
  只在内存夹具与源码级断言验证，没拿带真实标注的文件对撞。零正则的端到端
  收益在噪声内，确定收益只在纯函数段。

## v0.197（仓库自洽：把「工作树假绿」补成「clone 能编译」）

**这一轮不刷百分比，先修交付物本身**

- **起因**：`git archive HEAD` 导出干净树 + `tsc --noEmit` = **exit 2 / 18 错**。
  8 个 `TS2307` 悬空 import 指向 7 个长期未入库的 lib（`spell` / `collab` /
  `macro` / `vba` / `identity` / `pdf-text-edit` / `slide-chart`），其中
  `doc-schema.ts:30` 的 `./spell` 连量具用的产品 schema 一起断；另 10 错是
  `SpellCheck` 命令缺失、隐式 `any`、`pptx-export.ts:18` 引用 HEAD 版 `chart.ts`
  里没有的 `renderSlideChartPng`。**「tsc 0 / 59 组全绿」只在带未提交改动的
  工作树上成立**，`origin/main` 与本地同步，远端同样不可构建。
- **审查结论：整体接纳，不删功能件**。12 个未跟踪 lib、3 个 Rust 模块
  （`ods_chart` / `ws_relay` / `examples/relay`）、4 个测试脚本、7 个预存改动
  是同一条互锁链：HEAD 里的组件早已 import 它们，Rust 侧 `xlsx.rs` 也早在
  调 `crate::ods_chart::*`。删任一件要么断编译，要么砍掉唯一覆盖。审查意见里
  建议删 `examples/relay.rs` 与 `test-collab.mjs`，**判断修正**：前者「悬空」是
  因为还没入库，入库后 `[[example]]` 的 path 就有效；后者是唯一跑真 WebSocket
  中继的端到端测试，改跨平台路径比删掉划算。
- **唯一不入库的**：`public/dict/en-words.txt`（2.8MB）与
  `node_modules/word-list/words.txt` md5 逐字节相同，属可重建的第三方数据。
  改由 `copy-pdfjs-assets.mjs` 在 dev/build 前同步并加进 `.gitignore`；
  `spell.ts` 本来就有 fetch 失败退化到内置错词表的兜底。

**审查顺带修掉的两个真缺陷**

- `spell.ts` 错词表里有 7 组自映射（`necessary: 'necessary'`、`出发`、`大事`、
  `上线`、`渔船`、`衷心感谢`、`坐落`）——正确词会被标红且「改正」无变化，
  已移除；`tokensOf` 命中后 `k += hit ? (hit ? Math.max(2,0) : 1) : 1` 恒等于
  前进 2，3/4 字错写会被后续窗口重复切片，改为按实际命中长度推进。
- `test-collab.mjs` 的 `relay.exe` 写死 Windows 后缀，改为按 `process.platform`
  拼后缀并支持 `RELAY_BIN` 覆盖。

**门禁从零到一**

- `scripts/run-tests.mjs`：63 份 `test-*.mjs` 汇总跑批（排序逐份跑、失败列尾部
  输出、需外部预构建产物的自动 SKIP 并写明理由）；`package.json` 加 `test`。
- `scripts/check-clean-tree.mjs`：从 `git archive` 导出纯净树到项目内 `tmp/`
  （逐级向上自然找到 `node_modules`，不需要 symlink），再跑 `tsc` / `vite build`；
  `--index` 可在提交前查暂存区。`package.json` 加 `check:clean`。
  没有改动 `release.yml`：推 `main` 仍不触发任何 CI，`skip ci` 保持成立，
  全量门禁走手动入口。
- 门禁实测：干净树 **tsc 0 错 / vite build ✓**、**63/63 结构测试全绿**
  （0 失败 0 跳过，270.6s）、`cargo test --lib` **164 passed / 0 failed / 11 ignored**。

**账本：只动 provenance，数字一行没改**

- 入库 12 个 lib 后 `modules` **68 → 80**，四份账本 provenance 随之更新；
  docx 保真 **99.0% / 98.4%**、pptx **70.1% / 74.3%**、往返
  **548/619 88.5%**（掉 66 / 值变 5）全部一字不动，证明新模块不在读手链路上。
- 两次干净腿 md5 一致；四条变异腿 59.4 / 52.5 / 99.0 / 96.5（记录对
  416 / 392 / 715 / 685）、`no-theme` 不动、pptx `no-ga` 全红；干净腿复跑复位后
  与基线逐字节相同。

- **诚实边界**：入库不等于加固。JS 宏仍用 `new Function` 且**无沙箱/超时**
  （只挡了 6 个全局名，可从 `api.constructor` 逃逸）；协同中继**无鉴权**，
  限于 `127.0.0.1` 回环、同机任意进程报同名房间即可读写全文；PDF 原地改字
  是往内容流追加盖块 + 新字，字形会变、盖块可能压住邻字、长文本右溢。
  `test-collab.mjs` 在干净 clone 上无预构建 relay 时会被 SKIP（不是通过）。
  全量门禁仍无 CI 自动触发、无真实文档回归、无 E2E / 真机 COM 对撞。

## v0.198（往返账可接任意 docx + 多夹具对照 + pdf-lib 纯动态）

**P1 第一轮：把账本从「一份夹具」推向「任意输入」**

- 主账本 88.5% 只跑一份人手夹具（`scripts/lib/fixture.mjs`，609 行）；边界里写明了
  「覆盖面就是这份夹具的覆盖面」，但这句话从没被真正检验过。本轮不刷百分比，
  先把量具改成能接任意 docx，再看换输入会发生什么。
- `fidelity-roundtrip.mjs` 加 `--docx` / `--out`：**默认夹具路径逐字节不变**
  （复跑 md5 `e18c56a3…` / `44f71de3…` 复核一致）；给外部 docx 时输入换成该件、
  输出落到 `tmp/roundtrip-<文件名>/`，**绝不覆盖 `docs/` 主账本**，md/json 只在
  外部输入时多一行 `source` 标注。
- 新增 `scripts/roundtrip-corpus.mjs`：把任意一批 docx 逐份喂给同一个量具，出逐份
  四档数字、统计跨夹具反复掉的对、把非法语料明确归为 SKIP。`--corpus` 必填，
  不偷偷依赖仓库里未入库的 `tmp/` 生成物；报告只写文件名，不写路径与日期。
- **21 份异构夹具实测**（`docs/roundtrip-corpus.md`）：15 份各轮窄夹具 **100%**，
  而 `00-base` **30.5%** / `02-tables` **28.2%** / `03-drawings` **33.1%** /
  `04-vml` **95.2%** / `stress` **83.3%**；合计 **1442/1702 = 84.7%**，
  单份中位数却是 **100%**。248 个对在至少一份里掉过或值变过，
  `tblLook|firstColumn/firstRow/lastColumn/lastRow` 与 `trHeight|val` 是仅有的
  跨 2 份反复掉的族——长尾是**广而浅**的，不是某一族反复出错。
- **判断修正**：**88.5% 不是「项目的往返保真率」，是「这一份夹具的往返保真率」**。
  换输入后从 28.2% 到 100% 都有。以后任何「提升 X 个百分点」的说法都必须
  同时给出输入集；只在单份夹具上加分母内属性、再加回写手，数字会涨但认知没涨。
- 一份 `01-body.docx` 被写手拒绝：源件里 `w:themeShade="0"` 不是合法的 2 位 hex
  （`ST_UcharHexNumber`），属**合成语料生成器的缺陷，不是产品 bug**。
  不改产品、也不改生成器（那会动保真账的分母），在报告里明确归为 SKIP。

**性能：pdf-lib 真正按需**

- `pdf-text-edit.ts` 顶层那枚静态 `import { rgb }` 是 `INEFFECTIVE_DYNAMIC_IMPORT`
  的根源：`PdfViewer.tsx` 与 `pdf-pages.ts` 明明都 `await import('pdf-lib')`，
  却被这枚静态值把整个库钉回主 chunk。改成 `import type` + 函数内
  `await import('pdf-lib')` 取 `rgb`（同一模块缓存，零额外下载）后：
  **警告归零**，PdfViewer chunk **1,201,157 → 821,985 字节（−31.6% / −379,172）**，
  pdf-lib 变成独立的 **382,487 字节按需 chunk**。这正是 v0.197 解锁的那条顺延项。
- 行为不变：`test-pdf-text-edit.mjs` 单跑通过，63/63 全绿。

**门禁**：干净树 tsc 0 / vite build ✓、63/63（246.6s）、`cargo test --lib`
164 passed；三本账 md5 与 v0.197 **完全一致、`docs/` 零改动**（没新增 lib、
pdf-lib 改动不在读手链）；四条变异腿 59.4 / 52.5 / 99.0 / 96.5、
`no-theme` 不动、pptx `no-ga` 全红、干净腿复位逐字节相同。

- **诚实边界**：这 21 份仍是**合成件，不是真件**；合计 84.7% 只是各份分子/分母
  分别求和的规模描述，不是统一口径的覆盖率，各份分母不同，中位数 100% 与最低
  28.2% 并存正说明这一点。真件回归仍缺 20–50 份语料（需外部提供）；
  xlsx/ods 属性级账、pptx 账扩宇宙、Calc 视图缩放均未做。

## v0.199（口径假红分档 + pptx 外部语料不覆盖主账本 + 第二次换输入实测）

**接着 v0.198 跑：跨夹具复现 ≠ 真丢**

- 把上一轮报告里唯一跨 2 份反复掉的 5 对逐对诊断了一遍（读手 / 模型 / 包槽 / 写手四处）：
  - `tblLook|firstRow/lastRow/firstColumn/lastColumn`：`w:tblLook` 的 `w:val` 是
    ST_TblLook 位掩码（0x20 / 0x40 / 0x80 / 0x100），与六枚显式 ST_OnOff 属性是
    **同一组开关的两种写法**。读手写手自 v0.147 起刻意只保真
    `val/noHBand/noVBand`；写出包只发 `w:val` 不丢语义，补写显式属性反而会写出
    与掩码打架的坏件——**同义表示，按纪律不碰**（与历史 `tblpPr|overlap` 同类）。
  - `trHeight|val`：`00-base` / `02-tables` 里的 `<w:trHeight w:hRule="atLeast"/>`
    缺 `w:val` 是 CT_Height 允许的「无值结构」（`val` optional），源里本就没值可丢；
    `docx` 包的 `height.value` 必填，发不出无 val 的 trHeight。主账本与
    `stress.docx` 里这一对本来就是 kept。**补写等于凭空造数**。
  - 结论：248 个掉对里最扎眼的「跨夹具复现」，是量具口径 + 合成件人造形状造成的
    **假红**。这反过来又印证 v0.198：换输入之前，别把某个百分比当项目水平。
- 新增 `scripts/lib/known-alias.mjs`：只收已逐对诊断过、有明确依据的 4 枚同义对；
  `roundtrip-corpus.mjs` 报告加「口径」列与「跨夹具复现 ≠ 真丢」说明。
  **账本数字一分不动**，名单只用于分档、不参与判定。
  `scripts/test-corpus-alias.mjs` 27 条断言钉住名单与两处接线。

**补上一个真风险：pptx 账会被外部语料覆盖**

- `fidelity-report-pptx.mjs` 的 `--corpus` / `--clist` 原先默认 `--out docs`——
  **跑一次真件就会把 `--selftest` 主账本覆盖掉**。这是 v0.198 给往返账加 `--docx`
  时补过的同一条界线，pptx 侧漏了。现在 `EXTERNAL` 时默认落
  `tmp/pptx-fidelity-corpus`，corpus mode 报告加「与 fixture mode 不可比、
  绝不覆盖主账本」说明；`--selftest` 默认路径与 md5 逐字节不变
  （`02f53f0b…` / `3861bfee…` 复核一致）。
- 顺手跑了一次外部输入：`tmp/perf/stress.pptx` 作语料，pptx 保真
  **按对 17.2% / 字面 47.8%**（分母 174 对、26502 字面），而内置夹具是
  **70.1% / 74.3%**（77 对）。这是第二个「百分比高度依赖输入集」的证据，
  而 70.1% 已冻结 55 轮从没换过输入。复跑：
  `pnpm exec vite-node scripts/fidelity-report-pptx.mjs --corpus <dir>`。

**没做的**：Calc 视图缩放查到 Univer facade 只暴露内部 `getZoomRatio()`、
没有稳定的 `setZoomRatio`，硬接 `executeCommand` 等于赌 API，按纪律不赌，单独立项；
xlsx/ods 属性级账仍是空白。

**门禁**：干净树 tsc 0 / vite build ✓、**64/64 全绿**（214.5s，新增 1 份）、
`cargo test --lib` 164 passed；三本账 md5 与 v0.197 起完全一致、变异腿
59.4 / 52.5 / 99.0 / 96.5、`no-theme` 不动、pptx `no-ga` 42 条全红、
干净腿复位逐字节相同。

## v0.200（xlsx 属性级往返账：空白 → 第一版）

**补的是评估里挂了很久的「xlsx/ods 属性级账空白」**

- **为什么不能照搬 docx 账**：docx 往返账的分子靠往 TS 读手的 `attr/attrL`
  两枚漏斗注入探针，拿到「读手查问过哪些对」。xlsx 读手在 Rust
  （`calamine` + `quick-xml`），没有统一漏斗，探针分子搬不过来；
  `xlsx_preserve` 又是**整份搬运部件**，直接普查会把它算成 kept（假绿）。
- **分工方案**：Rust 只跑产品真出口，Node 只管怎么数。新增
  `src-tauri/src/sheet_dump.rs`（仅 `#[cfg(test)]` 编译，不进生产包）：
  人手夹具 → `write_xlsx_sync` 造源包 → `read_xlsx_sync` 读回 →
  `write_xlsx_sync` 再写一次，把两个包落到 `tmp/sheet-roundtrip/`。
  `scripts/sheet-roundtrip.mjs` 用 JSZip + 产品 `ooxml.ts` 的 `parseXml`
  做 census，逐对四档 `kept/value/lost/part`，出
  `docs/sheet-roundtrip.md` / `.json`。归一化与 docx 账同源。
- **口径写死在报告里**：分母是**白名单部件里全部属性对**（`sheetN.xml` /
  `styles.xml` / `workbook.xml` / `sharedStrings.xml`），是整包普查而不是
  「读手查问过的」；打包细节与 preserve 侧通道部件不进分母。默认源包由产品
  写手自己造，量的是**二次保存稳定性**；给 `--src <真件>` 才量真件保真，
  两种输入不混在一个数字里，且外部输入默认落 `tmp/`、不覆盖主账本。
- **实测 65 对全部 kept（100%）**。这个 100% 是**地板不是成绩**：源包由产品
  自己写出，读手不认的属性根本不在源里。它的用处是钉住「二次保存不退化的
  65 对」，等真件进来才有分母可言。
- **变异腿证明账本有牙**：`scripts/test-sheet-roundtrip.mjs` 把写出包
  `<cols>` 整段删掉，账本必须报 lost；恢复后回到 65/65 且 md5 与基线
  逐字节相同。15 条断言，全程只写 `tmp/`，自包含（干净 clone 上缺 dump
  时自己跑一次 cargo test 生成）。

**没做的**：ODS 侧（`content.xml` / `styles.xml` 是另一套命名空间与词表，
key 映射翻倍）、20–50 份真件语料、Calc 视图缩放（Univer 无稳定
`setZoomRatio`，不赌 API）。

**门禁**：干净树 tsc 0 / vite build ✓、**65/65 全绿**（346.6s，新增 1 份）、
`cargo test --lib` **165 passed / 11 ignored**（新增 dump 测试）；xlsx 新账
`37ea6e43…` / `61ba3c88…` 复跑一致；三本旧账 md5 与 v0.197 起完全一致、
变异腿 59.4 / 52.5 / 99.0 / 96.5 不动、pptx `no-ga` 42 条全红、
干净腿复位逐字节相同。

## v0.201（ODS 属性级账：泛化同一副骨架，不复制脚本）

**第二处同形状需求出现时该泛化**

- `scripts/sheet-roundtrip.mjs` 加 `--format xlsx|ods`，共用 census、归一化、
  四档判据与账本模板，只在四处分开：跑哪个 `cargo test`、读哪两个包、
  哪些部件进分母、账本叫什么。Rust 侧 `sheet_dump.rs` 加
  `dump_ods_roundtrip`（`write_ods_sync` → `read_xlsx_sync` 按 `.ods` 分流 →
  再 `write_ods_sync`），支持 `ODS_SRC_ODS` 外部真件；两个格式的外部入口互斥，
  避免上一次的环境变量串味。
- ODS 白名单：`content.xml` / `styles.xml` / `Object N/content.xml`；
  `mimetype` 与 `META-INF/manifest.xml` 是打包细节，不进分母。报告明写
  **ODF 与 OOXML 是两套词表，两本账不可并排比百分比**。

**第一次出现非 100%，先诊断再下结论**

- ODS 账 **14 对 / 12 kept（85.7%）/ 2 值变 / 0 掉 / 0 缺件**，
  md5 `d33da8a5…` / `b2aa0910…`。值变的是 `style|name`（少了 `co2`）与
  `table-column-properties|column-width`（少了 `2.1167cm`）。
- 逐对 dump 两个包的列定义后确认：源包为**超出实际列范围**的 `col_widths`
  生成了一个没被任何 `<table:table-column>` 引用的**孤儿样式 `co2`**；
  读侧只从实际列定义读列宽，写出时它自然消失。**不是读手丢信息，是源包冗余
  被算进了分母**。按 v0.199 的纪律，报告加「口径」列标注这两对，
  **四档数字一分不动**，并写明「不能读成 ODS 比 xlsx 差」。
  写手侧那处冗余输出本身留作下一轮候选，本轮不为凑数字改产品。

**变异腿也泛化**：逻辑抽到 `scripts/lib/roundtrip-mut.mjs`，xlsx 与 ODS
各一份独立测试，自包含生成 dump、全程只写 `tmp/`、复位后 md5 与基线逐字节
相同（各 12 条断言）。ODS 锚点特意选带 `ro2` 的整行——那两枚属性确实在分母
且原本是 `kept`；删 `table-column` 不行，它不在白名单分母里，删了账本毫无反应。

**没做的**：20–50 份真件语料、Calc 视图缩放（Univer 无稳定 `setZoomRatio`）、
ODS 写手的孤儿样式清理。

**门禁**：干净树 tsc 0 / vite build ✓、**66/66 全绿**（297.9s，新增 1 份）、
`cargo test --lib` **166 passed / 11 ignored**；xlsx 账因泛化与口径列重生成
（`0fd13292…` / `0e3e3f42…`）、ODS 新账复跑一致；三本旧账 md5 与 v0.197 起
完全一致、变异腿 59.4 / 52.5 / 99.0 / 96.5 不动、pptx `no-ga` 42 条全红、
干净腿复位逐字节相同。

## v0.202（修 ODS 列宽：判断修正，账本 85.7% → 100%）

**先纠正上一轮的判断**（README / 审计 / 评估三处都写明）

- v0.201 把 ODS 账那 2 对值变判成「源包孤儿样式冗余、按纪律不碰」。
  再查一层发现**这个判断不准确**：根因是 `render_sheet` 的 `max_col` 只从
  `cells / merges / hidden_cols / notes / links / charts` 取最大列号，
  **漏了 `col_widths` 的键**。用户设了第 1 列宽度，`build_dim_styles`
  替它造了 `co2` 样式，却没有任何 `<table:table-column>` 引用——
  **列宽语义是真的丢了**，不是「源包里一枚不承载语义的冗余」。
  该修渲染范围，而不是删样式让数字好看。
- 修法：`max_col` 的 chain 加 `.chain(sheet.col_widths.keys().copied())`。
  同宽连续列仍并入 `table:number-columns-repeated`，不会因为一个远处的宽度
  炸出成百上千个空列。Rust 全量 166 passed 没有一个断言被碰坏。

**数字**：ODS 往返账 **12/14 (85.7%) → 14/14 (100%)**，值变 2→0、
掉了 0、缺件 0，**分母仍是 14 对**——提升来自修产品，不是改量具口径，
也不是往分母里加属性。xlsx 账逐字节不变（`0fd13292…` / `0e3e3f42…`）。

**量具同步**：`CAVEATS` 名单保留作**回归守卫**（若以后又出现这两对值变，
报告会重新标出原因），但只在「本轮账本确实命中」时才显示那段解释，
免得修好了还挂着一句「不能读成 ODS 比 xlsx 差」；变异腿的 ODS 基线
`kept` 从 12 改成 14，两个变异腿仍各 12 条断言全绿。

**没做的**：20–50 份真件语料、Calc 视图缩放（Univer 无稳定 `setZoomRatio`）、
pptx 账扩宇宙。注意 100% 仍是**内置夹具的地板**，不是真件成绩。

**门禁**：干净树 tsc 0 / vite build ✓、**66/66 全绿**（331.0s）、
`cargo test --lib` **166 passed / 11 ignored**；五本账 md5 全部复跑一致
（ODS `7ce6d77f…` / `b73aacb8…`）；三本旧账 md5 与 v0.197 起完全一致、
变异腿 59.4 / 52.5 / 99.0 / 96.5 不动、pptx `no-ga` 42 条全红、
干净腿复位逐字节相同。

## v0.203（pptx 保真账多输入对照：70.1% 也倒下了）

**把 v0.198 的方法论补齐到 pptx 链**

- pptx 主账本 70.1% 自 v0.141 冻结 55 轮没换过输入；v0.199 用
  `stress.pptx` 换过一次得 17.2%，但只有一份。新增
  `scripts/pptx-corpus.mjs`：用**产品自己的导出链**
  （`emptyDeck` / `newSlide` / `deckToPptxBytes`）造 6 份形状不同的 pptx
  （单页标题 / 三页要点+动画 / 文本框属性 / 图片版式 / 深色母版+备注 /
  混合多页），逐份喂给同一个 `fidelity-report-pptx.mjs`，出逐份分母、
  查问对、按对/按字面覆盖率与「反复没被查问的对」。语料是生成物落
  `tmp/`、不入库；支持 `--corpus` 外部真件、`--no-gen`、`--limit`；
  单件账本落 `tmp/pptx-corpus-report/`，**不覆盖 `docs/pptx-fidelity.*` 主账本**。
- **实测 6/6 跑成**：合计 **203/1100 = 18.5%**，单份 17.3–19.7%，
  中位数 18.7%；172 枚对在至少一份里没被查问（`alpha|val`、
  `bodyPr|rtlCol`、`buFont|typeface` 等 6 份全没查）。
  对照 `--selftest` 手写夹具 70.1%（77 对），差近 4 倍。
- **判断**：**18% 不是「读手退化」，是分母口径**。手写夹具只放了读手关心的
  属性；产品导出链写出的 pptx 带大量默认 / 打包级属性（`a:` 细节、样式
  默认、命名空间声明），它们同样进全树分母，读手不查问是设计如此。
  两数之差量的是分母，不是能力。这是第三次「百分比依赖输入集」的证据
  （docx 88.5→84.7、pptx 单次 17.2、本轮 18.5）。
- **口径踩坑并修**：初版把 stdout 的「已查问」（**字面次数**
  `consultedOccurrences`）除以「分母对」，算出 **113.1%** 的荒唐数。
  现一律用 JSON 的 distinct 对 `consultedPairs` / `meaningfulPairs`，
  与 `coverage.byPair` 同源；报告口径节显式写明。另修 1x1 PNG 的
  base64（长度非 4 倍数导致 `04-image` 生成失败）。
- `scripts/test-pptx-corpus.mjs` 17 条断言钉住 distinct 口径、合计不超
  100%、报告四节齐备、只写文件名、跑批不覆盖主账本、干净 clone 自包含。

**没做的**：20–50 份真件语料、Calc 视图缩放。这 6 份仍是**产品自己导出的
合成件**，不是真 PowerPoint / WPS 件。

**门禁**：干净树 tsc 0 / vite build ✓、**67/67 全绿**（344.9s）、
`cargo test --lib` **166 passed / 11 ignored**；五本账 md5 全部复跑一致、
主账本 pptx 70.1/74.3 逐字节未动；变异腿 59.4 / 52.5 / 99.0 / 96.5 不动、
pptx `no-ga` 42 条全红、干净腿复位逐字节相同。

## v0.204（Impress 查找/替换：从量具回到可见能力）

按上一轮说好的，这轮**不造新账本**，补 WPS 评估里点名的 Impress 缺口。

- Writer 的 `find-replace.ts` 是 ProseMirror Extension，Impress 是自研
  `Deck` + React 状态，搬不过来。新写 `src/lib/ppt-find.ts`：只在**用户可见
  文本槽**上做纯函数读写（演示名 / 标题 / 正文 / 备注 / 形状文字·名称·替代文本 /
  表格单元格 / 图表标题·类目·系列名），不搜 id、色值、坐标、data URI、枚举；
  命中带字符区间与预览；替换返回逐层换引用的**新 Deck**，原对象一寸不动；
  不用正则，用户输入的 `.` `[ ]` `*` 都是字面量；命中封顶 2000。
- `PptEditor.tsx` 接线：工具栏「查找替换」按钮 + 琥珀面板（复用
  `doc-toolbar` / `doc-fr-panel` / `tb-input` / `tool-btn-mini`，**未改 index.css**），
  支持查找词、替换词、区分大小写、上/下一条、替换当前、全部替换、命中计数与
  位置预览；`Ctrl+F` / `Ctrl+H` 打开、`Escape` 关闭、`F3` 下一个、
  输入框内 `Enter` / `Shift+Enter` 翻条，并防输入框抢键。
- 两个接线陷阱按调研处理：替换一律走 `edit()`（唯一会 `markDirty` 触发
  自动保存的出口），不裸 `setDeck`；跳页与选中形状**分开一拍**——
  `[cur]` effect 会清空 `selShape` / `editingShape`，同一次事件连着设会被抹掉。
- `scripts/test-ppt-find.mjs` 45 条断言：13 个字段族、大小写、不可变、
  正则元字符、单条替换、封顶、位置标签。

**账本 provenance**：新增 1 个 lib → `modules` **80→81**，三本旧账的 5 份
`docs/` 文件**只改这一行**，逐对数字一字未动（docx 99.0/98.4、pptx 70.1/74.3、
往返 88.5%）；表格两账不含 modules 字段、完全不变。又一次印证「新增 lib
不在读手链上」。踩到的瞬时状态：新 lib 暂存未提交时，量具的
`git show HEAD:<file>` 取副本会失败，`test-pptx-corpus` 两份账本被跳过——
**提交代码笔后自动恢复**，与 v0.197 写的纪律同源。

**没做的**：真件语料 20–50 份、Calc 视图缩放（Univer 无稳定 `setZoomRatio`）。
本轮是能力补齐，不改变任何保真数字。

**门禁**：干净树 tsc 0 / vite build ✓、**68/68 全绿**（383.6s，新增 1 份）、
`cargo test --lib` **166 passed / 11 ignored**；变异腿 59.4 / 52.5 / 99.0 / 96.5
不动、`no-theme` 不动、pptx `no-ga` 42 条全红、干净腿复位逐字节相同。

## v0.205（Impress 动画刷；Calc 缩放查实后明确不做）

**先把挂了四轮的 Calc 缩放判死**

- 复查 `@univerjs/presets` 的 UMD：只有内部 `getZoomRatio` /
  `getNextWheelZoomRatio` / `setZoomRatio`（后者是 docs drawing snapshot 用），
  **facade 与 command id 都没暴露**。而 Impress / DocEditor 用的纯 CSS `zoom`
  不能照搬——DocEditor 注释里明写「clientX 要除以 zoom 折回去」，
  Univer 内部不会这么算，套上去拖拽与选区坐标会错位。
  理由从「API 不明」升级为「**已查实无可靠入口**」，不做半坏功能。
- 于是补同一张 WPS 能力表里的另一个明确缺口：**Impress 动画刷**。

**动画刷**

- 纯函数加在**已有的 `src/lib/ppt.ts`**，不新开 lib：
  `pickSlideAnim` 取 7 枚动画字段（切页 / 要点动画 / 方向 / 退场 /
  自动换页 / 点击换页 / 时长），`applySlideAnim` 返回逐页换引用的新 `Deck`，
  `slideAnimSummary` 给 UI 写摘要。
  **不搬 `animOrder`**——揭示序按本页正文条数与形状数编键（`l0` / `s2`），
  刷到内容不同的页会指错节点；也不搬 id / 标题 / 正文 / 备注 / 形状 / 背景。
- `PptEditor.tsx`：工具栏「动画刷」复制本页设置并高亮，刷子模式下点缩略图
  = 刷到那一页并跳过去，另给「刷到全部页」，`Esc` 取消；落盘与查找替换
  一样走 `edit()` 统一标脏。44 条断言（含「不复制 animOrder」与 UI 接线）。

**账本零改动**：因为没新增 `src/lib` 文件，`modules` 仍是 **81**，
五本账 md5 与 v0.204 逐字节相同、`docs/` 零 diff——正是把纯函数放进已有
文件想换来的效果（v0.197 的教训）。

**没做的**：真件语料 20–50 份、Calc 视图缩放（已判死）、Impress 内容区
右键菜单（能力表同行的最后一项）。动画刷没有屏上高亮与真机对撞。

**门禁**：干净树 tsc 0 / vite build ✓、**69/69 全绿**（395.6s，新增 1 份）、
`cargo test --lib` **166 passed / 11 ignored**；变异腿 59.4 / 52.5 / 99.0 / 96.5
不动、`no-theme` 不动、pptx `no-ga` 42 条全红、干净腿复位逐字节相同。

## v0.206（Impress 内容区右键菜单；能力表最后一项可见功能补齐）

**第二处同形状需求 → 泛化，不复制**

- Writer 的右键菜单条目表在 `src/lib/context-menu.ts` 是纯函数、组件只接线。
  Impress 是另一套状态（自研 `Deck` + React），但「按命中语境决定出现哪些项、
  哪些灰掉」这件事同形状——于是在**同一个文件**里加 `pptContextItems` /
  `clampMenuPos`，共用 `CtxItem` 契约，**不新开 lib**：`modules` 仍是 **81**，
  五本账与 provenance 零改动。Writer 原表与接线一寸没动。
- 坐标裁剪抽成公共 `clampMenuPos`，顺手把 Writer 原来「只裁右下、不裁左上」
  的内联 `Math.min/max` 收进公共函数——四边都不溢出（Writer 尚未接线，行为不变）。

**条目表（纯函数，Node 侧 51 条断言）**

- 命中形状：`编辑文字 / 复制形状 / 删除形状 / 上移一层 / 下移一层`，
  图表另给 `编辑图表数据`；命中空白：`插入文本框 / 表格 / 图表 / 粘贴`；
  两者都有 `查找替换 / 上一页 / 下一页`。无文本、首末页、无剪贴板时对应项灰掉
  （`disabled` 只在真禁用时出现，同 Writer 纪律）；分隔线 `label` 恒空、id 唯一。
- 剪贴板是**内存态**（复制/粘贴形状走它，换 id + 错位 + 清逐条动画），
  跨标签不共享、退出即丢；「粘贴」灰掉由它驱动，不假装系统剪贴板里有东西。

**接线（复用现成件，不碰 `index.css`）**

- 形状 box 与舞台空白处各挂 `onContextMenu`；形状上 `stopPropagation` 并把命中
  **快照进 state**——不吃 `[cur]` effect 清空 `selShape` 的陷阱。菜单复用 Writer 的
  `.doc-ctx-menu / .doc-ctx-item / .doc-ctx-sep`（房规里被误抹过的 `index.css` 一寸没碰）。
- 执行唯一入口 `runCtx`：一律调现成动作包装（删除/层级/新增/新写的复制粘贴），
  不裸 `setDeck`，走 `editSlide` 统一标脏。Esc 在捕获阶段先收菜单，与查找替换、
  动画刷共用一键不冲突。
- **设计修正**：纯函数初版加过模块级 `pasteProbe` 全局钩子（不纯、测试间互相污染），
  当场改成 `hasClipboard` 入参布尔，保持纯函数可钉。

**没做的**：真件语料 20–50 份；三项功能（查找替换 / 动画刷 / 右键菜单）都**无屏上
高亮与真机 PowerPoint/WPS 对撞**；0 E2E、CI 仍不自动跑。量具线连续多轮零改动，
再铺量的边际收益低于补真件语料。

**门禁**：干净树 tsc 0 / vite build ✓、**70/70 全绿**（439.2s，新增 1 份）、
`cargo test --lib` **166 passed / 11 ignored**；五本账 md5 与 v0.205 逐字节相同、
`modules` 仍 81、变异腿 59.4 / 52.5 / 99.0 / 96.5 不动、`no-theme` 不动、
pptx `no-ga` 42 条全红、干净腿复位逐字节相同。

## v0.207（澄清 xlsx 行高「字节漂移」为假红）

**roadmap:173 挂了很久的一条待办，证伪后关掉**——不是修 bug，是砍假红。

- 旧陈述：「`set_row_height_pixels` 只收整数像素，载荷里非整的那一档被 `as u32`
  截掉，最多漂 1px＝0.75pt」。这是 v0.19 时代的历史写实，但今天已不可达：
  - 前端写手 `univer-io.ts` 的 `RowDatum.h = Math.round(px)` —— 进 Rust 的
    `row_heights` 已是整数像素；
  - `RowDatum` 类型只有 `h`/`hd` 两个整数字段，读侧的 `ah`（自适应行的渲染高度）
    只喂界面态、不回流载荷；
  - crate 的 `set_row_height_pixels` 本来就只收整数（源码 `(pt×4/3).round() as u32`）。
  - 所以 `as u32` 面对的永远不是非整值，截断分支在真实链路上不可达。
- **处置**：Rust 注释就地改成实话，并点明「别为它加 post-pack 定点改写——那会把
  不可达的假红变成真改字节的风险」；roadmap 那条保留历史文字、后面追加 v0.207
  澄清（家规：历史不改、口径显式声明）。**逻辑一行没动**，不制造补丁。
- 新增 `scripts/test-xlsx-row-height.mjs`（9 条源码级守卫）：钉住写侧 round、
  整数字段、ah 不回流、Rust 注释口径、roadmap 澄清——证据链任一处失效即红，
  防止未来有人把这条假红又当真缺陷修一遍。

**为什么值得做**：假红比真红更坏。一条挂着的老待办会持续误导后续判断（像真的
有 0.75pt 漂移等着修），甚至诱人加一套改字节的补丁引入真 bug。与 v0.202（真丢
语义就修渲染范围）/ v0.205（API 不明就判死）同属「先定性再动手」的纪律决定。

**门禁**：干净树 tsc 0 / vite build ✓、**71/71 全绿**（632.5s，新增 1 份）、
`cargo test --lib` **166 passed / 11 ignored**；五本账 md5 与 v0.206 逐字节相同、
`modules` 仍 81、变异腿 59.4 / 52.5 / 99.0 / 96.5 不动、`no-theme` 不动、
pptx `no-ga` 42 条全红、干净腿复位逐字节相同。

## v0.208（协同 E2E 自包含：relay 按需构建，干净 clone 不再 SKIP）

**门禁最后一处可选缺口堵上**

- `run-tests` 的 71 份里，`test-collab.mjs` 原先是唯一「可选」项：它要一个真的
  WebSocket 中继进程，干净 clone 上没有预构建二进制就被 SKIP——**SKIP 不是通过**，
  这道 E2E 在交付口径里一直是空的，只在本机因残留一个 10 月的旧 `relay.exe` 才常绿。
- 但 `relay.rs` 源码 v0.197 已入库、用的是生产 `pub mod ws_relay`、`[[example]]`
  无 feature 门控——缺的只是构建这一步。于是给 `test-collab.mjs` 加 `ensureRelay()`：
  显式 `RELAY_BIN` 时一律信它（不存在则明确报错）；未指定且二进制不在时
  `cargo build --example relay`，构建失败 / 产物缺失都明确报错，不在环境缺件时静默降级。
- `run-tests` 的 `OPTIONAL` 表清空 → **71 份全必跑、可选 0 份**；保留机制与
  `--include-optional` 出口供将来外部产物测试登记。

**实测**：把本机 relay 二进制改名后跑 `test-collab`，打出
`COMPAT|中继未构建，先 cargo build --example relay`，构建完 12 项断言全过；
`--list` 从「71 份，可选 1 份」变成「71 份，可选 0 份」。
`--only collab` 11.6s PASS、`--only pptx-corpus` 39.4s PASS。

**边界**：`check-clean-tree` 导出的树只跑 tsc + vite build、不跑全量测试；
若在那棵树上跑全量，会触发一次完整 Rust example 重编译——这是预期代价，
不夸大「干净树上全量也能秒跑」。本轮不碰产品代码、不动账本，五本账 md5 与
provenance 均未变。

**门禁（诚实记）**：干净树 tsc 0 / vite build ✓、`cargo test --lib`
**166 passed / 11 ignored**；全量 71 份跑到 677s 时 `test-pptx-corpus.mjs`
被外层资源竞争拖过每份 180s 线而 SIGTERM（`RUN|70 通过 / 1 失败 / 0 跳过`），
**两份在 runner 内单跑均 PASS（collab 11.6s、pptx-corpus 39.4s）**——是超时误杀
不是测试红；此前同样配置下 71/71 全绿（632.5s）。五本账 md5 与 v0.207 逐字节相同。

## v0.209（roadmap 定向体检：三条部分过期项就地澄清）

**461 条未勾项的可信度维护**

- roadmap 是 2026-10-16 的历史快照，最近几轮陆续发现里面混有过期陈述
  （v0.207 的行高假红就是一条）。本轮派只读体检核对 **PDF 搜索 / 性能 / 协同**
  三组共 9 条：**6 条仍成立、3 条部分过期需改口、0 条可整条关闭**——说明清单整体
  可信，只需定点澄清，不需要重写。
- 三条就地追加 `【v0.209 澄清（部分过期）】`，**历史文字原样保留、不勾项**
  （未勾数仍 461，家规：历史不改、口径显式声明）：
  1. **「从当前页找下一个还没有」**：`focusFirst()` 早已按 `curPageRef` 实现
     首次命中从当前页定位；`gotoMatch(±1)` 才是纯命中列表环绕。两件事被压成一句，
     而且按列表环绕是 WPS/Adobe 的常规交互，不是缺口。
  2. **「建实例提到外壳 / 预热有没有把 chunk 备好」**：`prewarm.ts` 实测实例预热
     首开耗时一位数没降、已删，只留 chunk 预取——两个子问题都已被后续回答。
  3. **「PdfViewer 那块 chunk」**：v0.198 已把 `pdf-text-edit.ts` 静态 `rgb` 改动态
     import，chunk 1,201,157 → 821,985 字节（−31.6%）、pdf-lib 成独立按需块；
     定性结论（仍在关键路径）不受影响。
- 新增 `scripts/test-roadmap-clarity.mjs`（11 条守卫）：钉住三条澄清在场 + 对应
  代码事实（`focusFirst`/`gotoMatch`、`prewarm` 已删、动态 import）未回退 + 恰好
  三条标注。任一处被改动即红，防止清单重新误导判断。

**价值**：这是文档可信度维护，不是功能轮——**不碰产品代码、不动账本**。
一个挂着假待办的清单会像假红一样持续误导后续判断；体检先定性（9 条里 6 条
仍成立才敢说整体可信），再对 3 条动刀，逐条给代码级证据。

**门禁**：干净树 tsc 0 / vite build ✓、`cargo test --lib` **166 passed / 11 ignored**；
全量 72 份跑到 676.4s 时 `test-pptx-corpus.mjs` 再次被外层超时误杀
（`71 通过 / 1 失败 / 0 跳过`），runner 内单跑 37.9s PASS、新测试 6.8s PASS；
五本账 md5 与 v0.208 逐字节相同、`modules` 仍 81。

## v0.210（真件回归：88.5% 在真实文件上是 68.5%）

**终于拿到真件**——用户本机 8 份真实 `.docx` + 1 份真实 `.xlsx`。按个人文件安全
规则**只读复制副本到 `tmp/real-corpus/`，原件全程未动**；报告只写副本编号
`R01`–`R09`，不写原始路径与日期。

| 账 | 夹具成绩 | 真件成绩 | 口径 |
|---|---:|---:|---|
| docx 往返（写回去多少） | 548/619 = 88.5% | **673/982 = 68.5%** | 8 份全跑成，单份 60.5%–83.1%，中位数 80.0% |
| docx 保真（读手查问过多少） | 99.0% / 98.4% | **85.8% / 97.3%** | 按对 / 按字面，字面几乎不降 |
| xlsx 属性级（整包普查） | 65/65 = 100%（地板） | **33/103 = 32.0%** | 丢失集中在 `styles.xml`（60 对只留 5 对） |

**三本账不可并排比**：保真量读、往返量写、表格量整包普查。真件里保真按字面仍
97.3% 而往返掉到 68.5%，正说明「读得懂」与「写得回」是两件事。夹具的 100% 是
「产品自己写出再读回」的地板，真件才量到真保真。

**8/8 全掉的头三族，诊断后没有一族值得本轮改产品码**

- `cols|num/space`：真件源值 `num=1`（单栏 = OOXML 缺省），写手刻意不写，语义等价——**假红**。
- `docGrid|charSpace`：源值 `0`，同族 `linePitch`/`type` 都 kept；根因是 docx 库真值闸吞了数字 0，
  先确认 0 是否 Word 缺省再定——**需单独立项**。
- `bookmarkStart/End|id/name`：`w:id` 是引用图，掉的是 `_goback`/`_toc*` 空/跨段书签，
  已是已知诚实边界——**按纪律不碰**。
- 另有 `kern|val` 真丢但与 `characterSpacing` 非同义，牵动 charExtra 一族——**单独立项**。

> **真件百分比低 ≠ 读手退化**：落差主要来自合成夹具只放读手关心的属性，而真件带大量
> 缺省/主题/视觉属性，加上几族已定性的假红。修任何一族都要动写手、让五本账的
> `assertAtRef` 基线全失效，属单独立项，不在本轮「回归」里顺手做。

**交付**：`docs/real-corpus.md`（跑批脚本逐份表）、`docs/real-corpus-report.md`（三本账
对照 + 四族定性 + 边界）、`scripts/test-real-corpus.mjs`（13 条守卫：数字在场 + 主账本
未被覆盖 + 隐私边界）。**pptx/ods 无真件**，不假装跑过。真件仅 9 份、单一来源，
不构成统计样本；xlsx `styles.xml` 是最大真缺口，建议单独立项而非继续铺量具。

**门禁**：干净树 tsc 0 / vite build ✓、`cargo test --lib` **166 passed / 11 ignored**；
五本账 md5 与 v0.209 逐字节相同、主账本零改动（真件输出全落 `tmp/` 与独立报告）。

## v0.211（xlsx styles 视觉语义：深度诊断 + 口径分档，不硬修）

用户把 **xlsx styles.xml 视觉语义保真**列为第一优先级。深度取证
（preserve / 读手 / 模型 / 第三方库写手四处）后，**结论是不能本轮硬修**——
把根因与不可行方向钉死，比交一个"看起来修了"的补丁更负责任。

**不是一个 bug，是三类东西**

1. **读手已建模、写手没接**（真 bug）：`xf|fillId/fontId/borderId/numFmtId` 各 56 次
   从 `0,10,11,12…` 塌成 0、`sz|val` 11/13/15/18 只写 11、边框 double/medium 变 thin。
2. **第三方库架构限制**（不可逐字节还原）：theme/tint 是 Excel 算出的任意浮点
   （`0.399975585192419`），而 crate `Color::Theme` 只收离散 shade、写回它硬编码的
   tint 常量——改用 Theme 会写出**不同的数字**，账照判值变；49 个本地化样式名
   （常规/货币…）crate 只写死 Normal+Hyperlink、无公共 API；tableStyle 族完全没有
   写 API。
3. **白名单普查口径放大**（假红）：分母是「白名单部件全部属性对」而非「读手查问过的」，
   Excel 声明性属性（`applyProtection=0`、各种 `count`）全进分母。

**整份搬 styles.xml 这条路证伪了**：源件 `fonts=32/fills=42/borders=21/cellXfs=7`，
写出包 `1/2/5/6`——crate 按写入顺序重排索引，单元格 `s=` 从 `1..6` 变 `1..5`；
读侧一读 `s=` 就解析成 `CellStyle`、**原始下标丢弃**，没有映射可用。整份搬会让
样式表指向完全不同的样式，视觉全乱，比现在更糟。

**本轮实际交付**

- `docs/xlsx-styles-gap.md`：三类根因、不可行方向、下一轮立项建议
  （**先解决读侧 `s=` 下标丢失这个根**，否则任何补读补写都是叶）、边界。
- `scripts/sheet-roundtrip.mjs` 的 `CAVEATS.xlsx` 登记 25 族架构限制：**真件账**的
  掉了/值变表与边界段自带逐族解释，32% 这个数字不再是一句绝望的数；**夹具账**
  因这些对是 kept 不受影响，md5 仍 `0fd13292…`/`0e3e3f42…`。
- 修了 CAVEATS 渲染的误标：原逻辑给所有同名对挂标注，会把夹具里 kept 的
  `cellStyle|name=normal` 标成"架构限制"。改为只给**非 kept** 对挂——连带清理了
  ODS 账里 v0.202 修好后仍挂着的两条旧标注（数字 14/14 未动）。
- `scripts/test-xlsx-styles-caveats.mjs` 16 条守卫，自包含不读 `tmp/`。

**下一轮若要做类 1 修复**：扩 `CellStyle` 存源 `xf` 下标 → 写手按"尽量复用同一套
样式表"的顺序构造 Format → 重签五本账基线与 `expectKept`。独立成轮，不是顺手修。

**门禁**：干净树 tsc 0 / vite build ✓、`cargo test --lib` **166 passed / 11 ignored**；
五本账 md5 全部复跑一致（ODS 仅文案连带清理、数字 14/14 未动）、两份表格变异腿各
12/12、全量 74 份 73/1/0（800.3s，`test-pptx-corpus` 又被单份超时误杀，单跑 33.4s PASS）。

## v0.212（补证孤儿样式假红 + 修 runner 超时矛盾）

**两个各自独立的完善，都不是刷分**

**① xlsx rgb 色族也是假红，不是架构限制**

上轮把 `fgColor|rgb` 判成"dxf 前景色、dxf 没接"，这轮数清了族在哪些节才发现问题：

| 节 | rgb | theme |
|---|---:|---:|
| `fonts` | 12 | 8 |
| `fills` | 7 | 24 |
| `borders` | 17 | 4 |
| `dxfs` | **0** | 43 |

真件 `dxfs` 节 rgb 恰为 0——那 7 个 `fgColor|rgb` 全在 `fills`，不是 dxf。更关键：
真件有 **49 个命名样式（`cellStyleXfs`）+ 7 个 `cellXfs`，单元格却只用 `s=1..6`**。
那 49 个命名样式连同它们带的 29 个 `color|rgb`、7 个 `fgColor|rgb`，**没有任何格子
引用**——写手只重建实际用到的样式，其余是孤儿定义。这与 v0.202 ODS 的孤儿列样式
`co2` 完全同族，**既不是架构限制也不是读手 bug**。

- 修正 CAVEATS 措辞（rgb 族改判孤儿假红、indexed 点明 crate 无 `Indexed` 变体），
  `docs/xlsx-styles-gap.md` 补各节分布表与同族论证，21 条守卫加固（自包含）。
- 教训：**定性前先数清族在哪些节，别凭属性名猜上下文**。
- 夹具账 md5 仍 `0fd13292…`/`0e3e3f42…`（这些对夹具是 kept，不受标注影响）。

**② runner 的超时自相矛盾，连续 4 轮污染门禁数字**

`run-tests.mjs` 给每份测试 **180s**，但 `test-pptx-corpus.mjs` 内部等子进程 **420s**、
`test-collab.mjs` 内部等 cargo build **600s**——外层永远先 SIGTERM，表现就是
"全量跑到末尾某份 FAIL、单跑全 PASS"。这解释了为什么 `test-pptx-corpus` 连续四轮
（v0.208–v0.211）都是那个"失败清单"里的常客——**是量具配置错了，不是测试红**。

- `run-tests.mjs` 加 per-test `TIMEOUTS` 表（pptx-corpus 480s、collab 660s），
  按各测试内部声明对齐，默认值 180s 不变；新增长腿在此登记。
- `scripts/test-runner-timeout.mjs` 8 条守卫钉住"外层超时 ≥ 内层超时"这条不变量，
  防止再次漂移。

**门禁**：干净树 tsc 0 / vite build ✓、`cargo test --lib` **166 passed / 11 ignored**；
五本账 md5 与 v0.211 逐字节相同。`test-pptx-corpus.mjs` 在全量里稳定出现
「跑成 0/2」而单跑 2/2 PASS——诊断发现外层测试只截取子进程输出的末尾两行，
把真正的 `SKIP … — why` 截掉了；本轮已改成提取 SKIP 行作为失败信息，
下一次全量即可区分「夹具没生成 / assertAtRef 挡了 / tmp 目录冲突」三种根因。
两次全量实测 `74 通过 / 1 失败 / 0 跳过`（813.0s / 788.7s），**不粉饰成全绿**。

## 性能（v0.3）


- **按编辑器分包 + 懒加载**：主包 8MB → 首屏约 300KB；Univer（6.1MB）只在首次激活表格标签时加载，
  TipTap/docx（836KB）与 pptxgenjs/jszip 同理按编辑器按需加载，mammoth/pptxgenjs/jszip 进一步延迟到导入/导出动作
- **编辑器懒挂载**：标签首次激活才创建 Univer/TipTap 重型实例，之后切换保留状态不重复初始化；
  激活判定落在**渲染期**（幂等 `Set.add`）而不是 effect 里再 `setState`，少一次空转重渲染（v0.36）
- **渲染裁剪**：三个编辑器与幻灯片缩略图 `React.memo` 化；store 的 `markDirty` 幂等去重，
  避免 Univer 每条命令都触发无关标签重渲染
- **挂载不走 Suspense**（v0.36）：外壳与四类编辑器都由 `src/lib/editors.ts` 自持已解析组件，
  绕开 React「兜底至少可见 ~300ms」的节流——表格冷开 1281→584ms、heavy.pdf 冷开 710→225ms
- **空闲预热编辑器 chunk**（v0.26 起，v0.35/v0.36 两次收到实证边界）：`lib/prewarm.ts` 挂在 App
  （首页才是免费的空闲窗口），与挂载点共用同一模块 promise，点击路径上只剩数据请求；
  预热顺序为**外壳** + 按最近文件排部的四个编辑器。
  **实测到此为止**——再往下（真建 Univer 实例、预取/预启 worker、拿空白 PDF 走一遍渲染、把公式 worker
  线程做成常驻池）发布包首开耗时一位数都不降甚至更慢，见上一节的 A/B
- **大 PDF 分段读取**（v0.35）：≥4MB 走 `PDFDataRangeTransport` + Rust `read_range`（raw IPC），
  首屏只读 64KB 头 + 按需区间，17.9MB 文档冷开 901→710ms、热开 260→91ms，且整本字节不再进 JS 堆
- **Univer 首开并行化**（v0.35）：读文件与建实例不再串行等待，20001 行表格冷开 1456→1281ms
  （**这一条在 release 上远没说到点子上了，v0.67 量完改口**：它只把 IPC 提到挂载点之前，而挂载点自己排在
  chunk 取与求值之后，所以 release 上 `read_xlsx` 仍在起进程后 850ms 才出门；把请求提到**外壳开标签那一刻**
  之后，同一件的首帧 1579→1329ms）
- **Rust release profile**：`lto = true`、`codegen-units = 1`、`strip = true`、`panic = "abort"`

## 技术栈与开源组件

| 组件 | 用途 | 许可证 |
| --- | --- | --- |
| [Tauri 2](https://tauri.app) | 桌面壳（Rust 后端 + 系统 WebView） | MIT |
| [Univer](https://univer.ai) | 电子表格内核（渲染/公式/撤销重做）+ 筛选/排序/条件格式/数据验证/查找替换/绘图社区预设 | Apache-2.0 |
| [VChart](https://visactor.io/vchart) | 表格图表自绘（PNG 渲染 → 浮动图片），动态导入懒加载 | MIT |
| [TipTap 3](https://tiptap.dev) | 富文本编辑器内核（ProseMirror），含 color / highlight / character-count / text-style（字族·字号）扩展 | MIT |
| [mammoth.js](https://github.com/mwilliamson/mammoth.js) | docx → HTML **兜底**导入（保真导入器抛错或拆不出块时启用，v0.37 起退居二线） | BSD-2 |
| [docx](https://github.com/dolanmiu/docx) | ProseMirror JSON → docx 导出（编号列表走 `numbering.config` 真编号、表头行走行级 `tableHeader`；字节经 `Packer.toBase64String` 取，`toBuffer` 在浏览器不可用） | MIT |
| [pptxgenjs](https://gitbrent.github.io/PptxGenJS/) | 幻灯片 → pptx 导出 | MIT |
| [JSZip](https://github.com/Stuk/jszip) | pptx/odt（zip）解包与 ODT 打包 | MIT |
| [pdf-lib](https://github.com/Hopding/pdf-lib) | PDF 标注写回（低层 Annotation 字典构造）与页面操作（旋转/删除/提取/合并/拆分），保存时动态导入 | MIT |
| [pdfjs-dist](https://github.com/mozilla/pdf.js) | PDF 查看渲染（worker + cmaps/标准字体） | Apache-2.0 |
| [webview2-com](https://docs.rs/webview2-com) + [windows](https://github.com/microsoft/windows-rs) | PrintToPdf 原生调用（wry 依赖树内，零体积增量） | MIT / Apache-2.0 |
| [calamine](https://github.com/tafia/calamine) | Rust xlsx/xls/ods 读取（CSV 不支持，故 `csv.rs` 自解） | MIT |
| [encoding_rs](https://docs.rs/encoding_rs) | CSV 读侧 GBK 回退解码（中文 Excel 另存的 CSV 非 UTF-8） | MIT / Apache-2.0 |
| [rust_xlsxwriter](https://github.com/jmcnamara/rust_xlsxwriter) | Rust xlsx 写出（含 Format 样式/合并） | BSD-2 / Artistic-2.0 |
| [zip](https://github.com/zip-rs/zip) | Rust xlsx 解包（读取样式/合并 XML）+ ODS 打包写出 | MIT |
| [quick-xml](https://github.com/tafia/quick-xml) | Rust OOXML 流式解析 | MIT |
| [zustand](https://github.com/pmndrs/zustand) | 前端状态管理 | MIT |
| [tauri-plugin-single-instance](https://github.com/tauri-apps/plugins-workspace) | 单实例启动 + 二次启动 argv 转发（文件关联体验） | MIT / Apache-2.0 |
| [tauri-plugin-updater](https://github.com/tauri-apps/plugins-workspace) | 自动更新**检测层**（`check` 一次拿版本/说明/日期；自带 rustls 栈与 minisign 验签，release exe +1.82 MiB 实测） | MIT / Apache-2.0 |
| React 19 + Vite | UI 框架与构建 | MIT |

## 架构

模块图、各层职责与逐轮就地改口在 [docs/architecture.md](docs/architecture.md)。

## 开发

```bash
pnpm install
pnpm tauri dev     # 桌面调试
pnpm build         # 前端类型检查 + 打包
cargo check        # Rust 后端检查（在 src-tauri 下）
```

环境要求：Rust (MSVC)、Node ≥ 20、WebView2 运行时。

> `pnpm dev` / `pnpm build` 会先跑 `scripts/copy-pdfjs-assets.mjs`，把 pdf.js 的 cmaps 与标准字体
> 复制到 `public/pdfjs`（该目录已 gitignore，不入库）。

> 开发备注（2026-09-19）：本机 Word COM 出现任意文档 `SaveAs/SaveAs2` 均挂起的环境故障
> （新建空白也卡、无对话框、与文件内容和落盘位置无关），只读回归（Open + 批注枚举）不受影响；
> v0.11 批注的"Word 规范重存回测"顺延，恢复前先跑新建空白文档保存探针验证 COM 可写。
> 2026-09-23 复核：症状照旧（`Open` 能过、`SaveAs2` 永不返回，写仓库内与 `%TEMP%` 都一样），
> 且被强杀的 Word 会在同目录留下 `~$<文件名>.docx` 孤儿属主文件——**下一次以读写方式 `Open` 会卡在
> "文件正在使用，是否只读打开"的模态框上**，跑 COM 腿前务必先删掉它（只读 `Open` 不受影响）。
> "第三方作者写的件"这一腿因此由手写 Word 形状的 OOXML 夹具顶上（负 id 分隔符条目、条目乱序、
> 表格单元格里的引用、有号没正文），不再等 Word 可写。

## 路线图

全文在 [docs/roadmap.md](docs/roadmap.md)：未勾 462 枚、已勾 169 枚（`grep -c '^- \[ \]' docs/roadmap.md` 与 `'^- \[x\]'` 现量；b52 前置实测轮勾 0 枚、收窄 3 枚、新开 9 枚、architecture 就地改口 1 处，上一轮 b51i 留下的是 453/169——**本轮落件时这一句与文档地图那一行吃同一把现量尺而不再停在上一轮的数**；这两枚底数一律按本轮现量而不沿用上一轮的数）。

## License

本项目代码 MIT；各内核组件遵循上表各自许可证。
