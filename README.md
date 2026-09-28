# OpenOffices — 开源办公套件

> 天下苦 WPS / Office 久矣。这是一个用 **Rust + Tauri 2** 构建、完全由开源内核驱动的本地办公套件，
> 目标是文档（Writer）、表格（Calc）、演示（Impress）三件套，数据全程不出本机。

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
- **范围限制**：ODS 读侧仍走 calamine 值通道（ODF 样式/合并暂不解析回 Univer，ODT 不含批注与目录域）；
  ODT 导出以应用自身能力子集为准，未覆盖脚注/锚定框架等
  （**v0.40 修订**：脚注/尾注这一档已经补上——ODF 1.2 内联写法导出、旧版 `text:note` 外壳也读得进，见 v0.40 一节）
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

## 发布工程（v0.17 · v0.21 CI 实测跑通）

- **一键发布流水线**：新增 `.github/workflows/release.yml`——推 `v*` tag（或手动 dispatch）触发
  windows-latest + ubuntu-22.04 矩阵；先跑 `cargo test --lib` + `tsc --noEmit` 门禁，再过
  `tauri-action` 打包出 GitHub Release（NSIS/MSI 与 deb/AppImage），Linux 侧顺带首次真实编译
  了 pdf.rs 的非 Windows cfg 分支；macOS 暂不入矩阵（无签名凭据，列入后续）
- **CI 端到端实测**（tag v0.21.0 三轮修正后跑通）：①双平台 Type check 红——`@tiptap/core`/
  `@tiptap/extensions` 被源码直接 import 却未声明为直接依赖，本机旧 node_modules 掩盖（本机绿≠CI绿，
  以 `pnpm install --frozen-lockfile` 干净安装为准）；②"假绿"——tag push 触发时 tauri-action 不
  自动推断标签，缺 `tagName` 输入会静默跳过上传（`No releaseId or tagName provided, skipping
  all uploads...`），显式传 `tagName`/`releaseName`/`releaseDraft: false` 后 Release 正常发布
  win（exe/msi）+ linux（deb/rpm/AppImage）五产物；③Linux 首跑编译一次通过（约 17 分钟）
- **Actions 分钟止血（2026-09-23）**：私有仓库每月仅 2000 分钟，本周期已用 1833，几乎全被
  Release CI 吃掉（Windows runner 按 2× 计、占约 3/4）。`release.yml` 改为：推 `v*` tag 只打
  Linux，Windows 与 `cargo test` 挪到 `workflow_dispatch` 手动勾选（`build_windows` / `run_tests`），
  正常发版不再自动跑测试；apt 依赖加 `actions/cache` + `--no-install-recommends`；两条 job 各设
  `timeout-minutes` 兜底。Windows 包改由本机 `pnpm tauri build` 产出后按需上传，或发版时手动触发一次
- **本机产物链路**：`pnpm tauri build` 全量走通——release+lto 首编 4m54s，产物 NSIS 8.5MB /
  MSI 9.5MB；NSIS 静默安装→`%LOCALAPPDATA%\OpenOffices` 用户级免管理员→注册表 `.ods/.xlsx/
  .opd` 等 ProgId 与 `"%1"` 打开命令齐备→带文件参数启动真实出标签→静默卸载清理干净
- **修 MSI 打包阻塞 bug**：fileAssociations 的中文 `description` 会让 WiX light.exe 在
  en-US 代码页 1252 下报 LGHT0311（每个扩展名一条），关联描述须用 ASCII
- **修「点 X 无法退出」bug**（用户实报）：Tauri v2 关闭链路在 JS 确认后调 `plugin:window|destroy`，
  capabilities 缺 `core:window:allow-destroy` 时 ACL 拒绝、窗口静默卡死；dev 期全用强杀故未暴露。
  同期修正异步确认框时序：`preventDefault()` 必须同步调用、用户同意后再自行 `destroy()`，
  否则"未保存确认"形同虚设
- **后续发布项**：自动更新通道（v0.45 已出**检测层**：本机签名的清单 + 提示 + 跳下载页；应用内下载安装
  仍待真实更新源托管决策）、macOS 打包

## 表格保真补全（v0.18）

- **xlsx 读侧样式扩展**：`styles.xml` 直解器升级为 StyleBook（fonts/fills/borders/cellXfs/numFmts
  五段联动，`<xf>` 的 Start+子元素 alignment 两种形态都吃），边框四边线型+颜色、水平/垂直对齐、
  自动换行、数字格式 pattern 全读回；写侧 rust_xlsxwriter Format 对齐双设（`FormatAlign` 水平/垂直
  两次 `set_align` 互不覆盖）+ 逐边边框 + `set_num_format`；numFmt 覆盖 builtin id 表
  （`0%`/`0.00%`/`#,##0.00`/`@` 等）与自定义段（日期 id 跳过——calamine 已把日期字符串化）
- **ODS 读侧样式/合并**：`ods.rs` 新增 `read_ods_styles` 直解 content.xml 的 automatic-styles +
  表格遍历——单元格边框 `0.5pt solid #hex` 按关键字/宽度带映射回线型（hair<0.2pt、thin≤1.0、
  medium≤2.0、thick 以上，LibreOffice 的 0.26pt thin 可原样读回）、字色/底色/对齐/换行，
  以及 `number-columns-repeated`/`covered-table-cell`/`number-*-spanned` 合并语义；
  `read_xlsx` 命令按扩展名分流两套直解器，calamine 继续只负责值
- **前端全链路接入**：`CellStyle` 载荷扩 `bd/ho/vo/wb/nf` 五字段；`univer-io` 与 Univer 快照双向桥
  （BorderStyleTypes 1~13 ↔ 线型名、对齐枚举换算——Univer 的 RIGHT=3 并非 xlsx 顺序）；
  `sheet-print` 打印网格消费新字段：逐边 border CSS、水平/垂直对齐、换行、数字格式实排
  （`@` 透传、`%` 乘百后缀、小数位/千分位），导出 PDF 的表格自此带上边框/对齐/格式化数字
- **验证**：cargo 22 测全过（新增 xlsx 边框/对齐/数字格式往返、ODF 边框宽度映射、ODS 样式合并
  经真实 `read_xlsx` 拼合读回等 4 项）+ Node 打印纯函数 15 断言 + CDP 14 断言全链路
  （夹具文件 → Rust 读样式 → payload → Univer 快照 → 换回 payload → 打印 HTML）全绿

## 表格保真二期：列宽/行高/字体族（v0.19）

- **尺寸像素主线**：`SheetPayload` 新增 `colWidths/rowHeights`（列/行号 → 像素，与 Univer 快照
  同单位）；xlsx 读侧 `<col width>` 按 Excel 口径 `round(chars*7+5)`（MDW=7 + 5px 内边距）换算、
  `<row ht>` 按 `round(pt*4/3)`；`<col>` 的 min/max 区间展开到每列（单区段钳 2048 列防炸）；
  写侧用 rust_xlsxwriter 像素级 API，列宽先扣 5px 补偿其序列化不扣边距的口径差，实现 ±0 精确往返
- **ODS 尺寸双向**：写侧新增 `co{n}/ro{n}` 维度样式（px→cm @96dpi），`table-column`/`table-row`
  按等宽 run 分组以 `number-columns-repeated` + `style:style-name` 引用；读侧直解
  `style:column-width`/`style:row-height`，长度单位 cm/mm/pt/in/pc/px 统一化回像素，
  与既有 automatic-styles 遍历共用列序推进
- **字体族 ff**：`CellStyle` 新增 `ff`；xlsx StyleBook 补读 `<font><name val>` 且写侧
  `Format::set_font_name`；ODS 写 `style:font-name` + `fo:font-family` 双属性、读侧二者取一；
  默认字族名（Calibri/等线）如 fs≠11 一样在两侧过滤掉减噪
- **前端桥接**：`payloadToWorkbook` 把尺寸写进 Univer `columnData.w`/`rowData.h`（并把尺寸行列入
  行列数扩展）；`workbookToPayload` 反读，自适应行高（`ia=1`）取实际渲染值 `ah`；样式去重键与
  Univer `ff` 字段打通；`sheet-print` 逐列生成 `colgroup`、逐行 `<tr style="height:…">`、
  单元格 `font-family`（字族名先剥 CSS 非法字符），导出 PDF 的表格从此有真实版式与字体
- **验证**：cargo 25 测全过（新增 xlsx 尺寸/字族往返、ODS 尺寸/字族读回、`odf_len_to_px` 单位换算
  3 项）+ CDP 15 断言全绿（xlsx 与 ods 双夹具 → Rust 读 → Univer 快照桥 → 保存回传 → 打印 HTML）

## 表格保真三期：隐藏行列 + 冻结窗格（v0.20）

- **载荷扩展**：`SheetPayload` 新增 `hiddenRows/hiddenCols`（0 基索引数组）与 `freeze`
  （顶部冻结行数 + 左侧冻结列数）；`read_xlsx` 合并侧统一带出，xlsx/ODS 共用同一通道
- **xlsx 双向**：读侧 `<col hidden="1">`/`<row hidden="1">`（隐藏优先于宽度解析）与
  `<pane xSplit ySplit state="frozen">`（仅认 frozen，split 滚动条不算）；写侧
  `set_row_hidden`/`set_column_hidden`/`set_freeze_panes`，±0 往返
- **ODS 双向**：隐藏行列注册进既有 `co{n}/ro{n}` 维度样式表——`style:visibility="collapse"`
  与宽度/高度可共存（复合键 `{px}|1`）、纯隐藏走哨兵键 `h|1`；读侧按样式名集合展开
  `number-columns/rows-repeated` 区间；冻结窗格按 LibreOffice 惯例写进 styles.xml 的
  `office:settings → ViewSettings/Tables` 每表一条 map-entry（Columns/Rows/IsFrozen），
  读侧按表序索引回填
- **前端桥接**：`payloadToWorkbook` 把隐藏写进 Univer `columnData.hd`/`rowData.hd=1`（与
  `w`/`h` 共存合并）、冻结写 `freeze {xSplit/ySplit/startRow/startColumn}`；
  `workbookToPayload` 反读同三通道；`sheet-print` 整行整列剔除隐藏格（合并区跨隐藏列的
  colspan 按近似保留），导出 PDF 与屏显一致
- **验证**：cargo 27 测全过（新增 xlsx 隐藏/冻结往返、ODS 隐藏/冻结经 settings.xml 往返）+
  CDP 17 断言全绿（合成载荷 → write_xlsx/write_ods → read_xlsx 读回 → Univer 快照桥 →
  换回 payload → 打印 HTML 行列计数）

## 表格保真四期：公式往返（v0.21）

- **载荷扩展**：`CellPayload` 的 `f`（带 `=` 前缀的 A1 式）从"存了但落盘即丢"升级为全链路
  字段；`v` 兼任公式缓存值，calamine 不算式重开也不丢数
- **xlsx 双向**：读侧直解 `<c><f>…</f><v>…</v></c>`——quick-xml 0.42 会把 `&lt;` 实体拆成
  独立 `GeneralRef` 事件，需重建 `&name;` 再整体 unescape（否则 `=IF(A1<A2,…)` 的 `<` 静默
  丢失）；shared 从格空 `<f/>` 跳过，无缓存值公式格按公式表补回；写侧
  `Formula::set_result` 把缓存值随 `<v>` 落盘，Excel/WPS 打开即显示不重算
- **ODS 双向**：写侧 `table:formula="of:=…"` 属性 + 缓存 `office:value`，A1 区间换算成
  `[.A1:.B2]`、参数逗号转分号（字符串字面量内不换算）；读侧逆运算回 A1 式，跨表引用取
  最小支持面（简名直映、带空格表名加引号）
- **前端零改动**：`univer-io` 双向本来就透传 `f`（快照 `cellData.f` 与载荷约定一致），
  Univer 公式引擎重算覆盖缓存；`sheet-print` 打印缓存值，导出不受影响
- **验证**：cargo 30 测全过（新增 xlsx 公式含 `<` 转义往返、ODF 语法双向换算、ODS 公式
  往返）+ CDP 11 断言全绿（桥双向、xlsx/ODS 落盘读回、比较式/区间式、缓存值、打印）

## PDF 查看交互：滚轮翻页 + Ctrl 缩放（v0.22）

> 本节描述 v0.22 当时行为；滚轮翻页已被 v0.25 连续滚动取代，普通滚轮交还原生滚动。

- **滚轮翻页**：`PdfViewer` 查看区挂原生非被动 `wheel` 监听（React `onWheel` 是 passive，
  无法 `preventDefault`）——页面无溢出时滚轮直接翻页；放大溢出时先走原生滚动，滚到页底
  继续下滚才翻下一页、回页顶继续上滚翻上一页（同浏览器 PDF 查看器的滚动链接习惯）
- **防误触**：`deltaY` 累计过阈值（140px）才翻一格、翻后 350ms 冷却吞掉惯性余量，
  方向反转清零累计；翻页/回顶后 `scrollTop` 归零
- **Ctrl+滚轮缩放**：以 1.1× 步进在 50%~300% 区间缩放，与工具栏按钮共用同一 clamp
- **验证**：tsc/build 全绿；CDP 冒烟 10 断言全过——合成 3 页空白 PDF 开标签，派发
  `WheelEvent` 验证触底翻页、单格不足阈值不翻、未触边不翻、触顶回翻、首页钳制、
  冷却吞连翻、Ctrl 缩放复原、0.5 倍不溢出时直接翻页

## PDF 文字选择复制（v0.23）

- **文字层叠加**：canvas 渲染完成后挂 pdf.js `TextLayer`——透明字形盖在页面上，拖选、
  双击选词、Ctrl+C 复制全走浏览器原生选择，零新增权限；滚轮翻页与文字层互不干扰
- **随翻页/缩放重建**：`streamTextContent()` 流式建层，切页与缩放时 cancel 旧层并重建，
  层尺寸跟随 scale
- **坑：`--scale-factor`**：v4 文字层容器的内联尺寸写作
  `round(down, var(--scale-factor)×页宽, …)`，该变量由官方 viewer 负责设置；宿主不设
  则层塌成 0×0，span 虽在 DOM 但被 overflow 裁剪、肉眼不可选
- **验证**：CDP 冒烟 7 断言全绿（合成 3 页带文字 PDF：文字层内容与逐页重建、程序化
  选择取字、缩放后层与画布对齐、滚轮不被吞）；tsc/build 绿，Rust 零改动

## PDF 全文搜索（v0.24）

- **搜索链路**：`getTextContent()` 按页惰性建文本索引（items 拼接串 + 项起点表，缓存于
  Map），查询小写化全页扫命中（上限 500 防大文档卡死），全局偏移换算回（项下标, 项内
  偏移）定位到文字层 span 区间；Enter/Shift+Enter 或 ▲▼ 循环上下跳转，自动换页
- **高亮零侵入**：用 CSS Custom Highlight API（`::highlight()` + Range）上色，不复制
  DOM 不改文字层布局；活动命中单独一色并 `scrollIntoView` 居中；翻页/缩放重建文字层后
  在 render 完成回调里重挂高亮
- **交互**：Ctrl+F 打开搜索条并聚焦、Esc 关闭清空、🔍 按钮开关、计数 `x/y` 与"无匹配"
  提示；组件只在 PDF 标签挂载，不劫持其它编辑器的 Ctrl+F
- **验证**：CDP 冒烟 11 断言全绿（'page' 三页全命中、跳页后高亮重挂、上下循环导航、
  大小写不敏感、无匹配 UI、Esc 清空、v0.23 选择功能回归）；tsc/build 绿，Rust 零改动

## PDF 连续多页视图（v0.25）

- **连续滚动**：单页画布改为全页占位列（`flex column + gap`，每页 `data-page` 容器按页
  元数据尺寸给内联宽高）——滚动条长度一开始就正确；尺寸由后台逐页 `getPage` 预取补齐，
  未到达前用首页/595×842 估算兜底
- **视口虚拟渲染**：`IntersectionObserver`（root=滚动区，`rootMargin` 上下 800px 预渲染
  余量）进入即渲染 canvas+文字层、离开即 cancel 任务/清画布释放内存，回视口再重渲染；
  每页槽位记 `rendering/done/cancelled` 去重，防观察者重复触发双渲染
- **缩放重绘**：scale 变化时占位宽高随 inline style 重算，可见页先 free 再按新比例重画
  （否则 done 槽位会被跳过留下旧尺寸）；普通滚轮交还原生滚动（撤 v0.22 翻页劫持），
  仅 Ctrl+滚轮 `preventDefault` 缩放
- **页码与导航**：当前页=顶边进入视口的最后一页（scroll+rAF，文档序早断）；◀▶/页码输入
  改 `scrollIntoView` 跳页；全文搜索命中跳页后高亮重挂照旧，多页同屏时基础高亮可一次
  挂多个命中区间
- **验证**：CDP 冒烟 30 页夹具 12 断言全绿（前 3 页带文字后 27 页空白：占位数、初始仅
  渲染近旁页、滚到底页 30 渲染且页 1 画布归零、回顶重渲染、搜索跳页 3 活动区间命中、
  'page' 三命中 Enter 落页 2 且 3 区间同挂、Ctrl 缩放文字层宽=canvas CSS 宽±2px、
  中部页码跟踪、v0.23 选择回归）；tsc/build 绿，Rust 零改动

## 性能专项轮（v0.26）

- **PDF 位图 LRU 缓存**：每页栅格化完成后把画布快照进离屏 canvas 缓存（上限 8 页，
  插入序即 LRU）；滚回视口不再走 `p.render()`，同 scale/dpr 命中直接 `drawImage` 贴回
  （文字层绑定 DOM 仍需重建）；scale/dpr 不符视为未命中重栅格，天然防错尺寸复用；
  换文档清空。冒烟以计数器实证：来回滚动 `full` 不变、`hit` +2
- **尺寸预取批量化**：全页 `getPage` 取尺寸改为每 8 页合并一次 `setSizes`——逐页刷新
  会让全部占位随每一页到达重渲染一次（30 页 = 30 轮全列表 re-render），批量后降到 4 轮
- **空闲预热编辑器 chunk**：Workspace 挂载后 `requestIdleCallback` 逐个动态 import
  PdfViewer/DocEditor/PptEditor/SheetEditor（与 `lazy()` 共享同一模块 promise），并预热
  Univer 公式 worker（`new Worker` 后台线程 fetch+编译，2s 后回收，脚本留在 HTTP/代码
  缓存）；表格 6.2MB 主 chunk 与 7.4MB worker 脚本的加载成本从点击路径移到空闲期
  （**v0.35 修订**：预热上移到 `App` 并补上此前漏在点击路径上的外壳 chunk；worker 预热经发布包
  实测对首开耗时零收益，已删——见「大 PDF 分段读取 · 首开提速（v0.35）」。
  **v0.36 修订**：worker 预热与线程池再度 A/B 复核仍无收益，池子一并删除；挂载侧不再用 `lazy()`，
  改为自持已解析组件——见「首开那 300ms 的元凶：挂载不再走 Suspense（v0.36）」）
- **盘点结论**（不改代码）：标签切换本就是 `display:none` 保持挂载零重挂成本；首屏入口
  仅 247KB；vchart（2MB）与 Univer 各 locale 数据表（hu/nb/nn 300+KB）都已是按需动态
  chunk；`univer-worker` 7.46MB 为公式计算引擎必要成本，保留
- **验证**：CDP 冒烟 9 断言全绿（缓存命中免重栅格、LRU 上限、缩放换血重渲染、空闲预热
  五步全达、跨页搜索/选择复制回归）；tsc/build 绿，Rust 零改动

## PDF 缩略图 + 大纲侧栏（v0.27）

- **侧栏骨架**：工具栏 ☰ 开合 180px 侧栏，"缩略图/大纲"双页签；侧栏与主滚动区包进
  `.pdf-body` flex 行，收起时零开销
- **缩略图虚拟渲染**：每页固定 120px 宽独立小画布，独立于主视图的 IntersectionObserver
  调度（rootMargin 400px 进视口即画、离开即 cancel+清零）；侧栏收起/切页签时 DOM 重挂，
  槽位表整体清空重建；点缩略图 = 主视图 `scrollIntoView` 跳页，当前页缩略图描边高亮并
  `scrollIntoView({block:'nearest'})` 跟随视口
- **大纲（书签）解析**：`doc.getOutline()` 树递归拍平为（标题, 目标页, 层级）；pdf.js v4
  无 `getDestinationPageNumber`，目标页手工解析——字符串 dest 先 `getDestination`，取
  `dest[0]` 页引用过 `getPageIndex` 换算 1 起页码，失败记 null（渲染为禁用的无目标项）；
  缩进按层级 `paddingLeft: 8 + depth*14`，点击跳页、当前页着色；无大纲文档显示占位提示
- **验证**：CDP 冒烟 11 断言全绿（30 页带 Outlines 夹具：☰ 开合、近旁 6 缩略图渲染远处
  不渲、画布宽=120、点缩略图跳页+active 跟随、大纲 2 条解析为页 1/3、点章节跳页、
  搜索/位图缓存/文字选择三项回归）；tsc/build 绿，Rust 零改动

## PDF 标注与高亮（v0.28）

- **标注模型 + 读侧导入**：`PdfAnno`（highlight/note，PDF pt 左上角坐标 rects[]，颜色
  #rrggbb，文本内容）；打开文档逐页 `getAnnotations({intent:'display'})` 导入已有
  Highlight/Text 注解——关键坑：pdf.js 注解文本在 `contentsObj.str` 而非 `contents`，
  读错字段会让所有内容往返为空；坐标 `y_pdf = 页高 − y_top − h` 换算
- **选区即标注**：文字层选区 mouseup 弹浮动菜单（4 色色板高亮 / 📝 便签 / ✕），
  行矩形按 `range.getClientRects()` 顶边取整合并再除 scale 转回 PDF pt；弹层
  `onMouseDown preventDefault` 保住原生选区；高亮覆盖层 CSS 绝对定位
  `mix-blend-mode:multiply` 半透明叠色，零栅格化侵入（位图缓存保持无标注）；
  pdf.js 侧 `annotationMode: 0` 关闭其内建注解绘制，可视化完全归我们这层
- **便签**：🗒 图标锚在最后矩形右侧 16×16，点击弹内联 textarea 编辑/删除
- **写回 PDF 文件**：`registerSaver` 协议接入 Ctrl+S——动态 `import('pdf-lib')`，
  **pdf-lib 1.17 无高级注解 API**（`addHighLightAnnotation` 只在未发布的 vNext），
  走低层 `context.obj({Type/Subtype/Rect/QuadPoints/C/Contents})` + `register` +
  `page.node.Annots().push(ref)`（无 Annots 数组先建）；保存前按 Subtype 清除旧的
  Highlight/Text 再全量重写（`PDFName.of` 驻名引用相等比较），重复存开不累积；
  文本 `PDFHexString.fromText` 写入；改动即 `markDirty`，存成清 dirty
- **侧栏第三页签"标注"**：列表（色点+页码+摘要）点击跳页、✕ 删除
- **验证**：CDP 冒烟 10 断言全绿（3 页夹具带预置高亮：导入呈现、选文字弹层、
  加高亮/便签、面板 3 条、Ctrl+S 清 dirty、重开内容/颜色/页码保真、再存再开不重复、
  搜索/缩略图/位图缓存回归）；tsc/build 绿，Rust 零改动

## PDF 标注编辑增强（v0.29）

- **标注编辑工具**：工具栏 T/✎ 双态切换——文字态维持选择复制原样；标注态下文字层
  `pointer-events:none` 让位、高亮覆盖层可点可拖，单击选中（描边），自有与第三方导入
  注解走同一 `PdfAnno` 模型、行为完全一致
- **选中编辑条**：注解上方浮出深色胶囊——4 色点改色、🗑 删除、便签多一颗 🗒 开合内容卡；
  Delete/Backspace 直删选中项，Esc 或 ✕ 取消选中；点空白处也取消
- **拖移**：pointerdown 记录原 rects 快照，位移超 3px 阈值才算拖（否则视作点击），
  全程按原始快照 + 增量 `px/scale` 换算 PDF pt 平移，缩放/滚动下无累计误差；改动即 dirty
- **侧栏联动**：标注列表点击 = 跳页 + 切标注工具 + 选中（当前项描边底色），
  与画布上选中态双向同步
- **Acrobat 视觉**：选区菜单与编辑条统一为深色圆角胶囊（`border-radius:999px`）、
  色点改圆形白描边（选中色外圈高亮）、便签弹卡改淡黄便签纸配色
- **验证**：CDP 冒烟 10 断言全绿（第三方预置高亮点选/改色+dirty/拖移 +50px=+40pt/
  面板联动/Delete 删除/文字态选字弹层回归/便签增改色/保存重开颜色内容保真且删掉的
  预置注解不再回来/胶囊与便签卡 computed style 断言/搜索回归）；tsc/build 绿，Rust 零改动

## 文档编辑增强（v0.30）

- **页面设置**：工具栏"页面设置"面板——纸张 A4/Letter/自定义宽高（mm）+ 四边距，
  实时驱动 `.doc-page` 宽高与内边距、打印 `@page` 规则动态注入，并写进 docx
  `sectPr`（pgSz/pgMar，twips；横版按"竖版宽高+orientation"语义传参避免库交换）与
  odt `page-layout`；导入从 docx/odt 还原（A4/Letter 就近归 presets，否则 custom）
- **分页参考线与页数**：页内绝对定位覆盖层 `repeating-linear-gradient` 按页高画灰线
  （`pointer-events:none` 零侵入），ResizeObserver 量文档高度 → 状态栏"约 N 页"
- **表格上下文工具条**：光标在表内浮出——前后插行/列、删行/列、合并拆分
  （`mergeOrSplit`）、表头行切换、删除表格；导出补 `colspan/rowspan` →
  docx `gridSpan/vMerge` 与 odt `covered-table-cell`
- **图片增强**：剪贴板粘贴图片直接转 base64 插入（`handlePaste`）；选中图片浮出工具条——
  宽度按版心 25/50/75/100%（按当前显示比例换算 height）、居中（display:block+auto margin
  自定义 align 属性）、恢复原尺寸；宽度随 docx ImageRun/odt draw:frame 导出往返
- **验证**：vite-node 结构测试 5 断言（custom/Letter/默认 A4/合并表/横版 docx 往返）+
  CDP 冒烟 10 断言全绿（面板开合、Letter 页宽 816 与参考线、左边距 10mm→38px、
  约 N 页增长、表格条插行、图片条 50%+居中、粘贴成图、重置回 A4、@page 规则、
  odt 浏览器内往返含页面设置/合并/图宽）；tsc/build 绿，Rust 零改动

## 文档查找替换 · 字体 · 自动保存（v0.31）

