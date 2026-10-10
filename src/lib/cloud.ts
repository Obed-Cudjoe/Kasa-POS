import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { UserRole } from './types'

export function getSupabaseUrl() {
  return process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
}

export function getSupabaseAnonKey() {
  return process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
}

export function hasCloudConfiguration() {
  return Boolean(getSupabaseUrl() && getSupabaseAnonKey() && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

export function createAdminClient(): SupabaseClient {
  const url = getSupabaseUrl()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase server configuration is incomplete.')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

export interface RequestActor {
  userId: string
  employeeId: string
  storeId: string
  displayName: string
  role: UserRole
  refundLimitMinor: number | null
  admin: SupabaseClient
}

export async function authorizeRequest(request: Request, permittedRoles?: UserRole[]): Promise<RequestActor> {
  const authorization = request.headers.get('authorization') ?? ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!token) throw new Error('Sign in to continue.')
  const url = getSupabaseUrl()
  const anonKey = getSupabaseAnonKey()
  if (!url || !anonKey || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Cloud services are not configured on this deployment.')
  const authClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: { user }, error: authError } = await authClient.auth.getUser(token)
  if (authError || !user) throw new Error('Your session has expired. Sign in again.')
  const admin = createAdminClient()
  let query = admin.from('employees').select('id, store_id, display_name, role, status, auth_user_id, refund_limit_minor').eq('auth_user_id', user.id).eq('status', 'active')
  const configuredStoreId = process.env.POS_STORE_ID
  if (configuredStoreId) query = query.eq('store_id', configuredStoreId)
  const { data: employee, error: employeeError } = await query.maybeSingle()
  if (employeeError || !employee) throw new Error('This login is not linked to an active POS employee. Ask the store owner to finish staff setup.')
  if (permittedRoles && !permittedRoles.includes(employee.role as UserRole)) throw new Error('Your role does not have permission to perform this action.')
  return {
    userId: user.id, employeeId: employee.id, storeId: employee.store_id,
    displayName: employee.display_name, role: employee.role as UserRole,
    refundLimitMinor: employee.refund_limit_minor === null ? null : Number(employee.refund_limit_minor ?? 0), admin,
  }
}

export function routeError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Unexpected server error.'
  const status = /sign in|session has expired/i.test(message) ? 401
    : /permission|role does not/i.test(message) ? 403
      : /not configured/i.test(message) ? 503
        : /not linked/i.test(message) ? 403 : 400
  return Response.json({ error: message }, { status })
}
