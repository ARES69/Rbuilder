import { describe, expect, it } from 'vitest'
import { canRewindTo, planRewind, rewindSummary } from '../src/lib/rewind'
import type { ChatMessage, TurnSnapshot } from '../src/lib/store'

let counter = 0

/** One assistant turn that wrote the given paths, remembering what was there. */
function turn(id: string, snapshots: TurnSnapshot[]): ChatMessage {
  counter += 1
  return {
    id,
    role: 'assistant',
    content: 'сделал',
    files: snapshots.map((entry) => entry.path),
    snapshots,
    status: 'done',
    createdAt: counter,
  }
}

function user(id: string): ChatMessage {
  counter += 1
  return { id, role: 'user', content: 'давай', status: 'done', createdAt: counter }
}

describe('План отката', () => {
  it('берёт состояние до первого из откатываемых ходов', () => {
    const messages = [
      user('u1'),
      turn('a1', [{ path: 'app.js', before: 'v1' }]),
      turn('a2', [{ path: 'app.js', before: 'v2' }]),
      turn('a3', [{ path: 'app.js', before: 'v3' }]),
    ]

    const plan = planRewind(messages, 1)

    // The oldest snapshot wins, or the rewind would restore the newest state.
    expect(plan.restore).toEqual([{ path: 'app.js', before: 'v1' }])
    expect(plan.remove).toEqual([])
    expect(plan.turnIds).toEqual(['a1', 'a2', 'a3'])
  })

  it('удаляет файл, которого до отката не было', () => {
    const messages = [user('u1'), turn('a1', [{ path: 'new.js', before: null }])]

    const plan = planRewind(messages, 1)

    expect(plan.remove).toEqual(['new.js'])
    expect(plan.restore).toEqual([])
  })

  it('создание, а потом правка того же файла — это удаление', () => {
    // Turn 1 creates the file, turn 2 edits it. Undoing both means the file
    // did not exist when the rewound point was reached.
    const messages = [
      user('u1'),
      turn('a1', [{ path: 'new.js', before: null }]),
      turn('a2', [{ path: 'new.js', before: 'v1' }]),
    ]

    expect(planRewind(messages, 1).remove).toEqual(['new.js'])
  })

  it('откатывает каждый путь ровно один раз', () => {
    const messages = [
      user('u1'),
      turn('a1', [{ path: 'a.js', before: 'a1' }, { path: 'b.js', before: 'b1' }]),
      turn('a2', [{ path: 'a.js', before: 'a2' }]),
    ]

    const plan = planRewind(messages, 1)

    expect(plan.restore.map((entry) => entry.path)).toEqual(['a.js', 'b.js'])
    expect(plan.restore.find((entry) => entry.path === 'a.js')?.before).toBe('a1')
  })

  it('пустой план, когда откатывать нечего', () => {
    expect(planRewind([user('u1'), user('u2')], 0)).toEqual({ restore: [], remove: [], turnIds: [] })
  })
})

describe('Кому предлагать откат', () => {
  const transcript = [
    user('u1'),
    turn('a1', [{ path: 'app.js', before: 'v1' }]),
    turn('a2', [{ path: 'app.js', before: 'v2' }]),
  ]

  it('предлагает на любом ходе, где есть что отменить', () => {
    expect(canRewindTo(transcript, 0)).toBe(true)
    expect(canRewindTo(transcript, 1)).toBe(true)
  })

  it('не предлагает на последнем ходе — там уже есть «Отменить»', () => {
    expect(canRewindTo(transcript, 2)).toBe(false)
  })

  it('не предлагает там, где ниже ничего не менялось', () => {
    expect(canRewindTo([user('u1'), user('u2'), user('u3')], 0)).toBe(false)
  })
})

describe('Формулировка отката', () => {
  it('перечисляет файлы, удаления и ходы', () => {
    const plan = planRewind(
      [
        user('u1'),
        turn('a1', [{ path: 'a.js', before: 'v1' }, { path: 'new.js', before: null }]),
        turn('a2', [{ path: 'a.js', before: 'v2' }]),
      ],
      1,
    )

    expect(rewindSummary(plan)).toBe('вернуть 1 файл, удалить 1 файл, отменить 2 хода')
  })

  it('молчит, когда откатывать нечего', () => {
    expect(rewindSummary(planRewind([user('u1')], 0))).toBeNull()
  })
})
