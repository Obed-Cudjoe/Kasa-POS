import { getCloudflareContext } from '@opennextjs/cloudflare'

const TABLES = new Set([
  'stores', 'employees', 'devices', 'categories', 'tax_categories', 'tax_rates', 'products',
  'customers', 'shifts', 'orders', 'order_items', 'order_item_taxes', 'payments', 'refunds',
  'refund_items', 'refund_item_taxes', 'inventory', 'inventory_movements', 'daily_reports',
  'sync_events', 'payment_webhook_events', 'privacy_consent_events',
])
const JSON_COLUMNS = new Set([
  'settings', 'tax_snapshot', 'provider_metadata', 'tender_totals', 'tax_component_totals',
  'metrics', 'response_summary',
])
const BOOLEAN_COLUMNS = new Set([
  'active', 'track_inventory', 'receipt_contact_only', 'marketing_opt_in', 'restock', 'signature_verified',
])
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

export interface DbError { message: string }
export interface DbResult<T = unknown> { data: T | null; error: DbError | null }
export interface QueryOptions { onConflict?: string; ignoreDuplicates?: boolean }

export async function getWorkerEnv(): Promise<CloudflareEnv> {
  const context = await getCloudflareContext({ async: true })
  return context.env as CloudflareEnv
}

export async function getD1Database(): Promise<D1Database> {
  const env = await getWorkerEnv()
  if (!env.DB) throw new Error('Cloudflare D1 is not bound to this Worker.')
  return env.DB
}

function identifier(value: string) {
  if (!IDENTIFIER.test(value)) throw new Error('Invalid database identifier.')
  return `"${value}"`
}

function fieldList(value: string) {
  const fields = value.trim() === '*' ? ['*'] : value.split(',').map((field) => field.trim())
  if (!fields.length || fields.some((field) => field !== '*' && !IDENTIFIER.test(field))) {
    throw new Error('Unsupported database field selection.')
  }
  return fields.map((field) => field === '*' ? '*' : identifier(field)).join(', ')
}

function encodedValue(column: string, value: unknown): unknown {
  if (value === undefined) return undefined
  if (typeof value === 'boolean') return value ? 1 : 0
  if (JSON_COLUMNS.has(column) && value !== null && typeof value === 'object') return JSON.stringify(value)
  return value
}

function decodedRow(row: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...row }
  for (const [key, value] of Object.entries(copy)) {
    if (typeof value === 'string' && JSON_COLUMNS.has(key)) {
      try { copy[key] = JSON.parse(value) as unknown } catch { /* Preserve malformed legacy text for diagnosis. */ }
    }
    if (typeof value === 'number' && (value === 0 || value === 1) && BOOLEAN_COLUMNS.has(key)) copy[key] = value === 1
  }
  return copy
}

interface Filter { sql: string; values: unknown[] }

type Action = 'select' | 'insert' | 'upsert' | 'update'

class D1QueryBuilder implements PromiseLike<DbResult<unknown>> {
  private action: Action = 'select'
  private selected = '*'
  private returning: string | null = null
  private data: Record<string, unknown> | Array<Record<string, unknown>> | null = null
  private filters: Filter[] = []
  private ordering: Array<{ field: string; ascending: boolean }> = []
  private limitValue: number | null = null
  private queryOptions: QueryOptions = {}
  private execution?: Promise<DbResult<unknown>>

  constructor(private readonly table: string, private readonly dbProvider: () => Promise<D1Database>) {
    if (!TABLES.has(table)) throw new Error(`Unsupported data table: ${table}`)
  }

  select(fields = '*') {
    const safeFields = fieldList(fields)
    if (this.action === 'select') this.selected = safeFields
    else this.returning = safeFields
    return this
  }

  eq(field: string, value: unknown) { return this.compare(field, '=', value) }
  neq(field: string, value: unknown) { return this.compare(field, '<>', value) }
  gt(field: string, value: unknown) { return this.compare(field, '>', value) }
  gte(field: string, value: unknown) { return this.compare(field, '>=', value) }
  lt(field: string, value: unknown) { return this.compare(field, '<', value) }
  lte(field: string, value: unknown) { return this.compare(field, '<=', value) }

  is(field: string, value: unknown) {
    const name = identifier(field)
    if (value === null) this.filters.push({ sql: `${name} IS NULL`, values: [] })
    else if (typeof value === 'boolean') this.filters.push({ sql: `${name} IS ?`, values: [value ? 1 : 0] })
    else this.filters.push({ sql: `${name} IS ?`, values: [value] })
    return this
  }

  in(field: string, values: unknown[]) {
    const name = identifier(field)
    if (!Array.isArray(values) || values.length === 0) {
      this.filters.push({ sql: '1 = 0', values: [] })
      return this
    }
    this.filters.push({ sql: `${name} IN (${values.map(() => '?').join(', ')})`, values: values.map((value) => encodedValue(field, value)) })
    return this
  }

  order(field: string, options: { ascending?: boolean } = {}) {
    this.ordering.push({ field: identifier(field), ascending: options.ascending !== false })
    return this
  }

