# Production runbook

این سند قرارداد استقرار نسخه Web است. اصل ثابت: **Web process فقط credential محدود `univ_app_web` را می‌گیرد.** owner، migration، tenant lifecycle و backup/restore در job یا shell عملیاتی جدا اجرا می‌شوند.

## معماری و نقش‌ها

- Next.js standalone پشت reverse proxy/load balancer
- PostgreSQL 18 با RLS اجباری و `FORCE ROW LEVEL SECURITY` روی داده‌های tenant
- `univ_app_web`: `NOSUPERUSER`, `NOBYPASSRLS`, بدون create/role/database privileges
- owner/migration credential: فقط job عملیاتی
- PgBouncer در transaction mode برای چند instance

## Web environment

از `.env.production.example` استفاده کنید. حداقل: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `MFA_ENCRYPTION_KEYS`, `MFA_ACTIVE_KEY_ID`, `BETTER_AUTH_URL`, `TRUSTED_ORIGINS`, مسیر اشتراکی `EXPORT_JOB_DIR`, کلید مستقل `PLATFORM_OPERATION_ENCRYPTION_KEY` و `PLATFORM_SESSION_HOURS` را تنظیم کنید. کلید Platform باید با مقدار worker یکسان و از `BETTER_AUTH_SECRET` و کلیدهای MFA مستقل باشد.

`DATABASE_ADMIN_URL`, `BACKUP_ENCRYPTION_KEYS`, `BACKUP_ACTIVE_KEY_ID`, `BACKUP_DIR`, `BACKUP_OFFSITE_DIR` و `AUDIT_SEAL_KEY` نباید در Web environment وجود داشته باشند.

```bash
node --env-file=.env.production scripts/production-check.mjs --strict
node --env-file=.env.production scripts/production-db-check.mjs
```

## Database job

`.env.database.example` شامل `DATABASE_ADMIN_URL` و URL/passwordهای provisioning برای هر سه role زمان اجرا (`univ_app_web`، `univ_job_worker` و `univ_platform_worker`) است. role سوم برای Platform Worker دائمی است و مالک دیتابیس نیست.

```bash
node --env-file=.env.database scripts/db.mjs migrate
node --env-file=.env.database scripts/db.mjs setup
```

## Tenant provisioning و lifecycle

ایجاد دانشگاه endpoint عمومی ندارد.

```bash
TENANT_ADMIN_PASSWORD='temporary-secret' node --env-file=.env.database scripts/create-tenant.ts \
  --slug university-a --name "دانشگاه الف" --admin-username admin --admin-name "مدیر دانشگاه"

node --env-file=.env.operations scripts/platform.mjs platform:health
node --env-file=.env.operations scripts/platform.mjs tenant:list
node --env-file=.env.operations scripts/platform.mjs tenant:suspend --slug university-a
node --env-file=.env.operations scripts/platform.mjs tenant:resume --slug university-a
node --env-file=.env.operations scripts/platform.mjs tenant:archive --slug university-a --confirm ARCHIVE:university-a
node --env-file=.env.operations scripts/platform.mjs tenant:owner:set --slug university-a --username admin --confirm SET-OWNER:university-a:admin
node --env-file=.env.operations scripts/platform.mjs tenant:mfa:reset-owner --slug university-a --username admin --confirm RESET-MFA:university-a:admin
# فقط برای shell provisioning شکست‌خورده و فاقد هرگونه داده business:
node --env-file=.env.operations scripts/platform.mjs tenant:failed:purge --slug university-a --confirm PURGE:university-a

```

همه عملیات lifecycle در `platform_audit_log` ثبت می‌شوند و درخواست‌های آمده از Platform Console با `request_id` و شناسه‌ی اپراتور قابل ردیابی‌اند. رمز مدیر اولیه موقت است و کاربر در اولین ورود مجبور به تغییر آن می‌شود.

### Platform Console و worker

Platform Console برای همه اپراتورها MFA اجباری دارد. session کنسول با `PLATFORM_SESSION_HOURS` (۱ تا ۸ ساعت، پیشنهاد ۴) محدود می‌شود و enqueue عملیات تغییر‌دهنده تنها در پنجره‌ی step-up تازه مجاز است. درخواست صف، session تأییدشده را به‌عنوان proof داخلی حمل می‌کند و worker قبل از اجرای cross-tenant دوباره فعال بودن اپراتور، session، MFA و elevation همان لحظه‌ی درخواست را با credential مدیریتی بررسی می‌کند.

