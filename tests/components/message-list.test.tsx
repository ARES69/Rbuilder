/**
 * @vitest-environment jsdom
 *
 * MessageList: what a person can see and press in the transcript.
 *
 * The transcript is where the agent's work is reviewed, so its behaviour is
 * worth pinning down rather than eyeballing. These tests cover the parts with
 * decisions in them — which turn offers a rewind, what the confirmation says
 * before it throws work away, when a turn shows its commit, and which turn is
 * allowed to undo the last one — because each of those was wrong at least once
 * while this was being built.
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '../harness/render'
import { MessageList } from '../../src/components/MessageList'
import type { ChatMessage } from '../../src/lib/store'

let counter = 0

function user(id: string, content: string): ChatMessage {
  counter += 1
  return { id, role: 'user', content, status: 'done', createdAt: counter }
}

/** An assistant turn that wrote `path`, remembering what was there before. */
function turn(
  id: string,
  options: { content?: string; path?: string; before?: string | null; commit?: string; undone?: boolean } = {},
): ChatMessage {
  counter += 1
  const path = options.path ?? 'app.js'
  return {
    id,
    role: 'assistant',
    content: options.content ?? 'Готово.',
    files: [path],
    snapshots: [{ path, before: options.before ?? null }],
    commit: options.commit,
    undone: options.undone,
    status: 'done',
    createdAt: counter,
  }
}

/**
 * Three turns over one file, each committed, each rewriting what the last wrote.
 *
 * The snapshots say the file already existed (`before` is a version, not null),
 * because that is what a rewind over a real project looks like — and because a
 * fixture where every turn creates the file would make «удалить 1 файл» the only
 * summary these tests ever saw.
 */
function committed(): ChatMessage[] {
  return [
    user('u1', 'перепиши счётчик'),
    turn('a1', { content: 'Первый ход.', before: 'v1\n', commit: 'a1b2c3d' }),
    user('u2', 'добавь рамку'),
    turn('a2', { content: 'Второй ход.', before: 'v2\n', commit: 'd4e5f6a' }),
    user('u3', 'ещё раз'),
    turn('a3', { content: 'Третий ход.', before: 'v3\n', commit: 'b7c8d9e' }),
  ]
}

/** MessageList needs a filename list for the per-turn diffs. */
const FILES = [{ path: 'app.js', content: 'v4\n' }]

function show(messages: ChatMessage[], files = FILES) {
  render(
    <MessageList
      messages={messages}
      examples={['Счётчик', 'Витрина']}
      files={files}
      onExample={() => {}}
      onOpenFile={() => {}}
      onUndo={() => {}}
      onRewind={() => {}}
    />,
  )
}

describe('Пустой транскрипт', () => {
  it('предлагает начать, а не пустую ленту', () => {
    show([])
    expect(screen.find('.transcript--empty')).not.toBeNull()
    expect(screen.count('.turn')).toBe(0)
    expect(screen.text('.empty-state h2')).toBeTruthy()
  })

  it('запускает пример из приветствия', () => {
    const onExample = vi.fn()
    render(<MessageList messages={[]} examples={['Счётчик']} onExample={onExample} />)
    screen.click(screen.button('Счётчик'))
    expect(onExample).toHaveBeenCalledWith('Счётчик')
  })
})

describe('Коммит хода в транскрипте', () => {
  it('показывает короткий хеш рядом с ходом', () => {
    show(committed())
    expect(screen.texts('.turn-commit')).toEqual(['a1b2c3d', 'd4e5f6a', 'b7c8d9e'])
  })

  it('не показывает чип у хода, который коммитом не закончился', () => {
    // A turn from before the timeline existed, or one that wrote nothing to
    // disk: there is no commit to point at, and inventing one would be a lie.
    show([user('u1', 'давай'), turn('a1', { content: 'Без коммита.' })])
    expect(screen.count('.turn-commit')).toBe(0)
  })

  it('держит полный хеш в подсказке — он нужен для терминала', () => {
    show(committed())
    expect(screen.need('.turn-commit').getAttribute('title')).toBe('Коммит этого хода: a1b2c3d')
  })
})

