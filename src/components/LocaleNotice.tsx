import React from "react";
import { Languages } from "lucide-react";
import { useLocale } from "../i18n";

/**
 * En mode anglais, les vues d'analyse pas encore traduites l'annoncent au lieu de
 * mélanger deux langues sans prévenir.
 */
export const LocaleNotice: React.FC = () => {
  const { locale, t } = useLocale();
  if (locale !== "en") return null;
  const message = t(
    "Cette vue d'analyse est encore en français. Les réglages, les profils et les dialogues sont traduits.",
    "This analysis view is still in French. Settings, profiles and dialogs are translated."
  );

  return (
    <div
      role="note"
      className="mb-3 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 flex items-start gap-2 text-[11px] text-sky-100"
    >
      <Languages className="w-3.5 h-3.5 text-sky-300 shrink-0 mt-0.5" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
};