Platform Worker دائمی از فایل مستقل `.env.platform-worker` استفاده می‌کند و با `DATABASE_PLATFORM_URL` به role محدود `univ_platform_worker` متصل می‌شود. این role `BYPASSRLS` دارد تا عملیات cross-tenant بررسی‌شده و backup منطقی را انجام دهد، اما database owner نیست، DDL/role creation ندارد و DML آن به allow-list صریح lifecycle/auth/platform محدود است. `DATABASE_ADMIN_URL` و secretهای restore/MFA/audit نباید وارد این process شوند.

```bash
# Official production path: the container runs the JavaScript artifact emitted
# by scripts/prepare-runtime-closures.mjs; TypeScript source is never executed
# inside the long-running production image.
./deploy/linux-stack.sh up
./deploy/linux-stack.sh logs platform-worker

# A one-shot source-tree drill is a developer/operator command only and requires
# the locked development dependencies; production certification uses the image.
pnpm platform:worker -- --once
```

Worker از claim با lease/heartbeat و **attempt fencing** استفاده می‌کند؛ هر heartbeat، complete، retry و terminal transition باید شماره attempt همان claim را داشته باشد، بنابراین worker قدیمی پس از lease expiry نمی‌تواند state attempt جدید را تغییر دهد. jobهای `running` رهاشده با audit proof پایدار reconcile می‌شوند، تعداد retry محدود است و credential رمز‌شده فقط تا زمانی نگه داشته می‌شود که retry ممکن باشد؛ در همه stateهای terminal شامل completed/failed/cancelled credential و proof session از payload حذف می‌شوند. Startup خود process و preflight هر دو همان runtime-policy مشترک را اجرا می‌کنند تا دورزدن preflight باعث اجرای worker با credential نامعتبر نشود. UI فقط error code پالایش‌شده را می‌بیند و جزئیات exception در log محدود worker می‌ماند.

## Backup / Restore

`.env.operations.example` را فقط در محیط عملیاتی بارگذاری کنید. `BACKUP_ENCRYPTION_KEYS` باید یک keyring JSON از کلیدهای ۳۲‌بایتی (هر کلید به‌صورت ۶۴ کاراکتر hex) باشد و `BACKUP_ACTIVE_KEY_ID` کلید فعال را مشخص کند.

```bash
pnpm backup:create
pnpm backup:verify -- --file /var/lib/univ-web/backups/univ-web-....dump.enc.json
PLATFORM_RESTORE_ALLOWED=YES pnpm backup:restore -- --file /var/lib/univ-web/backups/univ-web-....dump.enc.json --confirm RESTORE:<database-name>
# فقط وقتی sourceTarget امضاشده در manifest با مقصد PostgreSQL فرق دارد:
PLATFORM_RESTORE_ALLOWED=YES PLATFORM_CROSS_TARGET_RESTORE=YES pnpm backup:restore -- --file /var/lib/univ-web/backups/univ-web-....dump.enc.json --confirm RESTORE:<database-name> --confirm-source <signed-source-target>
```

