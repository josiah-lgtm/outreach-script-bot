// The hand-edit mode for the growth doc — a Tiptap editor with a floating bubble menu.
// REPLACES the legacy contenteditable doc + floating format/AI bar (gpEnterEdit :5712,
// gpDocSel :5737, fmtCmd/fmtBlock/fmtAiRun). Once the user edits, the Tiptap JSON becomes
// the source of truth (stored on the working state via setDocJson); export then uses
// blocksFromEditorDoc(json) instead of buildGrowthPlanBlocks(...).
//
// Selecting text reveals a bubble menu with basic formatting (bold/italic, H2/H3, bullet
// list) and an "AI" action that rewrites the selection via the ai_edit_text server action,
// obeying the house rules — the same capability the legacy floating AI bar gave.

"use client";

import { useEffect, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { Button, Icon, Input, Spinner, cn } from "@/components/ui";
import { api } from "@/lib/sync/api";
import { getAdminKey } from "@/lib/sync/adminKey";
import { notify } from "@/lib/notify";

interface GrowthEditorProps {
  /** Initial HTML (the serialized live preview) — only used on first mount. */
  initialHtml: string;
  /** House rules passed to the AI selection rewrite (config.settings.growthRules). */
  rules: string;
  /** Debounced push of the current ProseMirror JSON up to the working state. */
  onChange: (json: unknown) => void;
}

function FmtButton({
  active,
  onClick,
  label,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "px-2 py-1 text-xs font-semibold rounded transition-colors",
        active ? "bg-accent text-white" : "text-subtle hover:bg-bg3 hover:text-text",
      )}
    >
      {children}
    </button>
  );
}

function Bar({ editor, rules }: { editor: Editor; rules: string }) {
  const [aiOpen, setAiOpen] = useState(false);
  const [aiInput, setAiInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function runAi() {
    const instruction = aiInput.trim();
    if (!instruction) { notify("Tell the AI what to do with the selection", true); return; }
    if (!getAdminKey()) { notify("No admin key", true); return; }
    const { from, to } = editor.state.selection;
    const selected = editor.state.doc.textBetween(from, to, " ");
    if (!selected) return;
    const context = editor.getText().slice(0, 6000);
    setBusy(true);
    try {
      const r = await api({ action: "ai_edit_text", text: selected, instruction, context, rules });
      const raw = String(r.html ?? r.text ?? "").trim();
      if (!raw) throw new Error("empty result");
      // Structured HTML (lists/paras) → insert as HTML; inline phrase → plain text.
      if (/<\w+[^>]*>/.test(raw)) editor.chain().focus().insertContentAt({ from, to }, raw).run();
      else editor.chain().focus().insertContentAt({ from, to }, raw).run();
      setAiInput("");
      setAiOpen(false);
      notify("✨ Applied");
    } catch (e) {
      notify("AI edit failed: " + (e as Error).message, true);
    }
    setBusy(false);
  }

  if (aiOpen) {
    return (
      <div className="flex items-center gap-1.5 bg-bg2 border border-border rounded-lg shadow-lg p-1.5">
        <Input
          autoFocus
          value={aiInput}
          onChange={(e) => setAiInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); runAi(); } }}
          placeholder="Ask AI to rewrite the selection…"
          className="w-64 !py-1"
        />
        <Button size="sm" variant="primary" onClick={runAi} disabled={busy}>
          {busy ? <Spinner size="sm" /> : <Icon name="arrow-forward-up" size={14} />}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setAiOpen(false)} aria-label="Close">
          <Icon name="x" size={14} />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-0.5 bg-bg2 border border-border rounded-lg shadow-lg p-1">
      <FmtButton active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} label="Bold">
        <b>B</b>
      </FmtButton>
      <FmtButton active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} label="Italic">
        <i>i</i>
      </FmtButton>
      <FmtButton
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        label="Heading 2"
      >
        H2
      </FmtButton>
      <FmtButton
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        label="Heading 3"
      >
        H3
      </FmtButton>
      <FmtButton active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} label="Bullet list">
        •
      </FmtButton>
      <span className="w-px h-4 bg-border mx-0.5" />
      <FmtButton onClick={() => setAiOpen(true)} label="Ask AI">
        <span className="inline-flex items-center gap-1 text-accent2">
          <Icon name="sparkles" size={13} /> AI
        </span>
      </FmtButton>
    </div>
  );
}

export function GrowthEditor({ initialHtml, rules, onChange }: GrowthEditorProps) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit],
    content: initialHtml,
    editorProps: { attributes: { class: "gp-doc gp-doc-edit focus:outline-none" } },
    onUpdate: ({ editor: ed }) => onChange(ed.getJSON()),
  });

  // Push the seeded JSON up once on mount so an immediate export uses the edited path.
  useEffect(() => {
    if (editor) onChange(editor.getJSON());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  if (!editor) return null;
  return (
    <>
      <BubbleMenu editor={editor}>
        <Bar editor={editor} rules={rules} />
      </BubbleMenu>
      <EditorContent editor={editor} />
    </>
  );
}
