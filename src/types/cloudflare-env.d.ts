/// <reference types="@cloudflare/workers-types" />

interface CloudflareEnv {
  DB: D1Database
  SESSION_SECRET: string
  PUBLIC_APP_URL?: string
  RESEND_API_KEY?: string
  RESEND_FROM_EMAIL?: string
  PAYSTACK_SECRET_KEY?: string
  PAYSTACK_DEFAULT_EMAIL?: string
  PAYMENT_RECEIPT_EMAIL?: string
}
