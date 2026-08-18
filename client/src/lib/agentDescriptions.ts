import type { AgentInfo } from '../types/index'
import { t } from './i18n'

const AGENT_DESCRIPTION_MAP: Record<string, string> = {
  'backend-dev': '后端开发',
  'frontend-dev': '前端开发',
  'flutter-dev': '移动端开发',
  'planner': '需求规划',
  'test-engineer': '测试验证',
  'designer': '界面设计',
  'code-reviewer': '代码审查',
  'security-reviewer': '安全审查',
  'architect': '架构设计',
  'writer': '文档整理',
  'debugger': '问题排查',
}

const CUSTOM_AGENT_DESCRIPTION_RULES: Array<{ pattern: RegExp; text: string }> = [
  {
    pattern: /(go backend|restful api|mysql|redis|jwt|gorm|backend service)/i,
    text: '后端开发',
  },
  {
    pattern: /(react|tanstack query|shadcn|tailwind|routing|state management|frontend)/i,
    text: '前端开发',
  },
  {
    pattern: /(flutter|riverpod|dio|go_router|freezed|mobile client)/i,
    text: '移动端开发',
  },
]

function normalizeDescription(description: string): string {
  return description.replace(/\s+/g, ' ').trim()
}

function isChineseText(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text)
}

function getCustomAgentDisplayDescription(agent: Pick<AgentInfo, 'name' | 'description'>): string {
  const mapped = AGENT_DESCRIPTION_MAP[agent.name]
  if (mapped) return t(mapped)

  const normalized = normalizeDescription(agent.description)
  if (!normalized) return t('专项开发')
  if (isChineseText(normalized)) return t(normalized)

  const matched = CUSTOM_AGENT_DESCRIPTION_RULES.find(rule => rule.pattern.test(normalized))
  if (matched) return t(matched.text)

  return `${t('专项开发')} · ${agent.name}`
}

export function getAgentDisplayDescription(agent: Pick<AgentInfo, 'name' | 'type' | 'description'>): string {
  const mapped = AGENT_DESCRIPTION_MAP[agent.name]
  if (mapped) return t(mapped)

  if (agent.type === 'custom') return getCustomAgentDisplayDescription(agent)

  const normalized = normalizeDescription(agent.description)
  return normalized ? t(normalized) : t('未填写 Agent 描述')
}