- **查找/替换面板**：Ctrl+F 在文档标签打开面板（与 PDF 搜索互不劫持）——整文档按文本块匹配，
  段内跨 mark 可命中、跨段不算；命中集存 ProseMirror 插件 state，装饰 `.fr-hit`/`.fr-active`
  上色，"当前项"由选区派生（上下按钮即把选区挪到下一/上一命中，越界回绕）；支持大小写开关、
  单个替换（`insertText` 保留 marks）与全部替换（自后向前替换避免位置漂移）
- **字体族 / 字号**：工具栏两颗下拉——字号以 pt 呈现、内部按 `pt*96/72` 存 px，字体族含中英
  常用族；走 TipTap `TextStyleKit`（Color/FontFamily/FontSize 共用 `textStyle` mark attrs），
  导出 docx 时字族进 `w:ascii/hAnsi`、字号半磅 ×1.5，odt 进自动样式 `style:font-name` +
  `fo:font-size`（pt = px×72/96），导入再反解回同一 mark，三属性（字族/字号/字色）同链路往返
- **会话内版本历史**：每 60 秒探测一次内容变化并推快照（与栈顶 JSON+meta 相同则跳过），
  手动保存与恢复前也各留一份；环形上限 20 份，「历史版本」面板按时间倒序列出，一键恢复
  （恢复前自动把当前状态入栈，不丢操作）
- **自动保存**：每 30 秒对已落盘的 `.odoc` 静默写回并清 dirty，工具栏显示「已自动保存 HH:MM:SS」；
  未命名文档与会话内 docx/odt 标签不参与（不擅自造文件）
- **坑**：TipTap v3 的 `useEditor` **不会因纯选区事务重渲染 React**，面板的命中计数与活动高亮
  必须订阅 `editor.on('selectionUpdate')` 自增 tick；`commands.focus()` 返回 Thenable，
  直接链式 `setTextSelection` 会 TypeError，要用 `editor.chain().focus().…`；关闭面板须同时清空
  输入框状态，否则重开时 UI 与插件命中脱节
- **验证**：vite-node 结构测试 8 断言（含「字符样式落在 content.xml 而非 styles.xml」定位、
  odt 导入合并回单 span）+ CDP 冒烟 17 断言全绿（重载起干净标签 → 面板开合、命中计数、
  大小写语义、上下导航回绕、替换与全部替换、无匹配提示、字族/字号写进 JSON、历史快照列表、
  恢复内容还原）；30s/60s 定时器由开发钩子直推快照代验；tsc/build 绿，Rust 零改动

## PDF 标注形状 · 首页模板（v0.32）

- **标注形状四类**：`PdfAnno.kind` 扩到 `rect / ellipse / line / ink`，几何统一塞进
  `polys: number[][][]`（line 一笔两点、ink 多笔），`rects[0]` 恒为包围盒——于是拖移、选中编辑条、
  侧栏「标注」列表、保存清理全部沿用 v0.29 通路零改动；工具栏 ✎ 态下多四颗绘制按钮
  （▭ ◯ ↗ ✏），页面按下起笔、拖出预览草稿、抬手成一条标注（ink 逐点采样），再点同颗或 Esc 退出
- **第三方导入**：`Square/Circle/Line/Ink` 四类注解读进同一模型（Line 缺 `L` 时按包围盒对角线兜底，
  Ink 多笔画逐条还原），颜色 0-255 数组 → `#rrggbb`
- **写回**：pdf-lib 走低层 `context.obj({Type:Annot, Subtype:Square|Circle|Line|Ink, Rect, L|InkList, Border})`
  + `register` + `Annots.push`；保存前清旧列表按 `Subtype` 全量重写，重复存开不累积；线尾箭头 `Head/Tail`
  与 Ink 的 `InkList` 折线数组都用 `context.obj([])` + `PDFNumber` 逐个 push 构造
- **渲染**：SVG 覆盖层按形状分支（`<rect>/<ellipse>/<line>+<polygon> 箭头/<polyline>`），每组外面套一层
  `stroke="transparent" strokeWidth=14` 的同形命中孪生体——细线也好点；命中权由
  `.pdf-page.anno-mode .pdf-anno-svg:not(.drawing) [data-anno] { pointer-events: auto }` 给
- **首页模板体系**：`lib/templates.ts` 注册 11 个模板（公文/会议纪要/周报 ×3、记账表/库存清单 ×2、
  六套演示配色 ×6），首页「从模板新建」画廊卡片一点即开标签；`Tab.template` 存 id，三个编辑器在
  **无路径**分支各自 seed（文档 `setContent` + meta、表格 payload→Univer 快照（含冻结表头/列宽/合计公式/金额格式）、
  演示 `useState` 惰性初值套主题），另存时文档用 `tab.title` 当默认文件名
- **查找命中上限**：`FR_HIT_CAP = 2000`，收集到 2001 即停并置 `truncated`，面板计数显示 `N+`，
  超长文档按文本块查找不再卡主线程
- **坑**：① pdf.js 把 Line 解析成 **扁平数组** `lineCoordinates=[x1,y1,x2,y2]`（不是 `line` 对象），
  Ink 是 `inkLists`（类数组，只能下标访问），读错字段整类注解静默全空；② 保存分支的 `else` 必须
  在 `else if (kind === 'note')` **之前**收敛，否则形状全被写成 Text 便签；③ CSS 里父级
  `pointer-events: none` 挡不住自己声明了取值的子元素，绘制态必须靠 `.drawing` 类把子组重新关掉；
  ④ pdf-lib 不导出 `PDFHexColor`（颜色用 0-1 三分量 `PDFArray`），本构建也无 `PDFArray.withOutDeltas`；
  ⑤ 页面 HTML 分支只特判 `highlight` 会让四种形状各多渲染一个 🗒 锚点（点选/拖移全打到错节点），
  必须显式 `note` 分支 + 形状 `null`；⑥ 模板里用 `cells[11].f = …` 按下标补公式极易数错位
  （合计文字与 `=SUM(D2:D3)` 挤进同一格），改为 `cell(r,c,v,style,f)` 构造期落值；
  ⑦ Univer facade 的 worksheet 实名 `getSheetName()`（无 `getName()`），冒烟改读
  `getActiveWorkbook().save()` 快照断言最稳；⑧ CDP 冒烟 `location.reload()` 后旧执行上下文仍可能
  答出 `.home`，须等 `Page.loadEventFired` 再判定就绪
- **验证**：vite-node 结构测试 28 断言（模板注册表、doc/sheet/ppt 三类 seed、公式落位、
  命中上限截断语义）+ CDP 冒烟 19 断言全绿（模板卡片→三编辑器注入、四形状导入几何与 Ink 双笔、
  页 1 拖拽画矩形落位、页 2 画线、点选+拖移 +50px、编辑条改色、Ctrl+S 写回清 dirty、
  重开 6 形状不累积且颜色保真、Delete 删除、🗒 锚点仅 Text 注解渲染）；tsc/build 绿，Rust 零改动

## 文档分页保真：页码域 · 多栏 · 分页符 · 打印边距（v0.33）

- **页眉/页脚/页码改走 CSS `@page` margin box**：`oo-page-rule` 注入的样式在 `@page` 内挂
  `@top-center` / `@bottom-center`，Chromium 逐页重绘，导出的 PDF **每一页**都有页眉页脚与正确页码
  （屏幕侧仍是流内那两份，只做占位预览）
- **页码四格式**：`1` / `第 1 页` / `- 1 -` / `1 / 3`（含总页数），`pageNumberParts()` 一处定义、
  三处消费——屏幕占位、打印 `counter(page)`/`counter(pages)`、导出 docx `PAGE`/`NUMPAGES` 域与
  ODF `<text:page-number>`/`<text:page-count>`；导入侧 `detectPageFormat()` 从页脚原文反推格式，
  默认 `cn` 保持与 v0.30~v0.32 存量文档兼容
- **多栏排版**：`PageSetup.cols`（1~4）+ `colGap`，屏幕用 `column-count`/`column-fill: auto` 容器包住正文、
  打印自然分栏，导出写 docx `sectPr/w:cols w:num w:space`（单栏故意不写 `w:cols`）与 ODF
  `style:page-layout/style:columns`（`fo:column-count` + `fo:column-gap`），导入双向读回
- **分页符**：新增 `pageBreak` 原子块节点（`Ctrl+Enter` 或工具栏「分页符」），屏幕画虚线 + 「分页符」胶囊，
  打印 `break-after: page` 真正另起一页，导出映射 docx `<w:br w:type="page"/>` 与 ODF
  段落样式 `fo:break-before="page"`（导入按样式名 `PBK` 或 `break-before` 还原）
- **纸张与四边距贯穿 PrintToPdf**：`export_pdf` 的 `margins` 升级为 `(top,right,bottom,left)` 英寸四元组、
  `page` 为宽高英寸，前端按 `resolvePage()` 的 mm→英寸传参——打印不再吃 WebView2 的默认 0.5/0.5/0.6/0.6 边距；
  `@media print` 里 `.doc-page` 的 `width/padding/min-height` 改 `!important`，否则 React 内联版心样式压过打印规则，
  页面自身 padding 与 PrintSettings 边距叠成双份
- **分页控制**：打印样式补 `break-after: avoid`（标题不与正文分离）、`break-inside: avoid`
  （表格/图片/代码块/引用/目录不跨页折断）、`orphans/widows: 2`
- **坑**：① `@page` margin box 的 `content` 只吃**空格串接**片段，写成 `"a" + counter(page)` 会让整条声明
  静默失效（页眉有、页脚整块消失）；② PrintToPdf 忽略 CSS `@page` 的 `size`/`margin`，纸张与边距必须由 Rust
  侧 `PrintSettings` 决定，CSS 那份只服务浏览器打印；③ pdf.js 读回中文「页」可能归一成部首字符 `⻚`，
  断言按数字松匹配；④ pdf.js 文本项 `y` 是**基线**，首行距页顶要再加字体 ascent 才等于边距，
  冒烟改用「同内容只差上边距 20mm → 基线下移 56.7pt」的差分断言才稳
- **验证**：vite-node 结构测试 17 断言（页码格式 parts/detect 双向、docx `w:cols`+PAGE/NUMPAGES+page break、
  ODF `style:columns`+页码域+`fo:break-before`、单栏不写 columns）+ CDP 真机冒烟 25 断言全绿
  （margin box 逐页页眉页脚且落在边距带内、`1 / 3` 页码、两分页符恰好 3 页且内容分属正确、
  A4 595×842pt 与 Letter 612×792pt、左缘精确到 62pt、上边距差分 56.7pt、双栏 x 两簇、清空后无 margin box）；
  `cargo test --lib` 30 通过、tsc/build 绿

## CSV 往返 · PDF 页面管理 · 性能包（v0.34）

- **CSV 全链路补齐**：calamine 不读 CSV，故读侧按扩展名分流到 `src-tauri/src/csv.rs` 的逐字符状态机
  （RFC4180：双引号包裹、`""` 转义、字段内可含逗号与换行；分隔符在 `,` `;` 制表符 三者按首行出现次数嗅探，
  欧洲导出的分号 CSV 直接能开）；解码先试 UTF-8、失败退 **GBK**（中文 Excel 另存的 CSV 常是 GBK），
  写回带 **UTF-8 BOM** + CRLF 行尾；值一律按文本落，`007` 不会被吞成 `7`；工作表名取文件主名。
  `write_csv` 成为第三个表格保存命令，`.xlsx`/`.ods`/`.csv` 三分流，存 CSV 时提示「只含首个工作表，样式与图表不保留」
- **PDF 页面管理**：侧栏新增「页面」工作区——每页一行缩略信息 + 勾选多选，页码写法 `1-3,5` 可直接输入套用；
  六个操作 ⟲ 左转 / ⟳ 右转（90° 步进）/ 删除页 / 提取为新 PDF / 合并其他 PDF / 拆分为单页，
  全部走 pdf-lib 覆盖写回（未选中页时对当前页生效）；删空被拒（PDF 至少要有一页），
  不允许把文件合并进自己；做完自动重载并**停在操作前那一页**
- **标注跟随页面操作**：页操作写盘前先把内存标注落进文件，操作后重载、标注从 `/Annots` 重新导入——
  不用自己维护页序映射表，删页/换序天然正确。旋转另有一处真问题：内存存的是**显示空间**（已套旋转、左上原点），
  而 `/Rect` 是**未旋转 + 左下原点**，故 `lib/pdf-geo.ts` 按该页 `/Rotate` 做精确可逆换算
  （`mapPoint`/`unmapPoint` 四个角度各一分支，`toDisplayRect`/`fromDisplayRect`/`toDisplayPoints`/`fromDisplayPoints`），
  旋转过的页上高亮与形状不再整体偏移
- **性能包**：`read_xlsx`/`write_xlsx`/`write_ods`/`write_csv` 升为 async 命令 + `spawn_blocking`
  （原来同步命令跑在主线程，解析大表时整个窗口冻结），IPC 名保持不变；xlsx 读侧先用
  `has_charts()` 只嗅探 zip 文件名，**图表专用的那份全表网格克隆**与 `read_xlsx_charts` 都只在簿子真含图表时才做；
  PDF 位图缓存除条数上限外补**像素预算**（`BITMAP_CACHE_PX`）并在 scale/设备像素比变化时清陈旧条目
  （A4 × 3 倍 × dpr 2 单页就几十 MB）；文档状态栏字数/字符改 400ms 后缘节流，逐键不再全文遍历
- **坑**：① TipTap v3 的 `useEditor` 是异步建实例的，挂载 effect 里直接取 `editor.storage.characterCount`
  拿到 `undefined` 就抛，React 会把**整棵树**卸掉（首页/工作区全白）——冒烟抓到并修：先订阅、`create` 事件补算、
  取不到就跳过；② pdf-lib 删页必须**倒序**删，正序会让后续索引整体前移而错位；③ 高亮写回的 `/Rect`
  要的是**角点对** `[x0,y0,x1,y1]`，写成 `[x,y,w,h]` 时 pdf.js 不报错、只是读回位置全歪（本轮实测撞出）；
  ④ pdf.js 会**静默丢弃**没有 `/QuadPoints`（或与 `/Rect` 不匹配）的 Highlight 注解，测试夹具少写这一项时表现为「注解导入永远 0 条」
- **验证**：`cargo test --lib` 36 通过（CSV 状态机/引号转义/分隔符嗅探/GBK 回退/BOM 往返）+ vite-node 结构测试 28 断言
  （四角度显示↔PDF 坐标往返回合、`displaySize`、`parsePageSpec` 各种写法）+ CDP 真机冒烟 31 断言全绿
  （CSV 读取五断言 + 落盘字节断言 + 二次打开保真、xlsx 异步读、删页/旋转后标注几何随之换算、
  旋转 90° 写回后 `/Rotate` 与 `/Rect` 双校、重载后显示几何不变、删空守卫、提取/合并/拆分数数、
  位图缓存受限、字数节流仍跟手）；tsc/build 绿

## 大 PDF 分段读取 · 首开提速（v0.35）

- **PDF 不再整本进 JS 堆**：`src/lib/pdf-range.ts` 实现 pdf.js 的 `PDFDataRangeTransport`——先问 `file_len` 拿字节数，
  **≥4MB** 才只喂 64KB 文件头起手，其余正文由 pdf.js 按实际需要的区间回调 `read_range` 从磁盘切片取
  （`disableAutoFetch` 使 worker 只请求真正用到的字节）；**小于阈值仍走原来的整本 `data` 读**，
  因为几十次区间往返对中小文档反而更慢（big.pdf 375KB 实测 715→731ms 持平，正是这条阈值的守卫）
- **Rust 侧两个新命令**：`file_len` 与 `read_range(path, start, len)`——后者返回 `tauri::ipc::Response::new(Vec<u8>)`
  走 **raw IPC**（JS 侧直接拿 `ArrayBuffer`，不经 JSON 逐字节序列化），同为 async 外壳 + `spawn_blocking`；
  越界自动裁到文件末尾、起点越界与零长返回空，缺文件给中文错误而非 panic
- **表格冷开提速**：`SheetEditor` 把「读文件」与「建 Univer 实例」由串行改为**并行**（数据 promise 先起，
  再 `createSheetApp`，两者互不等待），并把空闲预热上移到 `App`（停在首页时 `Workspace` 尚未挂载，
  那是唯一免费的空闲窗口）
- **预热只留实测有效的部分**：资源计时（`performance.getEntriesByType('resource')`，发布包无需 DEV 钩子）
  查出**外壳 Workspace chunk 原本还挂在点击路径上**，遂补 `shell` 预热步；现在点击之后只剩
  `read_xlsx` 与 worker 创建，四个编辑器 chunk + 外壳 + CSS 全部在空闲期取完
- **性能结论（发布包 `--no-bundle` + CDP 真实双开路径，单位 ms）**：
  表格 big.csv 冷开 **1456 → 1281**、热开 579 → 529；heavy.pdf 17.9MB 冷开 **901 → 710**、
  热开 **260 → 91**（分段读少掉的是整本字节进出 JS 堆那一趟）；big.pdf 保持不动
- **被数据否掉的三种更激进预热（已删除，别再试）**：空闲期预取 pdf.js worker 脚本、预先 new 一个 `Worker`
  再 terminate、空闲期真建一个 Univer 实例 + 空表、拿空白 PDF 走一遍渲染管线——DEV 探针确认这些步骤
  **确实执行了**（`__oofPrewarm` 全绿、无告警）而发布包首开耗时**一位数都没降**。
  留下的原因是：首次开标签比同会话第二次慢的那 ~600ms 不是库代码编译，而是新 context 里 6MB chunk 的
  编译与堆增长，空闲期提前跑同样要付一遍
  **（v0.36 修正：那 ~600ms 里还压着一条外壳 Suspense 的 ~300ms 兜底节流，当时把它算进了"编译"这一项；
  节流删掉后表格冷开 1281→584ms。本节其余结论——worker 与实例级预热不省——依然成立）**
- **坑**：① pdf.js 的 `PDFDataTransportStream` 按 `_begin` 找 reader 且 `assert(found)` **在发布包里照样抛**，
  而 `getRangeReader` 是先 `requestDataRange` 后 push reader、同一 `begin` 可被两个 reader 分别请求——
  用「按 begin 去重」当投递策略会把第二个 reader 永久挂死（表现为卡住且无异常面），
  正确做法是**按 begin 计数**、每个待决请求投递一次；② 分段模式下 `onDataRange` 的 chunk 所有权交给
  pdf.js（会 transfer 给 worker），主线程不得复用；③ 标签卸载必须 `openTask.destroy()`，
  否则 transport 的在途区间读回写到已销毁实例（`abort()` 里置 `dead` 标志兜住）
- **验证**：`cargo test --lib` 39 通过（read_range 3 个新测试：精确窗口取值、越界裁到文件末尾 + 起点越界与零长返回空、
  文件字节数与缺文件报错）+ CDP 冒烟 25 断言全绿（真实字节切片的首块 `%PDF` 魔数与尾块 `%%EOF`、
  零长与越界守卫、小文件整本读未回归、大文件 `rangeMode=true`、远处页按区间补读并画出像素、
  旋转后覆盖写回仍走分段、重载后页数与旋转页渲染保真、CSV 表格装载、空闲预热清单 shell/sheet/pdf/doc/ppt）；tsc/build 绿

## 首开那 300ms 的元凶：挂载不再走 Suspense（v0.36）

- **元凶是一条节流，不是"懒加载慢"**：发布包分段打点 + 间隙探针（rAF 采样 / longtask / MutationObserver）显示
  `Workspace` 在 79ms 就渲染完了、内容却到 **349ms** 才提交进 DOM，中间主线程每 8ms 跑一帧、没有任何长任务。
  原因是 React 对 Suspense 边界有一条「兜底一旦可见就至少撑住 ~300ms」的节流，而 **App 用 `lazy()`+`<Suspense>`
  包住了整个工作区外壳**——于是每个新 context 里第一次开编辑器都要付这一笔（首页 → 工作区同样付）
- **修法：自己持有已解析组件**（`src/lib/editors.ts`）——动态 import 由这一个模块独占，预热与挂载点共用同一份
  promise；外壳 `WorkspaceSlot` 与每标签的 `LazyEditor` 先 `peekEditor/peekWorkspace` **同步命中**，
  于是「挂上编辑器」与「改状态」落在同一次提交里，没有兜底可见期可被节流。浏览器**不缓存重编译**：
  组件源码求值一次，但每次新 context 的编译要重付——所以省掉的是等待，不是编译
- **编辑器与 PDF 的建实例 effect 改 `useLayoutEffect`**：被动效果排在「这一帧画完」之后，取文档/建 Univer
  白等一次真实绘制。PDF 侧同构建实测 heavy.pdf 首屏 **746 → 473ms**（画布判据）；表格侧这一改没动那一跳
  （那一跳的账在外壳），两处账分开记、不再混算
- **v0.35 的归因被本轮纠正**：上轮写「冷开多出的 ~600ms 是 6MB chunk 在新 context 的编译与堆增长」，
  编译确实每 context 重付，但当时压着的还有一条 300ms 节流，故那条结论把两件事算成了一件事
- **公式 worker 线程池：裁决为删**（同构建开关 `__oofNoPool` A/B）——常驻线程让卸载只摘监听器不 `terminate()`、
  再配合空闲预热拉起线程，实测**热开 569(池) / 565(无池) 持平、冷开 911(池) / 877(无池) 反而更慢**
  （预热线程与启动抢 CPU）。省掉一次 fetch+构造只值 40ms 左右，不足以推翻 v0.35 的边界判断，
  故池子（`lib/worker-pool.ts`）与预热步一并删除，回到每标签自建自杀
- **保住的部分要背书**：编辑器级自解析表不是"lazy 一律不好"——同构建 A/B 里表格冷开 **588ms（自解析）vs
  875ms（每标签一个 Suspense 边界）**、热开持平，这条差异就是节流量级，所以留着
- **性能结论（发布包 `--no-bundle` + CDP 真实双开路径，单位 ms）**：
  | 用例（判据一致才可跨轮比） | v0.35 | v0.36 本轮 |
  | --- | --- | --- |
  | 表格 big.csv 20001 行 · 冷开（Univer 两画布有宽） | 1281 | **584** |
  | 表格 big.csv · 热开 | 529 | 574（持平，噪声内） |
  | heavy.pdf 17.9MB · 冷开（首页画布节点出现） | 710 | **225** |
  | heavy.pdf · 热开 | 91 | 97（持平） |
  | big.pdf 375KB · 冷开（首页画布节点出现） | 715 | **198** |
  | heavy.pdf · 冷开（**真出像素**，本轮起的严格判据） | 未测 | 309 |
  | big.pdf · 冷开（真出像素） | 未测 | 195 |
- **预热没命中也要能开**：把静置时间压到 0（空闲预热来不及跑完）再双击开表格，仍 710ms 出画布、无异常，
  只比预热过的 584ms 慢 126ms——`peekEditor` 未命中时走 `loadEditor` 等一次的兜底路径是通的
- **坑**：① 判据一换数字就不可比——pdf.js 先建画布后绘制，「画布节点出现」比「第一个非零像素」早约 120ms，
  本轮把 PDF 判据改成扫描 `getImageData` alpha，故 PDF 与 v0.35 的不同判据两列都列出；
  ② 发布包与 dev 共用单实例互斥锁，测发布包前须先杀 dev（反之亦然）；
  ③ 首页与工作区是互斥渲染，回首页会整棵卸载编辑器树（Univer 实例重建）——本轮只断言"回来还能用"，
  保留状态是后话
- **验证**：`cargo test --lib` 39 通过（Rust 零改动）+ CDP 发布包冒烟 19 断言全绿、页面异常 0 条
  （模板→文档/表格/演示、外链开 heavy.pdf 走分段并按区间补画像素、切标签 Univer 容器不被重挂、
  首页往返后重挂可用、收尾关标签）；未预热兜底路径单跑 1 次通过；tsc/build 绿

## docx 保真导入：直接格式 · 缩进 · 三处导出真 bug（v0.37）

- **为什么绕开 mammoth**：mammoth 只认"语义样式"（标题/列表/加粗），把 Word 里最常见的**直接格式**
  （字号、字色、字体族、对齐、缩进、嵌套列表层级、合并单元格、批注锚点）全丢掉——中文文档的排版多数是
  直接敲出来的，走 mammoth 打开后"只剩文字 + 标题"，看着像内容少了半截。本轮手写
  `src/lib/docx-fidelity.ts`（OOXML → HTML，配 `src/lib/ooxml.ts` 迷你 XML 解析器，无 DOM 依赖故 Node 侧可直测），
  mammoth 降级为**兜底**：保真导入器抛错或 `blocks === 0`（认不出这份文件）时才用
- **覆盖**：run 级 `w:rPr`（粗斜/删除线/下划线/字色/高亮 `w:highlight` 与 `w:shd`/字族（拉丁+中文拆两档）/字号半点换算）、
  段落 `w:pPr`（jc 对齐、`w:ind` 的 left/firstLine/hangingChars/firstLine/hanging、pStyle 样式链继承）、
  `w:numPr` + `word/numbering.xml` 的 numFmt → 有序/无序与 ilvl 层级、表格 `gridSpan`/`vMerge`（continue 记账在
  restart 的同一批网格列上，rowspan 数完所有行才出 HTML）+ `tblGrid` 列宽、`w:drawing`/`v:imagedata` 图片（rels → data URL）、
  超链接（外部 `r:id` 与内部 `w:anchor`）、`w:br type="page"` → pageBreak 节点、批注 `commentRangeStart/End` 三态锚点、
  上标下标（v0.38 起真还原成 `<sup>/<sub>`）、`fldSimple`/`fldChar` 的**域代码文字不外泄**（结果段才渲染）、TOC 内容控件跳过
- **缩进进 schema**（`lib/indent-extension.ts`）：`indentLeft`/`indentFirst` 作为段落级全局属性（32px 一档、上限 320px），
  `Ctrl+]`/`Ctrl+[` 与工具条按钮调 `setIndent`，首行缩进与悬挂缩进共存时出 `hanging`；
  导出侧 docx 写 `w:ind`、ODF 因"一段只能挂一个 `text:style-name`"而**派生自动样式**（`style:parent-style-name` →
  Standard/H1..H4/PQ，列表项的左缩进交 `text:list-style` 管以免写双份）
- **顺手修掉三个已经上线的真 bug**：
  ① `.docx` 标签 Ctrl+S 把 `.odoc` 的 JSON 灌进 `.docx` 文件（保存只按"当前是不是文档标签"分流，没看扩展名），
  现按 `.odt`/`.docx` 各自格式原地保存；
  ② **应用内"导出 docx"从来没成功过**——`Packer.toBuffer` 走 jszip 的 nodebuffer 通道，浏览器里直接抛
  `nodebuffer is not supported by this platform`，只有 Node 侧结构测试能过（它有自己的 jszip），
  改 `Packer.toBase64String` + `atob`（两端都支持，解出来是同一份 zip 字节）；
  ③ 有序列表导出写成"1. "字面文本 + 假缩进——真 Word 里既不续号也不重排，读回来更把它当普通段落（编号从此消失）。
  改走 `Document.numbering.config` 三级（decimal/lowerLetter/lowerRoman，720×(lvl+1) + hanging 360），
  Word 实测序号由它自己生成（`ListString` 依次 1. / 3.，第二层 `a.`）
