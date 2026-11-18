import React, { useRef } from "react";
import { Check, Cpu, Gauge, HardDrive, Info, Monitor, ShieldCheck, X } from "lucide-react";
import { HardwareProfile } from "../types/hardware";
import { HARDWARE_PROFILES, hardwareDisplayLabel, hardwareDisplayNote } from "../data/hardwareProfiles";
import { useLocale } from "../i18n";
import { useModalFocusTrap } from "../hooks/useModalFocusTrap";

interface HardwareModalProps {
  open: boolean;
  current: HardwareProfile;
  onSelect: (profile: HardwareProfile) => void;
  onClose: () => void;
}

export const HardwareModal: React.FC<HardwareModalProps> = ({ open, current, onSelect, onClose }) => {
  const { locale, t } = useLocale();
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(open, dialogRef);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/75 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="hardware-modal-title"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-3xl my-4 rounded-xl border border-slate-700 bg-[#141922] shadow-2xl overflow-hidden outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-800 bg-[#181F2B] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-sky-400" />
            <h2 id="hardware-modal-title" className="text-sm font-semibold text-slate-100">
              {t("Matériel de référence & bornes constructeur", "Reference hardware & vendor limits")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("Fermer la fenêtre matériel", "Close the hardware window")}
            className="text-slate-400 hover:text-white p-1 rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="rounded-lg bg-sky-500/8 border border-sky-500/25 px-3 py-2 flex items-start gap-2">
            <Info className="w-3.5 h-3.5 text-sky-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-slate-300 leading-relaxed">
              {t(
                "Le binaire Rust lit ces caractéristiques via WMI (Win32_Processor), NVML (GetPowerManagementLimitConstraints) et EnumDisplaySettingsW. Dans cette interface de démonstration, choisissez le profil le plus proche : les curseurs et l'audit de sécurité seront bornés en conséquence.",
                "The Rust binary reads these characteristics through WMI (Win32_Processor), NVML (GetPowerManagementLimitConstraints) and EnumDisplaySettingsW. In this demo interface, pick the closest profile: sliders and the safety audit will be bounded accordingly."
              )}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {HARDWARE_PROFILES.map((profile) => {
              const active = profile.id === current.id;
              return (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => onSelect(profile)}
                  aria-pressed={active}
                  className={`text-left rounded-lg border p-3 transition-colors cursor-pointer ${
                    active
                      ? "bg-emerald-500/12 border-emerald-500/55"
                      : "bg-[#0F131B] border-slate-800 hover:border-slate-600"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-white">{hardwareDisplayLabel(profile, locale)}</span>
                    {active ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300">
                        <Check className="w-3 h-3" /> {t("Actif", "Active")}
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-500">{t("Choisir", "Choose")}</span>
                    )}
                  </div>

                  <div className="mt-1.5 space-y-1 font-mono text-[10px] text-slate-400">
                    <div className="flex items-center gap-1.5">
                      <Cpu className="w-3 h-3 text-sky-400 shrink-0" />
                      <span className="truncate text-slate-300">{profile.cpuName}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Gauge className="w-3 h-3 text-emerald-400 shrink-0" />
                      <span className="truncate text-slate-300">{profile.gpuName}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <HardDrive className="w-3 h-3 text-teal-400 shrink-0" />
                      <span className="truncate">{profile.storageName}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Monitor className="w-3 h-3 text-indigo-400 shrink-0" />
                      <span className="truncate">
                        {profile.monitorName} · max {profile.maxDisplayHz} Hz
                      </span>
                    </div>
                  </div>

                  <div className="mt-2 pt-2 border-t border-slate-800 grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono text-[9.5px] text-slate-400">
                    <span>Base/Turbo: {profile.cpuBaseMhz / 1000}–{profile.cpuTurboMhz / 1000} GHz</span>
                    <span>{t("Cœurs :", "Cores:")} {profile.cpuCores}</span>
                    <span>PL1 : {profile.cpuPl1MinW}–{profile.cpuPl1MaxW} W</span>
                    <span>GPU : {profile.gpuTdpW} W</span>
                    <span>{t("PL GPU min :", "GPU PL min:")} {profile.gpuMinPowerPct}%</span>
                    <span>Clock max : {profile.gpuMaxClockMhz} MHz</span>
                  </div>

                  <p className="mt-1.5 text-[10px] text-slate-500 leading-snug">{hardwareDisplayNote(profile, locale)}</p>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-1.5 text-[10.5px] text-slate-400">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              {t(
                "Le changement reborne automatiquement tous les réglages et ne modifie pas les 5 profils sauvegardés.",
                "Changing it automatically re-clamps every setting and leaves the 5 saved profiles untouched."
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
            >
              {t("Fermer", "Close")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
