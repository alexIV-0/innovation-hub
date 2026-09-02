"use client"

import { useEffect, useState } from "react"
import { Check, ChevronsUpDown, X } from "lucide-react"

import { useI18n } from "@/components/account/i18n"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  clampForFormat,
  formatNumeric,
  parseNumeric,
  parseTimecodeInput,
  secondsToTimecode,
} from "@/lib/options/numeric-format"
import type { ExposedOption, ExposedOptionValue } from "@/lib/options/types"
import { cn } from "@/lib/utils"

/**
 * Семь контролов вкладки настроек — по одному на `controlType`, которому автор
 * графа может поставить галочку «показать на сайте».
 *
 * Ничего не додумываем: границы, шаг, формат, список вариантов и режим ручного
 * ввода приходят из `options.json` такими, какими их задали в программе. Если в
 * слайдере разрешён ввод за пределами min/max — здесь он тоже разрешён.
 * Раскладка повторяет ноду (`NODE_WIN/nodes/properties/*`): имя с подсказкой
 * сверху, контрол под ним, у чекбокса — в одной строке.
 */

type ControlProps = {
  option: ExposedOption
  value: ExposedOptionValue
  disabled: boolean
  onChange: (value: ExposedOptionValue) => void
}

/** Моноширинное поле: цифры не должны прыгать при наборе. */
const numericInput = "h-8 text-right font-mono text-[13px]"

export function CheckboxControl({ value, disabled, onChange }: ControlProps) {
  return (
    <Switch
      checked={value === true}
      disabled={disabled}
      onCheckedChange={(checked) => onChange(checked)}
    />
  )
}

export function SliderControl({
  option,
  value,
  disabled,
  onChange,
}: ControlProps) {
  const cfg = option.numeric!
  const current = typeof value === "number" ? value : cfg.min
  const [text, setText] = useState(() => formatNumeric(current, cfg))

  // Значение могло прийти снаружи — после сохранения сервер отдаёт зажатое.
  useEffect(() => setText(formatNumeric(current, cfg)), [current, cfg])

  const commitText = () => {
    const parsed = parseNumeric(text, cfg, cfg.allowManualOverride)
    if (parsed === null) {
      setText(formatNumeric(current, cfg)) // мусор на входе — откат
      return
    }
    setText(formatNumeric(parsed, cfg))
    onChange(parsed)
  }

  return (
    <div className="flex items-center gap-3">
      {option.showMinMax ? (
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {formatNumeric(cfg.min, cfg)}
        </span>
      ) : null}

      <Slider
        // Ручной ввод может увести значение за границы — сам бегунок за рельсу
        // при этом не уезжает, как и в программе.
        value={[clampForFormat(current, cfg)]}
        min={cfg.min}
        max={cfg.max}
        step={cfg.step}
        disabled={disabled}
        onValueChange={([next]) => onChange(clampForFormat(next!, cfg))}
        className="flex-1"
      />

      {option.manualInput ? (
        <Input
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur()
          }}
          className={cn(numericInput, cfg.format === "timecode" ? "w-24" : "w-16")}
        />
      ) : (
        <span className="min-w-[3rem] shrink-0 text-right font-mono text-[13px]">
          {formatNumeric(current, cfg)}
        </span>
      )}

      {option.showMinMax ? (
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {formatNumeric(cfg.max, cfg)}
        </span>
      ) : null}
    </div>
  )
}

export function ValueRangeControl({
  option,
  value,
  disabled,
  onChange,
}: ControlProps) {
  const cfg = option.numeric!
  const [low, high] = Array.isArray(value)
    ? [Number(value[0]), Number(value[1])]
    : [cfg.min, cfg.max]
  const [lowText, setLowText] = useState(() => formatNumeric(low, cfg))
  const [highText, setHighText] = useState(() => formatNumeric(high, cfg))

  useEffect(() => {
    setLowText(formatNumeric(low, cfg))
    setHighText(formatNumeric(high, cfg))
  }, [low, high, cfg])

  /** lo ≤ hi — как в ноде: пара всегда отсортирована. */
  const commit = (nextLow: number, nextHigh: number) => {
    onChange([Math.min(nextLow, nextHigh), Math.max(nextLow, nextHigh)])
  }

  const commitText = (edge: 0 | 1, raw: string) => {
    const parsed = parseNumeric(raw, cfg, cfg.allowManualOverride)
    if (parsed === null) {
      setLowText(formatNumeric(low, cfg))
      setHighText(formatNumeric(high, cfg))
      return
    }
    commit(edge === 0 ? parsed : low, edge === 0 ? high : parsed)
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        value={lowText}
        disabled={disabled}
        onChange={(e) => setLowText(e.target.value)}
        onBlur={(e) => commitText(0, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur()
        }}
        className={cn(
          numericInput,
          "text-center",
          cfg.format === "timecode" ? "w-24" : "w-16",
        )}
      />

      <Slider
        value={[clampForFormat(low, cfg), clampForFormat(high, cfg)]}
        min={cfg.min}
        max={cfg.max}
        step={cfg.step}
        disabled={disabled}
        onValueChange={([nextLow, nextHigh]) => commit(nextLow!, nextHigh!)}
        className="flex-1"
      />

      <Input
        value={highText}
        disabled={disabled}
        onChange={(e) => setHighText(e.target.value)}
        onBlur={(e) => commitText(1, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur()
        }}
        className={cn(
          numericInput,
          "text-center",
          cfg.format === "timecode" ? "w-24" : "w-16",
        )}
      />
    </div>
  )
}

