"use client";

import { useRef, useState } from "react";
import { ArrowUp, Loader2 } from "lucide-react";
import { formatTime } from "@/lib/format";
import { ask as askRecording } from "@/lib/analyze";
import type { AIConfig } from "@/lib/llm";
import type { AskAnswer, Segment } from "@/lib/types";
import { Markdown } from "./Markdown";

type Turn = { q: string; a?: AskAnswer & { note?: string }; error?: string };

const SUGGESTIONS = ["What's the main argument?", "What will be on the test?", "Explain the hardest part simply", "Were any deadlines mentioned?"];

export function Ask({ segments, seek, config }: { segments: Segment[]; seek: (t: number) => void; config: AIConfig }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const ask = async (question: string) => {
    if (!question.trim() || busy) return;
    setQ("");
    setBusy(true);
    setTurns((t) => [...t, { q: question }]);
    try {
      const a = await askRecording(question, segments, config);
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a } : x)));
    } catch (e) {
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, error: e instanceof Error ? e.message : "Something went wrong" } : x)));
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  };

  return (
    <div className="glass flex min-h-[480px] flex-col rounded-xl">
      <div className="flex-1 space-y-4 p-5">
        {!turns.length && (
          <div className="py-8 text-center">
            <p className="text-sm text-white/55">Ask the recording anything. Answers link to the exact moment.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => ask(s)} className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/70 hover:border-accent hover:text-white">{s}</button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className="space-y-2">
            <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-accent/25 px-4 py-2 text-sm">{t.q}</p>
            <div className="max-w-[92%] rounded-2xl rounded-bl-sm bg-white/5 px-4 py-3">
              {t.a ? (
                <>
                  {t.a.note && <p className="mb-2 text-xs text-amber-200/80">{t.a.note}. Showing keyword matches instead.</p>}
                  <Markdown text={t.a.answer} />
                  {t.a.citations.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {t.a.citations.map((c) => (
                        <button key={c} onClick={() => seek(c)} className="rounded bg-accent/15 px-1.5 py-0.5 font-mono text-xs text-accent-soft hover:bg-accent/30">▶ {formatTime(c)}</button>
                      ))}
                    </div>
                  )}
                </>
              ) : t.error ? <p className="text-sm text-hot">{t.error}</p> : <Loader2 className="h-4 w-4 animate-spin text-white/50" />}
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); ask(q); }} className="flex gap-2 border-t border-white/5 p-3">
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about the lecture…"
          className="flex-1 rounded-lg bg-ink-950/60 px-3 py-2 text-sm outline-none ring-accent focus:ring-1" />
        <button disabled={busy || !q.trim()} className="grid h-9 w-9 place-items-center rounded-lg bg-accent text-white disabled:opacity-40"><ArrowUp className="h-4 w-4" /></button>
      </form>
    </div>
  );
}