- **表头行**：导出侧首行带 `tableHeader: true`（**行级** `ITableRowPropertiesOptions`，塞进 `TableCell` 选项里类型不报错、
  静默什么也不写），导入侧不再限定"只有第一行"能是表头（Word 可声明第 2 行起重复）
- **体验**：状态栏报「保真导入：N 项未保留（首条告警…）」，不静默吞排版
- **坑**：① 冒烟断言会**假绿**——`<w:jc w:val="center"/>`、`<w:tbl>` 这类 needle 在文件根本没被重写时照样通过，
  必须同时断言"本轮新敲进去的字出现在产物里"（本轮加 mtime + 新文字双判据，正是它揪出 ② 那条导出 bug 之前
  一整轮断言都在自欺）；② dev 里两笔连续编辑之间 vite HMR 会推一个 `LevelFormat is not defined` 的瞬时错误，
  看起来像回归、其实后一编辑落地即自愈，判定前先看模块真产物；③ TipTap v3 没有 `commands.insertText`，
  脚本内插字用 `insertContentAt(pos, str)`（同步）；④ **CDP 不要对活会话 `Page.reload`**——WebView2 里重新加载会把
  这条调试会话换掉（事件与回包全收不到，整轮卡死），源码改动交给 HMR、只轮询 DEV 钩子就位；
  ⑤ 长时间冒烟的进度要边跑边 `appendFileSync` 落盘，`| tail` 全缓冲会把它看起来像卡死
- **验证**：`pnpm vite-node` 结构测试 73（保真导入器 + 导出→导入往返回环）+ 33（缩进）断言全绿；
  CDP 真机冒烟 52 断言全绿、页面异常 0 条（渲染样式逐条计算值核对 → 缩进命令与快捷键 → 原地存 docx →
  重开比对 → 导 odt 重开 → 空 body 走 mammoth 且坏 zip 会抛错）；
  **Word 16.0 实机 13 断言**（`ListType=3`、`ListString` 1./3./a.、层级 2、项目符号未受影响、正文无写死序号、
  首行 `HeadingFormat=-1` 次行 0、左缩进 36pt 首行 24pt）；`cargo test --lib` 39 通过（Rust 零改动）；tsc/build 绿

## 单元格样式与上下标：保真续项（v0.38）

- **闭合 v0.37 剩下的六条边界**：`w:vertAlign`（上标/下标）、`w:tcBorders`（单元格四边）、`w:shd w:fill`（底纹）、
  `w:vAlign`（单元格竖排对齐）、`w:tblInd`（整张表的左缩进）、`w:ind w:right`（段落右缩进）——
  读侧进 `lib/docx-fidelity.ts`，schema 落在 `lib/cell-style.ts`，写侧三条链路（.odoc JSON / docx / odt）各自回得去
- **边框只存一种形状**：规范串 `"<px>px <线型> <#rrggbb>"`，并区分**三态**——`null` 是原文件没声明（不写内联样式，
  落回应用自己的网格线）、`'none'` 是原文件显式去掉了这条边、有值才是真边框。省掉"CSS 一套、OOXML 一套"的双表示，
  往返只经一次换算
- **单位换算钉死在一处**：OOXML 的 `w:sz` 是 **1/8 磅**（`eighthsToPx = sz/8×4/3`、`pxToEighths = px×6`），
  ODF 侧宽度写 **pt**（px×0.75 是精确换算，故 1px 边框回来还是 1px）；
  ODT 读边**不走整数取整的 `len2px`**——0.5pt 细线是 0.67px，整数量化会把它抬成 1px，而边框宽度正是往返要保的那个量，
  故另写 `odfBorderCss` 保留两位小数（缩进/边距仍用 `len2px`）
- **UI 入口**：工具栏 X² / X₂；表格上下文条加"底纹色"一格与竖排对齐（上/中/下），命令走
  `setCellBackground`/`setCellVAlign`（`updateAttributes` 对选区内的 cell 与 header 一并生效）
- **三处真 bug，全是"只测 JSON 测不出来"的那类**：
  ① `border-right: none` **整条静默丢失**——Chrome CSSOM 把 `none` 拆成 longhand 存
  （width=medium / style=none / color=currentcolor），而 shorthand 的 getter 返回**空串**，
  于是 parseHTML 读到空、属性根本不进 schema；新增 `inlineBorder()` 直接读四条 longhand；
  ② **表格缩进在屏幕和 PDF 上完全不生效**——`TableKit` 开 `resizable: true` 后表格 DOM 由 prosemirror-tables 的
  `columnResizing` 节点视图生成，它 `new View(node, min, view)` **不传 HTMLAttributes**，`renderHTML` 里的
  `margin-left` 永远落不了地；`IndentTableView` 子类在构造与 `update()` 里自己套 `marginLeft`（并同步
  `width: calc(100% - Npx)`，否则满宽版心会被顶出页面）；
  ③ Word 里"显式去掉的边框"照样画出来——`w:val="none"` 在 Word 语义里**压不住表级默认边框**（它当"没指定"，
  继续吃 `w:tblBorders` 的 insideV，导出再开变成 0.5pt 实线），只有 **`w:val="nil"`** 才是真去掉；
  导出侧改 `BorderStyle.NIL`，导入侧 `CSS_BORDER_STYLE` 加 `nil → none`
- **坑**：① Word 的内部边框经不起 COM 读——边框合并会把相邻格的那条报回来（实测右边框读成 single、下边框宽度读成
  乙格左边框的 sz18），所以**单元格边框的保真一律直接比 OOXML 字面**（`tmp/t-wresave.mjs`），COM 只留外框（上/左）；
  ② 这台 WebView2 带浏览器级缩放，`getComputedStyle` 把长度按缩放折算（1px 报成 0.667px），DOM 断言里
  **长度只比 specified 内联样式**，宽度 0 与颜色这类缩放无关的量才比 computed；
  ③ Word 的另存会把颜色改大写（`FFF2CC`）、属性换序（`w:type` 与 `w:w` 谁在前都可能），读侧必须两者通吃；
  ④ `Table.Indent`/`PreferredLeft` 在这台 Word 上返回 null、`Paragraph.Runs` 与 `Range.Runs` 恒为 0，
  上下标只能靠 `Find.Font.Subscript/Superscript = -1` 按格式搜
- **验证**：结构测试 42 断言（docx/odt 写侧字面 + 保真导入读回，含 `nil`、0.67px 细线、`text-position="super 58%"`）；
  CDP 真机冒烟 **58 断言全绿、页面异常 0 条**（schema → 真实 DOM 渲染 → 存 docx 重开 → 存 odt 重开 →
  **Word 另存的那份再被本应用读回**，逐条比四边/底纹/竖排/两处缩进/上下标）；
  **Word 16.0 实机 13 断言**（外框线型与 1/8 磅宽度、底纹色 `13431551`、竖排 1/3/0 三态可区分、右缩进 36pt、
  Find 搜到上标与下标）+ Word 原样另存后 **26 断言** OOXML 差分（`w:tblInd 360`、`w:ind w:right="720"`、
  `w:vertAlign` 上下标、`w:shd fill=FFF2CC`、`w:vAlign` center/bottom 恰两处、未声明的格子仍不写 vAlign、
  `w:right w:val="nil"` 被 Word 原样写回）；`cargo test --lib` 39 通过（Rust 零改动）；tsc/build 绿

## 段落排版保真：行距 · 段前段后 · 底纹与四边（v0.39）

- **闭合 v0.38 剩下的段落边界**：`w:spacing`（`w:line`/`w:lineRule` 行距 + `w:before`/`w:after` 段前段后）、
  段落底纹 `w:shd w:fill`、段落四边 `w:pBdr`——读侧进 `lib/docx-fidelity.ts`，schema 落在新开的
  `lib/paragraph-style.ts`（`lineHeight`/`lineRule`/`spaceBefore`/`spaceAfter`/`background`/`bdTop..bdLeft`
  挂 paragraph + heading），docx 与 odt 两条保存链路各自回得去；中文公文最伤观感的丢失就是这一档
- **行距的两套双关对上了**：OOXML 的 `w:line` 在 `lineRule="auto"` 时是 **1/240 行**（Word 默认 259 即 1.08 倍），
  `exact`/`atLeast` 时是**二十分之一磅**；CSS 的 `line-height` 也是双关（无单位=倍数、`px`=绝对值），
  但 ODF/CSS 都表达不出"最小值"这一档，于是用行内自定义属性 `--oof-lr: atLeast` 记在原处带回
  （**实测**穿过 ProseMirror/TipTap 的 detached-CSSOM 重解析不丢，6 块×9 属性零漂移，不需要退化成 `data-*`）；
  属性上没记 rule 时 `ruleOf()` 按量级猜档（>6 只可能是 px 绝对值，没有哪份文档是 20 倍行距）
- **整篇的默认归样式管，写侧不逐段补**：Word 把它存在 `Normal`、ODF 存在 `Standard`。v0.37 那版给每个段落补
  `w:after="120"`，等于把「没声明」这个信息擦掉——**导出再开长出一屏假的段后距**（本轮往返断言抓到的）。
  现在只写用户声明过的那几项；ODF 读侧同理由：`resolvePara` 沿样式链走时按名字跳过具名样式
  （`office:styles` 里那批 + `FIXED_PARA_STYLES` 的 Standard/PQ/H1..H4/PSn），否则继承来的默认会被摊成每段的直接格式
- **0 是真值**：Word 用 `w:after="0"` 压掉样式里那段间距，所以判空一律 `!== undefined` / `owned()`，
  用 `if (v)` 会把 0 静默变成"没声明"；同一条纪律在 `ownedPx()`（docx 写侧）与单元格边框三态里已经立过
- **单位各钉一处**：ODF 段间距与绝对行距写 **pt**（px↔pt 是精确换算，`cm` 写第三位小数会磨掉零点几 px，
  缩进仍写 cm），读回走新的 `lenPx()`（保留两位小数），旧的整数取整 `len2px` 只留给缩进/边距；
  段落边框宽度仍是 1/8 磅制的 `w:sz`（0.67px ↔ sz4 ↔ 0.5pt）
- **UI**：段落上下文条 `.doc-para-bar`——行距下拉（单倍/1.15/1.5/2 + 固定值/最小值 + 自定义 `x倍数`）、
  段前段后两个数字框与「无间距」、底纹取色与「无底纹」；**界面按「磅」显示、属性里存 CSS px**（pt×4/3），
  不让用户换算。`TextStyleKit` 的 `lineHeight` 必须关掉：那是它给段落挂的**同名**属性，
  与这里记 OOXML 行距的 `lineHeight` 撞名字，两边只能留一个
- **主动记 warnings 的边界**：段落边框离字的 `w:space`（>1 磅时告警，schema 里没有 padding 这一层）、
  按「行」计的段前段后（只有 `w:beforeLines`/`w:afterLines` 时按 19px/行估算并说明是估的）
- **坑**：① **PowerShell 的假绿断言**——`Ok((cond), "msg")` 位置传参时 `(cond, "msg")` 被绑成**一个数组参数**，
  `$c` 恒真、`$msg` 恒空（表现是一屏 PASS 却没有文字），须 `param([bool]$c, [string]$m)` 显形参；
  同类还有 `$ps` 是自动变量（赋值静默无效）、段落格式在 `$p.Format`/`$p.Range.ParagraphFormat`
  （`$p.ParagraphFormat` 在这个 adapter 返回 null）、`WdBorderType` 是**负数**（top -1/left -2/bottom -3/right -4）
  且 `Border.Enable` 读不回（比 `LineStyle`）；② 比较函数要把"读不到"当失败——COM 返回空串/Null 时按 0 参与比较，
  会造出「P5 没凭空长出间距」这种假过，`Near()` 现在直接拒 null/空；
  ③ TipTap v3 内置 `trailingNode` 会在文档以标题结尾时补一个空段落，"六段全部挂上"实得 7——
  归因后用 `tmp/probe39.mjs` 抓到，断言放宽为 ≥6 并**显式核对多出来那条是空段落**（而不是放任数据错位）；
  ④ Word 的换算与归一：2 倍行距落到 `wdLineSpaceDouble` 而非 `Multiple`、`Multiple` 的 `LineSpacing` 单位是磅
  （1.08×12pt 报 12.95）、`nil` 显式去边读回 `LineStyle 9999999`（与 0=none 分得开）、底纹色是 BGR 整数（`#fff2cc` → 13431551）；
  ⑤ Word 另存会**抹掉冗余的 `w:after="0"`**（与样式默认等价就不写）、给边框补 `w:space="0"`、颜色改大写、
  中文 Word 的样式 id 是数字（`Heading2` → `2`）——读侧必须通吃，而"显式 0 的保真"由我们自己那条往返腿断言
- **验证（四腿）**：结构测试 **52 断言**（docx/odt 写侧字面 + 保真导入读回，含 1/240 与二十分之一磅两套、
  `w:after="0"`、`atLeast`、按行估算）；CDP 真机冒烟 **43 断言全绿、页面异常 0 条**（6 块×9 属性：schema →
  真实 DOM → `getHTML`/`setContent` 的 CSSOM 重解析零漂移 → 存 docx 重开 → 存 odt 重开 → 工具条真点出来生效）
  + **Word 另存的那份再被本应用读回 9 断言**；**Word 16.0 实机 20 断言**（`P1 rule 5 / line 12.95 / before 10.8 / after 0`、
  底纹 13431551、上边 single/sz4/`#8899aa`、下边 9999999、固定值 4/18pt、最小值 3/14.25pt、未声明段零凭空值、
  标题 `OutlineLevel 2` + 24pt + 段后 9pt）；Word 原样另存件 **OOXML 差分 24 断言**（`w:line="259"`/`w:before="216"`、
  `w:sz="4"`、`w:val="nil"` 原样写回、`w:fill="FFF2CC"`、`w:lineRule="exact|atLeast"` 360/285、
  无声明段连 `w:pPr` 都不写、有排版的四段才写 `w:spacing`）；`cargo test --lib` 39 通过（Rust 零改动）+ tsc/build 绿

## 脚注与尾注：真往返（v0.40）

- **新增 `note` 内联原子节点**（`src/lib/note-extension.ts`）：`kind`（footnote/endnote）+ `text` 两个属性，
  正文不摊进文档流；`parseHTML` 认 `span[data-oo-note-kind]`（保真导入写的就是这一个 span，
  docx 与 odt 两条读侧产**完全同一个**标记，编号/附录/UI 因此只有一套代码），`renderHTML` 挂 `.doc-note`
- **编号一律按文档顺序现算，没有一处存号**：屏上是 CSS counter（`.doc-content` 里 `counter-reset: oo-fn oo-en`，
  两种 kind 各自 `counter-increment`，`::before` 出圈号）；docx 导出把 `w:footnoteReference w:id` 现编 1..N、
  ODT 导出写 `oofn1/ooen1` + 字面 `text:footnote-citation`。于是**插入与删除自动重排，不需要 JS 回写号**，
  冒烟里删一条再看编号从 `1,2,3,1` 回到 `1,2,1` 就是这条设计的验收，而不是某个函数的返回值
- **属性里的换行会被解析器归一成空格**——XML 与 HTML 都一样（连 `&#10;` 也归一），所以多段脚注正文
  存进 `data-oo-note-text` 前必须过 `encodeNoteText`（`\n` → 两字符 `\n`，反斜杠自身也转义），
  读回再 `decodeNoteText`；docx 侧一段一个 `w:p`、ODF 侧 `text:line-break`，两边都靠这一个编解码守住"两段还是两段"
- **docx 读侧**（`lib/docx-fidelity.ts`）：`w:footnoteReference`/`w:endnoteReference` 按 `w:id` 去
  `word/footnotes.xml`·`word/endnotes.xml` 配正文；`w:type="separator"`/`"continuationSeparator"`（含负 id `-1`/`0`）
  是结构件不是正文，必须跳过；引用那一跑带的 `rStyle="FootnoteReference"` 不能被当成正文的下划线或字色；
  **有号没正文**（被截断的转换、损坏件）→ 记一条 warnings 并**不产空标记**（docx 与 ODT 两侧同一条纪律：
  留一枚空圈号会在下一次导出时长成一条真空白脚注）
- **docx 写侧**（`lib/docx.ts`）：`footnotes`/`endnotes` 记录 + 每条正文自带 `<w:footnoteRef/>`——
  **自动编号的铁证**就是这个元素而不是字面 "1."，Word 才会自己重排；多段正文拆成多个 `w:p`；
  `[Content_Types].xml` 与 `document.xml.rels` 两处注册缺一条 Word 就当这份部件不存在
- **ODT 双向**（`lib/odt.ts`）：写 ODF 1.2 的内联写法（`text:footnote-reference` 与 `text:footnote` 同 `text:id` 相邻、
  正文段间 `text:line-break`、脚注段挂 `FN` 自动样式）；读侧三种外壳都收——新版两个元素名、
  旧版（ODF 1.0/1.1 与不少转换器）单一 `text:note` + `text:note-class` + 再套一层 `text:note-body`。
  正文表**先扫全文建全表**再配 id，所以第三方件里正文排在引用之前、或 id 不连续都认得
- **UI**：工具栏「脚注」「尾注」+ 草稿输入框（Enter 落盘）；文末 `.doc-notes` 区分两组（标题带条数、
  行首序号与圈号同源、`textarea` 直接改正文、定位/删除按钮）；`@media print` 把文本框换成静态块——
  打印出去的是脚注，不是一个带边框的输入框
- **坑**：① **TipTap v3 的命令只能填 `tr` 并调用它给的那个 `dispatch`**——命令体内再 `view.dispatch(tr)` 一次，
  链式调用（`.focus().insertNote()`）末尾 TipTap 会把同一份 `tr` 提交第二遍，抛
  `RangeError: Applying a mismatched transaction`；纯 JS 与结构测试都测不到，**真机点工具栏那一下才炸**；
  ② Chromium 的 `getComputedStyle(el, '::before').content` 对 CSS counter 返回**未解析的** `counter(oo-fn)` 记号，
  a11y 树里根本没有伪元素节点（实测 613 节点 / 0 伪元素）——那个数字在页面上读不出来，
  于是圈号断言只能比"计数器接线"（`counter-increment` + 宿主 `counter-reset`）加附录里 JS 自己算的序号，
  "编号由阅读器现算"这件事改由 OOXML 的 `<w:footnoteRef/>` 字面来断言；
  ③ 这台 Word 的 adapter 里 `Footnote.Reference.AutoReference`、`Reference.Text`、`Footnote.Index` **恒返回空串**
  （与 v0.38 的 `Range.Runs` 恒 0 同类），编号类断言一律走 OOXML 字面；
  ④ 本机 Word 的 `SaveAs/SaveAs2` 挂死（见"开发备注"），所以"别人写的件"这一腿改由**手搭的 Word 形状 OOXML**
  与 docx 库写出件共同顶上
- **验证（四腿）**：结构测试 **70 断言**（编解码往返 5 组、docx 写侧字面含 `w:footnoteRef` 计数与"序号不是字面文本"、
  保真导入读回、docx 库件（id 1/7 不连续）、**手搭 Word 形状件 12 断言**（负 id 分隔符、乱序条目、表格里的引用、
  有号没正文）、odt 写侧字面与 `text:id` 配对计数）；CDP 真机冒烟 **74 断言全绿、页面异常 0 条**
  （`setContent` → schema → 真实 DOM（上标位/不可选中/CSS 计数接线）→ 工具栏真点插入 + 改正文 + 删除后编号自排 →
  存 docx 重开 → 存 odt 重开 → docx 库件 → **旧式 ODF `text:note` 外壳件**）；
  **Word 16.0 实机 10 断言**（`Footnotes.Count 2`/`Endnotes.Count 1`、正文逐字对得上、
  多段脚注在 Word 里读回**真是两个 `Paragraphs`**、脚注段挂"脚注文本"样式、正文没被复进主文档流、
  第一段确实带着第一枚引用）；`cargo test --lib` 39 通过（Rust 零改动）+ tsc/build 绿

## 文本框与公式：字不许消失（v0.41）

排序标准是丢东西的严重程度：**文字丢失 > 版式丢失 > 装饰丢失**。这一轮把读侧剩下那两条
"整块文字凭空不见"的洞堵上（docx 与 ODT 各半），版式则如实记进边界账而不是假装还原。

- **文本框展平**：`w:txbxContent`（现代 `wps:txbx` 与旧式 `v:textbox` 两种外壳）里的段落以前整块丢弃，
  现在按文档顺序**展平为普通段落**插回原位置——框内段落自带的首行缩进/居中/粗斜继续走同一条段落路径，
  不另造"文本框节点"（`hasnt(html,'data-oo-textbox')` 是这条纪律的验收）；ODT 侧同构：`draw:frame` 里
  现在认 `draw:text-box`，框内多段用 `<br/>` 连在所在段落里
- **`mc:AlternateContent` 只取一支**：同一份正文 Word 会写两遍（`mc:Choice Requires="wps"` +
  `mc:Fallback` 的 VML），旧代码两支都下钻 → **内容翻倍**；策略定为取 Choice，只有它什么都没产时
  才退回 Fallback（块级与行内各一处，local name 保大小写所以是 `'AlternateContent'`）
- **公式线性化**：OMML（`m:oMath`/`m:oMathPara`）与 MathML（ODF 的 `Objects/objectN/content.xml`）
  翻成同一种可读文本——`a/b`、`x^2`/`x^(ij)`、`a_i`、`√(y)`、`3√(x+1)`、`[v]`、`∑_i^n a`、矩阵 `1 ; 2`；
  规则：`m:*Pr`（含 `m:ctrlPr`）一个字都不产，含空格或运算符的片段加括号才不歧义，
  `m:rad` 是"次数在前"而 MathML `mroot` 参数顺序**正好相反**，`annotation`/`annotation-xml`
  （LaTeX/StarOffice 源码）绝不能漏进正文，`semantics` 只取首子。不引 KaTeX：编辑器里没有承载结构的节点，
  多一个渲染依赖换来的只是把同一批字画得好看
- **域代码与题注没坏**：`fldChar` begin/separate/end 三道门（v0.37 起）已让 `SEQ`/`REF`/题注按缓存文本
  落进正文，本轮实测确认；剩下的诚实边界是 SmartArt（字在 `diagrams/dataN.xml` 那棵树里，摊成扁段落
  等于说谎）与 OLE 对象，各记一条带 `ProgID` 的具体告警
- **边界账按类计数**：`warnings` 由"每条一记"改成**同类聚合**（`Map<文案, 次数>`，出口写成
  `文本框内容已展平为段落（位置与文字环绕未保留）×3`），docx 与 ODT 两条读侧同一套；状态栏照旧显示首条
- **坑**：① `__oofDocCtl` 这个全局指向"**最后一次渲染**的 doc 面板"，而导出后的 `setTimeout(setStatus(''))`
  会在开下一个标签之后重渲染旧面板、把全局改回旧实例——冒烟第一次跑就把 `round.odt` 导出成了 docx 那份内容，
  DEV 钩子必须按 `__oofDocCtlByTab[tabId]` 取；② 断言"翻倍"只能用**计数**（`split(needle).length-1`），
  `includes` 在内容写两遍时照样绿；③ Word 把文本框正文放在**另一个故事**里（`wdTextFrameStory=5`），
  正文 `Range.Text` 根本没有它——所以"展平"是我们主动做的合并，Word 腿要按故事类型读；
  ④ 这台 adapter 的 `Shape.TextFrame.HasTextFrame` **恒假**而 `.TextRange.Text` 照样给回正文，别拿它当门
- **验证（四腿）**：结构测试 **29 断言**（文本框三段各一次、Choice 空壳退 Fallback、OMML 七种形状单元核对、
  SmartArt/OLE/EMF 三条具体边界、图片链路未回归）；**Word 16.0 只读腿 10 断言**——同一份手搭件
  （schema 完整到 Word 真认：6 段 + 2 枚浮动框 + 1 张内联图 + 1 个公式），Word 框内正文与故事逐句对上我们
  展平出来的那几条，而 Word 自己的公式字面是 `𝑥2+𝑎𝑏`（**零连接符、字母还是数学斜体码点**），
  恰好证明"读得出字、读不出结构"，我们补的 `^` `/` 就是那层结构；CDP 真机冒烟 **32 断言全绿、页面异常 0 条**
  （打开 → 真实 DOM 逐句计数 → 展平的件存回 docx/odt → 再开自产物字仍在且不重复）；
  `cargo test --lib` 39 通过（Rust 零改动）+ tsc/build 绿

## 图形部件：SmartArt 与图表的字也不许消失（v0.42）

续项六的第一刀。这两个部件的正文都不在 `document.xml` 里——SmartArt 的字在
`word/diagrams/dataN.xml` 的**数据模型**树里、图表的数据在 `word/charts/chartN.xml` 的**缓存值**里，
以前一律只留一条"未导入"告警，整块文字凭空不见。现在的纪律照旧：**还原不了的如实在账，能还原的进文档模型**，
不新造节点（层级走 `bulletList`、数据走 `table`、格内层级走段落 `indentLeft`）。

- **SmartArt（DiagramML）**：`dgm:relIds r:dm` → dataModel 的 `ptLst` + `cxnLst`，按 `parOf` 边建树、
  `srcOrd` 定兄弟序（真实文件里 pt 与 cxn 都是乱序的）→ **嵌套无序列表**，一个节点一个条目、
  节点标签里的多行 `a:p` 并成一行。三处脏数据要兜：无字节点（`type="doc"` 的根、以及中间空节点）**不下钻就丢整支子树**，
  所以照钻但不成条目；同一节点被两处认父、还有 `sib` 边与反向边成环 → 以"首次认父"为准并挡住回边；
  `a:fld type="diagNum"` 的缓存编号**绝不采**（那是宿主现算的域，采了就把"9."画进正文）
- **图表（ChartML）**：`c:chart r:id` → chartSpace，系列按名字下钻找（`c:barChart`/`c:lineChart`/… 都吃得下），
  每行一个类目、每列一个系列 → 标题段 + **数据表**；`c:cat`/`c:val` 中间那层 `strRef`/`numRef` 别忘，
  `c:pt/@idx` 的**空洞留成空格**（压成顺序就把后一列前移了）、`multiLvlStrRef` 各级拼进同一格、
  系列名可能是字面 `c:v` 而非引用、坐标轴自己的 `c:title` 不能混进图表标题；
  纯引用无缓存（Word 里"待重算"的图）→ 只取回标题 + 一条告警，**不出空表**
