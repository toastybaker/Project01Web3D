type MessageHandler = (payload: unknown) => void

let sender: ((type: string, payload: unknown) => void) | null = null
const handlers = new Map<string, Set<MessageHandler>>()

const PROFILE_ID_KEY = 'project01-profile-id'

export function stableProfileId() {
  const existing = localStorage.getItem(PROFILE_ID_KEY)?.trim()
  if (existing && /^[a-f0-9-]{20,80}$/i.test(existing)) return existing
  const next = typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `profile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  localStorage.setItem(PROFILE_ID_KEY, next)
  return next
}

export function setMultiplayerSender(next: typeof sender) {
  sender = next
}

export function sendMultiplayer(type: string, payload: unknown) {
  if (!sender) return false
  sender(type, payload)
  return true
}

export function emitMultiplayer(type: string, payload: unknown) {
  handlers.get(type)?.forEach((handler) => handler(payload))
}

export function onMultiplayer(type: string, handler: MessageHandler) {
  const listeners = handlers.get(type) ?? new Set<MessageHandler>()
  listeners.add(handler)
  handlers.set(type, listeners)
  return () => {
    listeners.delete(handler)
    if (!listeners.size) handlers.delete(type)
  }
}
