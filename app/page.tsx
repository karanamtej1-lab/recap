"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Uploader, type Source } from "@/components/Uploader";
import { Pipeline, type Phase } from "@/components/Pipeline";
import { Workspace } from "@/components/Workspace";
import { Library } from "@/components/Library";
import { Settings } from "@/components/Settings";
import { analyze } from "@/lib/analyze";
import { decodeToMono16k } from "@/lib/audio";
import { makeCards, type Card } from "@/lib/cards";
import { deleteRecap, getRecap, listRecaps, newId, saveRecap, updateCards, type LibraryItem } from "@/lib/library";
import { DEFAULT_CONFIG, isAIReady, loadConfig, PROVIDERS, saveConfig, type AIConfig } from "@/lib/llm";
import { textToWords, wordsToSegments } from "@/lib/segments";
import type { WorkerIn, WorkerOut } from "@/lib/transcribe.worker";
import type { Recap, Segment, Word } from "@/lib/types";

export type Media = { url: string; kind: "video" | "audio"; name: string } | null;

export default function Home() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [detail, setDetail] = useState("");
  const [device, setDevice] = useState("");
  const [media, setMedia] = useState<Media>(null);
  const [words, setWords] = useState<Word[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [recap, setRecap] = useState<Recap | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [recapId, setRecapId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [config, setConfig] = useState<AIConfig>(DEFAULT_CONFIG);
  const [showSettings, setShowSettings] = useState(false);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const workerRef = useRef<Worker | null>(null);

  const refreshLibrary = useCallback(() => {
    listRecaps().then(setLibrary).catch(() => setLibrary([]));
  }, []);

  useEffect(() => {
    setConfig(loadConfig());
    refreshLibrary();
    return () => workerRef.current?.terminate();
  }, [refreshLibrary]);

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
    setError(""); setNote(""); setRecap(null); setWords([]); setSegments([]); setProgress(0); setDetail("");
    try {
      let w: Word[];
      let file: File | null = null;
      if (source.kind === "text") {
        setMedia(null);
        w = textToWords(source.text);
      } else {
        file = source.file;
        const url = URL.createObjectURL(file);
        setMedia({ url, kind: file.type.startsWith("video") ? "video" : "audio", name: file.name });
        setPhase("decoding");
        const { samples } = await decodeToMono16k(file);
        w = await transcribe(samples, source.model);
      }
      const segs = wordsToSegments(w);
      if (!segs.length) throw new Error("No speech found in that recording.");
      setWords(w);
      setSegments(segs);
      setPhase("analyzing");
      const result = await analyze(segs, config, setDetail);
      const deck = makeCards(result.recap);
      const id = newId();
      setRecap(result.recap);
      setCards(deck);
      setRecapId(id);
      setNote(result.note ?? "");
      setPhase("ready");
      // Save to the library in the background; a failure here never blocks the recap.
      const kind = file ? (file.type.startsWith("video") ? "video" : "audio") : null;
      saveRecap({
        id, title: result.recap.title, createdAt: Date.now(), duration: segs[segs.length - 1].end,
        words: w, segments: segs, recap: result.recap, cards: deck,
        media: file, mediaKind: kind, mediaName: file?.name ?? null,
      }).then(({ savedMedia }) => {
        if (file && !savedMedia) setNote((n) => n || "Saved to your library without the media file (not enough browser storage).");
        refreshLibrary();
      }).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("idle");
    }
  }, [config, transcribe, refreshLibrary]);

  const openSaved = useCallback(async (id: string) => {
    const r = await getRecap(id);
    if (!r) return;
    if (media) URL.revokeObjectURL(media.url);
    setMedia(r.media && r.mediaKind ? { url: URL.createObjectURL(r.media), kind: r.mediaKind, name: r.mediaName ?? r.title } : null);
    setWords(r.words);
    setSegments(r.segments);
    setRecap(r.recap);
    setCards(r.cards);
    setRecapId(r.id);
    setNote(r.mediaKind && !r.media ? "The original media wasn't saved, so clips can't be exported for this one." : "");
    setPhase("ready");
  }, [media]);

  const changeCards = useCallback((next: Card[]) => {
    setCards(next);
    if (recapId) updateCards(recapId, next).then(refreshLibrary).catch(() => {});
  }, [recapId, refreshLibrary]);

  const reset = () => {
    if (media) URL.revokeObjectURL(media.url);
    setMedia(null); setRecap(null); setWords([]); setSegments([]); setRecapId(null); setPhase("idle");
    refreshLibrary();
  };

  const aiOn = isAIReady(config);

  return (
    <main className="relative min-h-screen overflow-x-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(ellipse_at_top,rgba(124,108,255,0.22),transparent_65%)]" />
      <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-4 py-5 sm:px-6">
        <button onClick={reset} className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-sm font-bold text-white">R</span>
          Recap
        </button>
        <button onClick={() => setShowSettings(true)} className="flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/60 transition hover:border-white/30 hover:text-white">
          <span className={`h-2 w-2 rounded-full ${aiOn ? "bg-emerald-400" : "bg-amber-400"}`} />
          AI: <span className="font-mono text-white/85">{aiOn ? PROVIDERS[config.provider].label : "offline"}</span>
          <span className="text-white/35">· change</span>
        </button>
      </header>

      <div className="relative z-10 mx-auto max-w-7xl px-4 pb-20 sm:px-6">
        {phase === "ready" && recap ? (
          <Workspace media={media} words={words} segments={segments} recap={recap} note={note}
            config={config} cards={cards} onCardsChange={changeCards} />
        ) : phase === "idle" ? (
          <>
            <Uploader onStart={start} error={error} aiOn={aiOn} onOpenSettings={() => setShowSettings(true)} />
            <Library items={library} onOpen={openSaved} onDelete={(id) => deleteRecap(id).then(refreshLibrary)} />
          </>
        ) : (
          <Pipeline phase={phase} progress={progress} device={device} words={words} mediaName={media?.name} detail={detail} />
        )}
      </div>

      {showSettings && (
        <Settings config={config} onClose={() => setShowSettings(false)} onSave={(c) => { setConfig(c); saveConfig(c); }} />
      )}
    </main>
  );
}