- **落在表格里就展平**：`<w:tc>` 只能装段落，所以格内的图示/图表按深度写 `margin-left`（一档 32px）而不是列表或表格
- **边界账**（同类聚合 ×N）：`SmartArt 已按数据模型的父子层级展平（图形版式、配色与连线方向未保留）×2`、
  `图表已按文件里的缓存值取回数据（图表类型、坐标轴与配色未保留）×2`、`图表部件里没有缓存数值，只取回标题`、
  `SmartArt部件里没有可读的文字`、`SmartArt关系缺失…`、`图表部件未找到：word/charts/ghost.xml`
- **三处真 bug 全由"存出去再开回来"那两条腿抓到**（都早于本轮，纯读侧单元测试照不到）：
  ① docx 写侧把一格里的**所有子节点并成一个 `<w:p>`** —— 第二行起既没换行也没了自己的缩进/对齐，
  而图示部件落进格子恰好就是多段，于是整格在 Word 里糊成一行；改成逐块出 `w:p`，并补"空否则会成损坏件"的守卫
  （`w:tc` 至少要一个 `w:p`）；
  ② docx 读侧遇到 `ilvl` **跳档**（Word 真会写 0 直接跳 2）就凭空补中间层，屏幕上一排没字的空子弹；
  第一版只 clamp 上限，结果兄弟项被当成子女爬成楼梯（新加的等值断言抓到），最终按 `numId` 记**基准层**折算；
  ③ 形状约束：TipTap 的 `listItem` 是 `paragraph+`，而我们的 docx 写侧只认条目的第一段——
  所以渲染端改成"一个节点一段"，不去造写侧承不下来的形状（造了就是静默丢字）
- **坑**：① `ListLevelNumber` 挂在 **`Range.ListFormat`** 上，不在 `Paragraph.Format` 上——
  写成后者恒得 `$null`，于是"三级列表"这条断言假失败，还被记成"这台机器读不出层级"（其实 1/2/3 级全读得回）；
  ② 手搭图形部件 Word 认不认，**必须和骨架分开归因**：同一套 `[Content_Types]`/rels/正文不放部件时 Word 能开，
  放了 ChartML 也能开（前提两处规格：`c:spPr` 要在 `c:tx` **之后**、柱图必须 catAx + valAx **两个轴都在**且各带
  `scaling`/`crossAx`——读侧对顺序不敏感，所以自家结构测试全绿也照不出来），
  而 DiagramML 那份仍判「文件可能已经损坏」：`layoutDef` 要真版式（`constrLst`/`algLst`）与配色方案才画得出来。
  这一条如实记进边界而不是继续手钻：应用只**读**别人写的图示部件，从不产出 DiagramML
- **验证（四腿）**：结构测试 **41 断言**（层级/多段/环与反边/srcOrd 序/域编号不采/格内展平/空洞 idx/多层分类轴/
  无缓存只取标题 + 整包从 zip 到 HTML + 干净件与边界件同读）；CDP 真机冒烟 **64 断言全绿、页面异常 0 条**
  （打开 → 真实 DOM → 存 docx 重开 → 存 odt 重开，含格内多段那条形状）；
  **Word 16.0 只读腿 11 断言**（我们的导出件：39 段 / 2 表 / 格内 6 段且第二段 `LeftIndent=24pt` /
  列表层级读到 1·2·3 三级 / 图表数据表逐格对得上；手搭件：骨架能开、ChartML 认成图表且 `Chart.ChartTitle` 读得回缓存标题）；
  `cargo test --lib` 39 通过（Rust 零改动）+ tsc/build 绿

## 域编号重算与嵌入对象可见化（v0.43）

续项六的第二刀。题注、交叉引用、页码这些**域**在文件里是"代码 + 上次算出的缓存"两份，
v0.37 起我们只把缓存抄进正文——于是别的工具编辑过的文档会带着对不上的号原样呈现
（实测夹具里三枚题注的缓存是 `1、2、2`）。这一轮把"哪些号我们能算、哪些不能"划清，
并且**算得出的绝不抄缓存、算不出的绝不假装**。

- **`SEQ` 一律现算**（`src/lib/docx-fields.ts`）：它是纯文档顺序计数器，跟着渲染走一遍就有答案。
  三条纪律：① 缓存结果**照采但不留**（`separate` 之后的那段被 suppress，出口写我们算的那份）；
  ② **被跳过的分支不占号**——所以计数不能预扫、必须嵌在渲染顺序里（目录 `w:sdt` 整块跳过时里面几十枚
  `PAGEREF` 一枚都不许消耗 `SEQ`）；③ 只有代码没有 `separate` 的域（部分工具这么写）也在出口补现算值，
  不留空。同名 label 各一条序列，`图` 与 `表` 互不影响
- **大小写由开关自己决定，不是由缓存决定**：Word 按 `\* ROMAN` / `\* roman` / `\* ALPHABETIC` /
  `\* alphabetic` **这个 token 自身的大小写**给出 I / i / A / a（16.0 实机逐枚测得）。旧代码把开关
  统一转小写再各自硬编码，`ROMAN` 恰好对、`ALPHABETIC` 就错成了小写——这条是 Word 腿抓到的真 bug
- **`REF`：有缓存照原样，没缓存按书签段落文本兜底**（Word 常只写代码）。书签表必须在渲染**之前**
  扫全篇建好——交叉引用可以指向后面的段落，逐段渲染到那儿才知道就晚了；表格单元格里建的进表也认。
  只排掉 `_GoBack`（Word 反复挪动的光标书签）：**题注与目录的自动书签就叫 `_Ref…`/`_Toc…`，
  按"下划线开头"整类过滤会把 REF 唯一能兜底的那张表清成空的**。查不到的书签不硬塞文本，只记一条边界
- **`PAGE`/`PAGEREF`/`DOCPROPERTY`/`STYLEREF` 沿用缓存**：分页取决于版心，我们的排版与 Word 不同，
  现算出来的页码**比抄缓存更容易错**；没有缓存时明确记 `PAGEREF（_RefX）没有缓存结果，未重算`
  （此前是静默变空）。自家 TOC 件重开不报这条——`docPartGallery` 那条守卫先整块跳过了目录
- **OLE 嵌入对象：预览解不开也要看得见**：EMF/WMF 预览浏览器解不了，以前只剩一条告警、文档里
  什么都不留；现在在原位置放一行正文占位 `〔嵌入对象：Excel.Sheet.12，Microsoft_Excel_Worksheet.xlsx，内容未提取〕`
  （ProgID 取自 `o:OLEObject`，文件名经 rels 反查），能出预览图（PNG/JPEG）就出图、**不叠占位**。
  占位是真正文节点，所以 .odoc 存盘重开、docx/odt 导出再开都在。**内容（CFB / 嵌入包）提取当时仍未做**，
  下一轮（v0.44）补上

- **坑**：① **PowerShell 位置传参 `Ok($cond,'文案')` 会把整个括号当成一个数组参数** → `$msg` 恒 null、
  `$cond` 恒非空数组恒真，上一轮那条腿的"6 通过 3 失败"全部无意义。改成空格分参 `Ok (条件) '文案'` 并在
  helper 里 `param([bool]$Cond,[string]$Msg)` 显形参；判据是**失败时文案要能变**（本轮先证 `Ok($false,…)` 也打印 ok）
  ② Word 在**只读**文档上 `Fields.Update()` 返回 `0`（假），可结果确实重算了——别拿返回值当"更新失败"
  ③ 域前后的空格必须在 `w:t` **里面**（Word 为此写 `xml:space="preserve"`）：XML 元素**之间**的空白不是文档文本，
  夹具把空格夹在两个标签中间，就造出一个"我们把域后的空格吃掉了"的假 bug
  ④ 手搭夹具里 `w:p` 不能套 `w:p`（Word 判"文件可能已经损坏"），书签 helper 只收 run 级内容——本轮先怀疑 Word
  不认我们的件，直到同一份件用 docx 库写出来 Word 秒开，才把账归到骨架上
  ⑤ 超链接的外部目标要带 `TargetMode="External"`，OLE 要同时有预览图 rel 与 `embeddings/` 部件 rel，
  目录 `sdt` 要有 `docPartGallery`——少一条，测试就是在验一个形状不对的件

- **验证（四腿）**：**结构测试 38 断言**（SEQ 顺序/同名 label/ROMAN 与 roman/ALPHABETIC 与 Alpha 四形态/
  无 separate 也现算 / REF 有缓存照原样 + 无缓存前向兜底 + 格内书签 + 查不到不塞文本 / PAGE·PAGEREF·DOCPROPERTY
  沿缓存与无缓存记边界 / fldSimple 同路 / 超链接内不重复不漏字 / OLE 三种预览各走各的路 / 目录不占号 +
  自家件导出→重开不出现"没有缓存结果"）；**CDP 真机冒烟 27 断言全绿、页面异常 0 条**（打开 →
  真实 DOM 逐枚计数 → .odoc 正文性 → 存 docx 重开 → 存 odt 重开 → 关掉再开，编号三次一致）；
  **Word 16.0 只读腿 11 断言**——同一份夹具让 Word 自己 `Fields.Update`，`1|2|3|1|I|II|A|i|图 1|1`
  与我们算的逐枚相同（含大小写两形态），并核回更新前缓存确实是 `1|2|2|9|I|II|z|XVIII|图 1|7`；
  `cargo test --lib` 39 通过（Rust 零改动）+ tsc/build 绿

## 嵌入对象里的字：CFB 容器与内层文件（v0.44）

续项六的最后一刀，也是路线图里最后一条未勾的功能项。v0.43 只做到"看得见有个对象"，
而对象里面通常装着**真正的文字**：Word 的 `word/embeddings/oleObjectN.bin` 是一套复合文档
（OLE 2 / MS-C），流 `\x01Ole10Native` 里又装着一个完整原生文件（Excel 工作簿、另一份 docx、
CSV、txt…）。这一轮把这层套娃拆到能读到底为止——读不到底的地方一律说清楚，不塞乱码。

- **容器形状两种，都由本机真件实测得来**（扫描到的分布：CFB 的 `.bin` 70 个、直接放的
  `Microsoft_Excel_Worksheet.xlsx` 21 个、`.docx` 2 个、Visio `.vsd` 1 个）：现代 Office 常把
  原生文件**直接**放在 `embeddings/` 下（本身就是 zip，没有 OLE 包装）；老的 Package 对象才套一层
  复合文档。两条都在同一条分派里走，先魔数后文件名
- **`src/lib/cfb.ts`：零依赖复合文档读侧**（不碰 DOM，所以 Node 侧与页面内跑同一份代码）。
  DIFAT（头里 109 直槽 + 链）→ FAT（扇区编号即数组下标）→ 目录链；小于 4096 的流住进根存储那条链
  装的迷你流，由 miniFAT 按 64 字节迷你扇区串；同一存储下的条目是红黑树（left/right 树兄弟、
  child 指孩子的树根），遍历带 `assigned` 闸门防环。**结构不合一律返回 `null` 不抛**：调用方要的是
  "取不到就记一条边界"，而不是把整次导入掀掉
- **`Ole10Native` 的字段布局是逐字节量出来的**（真件 1.5MB 的 oleObject1.bin）：
  `DWORD cbSize | WORD 0x0002 | label asciiz | 源路径 asciiz | 4 字节占位 | DWORD 临时路径长度（含结尾 \0）|
  临时路径 | DWORD 数据长度 | 数据 | 尾部一百多字节`。两个要点：**数据不贴着流末尾**（按流长反推必错），
  而严格走字段只覆盖了量到的这一种写法，所以走不通时再按"哪枚 DWORD 能把数据吃到接近结尾"扫一遍兜底
- **内层类型分派**（`src/lib/ole.ts`）：docx → 递归 `docxToHtmlFidelity(bytes, depth+1)`（套到第二层停）；
  xlsx → 只要值（共享字符串、`inlineStr`、按 `r="C5"` 定位、跳过的空列不挤位）→ `<table>`；
  CSV → 分隔符按首行嗅探 + RFC4180 引号规则 → `<table>`；txt → 按空行分段（UTF-8 出替换符就换 GBK 重试）。
  老式内层（Excel 97 的 BIFF、Word 97 的 FIB）与裸位图**不硬解**，如实给一条带真名与大小的边界说明；
  内层最大 24MB、表格 200 行 × 40 列 × 4 张表、文本 64KB / 200 段，**截断都写进告警**而不是静默少给
- **两条接缝都吃这套结果**：docx 保真导入器的 `w:object`（取到内容就不再叠 v0.43 那条占位），
  以及 ODT 的 `draw:frame`——`<office:binary-data>` 内联 base64 与 `Objects/objN/` 目录两种形状都解。
  摊出来的是**块级**正文（表格、多个段落），而 `draw:frame` 与 `w:object` 都住在段落里：所以块级正文作
  段落的**兄弟块**接在后面（`embedBlocks` + 各出口 `tail()`），单元格里的则压成行内文本（`inlineFlatten`）——
  嵌套表放不进 `<td>`，硬塞等于让 ProseMirror 的内容表达式把整块字丢掉
- **三处真 bug，全是"读得到字节才算数"的那类**：① `Ole10Native` 偏移 4 的标志是 **WORD** 0x0002，
  按 DWORD 读会把紧随的 label 头两字节一起吃进长度里 → 本机那份真件一直返回"没认出来"；
  ② 截断的复合文档（zip 里只存了一半）最后一枚扇区是残缺的，照整枚去 `DataView` 读直接
  `RangeError: Offset is outside the bounds of the DataView`，改成 `lastSec = floor(len/sec) - 1`；
  ③ ODT 的 `case 'frame'` 把取内容整段压在 `if (href)` 后面——而内联 base64 那种写法**根本没有 href**，
  于是它永远走不到（这一条是冒烟造夹具时才暴露的）。顺手补了 `content.xml` 的 `parsererror` 守卫：
  XML 坏了以前是"安静地打开一篇空白文档"，现在说得出是哪份 XML 坏了

- **坑**：① 单元格里的嵌入内容展平后**不再是表格**，那条"已取值为表格"的告警要有前置的一条
  "单元格里的嵌入内容已展平为文字"，否则状态栏第一句就是矛盾的；② 截断上限要**多取一行当探针**——
  `csvRows` 恰好截在 200 行时，"后面还有"这件事本来就说不出口了；③ 手搭 ODF 夹具的命名空间前缀必须
  声明到位（URI 是 `...:drawing:1.0` 而前缀惯例是 `draw:`），漏了就是整份 XML 解析失败，
  表现为"导入没报错但文档是空的"，最难查；④ 占位文字里能说的是**外层部件名**（`oleObject4.bin`），
  内层真名（`img.rgb`）只在告警里——冒烟断言要按这个分工写，不然就是假失败

- **验证（四腿）**：**结构测试 80 断言**（容器三条读分支 + 坏件一律不抛 + Ole10Native 两种写法 +
  类型分派与各种上限 + `embedHtml` 五种内层 + docx 接缝五种形状 + 格内展平）；**本机真件腿**——
  Word 写的 `oleObject1.bin` 读回 `\x01Ole10Native=1555443` 字节、内层判为 `img.rgb`（1519KB 裸位图）、
  按边界说明处理且不产正文（内容只按结构核对，不进仓库也不入日志）；**CDP 真机冒烟 24 断言全绿、
  页面异常 0 条**（docx 五种形状与 ODT 两种形状都**落在真实 DOM** 上验：4 张表格节点、`<td>` 里零嵌套表、
  `h1` 带级别、状态栏有边界账，再各自存 docx / odt 重开确认字不是一次性的）；
  `cargo test --lib` 39 通过（Rust 零改动）+ tsc/build 绿。**本轮写侧零改动**（只读不写），
  所以 Word 实机腿不适用——没有新东西要它验，这一条如实记着而不是补一条空腿

## 自动更新：检测层（v0.45）

- **这一刀只做检测**：点"检查更新"→ 有新版就提示（版本号、发布日期、一行更新说明）+「前往下载页」用浏览器
  打开；**不在应用内下载与安装**。这么切不是没做完，是因为更新源托管在哪还没定——而检测层恰好是
  不需要那个决定也能全绿验证的部分（清单是真的、签名是真的、链路是真的，只有"上架到哪个地址"是占位）
- **信任根在仓库外**：`pnpm tauri signer generate` 出的 Ed25519 密钥对，私钥存 `~/.tauri/openoffices.updater.key`
  （口令另存 `.pass`），**不进仓库、不进 git 历史、不打进日志**；公钥进 `tauri.conf.json` 的
  `plugins.updater.pubkey`。代价说清楚：**这把私钥没有备份，就等于全体老用户从此再也收不到更新**
  （换钥匙 = 旧客户端验不过新签名，只能重装）
- **清单契约是本机真件量出来的，不是照文档猜的**：`createUpdaterArtifacts: true` 在 CLI 2.11 签的是
  **安装包本身**（`..._x64-setup.exe` 与 `..._x64_en-US.msi` 各带一枚 `.sig`），**没有 `*.nsis.zip`**
  （那是 `v1Compatible` 的老形状）；插件两种都吃——`infer::archive::is_zip` 判 zip，否则落成 `.exe` 直接跑。
  三条平台键各有其人：`windows-x86_64-nsis`、`windows-x86_64-msi`，再加通用 `windows-x86_64`
  兜给 dev 跑的裸 exe（exe 里的 bundle type 是打包时 patch 进去的，dev 那份没有，`get_urls` 就只找 `{os}-{arch}`）
- **`.sig` 是 minisign 文本，签名钉在具体文件上**：第三行 trusted comment 带 `file:<包名>`，所以"清单里的 url
  与传上去的包不配对"这种错，用户端的表现就是验签失败——发版脚本自己先把这一对核了再出清单
- **失败必须说得出为什么**：`lib/update.ts` 把所有异常收敛成 `{state:'failed'}` 且**永不外抛**（抛出去的表现
  是"点了没反应"），`describeError` 按插件 `error.rs` 的真实字面归因成中文——源上没清单 / 没配端点 /
  非 https / 缺本平台条目 / 签名不合 / base64 解不开 / 日期不合 / 连不上；认不出来的一律原样带出，**不编原因**。
  `download_page` 从 `rawJson` 取（插件不认这个自定义字段，我们的检测层要它才写得下去），且只认 `http(s)`，
  `javascript:` 那种直接丢掉
- **权限最小化**：capabilities 只补 `updater:allow-check`（不给 download/install，因为没接线）；
  `getVersion` 在 `core:default` 里、开浏览器在 `opener:default` 里，都是现成的
- **体积账（同一条命令、同一份 dist，只挂/摘这一个插件）**：release exe 7,093,760 → 9,001,984 字节，
  **+1.82 MiB（+27%）**。涨在它自带一整套：`Cargo.lock` 多出 36 个包——rustls/ring/webpki 整条 HTTPS 栈、
  minisign-verify、tar，以及**第二份 zip（4.6.1，与我们自己的 8.6 并存，不是复用）**。安装包侧压缩后
  v0.37.0 → v0.45.0 的 setup.exe 是 9,161,284 → 9,950,952 字节（+789,668），但这中间八个轮次的界面资源都混在
  里面，所以这一笔不能整本记给插件
- **坑**：① capabilities 里留着 `updater:allow-check` 而 Cargo.toml 摘掉插件，**tauri 的构建脚本直接失败**
  （`Permission updater:allow-check not found`）——体积 A/B 必须两处一起摘，这就是"权限面与依赖面是绑死的"；
  ② 单实例锁按 **identifier** 判，dev 与用户已装的正式版共享同一把，要并存就
  `-c '{"identifier":"com.openoffices.smoketest"}'` 而不是去杀他的进程；③ https 闸门只在发布版生效，
  本机端到端腿用 `pnpm tauri dev -c` 注入 `http://127.0.0.1:8123/latest.json`，**仓库里存的仍是 https**；
  ④ 开关型参数不能用取值型 `arg()` 解析（`--skip-build` 排在末尾时读到 `undefined`，等于没传，
  于是"只重生成清单"静默跑成一整次完整构建）
- **验证（四腿）**：结构测试 **36 断言**（清单三平台键形状 + 端点是 https + 公钥在位 + capability 只给 check +
  私钥不入仓不入脚本 + 发版脚本按"已签名安装包"找产物）；**本机端到端真件腿 17 断言**——拿真实构建的
  `latest.json` 与真 `.sig`，先自核签名与 url 的 `file:` 配对，再挂成本地静态源喂给应用：**同版本判"已是最新"**，
  把版本号改成 99.0.0（签名与 url 都还是真的）后应用内真的报"发现新版本 99.0.0"并带出真发布日期、真更新说明、
  可用的下载页按钮；**CDP 真机冒烟 22 断言全绿、页面异常 0 条**（available / latest / 404 / 缺本平台条目 /
  坏 `pub_date` / 返回 HTML / `javascript:` 下载页 / 源不可达 八种形状）；`cargo test --lib` 39 通过 + tsc/build 绿
- **下一刀（应用内下载安装）要动什么**：capability 补 `updater:allow-download` + `allow-install`（或
  `allow-download-and-install`）、更新源定到一个真实 https 地址、前端改调 `downloadAndInstall()` 再
  `relaunch()`（Windows 装完默认自己重启，`restart_after_install` 是 true），那时 `download_page` 就可以不写了

## 表格规则的往返：筛选 · 数据验证 · 条件格式（v0.46）

- **补的是"设了就凭空不见"这一类**：三样规则从 v0.2 起就能在界面里设，但 `payloadToWorkbook` 把快照的
  `resources` 硬写成 `[]`、`workbookToPayload` 从不读它，所以**存一次盘整块丢**。按"丢东西的严重程度"排，
  用户亲手设的判定规则消失比颜色不准更恶劣——这一轮是表格保真线上欠得最久的一笔
- **规则不住在 sheet 对象上**：Univer 把它们交给各插件自己序列化进工作簿快照的 `resources`
  （`SHEET_CONDITIONAL_FORMATTING_PLUGIN` / `SHEET_DATA_VALIDATION_PLUGIN` / `SHEET_FILTER_PLUGIN`，
  每张表按 sheetId 分家）。所以**取**是纯函数 `extractRules`（零 DOM、Node 里直测），**放**必须走门面
  `applySheetRules`——Univer 建工作簿时并不会照我们自己写的那份 JSON 还原界面，只把载荷塞回快照是假往返
- **载荷是归一化模型，不是第三方内部 JSON**：`RangeRect` 0 基含端点、`kind`/`sub`/`op`/`type` 一律用 OOXML
  字面、颜色收成 `#rrggbb`、日期收成 `YYYY-MM-DD`，不存 cfId/uid 这类运行时标识。代价是两侧各写一次换算，
  换来的是"这条规则从哪来"（界面上设的 / 别人文件里读的）不影响我们存出去的字节
- **三处 OOXML 反直觉，逐条踩**：`showDropDown="1"` 说的是**没有**下拉箭头、`filterColumn/@colId` 是相对
  筛选区首列而不是绝对列、日期验证的值是 1900 序列号（`date_serial`/`serial_to_date` 自带 civil→days 换算，
  不为此引日期库；别的工具直接写日期串时原样交回，**不解成 1899 年**）
- **`dxf` 与 `cellXfs` 不是一套东西**：条件格式的着色直接住在 `<dxf>` 块里（粗斜体、字色都没有 fontId 索引），
  实心底纹落在 `bgColor` 而不是 `fgColor`（那是 Excel 反过来才写的），`cfRule/@dxfId` 按下标指 styles.xml 的
  `<dxfs>` 表，所以单独扫一趟而不是复用 StyleBook
- **图标集不抄名字表**：`icon_type_for` 逐个问 crate 的 `Display` 拿 OOXML 家族名（`3TrafficLights1`/`4Arrows`…），
  家族名不在能写出的那批里就记账、不硬凑一个像的；OOXML 的最低档**根本没有 operator**（隐式"≥0"）而 Univer 写
  `lessThan`，读回来按前者归一，档位数与家族图标数不符时按默认档位写出并记账
- **被筛掉的行要喂打印**：Univer 只在界面上现算隐藏，快照的行数据里根本没有这些行；而第三方件的筛选在 OOXML 里
  就是 `hidden` 行——`filter.filteredOut` 与 `hiddenRows` 并成一列剔除，才不会打出一份"没筛过的表"
- **ODS/CSV 先记账不硬做**：ODF 的三样确实存在（`table:database-range` / `table:content-validations` /
  `table:conditional-format`，都住在 content.xml），我们暂不读，但"文件里确实有"这一趟就要说得出；
  对照组同样重要——**我们自己写出的 ODS 不许凭空记出一条规则账**，否则状态栏沦为噪音。CSV 天生无规则，保存时明说
- **两条账都不断头**：`write_xlsx` 的返回值改成边界账数组（区域不成形、色阶档数不对、图标家族不认识、
  提示语超 Excel 面板的 32/255 字上限——**超限只能不写这一项并记账，裁过的提示语在别人电脑上是另一句话**），
  读侧 `WorkbookPayload.warnings`（认不出的判定型、按颜色筛选、`A:A` 这类读不懂的区域片段——只按能认的部分收，
  **绝不猜一个区域来冒充**），状态栏同类聚合成「文案 ×N（另有 M 条说明）」
- **坑**：① crate 的 `set_multi_range` 是**整串替换**而不是补在已设区域之后（实测只给"除第一块"会把第一块整个弄丢），
  所以区域一律先并成一个 `sqref` 再交出去；② rust_xlsxwriter 的默认负色是 Excel 的默认红条，载荷没设负色时
  **必须显式把负色压成正色**，否则从没碰过负值颜色的文件里会凭空多出 `<x14:negativeFillColor>FF0000`；
  ③ Univer 的 `nativeColor` 在"根本没设负色"时装的就是我们塞过去的正色，所以取侧要丢掉 `neg === pos`——留着它，
  "快照直接存"和"读文件再存"两条路会产出两份不同字节；④ `ignore_blank` 必须按载荷的 `blank` 显式给，
  否则 OOXML 的 `allowBlank`（默认 0）与我们界面的"没明说"不对称，第三方件的 `allowBlank="1"` 存一次就被偷偷抹掉；
  ⑤ 条件格式要**倒着插**（这一版门面按插入顺序的倒序吐规则，正着插会把整表优先级反过来），而 builder 的
  `setRanges` 只在 `.d.ts` 里存在、实例上没有，作用区只能 `build()` 之后挂到产物上；⑥ `extractRules(...).rules` 是
  **Map**（`Object.keys` 恒 `[]`）；⑦ 断言"区内规则相对次序不变"不能拿全局排序后的数组比（自反得毫无意义），
  要另留一份未排序的原始序
