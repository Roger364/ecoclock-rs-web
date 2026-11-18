import React, { useRef } from "react";
import { CheckCircle2, ShieldAlert, Terminal, X } from "lucide-react";
import { ProfileSlotId } from "../types/hardware";
import { useModalFocusTrap } from "../hooks/useModalFocusTrap";
import { useLocale } from "../i18n";

interface UacModalProps {
  open: boolean;
  activeSlot: ProfileSlotId;
  unlockedExtraWatts: number;
  onApprove: () => void;
  onCancel: () => void;
}

export const UacModal: React.FC<UacModalProps> = ({
  open,
  activeSlot,
  unlockedExtraWatts,
  onApprove,
  onCancel,
}) => {
  const { t } = useLocale();
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(open, dialogRef);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="uac-modal-title"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-md rounded-xl border border-amber-500/40 bg-[#141922] shadow-2xl overflow-hidden outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Bandeau UAC authentique Windows 11 */}
        <div className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-amber-300">
            <ShieldAlert className="w-5 h-5" />
            <span className="text-xs font-semibold tracking-wide">
              {t("Contrôle de compte d'utilisateur Windows (UAC)", "Windows User Account Control (UAC)")}
            </span>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label={t("Refuser et fermer la fenêtre UAC", "Decline and close the UAC window")}
            className="text-slate-400 hover:text-white p-1 rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3.5">
          <div>
            <h3 id="uac-modal-title" className="text-sm font-semibold text-white leading-snug">
              {t(
                "Autoriser EcoClock-rs à relancer une instance élevée pour piloter les limites matérielles ?",
                "Allow EcoClock-rs to relaunch an elevated instance to control hardware limits?"
              )}
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              {t("Éditeur :", "Publisher:")}{" "}
              <span className="text-slate-200">
                {t(
                  "EcoClock Open-Source (Safe Rust · 0 pilote noyau Ring-0)",
                  "EcoClock Open-Source (Safe Rust · 0 Ring-0 kernel driver)"
                )}
              </span>
            </p>
          </div>

          <div className="rounded-lg bg-[#0C1016] border border-slate-800 p-2.5 space-y-1">
            <div className="flex items-center gap-1.5 text-[10.5px] text-sky-400 font-medium">
              <Terminal className="w-3.5 h-3.5" />
              <span>Appel Win32 : ShellExecuteExW(lpVerb = L"runas")</span>
            </div>
            <code className="text-[11px] text-slate-300 block break-all">
              "C:\Program Files\EcoClock\ecoclock.exe" --apply-profile {activeSlot}
            </code>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-200">
                {t("Leviers débloqués par le jeton Administrateur :", "Levers unlocked by the Administrator token:")}
              </span>
              {unlockedExtraWatts > 0.5 && (
                <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  {t(
                    `-${unlockedExtraWatts.toFixed(1)} W immédiats sur P${activeSlot}`,
                    `-${unlockedExtraWatts.toFixed(1)} W immediately on P${activeSlot}`
                  )}
                </span>
              )}
            </div>
            <ul className="text-[11.5px] text-slate-300 space-y-1">
              {[
                {
                  fr: "NVML GPU : Power Management Limit (% TDP), Core Clock Lock & VRAM P8",
                  en: "NVML GPU: Power Management Limit (% TDP), Core Clock Lock & VRAM P8",
                },
                {
                  fr: "Stockage : Veille autonome NVMe APST (PS3/PS4 5 mW) & SATA DIPM Slumber",
                  en: "Storage: autonomous NVMe APST idle (PS3/PS4 5 mW) & SATA DIPM Slumber",
                },
                {
                  fr: "CPU & Bus : Enveloppe RAPL PL1 (Watts), Core Parking & sous-états PCIe L1.2",
                  en: "CPU & bus: RAPL PL1 envelope (watts), Core Parking & PCIe L1.2 substates",
                },
                {
                  fr: "Réseau & Boot : Ethernet IEEE 802.3az EEE & Tâche Planifiée au boot sans UAC",
                  en: "Network & boot: IEEE 802.3az EEE Ethernet & scheduled task at boot without UAC",
                },
              ].map((item) => (
                <li key={item.fr} className="flex items-start gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <span>{t(item.fr, item.en)}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid grid-cols-2 gap-2.5 pt-1">
            <button
              type="button"
              onClick={onApprove}
              className="px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs transition-colors cursor-pointer"
            >
              {t("Oui (Élever en Admin)", "Yes (elevate to Admin)")}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs border border-slate-700 transition-colors cursor-pointer"
            >
              {t("Non (Rester en User)", "No (stay in User mode)")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
