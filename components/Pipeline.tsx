"use client";

import { Check, Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { formatTime } from "@/lib/format";
import type { Word } from "@/lib/types";

export type Phase = "idle" | "decoding" | "loading-model" | "transcribing" | "analyzing" | "ready";

const STEPS: { phase: Phase; label: string; detail: string }[] = [
  { phase: "decoding", label: "Reading audio", detail: "Decoding to 16 kHz mono in your browser" },
  { phase: "loading-model", label: "Loading Whisper", detail: "Downloaded once, then cached on this device" },
  { phase: "transcribing", label: "Transcribing on-device", detail: "30-second windows with word timestamps" },
  { phase: "analyzing", label: "Writing your recap", detail: "Notes, chapters, quiz, and clip scoring" },
];

export function Pipeline({ phase, progress, device, words, mediaName, detail }: {
  phase: Phase; progress: number; device: string; words: Word[]; mediaName?: string; detail?: string;
}) {
  const current = STEPS.findIndex((s) => s.phase === phase);
  const tail = useRef<HTMLDivElement>(null);
  useEffect(() => { tail.current?.scrollTo({ top: tail.current.scrollHeight }); }, [words.length]);
  const lastT = words[words.length - 1]?.end ?? 0;

  return (
    <section className="mx-auto grid max-w-5xl gap-6 pt-10 lg:grid-cols-[320px_1fr]">
      <div className="glass h-fit rounded-2xl p-5">
        {mediaName && <p className="mb-4 truncate text-xs text-white/50">{mediaName}</p>}
        <ol className="space-y-4">
          {STEPS.map((s, i) => {
            const done = i < current;
            const active = i === current;
            const showBar = active && (s.phase === "loading-model" || s.phase === "transcribing");
            return (
              <li key={s.phase} className={`flex gap-3 ${i > current ? "opacity-40" : ""}`}>
                <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs ${done ? "bg-emerald-500/20 text-emerald-300" : active ? "bg-accent/25 text-accent-soft" : "bg-white/5"}`}>
                  {done ? <Check className="h-3.5 w-3.5" /> : active ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{s.label}</p>
                  <p className="text-xs text-white/45">
                    {s.detail}
                    {s.phase === "transcribing" && device && ` · ${device === "webgpu" ? "GPU" : "CPU"}`}
                    {s.phase === "analyzing" && active && detail && <span className="block text-accent-soft">{detail}</span>}
                  </p>
                  {showBar && (
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
                    </div>
                  )}
                  {active && s.phase === "analyzing" && <div className="shimmer mt-2 h-1.5 rounded-full" />}
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="glass rounded-2xl p-5">
        <div className="mb-3 flex items-center justify-between text-xs text-white/50">
          <span>Live transcript</span>
          <span className="font-mono">{words.length} words · {formatTime(lastT)}</span>
        </div>
        <div ref={tail} className="scroll-thin h-[420px] overflow-y-auto pr-2 text-[15px] leading-relaxed text-white/80">
          {words.length ? (
            words.map((w, i) => (
              <span key={i} className={i >= words.length - 12 && phase === "transcribing" ? "text-white" : ""}>{w.text} </span>
            ))
          ) : (
            <p className="text-white/35">Words will stream in here as Whisper hears them…</p>
          )}
        </div>
      </div>
    </section>
  );
}
