/**
 * 兼容桩的常驻标识（v0.196 整合轮）。
 *
 * 远程主线引用了 7 个从未提交 git 的模块（spell/collab/macro/vba/identity/
 * pdf-text-edit/slide-chart），本轮以 API 兼容桩顶上。这些功能界面在、能点，
 * 但执行会明确报错或不生效。这个标识让用户在打开面板的第一眼就知道，
 * 而不是点了「运行/保存」撞到错误才知道。
 *
 * 真源码到位、桩被整文件替换后，把用到本组件的地方一并删掉即可。
 */
export default function StubNotice({
  label,
  compact = false,
  text,
}: {
  /** 功能名，如「拼写检查」「实时协同」 */
  label: string
  /** 紧凑模式：用于窄面板（如幻灯片图表数据条），不带外框 */
  compact?: boolean
  /** 自定义说明；默认「{label}当前为兼容桩，功能不可用」 */
  text?: string
}) {
  return (
    <span
      className={`stub-notice${compact ? ' stub-notice-compact' : ''}`}
      role="status"
      title="远程主线的这份功能源码从未提交 git，本地已用兼容桩顶上：界面可操作，但执行会明确报错或不生效。真源码入库后本提示会移除。"
    >
      <span className="stub-notice-tag">未入库</span>
      {text ?? `${label}当前为兼容桩，功能不可用`}
    </span>
  )
}
