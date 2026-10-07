/**
 * @vitest-environment jsdom
 *
 * Tests for the harness itself — the querying half.
 *
 * These pin the properties a component test silently depends on. `type` is the
 * clearest one: assigning `element.value` looks like it works and reads back
 * correctly from the DOM, but React never sees it, so a controlled input stays
 * empty and the test passes while proving nothing. The same shape of mistake
 * lives in `button` (a partial match answers the wrong question) and in `need`
 * (returning null instead of throwing lets an interaction be skipped).
 *
 * So each test here is written to fail if the harness stops being strict.
 */

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { describe, expect, it } from 'vitest'
import { render, screen } from './index'

describe('Поиск в документе', () => {
  it('возвращает все совпадения по порядку', () => {
    render(
      <ul>
        <li className="row">a</li>
        <li className="row">b</li>
        <li className="row">c</li>
      </ul>,
    )

    expect(screen.count('.row')).toBe(3)
    expect(screen.texts('.row')).toEqual(['a', 'b', 'c'])
    expect(screen.all('.row')[0].tagName).toBe('LI')
  })

  it('находит узел за пределами контейнера', () => {
    // Queries go to the document, not to the container the component was mounted
    // into, because several components here render a portal. A container-scoped
    // harness would report these as missing.
    function Portals() {
      return (
        <div>
          <span className="inside">внутри</span>
          {createPortal(<span className="outside">снаружи</span>, document.body)}
        </div>
      )
    }

    const { container } = render(<Portals />)

    expect(container.querySelector('.outside')).toBeNull()
    expect(screen.find('.outside')).not.toBeNull()
    expect(screen.text('.outside')).toBe('снаружи')
  })

  it('отличает отсутствие от пустого ответа', () => {
    render(<span className="pad">  вокруг  </span>)

    expect(screen.text('.pad')).toBe('вокруг')
    expect(screen.find('.no-such-thing')).toBeNull()
    expect(screen.text('.no-such-thing')).toBeNull()
    expect(screen.count('.no-such-thing')).toBe(0)
  })

  it('нужен — значит нужен: need падает и называет селектор', () => {
    render(<span className="pad">вокруг</span>)

    expect(screen.need('.pad').textContent).toBe('вокруг')
    // Returning null here would let a test quietly skip the interaction it
    // thought it was performing.
    expect(() => screen.need('.no-such-thing')).toThrow('Нет элемента по селектору: .no-such-thing')
  })
})

describe('Кнопки по надписи', () => {
  it('находит кнопку по точной надписи, когда рядом есть похожая', () => {
    render(
      <div>
        <button type="button">Отклонить</button>
        <button type="button">Отклонить всё</button>
      </div>,
    )

    expect(screen.button('Отклонить').textContent).toBe('Отклонить')
    expect(screen.button('Отклонить всё').textContent).toBe('Отклонить всё')
  })

  it('не принимает более длинную надпись за нужную', () => {
    // Ask for «Отклонить» while only «Отклонить всё» exists. A partial match
    // would hand back that button and the test would click the wrong thing —
    // which in a consent flow is the bug the test exists to catch.
    render(<button type="button">Отклонить всё</button>)

    expect(() => screen.button('Отклонить')).toThrow('Нет кнопки «Отклонить»')
  })

  it('называет надпись, которой на странице нет', () => {
    render(<button type="button">Разрешить</button>)

    expect(() => screen.button('Запустить')).toThrow('Нет кнопки «Запустить»')
  })
})

describe('Нажатия', () => {
  it('нажимает по селектору, по узлу и по найденному элементу', () => {
    const pressed: string[] = []
    render(
      <div>
        <button type="button" className="first" onClick={() => pressed.push('по селектору')}>
          Раз
        </button>
        <button type="button" className="second" onClick={() => pressed.push('по узлу')}>
          Два
        </button>
        <button type="button" className="third" onClick={() => pressed.push('по найденному')}>
          Три
        </button>
      </div>,
    )

    screen.click('.first')
    screen.click(screen.need('.second'))
    screen.click(screen.find('.third'))

    expect(pressed).toEqual(['по селектору', 'по узлу', 'по найденному'])
  })

  it('отказывается нажимать то, чего нет', () => {
    render(<button type="button">Раз</button>)

    expect(() => screen.click('.no-such-thing')).toThrow('Нет элемента по селектору: .no-such-thing')
    expect(() => screen.click(null)).toThrow('Нечего нажимать')
  })
})

describe('Ввод текста', () => {
  it('доводит значение контролируемого поля до состояния React', () => {
    // The assertion that matters is `.echo`, not the input's own `.value`: a
    // direct assignment to `element.value` satisfies the latter while leaving
    // React's state untouched, so only the rendered echo proves the harness
    // went through the setter React watches.
    function Field() {
      const [value, setValue] = useState('')
      return (
        <div>
          <input aria-label="поле" value={value} onChange={(event) => setValue(event.target.value)} />
          <span className="echo">{value}</span>
        </div>
      )
    }

    render(<Field />)
    screen.type(screen.need('[aria-label="поле"]'), 'привет')

    expect(screen.text('.echo')).toBe('привет')
    expect((screen.need('[aria-label="поле"]') as HTMLInputElement).value).toBe('привет')
  })

  it('отказывается печатать в то, что текста не принимает', () => {
    render(<div className="plain">просто текст</div>)

    expect(() => screen.type(screen.need('.plain'), 'привет')).toThrow('не принимает текст')
  })
})

describe('Ожидание', () => {
  it('даёт обещанию осесть до утверждения', async () => {
    function Later() {
      const [ready, setReady] = useState(false)
      useEffect(() => {
        void Promise.resolve().then(() => setReady(true))
      }, [])
      return <span className="later">{ready ? 'готово' : 'ждём'}</span>
    }

    render(<Later />)
    // The effect has run, but its promise has not landed: the test is still in
    // the same synchronous turn.
    expect(screen.text('.later')).toBe('ждём')

    await screen.settle()

    expect(screen.text('.later')).toBe('готово')
  })
})
