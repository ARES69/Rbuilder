import { useCallback, useEffect, useRef, useState, type PointerEvent, type KeyboardEvent, type ReactNode } from 'react'

const MIN_LEFT = 320
const MIN_RIGHT = 360
const STORAGE_KEY = 'freebuff-web:split'
const KEYBOARD_STEP = 32

type Props = {
  left: ReactNode
  right: ReactNode
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function readStoredWidth(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  } catch {
    return null
  }
}

/** Chat on the left, preview on the right, separated by a draggable hairline. */
export function SplitLayout({ left, right }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const [width, setWidth] = useState<number | null>(() => readStoredWidth())
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    try {
      if (width !== null) localStorage.setItem(STORAGE_KEY, String(Math.round(width)))
    } catch {
      /* width is a convenience; ignore storage failures */
    }
  }, [width])

  const bounds = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect()
    const total = rect?.width ?? 1200
    return { min: MIN_LEFT, max: Math.max(MIN_LEFT, total - MIN_RIGHT) }
  }, [])

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    draggingRef.current = true
    setDragging(true)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const { min, max } = bounds()
    setWidth(clamp(event.clientX - rect.left, min, max))
  }

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    draggingRef.current = false
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const rect = containerRef.current?.getBoundingClientRect()
    const { min, max } = bounds()
    const current = width ?? rect?.width ?? MIN_LEFT * 2
    const delta = event.key === 'ArrowLeft' ? -KEYBOARD_STEP : KEYBOARD_STEP
    setWidth(clamp(current + delta, min, max))
  }

  return (
    <div className={`workspace${dragging ? ' is-dragging' : ''}`} ref={containerRef}>
      <div className="workspace-left" style={width === null ? undefined : { width: `${width}px` }}>
        {left}
      </div>

      <div
        className="divider"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panels"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
      >
        <span className="divider-grip" aria-hidden="true" />
      </div>

      <div className="workspace-right">{right}</div>
    </div>
  )
}
