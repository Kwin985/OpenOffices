# docx 往返账（读 → 模型 → 写）

取样 rev `HEAD`（65 个模块，取自 git）。

账本里**不写日期**：同一 rev、同一份夹具复跑必须逐字节相同，否则 `diff` 出来的
就不再是保真的变化。

保真账本回答「读手按名查问了哪些对」。这份账回答**下一句**：查问过、也读到了的东西，
写回包里还在不在。两份账的分母口径相同（同一套「元素|属性」对、同一个解析器、同一份部件清单），
所以可以并排看：保真账本高的地方而这里低，就是一条单边通道。

## 怎么算的

一份夹具走完产品里那条真实的路：

```
docx ──读手──▶ HTML ──TipTap schema──▶ PM 模型 ──写手──▶ docx
```

- **读到的** = 源包里真在场的对 ∩ 探针记录过查问的对。查问了一个源里根本不存在的
  属性不算业绩；源里有、读手没查的，那是保真账本的账，不在这里重复计。
- **普查** = 用读手自己那枚迷你解析器遍历整棵树，记每个对的**值分布**（同一个属性
  在文档里可能出现好几种取值，只比名字会比出一堆假绿）。
- 逐对四选一：

| 档 | 判据 | 意思 |
|---|---|---|
| 保留 | 名字在，且源的每个取值都能在写出包里找到 | 这一段真的双向 |
| 值变 | 名字在，但有源值没写回去 | 写回了别的东西——最隐蔽的单边 |
| 掉了 | 名字在写出包里一次都没出现 | 模型或写手没有这条槽 |
| 缺件 | 连承载它的部件都没写出来 | 整件丢失，比掉了更早一步 |

- `true/1/on` 与 `false/0/off` 归一（ST_OnOff 的两套写法，写手换一套不算丢）；
  **裸元素也算 `val=1`**（`<w:vanish/>` ≡ `w:val="1"`）——只按属性比对时裸元素进不了
  values，写手发裸元素就记成「掉了」，而值与源里那枚一模一样（v0.161）。
  关系 id（`rId1` 之类）归一成占位符——那是包内编号，写手按自己的打包顺序重排，
  逐字比只会比出假红；Word 的存档流水号（`rsid*`/`paraId`/`textId`）按名字规则剔出分母。
- `lvlJc`/`jc` 的 `start`≡`left`、`end`≡`right`（ST_Jc 的两套写法）；`mc:Ignorable`
  按空格拆成一串命名空间前缀（写手多声明两个兼容前缀不是丢东西）；ISO 时刻按
  `Date` 归一（`…T10:00:00Z` 与 `…T10:00:00.000Z` 是同一刻）。

## 账

| | 值 |
|---|---:|
| 读到的对 | 619 |
| 保留 | **288（46.5%）** |
| 值变 | 17 |
| 掉了 | 314 |
| 缺件 | 0 |
| 源包部件 | 7 |
| 写出包部件 | 7 |

探针在这一趟里记到 672 个查问对；源包在场而有 619 个既在场又被查问，构成上面的分母。

## 分两笔账：正文属性与图形壳

一个混起来的百分比说明不了任何事。这份夹具里一半是 VML / DrawingML 的图形壳，
那是**成心**放进去照「读了写不回」的（形状与文本框被读手展平成文字，壳就没有容身之处）；
日常文档真正走的是正文那一半。所以分列：

| 族 | 读到的 | 保留 | 值变 | 掉了 | 保留率 |
|---|---:|---:|---:|---:|---:|
| 正文属性（`w:*`） | 300 | 246 | 15 | 39 | **82.0%** |
| 图形壳（`a:`/`v:`/`wp:`/`pic:`/`wps:`/`o:`） | 319 | 42 | 2 | 275 | **13.2%** |

