import { useCallback, useEffect, useState } from 'react'

/** The three screens: overview dashboard, the trip form on its own, and the results with the form alongside. */
export type View = 'landing' | 'form' | 'results'

const HASH: Record<View, string> = { landing: '', form: '#plan', results: '#results' }

function fromHash(): View {
  if (location.hash === '#plan') return 'form'
  if (location.hash === '#results') return 'results'
  return 'landing'
}

/** Current view, kept in the URL hash so Back/Forward move between screens. */
export function useView(): [View, (v: View) => void] {
  const [view, setViewState] = useState<View>(fromHash)

  useEffect(() => {
    const onHash = () => setViewState(fromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const setView = useCallback((v: View) => {
    setViewState(v)
    const target = HASH[v]
    if (location.hash !== target) {
      if (target) location.hash = target
      else history.pushState(null, '', location.pathname + location.search)
    }
    window.scrollTo({ top: 0 })
  }, [])

  return [view, setView]
}
