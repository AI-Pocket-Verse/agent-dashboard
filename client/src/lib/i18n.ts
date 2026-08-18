import { create } from 'zustand'

// Lightweight i18n: Chinese source strings are the keys; `t()` looks up the
// English dictionary and falls back to the key itself, so missing entries
// degrade to Chinese instead of breaking. Locale setting: 'system' follows
// navigator.language (zh* → Chinese, otherwise English).

export type LocaleSetting = 'system' | 'zh' | 'en'
export type Locale = 'zh' | 'en'

const STORAGE_KEY = 'dashboard_locale'

function systemLocale(): Locale {
  return navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export function resolveLocale(setting: LocaleSetting): Locale {
  return setting === 'system' ? systemLocale() : setting
}

function storedSetting(): LocaleSetting {
  const value = localStorage.getItem(STORAGE_KEY)
  return value === 'zh' || value === 'en' || value === 'system' ? value : 'system'
}

interface LocaleState {
  setting: LocaleSetting
  locale: Locale
  setSetting: (setting: LocaleSetting) => void
}

export const useLocaleStore = create<LocaleState>(set => ({
  setting: storedSetting(),
  locale: resolveLocale(storedSetting()),
  setSetting: setting => {
    localStorage.setItem(STORAGE_KEY, setting)
    set({ setting, locale: resolveLocale(setting) })
  },
}))

// Non-reactive translate: safe to call anywhere. App.tsx subscribes to the
// locale store, so a locale change re-renders the whole tree.
export function t(zh: string, params?: Record<string, string | number>): string {
  const locale = useLocaleStore.getState().locale
  let text = locale === 'en' ? (EN[zh] ?? zh) : zh
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      text = text.replace(`{${key}}`, String(value))
    }
  }
  return text
}

