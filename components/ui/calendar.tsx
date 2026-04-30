'use client'

import * as React from 'react'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  DayPicker,
  getDefaultClassNames,
  Month as MonthPrimitive,
  useDayPicker,
} from 'react-day-picker'

import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function CalendarMonth(props: React.ComponentProps<typeof MonthPrimitive>) {
  const { className, children, ...rest } = props
  const { dayPickerProps } = useDayPicker()
  const monthsShown = dayPickerProps.numberOfMonths ?? 1

  if (monthsShown !== 1) {
    return (
      <MonthPrimitive className={className} {...props}>
        {children}
      </MonthPrimitive>
    )
  }

  const childArray = React.Children.toArray(children)
  const gridIdx = childArray.findIndex(
    (child) =>
      React.isValidElement(child) &&
      (child.props as { role?: string })?.role === 'grid',
  )

  if (gridIdx === -1) {
    return (
      <MonthPrimitive className={className} {...props}>
        {children}
      </MonthPrimitive>
    )
  }

  const header = childArray.slice(0, gridIdx)
  const grid = childArray[gridIdx]

  if (header.length === 3) {
    const [prev, caption, next] = header
    return (
      <div {...rest} className={cn('space-y-4', className)}>
        <div className="relative flex items-center justify-center pt-1">
          <div className="absolute left-1 z-10">{prev}</div>
          <div className="flex w-full justify-center px-8">{caption}</div>
          <div className="absolute right-1 z-10">{next}</div>
        </div>
        {grid}
      </div>
    )
  }

  if (header.length === 2) {
    const [a, b] = header
    const aAria =
      React.isValidElement(a) && a.props != null && typeof a.props === 'object' && 'aria-label' in a.props
        ? String((a.props as { 'aria-label'?: string })['aria-label'] ?? '')
        : ''
    const aIsPrev = /previous/i.test(aAria)

    if (aIsPrev) {
      return (
        <div {...rest} className={cn('space-y-4', className)}>
          <div className="relative flex items-center justify-center pt-1">
            <div className="absolute left-1 z-10">{a}</div>
            <div className="flex w-full justify-center px-8">{b}</div>
          </div>
          {grid}
        </div>
      )
    }
    return (
      <div {...rest} className={cn('space-y-4', className)}>
        <div className="relative flex items-center justify-center pt-1">
          <div className="flex w-full justify-center px-8">{a}</div>
          <div className="absolute right-1 z-10">{b}</div>
        </div>
        {grid}
      </div>
    )
  }

  return (
    <MonthPrimitive className={className} {...props}>
      {children}
    </MonthPrimitive>
  )
}

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  components,
  ...props
}: CalendarProps) {
  const defaultClassNames = getDefaultClassNames()

  return (
    <DayPicker
      {...props}
      navLayout="around"
      showOutsideDays={showOutsideDays}
      className={cn('p-3', className)}
      classNames={{
        root: cn('w-fit', defaultClassNames.root),
        months: cn(
          'relative flex flex-col gap-4 sm:flex-row sm:space-x-4 sm:space-y-0',
          defaultClassNames.months,
        ),
        month: cn('space-y-4', defaultClassNames.month),
        month_caption: cn(defaultClassNames.month_caption),
        caption_label: cn(
          'text-sm font-medium',
          defaultClassNames.caption_label,
        ),
        button_previous: cn(
          buttonVariants({ variant: 'outline' }),
          'size-7 bg-transparent p-0 opacity-50 hover:opacity-100',
          defaultClassNames.button_previous,
        ),
        button_next: cn(
          buttonVariants({ variant: 'outline' }),
          'size-7 bg-transparent p-0 opacity-50 hover:opacity-100',
          defaultClassNames.button_next,
        ),
        month_grid: cn(
          'w-full border-collapse',
          defaultClassNames.month_grid,
        ),
        weekdays: cn('flex', defaultClassNames.weekdays),
        weekday: cn(
          'text-muted-foreground w-9 rounded-md text-[0.8rem] font-normal',
          defaultClassNames.weekday,
        ),
        week: cn('mt-2 flex w-full', defaultClassNames.week),
        day: cn(
          'relative flex h-9 w-9 items-center justify-center p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([data-selected])]:bg-accent [&:has([data-selected][data-outside])]:bg-accent/50 first:[&:has([data-selected])]:rounded-l-md last:[&:has([data-selected])]:rounded-r-md',
          defaultClassNames.day,
        ),
        day_button: cn(
          buttonVariants({ variant: 'ghost' }),
          'size-9 p-0 font-normal aria-selected:opacity-100',
          defaultClassNames.day_button,
        ),
        range_end: cn('day-range-end', defaultClassNames.range_end),
        selected: cn(
          'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground',
          defaultClassNames.selected,
        ),
        today: cn(
          'bg-accent text-accent-foreground',
          defaultClassNames.today,
        ),
        outside: cn(
          'day-outside text-muted-foreground aria-selected:bg-accent/50 aria-selected:text-muted-foreground',
          defaultClassNames.outside,
        ),
        disabled: cn(
          'text-muted-foreground opacity-50',
          defaultClassNames.disabled,
        ),
        range_middle: cn(
          'aria-selected:bg-accent aria-selected:text-accent-foreground',
          defaultClassNames.range_middle,
        ),
        hidden: cn('invisible', defaultClassNames.hidden),
        ...classNames,
      }}
      components={{
        ...components,
        Month: CalendarMonth,
        Chevron: ({ className: iconClass, orientation, ...iconProps }) => {
          if (orientation === 'left') {
            return (
              <ChevronLeft
                className={cn('size-4', iconClass)}
                {...iconProps}
              />
            )
          }
          if (orientation === 'right') {
            return (
              <ChevronRight
                className={cn('size-4', iconClass)}
                {...iconProps}
              />
            )
          }
          if (orientation === 'down') {
            return (
              <ChevronDown
                className={cn('size-4', iconClass)}
                {...iconProps}
              />
            )
          }
          return (
            <ChevronLeft
              className={cn('size-4', iconClass)}
              {...iconProps}
            />
          )
        },
      }}
    />
  )
}
Calendar.displayName = 'Calendar'

export { Calendar }
