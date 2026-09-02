import { useRef } from 'react'

// Two-handle page-range slider (from..to within min..max), pointer + keyboard
// driven. Mirrors the previous UI's custom `.dualrange` control.
export function DualRange({
  min, max, from, to, onChange,
}: {
  min: number
  max: number
  from: number
  to: number
  onChange: (from: number, to: number) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const pct = (v: number) => (max > min ? ((v - min) / (max - min)) * 100 : 0)

  const valueAt = (clientX: number) => {
    const el = trackRef.current
    if (!el) return min
    const r = el.getBoundingClientRect()
    const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    return Math.round(min + t * (max - min))
  }

  const startDrag = (which: 'from' | 'to') => (e: React.PointerEvent) => {
    e.preventDefault()
    const move = (ev: PointerEvent) => {
      const v = valueAt(ev.clientX)
      if (which === 'from') onChange(Math.min(v, to), to)
      else onChange(from, Math.max(v, from))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onKey = (which: 'from' | 'to') => (e: React.KeyboardEvent) => {
    const d = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
    if (!d) return
    e.preventDefault()
    if (which === 'from') onChange(Math.max(min, Math.min(from + d, to)), to)
    else onChange(from, Math.min(max, Math.max(to + d, from)))
  }

  return (
    <div ref={trackRef} className="relative h-6 touch-none select-none">
      <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-border" />
      <div
        className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-primary"
        style={{ left: `${pct(from)}%`, right: `${100 - pct(to)}%` }}
      />
      {(['from', 'to'] as const).map((which) => {
        const val = which === 'from' ? from : to
        return (
          <div
            key={which}
            role="slider"
            tabIndex={0}
            aria-label={which === 'from' ? 'First page' : 'Last page'}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={val}
            onPointerDown={startDrag(which)}
            onKeyDown={onKey(which)}
            className="absolute top-1/2 h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border-2 border-primary bg-base-100 shadow-[0_1px_3px_rgba(0,0,0,0.28)] active:cursor-grabbing"
            style={{ left: `${pct(val)}%` }}
          />
        )
      })}
    </div>
  )
}
