export const DEFAULT_LOCALE = "en-US";
export const SUPPORTED_LOCALES = [DEFAULT_LOCALE] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export type DateInput = Date | string | number | null | undefined;

interface FormatConfig {
  fallback?: string;
  locale?: string;
}

export const DATE_FORMATS = {
  shortDate: {
    month: "short",
    day: "numeric",
  },
  mediumDate: {
    year: "numeric",
    month: "short",
    day: "numeric",
  },
  dateTime: {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  },
  dateTimeWithSeconds: {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  },
  shortTime: {
    hour: "2-digit",
    minute: "2-digit",
  },
  heroClockDate: {
    weekday: "long",
    month: "long",
    day: "numeric",
  },
  heroClockTime: {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const numberFormatters = new Map<string, Intl.NumberFormat>();
const pluralRules = new Map<string, Intl.PluralRules>();

export function resolveLocale(candidates?: readonly string[] | null): SupportedLocale {
  const requested = candidates ?? browserLocales();

  for (const candidate of requested) {
    const locale = toSupportedLocale(candidate);
    if (locale) return locale;
  }

  return DEFAULT_LOCALE;
}

export function formatDate(
  value: DateInput,
  options: Intl.DateTimeFormatOptions = DATE_FORMATS.mediumDate,
  config: FormatConfig = {},
): string {
  const date = toDate(value);
  if (!date) return config.fallback ?? "—";

  return getDateFormatter(config.locale ?? resolveLocale(), options).format(date);
}

export function formatShortDate(value: DateInput, config?: FormatConfig): string {
  return formatDate(value, DATE_FORMATS.shortDate, config);
}

export function formatMediumDate(value: DateInput, config?: FormatConfig): string {
  return formatDate(value, DATE_FORMATS.mediumDate, config);
}

export function formatDateTime(value: DateInput, config?: FormatConfig): string {
  return formatDate(value, DATE_FORMATS.dateTime, config);
}

export function formatDateTimeWithSeconds(value: DateInput, config?: FormatConfig): string {
  return formatDate(value, DATE_FORMATS.dateTimeWithSeconds, config);
}

export function formatShortTime(value: DateInput, config?: FormatConfig): string {
  return formatDate(value, DATE_FORMATS.shortTime, config);
}

export function formatHeroClock(value: DateInput, config: FormatConfig = {}): string {
  const date = toDate(value);
  if (!date) return config.fallback ?? "—";
  return `${formatDate(date, DATE_FORMATS.heroClockDate, config)} - ${formatDate(
    date,
    DATE_FORMATS.heroClockTime,
    config,
  )}`;
}

export function formatNumber(
  value: number | null | undefined,
  options: Intl.NumberFormatOptions = {},
  config: FormatConfig = {},
): string {
  if (value == null || !Number.isFinite(value)) return config.fallback ?? "—";
  return getNumberFormatter(config.locale ?? resolveLocale(), options).format(value);
}

export function formatInteger(value: number | null | undefined, config?: FormatConfig): string {
  return formatNumber(value, { maximumFractionDigits: 0 }, config);
}

export type PluralForms = {
  one: string;
  other: string;
  zero?: string;
  two?: string;
  few?: string;
  many?: string;
};

export interface PluralConfig extends FormatConfig {
  type?: Intl.PluralRulesOptions["type"];
}

/**
 * Locale-aware pluralization. Replaces ad-hoc `n === 1 ? "" : "s"` ternaries.
 * Pass forms keyed by CLDR plural category; falls back to `other` when the
 * locale's category isn't supplied. English only needs `one` + `other`.
 */
export function formatPlural(
  value: number | null | undefined,
  forms: PluralForms,
  config: PluralConfig = {},
): string {
  if (value == null || !Number.isFinite(value)) return forms.other;
  const locale = config.locale ?? resolveLocale();
  const category = getPluralRules(locale, { type: config.type ?? "cardinal" }).select(value);
  return forms[category as keyof PluralForms] ?? forms.other;
}

/**
 * Convenience for the common "{n} thing(s)" pattern. Formats `value` as an
 * integer and joins it to the locale-correct plural form with a space.
 */
export function formatCount(
  value: number | null | undefined,
  forms: PluralForms,
  config: PluralConfig = {},
): string {
  return `${formatInteger(value, config)} ${formatPlural(value, forms, config)}`;
}

export function formatCurrency(
  value: number | null | undefined,
  currency: string = "USD",
  options: Intl.NumberFormatOptions = {},
  config: FormatConfig = {},
): string {
  return formatNumber(
    value,
    {
      currency: currency.toUpperCase(),
      style: "currency",
      ...options,
    },
    config,
  );
}

function browserLocales(): string[] {
  if (typeof navigator === "undefined") return [];
  if (navigator.languages?.length) return [...navigator.languages];
  return navigator.language ? [navigator.language] : [];
}

function toSupportedLocale(candidate: string | null | undefined): SupportedLocale | null {
  if (!candidate) return null;

  const canonical = canonicalLocale(candidate);
  if (!canonical) return null;

  if (canonical === DEFAULT_LOCALE || canonical.startsWith("en-") || canonical === "en") {
    return DEFAULT_LOCALE;
  }

  return null;
}

function canonicalLocale(candidate: string): string | null {
  try {
    return Intl.getCanonicalLocales(candidate)[0] ?? null;
  } catch {
    return null;
  }
}

function toDate(value: DateInput): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getDateFormatter(
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = formatterKey(locale, options);
  const cached = dateFormatters.get(key);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat(locale, options);
  dateFormatters.set(key, formatter);
  return formatter;
}

function getPluralRules(locale: string, options: Intl.PluralRulesOptions): Intl.PluralRules {
  const key = formatterKey(locale, options as unknown as Intl.NumberFormatOptions);
  const cached = pluralRules.get(key);
  if (cached) return cached;

  const rules = new Intl.PluralRules(locale, options);
  pluralRules.set(key, rules);
  return rules;
}

function getNumberFormatter(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = formatterKey(locale, options);
  const cached = numberFormatters.get(key);
  if (cached) return cached;

  const formatter = new Intl.NumberFormat(locale, options);
  numberFormatters.set(key, formatter);
  return formatter;
}

function formatterKey(
  locale: string,
  options: Intl.DateTimeFormatOptions | Intl.NumberFormatOptions,
): string {
  return `${locale}:${JSON.stringify(Object.entries(options).sort())}`;
}
