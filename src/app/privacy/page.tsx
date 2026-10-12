import Link from 'next/link'
import { PRIVACY_NOTICE_VERSION } from '@/lib/privacy'

export const metadata = {
  title: 'Privacy notice · Kasa POS',
  description: 'Template privacy notice for customer payment-contact and receipt processing.',
}

const sectionStyle = { marginTop: 20, lineHeight: 1.65 } as const

export default function PrivacyPage() {
  return (
    <main style={{ maxWidth: 820, margin: '32px auto', padding: '24px 20px 56px', color: '#1c2a22', fontFamily: 'system-ui, sans-serif' }}>
      <p style={{ color: '#54705e', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', fontSize: 12 }}>Kasa POS · version {PRIVACY_NOTICE_VERSION}</p>
      <h1 style={{ fontSize: 'clamp(30px, 6vw, 44px)', lineHeight: 1.1 }}>Privacy notice</h1>
      <div role="note" style={{ padding: 16, border: '1px solid #edc87f', borderRadius: 12, background: '#fff8e8' }}>
        <strong>Deployment template — not yet merchant-specific or proof of compliance.</strong>
        <p style={{ marginBottom: 0 }}>Before collecting real customer or employee data, the store owner must replace the contact placeholders below, document its retention schedule and lawful bases, confirm Data Protection Commission registration obligations, and obtain Ghanaian privacy/legal advice where needed.</p>
      </div>

      <section style={sectionStyle}>
        <h2>Who is responsible?</h2>
        <p><strong>Data controller:</strong> [Insert the store’s registered legal/business name].<br />
          <strong>Address:</strong> [Insert physical/business address].<br />
          <strong>Privacy contact:</strong> [Insert monitored email address and phone number before launch].</p>
        <p>Kasa POS is a point-of-sale software tool used by the store. The store decides why and how customer and staff information is used and is responsible for its handling.</p>
      </section>

      <section style={sectionStyle}>
        <h2>What may be used, and why?</h2>
        <ul>
          <li><strong>Payment contact:</strong> checkout is cash-only in this configuration. The POS does not send customer email addresses, phone numbers or network details to a payment gateway. If a gateway is enabled in the future, this notice and consent flow must be reviewed first.</li>
          <li><strong>Receipt email:</strong> if the customer asks for it, the entered email address is sent to the configured receipt-email service with the receipt attachment. It is not saved in the local POS order by this application.</li>
          <li><strong>Sales and tax records:</strong> item, amount, tax, tender status, store/device identifiers and the cashier’s staff identity are used to operate the till, reconcile payment, manage stock, prevent duplicate refunds and meet applicable accounting/tax duties.</li>
          <li><strong>Consent audit:</strong> when the Cloudflare D1 service is configured, the system records the order reference, purpose, notice version, time and staff member. It does not record the customer’s email address or phone number in this audit entry.</li>
        </ul>
        <p>Marketing is a separate purpose. Payment or receipt consent is not marketing consent; this POS template does not request marketing opt-in during checkout.</p>
      </section>

      <section style={sectionStyle}>
        <h2>Payments and storage</h2>
        <p>Cash-only checkout is enabled; no card or mobile-money gateway request is made. The POS does not collect or store full card numbers, CVV/CVC or payment PINs. If a gateway is added later, use its hosted/tokenized payment flow and update this notice before collecting any related contact data.</p>
        <p>Business and staff data may be held in the browser’s IndexedDB for offline operation and, when configured, in the store’s Cloudflare D1 database through Cloudflare Workers. The current staging database location is in the United States; review Ghana data-location, transfer and privacy implications before storing real customer or employee data. Browser-local data is <strong>not application-encrypted at rest</strong> in this version. Use a dedicated, OS-encrypted device with a strong screen lock, restrict staff access, and remove local data securely before reassignment. Do not use a shared/public device for live sales.</p>
        <p>Cloudflare D1/Workers and email-provider settings and contractual terms must be reviewed by the store owner. Payment-gateway processing is not enabled in this cash-only setup. This notice does not promise that a provider, account, backup, or device is configured correctly.</p>
      </section>

      <section style={sectionStyle}>
        <h2>Consent and choice</h2>
        <p>Checkout is cash-only, so no payment-gateway contact details or payment-contact consent are requested. For an emailed receipt, the cashier must confirm that the customer asked for it before entering an email address. Do not enter or send the address if the customer declines; offer a paper/PDF receipt instead. No marketing consent is implied. Review this notice and obtain appropriate consent before enabling any gateway in the future.</p>
      </section>

      <section style={sectionStyle}>
        <h2>Retention and your rights</h2>
        <p>The store must set and document its own retention schedule. Contact details entered for a payment or receipt are not intended to persist in the local POS database, but the payment/email provider may retain records under its terms. Transaction, tax and consent-audit records may need to be retained for lawful business purposes. A deletion request is assessed record by record; legally required financial records may not be erased while retention is required, and may instead be restricted or have unnecessary identifiers removed.</p>
        <p>Under Ghana’s Data Protection Act, 2012 (Act 843), people have rights concerning their personal data, including to seek correction and, in circumstances described by the Act, deletion. To make an access, correction or deletion request, contact the store using the completed privacy contact above or ask the store manager in person. The manager should verify the requester, log the date and scope, acknowledge the request, assess any legal retention duties, securely correct/delete or explain a lawful limitation, and record completion. Do not delete a financial record automatically before that review.</p>
        <p>More information is available from the <a href="https://dataprotection.org.gh/" rel="noreferrer">Ghana Data Protection Commission</a>. This notice is not legal advice and does not establish DPC registration or Act 843 compliance.</p>
      </section>

      <section style={sectionStyle}>
        <h2>Report a privacy concern</h2>
        <p>Contact the store’s named privacy contact. The store should restrict access while investigating, preserve necessary evidence, correct any inaccurate data, and follow applicable notification and escalation obligations.</p>
      </section>

      <p style={{ marginTop: 32 }}><Link href="/">Return to Kasa POS</Link></p>
    </main>
  )
}
