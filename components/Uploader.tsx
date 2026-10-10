"use client";

import { useRef, useState } from "react";
import { FileText, Mic, PlayCircle, Square, Upload, Lock, Sparkles, Scissors, GraduationCap, Layers } from "lucide-react";

export type Source =
  | { kind: "file"; file: File; model: string }
  | { kind: "text"; text: string };

const SAMPLE_FALLBACK = "https://raw.githubusercontent.com/karanamtej1-lab/recap/main/public/sample/lecture.mp4";

const MODELS = [
  { id: "Xenova/whisper-tiny.en", label: "Fast", hint: "~40 MB, quickest" },
  { id: "Xenova/whisper-base.en", label: "Accurate", hint: "~80 MB, better words" },
];

export function Uploader({ onStart, error, aiOn, onOpenSettings }: { onStart: (s: Source) => void; error: string; aiOn: boolean; onOpenSettings: () => void }) {
  const [model, setModel] = useState(MODELS[0].id);
  const [dragging, setDragging] = useState(false);
  const [recording, setRecording] = useState<MediaRecorder | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState("");
  const [loadingSample, setLoadingSample] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setInterval>>();

  const useFile = (file?: File | null) => {
    if (file && (file.type.startsWith("audio") || file.type.startsWith("video"))) onStart({ kind: "file", file, model });
  };

  const record = async () => {
    if (recording) { recording.stop(); return; }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream);
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => parts.push(e.data);
    rec.onstop = () => {
      clearInterval(timer.current);
      stream.getTracks().forEach((t) => t.stop());
      setRecording(null);
      const blob = new Blob(parts, { type: rec.mimeType || "audio/webm" });
      useFile(new File([blob], `Recording ${new Date().toLocaleTimeString()}.webm`, { type: blob.type }));
    };
    rec.start();
    setSeconds(0);
    timer.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    setRecording(rec);
  };

  const sample = async () => {
    setLoadingSample(true);
    try {
      // Bundled locally; the hosted build fetches it from the GitHub repo instead.
      let res = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/sample/lecture.mp4`);
      if (!res.ok) res = await fetch(SAMPLE_FALLBACK);
      const blob = await res.blob();
      useFile(new File([blob], "Sample lecture — How memory works.mp4", { type: "video/mp4" }));
    } finally {
      setLoadingSample(false);
    }
  };

  return (
    <section className="mx-auto max-w-3xl pt-10 sm:pt-16">
      <div className="text-center">
        <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
          <Lock className="h-3.5 w-3.5" /> Transcribed on your device — audio never uploaded
        </div>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">
          Sat through it once.
          <br />
          <span className="bg-gradient-to-r from-accent-soft via-white to-hot bg-clip-text text-transparent">Never rewatch it again.</span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base text-white/60 sm:text-lg">
          Drop in a lecture or meeting. Recap writes the notes, quizzes you, answers questions with timestamps,
          and cuts the best moments into vertical clips.
        </p>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); useFile(e.dataTransfer.files[0]); }}
        className={`glass mt-10 rounded-2xl p-6 transition sm:p-8 ${dragging ? "glow" : ""}`}
      >
        {pasting ? (
          <div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste a transcript or lecture notes…"
              className="h-56 w-full resize-none rounded-xl border border-white/10 bg-ink-950/60 p-4 text-sm outline-none focus:border-accent"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={() => setPasting(false)} className="rounded-lg px-4 py-2 text-sm text-white/60 hover:text-white">Cancel</button>
              <button
                disabled={text.trim().split(/\s+/).length < 30}
                onClick={() => onStart({ kind: "text", text })}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                Recap this text
              </button>
            </div>
          </div>
        ) : (
          <>
            <button
              onClick={() => inputRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-white/15 py-12 text-white/70 transition hover:border-accent hover:text-white"
            >
              <Upload className="h-8 w-8" />
              <span className="text-base font-medium">Drop a video or audio file, or click to browse</span>
              <span className="text-xs text-white/40">MP4 · MOV · WebM · MP3 · M4A · WAV</span>
            </button>
            <input ref={inputRef} type="file" accept="audio/*,video/*" hidden onChange={(e) => useFile(e.target.files?.[0])} />

            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <button onClick={record} className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm transition ${recording ? "border-hot bg-hot/10 text-hot" : "border-white/10 hover:bg-white/5"}`}>
                {recording ? <><Square className="h-4 w-4" /> Stop · {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</> : <><Mic className="h-4 w-4" /> Record live</>}
              </button>
              <button onClick={sample} disabled={loadingSample} className="flex items-center justify-center gap-2 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent-soft transition hover:bg-accent/20">
                <PlayCircle className="h-4 w-4" /> {loadingSample ? "Loading…" : "Try a sample lecture"}
              </button>
              <button onClick={() => setPasting(true)} className="flex items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-sm transition hover:bg-white/5">
                <FileText className="h-4 w-4" /> Paste a transcript
              </button>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-xs text-white/50">
              Speech model:
              {MODELS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setModel(m.id)}
                  title={m.hint}
                  className={`rounded-full border px-3 py-1 transition ${model === m.id ? "border-accent bg-accent/15 text-white" : "border-white/10 hover:border-white/30"}`}
                >
                  {m.label} <span className="text-white/40">· {m.hint}</span>
                </button>
              ))}
            </div>
          </>
        )}
        {!pasting && (
          <p className="mt-3 text-center text-xs text-white/40">
            <Sparkles className="mr-1 inline h-3.5 w-3.5 text-accent-soft" />
            {aiOn ? "AI notes are on." : "Works offline with no key."}{" "}
            <button onClick={onOpenSettings} className="text-accent-soft underline-offset-2 hover:underline">
              {aiOn ? "Change AI engine" : "Add a Claude or Gemini key for AI notes"}
            </button>
          </p>
        )}
        {error && <p className="mt-4 rounded-lg bg-hot/10 px-4 py-2 text-sm text-hot">{error}</p>}
      </div>

      <div className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { icon: GraduationCap, title: "Notes & quiz", body: "Structured study notes, key terms, and a quiz that links each answer back to the moment it was taught." },
          { icon: Scissors, title: "Scored clips", body: "The best 15–60s moments, cut vertical with word-by-word captions. Every score shows its work." },
          { icon: Layers, title: "Flashcards", body: "Terms and quiz questions become a spaced-repetition deck that tells you when to review. Exports to Anki." },
        ].map(({ icon: Icon, title, body }) => (
          <div key={title} className="glass rounded-xl p-4">
            <Icon className="h-5 w-5 text-accent-soft" />
            <h3 className="mt-2 text-sm font-semibold">{title}</h3>
            <p className="mt-1 text-xs leading-relaxed text-white/55">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
