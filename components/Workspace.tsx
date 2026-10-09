"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Download, GraduationCap, MessageCircle, Scissors, AlertTriangle } from "lucide-react";
import type { Media } from "@/app/page";
import { formatTime } from "@/lib/format";
import type { Recap, Segment, Word } from "@/lib/types";
import { Markdown } from "./Markdown";
import { ClipStudio } from "./ClipStudio";
import { Quiz } from "./Quiz";
import { Ask } from "./Ask";

type Tab = "notes" | "clips" | "quiz" | "ask";

export function Workspace({ media, words, segments, recap, note }: {
  media: Media; words: Word[]; segments: Segment[]; recap: Recap; note: string;
}) {
  const [tab, setTab] = useState<Tab>("notes");
  const [now, setNow] = useState(0);
  const player = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const transcriptBox = useRef<HTMLDivElement>(null);

  const seek = useCallback((t: number) => {
    const el = player.current;
    if (el) { el.currentTime = t; el.play().catch(() => {}); }
    setNow(t);
    const row = transcriptBox.current?.querySelector<HTMLElement>(`[data-start="${t}"]`);
    row?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);

  const activeId = useMemo(() => {
    const s = segments.find((x) => now >= x.start && now < x.end + 0.3);
    return s?.id ?? -1;
  }, [now, segments]);

  useEffect(() => {
    const row = transcriptBox.current?.querySelector<HTMLElement>(`[data-id="${activeId}"]`);
    if (row && player.current && !player.current.paused) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeId]);

  const duration = segments[segments.length - 1]?.end ?? 0;

  const tabs: { id: Tab; label: string; icon: typeof BookOpen; count?: number }[] = [
    { id: "notes", label: "Notes", icon: BookOpen },
    { id: "clips", label: "Clips", icon: Scissors, count: recap.highlights.length },
    { id: "quiz", label: "Quiz", icon: GraduationCap, count: recap.quiz.length },
    { id: "ask", label: "Ask", icon: MessageCircle },
  ];

  return (
    <div className="pt-4">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-widest text-accent-soft">Recap · {formatTime(duration)} · {segments.length} segments</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{recap.title}</h1>
        </div>
        <button onClick={() => downloadNotes(recap)} className="flex shrink-0 items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm hover:bg-white/5">
          <Download className="h-4 w-4" /> Export notes (.md)
        </button>
      </div>

      {note && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {note} — showing the offline analysis instead.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* Left: media + chapters + transcript */}
        <div className="space-y-4 lg:sticky lg:top-4 lg:h-fit">
          {media?.kind === "video" && (
            <video ref={player} src={media.url} controls playsInline onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)} className="aspect-video w-full rounded-xl bg-black" />
          )}
          {media?.kind === "audio" && (
            <div className="glass rounded-xl p-4">
              <p className="mb-2 truncate text-xs text-white/50">{media.name}</p>
              <audio ref={player} src={media.url} controls onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)} className="w-full" />
            </div>
          )}

          {recap.chapters.length > 0 && (
            <div className="glass rounded-xl p-3">
              <div className="flex h-2 overflow-hidden rounded-full bg-white/5">
                {recap.chapters.map((c, i) => {
                  const end = recap.chapters[i + 1]?.start ?? duration;
                  const active = now >= c.start && now < end;
                  return (
                    <button key={i} title={c.title} onClick={() => seek(c.start)}
                      style={{ width: `${((end - c.start) / Math.max(duration, 1)) * 100}%` }}
                      className={`h-full border-r border-ink-900 transition ${active ? "bg-accent" : "bg-white/15 hover:bg-white/30"}`} />
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {recap.chapters.map((c, i) => (
                  <button key={i} onClick={() => seek(c.start)} className="rounded-md bg-white/5 px-2 py-1 text-xs text-white/70 hover:bg-white/10 hover:text-white">
                    <span className="font-mono text-accent-soft">{formatTime(c.start)}</span> {c.title}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="glass rounded-xl">
            <p className="border-b border-white/5 px-4 py-2.5 text-xs font-medium text-white/50">Transcript</p>
            <div ref={transcriptBox} className="scroll-thin max-h-[360px] overflow-y-auto p-2">
              {segments.map((s) => (
                <button key={s.id} data-id={s.id} data-start={s.start} onClick={() => seek(s.start)}
                  className={`flex w-full gap-3 rounded-lg px-2 py-1.5 text-left text-sm transition ${s.id === activeId ? "bg-accent/15 text-white" : "text-white/65 hover:bg-white/5"}`}>
                  <span className="mt-0.5 w-10 shrink-0 font-mono text-xs text-white/35">{formatTime(s.start)}</span>
                  <span>{s.text}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right: tabs */}
        <div className="min-w-0">
          <div className="glass mb-4 flex gap-1 rounded-xl p-1">
            {tabs.map(({ id, label, icon: Icon, count }) => (
              <button key={id} onClick={() => setTab(id)}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm transition ${tab === id ? "bg-white/10 text-white" : "text-white/55 hover:text-white"}`}>
                <Icon className="h-4 w-4" /> <span className="hidden sm:inline">{label}</span>
                {count ? <span className="rounded-full bg-white/10 px-1.5 text-[10px]">{count}</span> : null}
              </button>
            ))}
          </div>

          {tab === "notes" && <Notes recap={recap} seek={seek} />}
          {tab === "clips" && <ClipStudio media={media} words={words} highlights={recap.highlights} seek={seek} />}
          {tab === "quiz" && <Quiz quiz={recap.quiz} seek={seek} />}
          {tab === "ask" && <Ask segments={segments} seek={seek} />}
        </div>
      </div>
    </div>
  );
}

function Notes({ recap, seek }: { recap: Recap; seek: (t: number) => void }) {
  return (
    <div className="space-y-4">
      <div className="glass rounded-xl p-5">
        <p className="text-xs font-medium uppercase tracking-widest text-accent-soft">TL;DR</p>
        <p className="mt-2 text-[15px] leading-relaxed text-white/85">{recap.tldr}</p>
      </div>

      {recap.keyPoints.length > 0 && (
        <div className="glass rounded-xl p-5">
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-white/50">Key points</p>
          <ul className="space-y-2">
            {recap.keyPoints.map((k, i) => (
              <li key={i} className="flex gap-3 text-sm text-white/80">
                <button onClick={() => seek(k.at)} className="h-fit shrink-0 rounded bg-accent/15 px-1.5 py-0.5 font-mono text-xs text-accent-soft hover:bg-accent/30">{formatTime(k.at)}</button>
                <span>{k.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="glass rounded-xl p-5"><Markdown text={recap.notes} /></div>

      <div className="grid gap-4 sm:grid-cols-2">
        {recap.terms.length > 0 && (
          <div className="glass rounded-xl p-5">
            <p className="mb-3 text-xs font-medium uppercase tracking-widest text-white/50">Key terms</p>
            <dl className="space-y-3">
              {recap.terms.map((t, i) => (
                <div key={i}><dt className="text-sm font-semibold text-white">{t.term}</dt><dd className="text-sm text-white/65">{t.definition}</dd></div>
              ))}
            </dl>
          </div>
        )}
        {recap.actionItems.length > 0 && (
          <div className="glass rounded-xl p-5">
            <p className="mb-3 text-xs font-medium uppercase tracking-widest text-white/50">To-dos & deadlines</p>
            <ul className="space-y-2">
              {recap.actionItems.map((a, i) => (
                <li key={i} className="flex gap-2 text-sm text-white/75"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-hot" />{a}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <p className="text-right text-xs text-white/35">Analysis by <span className="font-mono">{recap.provider}</span></p>
    </div>
  );
}

function downloadNotes(r: Recap) {
  const lines = [
    `# ${r.title}`, "", `> ${r.tldr}`, "",
    "## Key points", ...r.keyPoints.map((k) => `- [${formatTime(k.at)}] ${k.text}`), "",
    r.notes, "",
    ...(r.terms.length ? ["## Key terms", ...r.terms.map((t) => `- **${t.term}**: ${t.definition}`), ""] : []),
    ...(r.actionItems.length ? ["## To-dos", ...r.actionItems.map((a) => `- [ ] ${a}`), ""] : []),
    ...(r.quiz.length ? ["## Quiz", ...r.quiz.flatMap((q, i) => [
      `${i + 1}. ${q.question}`, ...q.choices.map((c, j) => `   ${String.fromCharCode(65 + j)}. ${c}`),
      `   *Answer: ${String.fromCharCode(65 + q.answer)} — ${q.explanation}*`, "",
    ])] : []),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${r.title.replace(/[^\w\- ]+/g, "").trim() || "recap"}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
}
