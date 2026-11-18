import React, { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Info,
  Lock,
  ShieldAlert,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { PrivilegeLevel, ValidationIssue } from "../types/hardware";
import { auditScore, countBySeverity } from "../engine/validation";
import { TechTooltip } from "./TechTooltip";
import { useLocale } from "../i18n";

interface SafetyAuditPanelProps {
  issues: ValidationIssue[];
  privilege: PrivilegeLevel;
  onFix: (issue: ValidationIssue) => void;
  onFixAll: () => void;
  onRequestAdmin: () => void;
  dense?: boolean;
}

const SEVERITY_STYLE: Record<
  ValidationIssue["severity"],
  { label: string; labelEn: string; chip: string; icon: React.ReactNode; dot: string }
> = {
  critical: {
    label: "Critique",
    labelEn: "Critical",
    chip: "bg-rose-500/15 text-rose-300 border-rose-500/35",
    icon: <ShieldAlert className="w-3.5 h-3.5" />,
    dot: "bg-rose-400",
  },
  warning: {
    label: "Attention",
    labelEn: "Warning",
    chip: "bg-amber-500/15 text-amber-300 border-amber-500/35",
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
    dot: "bg-amber-400",
  },
  info: {
    label: "Suggestion",
    labelEn: "Suggestion",
    chip: "bg-sky-500/15 text-sky-300 border-sky-500/35",
    icon: <Info className="w-3.5 h-3.5" />,
    dot: "bg-sky-400",
  },
};

export const SafetyAuditPanel: React.FC<SafetyAuditPanelProps> = ({
  issues,
  privilege,
  onFix,
  onFixAll,
  onRequestAdmin,
  dense = false,
}) => {
  const { locale, t } = useLocale();
  const SUBSYSTEM_EN: Record<string, string> = {
    Affichage: "Display",
    "Affichage / GPU": "Display / GPU",
    Réseau: "Network",
    "Noyau NT": "NT kernel",
  };
  const [openId, setOpenId] = useState<string | null>(null);
  const score = auditScore(issues);
  const counts = countBySeverity(issues);
  const fixable = issues.filter((i) => i.fix);
  const scoreColor = score >= 88 ? "text-emerald-400" : score >= 65 ? "text-amber-300" : "text-rose-400";
  const ringColor = score >= 88 ? "stroke-emerald-400" : score >= 65 ? "stroke-amber-400" : "stroke-rose-400";

  return (
    <section
      aria-labelledby="safety-audit-title"
      className="rounded-xl border border-slate-800 bg-[#141922] overflow-hidden"
    >
      <div className="px-3.5 py-2.5 bg-[#10151E] border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <h2 id="safety-audit-title" className="text-xs font-semibold text-slate-100">
            <TechTooltip tooltipKey="rollback_guard">
              <span>{t("Audit de cohérence & de sûreté avant application", "Consistency & safety audit before applying")}</span>
            </TechTooltip>
          </h2>
          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
            {t(
              `${issues.length} constat${issues.length > 1 ? "s" : ""}`,
              `${issues.length} finding${issues.length > 1 ? "s" : ""}`
            )}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-1.5 text-[10px] font-mono">
            <span className="text-rose-300">{counts.critical} {t("crit.", "crit.")}</span>
            <span className="text-amber-300">{counts.warning} {t("att.", "warn.")}</span>
            <span className="text-sky-300">{counts.info} {t("sugg.", "sugg.")}</span>
          </div>
          {fixable.length > 0 && (
            <button
              type="button"
              onClick={onFixAll}
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold transition-colors cursor-pointer"
            >
              <Wrench className="w-3 h-3" />
              {t("Corriger tout", "Fix all")} ({fixable.length})
            </button>
          )}
        </div>
      </div>

      <div className="p-3.5 grid grid-cols-1 lg:grid-cols-12 gap-3">
        {/* Score */}
        <div className="lg:col-span-3 flex lg:flex-col items-center justify-center gap-3 rounded-lg bg-[#0F131B] border border-slate-800 p-3">
          <div className="relative w-16 h-16 shrink-0">
            <svg viewBox="0 0 64 64" className="w-16 h-16 -rotate-90">
              <circle cx="32" cy="32" r="27" fill="none" stroke="#1E2633" strokeWidth="6" />
              <circle
                cx="32"
                cy="32"
                r="27"
                fill="none"
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={`${(score / 100) * 169.6} 169.6`}
                className={ringColor}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`font-mono text-sm font-bold ${scoreColor}`}>{score}</span>
              <span className="text-[8.5px] text-slate-500">/100</span>
            </div>
          </div>
          <div className="text-center lg:text-left">
            <div className="text-[11px] font-semibold text-slate-200">{t("Indice de sûreté", "Safety score")}</div>
            <p className="text-[10px] text-slate-400 leading-snug max-w-[150px]">
              {score >= 88
                ? t("Configuration sûre et cohérente.", "Safe and consistent configuration.")
                : score >= 65
                ? t("À corriger avant de sauvegarder ce profil.", "Fix this before saving the profile.")
                : t("Risque réel : ne pas appliquer en l'état.", "Real risk: do not apply as is.")}
            </p>
            {privilege === "user" && (
              <button
                type="button"
                onClick={onRequestAdmin}
                className="mt-1 inline-flex items-center gap-1 text-[10px] text-amber-300 hover:text-amber-200 underline underline-offset-2 cursor-pointer"
              >
                <Lock className="w-2.5 h-2.5" /> {t("Élever en Admin", "Elevate to Admin")}
              </button>
            )}
          </div>
        </div>

        {/* Liste des constats */}
        <div className="lg:col-span-9 space-y-1.5">
          {issues.length === 0 ? (
            <div className="h-full min-h-[92px] flex flex-col items-center justify-center rounded-lg bg-emerald-950/25 border border-emerald-500/25 p-3 text-center">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 mb-1" />
              <p className="text-[11.5px] font-medium text-emerald-200">{t("Aucune anomalie détectée.", "No issue detected.")}</p>
              <p className="text-[10.5px] text-emerald-100/70">
                {t(
                  "Valeurs dans les bornes constructeur, aucun conflit de charge ni de privilège.",
                  "Values within vendor limits, no workload or privilege conflict."
                )}
              </p>
            </div>
          ) : (
            issues.slice(0, dense ? 3 : 30).map((issue) => {
              const style = SEVERITY_STYLE[issue.severity];
              const expanded = openId === issue.id;
              return (
                <div
                  key={issue.id}
                  className="rounded-lg bg-[#0F131B] border border-slate-800/90 overflow-hidden"
                >
                  <div className="flex items-center gap-2 px-2.5 py-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}`} aria-hidden="true" />
                    <span
                      className={`hidden sm:inline-flex items-center gap-1 text-[9.5px] font-semibold px-1.5 py-0.5 rounded border shrink-0 ${style.chip}`}
                    >
                      {style.icon}
                      {t(style.label, style.labelEn)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setOpenId(expanded ? null : issue.id)}
                      aria-expanded={expanded}
                      aria-controls={`issue-${issue.id}`}
                      className="flex-1 min-w-0 text-left text-[11.5px] text-slate-200 hover:text-white inline-flex items-center gap-1 cursor-pointer"
                    >
                      {expanded ? (
                        <ChevronDown className="w-3 h-3 text-slate-500 shrink-0" />
                      ) : (
                        <ChevronRight className="w-3 h-3 text-slate-500 shrink-0" />
                      )}
                      <span className="truncate">{locale !== "fr" ? issue.titleEn : issue.title}</span>
                      <span className="hidden md:inline text-[10px] text-slate-500 shrink-0">
                        · {locale !== "fr" ? SUBSYSTEM_EN[issue.subsystem] ?? issue.subsystem : issue.subsystem}
                      </span>
                    </button>
                    {issue.fix ? (
                      <button
                        type="button"
                        onClick={() => onFix(issue)}
                        className="px-2 py-0.5 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/35 text-emerald-300 text-[10px] font-medium shrink-0 transition-colors cursor-pointer"
                      >
                        {locale !== "fr"
                          ? issue.fixLabelEn ?? t("Corriger", "Fix")
                          : issue.fixLabel ?? t("Corriger", "Fix")}
                      </button>
                    ) : issue.id === "admin-pending" ? (
                      <button
                        type="button"
                        onClick={onRequestAdmin}
                        className="px-2 py-0.5 rounded bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/35 text-amber-300 text-[10px] font-medium shrink-0 cursor-pointer"
                      >
                        {locale !== "fr" ? issue.fixLabelEn ?? "UAC" : issue.fixLabel ?? "UAC"}
                      </button>
                    ) : null}
                  </div>
                  {expanded && (
                    <div
                      id={`issue-${issue.id}`}
                      className="px-3 pb-2 pt-0.5 text-[10.5px] text-slate-400 space-y-1 border-t border-slate-800/70"
                    >
                      <p className="text-slate-300">{locale !== "fr" ? issue.detailEn : issue.detail}</p>
                      <p>
                        <strong className="text-slate-400">{t("Conséquence :", "Impact:")}</strong>{" "}
                        {locale !== "fr" ? issue.consequenceEn : issue.consequence}
                      </p>
                    </div>
                  )}
                </div>
              );
            })
          )}
          {dense && issues.length > 3 && (
            <p className="text-[10px] text-slate-500 pl-1">
              {t(
                `+${issues.length - 3} autres constats visibles dans l'onglet Audit & Plan.`,
                `+${issues.length - 3} more findings in the Audit & Plan tab.`
              )}
            </p>
          )}
        </div>
      </div>
    </section>
  );
};