const EN: Record<string, string> = {
  // ── Navigation & App shell ──
  '创建': 'Create',
  '运行': 'Run',
  '模板': 'Templates',
  '历史': 'History',
  '复制成功': 'Copied',
  '语言': 'Language',
  '跟随系统': 'System',
  '简体中文': '简体中文',

  // ── Common actions & states ──
  '取消': 'Cancel',
  '确认': 'Confirm',
  '添加': 'Add',
  '完成': 'Done',
  '移除': 'Remove',
  '删除': 'Delete',
  '关闭': 'Close',
  '进入': 'Enter',
  '返回': 'Back',
  '终止': 'Stop',
  '预览': 'Preview',
  '加载中...': 'Loading...',
  '启动中...': 'Starting...',
  '执行中': 'Running',
  '执行中...': 'Running...',
  '已完成': 'Completed',
  '失败': 'Failed',
  '等待中': 'Pending',
  '等待确认': 'Awaiting confirmation',
  '运行中': 'Running',
  '暂停': 'Paused',
  '失败/取消': 'Failed / Canceled',
  '执行失败': 'Failed',
  '可继续': 'Ready to continue',
  '任务': 'Tasks',
  '流程': 'Flow',
  '代码': 'Code',
  '图片': 'Image',

  // ── Status / logs ──
  '日志加载失败': 'Failed to load logs',
  '已显示': 'Showing',
  '条日志': 'logs',
  '等待执行该节点': 'Waiting for this node to run',
  '点击一个节点查看详情': 'Click a node to view details',
  '说明': 'Description',
  '详情': 'Details',
  '最近日志': 'Recent logs',

  // ── File browser ──
  '选择本地文件': 'Select local file',
  '无法读取该目录': 'Cannot read this directory',
  '添加 {n} 个文件': 'Add {n} files',
  '选择文件': 'Select file',
  '选择目录': 'Select directory',
  '目录': 'directory',
  '文件': 'file',
  '选择当前目录': 'Select current directory',
  '上级目录': 'Parent directory',
  '空目录': 'Empty directory',
  '双击进入': 'Double-click to open',
  '已选 {n} 项：': 'Selected {n}: ',
  '未选择 - 点击文件选择，双击目录进入': 'Nothing selected — click a file to select, double-click a directory to open',
  '未选择 - 点击选择文件或目录，双击进入目录': 'Nothing selected — click to select a file or directory, double-click to open',
  '已选：': 'Selected: ',

  // ── Task form / code context ──
  '代码上下文': 'Code context',
  '为任务补充文件或目录，让 Agent 在更清晰的上下文里工作。': 'Attach files or directories so agents work with clearer context.',
  '为这个上下文补充一句说明（可选）...': 'Add an optional note for this context...',
  '添加到上下文': 'Add to context',
  '+ 选择文件或目录': '+ Select file or directory',
  'AI 自动选择': 'AI auto-select',
  '系统先澄清需求，再生成执行方案': 'Clarifies the request first, then generates an execution plan',
  '模板执行': 'Run template',
  '直接使用现成工作流路径': 'Use a ready-made workflow',
  '手动编排': 'Manual orchestration',
  '自行选择参与的 Agent 阵列': 'Pick the participating agents yourself',
  '文件超过 1 MB，暂不展示完整内容。': 'File exceeds 1 MB; full content is not displayed.',
  '这是二进制文件，暂不展示内容。': 'Binary file; content is not displayed.',
  '无法读取附件 {name}': 'Cannot read attachment {name}',
  '请选择一个模板': 'Select a template',
  '请至少选择一个 Agent': 'Select at least one agent',
  '提交失败，请重试': 'Submission failed, please retry',
  '引用已上传对象': 'Reference uploaded files',
  '删除引用': 'Remove reference',
  '暂无可引用的图片或文件': 'No images or files to reference yet',
  '说说你的想法...': 'Describe what you want to build...',
  '添加代码路径': 'Add code path',
  '模板选择': 'Choose template',
  '关闭模板弹窗': 'Close template dialog',
  '未填写模板描述': 'No template description',
  '节点': 'nodes',
  '已选中：': 'Selected: ',
  '暂未选择模板': 'No template selected',
  'Agent 选择': 'Choose agents',
  '关闭 Agent 弹窗': 'Close agent dialog',
  '自定义': 'Custom',
  '自定义 Agent': 'Custom agent',
  'OMC 内置 Agent': 'OMC built-in agent',
  '已选中 {n} 个 Agent': '{n} agents selected',
  '暂未选择 Agent': 'No agents selected',
  '代码选择': 'Choose code',
  '关闭代码弹窗': 'Close code dialog',
  '已添加 {n} 项代码路径': '{n} code paths added',
  '还没有添加代码路径': 'No code paths added yet',
  '+ 添加路径': '+ Add path',
  '补充说明（可选）...': 'Optional note...',
  '选择代码路径': 'Select code path',
  '支持单选文件或目录。': 'Select a single file or directory.',

  // ── Auth gate ──
  '输入访问密码（服务端 DASHBOARD_SECRET）': 'Enter the access password (server DASHBOARD_SECRET)',
  '访问密码': 'Access password',
  '密码错误，请重试': 'Wrong password, try again',
  '验证中…': 'Verifying…',

  // ── Workflow canvas / DAG ──
  '从下方圆点拖动连线': 'Drag from the bottom dot to connect',
  '已暂停，确认下一步': 'is paused — confirm the next step',
  '下一步：': 'Next: ',
  '检测到额度限制': 'Rate limit detected',
  '重置时间': 'Resets at',
  '可选：补充给后续 Agent 的要求...': 'Optional: extra instructions for the next agents...',

  // ── Agent descriptions ──
  '后端开发': 'Backend development',
  '前端开发': 'Frontend development',
  '移动端开发': 'Mobile development',
  '需求规划': 'Planning',
  '测试验证': 'Testing',
  '界面设计': 'UI design',
  '代码审查': 'Code review',
  '安全审查': 'Security review',
  '架构设计': 'Architecture',
  '文档整理': 'Documentation',
  '问题排查': 'Debugging',
  '专项开发': 'Specialized development',
  '未填写 Agent 描述': 'No agent description',

  // ── Built-in templates (display only; prompts stay as data) ──
  '🚀 全栈功能开发': '🚀 Full-stack feature',
  '后端实现、前端联调、设计补位与测试验收的一条龙流程。': 'Backend, frontend, design and testing in one pipeline.',
  '🐛 Bug 修复': '🐛 Bug fix',
  '先定位根因，再修复问题，并补齐验证测试。': 'Locate the root cause, fix it, and add regression tests.',
  '📱 移动端开发': '📱 Mobile development',
  '面向 Flutter 客户端的接口实现、页面开发与回归测试。': 'API, Flutter UI and regression tests for the mobile client.',
  '🔗 全流程': '🔗 End-to-end',
  '从需求规划到开发、设计、测试、评审与安全检查的完整链路。': 'Planning through development, design, testing, review and security in one chain.',

  // ── Dashboard / History ──
  '发布失败，请重试': 'Failed to submit, please retry',
  '运行快照数据不完整或已失效，暂时无法进入运行页': 'Run snapshot is incomplete or stale; cannot open the run view',
  '暂无历史记录': 'No history yet',
  '历史记录': 'History',
  '总数': 'Total',
  '异常': 'Issues',
  '最近项目': 'Recent projects',
  '项': 'items',
  '全部运行记录': 'All runs',
  '按时间查看协作历史，快速回顾每次运行的节点、状态和取消原因。': 'Browse runs chronologically — nodes, status and cancel reasons at a glance.',
  '最近更新：': 'Last updated: ',
  '继续倒计时': 'Resumes in',
  '终止运行': 'Stop run',
  '个节点': 'nodes',
  '取消于：': 'Canceled at: ',
  '原因：': 'Reason: ',
  '暂无运行中的任务 - 去 Dashboard 发起一个新的协作流程': 'No running tasks — start a new workflow from the Dashboard',

  // ── Runner page ──
  '已运行': 'Elapsed',
  '耗时': 'Took',
  '复杂任务改不好，试试 Agent 模式': 'For complex changes, try Agent mode',
  '可以上传图片复刻': 'Upload an image to replicate',
  '此目录为空': 'This directory is empty',
  '暂无 Agent 生成或修改的代码文件': 'No files created or modified by agents yet',
  '还没有找到这个任务的运行目录': 'Run workspace for this task not found yet',
  '无法读取该文件内容': 'Cannot read this file',
  '根目录': 'Root',
  '代码文件': 'Code files',
  '暂无文件': 'No files',
  '选择左侧文件查看内容': 'Select a file on the left',
  '点击左侧文件查看详细内容': 'Click a file on the left to view its content',
  '正在读取文件内容...': 'Reading file...',
  '等待 Agent 开始执行...': 'Waiting for agents to start...',
  '类型': 'Type',
  '时间': 'Time',
  '尚未开始执行': 'Not started yet',
  '点击流程中的节点查看运行状态和 Prompt': 'Click a node in the flow to see its status and prompt',
  '暂无可预览的内容': 'Nothing to preview yet',
  '· 等待 Agent 生成交付物（如 index.html、原型 HTML）': '· Waiting for agents to produce deliverables (e.g. index.html)',
  '· 或在「代码」Tab 中打开任意 .html 文件，点击右上角「预览」': '· Or open any .html file in the Code tab and click Preview',
  '无法读取该 HTML 文件': 'Cannot read this HTML file',
  '正在查找可预览的交付文件...': 'Looking for previewable deliverables...',
  '代码预览': 'Code preview',
  '交付预览': 'Deliverable preview',
  '返回交付预览': 'Back to deliverable preview',
  '关闭预览': 'Close preview',
  'AI 没有选择任何 Agent，请换一种描述后重试': 'AI selected no agents — rephrase and try again',
  '⚠️ Code-reviewer 发现问题': '⚠️ Code-reviewer found issues',
  '第 {used} / 3 轮 · 还可自动修复 {left} 次': 'Round {used} / 3 · {left} auto-fixes left',
  '涉及文件': 'Affected files',
  '规则建议：': 'Rule suggestion: ',
  '由': 'Fixed by',
  '修复 + 重新 code-reviewer 复审': 'then re-reviewed by code-reviewer',
  '规则未匹配：': 'No rule match: ',
  '将由 AI 根据问题描述选择合适的修复 Agent': 'AI will pick a suitable fix agent from the issue description',
  '接受问题，结束流程': 'Accept issues and finish',
  '立即自动修复': 'Auto-fix now',
  '选择运行中的任务': 'Choose a running task',
  '当前有多个任务正在执行，选择一个进入详细运行视图。': 'Multiple tasks are running — pick one to open its run view.',
  '创建新任务': 'Create new task',
  '运行快照数据不完整或已失效': 'Run snapshot incomplete or stale',
  '未命名项目': 'Untitled project',
  '运行快照数据刷新失败': 'Failed to refresh run snapshot',
  '继续任务启动超时，请重试': 'Continue timed out, please retry',
  'AI 任务分配失败，请重试': 'AI agent selection failed, please retry',
  '任务已终止': 'Task stopped',
  '继续任务创建失败，请重试': 'Failed to continue task, please retry',
  '正在加载历史快照...': 'Loading history snapshot...',
  '请返回历史记录重新选择一个任务': 'Go back to History and pick another task',
  '返回历史': 'Back to History',
  '正在恢复运行快照...': 'Restoring run snapshot...',
  '暂无运行中的任务': 'No running tasks',
  '去创建页面发起一个新的协作流程': 'Start a new workflow from the Create page',
  '去创建': 'Go to Create',
  '大模型正在选择合适的 Agent...': 'The model is selecting agents...',
  '正在启动工作流...': 'Starting workflow...',
  '第 {n} 轮': 'Round {n}',
  '执行失败，可在右侧任务栏查看完整日志': 'Failed — see full logs in the task panel',
  '等待确认后继续执行': 'Waiting for confirmation to continue',
  '已完成，详情请查看右侧任务栏': 'Completed — details in the task panel',
  '未能选出修复 agent': 'Could not select a fix agent',
  '启动自动修复失败，请重试': 'Failed to start auto-fix, please retry',
  '基于此任务继续提需求...': 'Continue this task with a new request...',
  '发送消息': 'Send',

  // ── Canvas ──
  '编排你的工作流': 'Design your workflow',
  '将节点按真实依赖关系从上到下组织，分支和汇合会自动展开。': 'Nodes are arranged top-down by dependency; branches and merges expand automatically.',
  '连线起点和终点不能是同一个节点': 'An edge cannot start and end on the same node',
  '相同的连线已经存在': 'This edge already exists',
  '模板名称必须唯一，已自动忽略首尾空格，请使用其他名称': 'Template names must be unique (whitespace trimmed) — choose another name',
  '未命名模板': 'Untitled template',
  '副本': 'copy',
  '保存模板': 'Save template',
  '填写模板名称和描述，保存当前编排结果。': 'Name and describe the template to save the current layout.',
  '确认保存': 'Save',
  '保存失败，请稍后重试': 'Save failed, try again later',
  '重命名模板': 'Rename template',
  '修改模板名称和描述，不影响当前编排内容。': 'Edit the name and description without changing the layout.',
  '确认修改': 'Save changes',
  '+ 新建': '+ New',
  '模板列表': 'Template list',
  '添加节点': 'Add nodes',
  '未保存': 'Unsaved',
  '内置': 'Built-in',
  '连接': 'edges',
  '暂无模板，请点击左上角新建': 'No templates — click “+ New” in the top left',
  '连接关系': 'Connections',
  '个上游': 'upstream',
  '个下游': 'downstream',
  '点击画布中的节点查看模板说明、Prompt 模板和连接关系': 'Click a node to view its description, prompt template and connections',
  '查看详情': 'View details',
  '编辑节点': 'Edit node',
  '复制节点': 'Duplicate node',
  '新增下游节点': 'Add downstream node',
  '删除节点': 'Delete node',
  '复制模板': 'Duplicate template',
  '内置模板不可删除或重命名': 'Built-in templates cannot be deleted or renamed',
  '删除模板': 'Delete template',
  '模板名称': 'Template name',
  '例如：全流程开发': 'e.g. End-to-end development',
  '模板描述': 'Template description',
  '简要描述这个模板适合处理什么任务': 'Briefly describe what this template is for',
  '删除后无法恢复，模板“{name}”会从模板列表中移除。': 'This cannot be undone — “{name}” will be removed from the template list.',
  '确认删除': 'Delete',
  '这会删除模板定义，但不会影响已经保存的历史运行记录。': 'This deletes the template definition; saved run history is unaffected.',
  '放弃未保存草稿': 'Discard unsaved draft',
  '当前草稿还没有保存，继续操作会丢失这些改动。': 'The draft is unsaved; continuing will lose these changes.',
  '继续编辑': 'Keep editing',
  '放弃草稿': 'Discard draft',
  '建议先点击右上角“保存模板”，否则刷新页面或切换模板后，这份草稿都会消失。': 'Click “Save template” first — refreshing or switching templates will lose this draft.',
  '编辑连线': 'Edit edge',
  '删除连线': 'Delete edge',
  '调整节点展示名称、Agent 类型和 Prompt。': 'Adjust the display name, agent type and prompt.',
  '新节点会自动连接到 {name} 后面。': 'The new node will be connected after {name}.',
  '当前节点': 'current node',
  '展示名称': 'Display name',
  '选填，用于替代默认 Agent 名称展示': 'Optional, overrides the default agent name',
  'Agent 类型': 'Agent type',
  '例如：基于 {{globalPrompt}} 继续完成这一部分': 'e.g. Continue this part based on {{globalPrompt}}',
  '支持修改起点和终点，也可以直接拖动线头或线尾快速改线。': 'Change the source and target, or drag either end of the edge directly.',
  '起点节点': 'Source node',
  '终点节点': 'Target node',
}