export function TimecodeControl({ value, disabled, onChange }: ControlProps) {
  const seconds = typeof value === "number" ? value : 0
  const [text, setText] = useState(() => secondsToTimecode(seconds))

  useEffect(() => setText(secondsToTimecode(seconds)), [seconds])

  const commit = () => {
    const parsed = Math.max(0, parseTimecodeInput(text))
    setText(secondsToTimecode(parsed))
    onChange(parsed)
  }

  return (
    <Input
      value={text}
      disabled={disabled}
      placeholder="00:00:00"
      onChange={(e) => {
        // Допускаем ровно то, из чего складывается таймкод.
        if (/^[0-9.,:\s]*$/.test(e.target.value)) setText(e.target.value)
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur()
      }}
      className={cn(numericInput, "w-28 text-left")}
    />
  )
}

export function TextEditControl({
  option,
  value,
  disabled,
  onChange,
}: ControlProps) {
  return (
    <Textarea
      value={typeof value === "string" ? value : ""}
      disabled={disabled}
      rows={4}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "min-h-[80px] resize-y text-[13px]",
        // Подсветки синтаксиса на сайте нет, но код в пропорциональном шрифте
        // читать невозможно — для не-plaintext оставляем моноширинный.
        option.language && option.language !== "plaintext" ? "font-mono" : null,
      )}
    />
  )
}

