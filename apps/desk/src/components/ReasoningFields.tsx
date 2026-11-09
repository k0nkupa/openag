import { cn } from "@/lib/utils";
import type { ModelChoices, Reasoning } from "../types";
import { Field, FieldLabel } from "./ui/field";
import { SelectField, SelectItem } from "./ui/select";
import { Input } from "./ui/input";
import { BrainCircuit } from "lucide-react";
import { InputGroupButton } from "./ui/input-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "./ui/dropdown-menu";

export function compatibleReasoning(controls: ModelChoices["controls"], value: Reasoning): Reasoning {
  return Object.fromEntries(Object.entries(value).filter(([key, v]) => {
    const c = controls.find(c => c.id === key);
    return c && (c.values ? c.values.some(option => option.value === v) : typeof v === "number" && v >= c.min! && v <= c.max!);
  }));
}

export function ReasoningFields({ id, controls, value, onChange, disabled, compact = false, description, onOpenChange, optionsDisabled = false }: { id: string; controls: ModelChoices["controls"]; value: Reasoning; onChange: (next: Reasoning) => void; disabled?: boolean; compact?: boolean; description?: string; optionsDisabled?: boolean; onOpenChange?: (open: boolean) => void }) {
  function change(key: string, next: string | boolean | number | undefined) {
    const result = { ...value };
    if (next === undefined) delete result[key]; else result[key] = next;
    onChange(result);
  }
  // Keep the composer popup mounted when lazy options replace its placeholder.
  return <>{controls.map((c, index) => <Field key={compact ? index : c.id} orientation={compact ? "horizontal" : "vertical"} className={cn(compact && "w-auto")}><FieldLabel className={cn(compact && "sr-only")} htmlFor={`${id}-${c.id}`}>{c.name}</FieldLabel>
    {compact && c.values ? <DropdownMenu onOpenChange={onOpenChange}>
      <Tooltip>
      <DropdownMenuTrigger render={<TooltipTrigger render={<InputGroupButton size="icon-sm" variant="ghost" className="rounded-full" disabled={disabled} />} />} id={`${id}-${c.id}`} aria-label={`${c.name}: ${c.values.find(option => option.value === value[c.id])?.name ?? "Default"}`} disabled={disabled}>
        <BrainCircuit data-icon="inline-start" />
      </DropdownMenuTrigger>
      <TooltipContent>{c.name}: {c.values.find(option => option.value === value[c.id])?.name ?? "Default"}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="min-w-40 max-w-[calc(100vw-2rem)] motion-reduce:animate-none">
        <DropdownMenuRadioGroup value={value[c.id] === undefined ? "" : JSON.stringify(value[c.id])} onValueChange={next => change(c.id, next === "" ? undefined : JSON.parse(next))}>
          <DropdownMenuGroup>
            <DropdownMenuLabel>{c.name}</DropdownMenuLabel>
            <DropdownMenuRadioItem value="" disabled={optionsDisabled} closeOnClick>Default</DropdownMenuRadioItem>
            {c.values.map(option => <DropdownMenuRadioItem key={JSON.stringify(option.value)} value={JSON.stringify(option.value)} disabled={optionsDisabled} closeOnClick>{option.name}</DropdownMenuRadioItem>)}
          </DropdownMenuGroup>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu> : c.values ? <SelectField onOpenChange={onOpenChange} prefix={compact ? c.name : undefined} description={description} className={cn(compact && "w-auto max-w-full rounded-full")} id={`${id}-${c.id}`} disabled={disabled} value={value[c.id] === undefined ? "" : JSON.stringify(value[c.id])} onValueChange={(value) => change(c.id, value === "" ? undefined : JSON.parse(value))}>
      <SelectItem value="" disabled={optionsDisabled}>Default</SelectItem>{c.values.map(v => <SelectItem disabled={optionsDisabled} key={JSON.stringify(v.value)} value={JSON.stringify(v.value)}>{v.name}</SelectItem>)}
    </SelectField> : <Input aria-label={compact ? c.name : undefined} className={cn(compact && "w-28")} id={`${id}-${c.id}`} disabled={disabled} type="number" min={c.min} max={c.max} value={value[c.id] === undefined ? "" : String(value[c.id])} onChange={e => change(c.id, e.target.value === "" ? undefined : Number(e.target.value))} />}
  </Field>)}</>;
}
