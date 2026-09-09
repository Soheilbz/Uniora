"use client";

/**
 * The last catch: a fault thrown by the root layout itself.
 *
 * This file renders its own `<html>` because nothing above it survived —
 * which also means no provider, no catalogue, and no guarantee about which
 * language the reader was using. So the wording is written out in both
 * languages rather than resolved through i18n: an error screen that throws
 * while localising itself is worse than an honest bilingual one. The
 * direction is set to RTL with the English line left explicit, so a Persian
 * reader gets their layout back even here.
 */
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="fa" dir="rtl">
      <body
        style={{
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          background: "var(--background, #fff)",
          color: "var(--foreground, #111)",
        }}
      >
        <div style={{ textAlign: "center", padding: "2rem", maxWidth: "34rem" }}>
          <h1 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem" }}>
            خطایی رخ داد ·{" "}
            <span lang="en" dir="ltr">
              Something went wrong
            </span>
          </h1>
          <p style={{ fontSize: "0.875rem", opacity: 0.75, lineHeight: 1.8 }}>
            ایرادی پیش‌بینی‌نشده مانع اجرای سامانه شد. دوباره تلاش کنید و اگر مشکل ادامه داشت با
            پشتیبانی تماس بگیرید. /{" "}
            <span lang="en" dir="ltr">
              An unexpected fault stopped the application. Try again, and contact support if the
              problem continues.
            </span>
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1rem",
              padding: "0.5rem 1rem",
              borderRadius: "0.375rem",
              border: "1px solid var(--border, #ccc)",
              background: "var(--primary, #111)",
              color: "var(--primary-foreground, #fff)",
              cursor: "pointer",
              fontSize: "0.875rem",
            }}
          >
            تلاش دوباره ·{" "}
            <span lang="en" dir="ltr">
              Try again
            </span>
          </button>
        </div>
      </body>
    </html>
  );
}
