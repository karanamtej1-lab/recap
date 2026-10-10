"use client";

import { Film, Mic, FileText, Trash2, Layers } from "lucide-react";
import { formatTime } from "@/lib/format";
import type { LibraryItem } from "@/lib/library";

export function Library({ items, onOpen, onDelete }: { items: LibraryItem[]; onOpen: (id: string) => void; onDelete: (id: string) => void }) {
  if (!items.length) return null;
  return (
    <section className="mx-auto mt-10 max-w-3xl">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-white/80">Your library</h2>
        <span className="text-xs text-white/40">Saved in this browser only</span>
      </div>
      <ul className="grid gap-2">
        {items.map((r) => {
          const Icon = r.mediaKind === "video" ? Film : r.mediaKind === "audio" ? Mic : FileText;
          return (
            <li key={r.id} className="glass group flex items-center gap-3 rounded-xl px-4 py-3">
              <Icon className="h-4 w-4 shrink-0 text-accent-soft" />
              <button onClick={() => onOpen(r.id)} className="min-w-0 flex-1 text-left">
                <p className="truncate text-sm font-medium text-white group-hover:text-accent-soft">{r.title}</p>
                <p className="text-xs text-white/45">
                  {new Date(r.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {formatTime(r.duration)}
                  {!r.hasMedia && r.mediaKind && " · media not saved"}
                </p>
              </button>
              {r.due > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-hot/15 px-2 py-0.5 text-xs text-hot" title="Flashcards due for review">
                  <Layers className="h-3 w-3" /> {r.due} due
                </span>
              )}
              <button onClick={() => { if (confirm(`Delete "${r.title}" from this browser?`)) onDelete(r.id); }}
                aria-label={`Delete ${r.title}`} className="text-white/30 transition hover:text-hot">
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
