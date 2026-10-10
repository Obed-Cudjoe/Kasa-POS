#!/usr/bin/env node

const input = process.argv[2] ?? process.env.CLOUDFLARE_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL
if (!input) {
  console.error('Usage: npm run cf:check -- https://<worker>.<account>.workers.dev')
  console.error('Or set CLOUDFLARE_APP_URL to the public app base URL.')
  process.exit(2)
}

let base
try {
  base = new URL(input)
} catch {
  console.error('The app URL is not a valid absolute URL.')
  process.exit(2)
}
if (base.protocol !== 'https:') {
  console.error('Use the deployed HTTPS URL for this check.')
  process.exit(2)
}
base.pathname = '/'
base.search = ''
base.hash = ''

function fail(message) {
  console.error(`FAIL: ${message}`)
  process.exit(1)
}

try {
  const home = await fetch(new URL('/', base), { redirect: 'follow' })
  const homeType = home.headers.get('content-type') ?? ''
  const homeText = await home.text()
  if (!home.ok) fail(`homepage returned HTTP ${home.status}`)
  if (!homeType.includes('text/html') || !homeText.includes('Kasa POS')) {
    fail(`homepage is not the Kasa POS app (HTTP ${home.status}, content-type ${homeType || 'missing'}). A placeholder Worker may still be deployed.`)
  }

  const health = await fetch(new URL('/api/health', base), {
    headers: { accept: 'application/json' },
    redirect: 'follow',
  })
  const healthType = health.headers.get('content-type') ?? ''
  if (!health.ok) fail(`/api/health returned HTTP ${health.status}`)
  if (!healthType.includes('application/json')) {
    const body = (await health.text()).slice(0, 120)
    fail(`/api/health did not return JSON (content-type ${healthType || 'missing'}; body ${JSON.stringify(body)})`)
  }

  const payload = await health.json()
  if (payload?.ok !== true || payload?.app !== 'Kasa POS') {
    fail(`/api/health returned an unexpected payload: ${JSON.stringify(payload)}`)
  }
  if (payload?.mode !== 'configured' || payload?.cloudConfigured !== true) {
    fail(`Kasa POS is running, but Cloud backend configuration is missing or demo mode is enabled (mode=${payload?.mode ?? 'unknown'}, cloudConfigured=${payload?.cloudConfigured ?? 'unknown'}).`)
  }

  console.log(`PASS: Kasa POS homepage and health route are responding at ${base.origin}`)
  console.log(`mode=${payload.mode}; cloudConfigured=${payload.cloudConfigured}; paymentsConfigured=${Boolean(payload.paymentsConfigured)}`)
  console.log('Note: /api/health validates runtime configuration flags; it does not perform a Supabase database read/write.')
} catch (error) {
  if (error instanceof TypeError && String(error).includes('fetch')) {
    fail(`network request failed: ${error.message}`)
  }
  if (error instanceof Error) fail(error.message)
  fail(String(error))
}
