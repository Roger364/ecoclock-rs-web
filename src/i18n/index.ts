import { useCallback, useSyncExternalStore } from "react";

export type Locale = "fr" | "en" | "it" | "de";

export const LOCALES: Locale[] = ["fr", "en", "it", "de"];

const STORAGE_KEY = "ecoclock_rs_locale_v1";

function readStoredLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "en" || stored === "it" || stored === "de" ? stored : "fr";
  } catch {
    return "fr";
  }
}

let current: Locale = readStoredLocale();
const listeners = new Set<() => void>();

if (typeof document !== "undefined") {
  document.documentElement.lang = current;
}

export function getLocale(): Locale {
  return current;
}

export function setLocale(next: Locale): void {
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* quota / navigation privée : la langue reste valable pour la session */
  }
  if (typeof document !== "undefined") {
    document.documentElement.lang = next;
  }
  for (const listener of listeners) listener();
}

/** Traduction pure, utilisable hors React (moteur, exports). */
export function pick(locale: Locale, fr: string, en: string, it?: string, de?: string): string {
  if (locale === "fr") return fr;
  if (locale === "it") return it ?? en;
  if (locale === "de") return de ?? en;
  return en;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLocale(): {
  locale: Locale;
  t: (fr: string, en: string, it?: string, de?: string) => string;
  setLocale: (next: Locale) => void;
} {
  const locale = useSyncExternalStore(subscribe, getLocale, () => "fr" as Locale);
  const t = useCallback(
    (fr: string, en: string, it?: string, de?: string) => pick(locale, fr, en, it, de),
    [locale]
  );
  return { locale, t, setLocale };
}
