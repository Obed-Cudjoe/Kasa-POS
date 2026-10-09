import { NextResponse } from 'next/server'
import { hasCloudConfiguration } from '@/lib/cloud'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    ok: true,
    app: 'Kasa POS',
    mode: process.env.NEXT_PUBLIC_DEMO_MODE === 'false' ? 'configured' : 'demo',
    cloudConfigured: hasCloudConfiguration(),
    paymentsConfigured: Boolean(process.env.PAYSTACK_SECRET_KEY),
    timestamp: new Date().toISOString(),
  }, { headers: { 'cache-control': 'no-store' } })
}
