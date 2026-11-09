import * as React from "react"
import { CpuIcon, ChevronDownIcon, LoaderCircleIcon } from "lucide-react"
import { cn } from "cn"
import { Button } from "./button"
import { InputGroupButton } from "./input-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "./dropdown-menu"
type Model = { id: string; name: string; provider?: string; context?: string; tags?: string[] }

type ModelSelectorProps = {
  models: Model[]
  value?: string
  onValueChange?: (id: string) => void
  disabled?: boolean
  id?: string
  placeholder?: string
  className?: string
  compact?: boolean
  onOpenChange?: (open: boolean) => void
  loading?: boolean
}

function ModelSelector({ models, value, onValueChange, disabled, id, placeholder = "Select model", className, loading = false, compact = false, onOpenChange }: ModelSelectorProps) {
  const [open, setOpen] = React.useState(false)
  function changeOpen(next: boolean) { setOpen(next); onOpenChange?.(next) }
  const current = models.find((m) => m.id === value)
  const label = `Model: ${current?.name ?? placeholder}`
  const providers = [...new Set(models.map((m) => m.provider ?? ""))]

  return (
    <DropdownMenu open={open} onOpenChange={changeOpen}>
      <Tooltip disabled={!compact || open}>
      <DropdownMenuTrigger render={compact ? <TooltipTrigger render={<InputGroupButton size="icon-sm" variant="ghost" className="rounded-full" disabled={disabled} />} /> : <Button variant="outline" className={cn("w-full min-w-0 justify-between font-normal", className)} />} id={id} disabled={disabled} aria-label={label} aria-busy={loading}>
        {compact ? !loading && <CpuIcon data-icon="inline-start" /> : <span className="truncate">{current?.name ?? (value || (loading ? "Loading models…" : placeholder))}</span>}
        {loading ? <LoaderCircleIcon data-icon="inline-end" className="animate-spin motion-reduce:animate-none" aria-label="Loading models" /> : !compact && <ChevronDownIcon data-icon="inline-end" />}
      </DropdownMenuTrigger>
      {compact && <TooltipContent>{loading ? "Loading models…" : label}</TooltipContent>}
      </Tooltip>
      <DropdownMenuContent align="start" className="w-56 max-w-[calc(100vw-2rem)] motion-reduce:animate-none">
        <DropdownMenuRadioGroup value={value ?? ""} onValueChange={next => { if (next !== value) onValueChange?.(next) }}>
          {providers.map((provider, index) => <React.Fragment key={provider}>
            {index > 0 && <DropdownMenuSeparator />}
            <DropdownMenuGroup>
              {provider && <DropdownMenuLabel>{provider}</DropdownMenuLabel>}
              {models.filter(model => (model.provider ?? "") === provider).map(model => <DropdownMenuRadioItem key={model.id} value={model.id} data-model-id={model.id} disabled={loading} closeOnClick>{model.name}</DropdownMenuRadioItem>)}
            </DropdownMenuGroup>
          </React.Fragment>)}
        </DropdownMenuRadioGroup>
        {!models.length && <div role="status" className="px-2 py-1 text-sm text-muted-foreground">{loading ? "Loading models…" : "No models available."}</div>}
      </DropdownMenuContent>
    </DropdownMenu>
  )

}

export { ModelSelector }
export type { Model, ModelSelectorProps }
