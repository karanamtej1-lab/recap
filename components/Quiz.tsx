"use client";

import { useState } from "react";
import { Check, RotateCcw, X } from "lucide-react";
import { formatTime } from "@/lib/format";
import type { QuizQuestion } from "@/lib/types";

export function Quiz({ quiz, seek }: { quiz: QuizQuestion[]; seek: (t: number) => void }) {
  const [picked, setPicked] = useState<(number | null)[]>(() => quiz.map(() => null));
  if (!quiz.length) return <p className="glass rounded-xl p-5 text-sm text-white/50">Not enough material for a quiz.</p>;
  const answered = picked.filter((p) => p !== null).length;
  const correct = picked.filter((p, i) => p === quiz[i].answer).length;

  return (
    <div className="space-y-4">
      <div className="glass flex items-center justify-between rounded-xl px-5 py-3 text-sm">
        <span className="text-white/60">{answered}/{quiz.length} answered</span>
        <span className="font-semibold">{answered ? `${correct} correct · ${Math.round((correct / answered) * 100)}%` : "Test yourself"}</span>
        <button onClick={() => setPicked(quiz.map(() => null))} className="flex items-center gap-1 text-xs text-white/50 hover:text-white"><RotateCcw className="h-3.5 w-3.5" /> Reset</button>
      </div>
      {quiz.map((q, i) => {
        const p = picked[i];
        return (
          <div key={i} className="glass rounded-xl p-5">
            <p className="text-[15px] font-medium text-white"><span className="mr-2 text-accent-soft">{i + 1}.</span>{q.question}</p>
            <div className="mt-3 grid gap-2">
              {q.choices.map((c, j) => {
                const state = p === null ? "idle" : j === q.answer ? "right" : j === p ? "wrong" : "dim";
                return (
                  <button key={j} disabled={p !== null} onClick={() => setPicked((prev) => prev.map((v, k) => (k === i ? j : v)))}
                    className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition ${
                      state === "right" ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-100"
                      : state === "wrong" ? "border-hot/50 bg-hot/10 text-rose-100"
                      : state === "dim" ? "border-white/5 text-white/40"
                      : "border-white/10 hover:border-accent/60 hover:bg-accent/5"}`}>
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-white/5 text-xs">
                      {state === "right" ? <Check className="h-3.5 w-3.5" /> : state === "wrong" ? <X className="h-3.5 w-3.5" /> : String.fromCharCode(65 + j)}
                    </span>
                    {c}
                  </button>
                );
              })}
            </div>
            {p !== null && (
              <div className="mt-3 rounded-lg bg-white/5 p-3 text-sm text-white/70">
                {q.explanation}{" "}
                <button onClick={() => seek(q.at)} className="ml-1 rounded bg-accent/15 px-1.5 py-0.5 font-mono text-xs text-accent-soft hover:bg-accent/30">▶ {formatTime(q.at)}</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
