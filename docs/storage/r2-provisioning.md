# Cloudflare R2 provisioning for Garcia

This document is a runbook only. It does not create buckets, bind them to the Worker,
apply D1 migrations, or deploy anything.

## Storage boundaries

- `garcia-files` (`FILES` binding): user imports and Garcia-created working artifacts.
- `garcia-backup` (`BACKUPS` binding): versioned snapshots and recovery packages.

D1 stores metadata and object keys only. Never place file bytes, backup archives, or
base64 payloads in D1 rows or outbox JSON.

## Provision buckets

Run from an authenticated Cloudflare Wrangler environment after confirming the
account and target Worker:

```sh
npx wrangler r2 bucket create garcia-files
npx wrangler r2 bucket create garcia-backup
npx wrangler r2 bucket list
```

Bucket creation is an account-level action. Confirm both exact bucket names in the
Cloudflare dashboard before continuing.

## Add Worker bindings only after both buckets exist

Add these entries to `wrangler.toml` only after successful provisioning:

```toml
[[r2_buckets]]
binding = "FILES"
bucket_name = "garcia-files"

[[r2_buckets]]
binding = "BACKUPS"
bucket_name = "garcia-backup"
```

Do not add the bindings while the buckets are absent: Wrangler validation/deploy
would fail. Do not bind the same bucket to both purposes.

## Verification checklist

1. Confirm the active Cloudflare account and Worker name are `ciba-ai`.
2. Confirm `garcia-files` and `garcia-backup` exist in that account.
3. Add the two bindings above.
4. Run `npx wrangler types` and the repository typecheck.
5. Run local tests with mock R2 buckets.
6. Apply D1 migrations only after reviewing the target database:
   `npx wrangler d1 migrations list ciba-ai-db`.
7. Deploy only after an explicit release decision. This project currently keeps PR
   #28 in draft and CI must not build APKs or deploy.

## Recovery considerations

- Upload: create pending D1 metadata, write the R2 object, then mark metadata available.
- If object write fails, remove any partial object best-effort and mark the row failed.
- Delete: preserve enough metadata to retry cleanup if R2 deletion or D1 update fails.
- Backups must be immutable/versioned and independently restorable; never overwrite
  the only known-good recovery snapshot.
