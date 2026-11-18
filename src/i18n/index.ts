import { useCallback, useSyncExternalStore } from "react";

export type Locale = "fr" | "en";

const STORAGE_KEY = "ecoclock_rs_locale_v1";

function readStoredLocale(): Locale {
  try {
    return localStorage.getItem(STORAGE_KEY) === "en" ? "en" : "fr";
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
export function pick(locale: Locale, fr: string, en: string): string {
  return locale === "en" ? en : fr;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLocale(): {
  locale: Locale;
  t: (fr: string, en: string) => string;
  setLocale: (next: Locale) => void;
} {
  const locale = useSyncExternalStore(subscribe, getLocale, () => "fr" as Locale);
  const t = useCallback((fr: string, en: string) => pick(locale, fr, en), [locale]);
  return { locale, t, setLocale };
}