口径说明：一个对算正文，当且仅当它在源包里**只**出现在 `w:*` 元素上（沾过图形壳就算图形壳）。
对名按 local name 归并（与保真账本同口径），所以 `fill|type` 这种两族同名的会并成一笔。

### 掉了（314）

名字一次都没写出来。这里每一行都是一条**单边通道**：读手读了，模型或写手没有它的槽。

| 对 | 源里出现 | 源值 | 写出值 |
|---|---:|---|---|
| `schemeClr|val` | 8 | accent1, accent2, accent3, lt1 | — |
| `gs|pos` | 4 | 0, 100000 | — |
| `fldChar|fldCharType` | 3 | begin, separate, end | — |
| `ln|w` | 3 | 9525 | — |
| `lumMod|val` | 3 | 50000, 80000 | — |
| `col|space` | 2 | 400 | — |
| `col|w` | 2 | 2000, 3000 | — |
| `ext|uri` | 2 | {1234-5678-9abc-def0}, {1234-5678-9abc-def1} | — |
| `imagedata|id` | 2 | rid# | — |
| `path|h` | 2 | 1000 | — |
| `path|w` | 2 | 1000 | — |
| `pt|x` | 2 | 0, 10 | — |
| `pt|y` | 2 | 0, 20 | — |
| `rect|b` | 2 | 0 | — |
| `rect|l` | 2 | 0 | — |
| `rect|r` | 2 | 0 | — |
| `rect|t` | 2 | 0 | — |
| `spLocks|noEditPoints` | 2 | 1 | — |
| `srgbClr|val` | 2 | ff0000, 0000ff | — |
| `alpha|val` | 1 | 50000 | — |
| `alphaOff|val` | 1 | 200 | — |
| `appearance|val` | 1 | normal | — |
| `attr|name` | 1 | x | — |
| `attr|val` | 1 | y | — |
| `blipFill|rotWithShape` | 1 | 1 | — |
| `bodyPr|anchor` | 1 | ctr | — |
| `bodyPr|anchorCtr` | 1 | 0 | — |
| `bodyPr|bIns` | 1 | 91440 | — |
| `bodyPr|compatLnSpc` | 1 | 0 | — |
| `bodyPr|forceAA` | 1 | 0 | — |
| `bodyPr|fromWordArt` | 1 | 0 | — |
| `bodyPr|horzOverflow` | 1 | overflow | — |
| `bodyPr|lIns` | 1 | 91440 | — |
| `bodyPr|numCol` | 1 | 1 | — |
| `bodyPr|rIns` | 1 | 91440 | — |
| `bodyPr|rot` | 1 | 0 | — |
| `bodyPr|rtlCol` | 1 | 0 | — |
| `bodyPr|spcCol` | 1 | 0 | — |
| `bodyPr|spcFirstLastPara` | 1 | 0 | — |
| `bodyPr|tIns` | 1 | 45720 | — |
| …共 314 条，完整清单见 `docs/fidelity-roundtrip.json` | | | |

### 值变（17）

名字在，但某个源值没写回去。比「掉了」更隐蔽——普查看着它在场，屏上也像那么回事。

| 对 | 源里出现 | 源值 | 写出值 |
|---|---:|---|---|
| `name|val` | 7 | text1, normal, report head, report | table grid, normal, plain, report |
| `docPr|id` | 5 | 7, 8, 9, 11 | 7, 8, 1, 11 |
| `docPr|name` | 5 | 图片 1, 浮动图, 形状 1, 图形余量 | 图片 1, 浮动图, , 图形余量 |
| `gridCol|w` | 4 | 5000, 2500 | 4995, 2505 |
| `ind|left` | 3 | 420, 0 | 420, 720, 1440, 2160 |
| `bookmarkEnd|id` | 2 | 7, 9 | 1 |
| `bookmarkStart|id` | 2 | 7, 9 | 1 |
| `ind|right` | 2 | 210, 0 | 210 |
| `lvlJc|val` | 2 | left, center | left, start |
| `abstractNum|abstractNumId` | 1 | 0 | 1, 2, 3 |
| `abstractNumId|val` | 1 | 0 | 1, 3 |
| `color|val` | 1 | ff0000 | adbbd4 |
| `cols|equalWidth` | 1 | 0 | 1 |
| `ins|id` | 1 | 7 | 1 |
| `numId|val` | 1 | 1 | 2 |
| `startOverride|val` | 1 | 3 | 1 |
| `tcW|w` | 1 | 5000 | 4995, 2505 |

