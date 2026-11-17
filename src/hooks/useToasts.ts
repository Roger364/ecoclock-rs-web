import { useCallback, useEffect, useRef, useState } from "react";
import { ToastData } from "../components/Feedback";

/**
 * Gestion propre de la pile de notifications temporaires :
 * chaque timer est suivi et nettoyé sur fermeture manuelle ou démontage du composant.
 */
export function useToasts() {
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const timersRef = useRef<Map<string, number>>(new Map());

  const dismissToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback(
    (
      tone: ToastData["tone"],
      message: string,
      detail?: string,
      undoable = false,
      action?: ToastData["action"]
    ) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const ttl = undoable || action ? 9000 : 4800;

      setToasts((prev) => {
        // Nettoie les timers des anciens toasts évincés au-delà de 3 éléments visibles
        const evicted = prev.slice(0, Math.max(0, prev.length - 2));
        for (const item of evicted) {
          const t = timersRef.current.get(item.id);
          if (t !== undefined) {
            window.clearTimeout(t);
            timersRef.current.delete(item.id);
          }
        }
        return [...prev.slice(-2), { id, tone, message, detail, undoable, action }];
      });

      const handle = window.setTimeout(() => {
        timersRef.current.delete(id);
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, ttl);
      timersRef.current.set(id, handle);
    },
    []
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((h) => window.clearTimeout(h));
      timers.clear();
    };
  }, []);

  return { toasts, pushToast, dismissToast };
}
