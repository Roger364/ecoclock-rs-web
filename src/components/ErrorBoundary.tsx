import React from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

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

    return (
      <div className="min-h-screen bg-[#0B0E13] text-slate-100 flex items-center justify-center p-4">
        <div
          role="alert"
          className="max-w-md w-full rounded-xl border border-rose-500/40 bg-[#141922] p-5 space-y-3 shadow-2xl"
        >
          <div className="flex items-center gap-2 text-rose-300">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <h1 className="text-sm font-semibold">Erreur inattendue interceptée (mode secours)</h1>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            L'interface a rencontré une exception et s'est mise en sécurité. Vous pouvez réessayer ou
            réinitialiser les préférences locales aux 5 profils d'usine.
          </p>
          <code className="block text-[10.5px] font-mono text-rose-200 bg-[#0B0E14] border border-slate-800 rounded p-2 break-all">
            {error.message || "Erreur d'exécution"}
          </code>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-100 cursor-pointer"
            >
              Réessayer
            </button>
            <button
              type="button"
              onClick={this.handleResetStorage}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Restaurer les profils d'usine
            </button>
          </div>
        </div>
      </div>
    );
  }
}