### 缺件（0）

承载它的部件整个没写出来。

（空）

### 保留（288）

这些是真的双向。列出来是为了让「保留」也可核对，而不是一个孤零零的百分比。

| 对 | 源里出现 | 源值 | 写出值 |
|---|---:|---|---|
| `style|styleId` | 6 | normal, reporthead, report, reportchar | tablegrid, normal, plain, report |
| `style|type` | 6 | paragraph, character, table | table, paragraph, character |
| `extent|cx` | 5 | 914400 | 914400, 1266825, 3048000 |
| `extent|cy` | 5 | 914400 | 914400, 638175, 2286000 |
| `top|color` | 5 | ff0000, 4472c4, 336699, 000000 | ff0000, 4472c4, auto, 336699 |
| `top|sz` | 5 | 8, 4 | 8, 4 |
| `top|val` | 5 | single | single |
| `basedOn|val` | 4 | normal, tablenormal | tablenormal, normal |
| `tab|pos` | 4 | 720, 2880, 5760 | 720, 2880, 5760, 0 |
| `tab|val` | 4 | left, center, right, clear | left, center, right, clear |
| `top|space` | 4 | 1, 0, 2 | 1, 0, 2 |
| `blip|embed` | 3 | rid# | rid# |
| `cNvPr|id` | 3 | 3, 4, 11 | 3, 4, 0, 11 |
| `cNvPr|name` | 3 | cnv 名, 浮动图, 图形余量 | cnv 名, 浮动图, , 图形余量 |
| `left|color` | 3 | 00ff00, auto, 000000 | 00ff00, auto, 000000, adbbd4 |
| `left|space` | 3 | 2, 0 | 2, 0, 3 |
| `left|sz` | 3 | 4 | 4 |
| `left|val` | 3 | dotted, dashed, single | dotted, single, dashed |
| `picLocks|noChangeAspect` | 3 | 0, 1 | 0, 1 |
| `spacing|after` | 3 | 240, 0, 120 | 240, 0, 120 |
| `b|val` | 2 | 0, 1 | 0, 1 |
| `between|color` | 2 | ff9900 | ff9900 |
| `between|space` | 2 | 2 | 2 |
| `between|sz` | 2 | 6 | 6 |
| …共 288 条，完整清单见 `docs/fidelity-roundtrip.json` | | | |

## 边界

- **只有一份输入。** 输入是内置夹具（`scripts/lib/fixture.mjs`），与 `--selftest` 断言
  用的同一份。它的长处在「每枚属性都是人手放的」（所以每一条差异都可追），短处是
  「覆盖面就是这份夹具的覆盖面」——它不代表真实语料的长尾。
- **HTML → PM 用的是产品真 schema**（`src/lib/doc-schema.ts`，编辑器与量具共用的那一份），
  DOM 由 linkedom 提供（仅量具依赖）。换 schema 就换答案，所以 schema 必须是同一份。
- **不判对错，只判「回不回得来」。** 值变那一档里，有些是写手刻意规范化（单位换算、
  等价写法），有些是真丢。裁哪一条得逐对看，账本不替人裁决。
- 写出包里额外出现的对（写手自己按模型造的、源里没有的）不进表：那份差异属于
  「写多了」，与这份账问的「读到的丢了没」是两件事。

确定性：输入固定、遍历有序、无时间戳进正文，同一 rev 复跑逐字节相同（md5 见下）。
