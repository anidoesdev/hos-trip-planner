import type { ApiErrorBody, TripPlan, TripRequest } from './types'

export const API_URL = (import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000').replace(/\/+$/, '')

const HEALTH_TIMEOUT_MS = 6_000
const WAKE_POLL_MS = 3_000
const WAKE_MAX_MS = 100_000
const PLAN_TIMEOUT_MS = 120_000

export class ApiError extends Error {
  code: string
  status: number
  field?: string
  fields?: Record<string, string[]>

  constructor(code: string, message: string, status = 0, extra: Partial<ApiErrorBody> = {}) {
    super(message)
    this.code = code
    this.status = status
    this.field = extra.field
    this.fields = extra.fields
  }

  /** Whether retrying the same request might succeed. */
  get retryable(): boolean {
    return this.status === 0 || this.status >= 500 || this.status === 429
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, outer?: AbortSignal) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs)
  const onOuterAbort = () => ctrl.abort(outer?.reason)
  outer?.addEventListener('abort', onOuterAbort)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
    outer?.removeEventListener('abort', onOuterAbort)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** One health probe: true if the API answered 200 within the timeout. */
export async function pingHealth(signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${API_URL}/api/health`, { method: 'GET' }, HEALTH_TIMEOUT_MS, signal)
    return res.ok
  } catch {
    return false
  }
}

/**
 * Make sure the backend is awake. Free-tier hosts (Render) sleep after inactivity and
 * take ~30-60 s to cold-start, so we poll /api/health and report progress instead of
 * letting the plan request hang silently.
 */
export async function ensureAwake(onWaking: (elapsedMs: number) => void, signal?: AbortSignal): Promise<void> {
  const started = Date.now()
  if (await pingHealth(signal)) return
  while (Date.now() - started < WAKE_MAX_MS) {
    if (signal?.aborted) throw new ApiError('aborted', 'Request cancelled.')
    onWaking(Date.now() - started)
    await sleep(WAKE_POLL_MS)
    if (await pingHealth(signal)) return
  }
  throw new ApiError(
    'server_unreachable',
    'The planning server did not respond. It may be starting up. Please try again in a moment.',
  )
}

export async function planTrip(req: TripRequest, signal?: AbortSignal): Promise<TripPlan> {
  let res: Response
  try {
    res = await fetchWithTimeout(
      `${API_URL}/api/trip/plan`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) },
      PLAN_TIMEOUT_MS,
      signal,
    )
  } catch (err) {
    if (signal?.aborted) throw new ApiError('aborted', 'Request cancelled.')
    const timedOut = err instanceof DOMException && err.name === 'TimeoutError'
    throw new ApiError(
      timedOut ? 'timeout' : 'network',
      timedOut
        ? 'Planning took too long. The map services may be slow. Please retry.'
        : 'Could not reach the planning server. Check your connection and retry.',
    )
  }
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    const b = (body ?? {}) as Partial<ApiErrorBody>
    throw new ApiError(b.error ?? 'http_error', b.message ?? `Server error (HTTP ${res.status}).`, res.status, b)
  }
  return body as TripPlan
}
