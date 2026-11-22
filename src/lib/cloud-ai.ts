// Writer 的 AI 能力（v0.229）：免密钥调用 WorkBuddy 云服务的大模型。
//
// 配置来自 workbuddy_cloud_service 的 activate 返回值（publicConfig）——endpoint /
// publishableKey 都是可公开的前端值，不含租户密钥。这里的 endpoint 不是手写域名：
// 它由该应用的激活结果给定，换应用就必须换这两个值。
//
// 纪律（skills/cloud-service/references/llm/code-generation.md）：
//   · 只用官方 SDK @tencent-ai/workbuddy-cloud-sdk，不手写 /.cloud/** fetch
//   · 每次 create() 的第一条必须是 system 消息
//   · 只支持流式（stream: true）；一次性任务也收齐 delta 再用
//   · 选中的正文是用户数据：只作为 user 消息送入，不改写系统指令
import { createWorkBuddyCloud } from '@tencent-ai/workbuddy-cloud-sdk'

const PUBLIC_CONFIG = {
  endpoint: 'https://openoffices-ai.app.workbuddy.host',
  publishableKey: 'wbpk_N4VK7j0mgaotxrtvH6E3Jp_eVlKTb11y2Lxqau5Wz9m043zTWUwfdRA',
} as const

const cloud = createWorkBuddyCloud(PUBLIC_CONFIG)

export type AiAction = 'summary' | 'polish' | 'english'

/** 三个预设的系统提示词：稳定的行为规则住在 system，选中文字只进 user */
export const AI_ACTION_SYSTEM: Record<AiAction, string> = {
  summary: '你是中文文档助手。把用户给的正文压缩成不超过三句的摘要，只输出摘要本身，不要解释。',
  polish: '你是中文文档助手。润色用户给的正文：改正错别字与病句，保留原意、语气和专有名词，只输出润色后的正文。',
  english: '你是文档翻译助手。把用户给的正文翻译成自然流畅的英文，保留专有名词和段落结构，只输出译文。',
}

export const AI_ACTION_LABEL: Record<AiAction, string> = {
  summary: '摘要',
  polish: '润色',
  english: '译英',
}

export interface AiModel {
  id: string
  name?: string
  disabled?: boolean
}

/** 送模前的统一闸门：空串不送，过长正文截断（避免一次调用吃满额度），控制符不进提示词 */
export function prepareAiSource(raw: string, maxLen = 12000): string {
  return (raw ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .trim()
    .slice(0, maxLen)
}

/** 模型清单：空数组是合法结果，调用方要显式提示；disabled 的不可选 */
export async function listAiModels(): Promise<AiModel[]> {
  const models = await cloud.llm.models.list()
  return models
    .filter((m) => typeof m.id === 'string' && m.id)
    .map((m) => ({ id: m.id, name: m.name ?? m.id, disabled: m.disabled === true }))
}

/** 流式跑一次预设动作；每收到一段 delta 就回调，返回收齐的全文 */
export async function runAiAction(
  action: AiAction,
  source: string,
  modelId: string,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const text = source.trim()
  if (!text) throw new Error('没有选中的正文')
  if (!modelId) throw new Error('没有选中的模型')
  let out = ''
  for await (const chunk of cloud.llm.chat.completions.create({
    model: modelId,
    messages: [
      { role: 'system', content: AI_ACTION_SYSTEM[action] },
      { role: 'user', content: text },
    ],
    stream: true,
    signal,
  })) {
    const delta = chunk.choices[0]?.delta
    if (delta?.content) {
      out += delta.content
      onDelta(delta.content)
    }
  }
  return out
}

/** 把 SDK 的错误码翻成用户能看懂的一句话；不发后端栈，也不把 auth_ 说成「重新登录」 */
export function aiErrorMessage(e: unknown): string {
  const code = (e as { error?: { code?: string } } | null)?.error?.code ?? ''
  if (code.startsWith('auth_')) return '云服务连接被拒绝（域名或授权不匹配），请检查应用发布配置'
  if (code.startsWith('quota_')) return '额度不足或请求过密，请稍后再试'
  if (code.startsWith('request_')) return '请求参数或模型不匹配，请换一个模型重试'
  if (code === 'gateway_stream_interrupted') return '生成中断，已保留已有内容，可以重试'
  if (code.startsWith('gateway_') || code.startsWith('model_')) return '模型服务暂时不可用，请重试'
  const msg = (e as { message?: string } | null)?.message ?? ''
  return msg ? `AI 调用失败：${msg.slice(0, 120)}` : 'AI 调用失败'
}
