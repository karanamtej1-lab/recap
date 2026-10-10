"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, PartyPopper, RotateCcw } from "lucide-react";
import { deckStats, nextLabel, review, toAnkiTSV, type Card, type Grade } from "@/lib/cards";
import { formatTime } from "@/lib/format";
import { Markdown } from "./Markdown";

const GRADES: { g: Grade; label: string; cls: string; key: string }[] = [
  { g: 0, label: "Again", cls: "border-hot/50 text-hot hover:bg-hot/10", key: "1" },
  { g: 1, label: "Hard", cls: "border-amber-400/50 text-amber-300 hover:bg-amber-400/10", key: "2" },
  { g: 2, label: "Good", cls: "border-emerald-400/50 text-emerald-300 hover:bg-emerald-400/10", key: "3" },
  { g: 3, label: "Easy", cls: "border-accent/60 text-accent-soft hover:bg-accent/10", key: "4" },
];

export function Flashcards({ cards, onChange, seek, title }: {
  cards: Card[]; onChange: (cards: Card[]) => void; seek: (t: number) => void; title: string;
}) {
  const [now, setNow] = useState(Date.now());
  const [flipped, setFlipped] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const stats = deckStats(cards, now);
  // Due cards first (most overdue first); then let people study ahead if they want.
  const queue = useMemo(() => cards.filter((c) => c.due <= now).sort((a, b) => a.due - b.due), [cards, now]);
  const card = queue[0];

  const grade = (g: Grade) => {
    if (!card) return;
    onChange(cards.map((c) => (c.id === card.id ? review(c, g) : c)));
    setFlipped(false);
    setReviewed((n) => n + 1);
    setNow(Date.now());
  };

  // Keyboard: space flips, 1-4 grade.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.code === "Space" && card) { e.preventDefault(); setFlipped(true); }
      const g = GRADES.find((x) => x.key === e.key);
      if (g && flipped) grade(g.g);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Learning steps are minutes long: re-check the queue while the tab is open.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const exportAnki = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([toAnkiTSV(cards)], { type: "text/tab-separated-values" }));
    a.download = `${title.replace(/[^\w\- ]+/g, "").trim() || "recap"} - flashcards.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!cards.length) return <p className="glass rounded-xl p-5 text-sm text-white/50">No flashcards for this recording.</p>;

  return (
    <div className="space-y-4">
      <div className="glass grid grid-cols-4 divide-x divide-white/5 rounded-xl text-center">
        {[
          { n: stats.due, l: "Due now", c: "text-hot" },
          { n: stats.fresh, l: "New", c: "text-accent-soft" },
          { n: stats.learning, l: "Learning", c: "text-amber-300" },
          { n: stats.mature, l: "Mature", c: "text-emerald-300" },
        ].map((s) => (
          <div key={s.l} className="py-3">
            <p className={`text-xl font-semibold ${s.c}`}>{s.n}</p>
            <p className="text-[11px] uppercase tracking-wider text-white/45">{s.l}</p>
          </div>
        ))}
      </div>

      {card ? (
        <div className="glass rounded-xl p-6">
          <div className="min-h-[96px] text-lg text-white"><Markdown text={card.front} /></div>
          {flipped ? (
            <>
              <div className="mt-4 border-t border-white/10 pt-4"><Markdown text={card.back} /></div>
              {card.at !== null && (
                <button onClick={() => seek(card.at!)} className="mt-1 rounded bg-accent/15 px-1.5 py-0.5 font-mono text-xs text-accent-soft hover:bg-accent/30">▶ {formatTime(card.at)}</button>
              )}
              <div className="mt-5 grid grid-cols-4 gap-2">
                {GRADES.map(({ g, label, cls, key }) => (
                  <button key={g} onClick={() => grade(g)} className={`rounded-lg border py-2 text-sm transition ${cls}`} title={`Key ${key}`}>
                    {label}
                    <span className="block text-[11px] opacity-70">{nextLabel(card, g)}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <button onClick={() => setFlipped(true)} className="mt-4 w-full rounded-lg bg-white/10 py-3 text-sm font-medium hover:bg-white/15">
              Show answer <span className="text-white/40">· space</span>
            </button>
          )}
          <p className="mt-3 text-right text-xs text-white/35">{queue.length} left in this session</p>
        </div>
      ) : (
        <div className="glass rounded-xl p-8 text-center">
          <PartyPopper className="mx-auto h-8 w-8 text-accent-soft" />
          <p className="mt-3 font-medium">{reviewed ? `Done: ${reviewed} reviewed.` : "Nothing due right now."}</p>
          <p className="mt-1 text-sm text-white/55">
            Next card due {nextDue(cards, now)}. Spacing reviews out is what makes them stick.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-white/45">
        <span>Spaced repetition (SM-2). Progress saves to your library automatically.</span>
        <div className="flex gap-3">
          <button onClick={() => { if (confirm("Reset all review progress for this deck?")) onChange(cards.map((c) => ({ ...c, ease: 2.5, interval: 0, due: Date.now(), reps: 0, lapses: 0 }))); }}
            className="flex items-center gap-1 hover:text-white"><RotateCcw className="h-3.5 w-3.5" /> Reset</button>
          <button onClick={exportAnki} className="flex items-center gap-1 hover:text-white"><Download className="h-3.5 w-3.5" /> Export to Anki</button>
        </div>
      </div>
    </div>
  );
}

function nextDue(cards: Card[], now: number): string {
  const soonest = Math.min(...cards.map((c) => c.due));
  const ms = soonest - now;
  if (ms <= 0) return "now";
  if (ms < 3_600_000) return `in ${Math.ceil(ms / 60_000)} min`;
  if (ms < 86_400_000) return `in ${Math.round(ms / 3_600_000)} h`;
  return `in ${Math.round(ms / 86_400_000)} days`;
}