- **验证（四腿）**：**前端结构测试 53 断言**（三种插件 JSON 外壳各走各的分支 + 颜色/日期/list 归一 +
  门面建不出来的类型退成边界账而不是硬建 + 同色负色被丢掉）；**Rust 6 个新用例 + `cargo test --lib` 49 通过**
  （一份 `rules_workbook` 夹具同时喂写侧 XML 落点、读到写的 round-trip、别人写的件逐样报账、dxf 表自解、
  欠账记得住）；**Excel 16.0 只读腿 26 断言**（真件里 `AutoFilter.Range.Address`=A1:D7、B 列按 30/12 筛后只剩
  2 行、DV 与 CF 的类型/操作符/公式/颜色逐个对得上，并直接解 zip 核 `negativeBarColorSameAsPositive="1"` 出现
  2 次而 `x14:negativeFillColor` 0 次、`gradient="0"` 在位——这台 Excel 的 COM 面不暴露 dataBar 细节，
  负色只能按文件核）；**CDP 真机冒烟 26 断言全绿、页面异常 0 条**（打开→放下与取回逐条一致→实色数据条在 Univer
  里仍是实色→存 xlsx 重开→重存自产物零记账→ODS 只报边界不谎称读回）；tsc/build 绿

## 表格 PDF 打印保真：条件格式的色与图表的图进打印（v0.47）

- **补的是"屏幕上明明有、纸上没有"**：v0.46 让三样规则存得下、开得回，但打印链路只吃静态样式——
  `sheet-print` 从来不看 `condFormats`，图表又只作为 Univer 的浮动图片活在 canvas 上，而
  `PrintToPdf` 抓不到画布。于是同一张表，界面上红红绿绿带折线图，导出的 PDF 是一张白底数字表
- **条件格式在打印侧重算一遍，不抄界面上的色**：Univer 的求值住在画布里拿不到，而载荷本来就带着
  判定规则（`kind`/`sub`/`op`/`v1`/`fmt`/`scale`/`bar`），所以新建 `lib/sheet-cf-print.ts` 的
  `evalSheetCondFormats(sheet)` 纯函数自己算出 `{patches: Map<'行,列', CfPatch>, notes: string[]}`。
  分工照老规矩：**数值 / 文本 / 重复与唯一 / 前 N 与均值 / 色阶 / 数据条算得出就画；公式判定、日期区间、
  图标集算不出就记账**，一条都不硬凑颜色冒充
- **六条"Excel 就是这么画的"细节，全靠跟 Excel 对表才对上**：① 色阶的分位数是在排序列上**线性插值**
  出来的，不是"取第 n 个"；② 数据条在有负有正时把起点放在 **0 轴**上、负值往左长，渐变条靠轴那端浅、
  尖端深（实色条两端同色）；③ "前 N 项"**含并列**——以第 N 大的那个值为界，同值的整片都算进去；
  ④ 文本判定的空条件串是"格为空"那一项，不是"包含空串"（后者会命中区域里所有格）；⑤ 数字 `1` 与文本
  `"1"` 要归一成一个比较键，因为 Excel 那套比较（COUNTIF 语义）不分类型、文本判定也不分大小写；
  ⑥ 自定义端点可能把数据夹在中间，越界按 Excel 的做法**截到最近一档的颜色**
- **优先级与"命中即停"落在补丁的合并规则上**：数组顺序=优先级，同一属性**先命中的说话**（后面的规则只在
  缺口上补自己独有的属性），`stopIfTrue` 之后这一格不再被任何规则碰；`showValue=false` 打印出来是
  **值真的不在纸上**（`cellText` 直接给空串），不是"画了又被条盖住"；数据条走 `background-image`，
  与 `background-color` 天然分层，底色和条互不遮挡
- **图表按锚点格覆盖进网格**：`payloadWithCharts` 抽成保存与导出 PDF **共吃的一份产物**（否则"文件里有图、
  打印里没图"会各说一次话）→ `renderChartPng` 逐张渲染 → 锚在哪一格就绝对定位在该格左上角，并把那一格的
  `overflow` 放开（单元格默认裁掉溢出）；锚点落在合并区内时退到合并区左上角
- **真 bug 一处：图表浮在数据块外面就整个不见**。图表本来就常放在数据右下方，而打印网格的边界只按
  **数据**定，锚点格落在界外 → 那张图在打印里就此不见了（冒烟里表现为状态栏莫名多出一条"未放置"）。
  改成锚点也算网格的一部分；这样"未放置"就只剩超打印上限一种原因，账目才说得出具体行/列
- **另一处真 bug 比本轮功能更值钱：我们的 PDF 一直把屏幕的浅灰蓝铺成纸的颜色**。应用外壳
  `body{background:var(--bg)}`（`#f3f5f8`）实测占掉 **1269783 / 1759470** 像素——文档、演示、表格三种
  导出无一例外（暗色主题下就是一页黑底）。`lib/pdfprint.ts` 的 `@media print` 里给 `html,body` 兜底
  `background:#fff; color:#111`，**只兜"没人管的地方"**：单元格底色、字色这些元素自己声明的照旧说话
- **页面上只留"这份打印件缺了什么"**：超出打印上限那一类才印进 PDF（拿到纸上看的人才用得上），其余账目
  交回调用方进状态栏（`已导出 PDF（有条条件格式是图标集…未表现）`，同类仍聚合成"文案×N"）
- **坑**：① CDP 冒烟整轮卡在**零断言**，元凶是 `ws.on('message', cb)` 的第一个参数是 **Buffer**
  （`ws.onmessage` 才是带 `.data` 的事件对象），于是 `msg.method` 恒 undefined、
  `Page.loadEventFired` 永远等不到——从此长脚本都带**按调用超时**与 `uncaughtException` 出口，
  让下一次卡住能自己报是谁；② pdf.js 的 `page.objs.get(id)` 对**还没解码完的对象是直接抛异常**的，
  不是返回 undefined，取图片尺寸得 try/catch + 有界重试；③ 断言"图表进了 PDF"**不能按图片对象个数**数——
  打印机光栅把每根 CSS 渐变数据条都各出一个 XObject（72×16、72×1 的条有六七枚），要按载荷声明的宽高比
  加尺寸认出那一张（120×90 CSS px → 360×270，正好 3 倍打印 DPI）；④ pdf.js 画布没着墨的地方是**透明
  像素**，"纸白"必须按 透明 ∪ 近白 来算，否则白底断言测的是空气
- **验证（四腿）**：**结构测试 87 断言**（六种判定各画各的色 + 并列/端点/插值/窗口的边界 + 命中即停之后
  不再被碰 + 锚点撑开网格与超上限两种账分开 + 色值不能逃出 style 属性 + 空表给标题但不谎记账）；
  **Excel 16.0 对照腿 149 断言**（Rust 夹具写出八列各一种判定型的件，PowerShell 逐格抄回
  `DisplayFormat`/`Interior.Color`/`Font`，48 格的底色·字色·粗体与我们算的**逐格相同**、且全表只记图标集
  那一笔账；OLE 色是 `0x00BBGGRR` 小端，按 RGB 取会整片错色相）；**CDP 真机冒烟 37 断言全绿、页面异常
  0 条**（打开→`printPlan` 核对打印将要吃的规则数与账目→导出 PDF→pdf.js 像素采样：八种颜色逐个在位、
  没画过的纯红一枚都没有、`-5` 不在文本层而 `-1` 在（证 `showValue=false`）、按宽高比认出那张图表位图、
  主题底色从 1269783 像素降到抗锯齿的边角）；**`cargo test --lib` 49 通过 + tsc/build 绿**

## 表格批注与超链接：作者的编号不能按名字排（v0.48）

- **这两样不住在 `cellData` 的 `v`/`s` 里**：批注住快照 `resources` 的 `SHEET_NOTE_PLUGIN`（按
  表 id → 行 → 列 分家），超链接住 `cellData[r][c].p.body.customRanges`（Univer 把链接当成富文本的
  一种自定义区间，区间类型还有书签/字段好几种，只认 HYPERLINK 那一枚）。此前 `payloadToWorkbook` 把
  `resources` 硬写成 `[]`、链接格整块按普通富文本丢掉——别人文件里的批注与链接打开看不见，我们存一次盘就没了
- **与 v0.46 那三类规则不同，这次两头都是纯函数**：实测把 `resources` 与 `p` 裸写进快照，门面的
  `getNote()` / `getHyperLinks()` 都读得回来，所以 `lib/sheet-cell-side.ts` 只做取与放的换算，
  不发命令、不碰 DOM、Node 里直测——**上一轮"放必须走门面"的教训没有自动管到下一批东西，得再量一次**
- **Univer 的模型装不下两样东西**：`ISheetNote` 里没有作者这一项，链接也没有悬停提示的位置。打开时把
  `author` / `tip` 按表名另留一份，存盘前 `restampCellSide` 按格子回贴；界面上新写的批注因此作者仍是空
  （**不冒用文件里任何一个人的名字**），这是故意的而不是没做
- **读侧把两种写法归一**：老式 `xl/commentsN.xml`（`<authors>` 是表、`comment@authorId` 是下标，一格一枚时
  Excel 还会把作者写在正文第一行——**只有认得出作者才剥这层前缀**）与新式 `xl/threadedComments/*.xml`
  （作者住 `xl/persons/person.xml`，不同工具写的键不一样，两种都收）；Excel 为兼容会把同一条批注**两份都写**，
  按格子归并不重复收、回复并进正文并记一笔「有 N 条批注的回复被并进了正文（我们的模型不分层）」。部件归属
  只能靠 sheet 的 rels 认，`sheetN ↔ commentsN` 那种猜法会认错，认不出属于哪张表的部件**单独记包级账**，
  不挂在某一张表上冒充归属。气泡的宽高与"是否一直开着"既不在 comments 也不在 worksheet，而在
  `vmlDrawing` 的 `<v:shape>` 上（`style` 给 pt、`<x:Visible/>` 给常开），而默认那一档 128×74 读回来要
  **归一回"没声明"**，否则每个没设过尺寸的气泡都会从此开始写尺寸
- **写侧最值钱的一笔：作者表的顺序**：rust_xlsxwriter 0.99.1 把 `<authors>` 按**名字排序**写出（内部是
  `BTreeMap`，packager 只把键抄出来），而 `<comment authorId>` 用的是"按格子序首次出现"的编号。于是
  A1=李四、A2=张三 的件在 Excel 里把 A1 显示成张三——**署名串到了别人头上**。载荷里那张表我们自己按格子序
  数得出来，存盘时两序不一致就把那一张的 `<authors>` 按编号重排再写回；核对严到「作者多重集」与
  「`<comment ref>` 的文档序」两项都对上才动手，**数不上宁可不动并记账**（改错的件比不改更糟）。顺带：
  crate 给"没有作者"准备的槽位写的是字面量 `Author`，指过去等于替用户签了个名，所以 `set_default_note_author("")`
  让第 0 格真是空串
- **链接的两条通道**：外部地址在 sheet 的 rels 里（`r:id` → `Target`，`TargetMode="External"`），表内跳转
  才是 `location` 字面（`Sheet2!A1` / `'Sales Data'!A1:G5`），载荷里分成 `url` 与 `location` 而不是揉成
  一个串——Univer 那边表内跳转是 `#gid=<表 id>&range=...`，认的是表 **id**，所以放侧要建表名→id 的对照表，
  表名含空格或长得像单元格引用（`A1`）时按 OOXML 的规矩加单引号（`''` 才是引号本身）
- **记账的地方**：作者超 52 字（Excel 的上限）**只丢作者不丢正文**——裁过的名字放进别人文件里是另一个人；
  既无外部地址又无表内目标的链接未写入；没有 scheme 的目标（指向同目录另一个文件）按 OOXML 的 `file:`
  形状补一次再试，还不行就报出具体格子与目标；**公式格上那枚链接只记账不硬放**（放了会把公式吃掉）；
  只有链接、格子里没内容的也要占一格，否则这枚链接在会话里没有落脚的地方
- **ODS/CSV 说得出缺什么**：ODF 里这两样确实存在（`office:annotation` 是格子的孩子、`text:a` 是格子里的
  行内链接），探针按这两枚 needle 记「暂未读入」，而**自产物一条都不许多报**（对照组）；顺带量到 calamine
  没把批注正文渗进格值，所以"暂未读入"是真的没读而不是读串了。CSV 与 ODS 的"保存会丢什么"文案各补一句
- **坑**：① `FRange.getNote()` 返回的是 `ISheetNote` **对象**（`{note,width,height,show,…}`）不是字符串，
  照字符串写断言会一路"通过"到真机才发现读的是空气；② Univer 给链接格留下的 `v` 是**旧值**（显示吃的是 `p`），
  取侧一律 `richTextOf(cell) ?? cell.v`，否则改了名存一次、重开又是上一版的文字；③ 冒烟里"批注条数"数成了
  resources 的**行数**（同一行三枚只算一枚），改计数时才发现自己把两张表混成了一笔账；④ 冒烟会就地保存，
  直接开夹具等于把写侧原产物覆盖成二手件——改成每轮从原产物复制一份工作副本，夹具才留得住第一次写出的字节
- **验证（四腿）**：**结构测试 75 断言**（表名加引号的两种情况 + `location`↔`#gid=` 双向 + 富文本区间取与放
  + 作者两种键 + 回贴只贴对的那几格、不覆盖用户在界面上的改动 + 桥两头往返 + "链接格的 v 是旧值"这一条危害
  被点名）；**`cargo test --lib` 57 通过**（新增 7：批注与链接往返、作者表落在**编号序**、两张表的作者表互不
  串、threaded 与 legacy 归并、没署名的保持没署名、默认尺寸不声明、放不下的自己报自己）；**Excel 16.0 只读腿
  16 断言 × 两遍**（写侧原产物与应用重存过的件各一遍：五位作者逐个对得上、`D1` 的作者确为空串、`C1` 的气泡
  开着、`F1` 的 Address 与 ScreenTip、`G1` 只有 SubAddress 且**没有**外部地址、第二张表另算一份作者表、格值
  一个没动）；**CDP 真机冒烟 44 断言全绿、页面异常 0 条**（文件→界面按门面逐格读：五条批注正文与气泡尺寸、
  外链与内链各在位 → 界面上再写一条 → 存 → 重开：原五条署名仍在、新写那条作者仍是空）；**tsc + build 绿**

## 纸是纸，屏幕是屏幕：暗色主题的导出保真（v0.49）

- **v0.47 那条兜底只兜住了一半**：当时给 `html,body` 补了白底，量到的是"表格导出不又是屏幕的浅灰蓝"。
  这轮把三条链路（文档 / 表格 / 演示）× 两个屏幕主题各导一份 PDF 数像素，才发现暗色主题往纸上漏色
  有**两条独立的路**，第二条整个没被管到：
  ① `:root[data-theme='dark']{color-scheme:dark}` 让浏览器把**画布底色**（不是任何元素的底色）涂成深色，
  而 `PrintToPdf` 连画布一起抓走——于是纸上凭空一层深灰底。这条**连 `background:#fff !important` 都压不住**：
  实测同一份空白表格页有 31.6% 的像素是深色、文档页 96.6%，而只在 `documentElement` 上把
  `color-scheme` 改回 `light`，同页深色像素就从 246808 掉到 296。能治它的只有 `color-scheme` 本身
  ② 主题色以 `var()` 落在真元素上（`.doc-page{background:var(--panel)}`、`body{color:var(--text)}`、
  `.doc-content a{color:var(--accent)}`），或以**字面量**写在 `:root[data-theme='dark'] .doc-content pre{…}`
  这类规则里——后者连"打印态覆盖变量"都救不回来，因为它压根不走变量
- **于是把规则定成一句**：屏幕上的颜色必须先穿过一枚 CSS 变量，才能在打印态被一次换掉。`src/index.css`
  给 `:root` 补 `--code-bg`/`--quote-bg`（并把暗色段那两条字面底色规则**整条删掉**，改由变量说话），
  再加一段 `@media print` 同时命中 `:root` 与 `:root[data-theme='dark']`，把 `color-scheme` 压回 `light`
  并重新声明整套纸面调色板（`--bg/--panel` 白、`--text #111`、`--text-2 #444`、`--border`、`--accent`
  固定成亮主题那支蓝、`--code-bg/--quote-bg` 回到比纸略深的一档）。**段的位置在暗色段之后**——同特异度
  的 `:root[data-theme='dark']` 由源序说话，放前面就是白写。往后新增的主题色只要走变量就自动被管住，
  不必逐个选择器打补丁（结构测试就断这条：暗色段里凡是命中 `doc-page|doc-content|doc-toc|doc-note|sheet-print|ppt-print|ppt-slide-static`
  的选择器，一个字面颜色都不许留）
- **只覆盖"纸本身"的颜色，内容声明的一律照旧上纸**——而且演示链路是**对照组**而不是受益者：幻灯片背景来自
  `{background: slide.bg ?? master?.bg ?? t.bg}` 的**字面**内联样式，一页声明为深蓝 `#14203a` 的片子在暗主题
  和亮主题下都贡献 275078 个像素（量化后 `#112233`），谁也不许把它抹白。同理活下来的还有段落底纹
  `background-color:#fff2cc`（13043 像素）、红字 `#cc0000`（277 像素）、表格单元格 `bg/cl`（`#112244` 1823、
  `#eeffff` 1741 像素）
- **屏幕辅助不上纸**：查找替换的命中高亮 `.fr-hit`/`.fr-active`（`rgba(255,200,40,.35)`/`rgba(255,150,0,.6)`）
  在打印态收成 `background:transparent !important` 并去掉描边——它由 `lib/find-replace.ts` 的装饰产生，
  搜到哪儿黄到哪儿，纸上没有"搜索"这回事。`pdfprint.ts` 那条元素级白底兜底保留不动：覆盖层链路和文档链路
  各兜各的，顶掉谁都会掉一半
- **判据的分工是这轮最值钱的一条**：**像素直方图管整张纸，`getComputedStyle` 管单个属性**。四比特/通道的
  量化会把 `#f5f6f7`、`#f5f8fc` 这类近白并进 `#ffffff`，"代码块在纸上还该有一层比纸略深的底"在像素层面
  根本测不到——硬要按像素断言，测的是空气。所以逐属性那条腿走 `Emulation.setEmulatedMedia({media:'print'})`
  （真机 WebView2 认这个仿真，不必只从导出件反推），像素腿只管"整页暗色占比"和"两份纸是否一模一样"
- **最强的不变量不是"白底够多"而是"换主题不改纸"**：同一条链路在暗、亮两主题各导一份 PDF，两份直方图的
  **总变差恰好为 0**（三条链路都是 0，暗色像素数之差也是 0）。按单色计数会踩的坑它一并绕开——屏幕主题色
  `#17181c` 量化后正是打印墨色的 `#111111`，"深色像素变多"未必是缺陷，"两份纸逐档相同"才是
- **修好之后的数**：文档 3222/781636 = **0.4%**（基线 96.6%）、表格 460/781636 = **0.1%**（基线 31.6%），
  剩下的深色像素全是正文墨色与抗锯齿边角
- **坑（都出在测量脚本自己身上，但每一条都能把结论造假）**：① 六位十六进制取红通道是 `>>16` 不是 `>>20`——
  写错以后所有"内容声明色还在不在"的计数都是 0，12 条断言集体假绿；② DOM 会把行内 `style` 属性序列化成
  `rgb(204, 0, 0)`，所以 `span[style*="cc0000"]` 这类选择器**永远选不到东西**（表现为属性读到 `null`），
  要按 `getComputedStyle(x).color` 现找；③ `rgba(255, 150, 0, 0.6)` 的字符串不是以 `255` 开头，
  用 `indexOf('255')===0` 判"高亮还画着"会把成功判成失败——判"没画"只能按 `rgba(0, 0, 0, 0)` 正面比；
  ④ 打印仿真的复位要给 `{media:''}`，传空对象不等于取消仿真
- **顺手量到一条先前就存在、本轮不修的缺陷**：演示导出的 PDF 纸张是**竖版** `MediaBox [0 0 540 960]`
  （7.5×13.33 英寸），幻灯片被压成纸中间的一条横带。当时按 `pageSizeInches:[13.335,7.5]` 与
  `src-tauri/src/pdf.rs` 的"交换边长 + 转置 Orientation"换算推测成**转了两圈**，按未勾项写进路线图。
  **v0.50 的单变量探针否掉了这个归因**：那段换算本来就是对的（`page_box(13.335,7.5)` 只换位一次），
  真实原因是文档标签常驻 `head` 的那份 `@page` 串到了下一次打印作业上——症状是真的，猜的原因是错的
- **验证（四腿）**：**结构测试 28 断言**（打印段两个选择器都在 + 八枚调色板逐条 + 段序必须在暗色段之后 +
  暗色段"能上纸的选择器"零字面底色 + 两条 load-bearing 的 `var()` 链路点名（`.doc-page`→`--panel`、
  `body`→`--text`）+ `print-color-adjust:exact` 与 `pdfprint.ts` 白底兜底不许被顶掉 + 自测假例必须打 FAIL）；
  **CDP 真机像素腿 65 断言全绿、页面异常 0 条**（三链路 × 暗/亮各导一份，pdf.js 逐张画布做直方图 + 两主题
  对照 + 屏幕态与打印仿真态逐属性对照，共 6 份 PDF 与 2 份屏幕快照）；**`cargo test --lib` 57 通过**
  （本轮 Rust 零改动，四条腿里它管的是"没碰坏导出"而不是"碰了什么"）；**tsc + build 绿**（改动只有
  `src/index.css` 一个文件：+40 −12）

## 一张纸只说一次话：纸张方向契约与 `@page` 串台（v0.50）

- **契约先钉死**：`export_pdf` 的 `page` 参数**一律是"想要的纸面尺寸"（要横向就宽>高）**，三条导出链路
  都不许自己换位。WebView2 的 `PrintSettings` 把 `PageWidth/PageHeight` 当作**竖版纸的两条边长**，
  转置完全由 `Orientation` 负责，所以"短边当宽 + LANDSCAPE"这次换算**只在 `src-tauri/src/pdf.rs` 的
  `page_box()` 发生一次**（本机实测：照字面传 13.335×7.5 得到的 `MediaBox` 是 540×960，幻灯片压成横带）
- **设置失败不再静默**：`kick_print` 里背景/页眉页脚/四边距/纸宽纸高/方向五步全部 `map_err` 原样报出。
  静默退默认设置的后果是"导出成功但纸不对"，而那种 PDF 在文件管理器里看着一切正常，只有逐页量人才发现
- **v0.49 记下的那条未勾项是真缺陷，但归因是错的**：`page_box()` 没有转两圈。单变量探针（同一进程内依次跑）
  量出来的是一条谁也没想到的通道——**上一次打印作业会污染下一次**：
  ① 刷新后直接导演示 → `960×540`、底色占 `1.0`；② 演示→演示 → 干净；③ **导过一次 A4 竖版文档**再导演示
  → `540×960`、底色只占 `0.34`；④ 摘掉 `head` 里那份 `#oo-page-rule` 再演 → 又回到 `960×540` / `1.0`。
  元凶是 `DocEditor` **常驻** `document.head` 的 `@page`（它还要给页眉页脚用，标签关了也不移除），
  而 PrintToPdf **真的会认 CSS `@page` 的 `size`**——这条直接推翻了 v0.33 记在代码注释里的"PrintToPdf 忽略
  CSS `@page size/margin`"，注释按实证改掉了
- **修法不是"管住别人"，而是"把自己说全"**：`lib/pdfprint.ts` 的每条覆盖层作业输出一条自己的
  `@page{ size:…in …in; margin:…; @top-left…@right-bottom{content:normal;} }`（十六个页眉页脚位逐个复位，
  因为文档那份 `@page` 的 margin box 会同住进别人的作业）。同一个 `head` 里两条 `@page` 按**文档序**合并、
  后来者说话，而这份样式正是打印时最后追加的那枚。第一版实现走的是另一条路——遍历 `head` 里所有含
  `@page` 字样的 `<style>` 并 `el.disabled = true`，**实测直接判负**：`index.css` 的注释里就写着
  "@page margin box"，于是整张样式表被禁用，演示印成**一页无底色的裸文字**（`cover 0.063`、页数 2→1）。
  一张表里既有要禁的也有要留的，禁整张就是拿别人的正文样式当代价
- **边距也自说自话**：`printMarginsInches()` 把"没给边距"时的默认值明写在 TS 侧（`0.5/0.6/0.5/0.6` 英寸），
  同一组数同时进 CSS `@page` 与 `PrintSettings`。以前是"前端传 `null` 让 Rust 兜底 + CSS 那份 @page 由别人留着"，
  两边谁赢成了运气。演示的全出血因此不再需要自己写 `pageStyle:'@page{margin:0}'`
- **矮纸不再凭空多一页**：`.doc-content` 在屏幕上有 `min-height:900px` 的打字区，而横向 A4 的可印高度只有
  475px——正文尾巴被这块空高度顶到下一页，导出的 PDF 就是"一页正文 + 一页空白"。`@media print` 里补
  `min-height:0 !important`（那是编辑辅助，不是内容），实测同一份正文：横向自定义纸 2 页 → **1 页**、
  A5 矮纸同样 1 页，而 A4 长文仍按内容分 2 页、换 A5 变 3 页（分页由纸的可印高度决定，与空区无关）
- **量"纸"只能量产物**：覆盖层宿主在非打印媒体下是 `display:none`，`getBoundingClientRect()` 读出 `0×0`
  是**正确行为**，不是 bug——所以"幻灯片到底铺满了没有"只能从导出的 PDF 反推（pdf.js 画布数底色占比 +
  墨迹包围盒 + 文本层判"页眉有没有串过来"），别拿 DOM 的几何当打印几何
- **验证（四腿）**：结构测试 **18 断言**（边距三档来路 + `marginsInches:0` 不能被当成"没给" + 纸面/边距成对
  出现在同一条 `@page` + 十六个 margin box 全复位 + 一次作业只输出一条 `@page` + 没给纸张就不声明 `size` +
  自测假例必须打 FAIL）；**CDP 真机 44 断言全绿、页面异常 0 条**（三条链路各自的 `MediaBox`/无 `/Rotate`/
  铺满比例，**以及按"先文档（带页眉页码）→ 演示 → 表格 → 再文档"的污染序列跑**：演示 `960×540` `cover 0.994`、
  表格 `842×595` 左边距 `0.60in` 上边距 `0.55in`、文档的页眉没有出现在演示与表格的任何一页上、而文档自己
  再导时页眉还在；临时样式与宿主用完清零、没有一份样式留在禁用态）；`cargo test --lib` **59 通过**
  （含 `page_box` 两条新单测：横向折成"短边 + LANDSCAPE"、竖版与等边不换位、8.28×8.27 也算另一种纸）；
  tsc + build 绿

## 纸从文件里来：表格「页面设置」的 xlsx 往返与打印（v0.51）