describe('Откат к любому ходу', () => {
  it('предлагает его на прошлых ходах, но не на последнем', () => {
    // The newest turn already carries «Отменить» in its changes card, which
    // offers the same move without the confirmation.
    show(committed())
    // Five of the six turns; the newest one is left out.
    expect(screen.count('.turn-rewind')).toBe(5)
    const last = screen.all('.turn')[5]!
    expect(last.querySelector('.turn-rewind')).toBeNull()
  })

  it('не предлагает его там, где ниже ничего не менялось', () => {
    show([user('u1', 'а'), user('u2', 'б'), user('u3', 'в')])
    expect(screen.count('.turn-rewind')).toBe(0)
  })

  it('называет в подтверждении коммит, на который уедет ветка', () => {
    show(committed())
    // The button on the second user message: rewinding to it drops both turns
    // below and leaves the branch on the first turn's commit.
    screen.click(screen.all('.turn-rewind')[2])

    expect(screen.text('.confirm-question')).toBe(
      'вернуть 1 файл, отменить 2 хода? Ветка вернётся на a1b2c3d',
    )
  })

  it('сообщает индекс хода, к которому возвращаются', () => {
    const onRewind = vi.fn()
    render(
      <MessageList
        messages={committed()}
        examples={[]}
        files={FILES}
        onRewind={onRewind}
        onUndo={() => {}}
        onExample={() => {}}
      />,
    )

    // The third rewind button is the second user message, index 2.
    screen.click(screen.all('.turn-rewind')[2])
    screen.click(screen.button('Откатить'))

    expect(onRewind).toHaveBeenCalledWith(2)
  })

  it('сообщает индекс сообщения, а не строки ленты', () => {
    // The transcript is displayed as collapsed rows, so the row carrying a turn
    // can sit several positions above the message's own place. A rewind needs
    // the message index: the plan it builds walks the transcript, and a row
    // index would revert the wrong turn as soon as anything above it repeated.
    const onRewind = vi.fn()
    const messages: ChatMessage[] = [
      user('u0', 'начнём'),
      { ...turn('p1'), files: undefined, snapshots: undefined, content: 'Не получилось.' },
      { ...turn('p2'), files: undefined, snapshots: undefined, content: 'Не получилось.' },
      user('u1', 'перепиши'),
      turn('a1', { content: 'Переписал.', before: 'v1\n', commit: 'a1b2c3d' }),
      user('u2', 'и рамку'),
      turn('a2', { content: 'Рамка.', before: 'v2\n', commit: 'd4e5f6a' }),
    ]

    render(
      <MessageList
        messages={messages}
        examples={[]}
        files={FILES}
        onRewind={onRewind}
        onExample={() => {}}
      />,
    )

    // Sanity: the repeat really did collapse, which is what makes the two
    // indices different. Without this the test would pass for the wrong reason.
    expect(screen.text('.turn-repeat')).toBe('повтор ×2')
    expect(screen.count('.turn')).toBe(6)

    // Buttons run over rows — user, collapsed repeat, user, turn — so the
    // turn is on the fourth button, while its message index is 4.
    screen.click(screen.all('.turn-rewind')[3])
    screen.click(screen.button('Откатить'))

    expect(onRewind).toHaveBeenCalledWith(4)
  })

  it('«Нет» закрывает вопрос, ничего не откатывая', () => {
    const onRewind = vi.fn()
    render(
      <MessageList
        messages={committed()}
        examples={[]}
        files={FILES}
        onRewind={onRewind}
        onExample={() => {}}
      />,
    )

    screen.click(screen.all('.turn-rewind')[2])
    expect(screen.find('.turn-rewind-confirm')).not.toBeNull()

    screen.click(screen.button('Нет'))

    expect(onRewind).not.toHaveBeenCalled()
    expect(screen.find('.turn-rewind-confirm')).toBeNull()
  })
})

describe('Карточка изменений', () => {
  it('перечисляет файлы хода и их размер изменения', () => {
    show([user('u1', 'сделай'), turn('a1', { content: 'Сделал.', commit: 'a1b2c3d' })], [
      { path: 'app.js', content: 'v1\nv2\n' },
    ])

    expect(screen.text('.changes-title')).toBe('1 файл изменён')
    expect(screen.text('.changes-file')).toContain('app.js')
  })

  it('отменяет только последний ход, который что-то записал', () => {
    // Older snapshots would clobber whatever later turns did to the same files,
    // so the button belongs to the newest writing turn alone.
    const onUndo = vi.fn()
    render(
      <MessageList
        messages={committed()}
        examples={[]}
        files={FILES}
        onUndo={onUndo}
        onRewind={() => {}}
        onExample={() => {}}
      />,
    )

    expect(screen.count('.changes-undo')).toBe(1)
    screen.click(screen.button('Отменить ↺'))
    expect(onUndo).toHaveBeenCalledWith(expect.objectContaining({ id: 'a3' }))
  })

  it('помечает отменённый ход и больше не предлагает его отменить', () => {
    show([...committed().slice(0, 4), turn('a3', { commit: 'b7c8d9e', undone: true })])

    expect(screen.text('.changes-undone')).toBe('отменено')
    expect(screen.count('.changes-undo')).toBe(0)
  })
})

describe('Повторяющиеся ответы', () => {
  it('схлопывает одинаковые ответы подряд в один с пометкой', () => {
    // A model that cannot finish says the same thing again; four separate
    // paragraphs read as four results.
    const messages = [
      user('u1', 'давай'),
      turn('a1', { content: 'Не получилось.', path: undefined }),
      turn('a2', { content: 'Не получилось.', path: undefined }),
      turn('a3', { content: 'Не получилось.', path: undefined }),
    ].map((message) =>
      message.files ? { ...message, files: undefined } : message,
    ) as ChatMessage[]

    show(messages)

    expect(screen.count('.turn--assistant')).toBe(1)
    expect(screen.text('.turn-repeat')).toBe('повтор ×3')
  })

  it('не схлопывает ход, который записал файл', () => {
    const messages = [
      turn('a1', { content: 'Один и тот же ответ.' }),
      turn('a2', { content: 'Один и тот же ответ.' }),
    ]
    show(messages)
    expect(screen.count('.turn--assistant')).toBe(2)
    expect(screen.find('.turn-repeat')).toBeNull()
  })
})