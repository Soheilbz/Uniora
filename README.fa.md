# Univ Web

سامانهٔ چندمستأجری مدیریت پژوهش و امور دانشگاهی بر پایهٔ **Next.js، PostgreSQL 18، Drizzle ORM و RLS اجباری PostgreSQL**.

**نسخهٔ جاری: 0.8.2**

این پروژه همچنان یک **Modular Monolith** است. مرز امنیتی tenant در PostgreSQL نگه داشته شده و قابلیت‌هایی مانند workflow، اسناد، jobهای durable، API و integration، portal، audit و عملیات Platform روی همین هسته ساخته شده‌اند.

## پیش‌نیازها

- Node.js 24.20.0 یا جدیدتر در شاخهٔ پشتیبانی‌شدهٔ 24.x
- pnpm 11.21.0
- PostgreSQL 18
- Linux تنها هدف رسمی توسعه، production و release certification است

## راه‌اندازی محلی

برای checkout تازه مسیر اصلی و تکرارشونده این است:

```bash
pnpm setup:local
pnpm local:status
```

`setup:local` فقط
اگر فایل‌های محلی وجود نداشته باشند آن‌ها را با credentialهای تصادفیِ مخصوص توسعه می‌سازد، سپس
PostgreSQL محلی، migration، roleهای runtime، seed و سرور Web را آماده می‌کند. برای آماده‌سازی
فقط دیتابیس از `pnpm setup:local --no-dev` استفاده کنید. این مسیر ابتدا از toolchain کامل PostgreSQL
در `.univ/toolchain/postgres` و در صورت نبودن آن از نصب PostgreSQL 18 که با `pg_config --bindir`
پیدا می‌شود استفاده می‌کند؛ نسخه یا binary ناقص را زود و روشن رد می‌کند. در bootstrap محلی یک حساب Platform با نام `operator` هم
ساخته می‌شود. در ساخت اولیه یا reset صریح، گذرواژه در فایل
`.univ/runtime/platform-operator-credentials.txt` با دسترسی فقط مالک ذخیره می‌شود و داخل خروجی
ترمینال یا لاگ CI چاپ نمی‌شود؛ فایل را فقط به‌صورت محلی بخوانید و قبل از اشتراک‌گذاری محیط آن را
تغییر دهید.
هر bootstrap همچنین دسترسی خصوصی `0700` را روی دایرکتوری‌های runtime، export و backup و دسترسی
`0600` را روی فایل‌های env دوباره اعمال می‌کند تا permission drift ترمیم شود.
اگر PostgreSQL به‌صورت managed در اختیار است، ابتدا هر دو
فایل env محلی را با credential و host واقعی تنظیم کنید و سپس `pnpm setup:local --external-db --no-dev`
را اجرا کنید؛ این حالت چرخهٔ عمر دیتابیس محلی را رد می‌کند و تنظیمات اتصال را تغییر نمی‌دهد.

برای مشاهده یا توقف stack از `pnpm local:status` و `pnpm local:stop` استفاده کنید؛ هم‌زمان با
`pnpm local:up` یک `pnpm dev` دوم اجرا نکنید. اگر ترمینال قطع شد، ابتدا status و سپس stop را اجرا
کنید. صفحهٔ ورود دانشگاه در `http://127.0.0.1:3020/sign-in` و صفحهٔ ورود اپراتور در
`http://127.0.0.1:3020/platform/sign-in` است؛ health و readiness نیز در `/api/healthz` و
`/api/readyz` در دسترس‌اند. object storage و scanner محلی فقط adapter توسعه هستند و وارد Compose
production نمی‌شوند. bootstrap پیش از migration همهٔ URLهای اتصال را از نظر host، port، database
و TLS مقایسه می‌کند و در صورت split-brain متوقف می‌شود.

Web فقط باید `DATABASE_URL` محدود با role `univ_app_web` را دریافت کند. tenant job worker از `DATABASE_WORKER_URL` با role جداگانه `univ_job_worker` استفاده می‌کند و داده‌های دامنه را همچنان از اتصال RLSدار Web می‌خواند. credentialهای database owner فقط در operations یک‌بارهٔ profile-gated برای migration/setup/restore مجازند و نباید وارد Web، tenant worker یا Platform worker دائمی شوند. استقرار Linux چهار دامنهٔ credential جدا دارد: Web، tenant worker، Platform worker دائمی و operations یک‌باره. Platform worker با وجود سطح دسترسی بالاتر، owner نیست و فقط زیرمجموعهٔ بازبینی‌شدهٔ secretهای عملیاتی را دریافت می‌کند؛ credentialهای role provisioning/MFA/audit/restore وارد process دائمی آن نمی‌شوند.

## آماده‌سازی نسخهٔ انتشار

`pnpm-lock.yaml` داخل بسته baseline بازبینی‌شدهٔ dependency graph نسخهٔ 0.8.2 است. certification نهایی باید آن را با pnpm پین‌شده روی Linux یا یک میزبان پشتیبانی‌شده refresh کند. `release:prepare` سپس هر tarball صریح npm registry را که SHA-512 integrity نداشته باشد رد می‌کند؛ مقدار SRI ساختگی هرگز نباید درج شود. هم‌زمان schema رسمی pluginهای Better Auth را reconcile کنید:

```bash
pnpm release:prepare
```

سپس release gate کامل را روی PostgreSQL 18 آزمایشی اجرا کنید:

```bash
pnpm release:audit
```

برای استقرار و release certification روی Linux: [docs/linux-deployment.md](docs/linux-deployment.md).

## ساختار اصلی

- `src/app` — routeها و boundaryهای Next.js
- `src/modules` — domain/application/query
- `src/components` — UI و engineهای مشترک
- `src/db` — schema و tenant-safe DB boundary
- `drizzle` — تاریخچهٔ immutable migration
- `db/sql` — policy/functionهای PostgreSQL
- `scripts` — ابزار release، worker، backup و عملیات
- `e2e` — تست‌های Playwright
- `docs` — معماری، استقرار، امنیت و ارتقا

## اصول غیرقابل‌مذاکره

1. دادهٔ tenant تحت Forced RLS است.
2. tenant context فقط داخل transaction تنظیم می‌شود.
3. admin/platform credential وارد request path عمومی نمی‌شود.
4. فایل دائمی در local `/uploads` یا PostgreSQL BLOB ذخیره نمی‌شود.
5. سند رسمی overwrite نمی‌شود؛ version/finalization دارد.
6. integrationهای حساس fail-closed هستند.
7. jobهای durable در صورت user-owned بودن، مجوز کاربر درخواست‌کننده را هنگام اجرا دوباره بررسی می‌کنند.

مستندات تکمیلی:

- [معماری](docs/architecture.md)
- [Production](docs/production.md)
- [امنیت](SECURITY.md)
- [Release](docs/release.md)
- [Drizzle migration](docs/drizzle-migrations.md)

- [سیاست زنجیره تأمین](docs/supply-chain-policy.md)
