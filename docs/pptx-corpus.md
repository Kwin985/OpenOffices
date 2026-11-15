# pptx 保真账 · 多输入对照

> 复跑：`pnpm exec vite-node scripts/pptx-corpus.mjs`（内置生成夹具）；
> 外部真件加 `--corpus <目录> --out <md>`。语料由**产品自己的导出链**
> （`deckToPptxBytes`）生成，落在 `tmp/`、不入库；不是手工拼的 XML，也不是真件。
> 报告只写文件名，不写路径与日期。

## 口径

- 每份 pptx 独立跑一遍 `fidelity-report-pptx.mjs`，量具、注入点（`ga`）与主账本同源。
- 分母是**这一份件里读手真吃进去的部件**（theme1 / slideMaster1 / slides / notesSlides）
  全树普查出来的「元素|属性」对；分子是读手按名查问过的对。
- **各份分母不同，单份百分比之间、以及与 `--selftest` 主账本 70.1% 都不可直接比较**；
  合计只是分子/分母分别求和的规模描述，不是统一口径覆盖率。
- 合计与逐份都用 **distinct 对**（`meaningfulPairs` / `consultedPairs`）；
  stdout 里的「已查问」是字面次数，混用会算出 >100% 的荒唐数。
- 这里量的是「读手查问过多少」，与 docx 往返账的「写回去多少」不是同一件事。
- **18% 上下不能读成「读手退化」**：`--selftest` 的手写夹具只放了读手关心的
  属性，所以 70.1%；产品导出链写出的 pptx 带大量默认 / 打包级属性
  （`a:` 细节、样式默认、命名空间声明），它们同样进全树分母，读手不查问是
  设计如此。两数之差量的是**分母口径**，不是读手能力。

## 汇总

| | 值 |
|---|---:|
| 输入份数 | 6 |
| 跑成 / 跳过 | 6 / 0 |
| 合计分母对 | 1100 |
| 合计查问对（distinct） | 203 |
| 按对覆盖率（合计口径） | 18.5% |
| 单份按对中位数 | 18.7% |
| 最低 / 最高 | 05-dark-master.pptx 17.3% / 06-mixed.pptx 19.7% |
| 用时 | 46.0s |

## 逐份

| 文件 | 分母对 | 字面 | 查问对 | 按对 | 按字面 |
|---|---:|---:|---:|---:|---:|
| 01-title.pptx | 172 | 738 | 30 | **17.4%** | 14.8% |
| 02-bullets.pptx | 198 | 1433 | 37 | **18.7%** | 24.6% |
| 03-shapes.pptx | 175 | 762 | 34 | **19.4%** | 16.7% |
| 04-image.pptx | 179 | 759 | 32 | **17.9%** | 16.9% |
| 05-dark-master.pptx | 173 | 857 | 30 | **17.3%** | 19.7% |
| 06-mixed.pptx | 203 | 1161 | 40 | **19.7%** | 24.5% |

## 反复没被查问的对（172 枚）

| 对 | 没查问的份数 | 被查问过的份数 |
|---|---:|---:|
| `alpha|val` | 6 | 0 |
| `bodyPr|rtlCol` | 6 | 0 |
| `buChar|char` | 6 | 0 |
| `buFont|charset` | 6 | 0 |
| `buFont|pitchFamily` | 6 | 0 |
| `buFont|typeface` | 6 | 0 |
| `chExt|cx` | 6 | 0 |
| `chExt|cy` | 6 | 0 |
| `chOff|x` | 6 | 0 |
| `chOff|y` | 6 | 0 |
| `clrScheme|name` | 6 | 0 |
| `creationId|val` | 6 | 0 |
| `cs|typeface` | 6 | 0 |
| `cSld|name` | 6 | 0 |
| `defRPr|kern` | 6 | 0 |
| `defRPr|lang` | 6 | 0 |
| `defRPr|sz` | 6 | 0 |
| `ea|typeface` | 6 | 0 |
| `endParaRPr|dirty` | 6 | 0 |
| `endParaRPr|lang` | 6 | 0 |
| `endParaRPr|sz` | 6 | 0 |
| `ext|uri` | 6 | 0 |
| `fld|id` | 6 | 0 |
| `fld|type` | 6 | 0 |
| `fmtScheme|name` | 6 | 0 |
| `font|script` | 6 | 0 |
| `font|typeface` | 6 | 0 |
| `fontScheme|name` | 6 | 0 |
| `gradFill|rotWithShape` | 6 | 0 |
| `gs|pos` | 6 | 0 |
| …共 172 枚，只列前 30 | | |

同一枚在多份里都没被查问，才是「读手盲区」的候选；只在一份里出现，
更可能是那份件的形状特有属性，别拿去当长尾排序。

## 边界

- 这仍**不是真件语料**：源件全由产品导出链生成，读手不认的属性根本不会出现在源里；
  分母被产品自己的写手限定住了。真实 PowerPoint / WPS 件会带来更多属性族。
- 单件账本落在 `tmp/pptx-corpus-report/<文件名>/`，不覆盖 `docs/pptx-fidelity.*` 主账本。
- 主账本 70.1%（内置手写夹具，77 对）与此表不同源；v0.199 用 `stress.pptx`
  换过一次输入得 17.2%，本表是那次单件实测的铺开版。
