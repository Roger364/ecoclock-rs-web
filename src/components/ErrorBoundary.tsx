import React from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { getLocale, pick } from "../i18n";

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Barrière de résilience React : intercepte toute erreur de rendu imprévue et propose
 * soit de recharger la vue, soit de purger les clés locales corrompues pour repartir sainement.
 */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  private handleResetStorage = () => {
    try {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith("ecoclock_rs_"));
      for (const k of keys) localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
    this.setState({ error: null });
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const locale = getLocale();
    const tr = (fr: string, en: string) => pick(locale, fr, en);

    return (
      <div className="min-h-screen bg-[#0B0E13] text-slate-100 flex items-center justify-center p-4">
        <div
          role="alert"
          className="max-w-md w-full rounded-xl border border-rose-500/40 bg-[#141922] p-5 space-y-3 shadow-2xl"
        >
          <div className="flex items-center gap-2 text-rose-300">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <h1 className="text-sm font-semibold">
              {tr("Erreur inattendue interceptée (mode secours)", "Unexpected error caught (safe mode)")}
            </h1>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            {tr(
              "L'interface a rencontré une exception et s'est mise en sécurité. Vous pouvez réessayer ou réinitialiser les préférences locales aux 5 profils d'usine.",
              "The interface hit an exception and switched to safe mode. You can retry or reset local preferences to the 5 factory profiles."
            )}
          </p>
          <code className="block text-[10.5px] font-mono text-rose-200 bg-[#0B0E14] border border-slate-800 rounded p-2 break-all">
            {error.message || tr("Erreur d'exécution", "Runtime error")}
          </code>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-100 cursor-pointer"
            >
              {tr("Réessayer", "Retry")}
            </button>
            <button
              type="button"
              onClick={this.handleResetStorage}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {tr("Restaurer les profils d'usine", "Restore factory profiles")}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