  limit(value: number) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid query limit.')
    this.limitValue = value
    return this
  }

  insert(data: Record<string, unknown> | Array<Record<string, unknown>>) {
    this.action = 'insert'
    this.data = data
    return this
  }

  upsert(data: Record<string, unknown> | Array<Record<string, unknown>>, options: QueryOptions = {}) {
    this.action = 'upsert'
    this.data = data
    this.queryOptions = options
    return this
  }

  update(data: Record<string, unknown>) {
    this.action = 'update'
    this.data = data
    return this
  }

  async maybeSingle(): Promise<DbResult<Record<string, unknown>>> {
    const result = await this.execute()
    if (result.error) return { data: null, error: result.error }
    const rows = Array.isArray(result.data) ? result.data as Array<Record<string, unknown>> : []
    if (rows.length > 1) return { data: null, error: { message: 'Query returned more than one row.' } }
    return { data: rows[0] ?? null, error: null }
  }

  then<TResult1 = DbResult<unknown>, TResult2 = never>(
    onfulfilled?: ((value: DbResult<unknown>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected)
  }

  private compare(field: string, operator: string, value: unknown) {
    const name = identifier(field)
    if (value === null && operator === '=') this.filters.push({ sql: `${name} IS NULL`, values: [] })
    else if (value === null && operator === '<>') this.filters.push({ sql: `${name} IS NOT NULL`, values: [] })
    else this.filters.push({ sql: `${name} ${operator} ?`, values: [encodedValue(field, value)] })
    return this
  }

  private whereClause() {
    return this.filters.length ? ` WHERE ${this.filters.map((filter) => `(${filter.sql})`).join(' AND ')}` : ''
  }

  private filterValues() { return this.filters.flatMap((filter) => filter.values) }

  private async execute(): Promise<DbResult<unknown>> {
    if (!this.execution) this.execution = this.executeOnce()
    return this.execution
  }

  private async executeOnce(): Promise<DbResult<unknown>> {
    try {
      const db = await this.dbProvider()
      const table = identifier(this.table)
      if (this.action === 'select') {
        let sql = `SELECT ${this.selected} FROM ${table}${this.whereClause()}`
        if (this.ordering.length) sql += ` ORDER BY ${this.ordering.map((order) => `${order.field} ${order.ascending ? 'ASC' : 'DESC'}`).join(', ')}`
        if (this.limitValue !== null) sql += ` LIMIT ${this.limitValue}`
        const result = await db.prepare(sql).bind(...this.filterValues()).all<Record<string, unknown>>()
        return { data: (result.results ?? []).map(decodedRow), error: null }
      }

      const records = Array.isArray(this.data) ? this.data : this.data ? [this.data] : []
      if (!records.length) throw new Error('A database write requires at least one record.')
      const statements: D1PreparedStatement[] = []
      for (const original of records) {
        const record = { ...original }
        if ('id' in record && record.id == null) delete record.id
        if (this.action !== 'update' && !('id' in record) && this.table !== 'inventory') record.id = crypto.randomUUID()
        const columns = Object.keys(record).filter((column) => record[column] !== undefined)
        if (!columns.length) throw new Error('A database write requires fields.')
        columns.forEach(identifier)
        const values = columns.map((column) => encodedValue(column, record[column]))
        let sql = ''
        if (this.action === 'update') {
          if (!this.filters.length) throw new Error('Refusing to update rows without a filter.')
          const sets = columns.map((column) => `${identifier(column)} = ?`).join(', ')
          sql = `UPDATE ${table} SET ${sets}${this.whereClause()}`
        } else {
          const names = columns.map(identifier).join(', ')
          const placeholders = columns.map(() => '?').join(', ')
          sql = `INSERT INTO ${table} (${names}) VALUES (${placeholders})`
          if (this.action === 'upsert') {
            const conflictColumns = (this.queryOptions.onConflict ?? '').split(',').map((column) => column.trim()).filter(Boolean)
            if (this.queryOptions.ignoreDuplicates) {
              sql += conflictColumns.length ? ` ON CONFLICT (${conflictColumns.map(identifier).join(', ')}) DO NOTHING` : ' ON CONFLICT DO NOTHING'
            } else if (conflictColumns.length) {
              const updates = columns.filter((column) => !conflictColumns.includes(column))
              if (updates.length) sql += ` ON CONFLICT (${conflictColumns.map(identifier).join(', ')}) DO UPDATE SET ${updates.map((column) => `${identifier(column)} = excluded.${identifier(column)}`).join(', ')}`
              else sql += ` ON CONFLICT (${conflictColumns.map(identifier).join(', ')}) DO NOTHING`
            } else {
              throw new Error('Upsert requires an explicit conflict target.')
            }
          }
        }
        if (this.returning) sql += ` RETURNING ${this.returning}`
        const bindValues = this.action === 'update' ? [...values, ...this.filterValues()] : values
        statements.push(db.prepare(sql).bind(...bindValues))
      }

      if (this.returning) {
        const rows: Array<Record<string, unknown>> = []
        for (const statement of statements) {
          const result = await statement.all<Record<string, unknown>>()
          rows.push(...(result.results ?? []).map(decodedRow))
        }
        return { data: rows, error: null }
      }
      const results = await db.batch(statements)
      const changes = results.reduce((sum, result) => sum + Number(result.meta?.changes ?? 0), 0)
      return { data: { changes }, error: null }
    } catch (error) {
      return { data: null, error: { message: error instanceof Error ? error.message : 'Database operation failed.' } }
    }
  }
}

export class D1DataClient {
  constructor(private readonly database?: D1Database) {}

  from(table: string) {
    const provider = async () => this.database ?? await getD1Database()
    return new D1QueryBuilder(table, provider)
  }

  async rpc<T = unknown>(name: string, args: Record<string, unknown>): Promise<DbResult<T>> {
    try {
      const db = this.database ?? await getD1Database()
      const { executeD1Rpc } = await import('./d1-rpc')
      return { data: await executeD1Rpc(db, name, args) as T, error: null }
    } catch (error) {
      return { data: null, error: { message: error instanceof Error ? error.message : 'Database operation failed.' } }
    }
  }
}
