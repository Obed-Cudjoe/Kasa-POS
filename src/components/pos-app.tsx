'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  Activity, AlertTriangle, ArrowDownToLine, ArrowLeftRight, BarChart3, Banknote, Boxes,
  Check, ChevronDown, CircleDollarSign, Clock3, Cloud, CreditCard, FileText,
  History, LayoutDashboard, Loader2, LogOut, Mail, Menu, Package, Plus, Printer, ReceiptText,
  RefreshCw, RotateCcw, Search, Settings, ShieldCheck, ShoppingBasket, ShoppingCart, Smartphone, Sparkles,
  Store, Trash2, TrendingUp, UserPlus, Users, Wifi, WifiOff, X,
} from 'lucide-react'
import { db, getMeta, setMeta, clearLocalDemoData } from '@/lib/local-db'
import { ensureDemoData, DEMO_DEVICE_ID } from '@/lib/demo-seed'
import { calculateLine, summarizeLines, taxLabel } from '@/lib/tax'
import { formatMoney, inputFromMinor, parseMoneyInput } from '@/lib/money'
import {
  addNewProduct, adjustInventory, closeShift, completePaidSale, createPendingDigitalOrder,
  createRefund, localDeviceId, markDigitalPaymentConfirmed, newId, openShift, saveEmployee,
  saveProduct, saveTaxCategory,
} from '@/lib/pos-ops'
import { downloadReceiptPdf, printReceiptEscPos, shareReceipt } from '@/lib/receipt'
import { getAccessToken, getBrowserSupabase } from '@/lib/supabase-browser'
import { hasOfflinePin, saveOfflinePin, verifyOfflinePin, clearOfflinePin } from '@/lib/offline-pin'
import { pullCloud, syncNow } from '@/lib/sync-client'
import type { CalculatedLine, Employee, Order, PaymentMethod, Product, Refund, Shift, TaxCategory, TaxComponent, TaxTreatment, UserRole } from '@/lib/types'

type View = 'checkout' | 'transactions' | 'products' | 'inventory' | 'reports' | 'shifts' | 'team' | 'tax' | 'settings' | 'more'
type ModalName = 'payment' | 'receipt' | 'refund' | 'product' | 'stock' | 'shift' | 'employee' | 'tax' | null

type ToastState = { message: string; tone: 'plain' | 'success' | 'error' } | null
type PendingPayment = { orderId: string; paymentId: string; method: Exclude<PaymentMethod, 'cash'>; reference?: string; message: string; network?: string; retryable?: boolean }
type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }> }
type ProductFormState = { id?: string; name: string; sku: string; categoryName: string; taxCategoryId: string; price: string; priceMode: Product['priceMode']; stock: string; active: boolean }
type TaxFormState = { id?: string; name: string; code: string; treatment: TaxTreatment; defaultPriceMode: Product['priceMode']; effectiveFrom: string; components: TaxComponent[] }

const CLOUD_PUBLIC_READY = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
const APP_DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE !== 'false' || !CLOUD_PUBLIC_READY
const money = (minor: number, currency = 'GHS') => formatMoney(minor, currency)
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'KS'
const titleCase = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase())
const stamp = (value: string) => new Date(value).toLocaleString('en-GH', { dateStyle: 'medium', timeStyle: 'short' })
const roleLabel = (role: UserRole) => role === 'owner' ? 'Owner' : role === 'manager' ? 'Manager' : 'Cashier'
const stockEmoji = (category: string) => category === 'Drinks' ? '◉' : category === 'Fresh food' ? '✳' : category === 'Household' ? '✦' : category === 'Snacks' ? '◇' : '▦'
const statusTone = (status: string) => ['paid', 'processed', 'confirmed', 'synced', 'open'].includes(status) ? 'green' : ['pending_payment', 'pending', 'processing', 'refund_pending', 'local'].includes(status) ? 'amber' : ['failed', 'conflict', 'voided', 'needs_attention'].includes(status) ? 'red' : 'blue'
const roleOrder: Record<UserRole, number> = { owner: 0, manager: 1, cashier: 2 }

const navItems: Array<{ key: View; label: string; icon: typeof LayoutDashboard; roles?: UserRole[] }> = [
  { key: 'checkout', label: 'Checkout', icon: ShoppingCart },
  { key: 'transactions', label: 'Transactions', icon: ReceiptText },
  { key: 'products', label: 'Products', icon: Package, roles: ['owner', 'manager'] },
  { key: 'inventory', label: 'Inventory', icon: Boxes, roles: ['owner', 'manager'] },
  { key: 'reports', label: 'Sales & tax reports', icon: BarChart3, roles: ['owner', 'manager'] },
  { key: 'shifts', label: 'Shifts & cash', icon: Clock3 },
  { key: 'team', label: 'Team', icon: Users, roles: ['owner', 'manager'] },
  { key: 'tax', label: 'Tax setup', icon: ShieldCheck, roles: ['owner', 'manager'] },
  { key: 'settings', label: 'Settings', icon: Settings, roles: ['owner', 'manager'] },
]

