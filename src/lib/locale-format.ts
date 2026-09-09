export function applicationLocale(locale: string): "en-US" | "fa-IR" {
  return locale === "en" ? "en-US" : "fa-IR";
}

export function createDateFormatter(
  locale: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
) {
  return new Intl.DateTimeFormat(applicationLocale(locale), options);
}

export function createDateTimeFormatter(locale: string) {
  return createDateFormatter(locale, { dateStyle: "medium", timeStyle: "short" });
}
