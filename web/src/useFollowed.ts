// Followed trains ("Trains suivis"), kept in localStorage. Trip ids include the service date,
// so a followed train naturally drops off the next day.

import { useCallback, useState } from 'react'

export type FollowedTrain = { id: string; name: string; from: string; to: string; dep: number; arr: number; tzFrom?: string; tzTo?: string }

const KEY = 'continent.suivis'

function read(): FollowedTrain[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]') as FollowedTrain[]
    return list.filter((f) => f.arr > Date.now() - 6 * 3_600_000)
  } catch {
    return []
  }
}

export function useFollowed() {
  const [list, setList] = useState<FollowedTrain[]>(read)
  const save = (next: FollowedTrain[]) => {
    setList(next)
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      /* storage unavailable: kept for this page only */
    }
  }
  const toggle = useCallback((f: FollowedTrain) => {
    const cur = read()
    save(cur.some((x) => x.id === f.id) ? cur.filter((x) => x.id !== f.id) : [...cur, f])
  }, [])
  return { list, toggle, has: (id: string) => list.some((f) => f.id === id) }
}
