import { useEffect, useRef } from 'react'
import { AttachmentChips } from './AttachmentChips'
import { Markdown } from './Markdown'
import type { ChatMessage } from '../lib/store'

type Props = {
  messages: ChatMessage[]
  examples: string[]
  onExample: (example: string) => void
}

function MessageContent({ content, compact }: { content: string; compact: boolean }) {
  if (!compact) return <Markdown text={content} />

  const fence = content.indexOf('```')
  if (fence < 0) return <Markdown text={content} compact />

  const prose = content.slice(0, fence).trim()
  return (
    <>
      {prose ? <Markdown text={prose} compact /> : null}
      <details className="message-context">
        <summary>Контекст прикреплённого файла</summary>
        <Markdown text={content.slice(fence)} compact />
      </details>
    </>
  )
}

export function MessageList({ messages, examples, onExample }: Props) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  if (messages.length === 0) {
    return (
      <div className="transcript transcript--empty">
        <div className="empty-state">
          <p className="empty-eyebrow">Версия 1 · предпросмотр</p>
          <h2>Опишите веб-приложение и наблюдайте за сборкой справа.</h2>
          <p className="empty-lede">
            Прикрепите любой файл для контекста — заметки, таблицу или скриншот. RBUILDER создаёт
            HTML, CSS и JavaScript, а предпросмотр обновляется по ходу работы.
          </p>
          <ul className="examples">
            {examples.map((example) => (
              <li key={example}>
                <button type="button" className="example" onClick={() => onExample(example)}>
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    )
  }

  return (
    <div className="transcript">
      {messages.map((message) => (
        <article key={message.id} className={`turn turn--${message.role}`}>
          <div className="turn-meta">{message.role === 'user' ? 'Вы' : 'RBUILDER'}</div>

          <div className="turn-body">
            {message.content ? <MessageContent content={message.content} compact={message.role === 'user'} /> : null}

            {message.role === 'assistant' && message.status === 'streaming' && !message.content ? (
              <p className="turn-working">Думаю…</p>
            ) : null}
          </div>

          {message.tools?.length ? (
            <ul className="tool-trace" aria-label="Вызовы инструментов">
              {message.tools.map((tool) => (
                <li key={tool.id} className={`tool tool--${tool.status}`}>
                  <details>
                    <summary className="tool-summary">
                      <span className="tool-dot" aria-hidden="true" />
                      <span className="tool-label">{tool.summary ?? tool.label}</span>
                      {!tool.summary && tool.detail ? (
                        <span className="chip-dim">{tool.detail}</span>
                      ) : null}
                    </summary>
                    <pre className="tool-output">
                      {tool.output ?? 'Ожидание результата от модели…'}
                    </pre>
                  </details>
                </li>
              ))}
            </ul>
          ) : null}

          {message.attachments?.length ? <AttachmentChips attachments={message.attachments} /> : null}

          {message.files?.length ? (
            <ul className="chips chips--files" aria-label="Созданные файлы">
              {message.files.map((path) => (
                <li key={path} className="chip chip--file">
                  {path}
                </li>
              ))}
            </ul>
          ) : null}

          {message.status === 'error' ? <p className="turn-error">Выполнение завершилось с ошибкой.</p> : null}
        </article>
      ))}
      <div ref={endRef} />
    </div>
  )
}
