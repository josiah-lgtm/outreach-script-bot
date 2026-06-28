// TagInput — controlled list of string tags with add-on-Enter and click-to-remove.
// Replaces the legacy `.tags / .tag-item / .tag-input` pattern (and the DOM-mutating
// addTag/removeTag helpers). Enter or comma commits; Backspace on an empty field pops
// the last tag. Duplicates are ignored.

"use client";

import { useState, type KeyboardEvent } from "react";
import { cn } from "./cn";

export interface TagInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  className?: string;
  /** Disallow duplicate values (default true). */
  unique?: boolean;
}

export function TagInput({ value, onChange, placeholder = "Add…", className, unique = true }: TagInputProps) {
  const [draft, setDraft] = useState("");

  function commit(raw: string) {
    const t = raw.trim();
    if (!t) return;
    if (unique && value.includes(t)) {
      setDraft("");
      return;
    }
    onChange([...value, t]);
    setDraft("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(draft);
    } else if (e.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className={cn("flex flex-wrap gap-1.5 items-center", className)}>
      {value.map((tag, i) => (
        <span
          key={tag + i}
          className="inline-flex items-center gap-1.5 bg-[var(--tint-accent)] text-accent2 text-[11px] px-2 py-[3px] rounded"
        >
          {tag}
          <b
            role="button"
            aria-label={`Remove ${tag}`}
            className="cursor-pointer opacity-70 font-bold hover:opacity-100 hover:text-red"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            ×
          </b>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => commit(draft)}
        placeholder={placeholder}
        className="bg-bg3 border border-dashed border-border rounded text-text text-[11px] px-2 py-[3px] outline-none w-[150px] focus:border-accent"
      />
    </div>
  );
}
