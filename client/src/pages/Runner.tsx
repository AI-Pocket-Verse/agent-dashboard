import { useWorkflowStore } from '../store/workflowStore'
import { useWsStore } from '../store/wsStore'
import WorkflowDAG from '../components/WorkflowDAG/index'
import LogStream from '../components/LogStream/index'
import ConfirmCard from '../components/ConfirmCard/index'
import type { NodeStatus } from '../types/index'

const RUN_STATUS_STYLE = {
  running: 'border border-[rgba(0,113,227,0.14)] bg-[rgba(0,113,227,0.08)] text-[#0058b0]',
  paused: 'border border-slate-200 bg-slate-100 text-slate-600',
}

export default function Runner() {
  const activeRuns = useWorkflowStore(s => s.activeRuns)
  const pendingConfirm = useWorkflowStore(s => s.pendingConfirm)
  const setPendingConfirm = useWorkflowStore(s => s.setPendingConfirm)
  const send = useWsStore(s => s.send)

  const runningRuns = activeRuns.filter(r => r.status === 'running' || r.status === 'paused')

  if (runningRuns.length === 0) {
    return (
      <div className="surface-panel-soft flex min-h-[320px] items-center justify-center rounded-[34px] px-8 text-center text-slate-500">
        暂无运行中的任务 - 去 Dashboard 发起一个新的协作流程
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {runningRuns.map(run => (
        <section key={run.id} className="surface-panel rounded-[32px] p-6 md:p-7">
          <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="section-kicker !mb-1">Live Run</p>
              <h2 className="text-[1.8rem] font-semibold tracking-[-0.035em] text-slate-950">{run.name}</h2>
            </div>
            <span className={`status-pill w-fit ${RUN_STATUS_STYLE[run.status as 'running' | 'paused']}`}>
              {run.status === 'running' ? '● 执行中' : '⏸ 等待确认'}
            </span>
          </div>

          <div className="space-y-4">
            <WorkflowDAG nodes={run.nodes} edges={run.edges} />

            <div className={`grid gap-3 ${
              run.nodes.filter(n => n.status !== 'pending').length > 2 ? 'lg:grid-cols-3 md:grid-cols-2' : 'md:grid-cols-2'
            }`}>
              {run.nodes
                .filter(n => n.status !== 'pending')
                .map(node => (
                  <LogStream
                    key={node.id}
                    runId={run.id}
                    nodeId={node.id}
                    logs={node.logs}
                    logCount={node.logCount}
                    agentName={node.agentName}
                    status={node.status as NodeStatus & ('running' | 'completed' | 'failed' | 'pending' | 'waiting')}
                  />
                ))}
            </div>

            {pendingConfirm?.runId === run.id && (
              <ConfirmCard
                runId={pendingConfirm.runId}
                nodeId={pendingConfirm.nodeId}
                agentName={run.nodes.find(n => n.id === pendingConfirm.nodeId)?.agentName ?? ''}
                summary={pendingConfirm.summary}
                nextNodeIds={pendingConfirm.nextNodeIds}
                onConfirm={(runId, nodeId, instruction) => {
                  send({ type: 'task:confirm', payload: { runId, nodeId, instruction } })
                  setPendingConfirm(null)
                }}
                onCancel={(runId) => {
                  send({ type: 'task:cancel', payload: { runId } })
                  setPendingConfirm(null)
                }}
              />
            )}
          </div>
        </section>
      ))}
    </div>
  )
}
