import type { AgentInfo, WorkflowTemplate } from '../types/index'

export const BUILTIN_OMC_AGENTS: AgentInfo[] = [
  { name: 'planner', type: 'omc', description: '需求规划', status: 'idle' },
  { name: 'test-engineer', type: 'omc', description: '测试验证', status: 'idle' },
  { name: 'designer', type: 'omc', description: '界面设计', status: 'idle' },
  { name: 'code-reviewer', type: 'omc', description: '代码审查', status: 'idle' },
  { name: 'security-reviewer', type: 'omc', description: '安全审查', status: 'idle' },
  { name: 'architect', type: 'omc', description: '架构设计', status: 'idle' },
  { name: 'writer', type: 'omc', description: '文档整理', status: 'idle' },
  { name: 'debugger', type: 'omc', description: '问题排查', status: 'idle' },
]

export const BUILTIN_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'builtin-fullstack',
    name: '🚀 全栈功能开发',
    description: '后端实现、前端联调、设计补位与测试验收的一条龙流程。',
    createdAt: 0,
    nodes: [
      { id: 'n1', agentName: 'backend-dev', agentType: 'custom', promptTemplate: '{{globalPrompt}} — 实现后端 API' },
      { id: 'n2', agentName: 'frontend-dev', agentType: 'custom', promptTemplate: '根据后端 API ({{nodes.n1.output}})，实现前端 UI' },
      { id: 'n3', agentName: 'designer', agentType: 'omc', promptTemplate: '为以下功能设计 UI 组件：{{globalPrompt}}' },
      { id: 'n4', agentName: 'test-engineer', agentType: 'omc', promptTemplate: '为已实现功能编写测试：{{nodes.n1.output}} / {{nodes.n2.output}}' },
      { id: 'n5', agentName: 'code-reviewer', agentType: 'omc', promptTemplate: '审查代码质量：{{nodes.n4.output}}' },
    ],
    edges: [
      { from: 'n1', to: 'n2' }, { from: 'n1', to: 'n3' },
      { from: 'n2', to: 'n4' }, { from: 'n3', to: 'n4' },
      { from: 'n4', to: 'n5' },
    ],
  },
  {
    id: 'builtin-bugfix',
    name: '🐛 Bug 修复',
    description: '先定位根因，再修复问题，并补齐验证测试。',
    createdAt: 0,
    nodes: [
      { id: 'n1', agentName: 'debugger', agentType: 'omc', promptTemplate: '分析以下 Bug：{{globalPrompt}}' },
      { id: 'n2', agentName: 'backend-dev', agentType: 'custom', promptTemplate: '修复 Bug：{{nodes.n1.output}}' },
      { id: 'n3', agentName: 'test-engineer', agentType: 'omc', promptTemplate: '验证修复并补充测试：{{nodes.n2.output}}' },
    ],
    edges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }],
  },
  {
    id: 'builtin-mobile',
    name: '📱 移动端开发',
    description: '面向 Flutter 客户端的接口实现、页面开发与回归测试。',
    createdAt: 0,
    nodes: [
      { id: 'n1', agentName: 'backend-dev', agentType: 'custom', promptTemplate: '实现后端 API：{{globalPrompt}}' },
      { id: 'n2', agentName: 'flutter-dev', agentType: 'custom', promptTemplate: '实现 Flutter 界面，后端已提供：{{nodes.n1.output}}' },
      { id: 'n3', agentName: 'test-engineer', agentType: 'omc', promptTemplate: '编写测试：{{nodes.n2.output}}' },
    ],
    edges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }],
  },
  {
    id: 'builtin-fullflow',
    name: '🔗 全流程',
    description: '从需求规划到开发、设计、测试、评审与安全检查的完整链路。',
    createdAt: 0,
    nodes: [
      { id: 'n1', agentName: 'planner', agentType: 'omc', promptTemplate: '规划以下功能：{{globalPrompt}}' },
      { id: 'n2', agentName: 'backend-dev', agentType: 'custom', promptTemplate: '实现后端：{{nodes.n1.output}}' },
      { id: 'n3', agentName: 'frontend-dev', agentType: 'custom', promptTemplate: '实现前端：{{nodes.n2.output}}' },
      { id: 'n4', agentName: 'designer', agentType: 'omc', promptTemplate: '设计 UI：{{nodes.n1.output}}' },
      { id: 'n5', agentName: 'test-engineer', agentType: 'omc', promptTemplate: '编写测试：{{nodes.n3.output}} / {{nodes.n4.output}}' },
      { id: 'n6', agentName: 'code-reviewer', agentType: 'omc', promptTemplate: '审查代码：{{nodes.n5.output}}' },
      { id: 'n7', agentName: 'security-reviewer', agentType: 'omc', promptTemplate: '安全审查：{{nodes.n6.output}}' },
    ],
    edges: [
      { from: 'n1', to: 'n2' }, { from: 'n1', to: 'n4' },
      { from: 'n2', to: 'n3' },
      { from: 'n3', to: 'n5' }, { from: 'n4', to: 'n5' },
      { from: 'n5', to: 'n6' },
      { from: 'n6', to: 'n7' },
    ],
  },
]