function Modal({ title, description, children, footer, wide = false, onClose, labelId }: {
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  onClose: () => void
  labelId?: string
}) {
  return (
    <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className={`modal-card${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={labelId ?? 'modal-title'}>
        <header className="modal-head">
          <div><h2 id={labelId ?? 'modal-title'}>{title}</h2>{description && <p>{description}</p>}</div>
          <button className="modal-close print-hidden" type="button" onClick={onClose} aria-label="Close"><X size={15} /></button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer print-hidden">{footer}</footer>}
      </section>
    </div>
  )
}

function StatusBadge({ status, label }: { status: string; label?: string }) {
  const tone = statusTone(status)
  return <span className={`badge ${tone}`}>{label ?? titleCase(status)}</span>
}

function SectionHeading({ title, subtitle, actions }: { title: string; subtitle: string; actions?: ReactNode }) {
  return <div className="page-heading"><div><h1>{title}</h1><p>{subtitle}</p></div>{actions && <div className="heading-actions">{actions}</div>}</div>
}

function MetricCard({ label, value, icon: Icon, note, tone = 'green' }: { label: string; value: string; icon: typeof CircleDollarSign; note: string; tone?: 'green' | 'amber' | 'blue' }) {
  return <div className="metric-card"><div className="metric-top"><span className="metric-label">{label}</span><span className={`metric-icon ${tone}`}><Icon size={15} /></span></div><div className="metric-value">{value}</div><div className="metric-change">{note}</div></div>
}

export function PosApp() {
  const [ready, setReady] = useState(false)
  const [view, setView] = useState<View>('checkout')
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [taxCategories, setTaxCategories] = useState<TaxCategory[]>([])
  const [inventory, setInventory] = useState<Array<{ storeId: string; productId: string; quantityOnHand: number; rowVersion: number; updatedAt: string }>>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [refunds, setRefunds] = useState<Refund[]>([])
  const [shifts, setShifts] = useState<Shift[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [conflictCount, setConflictCount] = useState(0)
  const [online, setOnline] = useState(true)
  const [syncBusy, setSyncBusy] = useState(false)
  const [cloudSignedIn, setCloudSignedIn] = useState(false)
  const [cloudPaymentEnabled, setCloudPaymentEnabled] = useState(false)
  const [toast, setToast] = useState<ToastState>(null)
  const [modal, setModal] = useState<ModalName>(null)
  const [cart, setCart] = useState<Record<string, number>>({})
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState('All items')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [cashReceived, setCashReceived] = useState('')
  const [momoNetwork, setMomoNetwork] = useState('mtn')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(null)
  const [paymentChecking, setPaymentChecking] = useState(false)
  const [receiptOrder, setReceiptOrder] = useState<Order | null>(null)
  const [receiptRefund, setReceiptRefund] = useState<Refund | null>(null)
  const [receiptEmail, setReceiptEmail] = useState('')
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(false)
  const [tableSearch, setTableSearch] = useState('')
  const [productForm, setProductForm] = useState<ProductFormState | null>(null)
  const [taxForm, setTaxForm] = useState<TaxFormState | null>(null)
  const [employeeForm, setEmployeeForm] = useState<{ id?: string; displayName: string; role: UserRole } | null>(null)
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [refundAvailable, setRefundAvailable] = useState<Record<string, number>>({})
  const [refundQty, setRefundQty] = useState<Record<string, number>>({})
  const [refundRestock, setRefundRestock] = useState<Record<string, boolean>>({})
  const [refundReason, setRefundReason] = useState('Customer return')
  const [stockProduct, setStockProduct] = useState<Product | null>(null)
  const [stockCount, setStockCount] = useState('')
  const [stockReason, setStockReason] = useState('Physical count')
  const [shiftFormMode, setShiftFormMode] = useState<'open' | 'close'>('open')
  const [shiftAmount, setShiftAmount] = useState('200.00')
  const [shiftReason, setShiftReason] = useState('')
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginBusy, setLoginBusy] = useState(false)
  const [loginError, setLoginError] = useState('')
  const [cachedOfflineEmployee, setCachedOfflineEmployee] = useState<Employee | null>(null)
  const [offlinePinAvailable, setOfflinePinAvailable] = useState(false)
  const [offlinePinInput, setOfflinePinInput] = useState('')
  const [offlinePinSetup, setOfflinePinSetup] = useState('')
  const [offlinePinConfirm, setOfflinePinConfirm] = useState('')
  const [offlinePinSaving, setOfflinePinSaving] = useState(false)
  const [displayCurrency, setDisplayCurrency] = useState<'GHS' | 'USD' | 'EUR' | 'KES'>('GHS')
  const [fxRate, setFxRate] = useState('')
  const [now, setNow] = useState(new Date())
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const callbackHandled = useRef(false)
  const isManager = employee?.role === 'owner' || employee?.role === 'manager'
  const deviceId = typeof window !== 'undefined' ? localDeviceId() : DEMO_DEVICE_ID
  const activeShift = shifts.filter((shift) => shift.status === 'open' && shift.deviceId === deviceId).sort((a, b) => b.openedAt.localeCompare(a.openedAt))[0]

  const showToast = useCallback((message: string, tone: 'plain' | 'success' | 'error' = 'plain') => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ message, tone })
    toastTimer.current = setTimeout(() => setToast(null), 4200)
  }, [])

  const refreshLocalState = useCallback(async () => {
    const [productRows, taxRows, stockRows, orderRows, refundRows, employeeRows, shiftRows, outboxRows] = await Promise.all([
      db.products.toArray(), db.taxCategories.toArray(), db.inventory.toArray(), db.orders.toArray(),
      db.refunds.toArray(), db.employees.toArray(), db.shifts.toArray(), db.syncOutbox.toArray(),
    ])
    setProducts(productRows.filter((product) => product.active).sort((a, b) => a.name.localeCompare(b.name)))
    setTaxCategories(taxRows.filter((tax) => tax.active).sort((a, b) => a.name.localeCompare(b.name)))
    setInventory(stockRows)
    setOrders(orderRows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
    setRefunds(refundRows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
    setEmployees(employeeRows.filter((person) => person.status === 'active').sort((a, b) => roleOrder[a.role] - roleOrder[b.role] || a.displayName.localeCompare(b.displayName)))
    setShifts(shiftRows.sort((a, b) => b.openedAt.localeCompare(a.openedAt)))
    setPendingCount(outboxRows.filter((event) => event.status === 'pending').length)
    setConflictCount(outboxRows.filter((event) => event.status === 'conflict').length)
    const savedCurrency = await getMeta<'GHS' | 'USD' | 'EUR' | 'KES'>('display-currency', 'GHS')
    const savedRate = await getMeta<string>('display-fx-rate', '')
    setDisplayCurrency(savedCurrency)
    setFxRate(savedRate)
  }, [])

  const finishLogin = useCallback(async (selected: Employee) => {
    setEmployee(selected)
    setLoginError('')
    if (typeof window !== 'undefined') localStorage.setItem('pos-selected-employee', selected.id)
    await setMeta('cached-employee', selected)
    await db.employees.put(selected)
    if (APP_DEMO_MODE && !activeShift) {
      // In the demo, the seeded open shift is shared by the sample cashier. No shift is fabricated here.
    }
    await refreshLocalState()
  }, [activeShift, refreshLocalState])

  useEffect(() => {
    let mounted = true
    const boot = async () => {
      try {
        setOnline(typeof navigator === 'undefined' ? true : navigator.onLine)
        if (typeof window !== 'undefined' && !localStorage.getItem('pos-device-id')) {
          localStorage.setItem('pos-device-id', APP_DEMO_MODE ? DEMO_DEVICE_ID : newId())
        }
        if (APP_DEMO_MODE) {
          await ensureDemoData()
          if (!mounted) return
          await refreshLocalState()
          const rememberedId = localStorage.getItem('pos-selected-employee')
          if (rememberedId) {
            const remembered = await db.employees.get(rememberedId)
            if (remembered?.status === 'active') setEmployee(remembered)
          }
          const health = await fetch('/api/health', { cache: 'no-store' }).then((response) => response.json()).catch(() => null)
          if (mounted) setCloudPaymentEnabled(Boolean(health?.paymentsConfigured))
        } else {
          const cachedEmployee = await getMeta<Employee | null>('cached-employee', null)
          const supabase = getBrowserSupabase()
          const { data: { session } } = supabase ? await supabase.auth.getSession() : { data: { session: null } }
          if (session?.access_token) {
            const profileResponse = await fetch('/api/auth/session', { headers: { authorization: `Bearer ${session.access_token}` }, cache: 'no-store' }).catch(() => null)
            if (profileResponse?.ok) {
              const profile = await profileResponse.json() as { employee: Employee }
              await db.employees.put(profile.employee)
              setEmployee(profile.employee)
              setCachedOfflineEmployee(null)
              setCloudSignedIn(true)
              await setMeta('cached-employee', profile.employee)
              await pullCloud().catch((error) => showToast(error instanceof Error ? error.message : 'Cloud data could not be refreshed.', 'error'))
            } else if (!navigator.onLine && cachedEmployee) {
              setCachedOfflineEmployee(cachedEmployee)
              setOfflinePinAvailable(await hasOfflinePin(cachedEmployee.id))
              setCloudSignedIn(false)
            }
          } else if (!navigator.onLine && cachedEmployee) {
            setCachedOfflineEmployee(cachedEmployee)
            setOfflinePinAvailable(await hasOfflinePin(cachedEmployee.id))
            setCloudSignedIn(false)
          }
          if (mounted) await refreshLocalState()
          const health = await fetch('/api/health', { cache: 'no-store' }).then((response) => response.json()).catch(() => null)
          if (mounted) setCloudPaymentEnabled(Boolean(health?.paymentsConfigured))
        }
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'The POS could not start.', 'error')
      } finally {
        if (mounted) setReady(true)
      }
    }
    void boot()
    const updateOnline = () => setOnline(navigator.onLine)
    window.addEventListener('online', updateOnline)
    window.addEventListener('offline', updateOnline)
    const installListener = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', installListener)
    window.addEventListener('appinstalled', () => { setInstalled(true); setInstallPrompt(null) })
    const clock = setInterval(() => setNow(new Date()), 30_000)
    return () => {
      mounted = false
      window.removeEventListener('online', updateOnline)
      window.removeEventListener('offline', updateOnline)
      window.removeEventListener('beforeinstallprompt', installListener)
      clearInterval(clock)
      if (toastTimer.current) clearTimeout(toastTimer.current)
    }
  }, [refreshLocalState, showToast])

  useEffect(() => {
    let active = true
    if (APP_DEMO_MODE || !employee) {
      setOfflinePinAvailable(false)
      return () => { active = false }
    }
    void hasOfflinePin(employee.id).then((available) => { if (active) setOfflinePinAvailable(available) })
    return () => { active = false }
  }, [employee?.id])

  const categories = useMemo(() => ['All items', ...Array.from(new Set(products.map((product) => product.categoryName))).sort()], [products])
  const filteredProducts = useMemo(() => products.filter((product) => {
    const term = search.trim().toLowerCase()
    const matchesTerm = !term || `${product.name} ${product.sku} ${product.categoryName}`.toLowerCase().includes(term)
    const matchesCategory = activeCategory === 'All items' || product.categoryName === activeCategory
    return matchesTerm && matchesCategory
  }), [products, search, activeCategory])
  const cartLines: CalculatedLine[] = useMemo(() => Object.entries(cart).flatMap(([productId, quantity]) => {
    const product = products.find((item) => item.id === productId)
    const tax = taxCategories.find((item) => item.id === product?.taxCategoryId)
    return product && tax && quantity > 0 ? [calculateLine(product, quantity, tax)] : []
  }), [cart, products, taxCategories])
  const cartTotals = useMemo(() => summarizeLines(cartLines), [cartLines])
  const allPendingDigital = useMemo(() => orders.filter((order) => order.status === 'pending_payment').length, [orders])

  const displayMoney = useCallback((minor: number, compact = false) => {
    const base = compact ? formatMoney(minor, 'GHS') : formatMoney(minor, 'GHS')
    const rate = Number(fxRate)
    if (displayCurrency === 'GHS') return base
    if (!Number.isFinite(rate) || rate <= 0) return `${base} · ${displayCurrency} rate unset`
    return `${base} · ${formatMoney(Math.round(minor * rate), displayCurrency)}`
  }, [displayCurrency, fxRate])

  const syncData = useCallback(async (quiet = false) => {
    if (APP_DEMO_MODE || !online || !cloudSignedIn) {
      if (!quiet) showToast(APP_DEMO_MODE ? 'Demo data is stored only on this device; no cloud sync was sent.' : !online ? 'Offline: local changes are queued for sync.' : 'Sign in to sync this device.', 'plain')
      return
    }
    if (syncBusy) return
    setSyncBusy(true)
    try {
      const result = await syncNow()
      await refreshLocalState()
      if (result.pushed.conflicts?.length) showToast(`${result.pushed.conflicts.length} change(s) need review. Inventory counts are never silently overwritten.`, 'error')
      else if (!quiet) showToast(`Sync complete · ${result.pushed.sent} change(s) sent.`, 'success')
    } catch (error) {
      if (!quiet) showToast(error instanceof Error ? error.message : 'Sync did not complete. Local changes are retained.', 'error')
    } finally {
      setSyncBusy(false)
    }
  }, [cloudSignedIn, online, refreshLocalState, showToast, syncBusy])

  useEffect(() => {
    if (!cloudSignedIn || APP_DEMO_MODE || !online) return
    const timer = setInterval(() => { void syncData(true) }, 20_000)
    return () => clearInterval(timer)
  }, [cloudSignedIn, online, syncData])

  useEffect(() => {
    if (!cloudSignedIn || APP_DEMO_MODE || !employee) return
    const client = getBrowserSupabase()
    if (!client) return
    const channel = client.channel(`pos-store-${employee.storeId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products', filter: `store_id=eq.${employee.storeId}` }, () => { void syncData(true) })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory', filter: `store_id=eq.${employee.storeId}` }, () => { void syncData(true) })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `store_id=eq.${employee.storeId}` }, () => { void syncData(true) })
      .subscribe()
    return () => { void client.removeChannel(channel) }
  }, [cloudSignedIn, employee, syncData])

  const setEmployeeSession = useCallback(async (selected: Employee) => {
    await finishLogin(selected)
    setView('checkout')
  }, [finishLogin])

  const signInCloud = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const supabase = getBrowserSupabase()
    if (!supabase) { setLoginError('Cloud sign-in is not configured. Use demo mode or complete .env.local setup.'); return }
    setLoginBusy(true)
    setLoginError('')
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: loginEmail.trim(), password: loginPassword })
      if (error) throw new Error(error.message)
      const token = await getAccessToken()
      if (!token) throw new Error('Sign-in did not create a session.')
      const response = await fetch('/api/auth/session', { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' })
      const data = await response.json() as { error?: string; employee?: Employee }
      if (!response.ok || !data.employee) throw new Error(data.error || 'This login is not linked to a POS employee.')
      await db.employees.put(data.employee)
      await setMeta('cached-employee', data.employee)
      setEmployee(data.employee)
      setCachedOfflineEmployee(null)
      setCloudSignedIn(true)
      setLoginPassword('')
      await pullCloud()
      await refreshLocalState()
      showToast(`Welcome, ${data.employee.displayName}.`, 'success')
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Sign-in failed. Check connection and credentials.')
    } finally {
      setLoginBusy(false)
    }
  }, [loginEmail, loginPassword, refreshLocalState, showToast])

  const signOut = useCallback(async () => {
    if (APP_DEMO_MODE) {
      setEmployee(null)
      if (typeof window !== 'undefined') localStorage.removeItem('pos-selected-employee')
      setModal(null)
      return
    }
    const employeeToClear = employee ?? cachedOfflineEmployee
    const supabase = getBrowserSupabase()
    await supabase?.auth.signOut({ scope: 'local' }).catch(() => undefined)
    if (employeeToClear) await clearOfflinePin(employeeToClear.id)
    await db.appMeta.delete('cached-employee')
    setCloudSignedIn(false)
    setEmployee(null)
    setCachedOfflineEmployee(null)
    setOfflinePinAvailable(false)
    setOfflinePinInput('')
    setLoginPassword('')
    setModal(null)
  }, [cachedOfflineEmployee, employee])

  const unlockOffline = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!cachedOfflineEmployee || !offlinePinAvailable) return
    setLoginBusy(true)
    setLoginError('')
    try {
      const valid = await verifyOfflinePin(cachedOfflineEmployee.id, offlinePinInput)
      if (!valid) throw new Error('That device PIN is incorrect.')
      setEmployee(cachedOfflineEmployee)
      setCloudSignedIn(false)
      setOfflinePinInput('')
      showToast(`Offline session · ${cachedOfflineEmployee.displayName}. Cloud sync and digital payments are paused.`, 'plain')
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Offline unlock failed.')
    } finally {
      setLoginBusy(false)
    }
  }

  const saveLocalOfflinePin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!employee || !cloudSignedIn || !online) return
    if (offlinePinSetup !== offlinePinConfirm) { showToast('PIN entries do not match.', 'error'); return }
    setOfflinePinSaving(true)
    try {
      await saveOfflinePin(employee.id, offlinePinSetup)
      setOfflinePinAvailable(true)
      setOfflinePinSetup('')
      setOfflinePinConfirm('')
      showToast('A local offline PIN is saved on this device.', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Offline PIN could not be saved.', 'error')
    } finally {
      setOfflinePinSaving(false)
    }
  }

  const openPayment = () => {
    if (!cartLines.length) return
    if (!activeShift) {
      showToast('Open a cash shift on this device before checkout.', 'error')
      setView('shifts')
      return
    }
    setPaymentMethod('cash')
    setCashReceived(inputFromMinor(cartTotals.totalMinor))
    setCustomerEmail('')
    setCustomerPhone('')
    setPendingPayment(null)
    setModal('payment')
  }

  const finishCashSale = async () => {
    if (!employee || !activeShift) return
    try {
      const received = parseMoneyInput(cashReceived)
      const sale = await completePaidSale({
        employee, shift: activeShift, lines: cartLines, paymentMethod: 'cash', paymentStatus: 'confirmed',
        source: APP_DEMO_MODE ? 'demo' : 'local', cashTenderedMinor: received,
      })
      setCart({})
      setReceiptOrder(sale.order)
      setReceiptRefund(null)
      setReceiptEmail('')
      setModal('receipt')
      await refreshLocalState()
      if (!APP_DEMO_MODE && online) void syncData(true)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Cash sale could not be saved.', 'error')
    }
  }

  const startDigitalPayment = async () => {
    if (!employee || !activeShift || (paymentMethod !== 'card' && paymentMethod !== 'momo')) return
    let requestContext: PendingPayment | null = null
    try {
      if (APP_DEMO_MODE) {
        const sale = await completePaidSale({
          employee, shift: activeShift, lines: cartLines, paymentMethod, paymentStatus: 'demo_simulated', source: 'demo',
          providerNetwork: paymentMethod === 'momo' ? `Demo · ${momoNetwork.toUpperCase()}` : 'Demo · card',
        })
        setCart({})
        setReceiptOrder(sale.order)
        setReceiptRefund(null)
        setModal('receipt')
        await refreshLocalState()
        return
      }
      const pending = await createPendingDigitalOrder({ employee, shift: activeShift, lines: cartLines, method: paymentMethod, network: paymentMethod === 'momo' ? momoNetwork : 'card' })
      setCart({})
      requestContext = { orderId: pending.order.id, paymentId: pending.payment.id, method: pending.payment.method as Exclude<PaymentMethod, 'cash'>, network: paymentMethod === 'momo' ? momoNetwork : undefined, message: online ? 'Preparing a secure provider request…' : 'Offline: no request was sent. This payment remains pending until the provider can be reached and confirms it.', retryable: !online }
      setPendingPayment(requestContext)
      await refreshLocalState()
      setModal('payment')
      if (!online) return

      await syncData(true)
      const cloudEvent = await db.syncOutbox.where('entityId').equals(pending.order.id).first()
      if (!cloudEvent || cloudEvent.status !== 'synced') {
        setPendingPayment((value) => value ? { ...value, retryable: true, message: 'The pending sale is safely stored here, but cloud sync did not acknowledge it. No charge request was sent.' } : value)
        return
      }
      const token = await getAccessToken()
      if (!token) {
        setPendingPayment((value) => value ? { ...value, retryable: true, message: 'Sign in to cloud before a real card or mobile-money request can be sent. The sale remains pending.' } : value)
        return
      }
      const response = await fetch('/api/payments/paystack/initialize', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ orderId: pending.order.id, paymentId: pending.payment.id, email: customerEmail.trim(), phone: customerPhone.trim(), network: momoNetwork }),
      })
      const data = await response.json() as { error?: string; reference?: string; authorizationUrl?: string; displayText?: string; message?: string; providerStatus?: string }
      if (!response.ok) {
        if (data.reference) {
          await db.payments.update(pending.payment.id, { provider: 'paystack', providerNetwork: paymentMethod === 'momo' ? momoNetwork : 'card', providerReference: data.reference, status: 'initiated' })
          await db.orders.update(pending.order.id, { providerReference: data.reference, paymentStatus: 'initiated', updatedAt: new Date().toISOString() })
        }
        setPendingPayment((value) => value ? { ...value, reference: data.reference ?? value.reference, retryable: !data.reference, message: `${data.error || 'Provider request was not completed.'} The POS sale remains unpaid; check the saved reference before retrying.` } : value)
        return
      }
      if (data.reference) {
        const paymentStatus = data.providerStatus === 'initiated' ? 'initiated' : 'pending'
        await db.payments.update(pending.payment.id, { provider: 'paystack', providerNetwork: paymentMethod === 'momo' ? momoNetwork : 'card', providerReference: data.reference, status: paymentStatus })
        await db.orders.update(pending.order.id, { providerReference: data.reference, paymentStatus, updatedAt: new Date().toISOString() })
      }
      if (paymentMethod === 'card' && data.authorizationUrl) {
        window.location.assign(data.authorizationUrl)
        return
      }
      setPendingPayment((value) => value ? {
        ...value, reference: data.reference,
        message: data.displayText || data.message || 'Request sent. Ask the customer to approve the prompt on their phone. The order will stay pending until Paystack confirms it.',
      } : value)
    } catch (error) {
      if (requestContext) {
        await pullCloud().catch(() => undefined)
        const payment = await db.payments.get(requestContext.paymentId)
        const order = await db.orders.get(requestContext.orderId)
        const reference = payment?.providerReference ?? order?.providerReference
        setPendingPayment({ ...requestContext, reference, retryable: !reference, message: `${error instanceof Error ? error.message : 'Network interrupted during payment setup.'} The order stays unpaid. If a provider reference was saved, check it before retrying.` })
      }
      showToast(error instanceof Error ? error.message : 'Payment initialization failed.', 'error')
    }
  }

  const verifyPendingPayment = useCallback(async (current: PendingPayment, showStatus = true) => {
    if (!current.reference || !online || !cloudSignedIn || APP_DEMO_MODE || paymentChecking) return
    setPaymentChecking(true)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Sign in again to check provider status.')
      const response = await fetch('/api/payments/paystack/verify', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ orderId: current.orderId, reference: current.reference }), cache: 'no-store',
      })
      const data = await response.json() as { error?: string; paid?: boolean; providerStatus?: string; message?: string; transactionId?: string }
      if (!response.ok) throw new Error(data.error || 'Payment status could not be checked.')
      if (data.paid) {
        const order = await markDigitalPaymentConfirmed(current.orderId, { providerReference: current.reference, providerTransactionId: data.transactionId, provider: 'paystack' })
        await pullCloud().catch(() => undefined)
        await refreshLocalState()
        const synced = await db.orders.get(order.id)
        setReceiptOrder(synced ?? order)
        setReceiptRefund(null)
        setPendingPayment(null)
        setModal('receipt')
        showToast('Provider confirmed payment. Sale finalized.', 'success')
      } else {
        const providerStatus = (data.providerStatus ?? '').toLowerCase()
        const failed = ['failed', 'abandoned'].includes(providerStatus)
        if (failed) {
          await db.payments.update(current.paymentId, { status: 'failed' })
          await db.orders.update(current.orderId, { paymentStatus: 'failed', updatedAt: new Date().toISOString() })
          await pullCloud().catch(() => undefined)
          await refreshLocalState()
          const message = `Provider reports ${providerStatus}. No payment is confirmed. After checking the provider status, you can request a fresh authorization for this same sale.`
          setPendingPayment((value) => value ? { ...value, retryable: true, message } : value)
          if (showStatus) showToast(message, 'plain')
        } else {
          const statusText = data.providerStatus ? `Provider status: ${data.providerStatus}. ` : ''
          setPendingPayment((value) => value ? { ...value, retryable: false, message: `${statusText}${data.message || 'Still awaiting verified provider confirmation.'}` } : value)
          if (showStatus) showToast(data.message || 'Still awaiting provider confirmation; sale remains pending.', 'plain')
        }
      }
    } catch (error) {
      if (showStatus) showToast(error instanceof Error ? error.message : 'Payment check timed out. Sale remains pending.', 'error')
      setPendingPayment((value) => value ? { ...value, message: 'Could not verify yet. Keep the order pending and retry; never rely on a browser redirect or customer screenshot.' } : value)
    } finally {
      setPaymentChecking(false)
    }
  }, [cloudSignedIn, online, paymentChecking, refreshLocalState, showToast])

  const retryPendingPayment = async (current: PendingPayment) => {
    if (APP_DEMO_MODE || !online || !cloudSignedIn) return
    if (!customerEmail.trim() || (current.method === 'momo' && !customerPhone.trim())) {
      showToast('Enter the customer email and, for mobile money, phone number before requesting payment.', 'error')
      return
    }
    setPaymentChecking(true)
    try {
      await syncData(true)
      const outboxEvent = await db.syncOutbox.where('entityId').equals(current.orderId).first()
      if (outboxEvent && outboxEvent.status !== 'synced') throw new Error('The pending sale has not synced to cloud; no provider request was sent.')
      const token = await getAccessToken()
      if (!token) throw new Error('Sign in again before requesting a digital payment.')
      const response = await fetch('/api/payments/paystack/initialize', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ orderId: current.orderId, paymentId: current.paymentId, email: customerEmail.trim(), phone: customerPhone.trim(), network: momoNetwork }),
      })
      const data = await response.json() as { error?: string; reference?: string; authorizationUrl?: string; displayText?: string; message?: string; providerStatus?: string }
      if (data.reference) {
        const status = response.ok && data.providerStatus !== 'initiated' ? 'pending' : 'initiated'
        await db.payments.update(current.paymentId, { provider: 'paystack', providerNetwork: current.method === 'momo' ? momoNetwork : 'card', providerReference: data.reference, status })
        await db.orders.update(current.orderId, { providerReference: data.reference, paymentStatus: status, updatedAt: new Date().toISOString() })
      }
      if (!response.ok) {
        setPendingPayment({ ...current, reference: data.reference ?? current.reference, retryable: !data.reference, message: `${data.error || 'Payment request was not completed.'} Check any saved reference before retrying.` })
        showToast(data.error || 'Payment request needs review.', 'error')
        return
      }
      const next = { ...current, reference: data.reference, retryable: !data.reference, message: data.displayText || data.message || 'Payment request sent. Wait for provider confirmation; no payment is assumed from this response.' }
      setPendingPayment(next)
      if (current.method === 'card' && data.authorizationUrl) window.location.assign(data.authorizationUrl)
      else showToast('Payment request sent. The sale remains pending until verified.', 'plain')
    } catch (error) {
      setPendingPayment({ ...current, retryable: !current.reference, message: `${error instanceof Error ? error.message : 'Payment request could not be sent.'} No success was assumed.` })
      showToast(error instanceof Error ? error.message : 'Payment retry failed.', 'error')
    } finally {
      setPaymentChecking(false)
    }
  }

  const inspectPendingOrderPayment = async (order: Order) => {
    const payment = await db.payments.where('orderId').equals(order.id).first()
    if (!payment || payment.method === 'cash') { showToast('No digital payment record was found for this order.', 'error'); return }
    const reference = payment.providerReference ?? order.providerReference
    const failed = payment.status === 'failed'
    const pending: PendingPayment = {
      orderId: order.id, paymentId: payment.id, method: payment.method,
      reference, network: payment.providerNetwork, retryable: failed || !reference,
      message: failed ? 'Provider previously reported a failed/abandoned attempt. Verify the status, then request a fresh authorization.' : reference ? 'Checking provider status. A redirect or timeout is not proof of payment.' : 'No provider request was sent or saved yet. Sync this pending sale before requesting payment.',
    }
    if (payment.providerNetwork && payment.method === 'momo') setMomoNetwork(payment.providerNetwork)
    setPendingPayment(pending)
    setModal('payment')
    if (reference && !failed) void verifyPendingPayment(pending, true)
  }

  useEffect(() => {
    if (!pendingPayment?.reference || APP_DEMO_MODE || !online || !cloudSignedIn || modal !== 'payment') return
    const timer = setInterval(() => { void verifyPendingPayment(pendingPayment, false) }, 12_000)
    return () => clearInterval(timer)
  }, [pendingPayment, online, cloudSignedIn, modal, verifyPendingPayment])

  useEffect(() => {
    if (!employee || APP_DEMO_MODE || callbackHandled.current || typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('payment') !== 'return') return
    const orderId = params.get('order')
    const reference = params.get('reference')
    if (!orderId || !reference) return
    callbackHandled.current = true
    window.history.replaceState({}, '', window.location.pathname)
    void (async () => {
      const payment = await db.payments.where('orderId').equals(orderId).first()
      if (!payment) { showToast('Payment callback arrived but the local order is missing. Check transaction history after sync.', 'error'); return }
      const pending = { orderId, paymentId: payment.id, method: payment.method as Exclude<PaymentMethod, 'cash'>, reference, message: 'Checking Paystack directly. The redirect itself is not payment proof.' }
      setPendingPayment(pending)
      setModal('payment')
      await verifyPendingPayment(pending, true)
    })()
  }, [employee, verifyPendingPayment, showToast])

  const addProductToCart = (product: Product) => {
    if (product.active === false) return
    setCart((current) => ({ ...current, [product.id]: (current[product.id] ?? 0) + 1 }))
    const stock = inventory.find((item) => item.productId === product.id)?.quantityOnHand ?? 0
    if (stock <= 0) showToast(`${product.name} is at zero on this device. Check stock before confirming a sale.`, 'plain')
  }
  const setQuantity = (productId: string, quantity: number) => setCart((current) => {
    const next = { ...current }
    if (quantity <= 0) delete next[productId]
    else next[productId] = Math.round(quantity * 1000) / 1000
    return next
  })

  const openReceipt = (order: Order, refund?: Refund) => {
    setReceiptOrder(order)
    setReceiptRefund(refund ?? null)
    setReceiptEmail(order.receiptEmail ?? '')
    setModal('receipt')
  }

  const beginRefund = async (order: Order) => {
    if (!isManager) { showToast('A manager or owner must approve refunds in this MVP.', 'error'); return }
    if (order.status === 'pending_payment' || !order.paymentMethod) { showToast('This sale has no confirmed original tender to refund.', 'error'); return }
    if (!['confirmed', 'demo_simulated', 'refund_pending', 'partially_refunded'].includes(order.paymentStatus ?? '')) { showToast('Only a confirmed original payment can be refunded.', 'error'); return }
    const prior = await db.refunds.where('orderId').equals(order.id).toArray()
    const returned = new Map<string, number>()
    for (const refund of prior) {
      if (refund.status === 'failed') continue
      for (const line of refund.lines) returned.set(line.productId, (returned.get(line.productId) ?? 0) + line.quantity)
    }
    const available: Record<string, number> = {}
    const defaults: Record<string, boolean> = {}
    order.items.forEach((line) => {
      available[line.productId] = Math.max(0, line.quantity - (returned.get(line.productId) ?? 0))
      defaults[line.productId] = true
    })
    setSelectedOrder(order)
    setRefundAvailable(available)
    setRefundQty(Object.fromEntries(order.items.map((line) => [line.productId, 0])))
    setRefundRestock(defaults)
    setRefundReason('Customer return')
    setModal('refund')
  }

  const refundEstimate = useMemo(() => {
    if (!selectedOrder) return { amount: 0, tax: 0 }
    return selectedOrder.items.reduce((result, line) => {
      const qty = Math.min(refundQty[line.productId] ?? 0, refundAvailable[line.productId] ?? 0)
      const fraction = line.quantity ? qty / line.quantity : 0
      return { amount: result.amount + Math.round(line.grossMinor * fraction), tax: result.tax + Math.round(line.taxMinor * fraction) }
    }, { amount: 0, tax: 0 })
  }, [selectedOrder, refundQty, refundAvailable])

  const submitRefund = async () => {
    if (!selectedOrder || !employee) return
    try {
      const returnLines = selectedOrder.items.map((line) => ({
        productId: line.productId, quantity: refundQty[line.productId] ?? 0,
        restock: refundRestock[line.productId] ?? false,
      })).filter((line) => line.quantity > 0)
      const result = await createRefund({ order: selectedOrder, employee, lines: returnLines, reason: refundReason, demoMode: APP_DEMO_MODE })
      setModal(null)
      await refreshLocalState()
      if (result.refund.method !== 'cash') {
        if (APP_DEMO_MODE) {
          showToast('Demo refund is pending. No mobile-money/card reversal was sent.', 'plain')
        } else if (online && cloudSignedIn) {
          await syncData(true)
          const cloudEvent = await db.syncOutbox.where('entityId').equals(result.refund.id).first()
          if (cloudEvent?.status === 'synced') {
            const token = await getAccessToken()
            const response = await fetch('/api/refunds/paystack', {
              method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
              body: JSON.stringify({ refundId: result.refund.id }), cache: 'no-store',
            })
            const data = await response.json() as { error?: string; status?: string; providerRefundId?: string; message?: string }
            if (response.ok) {
              await db.refunds.update(result.refund.id, { status: data.status === 'processed' ? 'processed' : data.status === 'failed' ? 'failed' : 'processing', providerRefundId: data.providerRefundId })
              showToast(data.message || 'Original-tender reversal request sent; awaiting provider status.', 'plain')
            } else {
              await pullCloud().catch(() => undefined)
              await refreshLocalState()
              showToast(`${data.error || 'Refund request needs review.'} Check the refund status before another attempt.`, 'error')
            }
          } else showToast('Refund is recorded and restocked locally, but cloud sync is pending; no provider reversal was requested yet.', 'error')
        } else showToast('Refund is pending until online and provider-confirmed. Restocked items are tracked locally.', 'plain')
      } else if (!APP_DEMO_MODE && online) {
        void syncData(true)
        showToast('Cash refund recorded and accepted items restocked.', 'success')
      } else showToast('Cash refund recorded offline; accepted items were restocked.', 'success')
      setReceiptOrder(result.order)
      setReceiptRefund((await db.refunds.get(result.refund.id)) ?? result.refund)
      setModal('receipt')
      await refreshLocalState()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Refund could not be recorded.', 'error')
    }
  }

  const checkRefundProvider = async (refund: Refund) => {
    if (APP_DEMO_MODE || !online || !cloudSignedIn) { showToast('Provider status check requires an online signed-in cloud session.', 'plain'); return }
    try {
      const token = await getAccessToken()
      const response = await fetch('/api/refunds/paystack/status', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ refundId: refund.id }), cache: 'no-store',
      })
      const data = await response.json() as { error?: string; status?: string; providerRefundId?: string; message?: string }
      if (!response.ok) throw new Error(data.error || 'Refund status could not be checked.')
      await db.refunds.update(refund.id, { status: data.status === 'processed' ? 'processed' : data.status === 'failed' ? 'failed' : 'processing', providerRefundId: data.providerRefundId })
      await pullCloud().catch(() => undefined)
      await refreshLocalState()
      showToast(data.message || 'Provider status refreshed.', data.status === 'processed' ? 'success' : 'plain')
    } catch (error) { showToast(error instanceof Error ? error.message : 'Refund status could not be checked.', 'error') }
  }

  const openProductEditor = (product?: Product) => {
    if (!isManager) return showToast('Product changes require a manager or owner.', 'error')
    setProductForm(product ? {
      id: product.id, name: product.name, sku: product.sku, categoryName: product.categoryName,
      taxCategoryId: product.taxCategoryId, price: inputFromMinor(product.priceMinor), priceMode: product.priceMode,
      stock: String(inventory.find((item) => item.productId === product.id)?.quantityOnHand ?? 0), active: product.active,
    } : {
      name: '', sku: '', categoryName: categories[1] && categories[1] !== 'All items' ? categories[1] : 'Groceries',
      taxCategoryId: taxCategories[0]?.id ?? '', price: '', priceMode: 'inclusive', stock: '0', active: true,
    })
    setModal('product')
  }

  const saveProductForm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!employee || !productForm) return
    const tax = taxCategories.find((item) => item.id === productForm.taxCategoryId)
    if (!tax) { showToast('Select a tax category before saving.', 'error'); return }
    const priceMinor = parseMoneyInput(productForm.price)
    const openingStock = Math.max(0, Number(productForm.stock) || 0)
    try {
      if (productForm.id) {
        const previous = products.find((product) => product.id === productForm.id)
        if (!previous) throw new Error('Product is no longer available on this device.')
        const updated: Product = {
          ...previous, name: productForm.name.trim(), sku: productForm.sku.trim(), categoryName: productForm.categoryName.trim(),
          taxCategoryId: tax.id, priceMinor, priceMode: productForm.priceMode, active: productForm.active,
        }
        await saveProduct(updated, employee, previous)
        const oldStock = inventory.find((item) => item.productId === previous.id)?.quantityOnHand ?? 0
        if (oldStock !== openingStock) await adjustInventory({ product: updated, employee, newQuantity: openingStock, reason: 'Product editor count adjustment' })
      } else {
        await addNewProduct({ name: productForm.name, sku: productForm.sku, categoryName: productForm.categoryName, taxCategory: tax, priceMinor, priceMode: productForm.priceMode, stock: openingStock, employee })
      }
      setModal(null)
      setProductForm(null)
      await refreshLocalState()
      showToast('Product saved on this device.', 'success')
      if (!APP_DEMO_MODE && online) void syncData(true)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Product could not be saved.', 'error')
    }
  }

  const openTaxEditor = (category?: TaxCategory) => {
    if (!isManager) return showToast('Tax changes require a manager or owner.', 'error')
    setTaxForm(category ? {
      id: category.id, name: category.name, code: category.code, treatment: category.treatment,
      defaultPriceMode: category.defaultPriceMode, effectiveFrom: category.effectiveFrom,
      components: category.components.map((component) => ({ ...component })),
    } : {
      name: '', code: '', treatment: 'standard_rated', defaultPriceMode: 'inclusive',
      effectiveFrom: new Date().toISOString().slice(0, 10), components: [{ id: newId(), code: 'VAT', name: 'VAT', ratePercent: 0, method: 'same_base', order: 1 }],
    })
    setModal('tax')
  }

  const saveTaxForm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!employee || !taxForm) return
    const category: TaxCategory = {
      id: taxForm.id ?? newId(), storeId: employee.storeId, code: taxForm.code.trim().toUpperCase(),
      name: taxForm.name.trim(), treatment: taxForm.treatment, defaultPriceMode: taxForm.defaultPriceMode,
      components: taxForm.treatment === 'standard_rated' ? taxForm.components.map((component, index) => ({ ...component, order: index + 1 })) : [],
      effectiveFrom: taxForm.effectiveFrom, active: true,
    }
    try {
      await saveTaxCategory(category, employee)
      setModal(null)
      setTaxForm(null)
      await refreshLocalState()
      showToast('Tax profile saved locally. Confirm legal rates before production.', 'success')
      if (!APP_DEMO_MODE && online) void syncData(true)
    } catch (error) { showToast(error instanceof Error ? error.message : 'Tax profile could not be saved.', 'error') }
  }

  const openStockEditor = (product: Product) => {
    if (!isManager) return showToast('Physical counts require a manager or owner.', 'error')
    setStockProduct(product)
    setStockCount(String(inventory.find((item) => item.productId === product.id)?.quantityOnHand ?? 0))
    setStockReason('Physical count')
    setModal('stock')
  }

  const saveStockCount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!employee || !stockProduct) return
    try {
      const newQuantity = Number(stockCount)
      if (!Number.isFinite(newQuantity) || newQuantity < 0) throw new Error('Enter a valid count of zero or more.')
      await adjustInventory({ product: stockProduct, employee, newQuantity, reason: stockReason, movementType: 'count_adjustment' })
      setModal(null)
      await refreshLocalState()
      showToast('Count saved as a stock movement, not a last-write-wins overwrite.', 'success')
      if (!APP_DEMO_MODE && online) void syncData(true)
    } catch (error) { showToast(error instanceof Error ? error.message : 'Stock count could not be saved.', 'error') }
  }

  const openShiftEditor = (mode: 'open' | 'close') => {
    setShiftFormMode(mode)
    if (mode === 'open') setShiftAmount('200.00')
    else setShiftAmount(inputFromMinor(activeShift?.expectedCashMinor ?? 0))
    setShiftReason('')
    setModal('shift')
  }

  const saveShift = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!employee) return
    try {
      const amount = parseMoneyInput(shiftAmount)
      if (shiftFormMode === 'open') {
        await openShift(employee, amount)
        showToast('Shift opened on this device.', 'success')
      } else {
        if (!activeShift) throw new Error('No open shift was found on this device.')
        const variance = amount - activeShift.expectedCashMinor
        if (variance !== 0 && !shiftReason.trim()) throw new Error('Add a short reason for the cash variance.')
        await closeShift(activeShift, employee, amount, shiftReason)
        showToast('Shift closed and cash variance recorded.', 'success')
      }
      setModal(null)
      await refreshLocalState()
      if (!APP_DEMO_MODE && online) void syncData(true)
    } catch (error) { showToast(error instanceof Error ? error.message : 'Shift could not be saved.', 'error') }
  }

  const openEmployeeForm = (person?: Employee) => {
    if (!isManager) return
    setEmployeeForm(person ? { id: person.id, displayName: person.displayName, role: person.role } : { displayName: '', role: 'cashier' })
    setModal('employee')
  }

  const saveEmployeeForm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!employee || !employeeForm) return
    if (employee.role === 'manager' && employeeForm.role === 'owner') { showToast('Only an owner can grant the owner role.', 'error'); return }
    if (employee.role === 'manager' && employeeForm.id && employees.find((person) => person.id === employeeForm.id)?.role === 'owner') { showToast('Managers cannot edit an owner profile.', 'error'); return }
    const saved: Employee = {
      id: employeeForm.id ?? newId(), storeId: employee.storeId, displayName: employeeForm.displayName.trim(),
      role: employeeForm.role, status: 'active', createdAt: new Date().toISOString(),
    }
    if (!saved.displayName) return showToast('Enter a staff name.', 'error')
    try {
      await saveEmployee(saved, employee)
      setModal(null)
      await refreshLocalState()
      showToast('Staff role saved locally. A Supabase Auth login must be linked separately for cloud access.', 'success')
      if (!APP_DEMO_MODE && online) void syncData(true)
    } catch (error) { showToast(error instanceof Error ? error.message : 'Staff profile could not be saved.', 'error') }
  }

  const installApp = async () => {
    if (installPrompt) {
      await installPrompt.prompt()
      const choice = await installPrompt.userChoice
      if (choice.outcome === 'accepted') setInstalled(true)
      setInstallPrompt(null)
    } else showToast('Use the browser menu: “Install app” or “Add to Home Screen”.', 'plain')
  }

  const emailReceipt = async () => {
    if (!receiptOrder || !receiptEmail.trim()) { showToast('Enter a recipient email address.', 'error'); return }
    if (APP_DEMO_MODE || !cloudSignedIn) {
      await shareReceipt(receiptOrder, receiptRefund ?? undefined)
      showToast('Opened the device share sheet or downloaded a PDF. Managed email delivery is not configured in demo mode.', 'plain')
      return
    }
    try {
      const token = await getAccessToken()
      const response = await fetch('/api/receipts/email', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ orderId: receiptOrder.id, email: receiptEmail.trim() }), cache: 'no-store',
      })
      const data = await response.json() as { error?: string }
      if (!response.ok) throw new Error(data.error || 'Email could not be sent.')
      showToast(`Receipt sent to ${receiptEmail.trim()}.`, 'success')
    } catch (error) {
      await shareReceipt(receiptOrder, receiptRefund ?? undefined).catch(() => undefined)
      showToast(`${error instanceof Error ? error.message : 'Email failed.'} Opened share/PDF fallback.`, 'error')
    }
  }

  const printThermal = async (transport: 'bluetooth' | 'usb') => {
    if (!receiptOrder) return
    try {
      const name = await printReceiptEscPos(receiptOrder, transport)
      showToast(`Sent receipt to ${name}. Check the printed paper; browser printer APIs cannot verify a complete print.`, 'success')
    } catch (error) {
      showToast(`${error instanceof Error ? error.message : 'Printer connection failed.'} Use Print or PDF fallback.`, 'error')
    }
  }

  const showMoreView = () => setView('more')
  const allowedNav = navItems.filter((item) => !item.roles || (employee && item.roles.includes(employee.role)))
  const cartItemCount = Object.values(cart).reduce((sum, quantity) => sum + quantity, 0)
  const onlineLabel = !online ? 'Offline · cash available' : APP_DEMO_MODE ? 'Online · local demo' : cloudSignedIn ? 'Online · cloud ready' : 'Online · sign in to sync'
  const dateText = now.toLocaleDateString('en-GH', { weekday: 'short', day: 'numeric', month: 'short' })
  const pageTitle: Record<View, string> = {
    checkout: 'Checkout', transactions: 'Transactions', products: 'Products', inventory: 'Inventory',
    reports: 'Sales & tax reports', shifts: 'Shifts & cash', team: 'Team', tax: 'Tax setup', settings: 'Settings', more: 'More tools',
  }

  if (!ready) return <div className="login-screen"><div className="login-card"><div className="login-brand"><span className="brand-mark">K</span><div><strong className="brand-name">Kasa POS</strong><span className="brand-caption">Preparing local workspace</span></div></div><p>Opening your offline catalogue and transaction store…</p><div className="status-pill"><Loader2 size={12} className="spin" /> Loading IndexedDB</div></div></div>

  if (!employee) {
    return (
      <main className="login-screen">
        <section className="login-card">
          <div className="login-brand"><span className="brand-mark">K</span><div><strong className="brand-name">Kasa POS</strong><span className="brand-caption">Offline-first retail checkout</span></div></div>
          <h1>{APP_DEMO_MODE ? 'Choose a demo role' : 'Sign in to your store'}</h1>
          <p>{APP_DEMO_MODE ? 'Explore checkout, stock, refunds and reports with local demo data. Demo role switching is not an authentication control.' : 'Use your store Supabase Auth account. After the first sign-in, cached catalogue and recent records can be opened offline on this device.'}</p>
          {APP_DEMO_MODE ? <>
            <div className="info-note"><strong>Demo only.</strong> Cash can be recorded locally. Card/MoMo buttons are explicitly simulated and do not contact a provider or move money.</div>
            <div className="demo-user-list">
              {employees.length ? employees.map((person) => <button className="demo-user-button" key={person.id} onClick={() => void setEmployeeSession(person)}>
                <span className="avatar small">{initials(person.displayName)}</span><span><strong>{person.displayName}</strong><span>{roleLabel(person.role)} · demo profile</span></span><span className="btn small">Continue</span>
              </button>) : <div className="empty-state"><p>No local employee profiles have been seeded.</p></div>}
            </div>
          </> : <>
            {!online && cachedOfflineEmployee ? <>
              <div className="info-note" style={{ marginTop: 14 }}><strong>Cached staff profile · {cachedOfflineEmployee.displayName}</strong><br />Unlock this device’s local workspace. Cloud sync and digital payments remain paused until you sign in online.</div>
              {offlinePinAvailable ? <form onSubmit={unlockOffline} className="form-grid" style={{ marginTop: 12 }}>
                <div className="field full"><label htmlFor="offline-pin">Device offline PIN</label><input id="offline-pin" type="password" inputMode="numeric" autoComplete="current-password" pattern="[0-9]{6,8}" maxLength={8} value={offlinePinInput} onChange={(event) => setOfflinePinInput(event.target.value.replace(/\D/g, '').slice(0, 8))} required /></div>
                {loginError && <div className="field full"><div className="attention-note"><AlertTriangle size={15} />{loginError}</div></div>}
                <div className="field full"><button className="btn primary" disabled={loginBusy || offlinePinInput.length < 6}>{loginBusy ? <Loader2 size={14} className="spin" /> : <WifiOff size={14} />}{loginBusy ? 'Unlocking…' : 'Unlock offline workspace'}</button></div>
              </form> : <div className="attention-note" style={{ marginTop: 12 }}><AlertTriangle size={15} />No offline PIN is registered for this staff profile. Reconnect and sign in to create one before using this profile offline.</div>}
              <div className="field-hint" style={{ marginTop: 8 }}>Offline PIN is a device unlock, not cloud authentication. Keep the tablet’s screen lock enabled; local POS data is stored in browser storage.</div>
            </> : <form onSubmit={signInCloud} className="form-grid" style={{ marginTop: 15 }}>
              <div className="field full"><label htmlFor="login-email">Email</label><input id="login-email" type="email" autoComplete="username" value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} required /></div>
              <div className="field full"><label htmlFor="login-password">Password</label><input id="login-password" type="password" autoComplete="current-password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} required /></div>
              {loginError && <div className="field full"><div className="attention-note"><AlertTriangle size={15} />{loginError}</div></div>}
              {!online && <div className="field full"><div className="attention-note"><WifiOff size={15} />No cached offline profile is available. Connect to the internet for first-time sign-in.</div></div>}
              <div className="field full"><button className="btn primary" disabled={loginBusy || !online}>{loginBusy ? <Loader2 size={14} className="spin" /> : <ShieldCheck size={14} />}{loginBusy ? 'Signing in…' : 'Sign in securely'}</button></div>
            </form>}
          </>}
          <div className="store-card" style={{ marginTop: 17, borderColor: 'var(--line)', background: '#f8fbf8', color: 'var(--ink-soft)' }}><div className="store-card-title">{onlineLabel}</div><div className="store-card-sub" style={{ color: 'var(--ink-soft)' }}>Your local data is stored in this browser. Do not clear site storage before syncing or backing up records.</div></div>
        </section>
      </main>
    )
  }

  const today = now.toISOString().slice(0, 10)
  const recentOrders = orders.filter((order) => order.createdAt.slice(0, 10) === today && order.status !== 'pending_payment')
  const settledOrders = orders.filter((order) => ['paid', 'partially_refunded', 'refunded'].includes(order.status) && order.paymentStatus !== 'pending')
  const grossSalesToday = recentOrders.reduce((sum, order) => sum + order.totalMinor, 0)
  const refundsToday = refunds.filter((refund) => refund.createdAt.slice(0, 10) === today && refund.status === 'processed').reduce((sum, refund) => sum + refund.amountMinor, 0)
  const netSalesToday = Math.max(0, grossSalesToday - refundsToday)
  const taxToday = recentOrders.reduce((sum, order) => sum + order.taxMinor, 0) - refunds.filter((refund) => refund.createdAt.slice(0, 10) === today && refund.status === 'processed').reduce((sum, refund) => sum + refund.taxMinor, 0)
  const todayOrders = recentOrders.length
  const categorySales = products.map((product) => ({
    product, qty: settledOrders.reduce((sum, order) => sum + order.items.filter((line) => line.productId === product.id).reduce((q, line) => q + line.quantity, 0), 0),
  })).filter((entry) => entry.qty > 0).sort((a, b) => b.qty - a.qty).slice(0, 5)
  const paymentTotals = (['cash', 'momo', 'card'] as const).map((method) => ({
    method, amount: settledOrders.filter((order) => order.paymentMethod === method).reduce((sum, order) => sum + Math.max(0, order.totalMinor - order.refundedMinor), 0),
  }))
  const weeklyBars = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now)
    date.setDate(now.getDate() - (6 - index))
    const dateKey = date.toISOString().slice(0, 10)
    const amount = orders.filter((order) => order.createdAt.slice(0, 10) === dateKey && order.status !== 'pending_payment').reduce((sum, order) => sum + order.totalMinor - order.refundedMinor, 0)
    return { label: date.toLocaleDateString('en-GH', { weekday: 'short' }), amount: Math.max(0, amount) }
  })
  const maxBar = Math.max(1, ...weeklyBars.map((bar) => bar.amount))
  const taxSummary = new Map<string, { name: string; rate: number; amount: number }>()
  for (const order of recentOrders) for (const item of order.items) for (const tax of item.taxBreakdown) {
    const existing = taxSummary.get(tax.code) ?? { name: tax.name, rate: tax.ratePercent, amount: 0 }
    existing.amount += tax.taxMinor
    taxSummary.set(tax.code, existing)
  }
  const filteredOrders = orders.filter((order) => !tableSearch.trim() || `${order.orderNumber} ${order.employeeName} ${order.paymentMethod ?? ''} ${order.status}`.toLowerCase().includes(tableSearch.toLowerCase()))
  const filteredAdminProducts = products.filter((product) => !tableSearch.trim() || `${product.name} ${product.sku} ${product.categoryName}`.toLowerCase().includes(tableSearch.toLowerCase()))
  const filteredEmployees = employees.filter((person) => !tableSearch.trim() || `${person.displayName} ${person.role}`.toLowerCase().includes(tableSearch.toLowerCase()))
  const stockRows = products.map((product) => ({ product, item: inventory.find((entry) => entry.productId === product.id) })).sort((a, b) => (a.item?.quantityOnHand ?? 0) - (b.item?.quantityOnHand ?? 0))
  const negativeStockCount = inventory.filter((item) => item.quantityOnHand < 0).length
  const reviewCount = conflictCount + negativeStockCount

  const renderCheckout = () => (
    <>
      <SectionHeading title="Checkout" subtitle="Tap a product to add it. The ready cart goes to cash recording or a provider request in at most three taps." actions={isManager ? <button className="btn" onClick={() => openProductEditor()}><Plus size={14} />New product</button> : undefined} />
      <div className="status-strip">
        <span className={`status-pill ${online ? 'good' : 'warn'}`}><span className="status-dot" />{online ? <Wifi size={12} /> : <WifiOff size={12} />}{online ? 'Online' : 'Offline'}</span>
        <span>{APP_DEMO_MODE ? 'Demo data · local only' : cloudSignedIn ? 'Cloud sync enabled' : 'Local mode · sign in to sync'}</span>
        <span className="status-separator" />
        <span className={`status-pill ${reviewCount ? 'bad' : pendingCount ? 'warn' : 'good'}`}><Cloud size={12} />{APP_DEMO_MODE ? 'Cloud not connected' : reviewCount ? `${reviewCount} stock/sync review(s)` : pendingCount ? `${pendingCount} queued` : 'Synced'}</span>
        {allPendingDigital > 0 && <span className="status-pill warn"><CreditCard size={12} />{allPendingDigital} digital pending</span>}
        {activeShift ? <span className="status-pill blue"><Clock3 size={12} />Shift open · {activeShift.employeeName}</span> : <button className="link-button" onClick={() => { setView('shifts'); openShiftEditor('open') }}>Open shift</button>}
      </div>
      {APP_DEMO_MODE && <div className="sync-callout" style={{ marginBottom: 12 }}><div><strong>Demo environment — local only</strong><p>Cash transactions are saved in Dexie on this device. Card and MoMo approvals below are clearly simulated; no money moves and no real provider webhook is claimed.</p></div><StatusBadge status="demo_simulated" label="Demo" /></div>}
      {!activeShift && <div className="attention-note" style={{ marginBottom: 12 }}><AlertTriangle size={15} />Open a shift on this device before recording a sale. Cash totals and end-of-shift reconciliation are linked to the open shift.</div>}
      <div className="checkout-layout">
        <section className="panel catalog-panel">
          <div className="catalog-toolbar">
            <div className="catalog-toolbar-top">
              <div className="search-wrap"><Search className="search-icon" size={14} /><input aria-label="Search products" placeholder="Search product or SKU…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
              <div className="catalog-tools-right"><button className="btn small" onClick={() => setView('inventory')}><Boxes size={13} /><span className="hide-small">Stock</span></button></div>
            </div>
            <div className="category-row">{categories.map((category) => <button className={`chip ${activeCategory === category ? 'selected' : ''}`} key={category} onClick={() => setActiveCategory(category)}>{category}</button>)}<span className="catalog-count">{filteredProducts.length} items</span></div>
          </div>
          {filteredProducts.length ? <div className="product-grid">{filteredProducts.map((product) => {
            const stock = inventory.find((item) => item.productId === product.id)?.quantityOnHand ?? 0
            const tax = taxCategories.find((item) => item.id === product.taxCategoryId)
            return <button className={`product-card ${stock <= 3 ? 'low-stock' : ''}`} key={product.id} onClick={() => addProductToCart(product)} aria-label={`Add ${product.name} to cart`}>
              <span className="product-glyph">{stockEmoji(product.categoryName)}</span>
              <span className="product-name">{product.name}</span><span className="product-category">{product.categoryName} · {product.sku}</span>
              <div className="product-card-bottom"><span className="product-price">{displayMoney(product.priceMinor)}</span><span className="product-stock">{stock} left</span></div>
              <span className="product-tax-note">{product.priceMode === 'inclusive' ? 'Tax included' : 'Tax added'} · {tax?.treatment ? taxLabel(tax.treatment) : 'Tax setup needed'}</span>
            </button>
          })}</div> : <div className="empty-state"><span className="empty-state-icon"><ShoppingBasket size={20} /></span><h3>{products.length ? 'No matching products' : 'No products on this device'}</h3><p>{products.length ? 'Try another search or category.' : APP_DEMO_MODE ? 'The demo catalogue could not be loaded. Reset demo data from Settings.' : 'Sync a catalogue or ask the owner to add the first products.'}</p>{isManager && <button className="btn primary" style={{ marginTop: 12 }} onClick={() => openProductEditor()}><Plus size={14} />Add product</button>}</div>}
        </section>
        <aside className="panel cart-panel">
          <div className="cart-head"><div><h2>Current sale</h2><p>{activeShift ? `Shift · ${activeShift.employeeName}` : 'No shift is open on this device'}</p></div><span className="cart-count">{cartItemCount}</span></div>
          <div className={`cart-items ${cartLines.length ? '' : 'cart-empty'}`}>
            {cartLines.length ? cartLines.map((line) => <div className="cart-row" key={line.productId}>
              <div><div className="cart-item-title">{line.name}</div><div className="cart-item-sub">{money(line.unitPriceMinor)} / unit · {line.priceMode === 'inclusive' ? 'tax inclusive' : 'tax exclusive'}</div>
                <div className="cart-row-actions"><div className="qty-stepper"><button onClick={() => setQuantity(line.productId, line.quantity - 1)} aria-label={`Remove one ${line.name}`}>−</button><span>{line.quantity}</span><button onClick={() => setQuantity(line.productId, line.quantity + 1)} aria-label={`Add one ${line.name}`}>+</button></div><button className="link-button danger-text" onClick={() => setQuantity(line.productId, 0)}><Trash2 size={11} /> Remove</button></div>
              </div><div className="cart-item-total">{money(line.grossMinor)}</div>
              <div className="cart-item-sub" style={{ gridColumn: '1 / -1', marginTop: -3 }}>Tax {money(line.taxMinor)} · {line.taxRatePercent.toFixed(2)}% · {line.taxBreakdown.map((tax) => `${tax.code} ${tax.ratePercent}%`).join(' + ') || '0%'}{line.priceMode === 'exclusive' ? ' · added to price' : ' · included in price'}</div>
            </div>) : <div className="empty-state"><span className="empty-state-icon"><ShoppingCart size={20} /></span><h3>Cart is ready</h3><p>Choose items from the catalogue to build the sale. Per-item tax and totals update automatically.</p></div>}
          </div>
          <div className="cart-bottom">
            <div className="cart-totals"><div className="total-row"><span>Net subtotal</span><strong>{displayMoney(cartTotals.subtotalMinor)}</strong></div><div className="total-row tax"><span>Tax on items</span><strong>{displayMoney(cartTotals.taxMinor)}</strong></div><div className="total-row"><span>Items</span><strong>{cartItemCount}</strong></div><div className="total-grand"><span>Total due</span><strong>{displayMoney(cartTotals.totalMinor)}</strong></div></div>
            <button className="checkout-button" disabled={!cartLines.length || !activeShift} onClick={openPayment}>Checkout <span style={{ float: 'right' }}>{cartLines.length ? `· ${money(cartTotals.totalMinor)}` : ''}</span></button>
            <div className="cart-footnote">{APP_DEMO_MODE ? 'Demo · local only · no card/MoMo charges' : 'Cash finalizes offline · digital tenders require provider confirmation'}</div>
          </div>
        </aside>
      </div>
    </>
  )

  const renderTransactions = () => (
    <>
      <SectionHeading title="Transactions" subtitle="Find a sale, open a tax receipt, check payment state or start a full/partial return." actions={employee.role !== 'cashier' ? <button className="btn" onClick={() => setView('reports')}><BarChart3 size={14} />Sales report</button> : undefined} />
      <div className="card">
        <div className="table-toolbar"><div><strong>{orders.length} transactions</strong><div className="subtle" style={{ marginTop: 3, fontSize: 10 }}>Digital payments stay pending until the provider confirms them.</div></div><div className="table-search"><input placeholder="Search receipt, cashier or tender…" value={tableSearch} onChange={(event) => setTableSearch(event.target.value)} /></div></div>
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Receipt</th><th>Date</th><th>Cashier</th><th>Tender</th><th>Payment status</th><th>Tax</th><th>Total</th><th /></tr></thead><tbody>
          {filteredOrders.map((order) => <tr key={order.id}><td><strong>{order.orderNumber}</strong><div className="subtle" style={{ marginTop: 3 }}>{order.items.length} line(s)</div></td><td>{stamp(order.createdAt)}</td><td>{order.employeeName}</td><td>{order.paymentMethod ? titleCase(order.paymentMethod) : '—'}{order.paymentMethod === 'momo' && order.providerReference && <div className="subtle" style={{ marginTop: 3 }}>{order.providerReference}</div>}</td><td><StatusBadge status={order.paymentStatus ?? order.status} label={order.paymentStatus === 'demo_simulated' ? 'Simulated · demo' : titleCase(order.paymentStatus ?? order.status)} /></td><td>{money(order.taxMinor)}</td><td><strong>{money(order.totalMinor - order.refundedMinor)}</strong></td><td><div className="table-row-actions"><button className="btn small" onClick={() => openReceipt(order)}><ReceiptText size={12} />View</button>{!APP_DEMO_MODE && order.status === 'pending_payment' && order.paymentMethod && order.paymentMethod !== 'cash' && <button className="btn small soft" onClick={() => void inspectPendingOrderPayment(order)}><RefreshCw size={12} />{order.providerReference ? 'Check payment' : 'Continue'}</button>}{isManager && order.status !== 'refunded' && order.status !== 'pending_payment' && <button className="btn small soft" onClick={() => void beginRefund(order)}><RotateCcw size={12} />Refund</button>}</div></td></tr>)}
          {!filteredOrders.length && <tr><td colSpan={8}><div className="empty-state"><span className="empty-state-icon"><History size={20} /></span><h3>No matching transactions</h3><p>Completed cash sales and provider-confirmed digital sales will appear here.</p></div></td></tr>}
        </tbody></table></div>
        {APP_DEMO_MODE && <div className="info-note" style={{ marginTop: 12 }}>Demo sample transactions are illustrative. They are not provider-verified payments or certified tax receipts.</div>}
      </div>
      {refunds.length > 0 && <div className="card" style={{ marginTop: 13 }}><div className="card-head"><div><h3>Refund activity</h3><p>Cash refunds are locally recorded; digital reversals wait for provider status.</p></div><span className="status-pill warn">{refunds.length} records</span></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Return</th><th>Receipt</th><th>Tender</th><th>Status</th><th>Amount</th><th /></tr></thead><tbody>{refunds.slice(0, 8).map((refund) => { const order = orders.find((item) => item.id === refund.orderId); return <tr key={refund.id}><td><strong>{refund.id.slice(0, 8).toUpperCase()}</strong><div className="subtle" style={{ marginTop: 3 }}>{stamp(refund.createdAt)}</div></td><td>{refund.orderNumber}</td><td>{titleCase(refund.method)}</td><td><StatusBadge status={refund.status} label={refund.status === 'pending' && refund.method !== 'cash' ? 'Awaiting provider' : titleCase(refund.status)} /></td><td>{money(refund.amountMinor)}</td><td><div className="table-row-actions">{order && <button className="btn small" onClick={() => openReceipt(order, refund)}><FileText size={12} />Receipt</button>}{refund.providerRefundId && ['pending', 'processing', 'needs_attention'].includes(refund.status) && <button className="btn small" onClick={() => void checkRefundProvider(refund)}>Check provider</button>}</div></td></tr>})}</tbody></table></div></div>}
    </>
  )

  const renderProducts = () => (
    <>
      <SectionHeading title="Products" subtitle="Manage products, prices, categories and tax treatment. Barcode scanning remains a V2 item." actions={<button className="btn primary" onClick={() => openProductEditor()}><Plus size={14} />Add product</button>} />
      <div className="card"><div className="table-toolbar"><div><strong>{products.length} active products</strong><div className="subtle" style={{ marginTop: 3, fontSize: 10 }}>Price mode and tax category are snapshotted at the time of sale.</div></div><div className="table-search"><input placeholder="Search product or SKU…" value={tableSearch} onChange={(event) => setTableSearch(event.target.value)} /></div></div>
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Product</th><th>Category</th><th>SKU</th><th>Price</th><th>Tax profile</th><th>Price mode</th><th>Stock</th><th /></tr></thead><tbody>
          {filteredAdminProducts.map((product) => { const tax = taxCategories.find((item) => item.id === product.taxCategoryId); const stock = inventory.find((item) => item.productId === product.id)?.quantityOnHand ?? 0; return <tr key={product.id}><td><strong>{product.name}</strong><div className="subtle" style={{ marginTop: 3 }}>{product.unitName}</div></td><td>{product.categoryName}</td><td>{product.sku}</td><td><strong>{displayMoney(product.priceMinor)}</strong></td><td>{tax?.name ?? 'Missing tax category'}</td><td><StatusBadge status={product.priceMode} label={product.priceMode === 'inclusive' ? 'Tax inclusive' : 'Tax exclusive'} /></td><td><StatusBadge status={stock < 0 ? 'conflict' : stock <= 3 ? 'pending' : 'synced'} label={stock < 0 ? `${stock} · review` : `${stock} on hand`} /></td><td><div className="table-row-actions"><button className="btn small" onClick={() => openProductEditor(product)}>Edit</button></div></td></tr>})}
          {!filteredAdminProducts.length && <tr><td colSpan={8}><div className="empty-state"><Package size={22} /><h3>No products found</h3><p>Create the first product or adjust your search.</p></div></td></tr>}
        </tbody></table></div>
      </div>
    </>
  )

  const renderInventory = () => (
    <>
      <SectionHeading title="Inventory" subtitle="Stock quantities are projections from signed sale, return, receiving and count movements." actions={<button className="btn" onClick={() => setView('products')}><Package size={14} />Products</button>} />
      <div className="metric-grid"><MetricCard label="Tracked products" value={String(products.length)} icon={Boxes} note="Active catalogue" /><MetricCard label="Low stock" value={String(stockRows.filter((entry) => (entry.item?.quantityOnHand ?? 0) <= 5).length)} icon={AlertTriangle} note="5 units or fewer" tone="amber" /><MetricCard label="Pending stock changes" value={String(pendingCount)} icon={Cloud} note={APP_DEMO_MODE ? 'Demo · local only' : 'Waiting for sync'} tone="blue" /><MetricCard label="Conflicts to review" value={String(reviewCount)} icon={Activity} note={`${conflictCount} sync conflict(s) · ${negativeStockCount} negative stock balance(s)`} tone={reviewCount ? 'amber' : 'green'} /></div>
      <div className="card"><div className="table-toolbar"><div><strong>Stock on hand</strong><div className="subtle" style={{ marginTop: 3, fontSize: 10 }}>Count adjustments send deltas with a base row version; stale counts require review.</div></div><div className="table-search"><input placeholder="Search stock…" value={tableSearch} onChange={(event) => setTableSearch(event.target.value)} /></div></div>
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Product</th><th>SKU</th><th>Category</th><th>Available</th><th>Stock state</th><th>Last movement</th><th /></tr></thead><tbody>
          {stockRows.filter(({ product }) => !tableSearch.trim() || `${product.name} ${product.sku} ${product.categoryName}`.toLowerCase().includes(tableSearch.toLowerCase())).map(({ product, item }) => { const qty = item?.quantityOnHand ?? 0; return <tr key={product.id}><td><strong>{product.name}</strong></td><td>{product.sku}</td><td>{product.categoryName}</td><td><strong>{qty}</strong> {product.unitName}</td><td><StatusBadge status={qty < 0 ? 'conflict' : qty <= 3 ? 'pending' : 'synced'} label={qty < 0 ? 'Negative · review' : qty <= 3 ? 'Reorder soon' : 'In stock'} /></td><td>{item ? stamp(item.updatedAt) : '—'}</td><td><button className="btn small" disabled={!isManager} onClick={() => openStockEditor(product)}>Count stock</button></td></tr>})}
        </tbody></table></div>
      </div>
      {!isManager && <div className="info-note" style={{ marginTop: 12 }}>Cashier access is read-only for manual stock counts. Ask a manager to receive stock or approve a physical count.</div>}
    </>
  )

  const renderReports = () => (
    <>
      <SectionHeading title="Sales & tax reports" subtitle="Local dashboard totals from completed sales and refunds. This is not an E-VAT/CIS filing or certification report." actions={<button className="btn" onClick={() => void syncData()}><RefreshCw size={14} />Refresh data</button>} />
      <div className="status-strip"><span className="status-pill blue"><BarChart3 size={12} />Today · {dateText}</span><span>Currency: GHS (base)</span><span className="status-separator" /><span>Display: {displayCurrency}{displayCurrency !== 'GHS' ? ' reference only' : ''}</span></div>
      <div className="metric-grid"><MetricCard label="Gross sales today" value={displayMoney(grossSalesToday)} icon={CircleDollarSign} note={`${todayOrders} transactions · GHS base`} /><MetricCard label="Refunds today" value={displayMoney(refundsToday)} icon={RotateCcw} note="Processed cash & provider-confirmed refunds" tone="amber" /><MetricCard label="Net sales today" value={displayMoney(netSalesToday)} icon={TrendingUp} note="Gross less recorded refunds" /><MetricCard label="Tax collected (snapshot)" value={displayMoney(Math.max(0, taxToday))} icon={ShieldCheck} note="Verify rates and filing eligibility" tone="blue" /></div>
      <div className="content-grid">
        <div className="card span-7"><div className="card-head"><div><h2>Last 7 days</h2><p>Sales net of recorded refunds · GHS</p></div><span className="status-pill">Local records</span></div>
          <svg viewBox="0 0 700 210" role="img" aria-label="Sales over the last seven days" style={{ width: '100%', height: 210, display: 'block' }}>
            <line x1="36" y1="20" x2="36" y2="174" stroke="#e5ebe4" /><line x1="36" y1="174" x2="680" y2="174" stroke="#e5ebe4" />
            {[0,1,2,3].map((step) => <g key={step}><line x1="36" y1={174 - step * 48} x2="680" y2={174 - step * 48} stroke="#edf1ec" strokeDasharray="4 5" /><text x="3" y={178 - step * 48} fill="#9ba59e" fontSize="9">{Math.round(maxBar * step / 3 / 100).toLocaleString('en-GH')}</text></g>)}
            {weeklyBars.map((bar, index) => { const x = 65 + index * 86; const h = Math.max(4, 142 * bar.amount / maxBar); return <g key={`${bar.label}-${index}`}><rect x={x} y={170 - h} width="38" height={h} rx="8" fill={index === 6 ? '#176546' : '#9dc9a7'} /><text x={x + 19} y="194" textAnchor="middle" fill="#718077" fontSize="10">{bar.label}</text></g> })}
          </svg>
        </div>
        <div className="card span-5"><div className="card-head"><div><h2>Tender mix</h2><p>Net sales by original payment method</p></div><CreditCard size={17} color="#6c8c76" /></div><div className="report-bar-list">{paymentTotals.map((entry) => { const max = Math.max(1, ...paymentTotals.map((item) => item.amount)); const Icon = entry.method === 'cash' ? Banknote : entry.method === 'momo' ? Smartphone : CreditCard; return <div className="report-bar-row" key={entry.method}><span className="report-bar-label"><Icon size={12} style={{ marginRight: 5, verticalAlign: 'middle' }} />{titleCase(entry.method)}</span><span className="report-bar-track"><span className="report-bar-fill" style={{ width: `${Math.round(entry.amount / max * 100)}%` }} /></span><span className="report-bar-value">{money(entry.amount)}</span></div>})}</div><div className="info-note" style={{ marginTop: 17 }}>Demo-simulated card/MoMo records are labelled as demo. They do not represent PSP settlement.</div></div>
        <div className="card span-6"><div className="card-head"><div><h2>Tax component summary</h2><p>Breakdown from transaction-time tax snapshots</p></div><ShieldCheck size={17} color="#6c8c76" /></div>{taxSummary.size ? <div className="report-bar-list">{Array.from(taxSummary.entries()).map(([code, entry]) => { const max = Math.max(1, ...Array.from(taxSummary.values()).map((item) => item.amount)); return <div className="report-bar-row" key={code}><span className="report-bar-label">{entry.name} · {entry.rate}%</span><span className="report-bar-track"><span className="report-bar-fill" style={{ width: `${Math.round(entry.amount / max * 100)}%` }} /></span><span className="report-bar-value">{money(entry.amount)}</span></div>})}</div> : <div className="empty-state"><p>No tax-bearing sales recorded today.</p></div>}<div className="info-note" style={{ marginTop: 15 }}>Inclusive/exclusive calculations are local application logic. Confirm applicable GRA rules and E-VAT/CIS certification before live use.</div></div>
        <div className="card span-6"><div className="card-head"><div><h2>Top items</h2><p>Across locally available completed transactions</p></div><ShoppingBasket size={17} color="#6c8c76" /></div>{categorySales.length ? <div className="report-bar-list">{categorySales.map(({ product, qty }) => { const max = Math.max(1, ...categorySales.map((entry) => entry.qty)); return <div className="report-bar-row" key={product.id}><span className="report-bar-label">{product.name}</span><span className="report-bar-track"><span className="report-bar-fill" style={{ width: `${Math.round(qty / max * 100)}%` }} /></span><span className="report-bar-value">{qty} sold</span></div>})}</div> : <div className="empty-state"><p>Complete a sale to see top items.</p></div>}</div>
      </div>
    </>
  )

  const renderShifts = () => (
    <>
      <SectionHeading title="Shifts & cash" subtitle="Clock in/out and reconcile the cash drawer against recorded cash tenders." actions={activeShift ? <button className="btn danger" onClick={() => openShiftEditor('close')}><LogOut size={14} />Close shift</button> : <button className="btn primary" onClick={() => openShiftEditor('open')}><Clock3 size={14} />Open shift</button>} />
      {activeShift ? <div className="shift-banner" style={{ marginBottom: 14 }}><div><strong>Shift open · {activeShift.employeeName}</strong><span>Started {stamp(activeShift.openedAt)} · Device {activeShift.deviceId.slice(0, 8)}</span></div><div style={{ textAlign: 'right' }}><strong>{displayMoney(activeShift.expectedCashMinor)}</strong><span>Expected drawer cash · includes opening float</span></div></div> : <div className="sync-callout" style={{ marginBottom: 14 }}><div><strong>No open shift on this device</strong><p>Open a shift and enter the starting float before the next sale.</p></div><button className="btn primary" onClick={() => openShiftEditor('open')}><Clock3 size={13} />Open shift</button></div>}
      <div className="content-grid"><div className="card span-7"><div className="card-head"><div><h2>Current drawer reconciliation</h2><p>Expected cash is opening float + recorded cash sales − cash refunds.</p></div><Banknote size={17} color="#6c8c76" /></div>{activeShift ? <><div className="metric-grid" style={{ gridTemplateColumns: 'repeat(2,minmax(0,1fr))' }}><MetricCard label="Opening float" value={displayMoney(activeShift.openingFloatMinor)} icon={CircleDollarSign} note="Entered at clock-in" /><MetricCard label="Expected cash" value={displayMoney(activeShift.expectedCashMinor)} icon={Banknote} note="Cash tender only" /></div><button className="btn primary" onClick={() => openShiftEditor('close')}><ArrowLeftRight size={14} />Count & close</button></> : <div className="empty-state"><Clock3 size={22} /><h3>Clock in to begin</h3><p>Sales can be reconciled only after a shift is open.</p></div>}</div>
        <div className="card span-5"><div className="card-head"><div><h2>Recent shifts</h2><p>Local device records</p></div><History size={17} color="#6c8c76" /></div><div className="report-bar-list">{shifts.slice(0, 6).map((shift) => <div key={shift.id} className="report-bar-row" style={{ gridTemplateColumns: 'minmax(70px,1fr) auto' }}><span className="report-bar-label">{shift.employeeName}<small style={{ display: 'block', marginTop: 3 }}>{new Date(shift.openedAt).toLocaleDateString('en-GH')}</small></span><span className="report-bar-value"><StatusBadge status={shift.status} label={titleCase(shift.status)} />{shift.status === 'closed' && shift.varianceMinor !== undefined && <small style={{ display: 'block', marginTop: 4, color: shift.varianceMinor ? '#a26210' : '#728178' }}>Variance {money(shift.varianceMinor)}</small>}</span></div>)}</div></div>
      </div>
    </>
  )

  const renderTeam = () => (
    <>
      <SectionHeading title="Team" subtitle="Define owner, manager and cashier profiles. Production staff need a linked Supabase Auth account to sign in." actions={<button className="btn primary" onClick={() => openEmployeeForm()}><UserPlus size={14} />Add employee</button>} />
      <div className="card"><div className="table-toolbar"><div><strong>{employees.length} active profiles</strong><div className="subtle" style={{ marginTop: 3, fontSize: 10 }}>Roles: owner (all), manager (operations/refunds), cashier (checkout and own shift).</div></div><div className="table-search"><input placeholder="Search team…" value={tableSearch} onChange={(event) => setTableSearch(event.target.value)} /></div></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Employee</th><th>Role</th><th>Login / profile</th><th>Active shift</th><th /></tr></thead><tbody>{filteredEmployees.map((person) => <tr key={person.id}><td><strong>{person.displayName}</strong></td><td><StatusBadge status={person.role} label={roleLabel(person.role)} /></td><td>{APP_DEMO_MODE ? <span className="subtle">Demo profile · local only</span> : person.authUserId ? <span className="badge green">Supabase linked</span> : <span className="badge amber">Auth invite needed</span>}</td><td>{shifts.some((shift) => shift.status === 'open' && shift.employeeId === person.id) ? <span className="badge green">Open</span> : <span className="subtle">—</span>}</td><td><div className="table-row-actions"><button className="btn small" onClick={() => openEmployeeForm(person)}>Edit role</button>{APP_DEMO_MODE && <button className="btn small soft" onClick={() => void setEmployeeSession(person)}>Switch</button>}</div></td></tr>)}</tbody></table></div><div className="info-note" style={{ marginTop: 14 }}>This local admin screen stores role profiles. It does not send invitations or create passwords. For live cloud login, create/invite the Auth user, then link its `auth_user_id` to this employee row in Supabase.</div></div>
    </>
  )

  const renderTax = () => (
    <>
      <SectionHeading title="Tax setup" subtitle="Configure inclusive/exclusive pricing and component rates. Past sale lines keep their original tax snapshots." actions={<button className="btn primary" onClick={() => openTaxEditor()}><Plus size={14} />Add tax profile</button>} />
      <div className="attention-note"><AlertTriangle size={15} /><span><strong>Tax profile is not verified.</strong> Sample Ghana values are demonstration data only. Validate effective rates with GRA and confirm E-VAT/CIS certification requirements before issuing live receipts.</span></div>
      <div className="content-grid" style={{ marginTop: 12 }}>{taxCategories.map((category) => <div className="card span-6" key={category.id}><div className="card-head"><div><h2>{category.name}</h2><p>{category.code} · effective {category.effectiveFrom}</p></div><button className="btn small" onClick={() => openTaxEditor(category)}>Edit</button></div><div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 12 }}><StatusBadge status={category.treatment} label={taxLabel(category.treatment)} /><StatusBadge status={category.defaultPriceMode} label={`Default ${category.defaultPriceMode}`} /></div>{category.components.length ? <div className="report-bar-list">{category.components.map((component) => <div key={component.id} className="report-bar-row" style={{ gridTemplateColumns: 'minmax(80px,1fr) auto auto' }}><span className="report-bar-label">{component.name}</span><span className="badge blue">{component.method.replace('_', ' ')}</span><span className="report-bar-value">{component.ratePercent.toFixed(2)}%</span></div>)}</div> : <div className="info-note">No tax components; confirm the category’s legal treatment.</div>}<div className="subtle" style={{ marginTop: 13, fontSize: 9 }}>Products use their own price mode; rate/component changes affect new sales only.</div></div>)}</div>
    </>
  )

  const renderSettings = () => (
    <>
      <SectionHeading title="Settings" subtitle="Device, display currency, cloud, receipt and compliance information." />
      <div className="content-grid">
        <div className="card span-6"><div className="card-head"><div><h2>Display currency</h2><p>GHS remains the tender/reporting base. Optional reference values are never a converted settlement amount.</p></div><CircleDollarSign size={18} color="#6c8c76" /></div><div className="form-grid"><div className="field"><label>Reference currency</label><select value={displayCurrency} onChange={async (event) => { const next = event.target.value as typeof displayCurrency; setDisplayCurrency(next); await setMeta('display-currency', next) }}><option value="GHS">GHS · primary</option><option value="USD">USD · reference</option><option value="EUR">EUR · reference</option><option value="KES">KES · reference</option></select></div><div className="field"><label>Manual rate · target currency per GHS</label><input inputMode="decimal" placeholder="e.g. 0.08" value={fxRate} onChange={(event) => setFxRate(event.target.value)} onBlur={() => void setMeta('display-fx-rate', fxRate)} /><span className="field-hint">No rate is fetched automatically. Keep blank until you enter a trusted reference rate.</span></div></div><div className="info-note" style={{ marginTop: 12 }}>A reference currency is for customer display only. Receipts, tender amounts, inventory costing and tax reports remain in the store base currency (GHS).</div></div>
        <div className="card span-6"><div className="card-head"><div><h2>Connectivity & sync</h2><p>Device status and local outbox</p></div>{online ? <Wifi size={18} color="#34724f" /> : <WifiOff size={18} color="#a26210" />}</div><div className="report-bar-list"><div className="report-bar-row" style={{ gridTemplateColumns: '1fr auto' }}><span className="report-bar-label">Network</span><StatusBadge status={online ? 'synced' : 'pending'} label={online ? 'Online' : 'Offline'} /></div><div className="report-bar-row" style={{ gridTemplateColumns: '1fr auto' }}><span className="report-bar-label">Cloud</span><StatusBadge status={APP_DEMO_MODE ? 'pending' : cloudSignedIn ? 'synced' : 'conflict'} label={APP_DEMO_MODE ? 'Demo · local only' : cloudSignedIn ? 'Signed in' : 'Not signed in'} /></div><div className="report-bar-row" style={{ gridTemplateColumns: '1fr auto' }}><span className="report-bar-label">Queued changes</span><strong>{pendingCount}</strong></div><div className="report-bar-row" style={{ gridTemplateColumns: '1fr auto' }}><span className="report-bar-label">Conflicts</span><strong>{conflictCount}</strong></div></div><div className="heading-actions" style={{ marginTop: 15 }}><button className="btn primary" disabled={syncBusy || !online} onClick={() => void syncData()}><RefreshCw size={14} className={syncBusy ? 'spin' : ''} />{syncBusy ? 'Syncing…' : 'Sync now'}</button>{!APP_DEMO_MODE && <button className="btn" onClick={() => void signOut()}><LogOut size={14} />Sign out</button>}</div></div>
        {!APP_DEMO_MODE && <div className="card span-6"><div className="card-head"><div><h2>Offline device access</h2><p>PIN-gated unlock for this cached staff profile</p></div><ShieldCheck size={18} color="#6c8c76" /></div><div className="report-bar-row" style={{ gridTemplateColumns: '1fr auto', marginBottom: 12 }}><span className="report-bar-label">Local PIN status</span><StatusBadge status={offlinePinAvailable ? 'synced' : 'pending'} label={offlinePinAvailable ? 'Registered on this device' : 'Not registered'} /></div>{cloudSignedIn && online ? <form className="form-grid" onSubmit={saveLocalOfflinePin}><div className="field"><label htmlFor="offline-pin-setup">New PIN · 6–8 digits</label><input id="offline-pin-setup" type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{6,8}" maxLength={8} value={offlinePinSetup} onChange={(event) => setOfflinePinSetup(event.target.value.replace(/\D/g, '').slice(0, 8))} required /></div><div className="field"><label htmlFor="offline-pin-confirm">Confirm PIN</label><input id="offline-pin-confirm" type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{6,8}" maxLength={8} value={offlinePinConfirm} onChange={(event) => setOfflinePinConfirm(event.target.value.replace(/\D/g, '').slice(0, 8))} required /></div><div className="field full"><button className="btn primary" disabled={offlinePinSaving || offlinePinSetup.length < 6 || offlinePinConfirm.length < 6}>{offlinePinSaving ? <Loader2 size={14} className="spin" /> : <ShieldCheck size={14} />}{offlinePinSaving ? 'Saving…' : offlinePinAvailable ? 'Change offline PIN' : 'Set offline PIN'}</button></div></form> : <div className="info-note">Sign in while online to set or change this PIN. Only a salted PBKDF2 hash is stored. Signing out clears the local PIN and cached profile. This is a device unlock—not cloud authentication or encryption of IndexedDB records.</div>}<div className="field-hint" style={{ marginTop: 9 }}>Each staff member may enroll their own PIN after signing in. Offline access is limited to the last cached profile on this device; keep the tablet’s operating-system screen lock enabled.</div></div>}
        <div className="card span-6"><div className="card-head"><div><h2>Receipts & printers</h2><p>PDF, native share/mail, ESC/POS Bluetooth or USB</p></div><Printer size={18} color="#6c8c76" /></div><div className="info-note">Bluetooth and USB print use browser device APIs and require HTTPS, compatible Chromium, a user tap to connect, and a tested printer model. iOS/Safari support is limited. Native browser print/PDF is the fallback.</div><div className="heading-actions" style={{ marginTop: 13 }}><button className="btn" onClick={() => showToast('Open any receipt to use PDF print, native share/mail, Bluetooth or USB ESC/POS.', 'plain')}><Printer size={14} />Printer help</button><button className="btn" onClick={() => void installApp()}>{installed ? <Check size={14} /> : <ArrowDownToLine size={14} />}{installed ? 'Installed' : 'Install PWA'}</button></div><div className="subtle" style={{ marginTop: 12, fontSize: 9 }}>Managed email requires a server-side Resend key and verified sender. Demo falls back to native share/PDF; no email delivery is claimed.</div></div>
        <div className="card span-6"><div className="card-head"><div><h2>Payment & compliance</h2><p>Ghana is a provisional market configuration</p></div><ShieldCheck size={18} color="#6c8c76" /></div><div className="report-bar-list"><div className="report-bar-row" style={{ gridTemplateColumns: '1fr auto' }}><span className="report-bar-label">Paystack server key</span><StatusBadge status={cloudPaymentEnabled ? 'synced' : 'pending'} label={cloudPaymentEnabled ? 'Configured' : 'Not configured'} /></div><div className="report-bar-row" style={{ gridTemplateColumns: '1fr auto' }}><span className="report-bar-label">Tax receipt profile</span><StatusBadge status="pending" label="Demo / unverified" /></div><div className="report-bar-row" style={{ gridTemplateColumns: '1fr auto' }}><span className="report-bar-label">E-VAT/CIS certification</span><StatusBadge status="pending" label="Not verified" /></div></div><div className="attention-note" style={{ marginTop: 13 }}><AlertTriangle size={14} />Never mark card or mobile money paid from a redirect, screenshot or timeout. Only signed provider webhook/server verification finalizes a live digital tender.</div></div>
        {APP_DEMO_MODE && <div className="card span-12"><div className="card-head"><div><h2>Demo data</h2><p>Reset the local sample catalogue and transactions for this browser.</p></div><Sparkles size={18} color="#6c8c76" /></div><button className="btn danger" onClick={async () => { if (!window.confirm('Clear local demo data and reseed the sample store on this browser?')) return; await clearLocalDemoData(); localStorage.removeItem('pos-selected-employee'); await ensureDemoData(); await refreshLocalState(); setEmployee(null); setCart({}); showToast('Demo workspace reset.', 'success') }}><Trash2 size={14} />Reset demo workspace</button></div>}
      </div>
    </>
  )

  const renderMore = () => <><SectionHeading title="More tools" subtitle="Operations and administration for this device." /><div className="content-grid">{allowedNav.filter((item) => !['checkout', 'transactions'].includes(item.key)).map((item) => { const Icon = item.icon; return <button className="card span-4" key={item.key} onClick={() => setView(item.key)} style={{ cursor: 'pointer', textAlign: 'left' }}><span className="metric-icon"><Icon size={18} /></span><h3 style={{ margin: '12px 0 4px', fontSize: 13 }}>{item.label}</h3><p className="subtle" style={{ margin: 0, fontSize: 10 }}>Open {item.label.toLowerCase()} tools</p></button>})}</div></>

  const renderView = () => {
    switch (view) {
      case 'checkout': return renderCheckout()
      case 'transactions': return renderTransactions()
      case 'products': return renderProducts()
      case 'inventory': return renderInventory()
      case 'reports': return renderReports()
      case 'shifts': return renderShifts()
      case 'team': return renderTeam()
      case 'tax': return renderTax()
      case 'settings': return renderSettings()
      default: return renderMore()
    }
  }

  return (
    <>
      <div className={`app-shell ${modal === 'receipt' ? 'print-hidden' : ''}`}>
        <aside className="sidebar">
          <div className="brand-lockup"><span className="brand-mark">K</span><span><span className="brand-name">Kasa POS</span><span className="brand-caption">Independent retail</span></span></div>
          <div className="nav-label">Workspace</div>
          <nav className="nav-list" aria-label="Main navigation">{allowedNav.map((item) => { const Icon = item.icon; return <button key={item.key} className={`nav-item ${view === item.key ? 'active' : ''}`} onClick={() => { setView(item.key); setTableSearch('') }}><span className="nav-icon"><Icon size={16} /></span>{item.label}{item.key === 'transactions' && allPendingDigital > 0 && <span className="nav-count">{allPendingDigital}</span>}</button> })}</nav>
          <div className="sidebar-bottom"><div className="store-card"><div className="store-card-title"><Store size={12} style={{ verticalAlign: 'middle', marginRight: 5 }} />Accra Retail Demo</div><div className="store-card-sub">GHS base · local tax profile unverified<br />{APP_DEMO_MODE ? 'This browser only' : `Store ${employee.storeId.slice(0, 8)}`}</div></div><div className="sidebar-user"><span className="avatar">{initials(employee.displayName)}</span><span className="user-meta"><strong>{employee.displayName}</strong><span>{roleLabel(employee.role)}</span></span><button className="user-switch" title="Switch employee" onClick={() => void signOut()}><ChevronDown size={15} /></button></div></div>
        </aside>
        <main className="main-area">
          <header className="topbar"><div className="topbar-left"><div className="mobile-brand"><span className="brand-mark">K</span><strong>Kasa POS</strong></div><div><div className="topbar-title">{pageTitle[view]}</div><div className="topbar-subtitle">{dateText} · {employee.displayName} · {roleLabel(employee.role)}</div></div></div><div className="topbar-actions"><select className="top-select" aria-label="Display reference currency" value={displayCurrency} onChange={async (event) => { const next = event.target.value as typeof displayCurrency; setDisplayCurrency(next); await setMeta('display-currency', next) }}><option value="GHS">GHS base</option><option value="USD">USD ref</option><option value="EUR">EUR ref</option><option value="KES">KES ref</option></select>{installPrompt && <button className="btn small soft" onClick={() => void installApp()}><ArrowDownToLine size={13} /><span className="hide-small">Install</span></button>}<button className="icon-button" title="Sync now" onClick={() => void syncData()} disabled={syncBusy || !online}><RefreshCw size={15} className={syncBusy ? 'spin' : ''} /></button><button className="icon-button" title="Switch employee" onClick={() => void signOut()}><span className="avatar small">{initials(employee.displayName)}</span></button></div></header>
          <div className="workspace">{renderView()}</div>
          <nav className="bottom-nav" aria-label="Mobile navigation">{[
            { key: 'checkout' as View, title: 'Checkout', icon: ShoppingCart },
            { key: 'transactions' as View, title: 'Sales', icon: ReceiptText },
            { key: 'inventory' as View, title: 'Stock', icon: Boxes },
            { key: 'reports' as View, title: 'Reports', icon: BarChart3 },
          ].map((item) => { const Icon = item.icon; return <button key={item.key} className={`bottom-nav-item ${view === item.key ? 'active' : ''}`} onClick={() => setView(item.key)}><span><Icon size={16} /></span><span>{item.title}</span></button> })}<button className={`bottom-nav-item ${view === 'more' ? 'active' : ''}`} onClick={showMoreView}><span><Menu size={16} /></span><span>More</span></button></nav>
        </main>
      </div>

      {modal === 'payment' && <Modal title={pendingPayment ? 'Payment pending' : 'Complete sale'} description={pendingPayment ? 'This order remains unpaid until verified provider confirmation.' : 'Cash, card and mobile money. Digital tenders are never finalized from a redirect or screenshot.'} onClose={() => { if (pendingPayment) { setModal(null); setPendingPayment(null) } else setModal(null) }} footer={pendingPayment ? <><button className="btn" onClick={() => { setModal(null); setPendingPayment(null) }}>Close · keep pending</button>{pendingPayment.reference && !APP_DEMO_MODE && <button className="btn" disabled={!online || !cloudSignedIn || paymentChecking} onClick={() => void verifyPendingPayment(pendingPayment, true)}>{paymentChecking ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}Check provider status</button>}{pendingPayment.retryable && !APP_DEMO_MODE && <button className="btn primary" disabled={!online || !cloudSignedIn || paymentChecking || !customerEmail.trim() || (pendingPayment.method === 'momo' && !customerPhone.trim())} onClick={() => void retryPendingPayment(pendingPayment)}>{paymentChecking ? <Loader2 size={14} className="spin" /> : <Smartphone size={14} />}{pendingPayment.reference ? 'Retry payment' : 'Request payment'}</button>}</> : <><button className="btn" onClick={() => setModal(null)}>Back to cart</button><button className="btn primary" disabled={paymentMethod === 'cash' ? parseMoneyInput(cashReceived) < cartTotals.totalMinor : !cartLines.length || (!APP_DEMO_MODE && online && (!customerEmail.trim() || (paymentMethod === 'momo' && !customerPhone.trim())))} onClick={() => paymentMethod === 'cash' ? void finishCashSale() : void startDigitalPayment()}>{paymentMethod === 'cash' ? <Banknote size={14} /> : paymentMethod === 'card' ? <CreditCard size={14} /> : <Smartphone size={14} />}{paymentMethod === 'cash' ? 'Record cash sale' : APP_DEMO_MODE ? `Simulate ${paymentMethod === 'momo' ? 'MoMo' : 'card'} approval · demo` : `Request ${paymentMethod === 'momo' ? 'MoMo' : 'card'} payment`}</button></>}>
          {pendingPayment ? <div className="success-panel" style={{ paddingTop: 4 }}><div className="success-check" style={{ background: '#fff4dc', color: '#a26210' }}><Loader2 size={23} className={paymentChecking ? 'spin' : ''} /></div><h2>Awaiting confirmation</h2><p>{pendingPayment.message}</p><div className="receipt-paper"><div className="receipt-title">{pendingPayment.method === 'momo' ? 'Mobile-money request' : 'Card authorization'}</div><div className="receipt-line"><span>Order</span><strong>{orders.find((order) => order.id === pendingPayment.orderId)?.orderNumber ?? pendingPayment.orderId.slice(0, 8)}</strong></div><div className="receipt-line"><span>Reference</span><strong>{pendingPayment.reference ?? 'Not assigned yet'}</strong></div><div className="receipt-line"><span>Network</span><strong>{pendingPayment.network?.toUpperCase() ?? (pendingPayment.method === 'card' ? 'Card' : '—')}</strong></div></div><div className="attention-note" style={{ textAlign: 'left' }}><AlertTriangle size={14} />Do not hand over goods as paid until the POS receives verified server confirmation. A timeout is not proof of success or failure.</div>{pendingPayment.retryable && !APP_DEMO_MODE && <><div className="info-note" style={{ textAlign: 'left' }}>After a confirmed failed/abandoned attempt—or when no request was sent—you can create a new authorization for this same sale. Any saved provider reference is checked first to avoid a duplicate charge.</div><div className="form-grid"><div className="field"><label>Customer email</label><input type="email" value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} placeholder="customer@example.com" /></div>{pendingPayment.method === 'momo' && <><div className="field"><label>Mobile-money network</label><select value={momoNetwork} onChange={(event) => setMomoNetwork(event.target.value)}><option value="mtn">MTN Mobile Money</option><option value="atl">ATMoney / Airtel Money</option><option value="vod">Telecel Cash</option></select></div><div className="field"><label>Customer phone</label><input inputMode="tel" value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} placeholder="+233 24 123 4567" /></div></>}</div></>}{APP_DEMO_MODE && <div className="info-note">Demo mode sends no request. A separate “simulate approval” action is available only from the checkout method selector.</div>}</div> : <>
            <div className="form-grid"><div className="field full"><label>Sale total · GHS</label><input value={money(cartTotals.totalMinor)} readOnly /></div></div>
            <div className="payment-methods" style={{ marginTop: 14 }}>
              <button className={`payment-choice ${paymentMethod === 'cash' ? 'selected' : ''}`} onClick={() => setPaymentMethod('cash')}><span className="payment-choice-icon"><Banknote size={16} /></span><strong>Cash</strong><span>Finalize offline</span></button>
              <button className={`payment-choice ${paymentMethod === 'momo' ? 'selected' : ''}`} onClick={() => setPaymentMethod('momo')}><span className="payment-choice-icon"><Smartphone size={16} /></span><strong>Mobile money</strong><span>{APP_DEMO_MODE ? 'Demo only' : 'Provider confirmation'}</span></button>
              <button className={`payment-choice ${paymentMethod === 'card' ? 'selected' : ''}`} onClick={() => setPaymentMethod('card')}><span className="payment-choice-icon"><CreditCard size={16} /></span><strong>Card</strong><span>{APP_DEMO_MODE ? 'Demo only' : 'Provider confirmation'}</span></button>
            </div>
            {paymentMethod === 'cash' ? <>
              <div className="field"><label htmlFor="cash-received">Cash received · GHS</label><input id="cash-received" inputMode="decimal" value={cashReceived} onChange={(event) => setCashReceived(event.target.value)} placeholder="0.00" autoFocus /></div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>{[cartTotals.totalMinor, cartTotals.totalMinor + 500, cartTotals.totalMinor + 1000, cartTotals.totalMinor + 2000].map((amount, index) => <button className="btn small" key={`${amount}-${index}`} onClick={() => setCashReceived(inputFromMinor(amount))}>{index === 0 ? 'Exact' : `+ GHS ${(amount - cartTotals.totalMinor) / 100}`}</button>)}</div>
              <div className="cash-summary"><div className="cash-stat"><span>Amount due</span><strong>{money(cartTotals.totalMinor)}</strong></div><div className="cash-stat change"><span>Change</span><strong>{money(Math.max(0, parseMoneyInput(cashReceived) - cartTotals.totalMinor))}</strong></div></div>
            </> : APP_DEMO_MODE ? <div className="attention-note"><AlertTriangle size={14} /><span><strong>Simulation only.</strong> This button records a labelled demo transaction. No card/MoMo request, webhook or money transfer occurs.</span></div> : <>
              {paymentMethod === 'momo' && <><div className="form-grid"><div className="field"><label>Mobile-money network</label><select value={momoNetwork} onChange={(event) => setMomoNetwork(event.target.value)}><option value="mtn">MTN Mobile Money</option><option value="atl">ATMoney / Airtel Money</option><option value="vod">Telecel Cash</option></select></div><div className="field"><label>Customer phone</label><input inputMode="tel" placeholder="+233 24 123 4567" value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} /></div></div><div className="field" style={{ marginTop: 10 }}><label>Customer email · required by Paystack</label><input type="email" placeholder="customer@example.com" value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} /></div></>}
              {paymentMethod === 'card' && <><div className="field"><label>Customer email · required by Paystack</label><input type="email" placeholder="customer@example.com" value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} /></div><div className="info-note" style={{ marginTop: 10 }}>Card details are collected on Paystack’s hosted authorization page; this POS does not store PAN/CVV.</div></>}
              <div className="attention-note"><AlertTriangle size={14} />Digital payments require internet and a configured merchant account. If offline or timed out, the sale remains pending and stock is not decremented until confirmation.</div>
            </>}
          </>}
        </Modal>}

      {modal === 'receipt' && receiptOrder && <Modal title={receiptRefund ? 'Refund receipt' : 'Receipt'} description="Tax and tender details are preserved from the original transaction." onClose={() => setModal(null)} wide>
        <div className="receipt-paper"><div className="receipt-title">KASA POS · {receiptRefund ? 'RETURN' : 'SALES RECEIPT'}</div><div className="receipt-line"><span>Receipt</span><strong>{receiptOrder.orderNumber}</strong></div><div className="receipt-line"><span>Date</span><strong>{stamp(receiptOrder.createdAt)}</strong></div><div className="receipt-line"><span>Cashier</span><strong>{receiptOrder.employeeName}</strong></div><div className="receipt-line"><span>Payment</span><strong>{titleCase(receiptOrder.paymentMethod ?? 'pending')} · {receiptOrder.paymentStatus === 'demo_simulated' ? 'Demo simulation only' : titleCase(receiptOrder.paymentStatus ?? receiptOrder.status)}</strong></div><hr className="receipt-divider" />
          {(receiptRefund ? receiptRefund.lines : receiptOrder.items.map((item) => ({ productName: item.name, quantity: item.quantity, itemMinor: item.grossMinor - item.taxMinor, taxMinor: item.taxMinor, restock: false, productId: item.productId, orderLineId: item.productId }))).map((line, index) => <div key={`${line.productId}-${index}`}><div className="receipt-line"><span>{line.quantity} × {line.productName}</span><strong>{money(line.itemMinor + line.taxMinor)}</strong></div><div className="receipt-line" style={{ marginTop: 3, fontSize: 9 }}><span>Tax {receiptRefund ? '' : receiptOrder.items.find((item) => item.productId === line.productId)?.taxRatePercent.toFixed(2) + '%'} {receiptRefund && (line.restock ? '· restocked' : '· not restocked')}</span><span>{money(line.taxMinor)}</span></div></div>)}
          <hr className="receipt-divider" />{receiptRefund ? <><div className="receipt-line"><span>Status</span><strong>{receiptRefund.method === 'cash' ? 'Cash refund recorded' : titleCase(receiptRefund.status) + ' · provider reversal'}</strong></div><div className="receipt-line"><span>Reason</span><strong>{receiptRefund.reason}</strong></div><div className="receipt-line"><span>Refund amount</span><strong>{money(receiptRefund.amountMinor)}</strong></div><div className="receipt-line"><span>Tax reversal</span><strong>{money(receiptRefund.taxMinor)}</strong></div></> : <><div className="receipt-line"><span>Net subtotal</span><strong>{money(receiptOrder.subtotalMinor)}</strong></div><div className="receipt-line"><span>Tax total</span><strong>{money(receiptOrder.taxMinor)}</strong></div><div className="receipt-line" style={{ fontSize: 13, fontWeight: 800, color: 'var(--green)' }}><span>Total</span><strong>{money(receiptOrder.totalMinor)}</strong></div>{receiptOrder.paymentMethod === 'cash' && <><div className="receipt-line"><span>Cash received</span><strong>{money(receiptOrder.cashTenderedMinor ?? receiptOrder.totalMinor)}</strong></div><div className="receipt-line"><span>Change</span><strong>{money(receiptOrder.changeMinor ?? 0)}</strong></div></>}</>}
          <hr className="receipt-divider" /><div className="receipt-line" style={{ justifyContent: 'center', color: '#88938b' }}><span>Thank you for shopping with us.</span></div>
        </div>
        <div className="info-note"><strong>Tax notice:</strong> This is a demo/template receipt, not a statement of GRA E-VAT/CIS certification. Confirm legal receipt content and device/printer compatibility before a live pilot.</div>
        <div className="form-grid" style={{ marginTop: 14 }}><div className="field full"><label>Email receipt address</label><input type="email" placeholder="customer@example.com" value={receiptEmail} onChange={(event) => setReceiptEmail(event.target.value)} /><span className="field-hint">Managed email requires a configured Resend sender. Demo uses native share/PDF fallback.</span></div></div>
        <div className="heading-actions print-hidden" style={{ marginTop: 12 }}><button className="btn" onClick={() => window.print()}><Printer size={14} />Browser print / save PDF</button><button className="btn" onClick={() => void downloadReceiptPdf(receiptOrder, receiptRefund ?? undefined).then(() => showToast('PDF downloaded.', 'success')).catch(() => showToast('PDF export failed.', 'error'))}><ArrowDownToLine size={14} />Download PDF</button><button className="btn" onClick={() => void shareReceipt(receiptOrder, receiptRefund ?? undefined).then((result) => showToast(result === 'shared' ? 'Receipt opened in the device share sheet.' : 'PDF downloaded; attach it from your mail app.', 'plain')).catch(() => showToast('Share is not available in this browser.', 'error'))}><ArrowLeftRight size={14} />Share / Mail</button><button className="btn" onClick={() => void emailReceipt()}><Mail size={14} />Email receipt</button></div>
        <div className="heading-actions print-hidden" style={{ marginTop: 8 }}><button className="btn small" onClick={() => void printThermal('bluetooth')}><Printer size={12} />ESC/POS Bluetooth</button><button className="btn small" onClick={() => void printThermal('usb')}><Printer size={12} />ESC/POS USB</button></div>
      </Modal>}

      {modal === 'refund' && selectedOrder && <Modal title={`Return · ${selectedOrder.orderNumber}`} description={`Original tender: ${titleCase(selectedOrder.paymentMethod ?? 'unknown')}. Accepted saleable items are restocked. ${selectedOrder.paymentMethod === 'cash' ? 'Cash refund can be recorded offline.' : 'Digital reversal stays pending until provider confirmation.'}`} onClose={() => setModal(null)} wide footer={<><button className="btn" onClick={() => setModal(null)}>Cancel</button><button className="btn primary" disabled={!refundEstimate.amount} onClick={() => void submitRefund()}><RotateCcw size={14} />{selectedOrder.paymentMethod === 'cash' ? 'Record cash refund' : 'Request original-tender reversal'}</button></>}>
        {selectedOrder.paymentMethod !== 'cash' && <div className="attention-note"><AlertTriangle size={14} />The provider may take time to complete a reversal. Do not tell the customer it succeeded until Paystack’s status/webhook confirms it.</div>}
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Sold item</th><th>Return qty</th><th>Remaining</th><th>Restock</th><th>Refund incl. tax</th></tr></thead><tbody>{selectedOrder.items.map((line) => { const max = refundAvailable[line.productId] ?? 0; const qty = refundQty[line.productId] ?? 0; const amount = line.quantity ? Math.round(line.grossMinor * qty / line.quantity) : 0; return <tr key={line.productId}><td><strong>{line.name}</strong><div className="subtle" style={{ marginTop: 3 }}>{line.quantity} sold · tax {line.taxRatePercent.toFixed(2)}%</div></td><td><input style={{ width: 66, minHeight: 32, border: '1px solid var(--line)', borderRadius: 8, padding: '4px 7px' }} type="number" min="0" max={max} step="0.001" value={qty || ''} onChange={(event) => setRefundQty((current) => ({ ...current, [line.productId]: Math.max(0, Math.min(max, Number(event.target.value) || 0)) }))} /></td><td>{max}</td><td><input type="checkbox" checked={refundRestock[line.productId] ?? false} disabled={!qty} onChange={(event) => setRefundRestock((current) => ({ ...current, [line.productId]: event.target.checked }))} aria-label={`Restock ${line.name}`} /></td><td>{money(amount)}</td></tr>})}</tbody></table></div>
        <div className="form-grid" style={{ marginTop: 14 }}><div className="field full"><label>Reason</label><input value={refundReason} onChange={(event) => setRefundReason(event.target.value)} placeholder="Customer return / damaged item" /></div></div>
        <div className="cash-summary"><div className="cash-stat"><span>Refund total</span><strong>{money(refundEstimate.amount)}</strong></div><div className="cash-stat"><span>Tax reversal</span><strong>{money(refundEstimate.tax)}</strong></div></div>
        <div className="heading-actions" style={{ marginTop: 10 }}><button className="btn small" onClick={() => setRefundQty(Object.fromEntries(selectedOrder.items.map((line) => [line.productId, refundAvailable[line.productId] ?? 0])))}>Select remaining quantities</button><button className="btn small" onClick={() => setRefundQty(Object.fromEntries(selectedOrder.items.map((line) => [line.productId, 0])))}>Clear</button></div>
      </Modal>}

      {modal === 'product' && productForm && <Modal title={productForm.id ? 'Edit product' : 'Add product'} description="Price is entered in GHS. Tax mode and category are saved with the catalogue." onClose={() => setModal(null)} footer={<><button className="btn" onClick={() => setModal(null)}>Cancel</button><button form="product-form" type="submit" className="btn primary"><Check size={14} />Save product</button></>}>
        <form id="product-form" className="form-grid" onSubmit={saveProductForm}><div className="field full"><label>Product name</label><input required maxLength={80} value={productForm.name} onChange={(event) => setProductForm({ ...productForm, name: event.target.value })} /></div><div className="field"><label>SKU</label><input required value={productForm.sku} onChange={(event) => setProductForm({ ...productForm, sku: event.target.value })} /></div><div className="field"><label>Category</label><input required list="category-options" value={productForm.categoryName} onChange={(event) => setProductForm({ ...productForm, categoryName: event.target.value })} /><datalist id="category-options">{categories.filter((category) => category !== 'All items').map((category) => <option key={category} value={category} />)}</datalist></div><div className="field"><label>Price · GHS</label><input required inputMode="decimal" placeholder="0.00" value={productForm.price} onChange={(event) => setProductForm({ ...productForm, price: event.target.value })} /></div><div className="field"><label>Initial / counted stock</label><input required type="number" min="0" step="0.001" value={productForm.stock} onChange={(event) => setProductForm({ ...productForm, stock: event.target.value })} /><span className="field-hint">Editing this value creates a stock-count movement.</span></div><div className="field"><label>Tax category</label><select required value={productForm.taxCategoryId} onChange={(event) => setProductForm({ ...productForm, taxCategoryId: event.target.value })}>{taxCategories.map((tax) => <option key={tax.id} value={tax.id}>{tax.name}</option>)}</select></div><div className="field"><label>Price mode</label><select value={productForm.priceMode} onChange={(event) => setProductForm({ ...productForm, priceMode: event.target.value as Product['priceMode'] })}><option value="inclusive">Tax inclusive</option><option value="exclusive">Tax exclusive</option></select></div><div className="field full"><label className="inline-check"><input type="checkbox" checked={productForm.active} onChange={(event) => setProductForm({ ...productForm, active: event.target.checked })} />Active in checkout</label></div></form>
      </Modal>}

      {modal === 'stock' && stockProduct && <Modal title={`Count stock · ${stockProduct.name}`} description="A physical count is a versioned adjustment. If another device changed stock, cloud sync holds the count for manager review rather than overwriting movements." onClose={() => setModal(null)} footer={<><button className="btn" onClick={() => setModal(null)}>Cancel</button><button form="stock-form" type="submit" className="btn primary"><Boxes size={14} />Save count</button></>}>
        <form id="stock-form" className="form-grid" onSubmit={saveStockCount}><div className="field"><label>Current local count</label><input readOnly value={inventory.find((item) => item.productId === stockProduct.id)?.quantityOnHand ?? 0} /></div><div className="field"><label>Physical count</label><input required type="number" min="0" step="0.001" value={stockCount} onChange={(event) => setStockCount(event.target.value)} /></div><div className="field full"><label>Reason</label><input value={stockReason} onChange={(event) => setStockReason(event.target.value)} /></div></form>
      </Modal>}

      {modal === 'shift' && <Modal title={shiftFormMode === 'open' ? 'Open shift' : 'Close shift & reconcile'} description={shiftFormMode === 'open' ? 'Enter the physical opening float in the cash drawer.' : 'Count the drawer and record any variance before closing.'} onClose={() => setModal(null)} footer={<><button className="btn" onClick={() => setModal(null)}>Cancel</button><button form="shift-form" type="submit" className="btn primary">{shiftFormMode === 'open' ? <Clock3 size={14} /> : <Check size={14} />}{shiftFormMode === 'open' ? 'Open shift' : 'Close and reconcile'}</button></>}>
        <form id="shift-form" className="form-grid" onSubmit={saveShift}><div className="field full"><label>{shiftFormMode === 'open' ? 'Opening float · GHS' : 'Counted cash · GHS'}</label><input required inputMode="decimal" value={shiftAmount} onChange={(event) => setShiftAmount(event.target.value)} /></div>{shiftFormMode === 'close' && activeShift && <><div className="field full"><label>Expected cash</label><input readOnly value={money(activeShift.expectedCashMinor)} /></div><div className="field full"><label>Variance reason (required if not zero)</label><textarea value={shiftReason} onChange={(event) => setShiftReason(event.target.value)} placeholder="Explain cash over/short" /></div></>}</form>
      </Modal>}

      {modal === 'employee' && employeeForm && <Modal title={employeeForm.id ? 'Edit employee role' : 'Add employee'} description="Cashier, manager and owner permissions are enforced in the app. Cloud login invites are a separate setup action." onClose={() => setModal(null)} footer={<><button className="btn" onClick={() => setModal(null)}>Cancel</button><button form="employee-form" type="submit" className="btn primary"><Check size={14} />Save profile</button></>}>
        <form id="employee-form" className="form-grid" onSubmit={saveEmployeeForm}><div className="field full"><label>Display name</label><input required value={employeeForm.displayName} onChange={(event) => setEmployeeForm({ ...employeeForm, displayName: event.target.value })} /></div><div className="field full"><label>Role</label><select value={employeeForm.role} onChange={(event) => setEmployeeForm({ ...employeeForm, role: event.target.value as UserRole })}><option value="cashier">Cashier · checkout, receipts, own shift</option><option value="manager">Manager · products, stock, refunds, reports</option><option value="owner" disabled={employee.role !== 'owner'}>Owner · all operations and setup</option></select></div></form>
      </Modal>}

      {modal === 'tax' && taxForm && <Modal title={taxForm.id ? 'Edit tax profile' : 'Add tax profile'} description="Tax treatment and each component are snapshotted on every new sale line." onClose={() => setModal(null)} wide footer={<><button className="btn" onClick={() => setModal(null)}>Cancel</button><button form="tax-form" type="submit" className="btn primary"><ShieldCheck size={14} />Save tax profile</button></>}>
        <form id="tax-form" className="form-grid" onSubmit={saveTaxForm}><div className="field"><label>Name</label><input required value={taxForm.name} onChange={(event) => setTaxForm({ ...taxForm, name: event.target.value })} /></div><div className="field"><label>Code</label><input required value={taxForm.code} onChange={(event) => setTaxForm({ ...taxForm, code: event.target.value.toUpperCase() })} /></div><div className="field"><label>Treatment</label><select value={taxForm.treatment} onChange={(event) => setTaxForm({ ...taxForm, treatment: event.target.value as TaxTreatment })}><option value="standard_rated">Standard rated</option><option value="zero_rated">Zero-rated</option><option value="exempt">Exempt</option><option value="out_of_scope">Out of scope</option></select></div><div className="field"><label>Default price mode</label><select value={taxForm.defaultPriceMode} onChange={(event) => setTaxForm({ ...taxForm, defaultPriceMode: event.target.value as Product['priceMode'] })}><option value="inclusive">Inclusive</option><option value="exclusive">Exclusive</option></select></div><div className="field"><label>Effective from</label><input type="date" value={taxForm.effectiveFrom} onChange={(event) => setTaxForm({ ...taxForm, effectiveFrom: event.target.value })} /></div>
          {taxForm.treatment === 'standard_rated' && <div className="field full"><div className="card-head"><div><h3>Tax components</h3><p>Use same-base for parallel taxes, compound only where legally required.</p></div><button className="btn small" type="button" onClick={() => setTaxForm({ ...taxForm, components: [...taxForm.components, { id: newId(), code: '', name: '', ratePercent: 0, method: 'same_base', order: taxForm.components.length + 1 }] })}><Plus size={12} />Add component</button></div><div className="tax-component-list">{taxForm.components.map((component, index) => <div className="tax-component-row" key={component.id}><input aria-label="Tax component name" placeholder="Name / code" value={component.name} onChange={(event) => setTaxForm({ ...taxForm, components: taxForm.components.map((item, i) => i === index ? { ...item, name: event.target.value, code: event.target.value.toUpperCase().replace(/\s+/g, '_') } : item) })} /><input aria-label="Tax percentage" type="number" step="0.001" min="0" max="100" value={component.ratePercent} onChange={(event) => setTaxForm({ ...taxForm, components: taxForm.components.map((item, i) => i === index ? { ...item, ratePercent: Number(event.target.value) } : item) })} /><select aria-label="Calculation method" value={component.method} onChange={(event) => setTaxForm({ ...taxForm, components: taxForm.components.map((item, i) => i === index ? { ...item, method: event.target.value as TaxComponent['method'] } : item) })}><option value="same_base">Same base</option><option value="compound">Compound</option></select><button className="btn icon small" type="button" aria-label="Remove component" onClick={() => setTaxForm({ ...taxForm, components: taxForm.components.filter((_, i) => i !== index) })}><Trash2 size={12} /></button></div>)}</div><span className="field-hint">Historical transaction snapshots are not recalculated when this profile changes. This UI does not certify Ghana E-VAT/CIS compliance.</span></div>}
        </form>
      </Modal>}

      {toast && <div className="toast-stack"><div className={`toast ${toast.tone}`}>{toast.message}</div></div>}
    </>
  )
}
