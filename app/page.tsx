"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Uploader, type Source } from "@/components/Uploader";
import { Pipeline, type Phase } from "@/components/Pipeline";
import { Workspace } from "@/components/Workspace";
import { decodeToMono16k } from "@/lib/audio";
import { textToWords, wordsToSegments } from "@/lib/segments";
import type { WorkerIn, WorkerOut } from "@/lib/transcribe.worker";
import type { Recap, Segment, Word } from "@/lib/types";

export type Media = { url: string; kind: "video" | "audio"; name: string } | null;

export default function Home() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [device, setDevice] = useState("");
  const [media, setMedia] = useState<Media>(null);
  const [words, setWords] = useState<Word[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [recap, setRecap] = useState<Recap | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [provider, setProvider] = useState("…");
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    fetch("/api/provider").then((r) => r.json()).then((d) => setProvider(d.provider)).catch(() => setProvider("offline"));
    return () => workerRef.current?.terminate();
  }, []);

  const analyze = useCallback(async (segs: Segment[]) => {
    setPhase("analyzing");
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segments: segs }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Analysis failed");
    setRecap(data.recap);
    setNote(data.note ?? "");
    setPhase("ready");
  }, []);

  const transcribe = useCallback((samples: Float32Array, model: string) =>
    new Promise<Word[]>((resolve, reject) => {
      workerRef.current ??= new Worker(new URL("../lib/transcribe.worker.ts", import.meta.url), { type: "module" });
      const worker = workerRef.current;
      const all: Word[] = [];
      setPhase("loading-model");
      worker.onmessage = (e: MessageEvent<WorkerOut>) => {
        const m = e.data;
        if (m.type === "loading") setProgress(m.progress);
        else if (m.type === "ready") { setDevice(m.device); setPhase("transcribing"); setProgress(0); }
        else if (m.type === "words") {
          all.push(...m.words);
          setWords([...all]);
          setProgress(m.done / m.total);
        } else if (m.type === "done") resolve(all);
        else if (m.type === "error") reject(new Error(m.message));
      };
      const msg: WorkerIn = { type: "transcribe", audio: samples, model };
      worker.postMessage(msg, [samples.buffer]);
    }), []);

  const start = useCallback(async (source: Source) => {
    setError(""); setNote(""); setRecap(null); setWords([]); setSegments([]); setProgress(0);
    try {
      let w: Word[];
      if (source.kind === "text") {
        setMedia(null);
        w = textToWords(source.text);
      } else {
        const url = URL.createObjectURL(source.file);
        setMedia({ url, kind: source.file.type.startsWith("video") ? "video" : "audio", name: source.file.name });
        setPhase("decoding");
        const { samples } = await decodeToMono16k(source.file);
        w = await transcribe(samples, source.model);
      }
      const segs = wordsToSegments(w);
      if (!segs.length) throw new Error("No speech found in that recording.");
      setWords(w);
      setSegments(segs);
      await analyze(segs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("idle");
    }
  }, [analyze, transcribe]);

  const reset = () => {
    if (media) URL.revokeObjectURL(media.url);
    setMedia(null); setRecap(null); setWords([]); setSegments([]); setPhase("idle");
  };

  return (
    <main className="relative min-h-screen overflow-x-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(ellipse_at_top,rgba(124,108,255,0.22),transparent_65%)]" />
      <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-4 py-5 sm:px-6">
        <button onClick={reset} className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-sm font-bold text-white">R</span>
          Recap
        </button>
        <div className="flex items-center gap-2 text-xs text-white/60">
          <span className={`h-2 w-2 rounded-full ${provider === "offline" ? "bg-amber-400" : "bg-emerald-400"}`} />
          AI engine: <span className="font-mono text-white/80">{provider}</span>
        </div>
      </header>

      <div className="relative z-10 mx-auto max-w-7xl px-4 pb-20 sm:px-6">
        {phase === "ready" && recap ? (
          <Workspace media={media} words={words} segments={segments} recap={recap} note={note} />
        ) : phase === "idle" ? (
          <Uploader onStart={start} error={error} provider={provider} />
        ) : (
          <Pipeline phase={phase} progress={progress} device={device} words={words} mediaName={media?.name} />
        )}
      </div>
    </main>
  );
}