export function DdmControl({
  option,
  value,
  disabled,
  onChange,
}: ControlProps) {
  const { t } = useI18n()
  const current = typeof value === "string" ? value : ""

  // freeInput — своё значение помимо списка; в графе такие ddm встречаются
  // там, где вариант нельзя перечислить заранее.
  if (option.freeInput) {
    return (
      <Input
        value={current}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 text-[13px]"
      />
    )
  }

  return (
    <Select
      value={current || undefined}
      disabled={disabled || option.options.length === 0}
      onValueChange={(next) => onChange(next)}
    >
      <SelectTrigger className="h-8 text-[13px]">
        <SelectValue placeholder={t.optionsSelect} />
      </SelectTrigger>
      <SelectContent>
        {option.options.map((item) => (
          <SelectItem key={item} value={item} className="text-[13px]">
            {item}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function AutocompleteControl({
  option,
  value,
  disabled,
  onChange,
}: ControlProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const selected = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []

  const pick = (item: string) => {
    if (!option.multiSelect) {
      onChange([item])
      setOpen(false)
      return
    }
    if (selected.includes(item) && !option.allowDuplicates) {
      onChange(selected.filter((s) => s !== item))
      return
    }
    onChange([...selected, item])
  }

  const remove = (index: number) =>
    onChange(selected.filter((_, i) => i !== index))

  const trimmed = query.trim()
  // optionsOnly — своё значение вписать нельзя, только выбрать из списка.
  const canCreate =
    !option.optionsOnly && trimmed !== "" && !option.options.includes(trimmed)

  return (
    <div className="space-y-2">
      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((item, index) => (
            <span
              key={`${item}-${index}`}
              className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-[hsl(var(--surface-2))] px-2 py-0.5 text-xs"
            >
              {item}
              {disabled ? null : (
                <button
                  type="button"
                  onClick={() => remove(index)}
                  className="text-muted-foreground transition-colors hover:text-destructive"
                  aria-label={item}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      ) : null}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            disabled={disabled}
            className="h-8 w-full justify-between text-[13px] font-normal"
          >
            {t.optionsSelect}
            <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[14rem] p-0" align="start">
          <Command>
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder={t.optionsSelect}
              className="text-[13px]"
            />
            <CommandList>
              <CommandEmpty>{t.optionsNothingFound}</CommandEmpty>
              <CommandGroup>
                {option.options.map((item) => (
                  <CommandItem
                    key={item}
                    value={item}
                    onSelect={() => pick(item)}
                    className="text-[13px]"
                  >
                    <Check
                      className={cn(
                        "mr-2 h-3.5 w-3.5",
                        selected.includes(item) ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {item}
                  </CommandItem>
                ))}
                {canCreate ? (
                  <CommandItem
                    value={trimmed}
                    onSelect={() => {
                      pick(trimmed)
                      setQuery("")
                    }}
                    className="text-[13px]"
                  >
                    <Check className="mr-2 h-3.5 w-3.5 opacity-0" />
                    {trimmed}
                  </CommandItem>
                ) : null}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}

/** Контрол по `controlType`: тем же ключом, каким он назван в графе. */
/**
 * Учётка внешнего сервиса (пункт 7 запроса клиента).
 *
 * Варианты знает не граф, а сайт: это учётки ЭТОГО человека по ЭТОМУ сервису.
 * Поэтому список тянется запросом, а не приходит в `option.options` — и по той
 * же причине рядом стоит ссылка на «Мои ключи»: подключить ключ отсюда нельзя,
 * он один на все проекты и живёт в своём разделе.
 *
 * ⚠️ В значении лежит МЕТКА, а не секрет. Секрет наружу не отдаётся никогда,
 * даже владельцу: попади он в `options.json`, он оказался бы и в зеркале
 * проекта на каждой машине парка.
 */
function VendorAccountControl({ option, value, disabled, onChange }: ControlProps) {
  const { t } = useI18n()
  const [labels, setLabels] = useState<string[] | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = await fetch("/api/account/vendor-keys", { cache: "no-store" })
        if (!res.ok) throw new Error(String(res.status))
        const body = (await res.json()) as {
          accounts: { label: string; serviceSlug: string }[]
        }
        if (!alive) return
        setLabels(
          body.accounts
            .filter((a) => a.serviceSlug === option.service)
            .map((a) => a.label),
        )
      } catch {
        // Список не загрузился — показываем пустой. Ронять всю вкладку настроек
        // из-за одного контрола нельзя: остальные параметры к ключам отношения
        // не имеют.
        if (alive) setLabels([])
      }
    })()
    return () => {
      alive = false
    }
  }, [option.service])

  const current = typeof value === "string" ? value : ""
  const known = labels ?? []
  // Метка, которой больше нет в списке: учётку отозвали, а в проекте она
  // осталась. Показываем её отдельным пунктом, иначе поле молча опустело бы, и
  // человек не понял бы, почему обработка встала.
  const orphan = current !== "" && !known.includes(current)

  return (
    <div className="space-y-1.5">
      <Select
        value={current}
        disabled={disabled || labels === null}
        onValueChange={(next) => onChange(next)}
      >
        <SelectTrigger className="h-8 text-[13px]">
          <SelectValue placeholder={t.optionsAccountPick} />
        </SelectTrigger>
        <SelectContent>
          {orphan ? (
            <SelectItem value={current}>
              {current} — {t.optionsAccountMissing}
            </SelectItem>
          ) : null}
          {known.map((label) => (
            <SelectItem key={label} value={label}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <a
        href="/account/vendor-keys"
        className="inline-block text-[11px] text-ws-4 underline-offset-2 hover:underline"
      >
        {labels !== null && known.length === 0
          ? t.optionsAccountNone
          : t.optionsAccountManage}
      </a>
    </div>
  )
}

export const OPTION_CONTROLS: Record<
  ExposedOption["control"],
  (props: ControlProps) => React.ReactNode
> = {
  checkbox: CheckboxControl,
  slider: SliderControl,
  timecode: TimecodeControl,
  valueRange: ValueRangeControl,
  ddm: DdmControl,
  autocomplete: AutocompleteControl,
  textedit: TextEditControl,
  vendorAccount: VendorAccountControl,
}

/** Значение строкой — для заблокированных полей и подписей. */
export function formatOptionValue(
  option: ExposedOption,
  value: ExposedOptionValue,
  emptyLabel: string,
): string {
  if (typeof value === "boolean") return value ? "✓" : "—"
  if (typeof value === "number") {
    if (option.control === "timecode") return secondsToTimecode(value)
    return option.numeric ? formatNumeric(value, option.numeric) : String(value)
  }
  if (Array.isArray(value)) {
    if (option.control === "valueRange" && option.numeric) {
      const [low, high] = value as [number, number]
      return `${formatNumeric(low, option.numeric)} — ${formatNumeric(high, option.numeric)}`
    }
    return value.length ? (value as string[]).join(", ") : emptyLabel
  }
  return value.trim() ? value : emptyLabel
}