Backup به فرمت PostgreSQL custom تولید، سپس با AES-256-GCM رمز و SHA-256 ثبت می‌شود. manifest نام archive متناظر، HMAC و checksum را به‌صورت fail-closed اعتبارسنجی می‌کند و manifest نقش commit marker نسل را دارد. `BACKUP_OFFSITE_DIR` در صورت تنظیم، pair رمز‌شده را با publication اتمیک mirror می‌کند. `BACKUP_KEEP_DAILY`، `BACKUP_KEEP_WEEKLY` و `BACKUP_KEEP_MONTHLY` سیاست نگهداری روزانه/هفتگی/ماهانه را تعیین می‌کنند و همان retention روی mirror خارج از میزبان نیز اعمال می‌شود. اگر catalog محلی یا off-site شامل manifest/archive خراب، checksum mismatch، orphan یا replica گمشده باشد، retention fail-closed می‌شود و نسل سالم دیگری را حذف نمی‌کند. Rekey نیز copy-on-write است: نسل جدید ابتدا کامل، verify و در صورت پیکربندی off-site publish می‌شود و فقط بعد نسل قدیمی retire می‌شود. Archive ACLها را حفظ می‌کند؛ Restore نیز پس از بازیابی، همان allow-list مرکزی جدول‌ها و توابع `app` برای `univ_app_web` را دوباره اعمال و privilege contract را بررسی می‌کند. در target تازه ابتدا role امن Web را با `node scripts/db.mjs role` ایجاد کنید؛ Restore عمداً password این role را تغییر نمی‌دهد. Restore فقط پس از checksum، احراز tag رمزنگاری و HMAC کل manifest، تأیید ساختار archive با `pg_restore --list`، confirmation نام دیتابیس و توقف همه اتصال‌های client اجرا می‌شود. اگر target قابلیت اختیاری `pg_stat_statements` را نصب نکرده باشد، restore entryهای همان extension را از TOC موقت کنار می‌گذارد و migration/diagnostics وضعیت نبودن آن را شفاف نگه می‌دارد؛ extensionهای دیگر همچنان fail-closed هستند. هویت امضاشده‌ی `sourceTarget` شامل host/port/database است؛ انتقال به هر target متفاوت نیازمند opt-in و تأیید صریح همان مقدار است. `PLATFORM_RESTORE_ALLOWED=YES` فقط برای همان shell/job بازیابی تنظیم شود و هرگز در Web environment قرار نگیرد.

`DR_REPORT_DIR=/var/lib/univ-web/dr-reports` را روی یک volume پایدار نگه دارید تا رکوردهای rehearsal با بازسازی container از بین نروند.

CI یک restore drill واقعی روی PostgreSQL 18 اجرا می‌کند: backup، mutation عمدی، restore، بازگشت داده و production privilege check. این تست جایگزین disaster-recovery rehearsal زیرساخت نیست؛ در production همچنان از snapshot/PITR سرویس دیتابیس استفاده و restore دوره‌ای را در محیط جدا واقعاً آزمایش کنید.

### Rotation کلیدهای Backup و MFA

Backupهای جدید با `BACKUP_ACTIVE_KEY_ID` نوشته می‌شوند و keyring در `BACKUP_ENCRYPTION_KEYS` نگهداری می‌شود. برای تعویض کلید، کلید قدیمی را تا پایان rekey/retention حذف نکنید:

```bash
pnpm backup:rekey -- --file /var/lib/univ-web/backups/univ-web-....dump.enc.json
MFA_ROTATION_CONFIRM=ROTATE_MFA_KEYS pnpm mfa:rotate
```

`MFA_ENCRYPTION_KEYS` باید هم کلید active و هم کلیدهای تاریخی لازم برای decrypt envelopeهای قبلی را تا پایان rotation نگه دارد. پس از اجرای `mfa:rotate` و تأیید ورود کاربران، کلید بازنشسته را طبق سیاست نگهداری حذف کنید.

### Object-storage lifecycle reconciliation

فایل‌های browser-upload ابتدا در namespace quarantine قرار می‌گیرند. برای هر objectی که ممکن است قبل از commit نهایی DB ایجاد شود، یک `storage.reconcile` job پایدار از قبل ثبت می‌شود. worker هنگام حذف، candidate key را دوباره در برابر tenant/resource namespace معتبر می‌کند و وضعیت DB را منبع حقیقت می‌گیرد؛ بنابراین crash بین object-store و DB، upload رهاشده، promotion شکست‌خورده یا cancel نباید object یتیم دائمی بسازد. cleanup maintenance به active بودن tenant وابسته نیست تا suspend/archive شدن tenant مانع جمع‌آوری artifactهای orphan نشود.

### Export worker

Exportهای حجیم در Web request تولید نمی‌شوند. Web job را enqueue می‌کند و tenant worker جداگانه با `DATABASE_WORKER_URL` + `DATABASE_URL` آن را claim می‌کند. `DATABASE_WORKER_URL` باید role محدود `univ_job_worker` باشد؛ owner-level `DATABASE_ADMIN_URL` نباید در محیط این worker وجود داشته باشد. `EXPORT_JOB_DIR` باید یک مسیر private و مشترک بین Web و worker باشد (مثلاً volume مشترک)، با backup عمومی یا web-server static اشتباه نشود. Worker هنگام اجرای job دوباره lifecycle/capability درخواست‌کننده را بررسی می‌کند، lease را با heartbeat تازه نگه می‌دارد و فایل را ابتدا به‌صورت partial و سپس با rename اتمیک منتشر می‌کند؛ بنابراین revoke شدن دسترسی بعد از enqueue یا crash وسط export نباید artifact قابل‌دانلود باقی بگذارد.

