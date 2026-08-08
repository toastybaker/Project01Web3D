type MessageHandler = (payload: unknown) => void

export type AuthoritativeAccountAction = {
  type: 'shop' | 'mine' | 'forage' | 'market' | 'deed' | 'farm' | 'cook' | 'merchant' | 'trade' | 'minigame'
  requestId?: string
  key?: string
  ok: boolean
  reason?: string
  itemId?: string
  stockId?: string
  direction?: 'buy' | 'sell'
  quantity?: number
  total?: number
}

export type AuthoritativeAccountSnapshot = {
  profileId: string
  roomKey: number
  revision: number
  cash: number
  inventory: Record<string, number>
  portfolio: Record<string, number>
  personalDeedOwned: boolean
  deedEntitlement: number
  ownedFarms: number[]
  cookQueue: Array<{ id: string; recipe: string; quantity: number; furnaceIndex: number; readyAt: number }>
  stats: { foraged: number; mined: number; harvested: number; sold: number }
  action?: AuthoritativeAccountAction
}

let sender: ((type: string, payload: unknown) => void) | null = null
const handlers = new Map<string, Set<MessageHandler>>()
const accountHandlers = new Set<(account: AuthoritativeAccountSnapshot) => void>()

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
  const account = payload && typeof payload === 'object' && 'account' in payload ? (payload as { account?: AuthoritativeAccountSnapshot }).account : undefined
  if (account && typeof account === 'object') accountHandlers.forEach((handler) => handler(account))
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

export function onAuthoritativeAccount(handler: (account: AuthoritativeAccountSnapshot) => void) {
  accountHandlers.add(handler)
  return () => accountHandlers.delete(handler)
}
