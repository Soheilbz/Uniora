"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setAppearance, setLocale } from "@/app/actions/appearance";
import { SettingRow, SettingsCard } from "@/components/settings/setting-row";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import type { Appearance, Brand, Density, FontScale } from "@/lib/appearance.ts";
import { writeLocaleCookie } from "@/lib/locale-cookie";
import { cn } from "@/lib/utils";

/**
 * The display preferences, as a screen.
 *
 * ── Why the theme behaves differently from the other four ───────────────────
 *
 * The theme is a class on `<html>` and changes nothing the server rendered, so
 * `next-themes` flips it in the browser with no round trip. The other four
 * decide what the *server* writes onto the document element — and the language
 * decides which catalogue it substituted — so each is a cookie and a re-render.
 * A client-side language toggle would mean shipping both catalogues to every
 * reader and a visible flash of the wrong one on load.
 */

const THEMES = ["light", "dark", "system"] as const;

const BRAND_COLORS: Record<Brand, string> = {
  default: "oklch(0.555 0.163 48.998)",
  blue: "oklch(0.51 0.17 258)",
  teal: "oklch(0.5 0.1 195)",
  violet: "oklch(0.5 0.19 295)",
  rose: "oklch(0.52 0.19 15)",
  amber: "oklch(0.58 0.14 70)",
};

export function AppearanceSettings({
  appearance,
  locale,
  brands,
  densities,
  scales,
  t,
}: {
  appearance: Appearance;
  locale: string;
  brands: readonly Brand[];
  densities: readonly Density[];
  scales: readonly FontScale[];
  t: Record<string, string>;
}) {
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const choose = (field: keyof Appearance, value: string) =>
    startTransition(async () => {
      await setAppearance(field, value);
      window.location.reload();
    });

  return (
    <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
      <SettingsCard title={t.title ?? ""} description={t.subtitle}>
        <SettingRow
          label={t.theme ?? ""}
          control={
            <Choices
              current={theme ?? "system"}
              options={THEMES.map((value) => ({ value, label: t[`theme.${value}`] ?? value }))}
              onChoose={(value) => {
                if (value === "light" || value === "dark" || value === "system") setTheme(value);
              }}
            />
          }
        />

        <SettingRow
          label={t.brand ?? ""}
          control={
            <div className="flex flex-wrap items-center gap-2">
              {brands.map((brand) => {
                const isSelected = appearance.brand === brand;
                const color = BRAND_COLORS[brand] ?? "var(--primary)";
                return (
                  <button
                    key={brand}
                    type="button"
                    disabled={pending}
                    onClick={() => choose("brand", brand)}
                    aria-pressed={isSelected}
                    aria-label={t[`brand.${brand}`] ?? brand}
                    title={t[`brand.${brand}`] ?? brand}
                    className={cn(
                      "group relative flex size-8 items-center justify-center rounded-xl border-2 transition-all shadow-2xs",
                      isSelected
                        ? "border-foreground ring-2 ring-primary/40 scale-105"
                        : "border-border/80 hover:border-foreground/40 hover:scale-105",
                    )}
                  >
                    <span
                      className="size-5 rounded-lg shadow-2xs transition-transform"
                      style={{ backgroundColor: color }}
                    />
                    {isSelected && (
                      <Check className="absolute size-3.5 text-white drop-shadow-md" />
                    )}
                  </button>
                );
              })}
            </div>
          }
        />

        <SettingRow
          label={t.density ?? ""}
          hint={t.densityHint}
          control={
            <Choices
              current={appearance.density}
              options={densities.map((value) => ({
                value,
                label: t[`density.${value}`] ?? value,
              }))}
              onChoose={(value) => choose("density", value)}
              disabled={pending}
            />
          }
        />

        <SettingRow
          label={t.fontScale ?? ""}
          control={
            <Choices
              current={appearance.fontScale}
              options={scales.map((value) => ({ value, label: scaleLabel(value, t) }))}
              onChoose={(value) => choose("fontScale", value)}
              disabled={pending}
            />
          }
        />

        {/* Live Font & Density Sample Preview */}
        <div className="mt-2 rounded-xl border border-border/60 bg-muted/20 p-3">
          <span className="text-[11px] font-bold text-muted-foreground">{t.previewTitle}</span>
          <p className="text-xs text-foreground font-medium mt-1 leading-relaxed">
            {t.previewText}
          </p>
        </div>
      </SettingsCard>

      <SettingsCard title={t.localeTitle ?? ""} description={t.localeSubtitle}>
        <SettingRow
          label={t.language ?? ""}
          control={
            <Choices
              current={locale}
              options={[
                { value: "fa", label: t.languageFa ?? "Persian" },
                { value: "en", label: t.languageEn ?? "English" },
              ]}
              onChoose={(value) =>
                startTransition(async () => {
                  if (value !== "fa" && value !== "en") return;
                  writeLocaleCookie(value);
                  await setLocale(value);
                  router.refresh();
                })
              }
              disabled={pending}
            />
          }
        />
        <SettingRow
          label={t.dateFormat ?? ""}
          hint={t.dateFormatHint}
          control={
            <div className="flex items-center gap-2">
              <span className="rounded-md border border-border/70 bg-card px-2.5 py-1 text-xs font-semibold text-foreground shadow-2xs">
                {locale === "fa" ? t["date.jalali"] : t["date.gregorian"]}
              </span>
            </div>
          }
        />
        <p className="mt-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          {t.syncNote}
        </p>
      </SettingsCard>
    </div>
  );
}

/**
 * A row of mutually exclusive choices.
 *
 * Buttons with `aria-pressed` rather than a select: there are two to four of
 * them, they are all worth seeing at once, and the current one is the answer to
 * "what is this set to" — which a closed menu hides.
 */
function Choices({
  current,
  options,
  onChoose,
  disabled,
}: {
  current: string;
  options: { value: string; label: string }[];
  onChoose: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((option) => {
        const chosen = option.value === current;
        return (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={chosen ? "default" : "outline"}
            aria-pressed={chosen}
            disabled={disabled}
            onClick={() => onChoose(option.value)}
          >
            {chosen && <Check className="size-3.5" aria-hidden />}
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}

/** «کوچک‌تر», «معمولی», «بزرگ‌تر» — and the two steps between them as a ratio. */
function scaleLabel(value: FontScale, t: Record<string, string>): string {
  if (value === "1") return t.fontScaleNormal ?? value;
  if (value === "0.9") return t.smaller ?? value;
  if (value === "1.1") return t.larger ?? value;
  return `${t.larger ?? ""}+`;
}
