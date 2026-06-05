import { useState, useMemo } from 'react'

export type SortDir = 'asc' | 'desc'
export interface SortState { column: string | null; dir: SortDir }

export function useSortable<T>(
  data: T[],
  getValue: (item: T, col: string) => string | number | boolean | null | undefined,
) {
  const [sort, setSort] = useState<SortState>({ column: null, dir: 'asc' })

  function toggle(column: string) {
    setSort(s => ({
      column,
      dir: s.column === column && s.dir === 'asc' ? 'desc' : 'asc',
    }))
  }

  const sorted = useMemo(() => {
    if (!sort.column) return data
    return [...data].sort((a, b) => {
      const av = getValue(a, sort.column!)
      const bv = getValue(b, sort.column!)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'string' && typeof bv === 'string') {
        const cmp = av.localeCompare(bv, undefined, { sensitivity: 'base' })
        return sort.dir === 'asc' ? cmp : -cmp
      }
      const cmp = (av as number) < (bv as number) ? -1 : (av as number) > (bv as number) ? 1 : 0
      return sort.dir === 'asc' ? cmp : -cmp
    })
  }, [data, sort])

  return { sorted, sort, toggle }
}
