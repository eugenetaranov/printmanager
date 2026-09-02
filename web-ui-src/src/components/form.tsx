import type { ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export function Field({ label, htmlFor, children }: { label: ReactNode; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-[6px]">
      <Label htmlFor={htmlFor} className="font-mono text-[11px] font-[600] uppercase tracking-[0.04em] text-faint">{label}</Label>
      {children}
    </div>
  )
}

// A shadcn Select bound to a plain string value/options pair.
export function PlainSelect({
  value, onChange, options, className,
}: {
  value: string
  onChange: (v: string) => void
  options: [string, string][]
  className?: string
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={'w-full font-mono ' + (className ?? '')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, label]) => (
          <SelectItem key={v} value={v} className="font-mono">{label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
