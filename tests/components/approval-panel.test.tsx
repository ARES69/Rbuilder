/**
 * @vitest-environment jsdom
 *
 * ApprovalPanel: the ask-mode gate.
 *
 * This panel is the only place in the app where the agent stops and waits, and
 * every branch it has is a decision the user is making about their own
 * repository — allow these writes, allow this command, or neither. A regression
 * here is a regression in consent, so each branch is pinned: what is shown, what
 * the buttons say, and what a rejected item leaves behind.
 *
 * It is also here to keep the harness honest. One component's tests could pass
 * on a harness that quietly suited that component; a second one with a
 * different shape — pending, resolved, replaced — is what shows the harness is
 * general.
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '../harness'
import { ApprovalPanel, type Approval, type CommandApproval } from '../../src/components/ApprovalPanel'

/** The project as it stands, which proposed writes are diffed against. */
const FILES = [
  { path: 'app.js', content: 'v1\n' },
  { path: 'style.css', content: 'body { margin: 0 }\n' },
]

function fileApproval(files: { path: string; content: string }[], status: Approval['status'] = 'pending'): Approval {
  return { id: 'ap1', files, status }
}

function commandApproval(
  command: string,
  status: CommandApproval['status'] = 'pending',
): CommandApproval {
  return { id: 'cmd1', command, status }
}

describe('Правки, ждущие разрешения', () => {
  it('показывает, что агент собирается изменить, и сколько', () => {
    render(
      <ApprovalPanel
        approval={fileApproval([
          { path: 'app.js', content: 'v1\nv2\n' },
          { path: 'new.js', content: 'created\n' },
        ])}
        files={FILES}
        onApprove={() => {}}
        onReject={() => {}}
      />,
    )

    expect(screen.find('.approval-title')?.textContent).toContain('Предлагает изменения · 2 файла')
    expect(screen.texts('.approval-path')).toEqual(['app.js', 'new.js'])
    // One added line to a file that existed, plus a file of its own.
    expect(screen.text('.approval-totals')).toBe('+2 −0')
  })

  it('показывает, сколько строк добавит каждый файл, а не только сумму', () => {
    // The header total is a summary. The row is what says which file is about
    // to grow, and a batch whose total is right while every row reads "+0" is
    // a batch the user cannot judge before allowing it.
    render(
      <ApprovalPanel
        approval={fileApproval([
          { path: 'app.js', content: 'v1\nv2\nv3\n' },
          { path: 'new.js', content: 'created\n' },
        ])}
        files={FILES}
        onApprove={() => {}}
        onReject={() => {}}
      />,
    )

    expect(screen.texts('.approval-path')).toEqual(['app.js', 'new.js'])
    expect(screen.texts('.approval-file .diff-add')).toEqual(['+2', '+1'])
    expect(screen.texts('.approval-file .diff-del')).toEqual(['−0', '−0'])
  })

  it('разрешает и отклоняет по нажатию', () => {
    const onApprove = vi.fn()
    const onReject = vi.fn()
    render(
      <ApprovalPanel
        approval={fileApproval([{ path: 'app.js', content: 'v2\n' }])}
        files={FILES}
        onApprove={onApprove}
        onReject={onReject}
      />,
    )

    screen.click(screen.button('Разрешить'))
    screen.click(screen.button('Отклонить'))

    expect(onApprove).toHaveBeenCalledTimes(1)
    expect(onReject).toHaveBeenCalledTimes(1)
  })

  it('оставляет запись об отказе, а не пустое место', () => {
    // The user may want to see what was proposed after refusing it.
    render(
      <ApprovalPanel
        approval={fileApproval([{ path: 'app.js', content: 'v2\n' }], 'rejected')}
        files={FILES}
        onApprove={() => {}}
        onReject={() => {}}
      />,
    )

    expect(screen.find('.approval--rejected')).not.toBeNull()
    expect(screen.count('button')).toBe(0)
  })

  it('исчезает совсем, когда правки применены', () => {
    render(
      <ApprovalPanel
        approval={fileApproval([{ path: 'app.js', content: 'v2\n' }], 'approved')}
        files={FILES}
        onApprove={() => {}}
        onReject={() => {}}
      />,
    )

    expect(document.body.textContent?.trim()).toBe('')
  })
})

describe('Команда, ждущая разрешения', () => {
  it('показывает команду целиком, а не пересказ', () => {
    render(
      <ApprovalPanel
        approval={null}
        files={FILES}
        commandApproval={commandApproval('npm install --save-dev vitest')}
        onApprove={() => {}}
        onReject={() => {}}
        onApproveCommand={() => {}}
        onRejectCommand={() => {}}
      />,
    )

    // The whole command is what gets run, so nothing may be trimmed off it.
    expect(screen.text('.approval-command')).toBe('npm install --save-dev vitest')
    expect(screen.need('.approval').getAttribute('aria-label')).toBe('Требуется подтверждение команды')
  })

  it('запускает и отклоняет команду отдельными кнопками', () => {
    const onApproveCommand = vi.fn()
    const onRejectCommand = vi.fn()
    render(
      <ApprovalPanel
        approval={null}
        files={FILES}
        commandApproval={commandApproval('npm test')}
        onApprove={() => {}}
        onReject={() => {}}
        onApproveCommand={onApproveCommand}
        onRejectCommand={onRejectCommand}
      />,
    )

    screen.click(screen.button('Запустить'))
    screen.click(screen.button('Отклонить'))

    expect(onApproveCommand).toHaveBeenCalledTimes(1)
    expect(onRejectCommand).toHaveBeenCalledTimes(1)
  })

  it('закрывается после отказа, оставляя только пометку', () => {
    render(
      <ApprovalPanel
        approval={null}
        files={FILES}
        commandApproval={commandApproval('npm test', 'rejected')}
        onApprove={() => {}}
        onReject={() => {}}
        onApproveCommand={() => {}}
        onRejectCommand={() => {}}
      />,
    )

    expect(screen.need('.approval--rejected').getAttribute('aria-label')).toBe('Команда отклонена')
    expect(screen.count('button')).toBe(0)
  })

  it('показывает команду вместо очереди правок, а не обе карточки', () => {
    // Ask mode holds a command while writes wait behind it; two cards at once
    // would leave the user unsure which one they were answering.
    render(
      <ApprovalPanel
        approval={fileApproval([{ path: 'app.js', content: 'v2\n' }])}
        files={FILES}
        commandApproval={commandApproval('npm test')}
        onApprove={() => {}}
        onReject={() => {}}
        onApproveCommand={() => {}}
        onRejectCommand={() => {}}
      />,
    )

    expect(screen.count('.approval')).toBe(1)
    expect(screen.text('.approval-command')).toBe('npm test')
  })

  it('не рисует ничего, когда очередь пуста', () => {
    render(<ApprovalPanel approval={null} files={FILES} onApprove={() => {}} onReject={() => {}} />)
    expect(document.body.textContent?.trim()).toBe('')
  })
})