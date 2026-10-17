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
| [docs/architecture.md](docs/architecture.md) | 架构：模块图 + 各层职责 + 逐轮就地改口 | 260 | 193,680 |
| [docs/roadmap.md](docs/roadmap.md) | 路线图：未勾 453 枚 / 已勾 169 枚 | 1,698 | 367,427 |

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

全文在 [docs/roadmap.md](docs/roadmap.md)：未勾 453 枚、已勾 169 枚（`grep -c '^- \[ \]' docs/roadmap.md` 与 `'^- \[x\]'` 现量；b51i 实现轮勾 4 枚、收窄 6 枚、新开 3 枚、就地改口 1 处，上一轮 b51 留下的是 454/165——**本轮 b51i 落件时这一句与文档地图那一行吃同一把现量尺而不再停在上一轮的数（b50 那笔「漏改而停在 444/165」的旧账不重演）**；这两枚底数一律按本轮现量而不沿用上一轮的数）。

## License

本项目代码 MIT；各内核组件遵循上表各自许可证。
