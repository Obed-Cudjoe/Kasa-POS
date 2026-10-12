import { NextResponse } from 'next/server'
import { getRuntimeConfiguration } from '@/lib/cloud'

export const dynamic = 'force-dynamic'

export async function GET() {
  const config = await getRuntimeConfiguration()
  return NextResponse.json({
    ok: true,
    app: 'Kasa POS',
    mode: process.env.NEXT_PUBLIC_DEMO_MODE === 'false' && config.cloudConfigured ? 'configured' : 'demo',
    cloudConfigured: config.cloudConfigured,
    paymentsConfigured: config.paymentsConfigured,
    timestamp: new Date().toISOString(),
  }, { headers: { 'cache-control': 'no-store' } })
}
