import type { Tab } from '../store'

interface Props {
  tab: Tab
}

export default function PptEditor({ tab }: Props) {
  return (
    <div className="editor-pane">
      <div className="ppt-placeholder">
        <div className="ppt-icon">演</div>
        <h2>演示文稿{tab.path ? `：${tab.title}` : ''}</h2>
        <p>演示编辑模块正在开发中。规划中的开源内核：</p>
        <ul>
          <li>pptx 解析与预览（ECMA-376 PresentationML）</li>
          <li>基于 canvas 的幻灯片编辑与放映</li>
        </ul>
        <p className="ppt-note">当前版本可正常打开文档与表格模块。</p>
      </div>
    </div>
  )
}
