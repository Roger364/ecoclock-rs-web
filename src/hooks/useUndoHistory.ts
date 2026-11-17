import { useCallback, useRef, useState } from "react";

export interface HistoryEntry<T> {
  label: string;
  snapshot: T;
}

/**
 * Pile d'annulation & de rétablissement (Undo / Redo) pure, compatible React StrictMode,
 * avec déduplication automatique lors du glissement continu d'un curseur (< 1 200 ms).
 */
export function useUndoHistory<T>(maxDepth = 25) {
  const [past, setPast] = useState<HistoryEntry<T>[]>([]);
  const [future, setFuture] = useState<HistoryEntry<T>[]>([]);
  const lastPushRef = useRef<{ label: string; at: number } | null>(null);

  const record = useCallback(
    (label: string, snapshot: T) => {
      const now = Date.now();
      const prev = lastPushRef.current;
      setFuture([]);
      if (prev && prev.label === label && now - prev.at < 1200) {
        lastPushRef.current = { label, at: now };
        return;
      }
      lastPushRef.current = { label, at: now };
      setPast((stack) => [...stack.slice(-(maxDepth - 1)), { label, snapshot }]);
    },
    [maxDepth]
  );

  const undo = useCallback(
    (currentSnapshot: T): HistoryEntry<T> | null => {
      const last = past[past.length - 1];
      if (!last) return null;
      lastPushRef.current = null;
      setPast(past.slice(0, -1));
      setFuture((f) => [...f.slice(-(maxDepth - 1)), { label: last.label, snapshot: currentSnapshot }]);
      return last;
    },
    [past, maxDepth]
  );

  const redo = useCallback(
    (currentSnapshot: T): HistoryEntry<T> | null => {
      const next = future[future.length - 1];
      if (!next) return null;
      lastPushRef.current = null;
      setFuture(future.slice(0, -1));
      setPast((p) => [...p.slice(-(maxDepth - 1)), { label: next.label, snapshot: currentSnapshot }]);
      return next;
    },
    [future, maxDepth]
  );

  return {
    past,
    future,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    lastUndoLabel: past[past.length - 1]?.label ?? null,
    lastRedoLabel: future[future.length - 1]?.label ?? null,
    record,
    undo,
    redo,
  };
}
