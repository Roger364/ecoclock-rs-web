import React, { useEffect, useRef, useState } from "react";
import { Check, Download, Edit3, RotateCcw, Save, Star, Upload } from "lucide-react";
import { HardwareProfile, PrivilegeLevel, Profile, ProfileSlotId, WorkloadMode } from "../types/hardware";
import { computeTelemetry, resolveEffectiveConfig } from "../engine/physics";
import { profileDisplayDescription, profileDisplayName } from "../data/profiles";
import { useLocale } from "../i18n";

interface ProfileBarProps {
  hardware: HardwareProfile;
  profiles: Profile[];
  activeSlot: ProfileSlotId;
  isDirty: boolean;
  bootEnabled: boolean;
  bootProfileId: ProfileSlotId;
  workload: WorkloadMode;
  privilege: PrivilegeLevel;
  onSelectSlot: (slot: ProfileSlotId) => void;
  onSaveCurrent: () => void;
  onRenameSlot: (slot: ProfileSlotId, newName: string) => void;
  onResetAllDefaults: () => void;
  onExportToml: () => void;
  onExportJson: () => void;
  onImportJson: (rawText: string) => void;
}

export const ProfileBar: React.FC<ProfileBarProps> = ({
  hardware,
  profiles,
  activeSlot,
  isDirty,
  bootEnabled,
  bootProfileId,
  workload,
  privilege,
  onSelectSlot,
  onSaveCurrent,
  onRenameSlot,
  onResetAllDefaults,
  onExportToml,
  onExportJson,
  onImportJson,
}) => {
  const { locale, t } = useLocale();
  const [editingSlot, setEditingSlot] = useState<ProfileSlotId | null>(null);
  const [draftName, setDraftName] = useState("");
  const [justSaved, setJustSaved] = useState(false);
  const savedTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current);
    };
  }, []);

  const activeProfile = profiles.find((p) => p.id === activeSlot)!;

  const commitRename = () => {
    if (editingSlot && draftName.trim()) {
      onRenameSlot(editingSlot, draftName.trim().slice(0, 32));
    }
    setEditingSlot(null);
  };

  const handleSave = () => {
    onSaveCurrent();
    setJustSaved(true);
    if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current);
    savedTimerRef.current = window.setTimeout(() => setJustSaved(false), 1600);
  };

  const handleFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || file.size > 512_000) return;
    file.text().then((text) => onImportJson(text)).catch(() => undefined);
  };

  return (
    <div className="bg-[#121720] border-b border-slate-800/90 px-4 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <span className="font-semibold uppercase tracking-wider text-slate-300">
            {t("5 Profils Retenus", "5 Selected Profiles")}
          </span>
          <span className="hidden sm:inline text-slate-600">·</span>
          <span className="hidden sm:inline font-mono text-[10.5px] text-slate-500">
            %APPDATA%\EcoClock\profiles.toml
          </span>
          {isDirty && (
            <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
              {t(`P${activeSlot} modifié (non enregistré)`, `P${activeSlot} modified (unsaved)`)}
            </span>
          )}
          {justSaved && (
            <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 inline-flex items-center gap-1">
              <Check className="w-3 h-3" /> {t("Enregistré", "Saved")}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {editingSlot === activeSlot ? (
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") setEditingSlot(null);
                }}
                autoFocus
                className="bg-[#0B0E14] border border-sky-500/60 rounded px-2 py-1 text-xs text-white w-44 focus:outline-none"
              />
              <button
                type="button"
                onClick={commitRename}
                className="px-2 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-medium cursor-pointer"
              >
                OK
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setDraftName(activeProfile.name);
                setEditingSlot(activeSlot);
              }}
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/70 text-[11px] text-slate-300 transition-colors cursor-pointer"
              title={t("Renommer le profil actif", "Rename the active profile")}
            >
              <Edit3 className="w-3 h-3" />
              <span className="hidden md:inline">{t("Renommer", "Rename")} P{activeSlot}</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleSave}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium border transition-colors cursor-pointer ${
              isDirty
                ? "bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500"
                : "bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 border-slate-700/70"
            }`}
            title={t(
              "Sauvegarder les réglages actuels dans l'emplacement P actif (écriture atomique)",
              "Save the current settings into the active P slot (atomic write)"
            )}
          >
            <Save className="w-3 h-3" />
            <span>{t("Sauver", "Save")} P{activeSlot}</span>
          </button>

          <button
            type="button"
            onClick={onExportToml}
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/70 text-[11px] text-slate-300 transition-colors cursor-pointer"
            title={t(
              "Exporter les 5 profils au format TOML natif (%APPDATA%\\EcoClock\\profiles.toml)",
              "Export the 5 profiles as native TOML (%APPDATA%\\EcoClock\\profiles.toml)"
            )}
          >
            <Download className="w-3 h-3" />
            <span className="hidden sm:inline">.toml</span>
          </button>

          <button
            type="button"
            onClick={onExportJson}
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/70 text-[11px] text-slate-300 transition-colors cursor-pointer"
            title={t(
              "Sauvegarder les 5 profils + autostart + règles du mode intelligent en JSON",
              "Save the 5 profiles + autostart + smart-mode rules as JSON"
            )}
          >
            <Download className="w-3 h-3 text-sky-400" />
            <span className="hidden md:inline">.json</span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json,.toml,text/plain"
            onChange={handleFilePicked}
            className="hidden"
            aria-label={t("Importer une sauvegarde JSON ou profiles.toml", "Import a JSON backup or profiles.toml")}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/70 text-[11px] text-slate-300 transition-colors cursor-pointer"
            title={t(
              "Importer et valider une sauvegarde .json ou un fichier profiles.toml (Rust)",
              "Import and validate a .json backup or a profiles.toml file (Rust)"
            )}
            aria-label={t("Importer des profils JSON ou TOML", "Import JSON or TOML profiles")}
          >
            <Upload className="w-3 h-3 text-emerald-400" />
          </button>

          <button
            type="button"
            onClick={onResetAllDefaults}
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/70 text-[11px] text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
            title={t("Réinitialiser les 5 profils d'usine", "Reset the 5 factory profiles")}
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Grille des 5 profils */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {profiles.map((p) => {
          const isActive = p.id === activeSlot;
          const isBoot = bootEnabled && p.id === bootProfileId;
          const eff = resolveEffectiveConfig(p.config, privilege);
          const snap = computeTelemetry(eff, workload, undefined, 0, hardware);

          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelectSlot(p.id)}
              title={profileDisplayDescription(p, locale)}
              className={`group relative rounded-lg px-2.5 py-2 border text-left transition-all cursor-pointer ${
                isActive
                  ? "bg-emerald-500/12 border-emerald-500/60 shadow-sm shadow-emerald-950/50"
                  : "bg-[#171C26] border-slate-800 hover:border-slate-600/80 hover:bg-[#1B222E]"
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <span
                  className={`font-mono text-[10.5px] font-bold px-1.5 py-0.2 rounded ${
                    isActive
                      ? "bg-emerald-500 text-slate-950"
                      : "bg-slate-800 text-slate-400 group-hover:text-slate-200"
                  }`}
                >
                  P{p.id}
                  {isActive && isDirty ? "*" : ""}
                </span>
                <div className="flex items-center gap-1">
                  {isBoot && (
                    <span
                      className="inline-flex items-center gap-0.5 text-[9.5px] font-medium text-amber-300 bg-amber-500/15 border border-amber-500/30 px-1 rounded"
                      title={t(
                        "Profil appliqué automatiquement au démarrage de Windows",
                        "Profile applied automatically at Windows startup"
                      )}
                    >
                      <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" />
                      Boot
                    </span>
                  )}
                  <span className="font-mono text-[11px] font-semibold text-slate-200 tabular-nums">
                    {snap.totalSystemWatts.toFixed(0)}W
                  </span>
                </div>
              </div>
              <div
                className={`text-xs font-medium truncate mt-1 ${
                  isActive ? "text-white" : "text-slate-300"
                }`}
              >
                {profileDisplayName(p, locale)}
              </div>
              <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mt-0.5 tabular-nums">
                <span
                  title={t(
                    "Plafond PROCFREQMAX : repère mesuré sur Ryzen 9 5900X (3 300 et 2 000 MHz y donnent le même résultat)",
                    "PROCFREQMAX cap: measured on Ryzen 9 5900X (3,300 and 2,000 MHz give the same result there)"
                  )}
                >≤{(p.config.cpuFreqCapMhz / 1000).toFixed(1)}GHz</span>
                <span>{snap.cpuTempC.toFixed(0)}°C</span>
                <span>{snap.systemNoiseDba.toFixed(0)}dB</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
