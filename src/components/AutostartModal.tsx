import React, { useRef } from "react";
import { Lock, Power, ShieldCheck, Star, Terminal, X } from "lucide-react";
import { AutostartConfig, PrivilegeLevel, Profile, ProfileSlotId } from "../types/hardware";
import { useModalFocusTrap } from "../hooks/useModalFocusTrap";

interface AutostartModalProps {
  open: boolean;
  config: AutostartConfig;
  profiles: Profile[];
  privilege: PrivilegeLevel;
  onChange: (next: AutostartConfig) => void;
  onRequestAdmin: () => void;
  onClose: () => void;
}

export const AutostartModal: React.FC<AutostartModalProps> = ({
  open,
  config,
  profiles,
  privilege,
  onChange,
  onRequestAdmin,
  onClose,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(open, dialogRef);

  if (!open) return null;

  const isAdmin = privilege === "admin";
  const trayArg = config.startMinimizedToTray ? " --tray" : " --boot";
  const delayMin = String(Math.floor(config.safeBootDelaySec / 60)).padStart(2, "0");
  const delaySec = String(config.safeBootDelaySec % 60).padStart(2, "0");
  const generatedCommand =
    config.method === "task_scheduler_admin" && isAdmin
      ? `schtasks /Create /TN "EcoClock\\Autostart" /TR "\\"C:\\Program Files\\EcoClock\\ecoclock.exe\\" --apply-profile ${config.bootProfileId}${trayArg}" /SC ONLOGON /RL HIGHEST /DELAY 00${delayMin}:${delaySec} /F`
      : `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\EcoClockRs = "C:\\Program Files\\EcoClock\\ecoclock.exe" --apply-profile ${config.bootProfileId}${trayArg}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="autostart-modal-title"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-lg max-h-[calc(100vh-2rem)] overflow-y-auto rounded-xl border border-slate-700 bg-[#141922] shadow-2xl outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-800 bg-[#181F2B] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Power className="w-4 h-4 text-emerald-400" />
            <h3 id="autostart-modal-title" className="text-sm font-semibold text-slate-100">
              Démarrage avec Windows & Garde-fous de Sécurité
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer la configuration du démarrage automatique"
            className="text-slate-400 hover:text-white p-1 rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 text-xs">
          {/* Toggle principal */}
          <label className="flex items-center justify-between p-3 rounded-lg bg-[#0F131A] border border-slate-800 cursor-pointer">
            <div>
              <div className="font-semibold text-slate-100">
                Lancer EcoClock-rs à l'ouverture de session Windows
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                Temps de démarrage : ~6,8 ms · Empreinte RAM en systray : 4,6 Mo
              </div>
            </div>
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => onChange({ ...config, enabled: e.target.checked })}
              className="w-4 h-4 accent-emerald-500 cursor-pointer"
            />
          </label>

          {/* Choix du profil de boot parmi les 5 */}
          <div className="space-y-1.5">
            <label className="font-semibold text-slate-200 flex items-center gap-1.5">
              <Star className="w-3.5 h-3.5 text-amber-400" />
              Profil appliqué automatiquement au démarrage (1 sur 5 retenus) :
            </label>
            <div className="grid grid-cols-1 gap-1.5">
              {profiles.map((p) => {
                const selected = config.bootProfileId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onChange({ ...config, bootProfileId: p.id as ProfileSlotId })}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg border text-left transition-colors cursor-pointer ${
                      selected
                        ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-200"
                        : "bg-[#0F131A] border-slate-800 text-slate-300 hover:border-slate-700"
                    }`}
                  >
                    <span className="font-medium">
                      <span className="font-mono text-[11px] opacity-75 mr-2">P{p.id}</span>
                      {p.name}
                    </span>
                    <span className="text-[10.5px] font-mono px-1.5 py-0.5 rounded bg-slate-800/90 text-slate-300">
                      CPU {p.config.cpuFreqCapMhz} MHz · {p.config.displayRefreshHz} Hz
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Méthode d'intégration Windows */}
          <div className="space-y-1.5">
            <div className="font-semibold text-slate-200">Méthode d'enregistrement Windows :</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onChange({ ...config, method: "hkcu_registry" })}
                className={`p-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                  config.method === "hkcu_registry"
                    ? "bg-emerald-500/15 border-emerald-500/50"
                    : "bg-[#0F131A] border-slate-800 hover:border-slate-700"
                }`}
              >
                <div className="font-semibold text-slate-100">Clé Registre HKCU (User)</div>
                <div className="text-[10.5px] text-slate-400 mt-0.5">
                  Zéro droit Admin requis. Applique CPU, Turbo, EPP, C-States, EcoQoS & Hz.
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (!isAdmin) {
                    onRequestAdmin();
                    return;
                  }
                  onChange({ ...config, method: "task_scheduler_admin" });
                }}
                className={`p-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                  config.method === "task_scheduler_admin" && isAdmin
                    ? "bg-amber-500/15 border-amber-500/50"
                    : "bg-[#0F131A] border-slate-800 hover:border-slate-700"
                }`}
              >
                <div className="font-semibold text-slate-100 flex items-center gap-1">
                  {!isAdmin && <Lock className="w-3 h-3 text-amber-400" />}
                  Tâche Planifiée (Admin)
                </div>
                <div className="text-[10.5px] text-slate-400 mt-0.5">
                  RunLevel Highest : applique aussi GPU NVML & NVMe PS4 sans popup UAC au boot !
                </div>
              </button>
            </div>
          </div>

          {/* Options de sûreté */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="flex items-center gap-2 p-2.5 rounded-lg bg-[#0F131A] border border-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={config.startMinimizedToTray}
                onChange={(e) => onChange({ ...config, startMinimizedToTray: e.target.checked })}
                className="accent-emerald-500"
              />
              <span className="text-[11px] text-slate-300">Réduire en zone de notification (--tray)</span>
            </label>

            <label className="flex items-center gap-2 p-2.5 rounded-lg bg-[#0F131A] border border-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={config.restoreOnShutdown}
                onChange={(e) => onChange({ ...config, restoreOnShutdown: e.target.checked })}
                className="accent-emerald-500"
              />
              <span className="text-[11px] text-slate-300">RollbackGuard à l'arrêt / fermeture</span>
            </label>
          </div>

          <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-[#0F131A] border border-slate-800">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="text-[11px] text-slate-300">
                Délai Safe-Boot anti-boucle : <strong className="font-mono text-white">{config.safeBootDelaySec} s</strong>
              </span>
            </div>
            <input
              type="range"
              min={5}
              max={45}
              step={5}
              value={config.safeBootDelaySec}
              onChange={(e) => onChange({ ...config, safeBootDelaySec: Number(e.target.value) })}
              className="eco-slider w-28"
            />
          </div>

          {/* Commande exacte écrite */}
          <div className="rounded-lg bg-[#0B0E14] border border-slate-800 p-2.5">
            <div className="flex items-center gap-1.5 text-[10.5px] text-sky-400 mb-1">
              <Terminal className="w-3.5 h-3.5" />
              <span>Entrée système exacte synchronisée par src/platform/autostart.rs :</span>
            </div>
            <code className="text-[10.5px] text-slate-300 break-all block leading-relaxed">
              {config.enabled ? generatedCommand : "(Aucune entrée registre ni tâche planifiée — autostart désactivé)"}
            </code>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition-colors cursor-pointer"
            >
              Valider & Synchroniser
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
