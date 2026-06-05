import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'
import type { SortState } from '@/lib/sort'
import clsx from 'clsx'

interface Props {
  label: string
  column: string
  sort: SortState
  onSort: (col: string) => void
  className?: string
}

export function SortableHeader({ label, column, sort, onSort, className }: Props) {
  const active = sort.column === column
  return (
    <th
      onClick={() => onSort(column)}
      className={clsx('cursor-pointer select-none group transition-colors hover:bg-gray-100 dark:hover:bg-gray-600', className)}
    >
      <div className="flex items-center gap-1 whitespace-nowrap">
        {label}
        <span className={clsx('transition-opacity', active ? 'opacity-100' : 'opacity-30 group-hover:opacity-60')}>
          {active
            ? sort.dir === 'asc'
              ? <ArrowUp size={11} className="text-blue-500" />
              : <ArrowDown size={11} className="text-blue-500" />
            : <ArrowUpDown size={11} />
          }
        </span>
      </div>
    </th>
  )
}
