/**
 * Drag handles between the shell's columns.
 *
 * The shell is three columns — task rail, chat, inspector — and the widths of
 * the two outer ones belong to the person using it, not to the stylesheet. This
 * is the same handle as the chat/preview split, turned around for an edge that
 * is pinned to one side of the window: `start` grows the panel on the left,
 * `end` grows the panel on the right.
 *
 * Widths are handed in and reported out rather than owned here, so the shell
 * stays the one place that knows what a column is.
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'

const KEYBOARD_STEP = 24
const KEYBOARD_STEP_LARGE = 96

export type ColumnResizerProps = {
  /** Which side of the shell the panel being resized sits on. */
  side: 'start' | 'end'
  /** The element the pointer position is measured against. */
  containerRef: RefObject<HTMLElement | null>
  /** Never narrower than this, in pixels. */
  min: number
  /** Room kept for everything else, so the chat cannot be squeezed out. */
  reserve: number
  /** The current width, or null for the stylesheet default. */
  value: number | null
  /** What `value: null` means, in pixels — the width the stylesheet asks for. */
  defaultWidth: number
  /** null asks for the stylesheet default again — the double-click reset. */
  onWidthChange: (next: number | null) => void
  label: string
  className?: string
  /** Lets the shell freeze text selection and the cursor for the whole drag. */
  onDragChange?: (dragging: boolean) => void
}

export function ColumnResizer({
  side,
  containerRef,
  min,
  reserve,
  value,
  defaultWidth,
  onWidthChange,
  label,
  className,
  onDragChange,
}: ColumnResizerProps) {
  const draggingRef = useRef(false)
  const [dragging, setDragging] = useState(false)

  // Both ends of the drag have to reach the shell, and a callback in an effect
  // would fire one render late.
  useEffect(() => {
    onDragChange?.(dragging)
  }, [dragging, onDragChange])

  /**
   * The edges the width is measured between.
   *
   * The shell has padding, and the panel sits inside it — so the box of the
   * shell is not the box the panel is measured in. Measuring from the outer
   * edge would make every drag jump by the padding the moment it starts.
   */
  const edges = useCallback(() => {
    const container = containerRef.current
    const rect = container?.getBoundingClientRect()
    if (!container || !rect) return null
    const style = window.getComputedStyle(container)
    const padStart = Number.parseFloat(style.paddingLeft) || 0
    const padEnd = Number.parseFloat(style.paddingRight) || 0
    return {
      start: rect.left + padStart,
      end: rect.right - padEnd,
      width: rect.width - padStart - padEnd,
    }
  }, [containerRef])

  const bounds = useCallback(() => {
    const box = edges()
    const total = box?.width ?? 1280
    return { min, max: Math.max(min, Math.round(total - reserve)) }
  }, [edges, min, reserve])

  /** Distance from the shell edge the panel is pinned to, at this pointer. */
  const widthAt = useCallback(
    (clientX: number): number | null => {
      const box = edges()
      if (!box) return null
      const raw = side === 'start' ? clientX - box.start : box.end - clientX
      const { min: low, max } = bounds()
      return Math.round(Math.min(Math.max(raw, low), max))
    },
    [bounds, edges, side],
  )

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    // `preventDefault` is what stops the browser from scrolling or selecting
    // during the drag, and it also stops the default focusing — so the handle
    // is focused by hand, which keeps the arrow keys working straight after a
    // drag instead of only after a tab through the panel.
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    draggingRef.current = true
    setDragging(true)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    const next = widthAt(event.clientX)
    if (next !== null) onWidthChange(next)
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
    const { min: low, max } = bounds()
    // Wider panels live to the right of a `start` handle and to the left of an
    // `end` one, so the same arrow means the opposite thing on each side.
    const grow = side === 'start' ? event.key === 'ArrowRight' : event.key === 'ArrowLeft'
    const step = event.shiftKey ? KEYBOARD_STEP_LARGE : KEYBOARD_STEP
    const current = value ?? defaultWidth
    onWidthChange(Math.min(Math.max(current + (grow ? step : -step), low), max))
  }

  // A width saved on a wide monitor must not push the chat off a narrow one.
  useEffect(() => {
    const element = containerRef.current
    if (!element || value === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const { min: low, max } = bounds()
      if (value > max) onWidthChange(Math.max(low, max))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [bounds, containerRef, onWidthChange, value])

  return (
    <div
      className={[
        'divider',
        'column-resizer',
        `column-resizer--${side}`,
        dragging ? 'is-active' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value ?? undefined}
      aria-valuemin={min}
      title={`${label} — тяните мышью, стрелки перемещают, двойной щелчок сбрасывает`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => onWidthChange(null)}
      onKeyDown={onKeyDown}
    >
      <span className="divider-grip" aria-hidden="true" />
    </div>
  )
}

/**
 * Reads a remembered column width. Stored widths are a convenience, so a
 * corrupt or hostile value falls back to the stylesheet default instead of
 * failing the render.
 */
export function readStoredColumnWidth(key: string): number | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null
  } catch {
    return null
  }
}

/** Remembers a column width; null clears it so the default applies again. */
export function storeColumnWidth(key: string, width: number | null): void {
  try {
    if (width === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, String(Math.round(width)))
  } catch {
    /* the width is a convenience; storage failures must not break the shell */
  }
}