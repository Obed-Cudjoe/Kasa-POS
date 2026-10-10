# POS backup and recovery procedure

**Version:** 1.0 · **Reviewed:** 2026-10-10 · **Status:** Runbook only; no backup, restore, or disaster-recovery exercise was executed.

## 1. Scope and important limitation

Kasa POS has two data locations:

1. **Supabase PostgreSQL** — cloud catalogue, orders, payments/refunds, staff, tax snapshots, stock movements and sync audit after successful sync.
2. **Browser IndexedDB (Dexie)** — device-local catalogue, cached business data, pending outbox events and offline cash/refund activity.

The application does not currently provide an encrypted export/restore workflow for IndexedDB. Data that exists only on a lost, damaged, reset, or cleared device may be unrecoverable. An outbox event not yet accepted by cloud has **no cloud backup**. Do not clear site data, uninstall the PWA, or reset a tablet until its pending count is zero and all conflicts are reviewed.

This procedure is not evidence that the configured Supabase project has backups enabled. The project, plan, retention period, PITR settings and restore credentials were not available to verify.

## 2. Roles

- **Owner:** approves recovery, access changes, retention decisions and return to trading.
- **Recovery operator:** owner or designated technical administrator with access to the Supabase project and encrypted backup storage.
- **Manager:** stops sales on an affected device, counts pending/conflicted records and helps reconcile receipts/till cash. Do not grant the manager service-role or database-owner credentials for convenience.

Use named accounts, MFA where available, least privilege and an auditable ticket/log. Never send database credentials or backup files through ordinary email or chat.

## 3. Before a live pilot

1. Apply and review Supabase migrations `001` through `004` in the intended project. Confirm row-level security, service-role separation and employee access.
2. In Supabase, verify the project’s automated backup coverage, retention, restore process and whether point-in-time recovery is included in the selected plan. Record project name/region, plan, backup frequency/retention, support contact and exact console steps in the store’s private operations vault.
3. Choose business-approved recovery objectives. Suggested starting targets for discussion—not guarantees—are **RPO 15 minutes for acknowledged cloud data** and **RTO 4 business hours**. Offline-only records have a different, potentially unbounded RPO until the originating device is recovered and synced.
4. Arrange a secure, encrypted, access-controlled backup destination separate from the production Supabase account. Restrict access, log downloads, and set an owner-approved retention schedule that accounts for statutory financial records and data-subject requests.
5. Configure alerts/monitoring for backup failures, database availability, sync conflicts, negative stock and provider reconciliation. No alerting configuration has been verified by this review.

## 4. Routine backup runbook

### Cloud database

1. Confirm that no migration or restore is in progress and that the project dashboard shows the expected successful automated backup/PITR status.
2. For an additional logical backup, use a trusted administrator workstation and the approved Supabase backup/CLI/PostgreSQL export process. Use a read-only/backup identity where supported; do not put secrets in shell history or a shared terminal transcript.
3. Export schema and business data consistently. Store the exact application version and migration list with the backup metadata. Do not include live secrets in the archive.
4. Encrypt the export before it leaves the secured environment. Record checksum, creation time, project/region, operator and retention expiry in the private backup log. Test checksum after upload.
5. Verify that the file can be listed and downloaded only by authorized recovery staff. Do not treat a successful file upload as a successful restore test.

### Device-local data

1. Keep every trading tablet under OS full-disk encryption, a strong screen lock, automatic lock timeout, managed accounts and restricted app installation. App-level encryption of IndexedDB is **not** implemented.
2. Before a planned device swap, reconnect, sign in, sync the outbox, resolve all conflicts, check the final pending/conflict counts, and compare the day’s orders, tender totals, refunds and stock movements with the owner’s control report.
3. If the device is offline or has pending/conflicted data, do not reset, clear storage or uninstall. Keep it powered, secure it physically, and reconnect only on the approved network. Export/reconciliation tooling is not available in this build.
4. On theft/loss, revoke the device/session and affected staff access promptly, report the incident under the store’s privacy/security process, and do not assume data can be remotely erased from a browser cache.

## 5. Cloud restore procedure

1. Declare an incident, record scope/time/approver and pause writes if continued trading could corrupt reconciliation. Preserve provider and application evidence.
2. Notify the Supabase project owner/support using the verified project contacts. Select the recovery point based on the last known-good backup and the business-approved RPO; do not restore directly over production until the recovery point is reviewed.
3. Restore first to an isolated staging project. Use the matching application release and migrations. Never expose the service-role key to the browser or paste it into the recovery document.
4. Validate schema/migrations; store and employee relationships; product/tax profiles; order and line counts; integer minor-unit totals; tender-to-order linkage; refund totals/statuses; stock-movement ledger/projection; device and sync-event idempotency; and health/auth endpoints.
5. Reconcile post-backup transactions against provider statements/webhooks, till records and device outboxes. Do not replay a payment initialization, charge, or refund as a way to repair a missing database row. Reconcile with the provider before any financial action.
6. If an erased/corrected personal record was restored from an older backup, reapply the deletion/correction ledger after legal review and before normal access is restored.
7. Owner signs off the reconciliation. Promote the restored project or use the approved cutover, rotate affected credentials, verify staff access and monitor sync/provider queues closely.

## 6. Device replacement / local recovery

1. Do not erase or retire the old device until online sync confirms its outbox and conflicts are resolved.
2. Enrol the replacement device through the approved owner process; install the PWA from the verified HTTPS host; sign in with an individual Supabase Auth account; set the refund ceiling and device PIN only after identity is verified.
3. Pull the cloud snapshot and compare sample products, tax categories, inventory, open shifts and recent receipts.
4. If the old device contained unsynced records and is unavailable, mark the affected time range/device in the incident log. Reconstruct from printed receipts, till count, provider records and manager evidence; use a manager-approved reconciliation path. Never fabricate a provider confirmation.
5. Test one clearly labelled non-production cash transaction, sync, and reconciliation in staging before releasing the replacement for live trade.

## 7. Restore-test schedule and evidence

- Perform a documented isolated restore at least quarterly and after material schema/hosting changes.
- Test at least one cloud restore, one device replacement/re-authentication, one offline outbox reconciliation, and one provider reconciliation.
- Capture start/end time, backup/checksum, migrations, validation counts, differences, corrective actions, operator and owner approval. Store evidence securely with access restricted.

**Current result:** procedure drafted only. Supabase backups, point-in-time recovery, encrypted logical exports, device-loss recovery, restore validation, RPO/RTO and recovery time have **not** been tested or proven.
