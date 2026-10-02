import { useCallback, useEffect, useRef, useState } from 'react'
import { ApprovalPanel, type Approval, type CommandApproval } from './ApprovalPanel'
import { Composer } from './Composer'
import { MessageList } from './MessageList'
import { PlanPanel } from './PlanPanel'
import { readAttachments, type AttachmentMeta } from '../lib/attachments'
import type { Budget } from '../lib/budget'
import type { AgentMode, PlanItem } from '../lib/protocol'
import type { ChatMessage } from '../lib/store'

type Props = {
  messages: ChatMessage[]
  busy: boolean
  budget: { budget: Budget; wrappingUp: boolean } | null
  configured: boolean | null
  mode: AgentMode
  plan: PlanItem[]
  onModeChange: (mode: AgentMode) => void
  onApprovePlan: () => void
  onSend: (text: string, attachments: AttachmentMeta[]) => void
  onStop: () => void
  onOpenSettings: () => void
  /** Ask mode: the batch of writes waiting for the user's decision. */
  approval: Approval | null
  onApproveFiles: () => void
  onRejectFiles: () => void
  /** Ask mode: a command waiting for the user's decision. */
  commandApproval?: CommandApproval | null
  onApproveCommand?: () => void
  onRejectCommand?: () => void
  /** Current project files + transcript actions (diff rows, undo). */
  files: { path: string; content: string }[]
  onOpenFile: (path: string) => void
  onUndo: (message: ChatMessage) => void
  /** Provider + model shown in the composer, switchable in place. */
  providerName: string
  model: string | null
  models: { id: string; name: string; models: string[] }[]
  activeProviderId: string
  onProviderChange: (id: string) => void
  onModelChange: (model: string) => void
}

export const EXAMPLES = [
  'Ценовая страница для дизайн-студии',
  'Помодоро-таймер с горячими клавишами',
  'Дашборд с графиками из прикреплённого CSV',
]

export function ChatPanel({
  messages,
  busy,
  budget,
  configured,
  mode,
  plan,
  onModeChange,
  onApprovePlan,
  onSend,
  onStop,
  onOpenSettings,
  approval,
  onApproveFiles,
  onRejectFiles,
  commandApproval,
  onApproveCommand,
  onRejectCommand,
  files,
  onOpenFile,
  onUndo,
  providerName,
  model,
  models,
  activeProviderId,
  onProviderChange,
  onModelChange,
}: Props) {
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([])
  const [reading, setReading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)

  // Time left drains continuously but the budget only changes on an event, so
  // while a turn is running the panel re-renders once a second to keep it honest.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!busy || !budget) return
    const timer = setInterval(() => setTick((count) => count + 1), 1000)
    return () => clearInterval(timer)
  }, [busy, budget])

  const attach = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files)
    if (list.length === 0) return

    setReading(true)
    try {
      const read = await readAttachments(list)
      setAttachments((current) => [...current, ...read])
    } finally {
      setReading(false)
    }
  }, [])

  const send = useCallback(() => {
    if (busy || reading) return
    const text = draft.trim()
    if (!text && attachments.length === 0) return

    onSend(text, attachments)
    setDraft('')
    setAttachments([])
  }, [attachments, busy, draft, onSend, reading])

  return (
    <section
      className={`pane chat-pane${dragging ? ' is-dragging' : ''}`}
      aria-label="Чат"
      onDragEnter={(event) => {
        if (!event.dataTransfer?.types.includes('Files')) return
        event.preventDefault()
        dragDepth.current += 1
        setDragging(true)
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer?.types.includes('Files')) return
        event.preventDefault()
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragging(false)
      }}
      onDrop={(event) => {
        if (!event.dataTransfer?.files.length) return
        event.preventDefault()
        dragDepth.current = 0
        setDragging(false)
        void attach(event.dataTransfer.files)
      }}
    >
      <header className="pane-header">
        <h1 className="pane-title">Чат</h1>
        <span className="pane-subtitle">
          {busy
            ? mode === 'plan'
              ? 'Планирование…'
              : 'Сборка…'
            : messages.length > 0
              ? `${messages.length} сообщений`
              : 'Готово'}
        </span>
      </header>

      <MessageList
        messages={messages}
        examples={EXAMPLES}
        onExample={setDraft}
        files={files}
        onOpenFile={onOpenFile}
        onUndo={onUndo}
      />

      <ApprovalPanel
        approval={approval}
        files={files}
        onApprove={onApproveFiles}
        onReject={onRejectFiles}
        commandApproval={commandApproval}
        onApproveCommand={onApproveCommand}
        onRejectCommand={onRejectCommand}
      />

      <PlanPanel plan={plan} mode={mode} busy={busy} onApprove={onApprovePlan} />

      <Composer
        draft={draft}
        onDraftChange={setDraft}
        onSend={send}
        onStop={onStop}
        busy={busy}
        budget={budget?.budget ?? null}
        wrappingUp={budget?.wrappingUp ?? false}
        reading={reading}
        attachments={attachments}
        onAttach={(files) => void attach(files)}
        onRemoveAttachment={(id) => setAttachments((current) => current.filter((a) => a.id !== id))}
        configured={configured}
        mode={mode}
        onModeChange={onModeChange}
        onOpenSettings={onOpenSettings}
        providerName={providerName}
        model={model}
        models={models}
        activeProviderId={activeProviderId}
        onProviderChange={onProviderChange}
        onModelChange={onModelChange}
      />

      {dragging ? (
        <div className="dropzone" aria-hidden="true">
          <span>Перетащите файлы сюда</span>
        </div>
      ) : null}
    </section>
  )
}