- **欠账的位置**：表格能设的东西里，只有一层从来没被管到——**这张纸该怎么摆**。纸张与方向、边距、缩放、
  页眉页脚、手动分页符、打印区域、重复标题行/列、网格线与行列标题、奇偶页/首页不同、起始页码：
  别人文件里有（Excel 存一次盘全在），我们打开看不见、存一次盘整块没了，导出 PDF 则永远是我们替它定的
  A4 横向。表格保真七期把"格子里的东西"清完，这一轮把"格子外的纸"接上
- **它不住在 `<sheetData>` 里，也不在 Univer 的模型里**：散在 worksheet 末尾七处
  （`<sheetPr>`·`<printOptions>`·`<pageMargins>`·`<pageSetup>`·`<headerFooter>`·`<rowBreaks>`·`<colBreaks>`），
  而**打印区域与重复标题根本不在表上**——是 workbook 级两条 definedName（`_xlnm.Print_Area` /
  `_xlnm.Print_Titles`，靠 `localSheetId` 分表）。取与放两头都是纯换算（`src-tauri/src/xlsx_print.rs` 1281 行
  + `src/lib/sheet-print-setup.ts` 573 行），不放命令、不走门面，Univer 装不下的那份按表名留在侧通道
  （`printRef`，与 v0.48 的 `cellSideRef` 同形），存盘与导出 PDF **共吃同一份**——否则会出现"文件里有设置、
  打印里没设置"两句假话
- **本轮最值钱的一条：`<brk id>` 说的不是"断在这行之后"**。它是**0 基的"这一行/列自己开始新的一页"**。
  两处独立证据把它钉死：Excel 在 `A11` 之前插断点写出的正是 `id=10`，而我们写 `id=3` 时 Excel 的 COM 报
  `HPageBreaks(1).Location.Row = 4`（1 基）。前端换算最初按"之后"理解，于是每一条手动分页符都**差一格**
  ——差一格的后果不是报错，而是分页安静地错一页，只有逐页看纸才发现。Rust 侧读与写都**原样收 id**，
  换算只此一处（`pageBreakRows`/`colBreaks`），`fs.ts` 与 `xlsx.rs` 的注释按实测改过
- **crate 写不了半边，就搭 v0.48 那趟重打包的车**：`rust_xlsxwriter` 0.99.1 的 `write_header_footer` 只写
  odd 两条串，`differentOddEven`/`differentFirst` 一个字不写；`write_page_setup` 又把起始页码落在
  `useFirstPageNumber="3"` 上——OOXML 里那是**布尔属性**，号码另有 `firstPageNumber`，Excel 自己不这么写。
  所以 odd 交给 crate，even/first 与两个开关、页码那半边在存盘时**只换点名的那一张 worksheet 部件**
  （`Fix::Authors | Fix::Print` 在一个枚举里，一次重打包两类补丁；兄弟元素次序按 schema：`pageSetup` 之后、
  `rowBreaks` 之前；`<headerFooter>` 里 odd→even→first）。页眉页脚串里的 `&` 是**格式码**不是文字
  （Excel 按 `&amp;P` 存），转义只有三条标准的，多转一次就成了 `&amp;amp;P`
- **打印链路真的照着排**（`sheet-print.ts` 的 `sheetsToPrintHtml` 现在先要一份计划再画格子）：
  ① 纸张 = `paperSize 编号 → PAPER_INCHES` 再按 `orientation` 换边（认不出的编号记账后走默认纸）；
  ② 可印宽度决定**列带**（`planColumnBands`：一带宽不下就切带，标题列每带各带一份但不重复计列，
  手动列断点在那一列**之前**收带、首列上的断点是空的不凭空造带、"缩放到 N 页宽"反过来求缩放）；
  ③ 一个列带一张 `<table>`，每带各一份 `<thead>`（打印区域外的标题行不参与，越界端点**夹回来而不是整条作废**）；
  ④ 手动行断点落 `<tr class="sheet-print-break">`；⑤ 缩放落 `style="zoom:…"`、水平居中添加
  `margin-left/right:auto`；⑥ 页眉页脚那套 `&L/&C/&R` 码翻成 `@page` 的 16 个 margin box，
  `&A/&P/&N/&D/&F` 由调用方给的 `dateText/fileName` 与浏览器的页码计数器说话，
  **没有对应通道的码整码丢掉并记一笔**（不把 `&X` 当字面文字印出去）
- **做不到的只记账，不硬渲**：起始页码 7（PrintToPdf 没这一档，纸面上第一页还是"第 1 页"）、
  偶数页另有一版页眉页脚（CSS 只有 `@page:first`，没有奇偶档）、`fitToHeight`、垂直居中——
  四条各自一句中文账进状态栏；勾了"首页不同"却没写首页内容也要说（"纸上首页与其余页一样"）
- **`gridLines` 的默认值是 Excel 给的**：文件里**声明过**页面设置却没写 `printOptions@gridLines`，意思是
  "不印格子线"（实测 Excel 就是这么判的），而不是"没意见"。所以 CSS 里那条无条件的
  `.sheet-print-table td{border:…}` 收进了 `.sheet-print-grid` 类，**没声明过任何页面设置的表**
  （我们在 Univer 里新建的就是）沿用历史观照旧带细网格。行列标题（`headings`）同理是新增的一档：
  纸上是灰底小号的行号 + 列字母（`columnLetter(0)=A`、`(26)=AA`）
- **判据的三条经验**（都出在"我以为能这么量"被实测打掉之后）：
  ① `<thead>` 会不会重复不用我们操心——Blink 在自然溢出、`break-before:page` 强断、`zoom:0.9`、
  带容器内四种情形下都重排表头（A/B 探针各测一遍），手工再插一份反而会重复两遍；
  ② "居中上了纸"**不能**按"左右留白相等"判：单元格里的文字到不了右边界，量文字必不对称
  （实测左 173.5pt / 右 314.8pt 而纸是居中的）。可用的判据是**差分**——窄带（两列）比宽带（三列）
  的左边缘正好右移**半列宽**（83.3pt ≈ 列距 166.6pt 的一半），左对齐时这个位移是 0；
  ③ pdf.js 的 `OPS.rectangle` 扫不到 CSS 边框（返回空），几何只能从文本项的 x 或已知边距盒反推
- **PowerShell 第四次踩同一处**：`Ok((a -eq b), '文案')` 的逗号把两参绑成**一个数组**。这次因为形参写了
  类型（`[bool]$Cond`），报错从"恒真假绿"变成当场转换异常——响的，比假绿好，但正确写法仍是
  空格分隔实参的命令调用。COM 面还有两处只能认：这台 Excel 的 `FitToPage`/`PageOrder`/
  `PrintGridlines`/`PrintHeadings`/`OddHeader` **一律返回空**（不硬断言，把实得值抄进日志留证，
  这些字段由 cargo 的 XML 字面断言覆盖），`PrintTitleColumns` 没设时给 `$null`（与期望的 `''` 先归一），
  边距只能按磅比（`Application.PointsToInches` 不存在）
- **ODS / CSV 说得出缺什么**：`ODS 暂不含页面设置（纸张/边距/页眉页脚/分页符），导出的 PDF 仍照它排`，
  CSV 那句长账里也点上页面设置——自产物不许凭空多记一条账，结构与 v0.46/47/48 同一套
- **验证（四腿）**：前端结构测试 **226 断言 / 0 失败**（八档纸型换算 + 列带四种边界含"断点正好落在容量
  边界上只出两带" + 标题行列与打印区域求交 + `&L/&C/&R` 分段与码表 + 记账文案 + `SheetEditor` 的 ODS/CSV
  账目在位，开头假例必须打 FAIL）；`cargo test --lib` **66 通过 / 5 ignored**（新增打印设置的 XML 落点、
  自产物往返、二次存盘、缺失 `<headerFooter>` 时插入、odd 不动只补 even/first）；**Excel 16.0 只读腿两遍
  ——写侧夹具 26 断言、应用重存的第三方件 28 断言，全部 0 失败**（表名/格值没被碰坏、纸张方向缩放页码、
  六条边距按磅、奇偶与首页两枚开关、三段页眉逐字回位含 `&A/&P/&N` 未展开、打印区域与标题行列、
  两个断点的位置与 `xlPageBreakManual`）；**CDP 真机冒烟 64 断言全绿、页面异常 0 条**（Excel 原件 →
  我们的计划逐项等价 → 导出 PDF 四页：每页 `MediaBox` 都是 A4 横向 841.9×595.0、r11 真的另起一页、
  每页各带一份自己那一带的表头、D/E 带不混进 A~C、区域外 F 列与第 19 行没上纸、三段页眉连页码与
  文件名日期都进了 margin box、居中按半列位移判定、打印宿主与注入样式用完清零）；tsc + build 绿

## 一张纸在界面上也能摆：表格「页面设置」面板（v0.52）

v0.51 让这一层存得下、开得回、真上纸，但界面上改不动它——纸张、边距、打印区域这些只能等着别人
的文件带进来。本轮补的就是那只手：**面板写进 `printRef` 侧通道，保存与导出 PDF 共吃同一份计划**，
顺带把"这一版纸上做不到"的账在 UI 上当面说清，而不是等 PDF 印出来才发现。

- **钥匙还是表名，面板只是它的影子**：打开时 `dump.sheets.filter(s => s.print)` 把文件里的纸面灌进
  侧通道，「确定」= `printRef.set(表名, 草稿)`、「清除这张表的设置」= `delete(表名)`；Univer 里改了表名，
  钥匙跟着搬（冒烟按这一步量：改名→存盘→重开，设置仍挂在新名字上）。副标题说实话——
  「文件里带着纸面设置」与「这张表还没声明纸面设置，下面是我们打印用的默认纸」是两句话
- **新建 `src/lib/sheet-print-ui.ts`（347 行，纯函数、零 DOM、Node 直测）**：面板要的一切都不在组件里现算——
  毫米↔英寸（面板按毫米说话、载荷按英寸存，换算只有这一处）、`PAPER_OPTIONS`/`paperMm`（八档纸型带毫米提示，
  英制那几档没有"毫米名"就照实换算）、三槽↔OOXML 那条串、`$C$2:$F$5`↔0 基含端点矩形、行列整跨度
  `$1:$2`/`$A:$B` 的分段、`addBreak`/`removeBreak`、`validateDraft`、`draftPaperNotes`
- **只填中档时不带 `&C`**：页眉三框合成 OOXML 串，只有左或右在场才按段写标记——读侧那条"没标记的整串落在
  CenterHeader"的实测正是这里写出去的形状（与 Excel 字节同一档）。分段标记的查找一路走到底按 `&&` 跳转义，
  否则「A&&Link」里第二个 `&` 会被当成 `&L` 把串拆错
- **不声明 ≠ 报错，两条说法分开**：`F5:C2` 这类反向引用 `sqrefToRect` 判"不解析"，而**不解析就是不声明**，
  面板不拦；只有解析得动却**超出这张表**的（`A1:ZZZ1000000`）才点名「打印区域超出这张表的范围」并把「确定」
  灰掉。网格上限不靠猜——问 Univer 的 `getMaxRows()`/`getMaxColumns()`
- **三条只有真机才说得出来的账**：
  (a) **默认边距不算声明**：写侧的 crate 没人吩咐也给每张表落 `<pageMargins>` 那一档默认值，于是"从没设过"
      与"设成默认"字节相同——按了「清除这张表的设置」、存盘、重开，设置自己又长了回来。读侧
      `clear_default_only_margins()` 把"只剩默认边距"的载荷归一回不声明（与 v0.48"默认气泡尺寸不声明"同一规矩）；
  (b) **React 的渲染期闭包会吃掉一次点击**：格式码按钮原先从渲染期那份 `draft` 求"当前框里有什么"，
      同一批更新里连按两枚，后一枚把前一枚顶掉（实测右槽只剩 `&P`）——改成在函数式 updater 里算，
      并把"一次插两枚码"留在冒烟里当回归；
  (c) **CDP 信封只剥一层**：`send()` 已经解出 CDP 的 `result`，取值是 `r.result.value`；写成
      `r.result.result.value` 恒 `undefined`，于是页面上每个谓词都长得像"还没就绪"，本轮第三次把
      等待超时误判成导航问题（`exceptionDetails` 反倒与 `result` 同级，所以抛错看得见、值看不见）
- **对照组的价值：量具读不到 ≠ 文件里没有**：这台 Excel 的 COM 面对 `PageOrder`/`FitToPage`/
  `OddAndEvenPages`/`EvenHeader`/`FirstHeader` **一律返回 null**，而手搭的 fixture（我们自己的读侧认得）
  同样是 null——所以这不是写侧漏了东西，而是这台机器的 COM 面不暴露；这五条改从**文件字面**核对
  （PowerShell 只读解 zip，不碰任何人的原件）。另两条同样靠对照才不认错：`PrintArea` 回来是**字符串**
  `$C$2:$F$5`（带着 `$`，`-like '*C2*'` 永不匹配），清空起始页码读回的是 `-4105`（xlPageNumberAutomatic）
  而不是 "Automatic"。顺带修掉判据自己的一处坑：`$lines[0..(Count-2)]` 在只剩一条时把 `0..-1` 数成两个同一元素，
  那条 SELFTEST 假 FAIL 被印了两遍（人扫输出会以为真失败），改用 `Select-Object -SkipLast 1`
- **验证（四腿）**：前端结构测试 **147 断言 / 0 失败**（假例必须打 FAIL；毫米英寸往返 + 八档纸型 +
  三槽合成与拆分 + `&&` 不拆错 + 区域与整跨度的双向 + 断点去重 + 校验里"不声明"与"出界"两种说法分开 +
  做不到那四条账随草稿变）；`cargo test --lib` **68 通过 / 5 ignored**（新增两例：只有默认边距的件不算声明、
  边距只要有一档不是默认就算声明）；**CDP 真机冒烟 136 断言全绿、页面异常 0 条**（文件里的纸面→面板显示→
  改→打印计划→PDF 的 `MediaBox` 与文本层→存盘重开，一环一个见证；含改名搬钥匙、清除不留幽灵、
  文档在前表格在后的污染序）；**Excel 16.0 只读腿 57 断言 / 0 失败**（三份件：fixture 对照、面板写出的、
  清除后的；纸张方向纸型缩放六条边距按磅、打印区域与标题行列、两个断点的位置、格式码未展开、
  COM 读不到那五项按文件字面核）；tsc + build 绿

## 纸上真能压出 N 页高：表格页面设置的打印二期（v0.53）

v0.52 的面板能设这三样，文件也存得下、Excel 也认得，唯独我们自己的 PDF 不照着做。本轮按路线图那条
分寸办：**能接线的接线，接不了的当面降级成"只记账"**——「缩放到 N 页高」与「上下居中」接上了真通道，
「起始页码」说实话做不到（`@page` 的页码只有一个 counter，没有"从 7 接着数"的入口）。

- **为什么必须实测，不能按载荷算**：新建的表一条 `rowHeights` 都没有（默认行高由字体现算）、
  声明过的行高又只是**下限**（写 20px 实测 21px）、长文字那一行会自己撑到几百像素；更要命的是
  CSS `zoom` 之后的行高**不等于线性折算**，所以只能在**最终缩放**之下量。而"最终缩放"要靠行高才定得下来
  ⇒ 导出改成**来回几趟**：按计划缩放建一次 → 挂起来量 → 压出页高档重建 → 量稳了才把居中留白写回同一份 DOM
  （上限五趟；没勾这两样的表一趟就过，一次量都不做）
- **新建 `src/lib/sheet-print-measure.ts`（59 行）是这一层唯一碰 DOM 的地方**：`measureSheetPrint` 按
  `<section>` 表序返回实测高（**没有网格的那几张占一格 null**——少了这格对齐，`plans[i]` 就会配到别人家的实测上），
  表名那一行用「第一带的 `top` 减 `section` 的 `top`」量回来，不必逐个选择器猜 margin 折叠；
  `applyVerticalPads` 把留白写回**量它的那一份 DOM**（第一页给 `section`，表名与第一带一起居中才叫"这张表上下居中"，
  后面每带自己起一页就各自居中）。配套在 `pdfprint.ts` 加 `measurePrintLayout`：覆盖层在屏幕上被
  `#oof-print-host{display:none}` 藏着，量出来全是 0，于是另开一个离屏量尺容器（同一套正文样式，
  只是不带 `@media print` 与 `@page`——那组规则改的是可见性、分页与纸面，不改任何一行的高），量完即摘
- **换算仍旧是纯函数**（`sheet-print-setup.ts` +233 行）：`printPagesPerBand` 按实测行高贪心分页、
  **逐个列带**各数自己那几页；`fitToPagesTallZoom` 找能把每一带都压进 N 页高的最大一档缩放（1% 一档、
  下限 10%＝OOXML 能写的那一档、留 `FIT_TALL_GUARD` 一档余量）；`verticalCenterPadPx` 只在装得下时给留白；
  `planSheetFit` 把实测落成"这一张的最终缩放 + 各处上留白 + 该说的账"
- **页高不是总页数**：两个列带各占 1 页高，纸上就是 2 页，而「缩放到 1 页高」压的是**每一带**，
  所以 `tallPages` 取最高的那一带，不许为"总页数"再压一遍（这一条有专门一注对着量具）
- **本轮最值钱的是两条校正数**（都从真 PDF 与真 DOM 之间对出来，不猜）：
  (a) `PRINT_ROW_BIAS_PX = 0.4`——离屏容器的**屏幕媒体**下量的行矩形比纸上的短 0.4px/行，
      zoom 1 时屏幕矩形 20.615 而纸上 21.0，zoom .29 时 6.427 → 6.77，**与缩放档无关**；
      而表名那一行**不随 zoom 折算**（`zoom` 落在 `<table>` 上，那一行在表格外）。少了这两条，
      "缩放到 1 页高"要么多压一档要么多出一页
  (b) **递归收口**：压出来的那一档必须"站上去重排再量"仍是原档才交出去，否则每趟退一档、五趟都定不下来
- **顺带修掉一条只有面板上线后才暴露的真缺陷**：`rust_xlsxwriter` 0.99.1 的 `write_page_setup`
  **逢 `<pageSetup>` 必写 `orientation`**（`is_portrait` 默认真 → 落 `portrait`），于是"面板从没碰过方向"的表
  存盘、重开之后纸面从横版翻成竖版（`MediaBox` 595×841.9）。修法在写侧：`write_sheet_print` 只在真的走通
  setter 时才算声明过，`PrintPatch` 多带一枚 `drop_orientation`，存盘那趟定点重打包把 crate 补写的那枚
  **整枚擦掉**（只擦 `orientation`，其余属性按 schema 原样搬），而**声明过的方向一个字都不动**
- **读侧同一类归一**：crate 在 `fitToWidth`/`fitToHeight` 等于 1 时**不写那一枚**，OOXML 里缺省正是 1，
  所以开了 `fitToPage` 却没写的那两枚归一回 `Some(1)`——「缩放到 1 页」与「没开缩放」必须是两句话；
  没开 `fitToPage` 的不许归一（那是替用户声明了一档缩放）
- **记账的语气跟着改**：面板那句标题从"我们导出的 PDF 上兑现不了"改成"我们的 PDF 上照下面说的兑现"；
  `draftPaperNotes` 四条重写——页高档改成"只在那一页装得下才落笔"，起始页码把**为什么**做不到说出口，
  另补"缩放到 N 页宽/页高超出能排的页数"两条越界账
- **只有真机能教的三条**：① pdf.js 在 27% 那一档把一个单元格的文字拆成逐字符 item，按 item 匹配"第几行在纸上"
  会让量具在最需要它的档上读出 `rows=0` ⇒ 先按行的基线 `y` 合成一行再认标签；② 重开时只判门面在位会读到
  `printPlan()` 为 `null`（要先等 Univer 的工作簿接上），于是"重开没等到"会伪装成"计划里没有页高档"；
  ③ 状态栏那句"压到 27%"要说在**压它的那一趟**——压完再量的那一趟只会说"这档已经够了"，账就丢了
  （所以每张表占一格、后趟覆盖前趟）
- **对照组装进夹具本身**：新写侧夹具把"说了方向"与"从没说"两张表放进**同一趟存盘**（`gen_orient_fixture`），
  于是第三方腿看的是同一份 zip 里两枚 `<pageSetup>`——一枚带着 `orientation="landscape"`、一枚一个字都没有。
  分成两份件就会在"这份本来就没有 pageSetup"上因错的原因通过。实测还量到两个之前没写下来的形状：
  我们的补丁写出的是 `<pageSetup useFirstPageNumber="1" firstPageNumber="7" .../>`（两枚并存），
  Excel 回读 `FirstPageNumber=7`；而这台机器的 COM 面对**同一个工作簿的同一属性两次读回 `0` 与 `1`**，
  所以方向那条判据落在文件字面，COM 只报它稳得住的那几样（起始页码、两枚居中、`PrintArea` 的带 `$` 字符串、格值）
- **验证（四腿）**：前端结构测试 **142 断言 / 0 失败**（假例必须打 FAIL；行偏置只在有行的地方加、
  表名行不折算、页高看最高那一带、递归收口那一档重量原样交回、居中留白五种边界、越界页数、
  再加一组对 Rust 源文的钉：`patch_orientation` 在位、`drop_orientation` 只有两枚 `= false`、读侧归一那一行）；
  `cargo test --lib` **71 通过 / 6 ignored**（新增三例：没声明的方向不回来、走完整存盘链路后仍不声明且
  不连累别的属性、擦了方向不许把页高归一也带走）；**CDP 真机冒烟 67 断言全绿、页面异常 0 条**
  （101 行自然四页 → 压成 1 页含 R001..R100 → 2 页各 50 行 → 居中位移 188.1pt → 装不下那页按顶端排并当面说 →
  起始页码那本账 → 存盘重开纸面仍是横向）；**Excel 16.0 只读腿 30 断言 / 0 失败**（两份件、五个段落：
  两枚 `pageSetup` 的对照、应用真机存盘那份的三条字面、`_xlnm.Print_Area`、格值没被碰坏、COM 回读）；tsc + build 绿

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

```
src-tauri/            Rust 后端
  src/xlsx.rs         read_xlsx (calamine) / write_xlsx (rust_xlsxwriter) 命令，含样式、合并区、尺寸/字族、隐藏/冻结、公式（含缓存值）、图表与**三类规则（筛选/数据验证/条件格式，v0.46 的载荷类型 RangeRect/SheetFilterPayload/DataValidationPayload/CondFormatPayload 也在这里）**、**批注与超链接（v0.48 的载荷类型 CellNotePayload/CellLinkPayload）**、**打印设置（v0.51 的载荷类型 SheetPrintPayload/PrintMarginsPayload/PrintHfPayload，枚举收 OOXML 字面、边距收英寸、区域收 0 基含端点）**，v0.52 再加 `DEFAULT_PRINT_MARGINS` 与 `is_all_default()`/`clear_default_only_margins()`——rust_xlsxwriter 给每张表都写一份默认 `<pageMargins>`，而"没人设过边距"与"边距正好等于默认"在字节上是同一件事，所以只装着默认六数的载荷视作没声明（与 v0.48 那条「默认气泡尺寸归一回不声明」是同一条规矩），读写两头都算在这一套往返里；write_xlsx 返回 `Vec<String>` 边界账；命令为 async + spawn_blocking（同步跑主线程会让窗口冻结），`.csv` 读侧分流到 csv.rs，图表网格按 has_charts 惰性构建，`.xlsx` 才另开一趟 zip 读独立部件的批注、链接与打印设置；测试里带一份**条件格式打印夹具**（v0.47：八列各一种判定型，写出真 xlsx 供 Excel 逐格对色）与一份**打印设置夹具**（v0.51：横向 A4 + 85% + 六条边距 + 三槽页眉页脚 + 打印区域/标题行列 + 两个手动断点，`#[ignore]` 生成器与冒烟腿共用同一份产物）
  src/csv.rs          CSV 往返：RFC4180 逐字符状态机（引号/转义/字段内换行）+ 分隔符嗅探（, ; 制表符）+ UTF-8 失败退 GBK 解码 + 写侧 BOM/CRLF，read_payload 供 read_xlsx 分流、write_csv 为独立命令
  src/xlsx_style.rs   zip + quick-xml 直读 xlsx 的 styles.xml（StyleBook：fonts/fills/borders/cellXfs/numFmts，**外加 `<dxfs>` 条件格式样式表 `parse_dxfs`**——dxf 不走 fontId/fillId 索引、实心底纹在 bgColor 而非 fgColor，故单独一趟）/ mergeCells / col·row 尺寸（字符宽·pt→px）/ 隐藏行列 / 冻结 pane / 公式 `<f>`（GeneralRef 实体重建 + unescape，calamine 无样式/公式 API）
  src/xlsx_rules.rs   三类规则的双向（v0.46）：写侧 `write_sheet_rules`（autoFilter + filterColumn 的 list/custom 两种形状、dataValidation 六类型与日期序列号换算、条件格式四大类 cellIs/containsText/timePeriod/top10/aboveAverage/duplicate/unique/expression + colorScale/dataBar/iconSet，含 dxf 与 x14 的 gradient/negativeBarColorSameAsPositive）、读侧 `read_sheet_rules`（quick-xml 事件流 + `cfRule` 的 begin/end 临时态、`dxfId` 查表、colId 换回绝对列、`showDropDown` 反义、整列引用等读不懂的片段原样交回由调用方记账），摆不进 / 读不出的**一律返回账目不静默少给**
  src/xlsx_cell_side.rs 单元格两位邻居的双向（v0.48）：读侧 `read_cell_side` 另开一趟 zip 按表名对回**独立部件**——legacy `commentsN.xml`（`<authors>` 表 + `authorId` 下标、正文里那行「作者:」前缀只在认得出作者时剥）、threaded `threadedComments/*.xml`（作者查 `persons/person.xml`，两种键名都收，回复并进正文并记账）、两者的归一、气泡尺寸与常开来自 `vmlDrawing`（pt→px，默认那档 128×74 **归一回不声明**）、超链接的 `ref` 在 worksheet 而外部地址在其 rels（`TargetMode="External"`）、表内跳转才是 `location` 字面；写侧 `write_sheet_side`（链接先落文本再补普通格，无 scheme 的目标按 `file:` 补试；`Note` 带作者/尺寸/常开，作者超 52 字只丢作者；`set_default_note_author("")` 让"没人署过"真是空串）+ `save_workbook`（**rust_xlsxwriter 的 `<authors>` 按名字排序而 `authorId` 按格子序登记**，两序不一致时按载荷数出来的那张表重排 `<authors>`，多重集或 `<comment ref>` 文档序对不上就宁可不改并记账）；认不出的形状一律记账
  src/xlsx_print.rs   一张纸怎么摆的双向（v0.51）：读侧 `read_print_setups` 另开一趟 zip 收 worksheet 末尾七处（`sheetPr/pageSetUpPr@fitToPage`·`printOptions`·`pageMargins`·`pageSetup`·`headerFooter` 的 odd/even/first 三槽·`rowBreaks`·`colBreaks`）**加 workbook 级两条 definedName**（`_xlnm.Print_Area`/`_xlnm.Print_Titles` 靠 `localSheetId` 分表，`$1:$2`/`$A:$B`/区域三种片段各归各的字段），`<brk id>` **原样收**（0 基，指"这一行/列自己开始新的一页"——两头实测过）；写侧 `write_sheet_print`（odd 与其余各项交 crate）+ `PrintPatch`/`patch_part_xml`（crate 只有 odd 通道、`differentOddEven`/`differentFirst` 一个字不写、又把起始页码落在布尔属性 `useFirstPageNumber` 上，故 even/first 两条串与真号码在字节上补一次：只动点名的那张 worksheet 部件，兄弟元素次序按 schema 排，页眉页脚里 `&` 是格式码故只认三条标准转义）；认不出的纸型编号与片段一律记账不硬凑；**v0.52 只补一条读侧归一**：接进 `print.clear_default_only_margins()` 之后才判 `is_empty()`，于是"文件里只有 crate 那份默认 `<pageMargins>`"的表不再被当成带着纸面设置（面板副标题、账目与 `printRef` 三处都因此说实话），测试另加两例——只含默认六边的那一份不算声明、超出默认的那一条仍算；**v0.53 补的是"没声明过的那一枚不该被替我们声明"**：`write_sheet_print` 只在真走通 setter 时才算声明过方向并回传 `drop_orientation`，`patch_part_xml` 那趟据此把 crate 逢 `<pageSetup>` 必写的 `orientation` **整枚擦掉**（`patch_orientation` 只动这一枚，其余属性与内部正文原样搬，声明过 landscape/portrait 的一张字都不改），读侧同一条分寸用在页高档上——`<pageSetup>` 里 `fitToWidth`/`fitToHeight` 被 crate 在等于 1 时省掉，而 OOXML 缺省正是 1，故开了 `fitToPage` 却没写的那两枚归一回 `Some(1)`（没开 `fitToPage` 的不许归一，那是替用户凭空声明一档缩放）；测试再加三例（没声明的方向不回来、走完整存盘链路后仍不声明且不连累 paperSize/scale、擦方向不许把页高归一也带走）与一份**成对夹具** `gen_orient_fixture`（同一趟存盘里"说了 landscape"与"从没说"两张表，第三方腿据此分辨"被擦了"与"本来就没写"）
  src/xlsx_chart.rs   zip + quick-xml 直读 chartN.xml + drawing 锚点，系列值按实时网格解析；has_charts 只做 zip 文件名嗅探
  src/ods.rs          ODS 双向：write_ods（async 外壳 + write_ods_sync，共用 xlsx 载荷 → ODF zip，样式/尺寸去重与合并、冻结 settings.xml、公式 of:= 换算）+ read_ods_styles（直解边框/对齐/换行/列宽行高/字族/隐藏 collapse/重复单元格/合并跨度/公式 + settings.xml 冻结）+ **ODF 规则只记账不硬读**（content.xml 里有 `table:database-range`/`table:content-validations`/`table:conditional-format` 就说得出"暂未读入"，v0.48 起再加两枚 needle：格子的孩子 `office:annotation`（批注，作者的 `dc:creator` 也在里面）与行内 `text:a`（链接），自产物不许凭空记出一条账）
  src/pdf.rs          export_pdf 命令：with_webview → WebView2 PrintToPdf（四边距英寸四元组 + 纸张宽高/朝向，cfg windows）；**纸张换算是唯一的**：`page_box(w,h)` 把"想要的纸面尺寸"折成 PrintSettings 的"竖版边长 + Orientation"（v0.50，宽>高才转横向，等边不算横向），背景/页眉页脚/四边距/纸宽纸高/方向五步设置失败**一律原样报出**（静默退默认＝"导出成功但纸不对"）；file_len + read_range（raw IPC 返回 Vec<u8>，async + spawn_blocking，供大 PDF 分段读）
  src/lib.rs          OPEN_EXTS 与 argv 文件过滤纯函数、take_startup_files 命令、single-instance 文件转发；插件链只注册 updater 的 check 能力（前端仅授 `updater:allow-check`，下载与安装没接线）
  capabilities/       dialog + fs 权限与路径作用域 + updater:allow-check（只给检查，下载/安装未接线）
