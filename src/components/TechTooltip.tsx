import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Cpu, HelpCircle, Lock, Pin, ShieldCheck, Terminal, X, Zap } from "lucide-react";
import { TOOLTIPS } from "../data/tooltips";
import { useTooltipsEnabled } from "../store/settings";
import { useLocale } from "../i18n";

interface TechTooltipProps {
  tooltipKey: string;
  children?: React.ReactNode;
  showIcon?: boolean;
  className?: string;
  extraBeforeAfter?: string;
}

export const TechTooltip: React.FC<TechTooltipProps> = ({
  tooltipKey,
  children,
  showIcon = true,
  className = "",
  extraBeforeAfter,
}) => {
  const { locale, t } = useLocale();
  const doc = TOOLTIPS[tooltipKey];
  const tooltipsOn = useTooltipsEnabled();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);

  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    maxH: number;
    placeAbove: boolean;
  }>({
    top: 0,
    left: 0,
    maxH: 480,
    placeAbove: false,
  });

  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = Math.min(440, window.innerWidth - 24);
    const estHeight = 360;

    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(12, Math.min(window.innerWidth - width - 12, left));

    const spaceBelow = window.innerHeight - rect.bottom - 20;
    const spaceAbove = rect.top - 20;
    const placeAbove = spaceBelow < estHeight && spaceAbove > spaceBelow;
    const top = placeAbove ? Math.max(12, rect.top - 8) : rect.bottom + 8;
    const avail = placeAbove ? spaceAbove : spaceBelow;
    const maxH = Math.max(180, Math.min(520, avail));

    setCoords({ top, left, maxH, placeAbove });
  }, []);

  const clearCloseTimer = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const handleEnter = () => {
    clearCloseTimer();
    updatePosition();
    setOpen(true);
  };

  const handleLeave = () => {
    if (pinned) return;
    clearCloseTimer();
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
    }, 130);
  };

  const handleTogglePin = (e: React.MouseEvent) => {
    e.stopPropagation();
    updatePosition();
    if (pinned) {
      setPinned(false);
      setOpen(false);
    } else {
      setPinned(true);
      setOpen(true);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => updatePosition();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPinned(false);
        setOpen(false);
      }
    };
    const onOutsideClick = (e: MouseEvent) => {
      if (!pinned) return;
      const target = e.target as Node;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        setPinned(false);
        setOpen(false);
      }
    };

    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onOutsideClick);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onOutsideClick);
    };
  }, [open, pinned, updatePosition]);

  // Ferme et désépingle proprement toute infobulle ouverte si l'utilisateur coupe le toggle global
  useEffect(() => {
    if (!tooltipsOn) {
      clearCloseTimer();
      setPinned(false);
      setOpen(false);
    }
  }, [tooltipsOn]);

  useEffect(() => {
    return () => clearCloseTimer();
  }, []);

  // Infobulles désactivées globalement : le contenu reste lisible, sans déclencheur ni portail
  if (!doc || !tooltipsOn) {
    return <span className={className}>{children}</span>;
  }

  const privBadge =
    doc.privilege === "user"
      ? {
          label: t("Mode User (sans UAC)", "User mode (no UAC)"),
          cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
        }
      : doc.privilege === "admin"
      ? {
          label: t("Droits Admin (UAC)", "Admin rights (UAC)"),
          cls: "bg-amber-500/15 text-amber-300 border-amber-500/30",
        }
      : {
          label: t("User + Admin étendu", "User + extended Admin"),
          cls: "bg-sky-500/15 text-sky-300 border-sky-500/30",
        };

  return (
    <>
      <span
        ref={triggerRef}
        tabIndex={!showIcon && children ? 0 : undefined}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        onFocus={!showIcon ? handleEnter : undefined}
        onBlur={!showIcon ? () => !pinned && handleLeave() : undefined}
        onKeyDown={
          !showIcon
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  updatePosition();
                  setPinned((prev) => {
                    const next = !prev;
                    setOpen(next);
                    return next;
                  });
                }
              }
            : undefined
        }
        className={`inline-flex items-center gap-1.5 ${
          children ? "decoration-dotted decoration-slate-500/70 underline-offset-4 hover:underline cursor-help" : ""
        } ${className}`}
      >
        {children}
        {showIcon && (
          <button
            type="button"
            onClick={handleTogglePin}
            onFocus={handleEnter}
            onBlur={() => {
              if (!pinned) handleLeave();
            }}
            aria-label={t(`Infobulle détaillée : ${doc.title}`, `Detailed tooltip: ${doc.title}`)}
            aria-expanded={open}
            aria-haspopup="dialog"
            className={`inline-flex items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 ${
              pinned
                ? "text-emerald-300 bg-emerald-500/20 ring-1 ring-emerald-400/50"
                : "text-slate-400 hover:text-sky-300"
            }`}
          >
            <HelpCircle className="w-3.5 h-3.5 shrink-0" />
          </button>
        )}
      </span>

      {open &&
        createPortal(
          <div
            ref={popoverRef}
            onMouseEnter={handleEnter}
            onMouseLeave={handleLeave}
            style={{
              position: "fixed",
              top: coords.top,
              left: coords.left,
              transform: coords.placeAbove ? "translateY(-100%)" : "none",
              width: "min(440px, calc(100vw - 24px))",
              maxHeight: `${coords.maxH}px`,
              zIndex: 9999,
            }}
            role="dialog"
            aria-label={t(`Documentation technique : ${doc.title}`, `Technical documentation: ${doc.title}`)}
            className="overflow-y-auto rounded-lg border border-slate-600/80 bg-[#11161F]/98 shadow-2xl shadow-black/80 backdrop-blur-md text-left animate-in fade-in duration-100"
          >
            {/* Header */}
            <div className="px-3.5 py-2.5 border-b border-slate-700/70 bg-[#161D29] flex items-start justify-between gap-2">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                    {doc.subsystem}
                  </span>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border inline-flex items-center gap-1 ${privBadge.cls}`}>
                    {doc.privilege === "admin" && <Lock className="w-2.5 h-2.5" />}
                    {privBadge.label}
                  </span>
                </div>
                <h4 className="text-xs font-semibold text-slate-100 leading-snug">{doc.title}</h4>
              </div>
              {pinned ? (
                <button
                  type="button"
                  onClick={() => {
                    setPinned(false);
                    setOpen(false);
                  }}
                  className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700/60"
                  title={t("Fermer l'infobulle épinglée", "Close pinned tooltip")}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              ) : (
                <span className="text-[10px] text-slate-500 inline-flex items-center gap-0.5 shrink-0 pt-0.5">
                  <Pin className="w-2.5 h-2.5" /> {t("clic ?", "click?")}
                </span>
              )}
            </div>

            {/* Body */}
            <div className="p-3.5 space-y-2.5 text-[11.5px] leading-relaxed text-slate-300">
              {locale === "en" && (
                <p className="rounded border border-sky-500/25 bg-sky-500/10 px-2 py-1 text-[10px] text-sky-100">
                  {t(
                    "Documentation technique encore en français.",
                    "Technical documentation is still in French."
                  )}
                </p>
              )}
              {/* Win32 API */}
              <div className="rounded bg-[#0B0E14] border border-slate-800 px-2.5 py-1.5">
                <div className="flex items-center gap-1.5 text-[10px] font-medium text-sky-400 mb-0.5">
                  <Terminal className="w-3 h-3" />
                  <span>{t("API Windows / Registre matériel piloté par Rust", "Windows API / hardware registry driven by Rust")}</span>
                </div>
                <code className="text-[10.5px] text-slate-300 break-all block leading-snug">
                  {doc.winApi}
                </code>
              </div>

              {/* Explication fonctionnelle */}
              <p className="text-slate-200">{doc.summary}</p>

              {/* Physique du silicium */}
              <div className="rounded bg-slate-800/45 border border-slate-700/60 px-2.5 py-2">
                <div className="flex items-center gap-1.5 text-[10.5px] font-semibold text-slate-200 mb-0.5">
                  <Cpu className="w-3 h-3 text-sky-400" />
                  <span>{t("Fonctionnement bas niveau & Loi physique", "Low-level behavior & physical law")}</span>
                </div>
                <p className="text-[11px] text-slate-300">{doc.physicsDetail}</p>
              </div>

              {/* Impact Avant -> Après */}
              <div className="rounded bg-emerald-950/35 border border-emerald-500/25 px-2.5 py-2">
                <div className="flex items-center gap-1.5 text-[10.5px] font-semibold text-emerald-300 mb-0.5">
                  <Zap className="w-3 h-3" />
                  <span>{t("Impact concret Avant → Après (W, °C, RPM, ms)", "Concrete impact Before → After (W, °C, RPM, ms)")}</span>
                </div>
                <p className="text-[11px] text-emerald-100/90">{doc.beforeAfterHint}</p>
                {extraBeforeAfter && (
                  <p className="mt-1 pt-1 border-t border-emerald-500/20 font-mono text-[10.5px] text-emerald-300">
                    {t("Mesure actuelle :", "Current measurement:")} {extraBeforeAfter}
                  </p>
                )}
              </div>

              {/* Garantie de sûreté */}
              <div className="flex items-start gap-1.5 text-[10.5px] text-slate-400 pt-0.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                <span>{doc.safetyNote}</span>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};
