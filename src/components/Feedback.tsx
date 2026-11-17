import React, { useRef } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Keyboard,
  Info,
  RotateCcw,
  ShieldAlert,
  X,
} from "lucide-react";
import { useModalFocusTrap } from "../hooks/useModalFocusTrap";

export interface ToastData {
  id: string;
  message: string;
  detail?: string;
  tone: "success" | "info" | "warning" | "error";
  undoable?: boolean;
  action?: { label: string; run: () => void };
}

interface ToastProps {
  toasts: ToastData[];
  onDismiss: (id: string) => void;
  onUndo: () => void;
}

const TONE = {
  success: {
    wrap: "border-emerald-500/40 bg-[#11201B]",
    icon: <CheckCircle2 className="w-4 h-4 text-emerald-400" />,
    title: "text-emerald-200",
  },
  info: {
    wrap: "border-sky-500/40 bg-[#101B24]",
    icon: <Info className="w-4 h-4 text-sky-400" />,
    title: "text-sky-200",
  },
  warning: {
    wrap: "border-amber-500/40 bg-[#211B0F]",
    icon: <AlertTriangle className="w-4 h-4 text-amber-400" />,
    title: "text-amber-200",
  },
  error: {
    wrap: "border-rose-500/40 bg-[#241214]",
    icon: <ShieldAlert className="w-4 h-4 text-rose-400" />,
    title: "text-rose-200",
  },
};

export const ToastStack: React.FC<ToastProps> = ({ toasts, onDismiss, onUndo }) => (
  <div
    className="fixed bottom-3 right-3 z-[60] w-[min(360px,calc(100vw-24px))] space-y-2 pointer-events-none"
    aria-live="polite"
    aria-atomic="false"
  >
    {toasts.map((toast) => {
      const tone = TONE[toast.tone];
      return (
        <div
          key={toast.id}
          className={`pointer-events-auto rounded-lg border px-3 py-2.5 shadow-xl shadow-black/60 backdrop-blur-sm ${tone.wrap}`}
          role="status"
        >
          <div className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0">{tone.icon}</span>
            <div className="min-w-0 flex-1">
              <p className={`text-[11.5px] font-medium leading-snug ${tone.title}`}>{toast.message}</p>
              {toast.detail && (
                <p className="text-[10.5px] text-slate-400 mt-0.5 leading-snug">{toast.detail}</p>
              )}
              {toast.action && (
                <button
                  type="button"
                  onClick={() => {
                    toast.action?.run();
                    onDismiss(toast.id);
                  }}
                  className="mt-1.5 mr-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-semibold cursor-pointer"
                >
                  {toast.action.label}
                </button>
              )}
              {toast.undoable && (
                <button
                  type="button"
                  onClick={() => {
                    onUndo();
                    onDismiss(toast.id);
                  }}
                  className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-[10px] text-slate-200 font-medium cursor-pointer"
                >
                  <RotateCcw className="w-2.5 h-2.5" /> Annuler (Ctrl+Z)
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="Fermer la notification"
              className="text-slate-500 hover:text-slate-200 p-0.5 rounded shrink-0 cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      );
    })}
  </div>
);

interface ShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: "1 … 5", label: "Sélectionner le profil P1 à P5 (met l'auto en pause temporaire)" },
  { keys: "Ctrl / ⌘ + S", label: "Sauvegarder la configuration dans le profil actif" },
  { keys: "Ctrl / ⌘ + Z", label: "Annuler la dernière action (Undo)" },
  { keys: "Ctrl / ⌘ + Y", label: "Rétablir l'action annulée (Redo)" },
  { keys: "T", label: "Activer / désactiver toutes les infobulles techniques" },
  { keys: "A", label: "Ouvrir le panneau Mode intelligent" },
  { keys: "B", label: "Exécuter le micro-benchmark réel et recalibrer" },
  { keys: "P", label: "Mettre en pause / reprendre la télémétrie 1 Hz" },
  { keys: "M", label: "Changer de matériel de référence" },
  { keys: "Échap", label: "Fermer une fenêtre, une infobulle épinglée ou ce panneau" },
  { keys: "?", label: "Afficher / masquer cette aide clavier" },
];

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ open, onClose }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(open, dialogRef);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-md rounded-xl border border-slate-700 bg-[#141922] shadow-2xl overflow-hidden outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-800 bg-[#181F2B] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Keyboard className="w-4 h-4 text-sky-400" />
            <h2 id="shortcuts-title" className="text-sm font-semibold text-slate-100">
              Raccourcis clavier
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer l'aide clavier"
            className="text-slate-400 hover:text-white p-1 rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-1.5">
          {SHORTCUTS.map((s) => (
            <div
              key={s.keys}
              className="flex items-center justify-between gap-3 px-2.5 py-1.5 rounded bg-[#0F131B] border border-slate-800"
            >
              <span className="text-[11.5px] text-slate-300">{s.label}</span>
              <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 border border-slate-600 whitespace-nowrap">
                {s.keys}
              </kbd>
            </div>
          ))}
          <p className="text-[10px] text-slate-500 pt-1">
            Les raccourcis à une lettre sont ignorés pendant la saisie dans un champ de texte.
          </p>
        </div>
      </div>
    </div>
  );
};
