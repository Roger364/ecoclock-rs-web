import { useEffect, useRef } from "react";
import { ProfileSlotId } from "../types/hardware";

export interface ShortcutHandlers {
  hasModalOpen: boolean;
  onCloseTopModal: () => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSelectSlot: (slot: ProfileSlotId) => void;
  onRunBench: () => void;
  onToggleLive: () => void;
  onToggleTooltips: () => void;
  onOpenAdaptive: () => void;
  onOpenHardware: () => void;
  onToggleShortcuts: () => void;
}

/**
 * Écouteur clavier global attaché UNE SEULE fois au montage (via ref stable),
 * évitant tout réabonnement inutile à chaque tick télémétrique de 1 Hz.
 */
export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const h = ref.current;
      const target = event.target as HTMLElement | null;
      const isEditing =
        !!target &&
        (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) || target.isContentEditable);

      if (event.key === "Escape") {
        if (h.hasModalOpen) {
          event.preventDefault();
          h.onCloseTopModal();
        }
        return;
      }

      if (h.hasModalOpen) return;

      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toLowerCase();
        if (key === "s") {
          event.preventDefault();
          h.onSave();
        } else if (key === "z" && event.shiftKey) {
          event.preventDefault();
          h.onRedo();
        } else if (key === "z") {
          event.preventDefault();
          h.onUndo();
        } else if (key === "y") {
          event.preventDefault();
          h.onRedo();
        }
        return;
      }

      if (isEditing || event.altKey) return;

      if (/^[1-5]$/.test(event.key)) {
        h.onSelectSlot(Number(event.key) as ProfileSlotId);
        return;
      }

      const lower = event.key.toLowerCase();
      if (lower === "b") h.onRunBench();
      else if (lower === "p") h.onToggleLive();
      else if (lower === "t") h.onToggleTooltips();
      else if (lower === "a") h.onOpenAdaptive();
      else if (lower === "m") h.onOpenHardware();
      else if (event.key === "?" || event.key === "/") h.onToggleShortcuts();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
