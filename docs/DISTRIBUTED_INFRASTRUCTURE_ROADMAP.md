# Garcia distributed infrastructure roadmap

## Purpose

Expand the Ciba AI backend beyond a single Cloudflare D1 database without changing the Android application contract, weakening the private single-owner model, or enabling paid usage implicitly.

## Non-negotiable constraints

- Keep Cloudflare D1 as the authoritative system of record during the first expansion phase.
- Never replicate chat transcripts. The current gateway intentionally does not persist prompts or responses.
- Replicate only explicitly curated records and operational metadata that have a defined retention and deletion policy.
- Encrypt sensitive replication payloads before they enter an outbox. Never put plaintext memory values, access tokens, device tokens, or owner secrets in queue metadata or logs.
- Every replicated event must be idempotent, ordered per entity, retryable, observable, and traceable to a source revision.
- A provider outage must not make D1 writes fail. The outbox is asynchronous; D1 remains authoritative.
- No paid-plan upgrade, paid overage, credit purchase, or billing-enabling switch may be activated automatically. Stay within verified free allowances and fail closed before a service can incur charges.

## Provider responsibilities

| Service | Intended responsibility | Not its responsibility |
| --- | --- | --- |
| Cloudflare D1 | Primary transactional database, identity, authorization, quotas, curated memory | Long-term binary backup archive |
| Cloudflare R2 | Encrypted snapshots, export bundles, and large objects | Relational query engine or primary database |
| Turso | Optional geographically distributed SQLite read replica for selected, non-secret data | Authority for identity, grants, or writes |
| Neon | Optional isolated PostgreSQL workspace for analytics/experiments and future vector workloads | Synchronous mirror of every D1 row |

Turso and Neon are alternatives for distinct workloads, not two mandatory write replicas. Do not copy the same private dataset to both merely to increase a database count. R2 is object storage and complements rather than replaces a database.

## Delivery phases

### Phase 0 — Inventory and guardrails

- Confirm the active production Worker, D1 binding, migrations, deployment workflow, and existing data model.
- Record provider limits and billing behavior from official pricing documentation.
- Keep production bindings and secrets unchanged.
- Work on a dedicated feature branch; do not change Android release workflows.

### Phase 1 — Durable replication foundation

- Add a D1 outbox with opaque event IDs, entity identifiers, operation, destination, source revision, retry metadata, and delivery timestamps.
- Store only authenticated-encrypted payloads in the outbox; encryption keys remain Worker secrets and never reach Android.
- Enqueue events in the same D1 transaction/batch as the corresponding curated-record mutation.
- Add bounded batch claiming, lease expiry, exponential backoff, dead-letter visibility, idempotency keys, and per-destination delivery cursors.
- Add unit and integration tests for duplicate delivery, crash/retry, ordering, deletion, expired leases, and provider outage.
- Do not enable external provider delivery until the outbox and encryption tests pass.

### Phase 2 — Encrypted backup to R2

- Export a consistent D1 snapshot or explicitly scoped curated-data bundle.
- Encrypt before upload; use immutable object names and a manifest with schema version, source revision, checksum, and timestamp.
- Verify download, decryption, checksum, and restore into an isolated test database.
- Define retention and deletion policy before enabling scheduled backups.
- Respect the R2 free allowance; stop uploads before any paid usage could begin.

### Phase 3 — Optional read replica

- Select Turso only if regional read latency or read volume justifies it.
- Replicate through the outbox with idempotent upserts and tombstones.
- Keep all authorization decisions and writes on D1. A replica must never grant access.
- Monitor replication lag and automatically fall back to D1 reads when stale or unavailable.
- Do not activate until a free account and no-overage behavior are confirmed.

### Phase 4 — Isolated analytics / vector workloads

- Evaluate Neon for derived analytics or vector search only after defining exactly which data may leave D1.
- Prefer derived, minimized, pseudonymous data; exclude secrets and raw conversation content.
- Keep this workload isolated from transactional authorization and user-facing writes.
- Enforce free-plan compute, storage, and egress ceilings; suspend optional workloads before any paid transition.

### Phase 5 — Operations and resilience

- Add an admin-only health view for provider status, free-quota headroom, replication lag, oldest pending event, retry counts, backup age, and last restore verification.
- Alert on failed backups, dead-letter events, quota thresholds, and stale replicas.
- Perform restore drills and document recovery point objective (RPO) and recovery time objective (RTO).
- Never report a backup or replica as healthy based only on a successful upload or connection check.

## Current repository baseline (2026-11-19)

- The active Garcia backend is in `fabiociba7-br/ciba-ai`.
- The Worker uses Cloudflare D1 binding `DB`; `wrangler.toml` identifies database `ciba-ai-db`.
- The repository migration sequence currently ends at `0020_facebook_token_storage.sql`.
- No `0021_garcia_storage_outbox.sql` or `storage-outbox.ts` exists in the inspected branch at this baseline.
- The deployment workflow applies D1 migrations and deploys the Worker on pushes to `main`; do not merge a schema change until tests and production migration safety have been reviewed.
- The Android app contract must remain unchanged during the infrastructure work.

## Exit criteria for Phase 1

Phase 1 is complete only when the outbox schema, encrypted payload helper, atomic enqueue integration, bounded dispatcher contract, retry/dead-letter behavior, and automated tests are all present and passing. Creating an empty table or connecting a provider is not sufficient.
