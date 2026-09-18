# OpenOffices — 开源办公套件

> 天下苦 WPS / Office 久矣。这是一个用 **Rust + Tauri 2** 构建、完全由开源内核驱动的本地办公套件，
> 目标是文档（Writer）、表格（Calc）、演示（Impress）三件套，数据全程不出本机。

## 已实现（v0.1）

- **应用外壳**：类 WPS 首页、多标签工作区、最近文件（持久化）、新建/打开/另存为
- **表格（Calc）**：Univer 表格内核（中文界面、公式计算、工具栏），xlsx / xls / ods 读取与 xlsx 写出
- **文档（Writer）**：TipTap 富文本（标题/加粗/斜体/下划线/对齐/列表/引用/代码块/表格/图片/链接），
  docx 导入（mammoth）、docx 导出（docx）、自有 `.odoc`（JSON）存档格式
- **演示（Impress）**：占位模块，下一迭代实现

## 技术栈与开源组件

| 组件 | 用途 | 许可证 |
| --- | --- | --- |
| [Tauri 2](https://tauri.app) | 桌面壳（Rust 后端 + 系统 WebView） | MIT |
| [Univer](https://univer.ai) | 电子表格内核（渲染/公式/撤销重做） | Apache-2.0 |
| [TipTap 3](https://tiptap.dev) | 富文本编辑器内核（ProseMirror） | MIT |
| [mammoth.js](https://github.com/mwilliamson/mammoth.js) | docx → HTML 导入 | BSD-2 |
| [docx](https://github.com/dolanmiu/docx) | ProseMirror JSON → docx 导出 | MIT |
| [calamine](https://github.com/tafia/calamine) | Rust xlsx/xls/ods 读取 | MIT |
| [rust_xlsxwriter](https://github.com/jmcnamara/rust_xlsxwriter) | Rust xlsx 写出 | BSD-2 / Artistic-2.0 |
| [zustand](https://github.com/pmndrs/zustand) | 前端状态管理 | MIT |
| React 19 + Vite | UI 框架与构建 | MIT |

## 架构

```
src-tauri/            Rust 后端
  src/xlsx.rs         read_xlsx (calamine) / write_xlsx (rust_xlsxwriter) 命令
  capabilities/       dialog + fs 权限与路径作用域
src/                  React 前端
  store.ts            标签页 / 最近文件（zustand）
  lib/univer.ts       Univer 实例工厂（公式 worker）
  lib/univer-io.ts    xlsx 数据 ↔ Univer 快照 转换
  lib/docx.ts         docx 导入导出（ProseMirror JSON ↔ docx）
  components/         Home / Workspace / SheetEditor / DocEditor / PptEditor
```

表格文件流：`xlsx 磁盘 → Rust(calamine) → JSON 快照 → Univer 渲染`；保存反向经 `rust_xlsxwriter` 落盘。
文档文件流：`docx → mammoth → HTML → TipTap`；保存为 `.odoc` JSON 或导出 docx。

## 开发

```bash
pnpm install
pnpm tauri dev     # 桌面调试
pnpm build         # 前端类型检查 + 打包
cargo check        # Rust 后端检查（在 src-tauri 下）
```

环境要求：Rust (MSVC)、Node ≥ 20、WebView2 运行时。

## 路线图

- [ ] 演示模块：pptx 解析/预览 → 编辑与放映
- [ ] 表格：样式（字体/颜色/合并）随 xlsx 往返、图表（Univer plugins）
- [ ] 文档：页眉页脚、批注、目录
- [ ] PDF 查看（pdf.js）与导出
- [ ] ODF（ods/odt）原生格式
- [ ] 本地文件关联与"最近项目"跨设备同步（可选、端到端加密）

## License

本项目代码 MIT；各内核组件遵循上表各自许可证。
