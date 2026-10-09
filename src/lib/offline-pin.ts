import { db, getMeta } from './local-db'

interface StoredPin {
  salt: string
  hash: string
  iterations: number
}

const ITERATIONS = 120_000
const hex = (bytes: Uint8Array) => Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
const fromHex = (value: string) => Uint8Array.from(value.match(/.{1,2}/g) ?? [], (byte) => Number.parseInt(byte, 16))
const keyFor = (employeeId: string) => `offline-pin:${employeeId}`

async function derive(pin: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  const saltBuffer = new ArrayBuffer(salt.byteLength)
  new Uint8Array(saltBuffer).set(salt)
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: saltBuffer, iterations, hash: 'SHA-256' }, key, 256)
  return new Uint8Array(bits)
}

export async function hasOfflinePin(employeeId: string) {
  const stored = await getMeta<StoredPin | null>(keyFor(employeeId), null)
  return Boolean(stored?.salt && stored?.hash && stored.iterations)
}

export async function saveOfflinePin(employeeId: string, pin: string) {
  if (!/^\d{6,8}$/.test(pin)) throw new Error('Choose a 6–8 digit offline PIN.')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derive(pin, salt, ITERATIONS)
  await db.appMeta.put({ key: keyFor(employeeId), value: { salt: hex(salt), hash: hex(hash), iterations: ITERATIONS } satisfies StoredPin, updatedAt: new Date().toISOString() })
}

export async function verifyOfflinePin(employeeId: string, pin: string) {
  if (!/^\d{6,8}$/.test(pin)) return false
  const stored = await getMeta<StoredPin | null>(keyFor(employeeId), null)
  if (!stored?.salt || !stored?.hash || !stored.iterations) return false
  const candidate = hex(await derive(pin, fromHex(stored.salt), stored.iterations))
  if (candidate.length !== stored.hash.length) return false
  let diff = 0
  for (let index = 0; index < candidate.length; index += 1) diff |= candidate.charCodeAt(index) ^ stored.hash.charCodeAt(index)
  return diff === 0
}

export async function clearOfflinePin(employeeId: string) {
  await db.appMeta.delete(keyFor(employeeId))
}
