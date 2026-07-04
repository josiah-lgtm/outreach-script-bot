// Read-only history view of a client's saved outbound follow-up sequences.
// Opened from the board card's follow-up count and the overview "Follow-ups" card.
// Each sequence shows when it was written, its cadence, and every step's full text.

"use client";

import { Modal, Icon, Badge } from "@/components/ui";
import { notify } from "@/lib/notify";

export interface FollowupHistoryItem {
  day?: number;
  framework?: string;
  text?: string;
}

export interface FollowupHistorySeq {
  id?: string;
  parentLabel?: string;
  parentText?: string;
  gapDays?: number;
  createdAt?: string;
  items?: FollowupHistoryItem[];
}

export function FollowupHistoryModal({
  open,
  onClose,
  sequences,
  title,
  sub,
}: {
  open: boolean;
  onClose: () => void;
  sequences: FollowupHistorySeq[];
  title?: string;
  sub?: string;
}) {
  function copy(text: string) {
    navigator.clipboard.writeText(text).then(
      () => notify("Copied to clipboard"),
      () => notify("Could not copy", true),
    );
  }

  return (
    <Modal open={open} onClose={onClose} size="lg" title={title || "Follow-up history"} sub={sub}>
      {sequences.length === 0 ? (
        <div className="text-[13px] text-muted py-4 text-center">No follow-up sequences yet.</div>
      ) : (
        <div className="flex flex-col gap-4">
          {sequences.map((seq, si) => (
            <div key={seq.id || si} className="bg-bg border border-border rounded-xl p-3">
              <div className="flex items-center justify-between gap-3 mb-2">
                <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold min-w-0">
                  <Icon name="arrow-forward-up" size={14} className="text-accent2 shrink-0" />
                  <span className="truncate">{seq.parentLabel || "Sequence"}</span>
                </span>
                <span className="flex items-center gap-2 shrink-0 text-xs text-muted">
                  {seq.gapDays ? <Badge>every {seq.gapDays}d</Badge> : null}
                  {seq.createdAt ? <span>{seq.createdAt}</span> : null}
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {(seq.items || []).map((it, ii) => (
                  <div key={ii} className="group bg-bg2 border border-border rounded-lg p-2.5">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-[11px] text-muted inline-flex items-center gap-2">
                        <Badge tone="accent">Day +{it.day ?? ii + 1}</Badge>
                        {it.framework && <span className="truncate">{it.framework}</span>}
                      </span>
                      <button
                        type="button"
                        onClick={() => copy(String(it.text || ""))}
                        title="Copy this follow-up"
                        className="text-[11px] text-muted hover:text-accent2 inline-flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Icon name="copy" size={12} /> Copy
                      </button>
                    </div>
                    <div className="text-[13px] whitespace-pre-wrap leading-snug">{it.text || ""}</div>
                  </div>
                ))}
                {!(seq.items || []).length && <div className="text-[12px] text-muted">No steps in this sequence.</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
