import React from "react";
import { Languages } from "lucide-react";
import { Locale, useLocale } from "../i18n";

export const LanguageToggle: React.FC = () => {
  const { locale, setLocale, t } = useLocale();
  const options: { id: Locale; label: string }[] = [
    { id: "fr", label: "FR" },
    { id: "en", label: "EN" },
  ];

  return (
    <div
      className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/70 px-1 py-0.5"
      role="group"
      aria-label={t("Langue de l'interface", "Interface language")}
      title={t(
        "Basculer l'interface entre français et anglais (les vues d'analyse restent en français)",
        "Switch the interface between French and English (analysis views remain in French)"
      )}
    >
      <Languages className="w-3.5 h-3.5 text-slate-400 ml-0.5" aria-hidden="true" />
      {options.map((option) => {
        const active = locale === option.id;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            onClick={() => setLocale(option.id)}
            className={`px-1.5 py-0.5 rounded text-[10.5px] font-semibold transition-colors cursor-pointer ${
              active ? "bg-slate-600 text-white" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
};
