// Swipe-review deck — the keep/pass card stack at the end of the wizard (legacy v9Wizard's
// swipe phase 7440-7460 + osWizSwipe/Undo/Redo/Cleanup/Tx/MoreVariants 7644-7656). Behaviour
// is faithful (keep → board Ideas, pass → skip, per-card undo/redo, "clean up" dash strip,
// config-driven rewrite buttons, +N variants); the drag-to-swipe gesture is the deliberate
// UI upgrade over the legacy buttons (the buttons remain for accessibility).

"use client";

import { useDrag } from "@use-gesture/react";
import { useSpring, animated } from "@react-spring/web";
import { Icon, Button, cn } from "@/components/ui";
import type { DeckCard, BuilderButton } from "@/lib/sync/wizard";

export interface SwipeDeckProps {
  deck: DeckCard[];
  i: number;
  kept: number;
  busy: boolean;
  dedupNote?: string;
  genError?: string;
  builderButtons: BuilderButton[];
  canUndo: boolean;
  canRedo: boolean;
  currentText: string;
  onSwipe: (keep: boolean) => void;
  onUndo: () => void;
  onRedo: () => void;
  onCleanup: () => void;
  onTx: (id: string) => void;
  onMoreVariants: (n: number) => void;
  onEdit: () => void;
  onKeepAll: () => void;
  onBackToFw: () => void;
  onClose: () => void;
}

export function SwipeDeck(props: SwipeDeckProps) {
  const { deck, i, kept, busy, dedupNote, genError, builderButtons, canUndo, canRedo, currentText } = props;

  // ── Done / empty screen ──
  if (i >= deck.length) {
    if (!deck.length && genError) {
      return (
        <div>
          <div className="text-[15px] font-semibold mb-2">No scripts generated</div>
          <div className="rounded-xl border border-red bg-[var(--tint-red)] p-3.5">
            <div className="text-[13px] font-semibold text-red inline-flex items-center gap-1.5">
              <Icon name="alert-triangle" size={15} /> The generator returned nothing
            </div>
            <div className="text-[12px] text-muted mt-1.5 whitespace-pre-wrap">{genError}</div>
          </div>
          <div className="flex gap-2 mt-4">
            <Button variant="secondary" size="sm" onClick={props.onBackToFw}>
              ← Back to frameworks
            </Button>
            <Button variant="secondary" size="sm" onClick={props.onClose}>
              Close
            </Button>
          </div>
        </div>
      );
    }
    return (
      <div className="text-center py-6">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[var(--tint-green)] text-green mb-3">
          <Icon name="check" size={24} />
        </div>
        <div className="text-[16px] font-semibold">Done</div>
        <div className="text-[13px] text-muted mt-1">
          {kept} script{kept === 1 ? "" : "s"} saved to the board (Ideas).
        </div>
        <div className="mt-5">
          <Button variant="primary" size="sm" onClick={props.onClose}>
            Back to overview
          </Button>
        </div>
      </div>
    );
  }

  const d = deck[i];
  const meta = [d.fw, d.angle].filter(Boolean).join(" · ");

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="text-[15px] font-semibold">Review scripts</div>
        <div className="text-[12px] text-muted">
          {i + 1} of {deck.length} · {kept} kept ·{" "}
          <button onClick={props.onKeepAll} className="text-accent2 font-semibold hover:underline cursor-pointer">
            Keep all →
          </button>
        </div>
      </div>
      {dedupNote && <div className="text-[12px] text-muted mb-2">✨ {dedupNote}</div>}

      <SwipeCard key={i} meta={meta} text={currentText} busy={busy} onSwipe={props.onSwipe} />

      {/* Tools */}
      <div className="flex items-center flex-wrap gap-1.5 mt-3">
        <Button variant="secondary" size="sm" icon="arrow-back-up" disabled={!canUndo || busy} onClick={props.onUndo}>
          Undo
        </Button>
        <Button variant="secondary" size="sm" icon="arrow-forward-up" disabled={!canRedo || busy} onClick={props.onRedo}>
          Redo
        </Button>
        {busy ? (
          <span className="text-[12px] text-muted inline-flex items-center gap-1.5 px-1">
            <Icon name="loader-2" size={14} className="animate-[spin_0.8s_linear_infinite]" /> Working…
          </span>
        ) : (
          <>
            <Button variant="secondary" size="sm" icon="eraser" onClick={props.onCleanup} title="Remove dashes">
              Clean up
            </Button>
            {builderButtons
              .filter((b) => b.enabled !== false)
              .map((b) => (
                <Button key={b.id} variant="secondary" size="sm" icon={b.icon || "wand"} title={b.label} onClick={() => props.onTx(b.id)}>
                  {b.label}
                </Button>
              ))}
          </>
        )}
      </div>

      {/* Keep / pass */}
      <div className="flex items-center justify-center gap-4 mt-4">
        <button
          onClick={() => props.onSwipe(false)}
          disabled={busy}
          title="Pass"
          className="w-12 h-12 rounded-full border border-border bg-bg2 text-muted hover:border-red hover:text-red transition-colors flex items-center justify-center disabled:opacity-50"
        >
          <Icon name="x" size={22} />
        </button>
        <Button variant="secondary" size="sm" icon="edit" disabled={busy} onClick={props.onEdit}>
          Edit
        </Button>
        <button
          onClick={() => props.onSwipe(true)}
          disabled={busy}
          title="Keep"
          className="w-12 h-12 rounded-full border border-accent2 bg-[var(--tint-accent)] text-accent2 hover:bg-accent2 hover:text-white transition-colors flex items-center justify-center disabled:opacity-50"
        >
          <Icon name="heart" size={22} />
        </button>
      </div>

      {/* More variants */}
      <div className="flex items-center justify-center gap-1.5 mt-3 text-[12px] text-muted">
        <span>More variants of this:</span>
        {[1, 2, 3, 5].map((k) => (
          <Button key={k} variant="ghost" size="sm" disabled={busy} onClick={() => props.onMoreVariants(k)}>
            +{k}
          </Button>
        ))}
      </div>
    </div>
  );
}