src/                  React 前端
  store.ts            标签页 / 最近文件 / 主题（zustand）
  App.tsx             全局快捷键、拖拽打开、文件关联打开（启动 argv + 单实例转发）、关闭确认、懒加载路由
  index.css           外壳样式、两套主题，以及**纸面与屏幕主题的断钩处**（v0.49）：屏幕上的颜色一律先落进 CSS 变量（`--bg/--panel/--text/--text-2/--border/--accent/--code-bg/--quote-bg`），`@media print` 里一段同时命中 `:root` 与 `:root[data-theme='dark']` 的规则把 `color-scheme` 压回 `light` 并重声明整套纸面调色板（**段必须排在暗色段之后**，同特异度靠源序说话），顺手清掉屏幕辅助（`.fr-hit`/`.fr-active` 的查找命中高亮）；内容自己声明的字面色（段落底纹、单元格底色、幻灯片背景）不经过这条规则，所以照旧上纸；v0.50 又在这里补了 `.doc-content{min-height:0 !important}`——屏幕上那 900px 是打字辅助，矮纸（横向/A5）的可印高度不足它，正文尾巴会被顶成凭空多出的空白一页；**表格的网格线从无条件改为 `.sheet-print-grid` 一类**（v0.51：`printOptions@gridLines` 是打印设置里的一勾，而 Excel 的默认是"没勾就不印"），并新增 `.sheet-print-heading`/`.sheet-print-corner`（行列标题）与 `.sheet-print-band{break-inside:auto}`（一个列带一张表，带内可被分页切开，带与带之间由 `.sheet-print-break` 隔开）；v0.52 再添「页面设置」面板那一份（`.print-pop` 的分组 fieldset、毫米边距格、开关格、分页符 chip，以及 `.print-pop-errs` 与 `.print-pop-notes` 两本账的分色，`--danger` 同时进暗色 token 与 `@media print` 的纸面调色板——面板自己也可能被印出来，规矩照 v0.49 那条「屏幕上的颜色必须先穿过一枚 CSS 变量」）
  lib/univer.ts       Univer 实例工厂（公式 worker + 八个社区预设：核心/筛选/排序/条件格式/数据验证/查找替换/绘图 + **批注与超链接**（v0.48，超链接的 `urlHandler` 把外链交给系统默认浏览器——桌面上 `window.open` 会开出一个新 WebView 窗口））
  lib/univer-io.ts    xlsx 数据+样式（粗斜/颜色/字族/边框/对齐/换行/数字格式）/合并/图表/列宽行高/隐藏行列/冻结窗格 ↔ Univer 快照 转换（样式去重注册）；**规则走侧通道**——取完单元格再按 sheetId 把 `extractRules(resources)` 的结果对回每张表，`warnings` 由 `aggregateNotes` 聚合；**批注与链接同一条侧通道**（v0.48）：取侧交给 `extractCellSide`，放侧把 `resources` 写成 `[noteResourceOf(...)]`（实测裸写就能被门面读回）、链接写成带 `customRanges` 的富文本格（**公式格上那枚先记账不硬放**，只有链接没内容的格子也要占一格）；`payloadToWorkbook` 因此多收一个 `accounts` 出参
  lib/sheet-rules.ts  三类规则的前端桥（v0.46）：`extractRules` 从工作簿快照的 `resources` 里按表取规则（Univer 三个插件各写各的 JSON，条件格式按快照原序交回=高优先级在前），`applySheetRules` 经门面放回界面（**条件格式倒着插**，因为这一版门面按插入顺序的倒序吐规则；builder 无 `setRanges`，作用区在 `build()` 之后挂产物），`buildDataValidation` 只建门面表达得出的四类 + custom；归一化（`normColor` 收 rgb/#、`normDateValue` 收 ISO、`listOf` 拆 JSON 数组串与区域引用、`neg === pos` 的负色丢掉）与 `aggregateNotes`（同类收成"文案×N"）都在这，`textLength`/`time`/`any` 这类摆不进模型的退成边界账而不是硬建一条
  lib/sheet-cell-side.ts 批注与超链接的前端桥（v0.48，纯函数、零 DOM、Node 直测）：`extractCellSide` 从 `resources` 的 `SHEET_NOTE_PLUGIN` 按表取批注、从每格 `p.body.customRanges`（`rangeType` 只认 HYPERLINK）取链接，`noteResourceOf` 反向建 resources（实测裸写即可被门面读回，所以**不发消息不走门面**），`richTextOf`/`richTextBox` 负责"链接格吃的是 p 不是 v"这一层，`univerUrlOf`/`locationOfUniverUrl` 在 OOXML 的 `Sheet2!A1` 与 Univer 的 `#gid=<表 id>&range=` 之间换算（`quoteSheetName`：含空格或长得像单元格引用的表名要加单引号、`''` 是引号本身），`restampCellSide` 存盘前按格子把 Univer 模型装不下的 `author`/`tip` 回贴（**只在缺的时候贴**，界面上新写的那一枚不冒用别人的署名），装不下的形状退成边界账而不是挑个像样的凑数
  lib/chart.ts        ChartPayload → VChart spec → 离屏 canvas PNG dataURL（动态导入分包）
  lib/docx.ts         docx 导入导出（ProseMirror JSON ↔ docx，字色/字族/字号/高亮/页眉页脚/TOC 域/批注/页面设置 sectPr（纸张·四边距·w:cols 栏数栏距）/页码格式（PAGE·NUMPAGES）/分页符/表格合并映射（首行行级 tableHeader、列表 numbering.config 真编号）、单元格四边 `w:tcBorders`（**显式去边写 `w:val="nil"`**——none 压不住表级默认边框）、`w:shd` 底纹、`w:vAlign` 竖排、`w:tblInd` 表缩进、`w:vertAlign` 上下标、段落 `w:spacing`（行距 + 段前段后，**只写声明过的**）/`w:shd`/`w:pBdr`、脚注与尾注（`footnotes`/`endnotes` 记录 + 正文各带自动编号 `<w:footnoteRef/>`、多段拆多个 `w:p`、部件与 rels 注册））；文本节点兼容顶层 text 与 attrs.text；字节经 Packer.toBase64String + atob 取（toBuffer 走 jszip 的 nodebuffer 通道，浏览器里没有 Buffer））
  lib/ooxml.ts        迷你 OOXML XML 解析器（零依赖、不碰 DOM）：parseXml/find/findDesc/all/allL/attr/attrL/val/valNum/textOf + decodeEnt 实体表——让 docx 读侧能在 Node 里直测
  lib/ooxml-graphics.ts 图形部件读侧（v0.42，零依赖、不碰 DOM 所以 Node 侧可直测）：`smartArtToHtml(dataXml, inCell)` 解 DiagramML dataModel 的 ptLst/cxnLst（parOf 建树 + srcOrd 定序、空节点下钻、首次认父挡回边、`a:fld` 域编号不采）→ 嵌套 `bulletList`（格内改段落 `margin-left` 表层级）；`chartToHtml(chartSpaceXml, inCell)` 解 ChartML 缓存值（下钻找系列、`strRef`/`numRef` 中间层、`c:pt/@idx` 空洞留格、`multiLvlStrRef` 各级拼一格、轴标题不当图表标题）→ 标题段 + 数据表，无缓存只取标题；两者都返 `{html, kept}` 让调用方按"真取回多少"说告警
  lib/cfb.ts          复合文档（OLE 2 / MS-C 容器）读侧（v0.44，零依赖、不碰 DOM）：`isCfb` 认魔数、`openCfb(bytes)` 走 DIFAT（109 直槽 + 链）→ FAT（扇区编号即下标）→ 128 字节目录项的红黑树（left/right 兄弟 + child 指孩子根，`assigned` 兼防环），小于 4096 的流从根存储链装的迷你流按 64 字节迷你扇区拼；扇区 512/4096、v3/v4 都认，**结构不合返回 null 不抛**（坏件要"少部分内容照出"而不是整篇打不开），截断的件按 `floor(len/sec)-1` 收边界、v4 高 32 位非零的流只报名字不去碰
  lib/ole.ts          OLE 嵌入对象的**内容**提取（v0.44）：`unwrapEmbed` 拆容器（现代形状=部件本身就是原生文件；老形状=复合文档里的流 `\x01Ole10Native`），`oleNativePayload` 按实测字段布局走一遍、走不通再按"哪枚 DWORD 能把数据吃到接近结尾"扫兜底（数据不贴着流末尾，按流长反推必错）；`classifyEmbed` 先魔数后文件名，`embedHtml(content, depth)` 分派 docx（递归 `docxToHtmlFidelity`，depth≥2 停）/ xlsx（只要值，`r="C5"` 定位、空列不挤位）/ CSV（首行嗅探分隔符 + RFC4180 引号）/ txt（空行分段，UTF-8 出替换符换 GBK 重试），取不出的一律给带真名与大小的 `note`；上限 24MB / 200 行 × 40 列 × 4 表 / 64KB × 200 段，**截断写进告警不静默少给**；`inlineFlatten` 把块级正文压成行内（单元格放不下第二层表）
  lib/docx-fidelity.ts OOXML → HTML 保真导入器（v0.37）：run 级 rPr（粗斜/删除线/下划线/字色/高亮/字族/字号/上下标 `w:vertAlign`）、段落 pPr（jc/`w:ind` 左右与首行悬挂四种缩进写法/pStyle 样式链）、numPr+numbering.xml → 有序无序与 ilvl 层级（**跳档按 numId 折基准层**，不凭空补中间层）、表格 gridSpan/vMerge + tblGrid 列宽 + 单元格四边 `w:tcBorders`（含 val=nil 的显式去边）/底纹 `w:shd fill`/竖排 `w:vAlign`/表级 `w:tblInd`、段落 `w:spacing`（行距两档 + 段前后，含按行的 `w:*Lines` 估算）/`w:shd` 底纹/`w:pBdr` 四边、脚注与尾注引用（`w:footnoteReference`/`w:endnoteReference` 按 `w:id` 配 `word/footnotes.xml`·`endnotes.xml` 正文，跳过 separator/continuationSeparator，正文缺失记告警且不留空标记）、图片 rels→dataURL、内外超链接、分页符、批注三态锚点、域代码文字不外泄、**域编号重算**（v0.43：`fldChar` begin/separate/end 三道门接 `docx-fields` 的 `FieldEngine`——`SEQ` 现算并压掉缓存、`REF` 无缓存按书签段落文本兜底（书签表渲染前预扫）、算不了的沿缓存且无缓存记边界、`fldSimple` 同路、被跳过的分支不占号）、`w:object` 嵌入对象（v0.43 预览是 EMF/WMF 解不开时留一行可见占位，ProgID + rels 反查的部件文件名；**v0.44 先走 `lib/ole` 取内容**——取到就把内层正文接为段落兄弟块（格内改压行内）且不再叠占位，取不到才留占位）、文本框 `w:txbxContent`（`wps:txbx` 与旧式 `v:textbox`）展平为段落、OMML 公式线性化、`mc:AlternateContent` 只取 Choice（空则退 Fallback，避免同一份正文翻倍）、drawing 锚点经 rels 找图示/图表部件（v0.42，部件缺失与关系缺失各记一条告警）；认不出就抛错或 blocks=0，调用方回退 mammoth
  lib/docx-fields.ts 域重算引擎（v0.43，零依赖、纯 Node 可直测）：`parseInstr` 拆 `命令 参数 \开关`（**开关 token 原样保留大小写**——Word 就按它决定结果形态）、`seqText` 按 `\* ROMAN`/`roman`/`ALPHABETIC`/`alphabetic`/`Alpha` 出对应形态、`FieldEngine`（`from(doc)` 渲染前扫全篇建书签表（只排 `_GoBack`，`_Ref…`/`_Toc…` 必须留）+ `seqValue` 跟着文档顺序走 + `refText` 兜底段落文本）、`recomputable`（只有带 label 的 SEQ 现算）、`fieldLabel`/`paraText`（域代码与已删文字不算正文）
  lib/cell-style.ts   单元格样式扩展（v0.38）：tableCell/tableHeader 的 bdTop/bdRight/bdBottom/bdLeft + background + vAlign、table 的 marginLeft 全局属性（只声明属性不改内容模型）；边框统一规范串 `"0.67px solid #8899aa"`，三态 null 未声明/'none' 显式去边/有值；`inlineBorder()` 读 CSSOM longhand（shorthand 对 none 返回空串）、`IndentTableView` 子类补 marginLeft（resizable 的节点视图不传 HTMLAttributes）、`eighthsToPx`/`pxToEighths` 管 1/8 磅换算、命令 setCellBackground/setCellVAlign
  lib/paragraph-style.ts 段落排版扩展（v0.39）：paragraph/heading 的 lineHeight/lineRule/spaceBefore/spaceAfter/background/bdTop..bdLeft 全局属性，一组属性拼**一条** style（多条各写一份会互相盖掉）；`ooxmlLine`/`lineToOoxml`/`ruleOf` 管 1/240 行与二十分之一磅两套语义，"最小值"档 CSS 表达不了就修行内自定义属性 `--oof-lr` 带回；命令 setParagraphStyle/setLineSpacing/setSpaceAround/setParaBackground
  lib/indent-extension.ts 段落全局属性 indentLeft/indentFirst（32px 一档、上限 320px）+ setIndent/indent/outdent 命令 + Ctrl+] / Ctrl+[ + 悬挂缩进感知的出退格
  lib/toc-extension.ts TipTap 目录原子节点：按标题实时汇总、点击跳转
  lib/page-break-extension.ts TipTap pageBreak 原子块（`div[data-oo-pagebreak]`）+ insertPageBreak 命令 + Ctrl+Enter 快捷键
  lib/comment-extension.ts comment mark（cid 锚定批注）+ 加/删/定位/汇总工具
  lib/note-extension.ts 脚注/尾注的 `note` 内联原子节点（attrs kind/text，正文不摊进文档流）：`encodeNoteText`/`decodeNoteText` 管属性里的换行（XML/HTML 解析器会把属性值里的 LF 归一成空格），`notesOf`/`noteOrdinalOf`/`locateNote` 按文档顺序现算编号，命令 insertNote/setNoteText/deleteNote（只填 tr + 用给到的 dispatch，绝不自己 view.dispatch）
  lib/odt.ts          ProseMirror JSON ↔ ODT（JSZip 打包导出 + DOMParser 导入，字符样式（字族/字号/字色/上下标 `style:text-position`，落在 content.xml 自动样式）/合并表/图片尺寸/页码域与总页数/page-layout 页面设置（纸张·四边距·style:columns 多栏）/分页符 fo:break-before/单元格自动样式 `fo:border-*`（宽度写 pt，读回走 `odfBorderCss` 保留 0.67px 这类细线不整数取整）+`fo:background-color`+`style:vertical-align`、表级 `fo:margin-left`、段落直接格式 `fo:margin-top/-bottom` + `fo:line-height`（倍数写 % + proportional、绝对值写 pt + fixed/minimum，两档在 ODF 里分得清而 CSS 分不清）+ `fo:background-color` + `fo:border-*`（宽度写 pt），读侧按名字跳过具名样式与 `office:styles` 里那批，以免把整篇默认摊成每段的直接格式；脚注/尾注写 ODF 1.2 内联 `text:footnote-reference` + 同 `text:id` 的 `text:footnote`（citation 写字面序号、段间 `text:line-break`、正文段挂 `FN` 自动样式），读侧三种外壳都收（新版两个元素名 + 旧版 `text:note`/`text:note-class`/`text:note-body`），正文表先扫全文建全表，故 id 不连续或正文排在引用之前也配得上；`draw:frame` 认三类内容（`draw:image` 位图 / `draw:text-box` 文本框展平为 `<br/>` 连成的行内文字 / `draw:object` 嵌入件——`Objects/objectN/content.xml` 里有 MathML 就线性化成文本，否则 v0.44 走 `lib/ole` 取内层内容：`<office:binary-data>` 内联 base64 与 `Objects/objN/` 目录两种形状都解，摊出的块级正文由 `tail()` 作段落兄弟块接回、单元格内压成行内文本），`content.xml` 解析失败时抛出说得出是哪份 XML（否则表现为"打开了一篇空白"），读侧统一产 `warnings`（同类聚合成「文案×N」）交状态栏显示）
  lib/find-replace.ts 查找/替换 ProseMirror 插件：按文本块匹配存 state、装饰高亮、findNext/findPrev/replaceOne/replaceAll 命令（命中上限 FR_HIT_CAP=2000 截断并标 `N+`）
  lib/templates.ts    首页模板注册表与纯函数 seed：11 个模板（公文/会议纪要/周报 → ProseMirror JSON+meta，记账表/库存清单 → WorkbookPayload 含公式冻结，六套演示配色 → Deck）
  lib/ppt.ts          .opd 幻灯片数据模型（版式/主题/序列化）
  lib/pdfprint.ts     打印覆盖层：挂 DOM → 注入打印样式 → export_pdf → 清理；`@media print` 里给 `html,body` 兜白底黑字（v0.47：外壳的 `body{background:var(--bg)}` 曾把整页铺成屏幕的浅灰蓝，三种导出都中招；元素自己声明的颜色不受影响）；**每条作业把自己那份 `@page` 说全**（v0.50：`ownPageRule()` 输出 `size` + 四边 `margin` + 十六个 margin box 复位，`printMarginsInches()` 让 CSS 与 PrintSettings 吃同一组数）——PrintToPdf 会认 CSS `@page size`，而文档标签的 `#oo-page-rule` 常驻 `head`，不禁掉别人的说法就会被"上一次打印"污染（实测：导完文档再导演示得到竖版纸 540×960、幻灯片只占 0.34）；**v0.53 加 `measurePrintLayout(overlay, read)`**——覆盖层在屏幕上被 `#oof-print-host{display:none}` 藏着、量出来全是 0，于是另开一个离屏量尺容器（同一套正文样式，只是不带 `@media print`/`@page`，那组规则改的是可见性、分页与纸面而不改任何一行的高），量完即摘，被量的那份 DOM 仍旧原封不动交给导出那条腿
  lib/sheet-cf-print.ts  条件格式的**打印侧求值**（v0.47，纯函数零 DOM）：`evalSheetCondFormats(sheet)` 按载荷数组序（=优先级）吃规则，产出 `Map<'行,列', CfPatch>` 与账目——`cell`（number/text/duplicate/unique/rank/average，含"前 N 项算并列""空串条件=格为空""数字与文本归一比较"）、`colorScale`（分位数线性插值 + 越界截最近档）、`dataBar`（0 轴起点、负色、渐变/实色、`showValue=false` 收成 `hideValue`）；`iconSet`/公式判定/日期区间/缺样式的一律**只记账不落笔**；`PRINT_MAX_ROWS`/`PRINT_MAX_COLS` 用来裁 `A:A` 这类整列引用，否则一条规则循环百万格
  lib/sheet-print-ui.ts  「页面设置」面板要的一切（v0.52，347 行纯函数、零 DOM、Node 直测，不进组件也不碰门面）：`mmToInch`/`inchToMm`（**面板按毫米说话、载荷按英寸存**，换算只这一处）、`PAPER_OPTIONS`/`paperMm`（纸号→毫米，英制档没有"毫米名"就照实换算）、`hfSlotsToText`/`hfTextToSlots`（三框 ↔ OOXML 那条串：只填中档时**不带** `&C`，与 Excel 写出去的形状同一档；找分段标记时按 `&&` 跳转义，否则「A&&Link」里第二个 `&` 会被当成 `&L` 拆错）、`hfStrayAmpersands`（`&` 后面不是已知格式码时 Excel 会自己吞一个字符，界面先说出口）、`sqrefToRect`/`rectToSqref`/`spanToSqref`/`sqrefToSpan`（`$C$2:$F$5` ↔ 0 基含端点、`$1:$2`/`$A:$B` ↔ 行列跨度）、`addBreak`/`removeBreak`（重复断点只记账不重排）、`draftOf`（缺省项**留白**而不是替用户声明一档默认值）、`validateDraft`（区分"不解析＝不声明"与"解析得动但超出这张表＝点名并把确定灰掉"，网格上限由调用方从门面取）、`draftPaperNotes`（随草稿实时说给面板的那几本账，v0.53 改了内容：整码做不到的两类（起始页码——`@page` 的页码 counter 没有"从 N 接着数"的通道、偶数页另版），有条件才落笔的一类（上下居中只在那一页装得下才居中，否则按顶端排并记账），越界的一类（`fitToWidth`/`fitToHeight` ≥100 排不出那么多页，纸上按整幅分带/自然分页）——文案与 `planSheetPrint`/`planSheetFit` 逐字对齐，同一笔账在面板上与在导出时说的是同一句话）
  lib/sheet-print-measure.ts 打印排版的**实测层**（v0.53，59 行，这一层唯一碰 DOM 的地方）：`measureSheetPrint(root)` 按 `<section>` 表序量回 `SheetMeasure`（每一带的重复表头高、逐行高、整表高，加表格上面那一行表名的高——用「第一带的 `top` 减 `section` 的 `top`」量，不逐个选择器猜 margin 折叠；**没有网格的那几张占一格 null**，否则 `plans[i]` 会配到别人家的实测上）；`applyVerticalPads(root, fits)` 把居中留白写回**量它的那一份 DOM**（第一页给 `section`，其后逐带给自己的带）。为什么要这一层：新建的表一条 `rowHeights` 都没有（默认行高由字体现算）、声明过的行高只是**下限**（写 20px 实测 21px）、长文字那行自己撑到几百像素，而 `zoom` 之后的行高**不等于线性折算** ⇒ 只能在最终缩放下量，换算则全交给 `sheet-print-setup` 的纯函数
  lib/sheet-print-setup.ts 一张表的打印设置 → 打印计划（v0.51，纯函数零 DOM 零时钟）：`planSheetPrint(sheet, ctx)` 产出 `SheetPrintPlan`（纸面 `pageSizeInches`（`PAPER_INCHES` 编号→短边×长边再按 `orientation` 换边，认不出记账后走 `SHEET_DEFAULT_PAGE`）、`margins`（缺省与 `pdfprint` 同一组数，英寸）、`printableWidthPx` 与 `printableHeightPx`（**可印高这里不取整**——一页放几行要拿小数行高去比，v0.53）、`zoom`、`gridLines`/`headings`/`hCentered`/`vCentered`、`printArea`（`clampArea` 把越界端点**夹回来而不是整条作废**）、`titleRows`/`titleCols`（`titleRowSpan` 与打印区域求交——区域外的行根本不印，标题也就无从重复）、`pageBreakRows`/`colBreaks` **照 `<brk id>` 原样收**、`fitToWidthPages`/`fitToHeightPages`/`firstPageNumber`、`headerStyle`）；`planColumnBands` 按可印宽度切列带（标题列每带各带一份但不重复计列、手动列断点在**那一列之前**收带、首列上的断点是空的不凭空造带、勾了"缩放到 N 页宽"反求 zoom）；`headerFooterCss` 把 `&L/&C/&R` 三段码翻成 `@page` 的 margin box（`&A/&P/&N/&D/&F` 有对应通道，**没有的整码丢掉并记一笔**，不把 `&X` 当字面文字印出去；奇偶页没有 CSS 通道故偶数页跟着奇数版印，首页那一版有 `@page:first`）；`jobPrintPlan` 定这一趟的纸（多张表各说各话时第一张说话、其余记进 `job.notes`）；**v0.53 把"按实测说话"那一半接上**：`printPagesPerBand`/`simulatePrintPages` 按实测行高逐带贪心分页（行不拆开，一页装不下整行挪下一页）、`fitToPagesTallZoom` 找能压进 N 页高的最大一档缩放（1% 一档、下限 10%、`FIT_TALL_GUARD` 一档余量，页高看的是**最高的那一带**而不是总页数）、`verticalCenterPadPx`（装得下才给留白，装不下 0——居中的反面是"假居中"）、`planSheetFit` 把实测落成最终缩放 + 各处上留白 + 该说的账，`PRINT_ROW_BIAS_PX = 0.4` 是"屏幕媒体下量的行矩形比纸上短多少"的实测常数（与缩放档无关），`scaleMeasure`/`paperAt` 把两者分开：表名那一行**不随 zoom 折算**；仍然做不到的只剩起始页码（`@page` 只有一个页码 counter）**只进 `notes` 不落笔**
  lib/sheet-print.ts  WorkbookPayload → 打印 HTML 网格（值/边框/对齐/换行/数字格式/字族/合并/列宽行高/跳过隐藏行列/**跳过被筛掉的行（`filter.filteredOut` 与 hiddenRows 并列）**/**条件格式算出的底色·字色·粗斜·下划线·删除线·数据条（v0.47）**/**图表位图按锚点格绝对覆盖、锚点撑开网格边界（v0.47）**/**纸张·边距·缩放·打印区域·重复标题行列·手动分页符·列带·水平居中·网格线与行列标题（v0.51，一切先过 `planSheetPrint`）**/分页/截断）；一个列带一张 `<table>`、每带各一份 `<thead>`（实测 Blink 会自己重复表头，我们不再手工插第二份）；返回 `{html, notes, plans, job}`——页面上只印"这份打印件缺了什么"，其余账目交回调用方进状态栏，`job` 那三个数直接喂 `pdfprint`；**v0.53 多收一枚 `opts.zooms`（按表序，null＝这张不动）**：那是上一趟实测定下的最终缩放，说话权在它而不在计划的 `zoom`，于是"按 N 页高压一档"能真的把这份 HTML 重建成那一档
  lib/pptx-export.ts  Deck → pptx（pptxgenjs）
  lib/pptx-import.ts  pptx → Deck（JSZip 解包 + OOXML 解析 + 媒体还原）
  lib/pdf-pages.ts    PDF 页面级操作（pdf-lib 覆盖写回）：rotatePagesInPlace / removePagesInPlace（倒序删 + 删空守卫）/ extractPages / mergePdfs / splitPdf，做完由调用方重载
  lib/pdf-geo.ts      显示空间（已套旋转·左上原点）↔ PDF 原始坐标（未旋转·左下原点）双向精确换算：normRot / displaySize / toDisplayRect / fromDisplayRect / toDisplayPoints / fromDisplayPoints + parsePageSpec（`1-3,5` 页码写法）
  lib/pdf-range.ts    大 PDF 分段读取：PDFDataRangeTransport 子类（≥4MB 才启用、64KB 文件头起手、按 begin 计数投递、abort 置 dead）+ fileSize/readRange，配 Rust 侧 file_len + read_range
  lib/editors.ts      动态 import 的唯一持有者：四类编辑器 + Workspace 外壳各自的「已解析组件表」（peekEditor/loadEditor、peekWorkspace/loadWorkspace），挂载点同步命中即不走 Suspense（v0.36）
  lib/prewarm.ts      首页空闲期预取外壳与编辑器 chunk（App 级，与 lib/editors.ts 共用同一模块 promise）：顺序为 Workspace 外壳 → 按最近文件类型的四个编辑器；实测无收益的实例级/worker 级预热与公式 worker 线程池已删除
  lib/registry.ts     跨组件保存器注册表（Ctrl+S 路由到当前标签）
  lib/open.ts         路径→标签 打开 / 带确认关闭
  lib/sync.ts         最近文件端到端加密同步（WebCrypto PBKDF2-SHA256 → AES-256-GCM，.oosync 信封）
  lib/update.ts       自动更新的**检测层**（v0.45）：`checkForUpdate()` 动态导入 updater 插件走一次 `check`，任何失败都收敛成 `{state:'failed'}` 不往外抛（抛出去的表现就是"点了没反应"）；`describeError` 按插件 error.rs 的真实字面把"源上没清单/没配端点/非 https/缺本平台条目/签名/base64/日期/连不上"归成中文，认不出的一律原样带出不编原因；`infoOf` 从 `rawJson` 里取自定义字段 `download_page`，只认 http(s) 才给按钮
  components/         Home（最近文件 + 从模板新建画廊 + 版本号与"检查更新"） / Workspace / SheetEditor（保存按 .xlsx/.ods/.csv 三分流，打开时把读到的规则经门面放回界面并把两侧账目显示在状态栏；**「页面设置」面板（v0.52）**——纸张/方向、六条边距（毫米）、缩放与"缩放到 N 页宽"、六个开关、打印区域与重复标题行列（可「用当前选区」「用选区首行/首列」按门面选区给）、手动分页符（按 Excel 的 `brk@id` 说法：这一行/列自己起新页）、页眉页脚三框 + 六枚格式码 + 奇/偶/首页三版；「确定」写进 `printRef` 侧通道、「清除这张表的设置」把它整个删掉、面板里的错把确定灰掉，做不到的那几条以账目形式随草稿说在面板上（v0.53 改了语气：页高档与居中已经接线，只剩起始页码真做不到）；**导出这一侧多了一段实测循环（v0.53）**——计划里勾了「缩放到 N 页高」或「上下居中」的表才走：建一次 → `measurePrintLayout` 离屏量 → `planSheetFit` 压档/算留白 → 带 `zooms` 重建，最多五趟，定档后把居中留白写回**同一份 DOM** 再交导出；账目分两头记（"压到 27%"那句要说在压它的那一趟、每张表占一格由后趟覆盖前趟，居中的账反过来只在最终缩放那份实测上算数）；DEV 门面钩子随这轮加 `printSet(表名, 载荷|null)`（落笔处＝面板「确定」那一行）与 `printHtml(zooms)`（把**将要上纸的那份 HTML**交出去，让脚本自己挂起来量真实布局） / DocEditor（页面设置含分栏/页码格式、分页参考线、分页符、表格与图片上下文工具条、粘贴成图、查找替换面板、字体族·字号、缩进工具条与 Ctrl+]/[、上下标 X²/X₂、表格上下文条的底纹色与竖排对齐（上/中/下）、脚注/尾注（工具栏插入 + 文末分区编辑与定位/删除，打印时文本框换静态块）、版本历史·自动保存、模板 seed、状态栏字数节流；打开 .docx 保真导入优先、mammoth 兜底，保存按 .odoc/.odt/.docx 各自格式原地落盘） / PptEditor / PdfViewer（pdfjs-dist 懒加载，连续多页视口虚拟渲染+Ctrl 缩放+TextLayer 文字选择+全文搜索+缩略图/大纲/标注侧栏+高亮便签与矩形·椭圆·直线·手绘形状（绘制/导入/写回 pdf-lib）+标注编辑（点选/拖移/改色/删除）+「页面」工作区旋转/删除/提取/合并/拆分；≥4MB 走分段读（lib/pdf-range.ts），卸载时 destroy openTask 并 abort transport））
scripts/              copy-pdfjs-assets.mjs（dev/build 前复制 cmaps/标准字体到 public/pdfjs） /
                      updater-release.mjs（发版：开 createUpdaterArtifacts 本机建签名包 → 读回真 .sig 与产物 →
                      出带三平台键的 latest.json → 打印要上传的清单；私钥只走子进程环境变量，`pnpm release:updater`）
.github/workflows/    release.yml——tag v* 触发只打 Linux（1× 计费）；Windows（2×）与 cargo test 改手动 dispatch 勾选
```

表格文件流：`xlsx/ods 磁盘 → Rust(calamine 值 + xlsx/ods 各自 zip/quick-xml 直解样式·合并·尺寸·字族·隐藏·冻结·公式·图表·三类规则) → JSON 快照 → Univer 渲染（图表经 VChart 出 PNG 浮动图片，筛选/数据验证/条件格式经门面放回）`；CSV 走 `csv.rs` 状态机（UTF-8/GBK 自动）→ 单表载荷；保存按扩展名分流——`.xlsx` 经 `rust_xlsxwriter`（含原生图表部件与三类规则的 OOXML 落盘，带回写侧账目）、`.ods` 经 `ods.rs` 生成 ODF 包、`.csv` 经 `csv.rs` 写 BOM + CRLF 文本（只存首表）。
文档文件流：`docx → lib/docx-fidelity.ts 直读 OOXML（w:rPr/w:pPr 直接格式 + numbering 层级 + 表格合并 + 图片 + 批注 + sectPr 页面设置）→ HTML/元数据 → TipTap`，
保真导入器抛错或拆不出块时回退 `mammoth 正文 + zip 直读页眉页脚/批注/sectPr`（v0.37）；`.odt` 走 `lib/odt.ts` 双向；
保存按标签扩展名分流——新建文档存 `.odoc` JSON（含 meta）、`.odt` 与 `.docx` 标签各自格式原地写回（导出走 docx/odt 链路）。
演示文件流：`pptx → JSZip 解包 OOXML → Deck 模型 → 编辑器`；保存为 `.opd` JSON 或经 pptxgenjs 导出 pptx。
PDF 文件流：查看 `pdf 磁盘 → 小于 4MB 整本 readBytes / 大于 4MB 经 file_len + read_range 分段喂给 pdf.js（首屏只取 64KB 文件头）→ pdfjs-dist（worker + canvas）`；标注 `选区高亮/便签/拖拽画的矩形·椭圆·直线·手绘 → 内存模型（rects[0] 包围盒 + polys 几何）→ Ctrl+S 时 pdf-lib 低层写 Annotation 字典回原文件`；文档导出 `@media print 排版（分栏/分页符/避免跨页折断）+ @page margin box 逐页页眉页脚页码 + 打印态纸面调色板（`color-scheme` 压回 light、主题色经变量换掉，v0.49）→ Rust export_pdf（PrintSettings 纸张与四边距；CSS `@page` 也真的说话，所以每条作业自己声明完整，见 v0.50）→ WebView2 PrintToPdf 落盘`；演示导出 `Deck → createRoot 离屏挂载 StaticSlide 分页 → 同上`；表格导出 `Univer 快照 → WorkbookPayload → lib/sheet-print-setup.ts 把那张「页面设置」翻成打印计划（纸面/四边距/缩放/打印区域/重复标题行列/手动分页符/列带/页眉页脚的 @page margin box）→ lib/sheet-print.ts 自绘 HTML 网格 → 同上（canvas 抓不到故走数据侧重排；计划同时喂 PrintToPdf 的 PrintSettings，两条通道同一组数，v0.51。**勾了「缩放到 N 页高」或「上下居中」时这份 HTML 先建后量再重建（v0.53）**——行高不在载荷里（默认行高由字体现算、声明过的只是下限、`zoom` 之后又不线性），只能离屏量真排版（`lib/sheet-print-measure.ts` + `pdfprint.measurePrintLayout`），`fitToPagesTallZoom` 按实测逐带贪心分页压出 1% 一档的缩放、`verticalCenterPadPx` 只在装得下的那一页给上留白，量稳了才把留白写回同一份 DOM 交导出）`；页面管理 `内存标注先写回 → pdf-lib 旋转/删除/提取/合并/拆分覆盖写回 → 重载并从 /Annots 重新导入标注（旋转页坐标按 /Rotate 经 pdf-geo.ts 换算）`。

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

- [x] 演示：pptx 母版/背景图还原、演讲者备注
- [x] 演示：动画、演讲者视图（双屏备注独立窗口）
- [x] 演示：元素级动画（逐条入场）与自动换页计时
- [x] 演示：动画映射 PowerPoint 原生 timing 树（元素级跨端保真）
- [x] 演示：动画方向/出场效果补全 + PowerPoint 实机回放回归确认
- [x] 表格：样式（字体/颜色/合并）随 xlsx 往返
- [x] 表格：边框/对齐/数字格式 xlsx 往返 + ODS 读侧样式/合并 + PDF 打印保真
- [x] 表格二期：列宽/行高/字体族 xlsx+ODS 全链路往返（读→Univer→保存→PDF 打印）
- [x] 表格三期：隐藏行列 + 冻结窗格 xlsx+ODS 全链路往返（OOXML/collapse+settings → Univer → 打印跳过）
- [x] 表格四期：公式 xlsx+ODS 全链路往返（`<f>`/of:= 换算 + 缓存值，Univer 引擎重算）
- [x] 表格：图表（VChart 渲染 PNG + Univer 社区浮动图片 + xlsx 原生图表往返，Excel 实机确认）
- [x] 文档：页眉页脚（含 PAGE 页码域）与目录（原生 TOC 域）docx 往返，Word 实机回归
- [x] 文档：批注（锚点标记 + 侧栏面板 + docx comments 往返）
- [x] PDF 查看（pdf.js）与文档导出（WebView2 PrintToPdf）
- [x] PDF：表格/演示导出
- [x] ODF（ods/odt）原生格式
- [x] 本地文件关联与"最近项目"跨设备同步（可选、端到端加密）
- [x] 发布工程：CI 矩阵打包（win+linux）与 GitHub Release
- [x] PDF 查看：滚轮翻页（溢出先滚动、触边再翻）+ Ctrl 滚轮缩放
- [x] PDF 查看：文字选择复制（TextLayer 透明字层叠加）
- [x] PDF 查看：全文搜索（命中定位 + Custom Highlight 高亮 + 上下导航）
- [x] PDF 查看：连续多页视图（IntersectionObserver 视口虚拟渲染/离屏释放）
- [x] 性能专项：PDF 位图 LRU 缓存 + 尺寸预取批量化 + 空闲预热编辑器 chunk
- [x] PDF 查看：缩略图 + 大纲（书签）侧栏（双页签虚拟渲染 + getOutline 解析跳页）
- [x] PDF 标注与高亮：选文字加高亮/便签，Ctrl+S 经 pdf-lib 写回原 PDF（读侧导入+往返保真）
- [x] PDF 标注编辑增强：标注工具点选/拖移/改色/删除（含第三方注解）+ Acrobat 风胶囊弹层
- [x] 文档：页面设置（纸张/边距，视图+打印+docx/odt 全链路）+ 分页参考线 + 页数指示
- [x] 文档：表格上下文工具条（行列/合并/表头，gridSpan/vMerge 导出）+ 图片粘贴成图与宽度/居中条
- [x] 文档：查找/替换面板（命中高亮+大小写+单个/全部替换）+ 字体族/字号（docx/odt 往返）
- [x] 文档：自动保存（.odoc 定时静默落盘）+ 会话内版本历史（快照环形栈一键恢复）
- [x] PDF 标注形状：矩形/椭圆/直线/手绘（绘制交互 + Square/Circle/Line/Ink 读侧导入 + pdf-lib 写回保真）
- [x] 首页模板体系：文档/表格/演示 11 个模板一键新建（三编辑器无路径分支各自 seed）+ 查找命中上限截断
- [x] 文档分页保真：`@page` margin box 逐页页眉页脚页码（四格式）+ 多栏排版 + 分页符 + 纸张/四边距贯穿 PrintToPdf（docx/odt 同步往返）
- [x] 表格：CSV 往返（RFC4180 状态机 + UTF-8/GBK 自动 + BOM/CRLF 写回 + 保存三分流）
- [x] PDF 页面管理：旋转/删除/提取/合并/拆分覆盖写回（标注跟随所在页，旋转页坐标按 `/Rotate` 换算）
- [x] 性能：表格命令 async（spawn_blocking）+ 图表网格惰性构建、PDF 位图缓存像素预算、文档字数节流
- [x] 性能二期：大 PDF 分段读取（`file_len`/`read_range` raw IPC + `PDFDataRangeTransport`）+ Univer 首开并行化 + 预热实证边界（更激进的实例级预热实测零收益，已删）
- [x] 性能三期：首开挂载不再走 Suspense（外壳+编辑器自持已解析组件，绕开 ~300ms 兜底节流）+ effect 改 layout + 公式 worker 线程池 A/B 裁决为删
- [x] 文档：docx 保真导入（直接格式/缩进/列表层级/表格合并/图片/批注，mammoth 退为兜底）+ 缩进 schema 与 docx/odt 往返 + Word 实机回归
- [x] 文档保真续项：上下标 `w:vertAlign` + 单元格四边/底纹/竖排对齐 + 表格缩进/段落右缩进 读入，.odoc/docx/odt 三链路回写（Word 16.0 实机 + Word 另存件差分与再读回双向核对）
- [x] 文档保真续项三：段落行距（倍数/固定值/最小值）+ 段前段后 + 底纹与四边 `w:spacing`/`w:shd`/`w:pBdr` 读入，docx/odt 回写（Word 16.0 实机 20 断言 + Word 另存件 OOXML 差分 24 断言）
- [x] 文档保真续项四：脚注/尾注真往返（`note` 内联原子节点 + 编号按文档顺序现算 + OOXML `word/footnotes.xml`·`endnotes.xml` 与 ODF 1.2 内联写法双向（含旧版 `text:note` 外壳）+ 文末脚注区编辑与打印）
- [x] 文档保真续项五：文本框展平（`w:txbxContent` 新旧两种外壳 + ODF `draw:text-box`，位置与环绕不保但字不丢）+ 公式线性化（OMML 与 MathML 翻成同一套 `x^2`/`a/b`/`√(y)`/`∑_i^n`）+ `mc:AlternateContent` 只取一支（Word 16.0 只读腿按 `wdTextFrameStory` 逐句核对）
- [x] 文档保真续项六之一：SmartArt（`diagrams/dataN.xml` 的 DiagramML 数据模型 → 嵌套列表）与图表（`charts/chartN.xml` 的 ChartML 缓存值 → 标题 + 数据表）读回，格内走层级缩进展平，还原不了的记边界
- [x] 文档保真续项六之二：域**编号重算**（`SEQ` 按文档顺序现算并压掉缓存、`\* ROMAN`/`\* roman`/`\* ALPHABETIC`/`\* alphabetic` 四形态按开关自身大小写、`REF` 无缓存时按书签所在段落文本兜底、`PAGE`/`PAGEREF`/`DOCPROPERTY` 沿缓存且无缓存记边界、`fldSimple` 同路、被跳过的目录不占号）+ OLE 嵌入对象预览解不开时留一行看得见的占位（ProgID + 部件文件名，.odoc/docx/odt 三链路都在）
- [x] 文档保真续项六剩下：OLE 嵌入对象的**内容**提取（复合文档 `cfb.ts` + `\x01Ole10Native` 的字段布局与兜底扫描 → 内层 docx 递归展开 / xlsx 与 CSV 取值成表 / txt 分段；两条接缝 docx `w:object` 与 ODT `draw:frame`（内联 base64 与 `Objects/objN/` 两种），块级正文作段落兄弟块、格内压行内，取不出的带真名与大小记边界）
- [x] 表格保真五期：筛选 / 数据验证 / 条件格式 **xlsx 全链路往返**（Univer `resources` 双向桥 + 门面放回界面 + OOXML autoFilter/dataValidation/cfRule·dxf·x14 读写，Excel 16.0 实机核对；被筛掉的行喂打印；ODS/CSV 只记边界账不谎称读回）
- [x] 表格保真六期：**PDF 打印保真**（条件格式在打印侧按载荷重算一遍→底色/字色/粗斜/数据条/色阶真上色，六处判据与 Excel 16.0 的 `DisplayFormat` 逐格核对；图表位图按锚点格覆盖进网格并让锚点撑开边界，"图浮在数据块外就整个不见"就此修掉；打印纸面兜白底（外壳的 `var(--bg)` 曾把整页铺成屏幕色）；算不出的一律进状态栏记账）
- [x] 表格保真七期：**批注 / 超链接 xlsx 全链路往返**（批注走 `resources` 的 `SHEET_NOTE_PLUGIN`、链接走每格的富文本 `customRanges`，两头都是纯函数所以**不放命令**；legacy `commentsN.xml` 与 `threadedComments`/`person.xml` 两种写法归一、气泡尺寸与常开从 `vmlDrawing` 认回；作者与悬停提示 Univer 装不下，按格子回贴且界面新写的那枚不冒用别人署名；写侧修掉 rust_xlsxwriter 把 `<authors>` 按名字排序而 `authorId` 按格子序登记的**串署名**缺陷（核对不过宁可不改）；Excel 16.0 只读腿对写侧原产物与应用重存件各跑一遍；ODS/CSV 只记边界账不谎称读回）
- [x] 自动更新通道（**检测层**，v0.45）：本机 Ed25519 密钥对签发的清单 + `check` 一次拿版本/说明/日期，
      有新版本就提示并**用浏览器打开下载页**；失败一律归成中文一句（源上没清单/非 https/缺本平台条目/签名不合…），
      认不出来的原样带出不编原因；不做应用内下载与安装，所以不需要先定更新源托管在哪
- [x] 导出保真：**暗色主题的纸面与屏幕脱钩**（漏色有两条独立的路——`color-scheme:dark` 让浏览器把**画布底色**
      涂深而被 PrintToPdf 抓走（这条连 `background:#fff !important` 都压不住），以及主题色以 `var()`/字面量落在
      真元素上；治法是"屏幕色必须先穿过一枚 CSS 变量"+ 一段排在暗色段之后的 `@media print` 调色板，
      内容自己声明的字面色（段落底纹 / 单元格底色 / 幻灯片背景）照旧上纸，查找命中高亮不上纸。
      判据：三链路 × 暗/亮各导一份 PDF，直方图**总变差 0**＝换主题不改纸；文档 96.6%→0.4%、表格 31.6%→0.1%）
- [x] 导出保真：**一张纸只说一次话**（`export_pdf` 的 `page` 契约＝"想要的纸面尺寸"，"竖版边长 + Orientation
      转置"只在 Rust 侧 `page_box()` 换算一次、五步设置失败一律原样报出；**@page 串台**——文档标签常驻 `head`
      的那份 `@page` 会被下一次 PrintToPdf 连 `size` 与页眉页脚一起认走，实测"导完文档再导演示"得到竖版纸
      `540×960`、幻灯片只剩 `0.34` 的一条带，治法是每条覆盖层作业把自己那份 `@page`（纸面 + 四边距 + 十六个
      margin box 复位）说全，而不是禁用别人的样式表；矮纸的 `min-height:900px` 打字区不再把正文顶成凭空一页）
- [x] 表格保真八期：**页面设置 xlsx 全链路往返 + 打印链路真的照着排**（纸张/方向/边距/缩放/网格线与行列标题/奇偶页与首页/页眉页脚三槽/打印区域与重复标题行列（workbook 级 definedName）/手动分页符，读侧七处 + 两条 definedName、写侧 odd 交 crate 其余搭同一趟定点重打包补；Univer 装不下这一层，按表名走侧通道且**保存与导出 PDF 共吃同一份计划**；列带按可印宽度切、一个带一张表、断点语义按实测取"这一行/列自己开始新页"；页眉页脚翻成 `@page` margin box 且 `&A/&P/&N/&D/&F` 真展开；Excel 16.0 只读腿对写侧夹具与应用重存的第三方件各跑一遍，CDP 真机按四页纸的 `MediaBox`/表头重复/半列居中位移逐项核对；ODS/CSV 只记边界账不谎称读回）
- [x] 表格**页面设置的编辑 UI**（v0.52：`src/lib/sheet-print-ui.ts` 供纯函数（毫米↔英寸、八档纸型、
      页眉页脚三槽↔OOXML 串、区域/整跨度↔0 基矩形、断点表、校验与"做不到"的账），`SheetEditor` 的面板
      写进 `printRef` 侧通道并被保存与导出 PDF 共吃；打印区域/重复标题行列「用当前选区」按门面选区给，
      「这一版纸上做不到」的四条账（起始页码、偶数页另版、缩放到 N 页高、垂直居中）在面板上当面说清且随草稿变；
      读侧不再把写侧工具替每张表落下的默认 `<pageMargins>` 当成声明）
- [x] 表格页面设置的打印二期（v0.53）：**缩放到 N 页高**与**垂直居中**接线（先把将要上纸的那份 DOM 在最终缩放之下
      量一遍——行高只能真量：新建的表一条 `rowHeights` 都没有、声明过的又只是下限，长文字那一行会自己撑到几百像素，
      且 CSS `zoom` 之后的行高不是线性折算；于是导出走 `build→measure→rebuild` 最多五趟，页高档按 1% 一档贪心下压，
      判的是「最高的那一个列带」装得下而不是总高，居中把留白写成 `padding-top` 落回量它的那份 DOM）；
      **起始页码**照做不到办——从「能设」降级为「只记账」，面板与状态栏当面说清（`@page` 通道只有一个 counter，
      没有「从 N 接着数」的对应物）；顺带修掉一条写侧缺陷：rust_xlsxwriter 逢 `pageSetup` 必补
      `orientation="portrait"`，面板没碰过方向的表存盘重开后纸面会自己翻了个面，现在按「声明与否」定点擦掉
- [ ] 起始页码的纸面通道：实测 Blink 认不认 `@page:first{counter-reset:page N-1}` 这类写法，认得动就把这条账从
      「只记账」升回「真上纸」，认不动就照做不到办并把话说死；同一条路上还挂着**偶数页另版**
      （`@page:left` / `@page:right` 与 `differentOddEven` 的对应关系没人量过）
- [ ] 打印排版的实测常数需要标定：`PRINT_ROW_BIAS_PX = 0.4`（屏底量到的行高比纸上短的那个数）是按当前这份夹具与
      默认字族字号标出来的，换字族/字号/行高很可能不是这个数——要么随字体度量标定，要么至少让「偏置是个魔法数」
      这件事在结构测试里能被点名
- [ ] 自动更新：应用内**下载并安装**（要先决策：真实更新源托管在哪、`updater:allow-download`+`allow-install` 权限、
      以及"装完自动重启"的取舍——见 v0.45 一节末尾的接线清单）
- [ ] macOS 打包（需签名/公证凭据）

## License

本项目代码 MIT；各内核组件遵循上表各自许可证。
