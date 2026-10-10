export const PRIVACY_NOTICE_VERSION = '2026-10-10'
export const PRIVACY_NOTICE_PATH = '/privacy'

export const PRIVACY_CONSENT_PURPOSES = ['digital_payment_contact', 'receipt_email'] as const
export type PrivacyConsentPurpose = (typeof PRIVACY_CONSENT_PURPOSES)[number]

export function isPrivacyConsentPurpose(value: unknown): value is PrivacyConsentPurpose {
  return typeof value === 'string' && PRIVACY_CONSENT_PURPOSES.includes(value as PrivacyConsentPurpose)
}
