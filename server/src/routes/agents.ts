import type { FastifyPluginAsync } from 'fastify'
import type { AgentInfo } from '@agent-dashboard/shared'
import { readdirSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { config } from '../config.js'

const parseAgentDescription = (filePath: string): string => {
  try {
    const content = readFileSync(filePath, 'utf-8')
    const frontmatter = content.match(/^---\n([\s\S]*?)\n---/)
    const description = frontmatter?.[1].match(/^description:\s*(.+)$/m)?.[1]?.trim()
    return description?.replace(/^['"]|['"]$/g, '') ?? ''
  } catch {
    return ''
  }
}

const scanAgentDir = (dir: string): Array<Pick<AgentInfo, 'name' | 'description'>> => {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(file => {
      const name = file.replace(/\.md$/, '')
      return {
        name,
        description: parseAgentDescription(join(dir, file)),
      }
    })
}

const customAgents = (): Array<Pick<AgentInfo, 'name' | 'description'>> => {
  // 项目级：$PROJECT_ROOT/.claude/agents/（优先）
  const projectAgents = scanAgentDir(join(config.projectRoot, '.claude', 'agents'))
  // 全局级：~/.claude/agents/
  const globalAgents = scanAgentDir(join(process.env.HOME ?? '', '.claude', 'agents'))
  // 合并去重，项目级优先
  const seen = new Set(projectAgents.map(agent => agent.name))
  const extra = globalAgents.filter(agent => !seen.has(agent.name))
  return [...projectAgents, ...extra]
}

const omcAgents: AgentInfo[] = [
  { name: 'planner', type: 'omc', description: '需求规划', status: 'idle' },
  { name: 'test-engineer', type: 'omc', description: '测试策略', status: 'idle' },
  { name: 'designer', type: 'omc', description: 'UI/UX 设计', status: 'idle' },
  { name: 'code-reviewer', type: 'omc', description: '代码审查', status: 'idle' },
  { name: 'security-reviewer', type: 'omc', description: '安全审查', status: 'idle' },
  { name: 'architect', type: 'omc', description: '架构设计', status: 'idle' },
  { name: 'writer', type: 'omc', description: '技术文档', status: 'idle' },
  { name: 'debugger', type: 'omc', description: '根因分析', status: 'idle' },
]

const agentsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/agents', async () => {
    const custom: AgentInfo[] = customAgents().map(agent => ({
      ...agent,
      type: 'custom',
      status: 'idle',
    }))
    return [...custom, ...omcAgents]
  })
}

export default agentsRoute
