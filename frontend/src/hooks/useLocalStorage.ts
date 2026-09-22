import { useCallback, useState } from 'react'

/** State persisted to localStorage. Storage can be unavailable (private mode), so every access is guarded. */
export function useLocalStorage<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? { ...initial, ...JSON.parse(raw) } : initial
    } catch {
      return initial
    }
  })
  const set = useCallback(
    (next: T) => {
      setValue(next)
      try {
        localStorage.setItem(key, JSON.stringify(next))
      } catch {
        /* ignore quota / privacy errors */
      }
    },
    [key],
  )
  return [value, set]
}