```bash
pnpm job:worker
# برای health/drill یا اجرای scheduler یک‌مرحله‌ای:
pnpm job:worker -- --once
```

worker باید به‌صورت یک service/scheduler مستقل اجرا شود؛ Web process نباید credential مدیریتی worker را دریافت کند. artifactها hash می‌شوند، مدت محدود دارند و download دوباره مجوز فعلی کاربر را بررسی می‌کند.

### Audit seal خارج از DB

برای tamper-evidence، کلید `AUDIT_SEAL_KEY` مستقل از PostgreSQL و فایل‌های seal در `AUDIT_SEAL_DIR` خارج از دیتابیس نگهداری شوند. هر روز کامل UTC را پس از پایان آن seal کنید و زنجیره را verify کنید:

```bash
pnpm audit:seal:create -- --date 2026-09-03
pnpm audit:seal:verify -- --date 2026-09-03
```

فایل‌های seal باید خارج از میزبان دیتابیس نیز mirror/immutable شوند؛ HMAC در همان DB ذخیره‌شده به‌تنهایی tamper-evidence مستقل ایجاد نمی‌کند.

## ساخت بسته‌ی سورس portable

برای release سورس، از بسته‌بند allow-list استفاده کنید تا `.run-*`، auth state، trace/screenshot، `.univ`, `.next`, `node_modules`، secretهای `.env` و dump/keyها وارد archive نشوند:

```bash
pnpm check:source-package
pnpm source:package
```

`package-source.mjs` یک ZIP deterministic با pathهای استاندارد `/` می‌سازد و دات‌فایل‌های مجاز مانند `.github` و templateهای `.env.*.example` را نیز بدون wildcard مبهم وارد archive می‌کند.

## انتشار

1. backup قابل‌بازیابی ایجاد و verify کنید.
2. migration و سپس `db:setup` را از job privileged اجرا کنید.
3. Web preflight و DB privilege check را اجرا کنید.
4. image را build و deploy کنید.
5. `GET /api/healthz` را برای liveness و `GET /api/readyz` را برای readiness از ingress بررسی کنید.
6. integration/E2E و smoke test release را اجرا کنید.

در checkout توسعه، commandهای `production:db-check`، `production:worker-check` و
`production:platform-worker-check` profileهای محلی متناظر را فقط برای همان preflight
بارگذاری می‌کنند. در سرور، envهای process یا فایل‌های credential مدیریت‌شده‌ی لینوکس
اولویت دارند و هیچ‌کدام از این فایل‌ها وارد Web runtime نمی‌شوند.

## Network

PostgreSQL و credentialهای عملیاتی هرگز عمومی نمی‌شوند. TLS روی ingress الزامی است و URL تولید PostgreSQL با `sslmode=verify-full` اجرا می‌شود.

## Rollback

rollback کد با image قبلی انجام می‌شود. migrationهای اجراشده immutable هستند و اصلاح schema با forward migration انجام می‌شود؛ restore کامل فقط روی runbook عملیاتی و پس از تأیید صریح انجام شود.


## Linux runtime credential split

در استقرار لینوکسی چهار دامنهٔ credential جدا استفاده می‌شود: `.env.production.example` برای Web، `.env.worker.example` برای tenant job worker، `.env.platform-worker.example` برای Platform worker دائمی با حداقل secretهای لازم، و `.env.operations.example` فقط برای migration/setup/restore/rotation و سایر عملیات یک‌باره. `db:setup` هر سه role زمان اجرا (`univ_app_web`، `univ_job_worker` و `univ_platform_worker`) را می‌سازد/rotate می‌کند و policyهای canonical هر سه را اعمال می‌کند. سرویس `operations` در Compose پشت profile `tools` است و با `docker compose up` بالا نمی‌آید. برای جزئیات مسیرها، Compose و systemd به `docs/linux-deployment.md` مراجعه کنید.
