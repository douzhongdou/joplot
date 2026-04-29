export type TrackPayloadValue = string | number | boolean | null | undefined
export type TrackPayload = Record<string, TrackPayloadValue>

type UmamiTracker = {
  track: (eventName: string, payload?: Record<string, string | number | boolean | null>) => void
}

function sanitizePayload(payload?: TrackPayload) {
  if (!payload) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => (
      value !== undefined
      && (typeof value !== 'number' || Number.isFinite(value))
    )),
  ) as Record<string, string | number | boolean | null>
}

export function track(eventName: string, payload?: TrackPayload) {
  if (!eventName.trim()) {
    return
  }

  if (typeof window === 'undefined') {
    return
  }

  const umami = (window as Window & { umami?: UmamiTracker }).umami

  if (!umami?.track) {
    return
  }

  try {
    umami.track(eventName, sanitizePayload(payload))
  } catch (error) {
    console.error('[track] failed', error)
  }
}