function SwipeCard({
  meta,
  text,
  busy,
  onSwipe,
}: {
  meta: string;
  text: string;
  busy: boolean;
  onSwipe: (keep: boolean) => void;
}) {
  const [{ x, rot }, api] = useSpring(() => ({ x: 0, rot: 0 }));

  const bind = useDrag(
    ({ active, movement: [mx], velocity: [vx], cancel }) => {
      if (busy) {
        cancel();
        return;
      }
      const trigger = Math.abs(mx) > 130 || vx > 0.45;
      if (!active && trigger) {
        const keep = mx > 0;
        api.start({
          x: (keep ? 1 : -1) * 700,
          rot: (keep ? 1 : -1) * 18,
          config: { tension: 220, friction: 30 },
          onResolve: () => onSwipe(keep),
        });
        return;
      }
      api.start({ x: active ? mx : 0, rot: active ? mx / 22 : 0, immediate: active });
    },
    { axis: "x", filterTaps: true },
  );

  // Tint feedback as the card is dragged toward keep (green) / pass (red).
  const tint = x.to((v) => (v > 30 ? "var(--accent2)" : v < -30 ? "var(--red)" : "var(--border)"));

  return (
    <animated.div
      {...bind()}
      style={{ x, rotateZ: rot, borderColor: tint, touchAction: "none" }}
      className={cn(
        "relative rounded-xl border-2 bg-bg2 p-4 min-h-[170px] select-none",
        busy ? "cursor-default" : "cursor-grab active:cursor-grabbing",
      )}
    >
      {meta && <div className="text-[12px] text-muted mb-1.5">{meta}</div>}
      <div className="text-[14px] leading-[1.6] whitespace-pre-wrap font-mono text-text">{text}</div>
      <animated.span
        style={{ opacity: x.to((v) => Math.min(Math.max(v / 130, 0), 1)) }}
        className="absolute top-3 right-3 text-[11px] font-bold uppercase tracking-wide text-accent2 border border-accent2 rounded px-1.5 py-0.5 rotate-6"
      >
        Keep
      </animated.span>
      <animated.span
        style={{ opacity: x.to((v) => Math.min(Math.max(-v / 130, 0), 1)) }}
        className="absolute top-3 left-3 text-[11px] font-bold uppercase tracking-wide text-red border border-red rounded px-1.5 py-0.5 -rotate-6"
      >
        Pass
      </animated.span>
    </animated.div>
  );
}
