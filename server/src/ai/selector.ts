import { spawnSync } from 'child_process'
import type { AiSelectResponse, AgentInfo } from '@agent-dashboard/shared'
import { config } from '../config.js'

function getProcessOutput(result: { stdout?: string | null; stderr?: string | null }) {
  return [result.stderr, result.stdout]
    .map(output => output?.trim())
    .filter((output): output is string => Boolean(output))
    .join('\n')
}

export class AiSelector {
  async selectAgents(task: string, availableAgents: AgentInfo[]): Promise<AiSelectResponse> {
    const agentList = availableAgents.map(a => `- ${a.name} (${a.type}): ${a.description}`).join('\n')

    const prompt = [
      'You are an AI team orchestrator.',
      'Given a task description and available agents, select appropriate agents and define execution order as a DAG.',
      'Return ONLY valid JSON, no markdown, no explanation outside JSON.',
      '',
      `Task: ${task}`,
      '',
      'Available agents:',
      agentList,
      '',
      'Return JSON format: { "nodes": [{"id": string, "agentName": string, "agentType": "custom"|"omc", "promptTemplate": string}], "edges": [{"from": string, "to": string}], "explanation": string }',
    ].join('\n')

    const result = spawnSync(config.claudeBin, ['-p', prompt], {
      encoding: 'utf-8',
      timeout: 60_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    if (result.error) throw result.error
    if (result.status !== 0) {
      throw new Error(getProcessOutput(result) || `AI selector exited with status ${result.status}`)
    }

    const output = result.stdout

    // Extract JSON from output (claude may add surrounding text)
    const match = output.match(/\{[\s\S]*\}/)
    if (!match) throw new Error(getProcessOutput(result) || 'No JSON found in claude output')
    const parsed = JSON.parse(match[0]) as AiSelectResponse
    if (!Array.isArray(parsed.nodes) || parsed.nodes.length === 0) {
      throw new Error('至少需要选择一个 Agent')
    }
    if (!Array.isArray(parsed.edges)) {
      throw new Error('AI selector returned invalid edges')
    }
    return parsed
  }
}
