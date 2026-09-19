# OpenOffices — 开源办公套件

> 天下苦 WPS / Office 久矣。这是一个用 **Rust + Tauri 2** 构建、完全由开源内核驱动的本地办公套件，
> 目标是文档（Writer）、表格（Calc）、演示（Impress）三件套，数据全程不出本机。

## 已实现（v0.2）

- **应用外壳**：类 WPS 首页、多标签工作区（标签右键菜单）、最近文件（持久化）、新建/打开/另存为、
  快捷键（Ctrl+O/S/Shift+S/W/N/Tab 切换）、拖拽文件到窗口打开、关闭前未保存确认、暗色/亮色主题、
  Workspace 懒加载（主包 8MB → 250KB）
- **表格（Calc）**：Univer 表格内核（中文界面、公式计算、工具栏），xlsx / xls / ods 读取与 xlsx 写出；
  第二轮新增社区高级预设五件套——**筛选排序、排序、条件格式、数据验证、查找替换**
  （注：Univer `preset-sheets-advanced` 属商业版，本项目只用 Apache-2.0 社区预设）
- **文档（Writer）**：TipTap 富文本（标题/加粗/斜体/下划线/删除线/对齐/列表/引用/代码块/表格/图片/链接），
  第二轮新增**字色、多色高亮、实时字数统计、打印/导出 PDF（系统打印对话框）**，
  颜色与高亮映射进 docx（`w:color` / `w:shd`）；docx 导入（mammoth）、docx 导出（docx）、自有 `.odoc`（JSON）存档
- **演示（Impress-lite）**：自研轻量幻灯片编辑器——标题/要点/图片/空白四种版式、6 套主题色、
  页序调整、缩略图侧栏、全屏放映（←/→/空格翻页、N 切换备注、Esc 退出）；
  **pptx 导出**（pptxgenjs）与 **pptx 导入解析**（jszip + DOMParser，含图片提取还原），
  自有 `.opd`（JSON）存档格式

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

## 性能（v0.3）

- **按编辑器分包 + 懒加载**：主包 8MB → 首屏约 300KB；Univer（6.1MB）只在首次激活表格标签时加载，
  TipTap/docx（836KB）与 pptxgenjs/jszip 同理按编辑器按需加载，mammoth/pptxgenjs/jszip 进一步延迟到导入/导出动作
- **编辑器懒挂载**：标签首次激活才创建 Univer/TipTap 重型实例，之后切换保留状态不重复初始化
- **渲染裁剪**：三个编辑器与幻灯片缩略图 `React.memo` 化；store 的 `markDirty` 幂等去重，
  避免 Univer 每条命令都触发无关标签重渲染
- **Rust release profile**：`lto = true`、`codegen-units = 1`、`strip = true`、`panic = "abort"`

## 技术栈与开源组件

| 组件 | 用途 | 许可证 |
| --- | --- | --- |
| [Tauri 2](https://tauri.app) | 桌面壳（Rust 后端 + 系统 WebView） | MIT |
| [Univer](https://univer.ai) | 电子表格内核（渲染/公式/撤销重做）+ 筛选/排序/条件格式/数据验证/查找替换社区预设 | Apache-2.0 |
| [TipTap 3](https://tiptap.dev) | 富文本编辑器内核（ProseMirror），含 color / highlight / character-count 扩展 | MIT |
| [mammoth.js](https://github.com/mwilliamson/mammoth.js) | docx → HTML 导入 | BSD-2 |
| [docx](https://github.com/dolanmiu/docx) | ProseMirror JSON → docx 导出 | MIT |
| [pptxgenjs](https://gitbrent.github.io/PptxGenJS/) | 幻灯片 → pptx 导出 | MIT |
| [JSZip](https://github.com/Stuk/jszip) | pptx（zip）解包导入 | MIT |
| [calamine](https://github.com/tafia/calamine) | Rust xlsx/xls/ods 读取 | MIT |
| [rust_xlsxwriter](https://github.com/jmcnamara/rust_xlsxwriter) | Rust xlsx 写出（含 Format 样式/合并） | BSD-2 / Artistic-2.0 |
| [zip](https://github.com/zip-rs/zip) | Rust xlsx 解包（读取样式/合并 XML） | MIT |
| [quick-xml](https://github.com/tafia/quick-xml) | Rust OOXML 流式解析 | MIT |
| [zustand](https://github.com/pmndrs/zustand) | 前端状态管理 | MIT |
| React 19 + Vite | UI 框架与构建 | MIT |

## 架构

```
src-tauri/            Rust 后端
  src/xlsx.rs         read_xlsx (calamine) / write_xlsx (rust_xlsxwriter) 命令，含样式与合并区
  src/xlsx_style.rs   zip + quick-xml 直读 xlsx 的 styles.xml / mergeCells（calamine 无样式 API）
  capabilities/       dialog + fs 权限与路径作用域
src/                  React 前端
  store.ts            标签页 / 最近文件 / 主题（zustand）
  App.tsx             全局快捷键、拖拽打开、关闭确认、懒加载路由
  lib/univer.ts       Univer 实例工厂（公式 worker + 五个社区高级预设）
  lib/univer-io.ts    xlsx 数据+样式/合并 ↔ Univer 快照 转换（样式去重注册）
  lib/docx.ts         docx 导入导出（ProseMirror JSON ↔ docx，含字色/高亮映射）
  lib/ppt.ts          .opd 幻灯片数据模型（版式/主题/序列化）
  lib/pptx-export.ts  Deck → pptx（pptxgenjs）
  lib/pptx-import.ts  pptx → Deck（JSZip 解包 + OOXML 解析 + 媒体还原）
  lib/registry.ts     跨组件保存器注册表（Ctrl+S 路由到当前标签）
  lib/open.ts         路径→标签 打开 / 带确认关闭
  components/         Home / Workspace / SheetEditor / DocEditor / PptEditor
```

表格文件流：`xlsx 磁盘 → Rust(calamine 值 + zip/quick-xml 样式合并) → JSON 快照 → Univer 渲染`；保存反向经 `rust_xlsxwriter` 落盘。
文档文件流：`docx → mammoth → HTML → TipTap`；保存为 `.odoc` JSON 或导出 docx。
演示文件流：`pptx → JSZip 解包 OOXML → Deck 模型 → 编辑器`；保存为 `.opd` JSON 或经 pptxgenjs 导出 pptx。

## 开发

```bash
pnpm install
pnpm tauri dev     # 桌面调试
pnpm build         # 前端类型检查 + 打包
cargo check        # Rust 后端检查（在 src-tauri 下）
```

环境要求：Rust (MSVC)、Node ≥ 20、WebView2 运行时。

## 路线图

- [x] 演示：pptx 母版/背景图还原、演讲者备注
- [x] 演示：动画、演讲者视图（双屏备注独立窗口）
- [x] 演示：元素级动画（逐条入场）与自动换页计时
- [x] 演示：动画映射 PowerPoint 原生 timing 树（元素级跨端保真）
- [x] 演示：动画方向/出场效果补全 + PowerPoint 实机回放回归确认
- [x] 表格：样式（字体/颜色/合并）随 xlsx 往返
- [ ] 表格：图表（Univer plugins，需先调研社区/商业许可边界）
- [ ] 文档：页眉页脚、批注、目录
- [ ] PDF 查看（pdf.js）与导出
- [ ] ODF（ods/odt）原生格式
- [ ] 本地文件关联与"最近项目"跨设备同步（可选、端到端加密）

## License

本项目代码 MIT；各内核组件遵循上表各自许可证。
