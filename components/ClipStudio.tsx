"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, Pause, Play, Crosshair } from "lucide-react";
import type { Media } from "@/app/page";
import { formatTime, SCORE_WEIGHTS } from "@/lib/format";
import type { Highlight, ScoreBreakdown, Word } from "@/lib/types";

const W = 720;
const H = 1280; // 9:16 vertical
const CAPTION_GROUP = 4;

type Mode = "idle" | "preview" | "export";

// Split the clip's words into short caption groups, breaking early on punctuation.
function captionGroups(words: Word[]): Word[][] {
  const groups: Word[][] = [];
  let cur: Word[] = [];
  for (const w of words) {
    cur.push(w);
    if (cur.length >= CAPTION_GROUP || /[.,!?;:]$/.test(w.text)) { groups.push(cur); cur = []; }
  }
  if (cur.length) groups.push(cur);
  return groups;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = word; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function pickMime(): string {
  const options = ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"];
  return options.find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) ?? "video/webm";
}

export function ClipStudio({ media, words, highlights, seek }: {
  media: Media; words: Word[]; highlights: Highlight[]; seek: (t: number) => void;
}) {
  const [sel, setSel] = useState(0);
  const [mode, setMode] = useState<Mode>("idle");
  const [downloads, setDownloads] = useState<Record<number, { url: string; ext: string }>>({});
  const canvas = useRef<HTMLCanvasElement>(null);
  const el = useRef<HTMLVideoElement>(null);
  const audio = useRef<{ ctx: AudioContext; dest: MediaStreamAudioDestinationNode; analyser: AnalyserNode } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const [framing, setFraming] = useState<"fit" | "fill">("fit");
  const modeRef = useRef<Mode>("idle");
  modeRef.current = mode;
  const framingRef = useRef(framing);
  framingRef.current = framing;

  const h = highlights[sel];
  const groups = useMemo(() => (h ? captionGroups(words.filter((w) => w.end > h.start && w.start < h.end)) : []), [h, words]);

  const ensureAudio = () => {
    if (audio.current || !el.current) return audio.current;
    const ctx = new AudioContext();
    const src = ctx.createMediaElementSource(el.current); // allowed once per element
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    const dest = ctx.createMediaStreamDestination();
    src.connect(analyser);
    analyser.connect(ctx.destination);
    src.connect(dest);
    audio.current = { ctx, dest, analyser };
    return audio.current;
  };

  const stop = useCallback(() => {
    el.current?.pause();
    if (modeRef.current === "export" && recorder.current?.state === "recording") recorder.current.stop();
    setMode("idle");
  }, []);

  // Park the hidden player on the selected clip's first frame.
  useEffect(() => {
    stop();
    if (el.current && h) el.current.currentTime = h.start;
  }, [sel, h, stop]);

  // Render loop: draws the vertical frame every animation frame.
  useEffect(() => {
    let raf = 0;
    const bins = new Uint8Array(64);
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = canvas.current?.getContext("2d");
      const v = el.current;
      if (!c || !h) return;
      const t = v?.currentTime ?? h.start;
      if (modeRef.current !== "idle" && t >= h.end) stop();

      // Background: center-cropped video, or an audio visualizer.
      c.fillStyle = "#0b0c10";
      c.fillRect(0, 0, W, H);
      if (media?.kind === "video" && v && v.videoWidth) {
        const cover = H / v.videoHeight;
        const dw = v.videoWidth * cover;
        if (framingRef.current === "fill") {
          c.drawImage(v, (W - dw) / 2, 0, dw, H);
        } else {
          // Fit: the whole frame (slides stay readable) over a blurred, dimmed copy of itself.
          c.filter = "blur(36px) brightness(0.45)";
          c.drawImage(v, (W - dw) / 2, 0, dw, H);
          c.filter = "none";
          const fh = (W / v.videoWidth) * v.videoHeight;
          c.drawImage(v, 0, H * 0.43 - fh / 2, W, fh);
        }
      } else {
        const g = c.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, "#2a1f5c");
        g.addColorStop(1, "#0b0c10");
        c.fillStyle = g;
        c.fillRect(0, 0, W, H);
        audio.current?.analyser.getByteFrequencyData(bins);
        const cx = W / 2, cy = H * 0.45;
        for (let i = 0; i < 48; i++) {
          const a = (i / 48) * Math.PI * 2;
          const len = 30 + (bins[i % 32] / 255) * 160;
          c.strokeStyle = `hsla(${250 + i * 2}, 90%, 72%, 0.85)`;
          c.lineWidth = 8;
          c.lineCap = "round";
          c.beginPath();
          c.moveTo(cx + Math.cos(a) * 120, cy + Math.sin(a) * 120);
          c.lineTo(cx + Math.cos(a) * (120 + len), cy + Math.sin(a) * (120 + len));
          c.stroke();
        }
      }
      // Legibility gradients.
      const top = c.createLinearGradient(0, 0, 0, 420);
      top.addColorStop(0, "rgba(0,0,0,0.65)"); top.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = top; c.fillRect(0, 0, W, 420);
      const bot = c.createLinearGradient(0, H - 560, 0, H);
      bot.addColorStop(0, "rgba(0,0,0,0)"); bot.addColorStop(1, "rgba(0,0,0,0.75)");
      c.fillStyle = bot; c.fillRect(0, H - 560, W, 560);

      // Hook card.
      c.font = "800 46px Inter, system-ui, sans-serif";
      const hookLines = wrap(c, h.hook, W - 160).slice(0, 3);
      const boxH = hookLines.length * 58 + 44;
      roundRect(c, 60, 120, W - 120, boxH, 22);
      c.fillStyle = "rgba(255,255,255,0.96)"; c.fill();
      c.fillStyle = "#0b0c10"; c.textAlign = "center"; c.textBaseline = "top";
      hookLines.forEach((l, i) => c.fillText(l, W / 2, 142 + i * 58));

      // Word-by-word captions.
      const group = groups.find((g) => t >= g[0].start - 0.05 && t < g[g.length - 1].end + 0.25);
      if (group) {
        c.font = "900 66px Inter, system-ui, sans-serif";
        const lines = wrap(c, group.map((w) => w.text).join(" "), W - 120);
        let wi = 0;
        lines.forEach((line, li) => {
          const y = H * 0.66 + li * 82;
          const parts = line.split(" ");
          const total = c.measureText(line).width;
          let x = (W - total) / 2;
          c.textAlign = "left";
          for (const p of parts) {
            const w = group[wi++];
            const active = w && t >= w.start && t < w.end + 0.08;
            c.lineWidth = 12; c.strokeStyle = "rgba(0,0,0,0.9)"; c.lineJoin = "round";
            c.strokeText(p, x, y);
            c.fillStyle = active ? "#ffe14d" : "#ffffff";
            c.fillText(p, x, y);
            x += c.measureText(`${p} `).width;
          }
        });
      }

      // Progress + badge.
      const pct = Math.min(1, Math.max(0, (t - h.start) / (h.end - h.start)));
      c.fillStyle = "rgba(255,255,255,0.2)"; c.fillRect(60, H - 90, W - 120, 8);
      c.fillStyle = "#7c6cff"; c.fillRect(60, H - 90, (W - 120) * pct, 8);
      c.font = "600 26px Inter, system-ui, sans-serif"; c.textAlign = "left"; c.fillStyle = "rgba(255,255,255,0.8)";
      c.fillText(`made with Recap`, 60, H - 140);
      c.textAlign = "right";
      c.fillText(`clip score ${h.score}`, W - 60, H - 140);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [h, groups, media, stop]);

  const preview = async () => {
    const v = el.current;
    if (!v || !h) return;
    if (mode === "preview") { stop(); return; }
    const a = ensureAudio();
    await a?.ctx.resume();
    if (v.currentTime < h.start || v.currentTime >= h.end - 0.2) v.currentTime = h.start;
    setMode("preview");
    await v.play();
  };

  const exportClip = async () => {
    const v = el.current, cv = canvas.current;
    if (!v || !cv || !h) return;
    const a = ensureAudio();
    await a?.ctx.resume();
    v.pause();
    v.currentTime = h.start;
    await new Promise((r) => v.addEventListener("seeked", r, { once: true }));
    const stream = cv.captureStream(30);
    a?.dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
    const mime = pickMime();
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const index = sel;
    rec.onstop = () => {
      stream.getVideoTracks().forEach((tr) => tr.stop());
      const blob = new Blob(chunks, { type: mime.split(";")[0] });
      const url = URL.createObjectURL(blob);
      const ext = mime.startsWith("video/mp4") ? "mp4" : "webm";
      setDownloads((d) => ({ ...d, [index]: { url, ext } }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `recap-clip-${index + 1}.${ext}`;
      link.click();
    };
    recorder.current = rec;
    rec.start(250);
    setMode("export");
    await v.play();
  };

  if (!highlights.length) return <p className="glass rounded-xl p-5 text-sm text-white/50">No clip-worthy moments found.</p>;

  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_260px]">
      <div className="space-y-3">
        {highlights.map((hl, i) => (
          <button key={i} onClick={() => setSel(i)}
            className={`glass w-full rounded-xl p-4 text-left transition ${i === sel ? "glow" : "hover:border-white/20"}`}>
            <div className="flex items-start gap-4">
              <ScoreRing score={hl.score} />
              <div className="min-w-0 flex-1">
                <p className="font-mono text-xs text-accent-soft">{formatTime(hl.start)}–{formatTime(hl.end)} · {Math.round(hl.end - hl.start)}s</p>
                <p className="mt-0.5 font-semibold text-white">{hl.title}</p>
                <p className="mt-1 text-xs italic text-white/55">“{hl.hook}”</p>
              </div>
            </div>
            {i === sel && (
              <div className="mt-4 space-y-3 border-t border-white/5 pt-4">
                <Breakdown b={hl.breakdown} />
                <p className="text-xs leading-relaxed text-white/60"><span className="font-medium text-white/80">Why: </span>{hl.reason}</p>
                <button onClick={(e) => { e.stopPropagation(); seek(hl.start); }} className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white">
                  <Crosshair className="h-3.5 w-3.5" /> Jump to this moment in the full recording
                </button>
              </div>
            )}
          </button>
        ))}
      </div>

      <div className="md:sticky md:top-4 md:h-fit">
        <div className="relative mx-auto w-full max-w-[260px] overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl">
          <canvas ref={canvas} width={W} height={H} className="block aspect-[9/16] w-full" />
          {mode === "export" && (
            <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded-full bg-hot px-2 py-0.5 text-[10px] font-semibold text-white">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> REC
            </div>
          )}
        </div>
        {media ? (
          <>
            {media.kind === "video" && (
              <div className="mx-auto mt-3 flex max-w-[260px] rounded-lg bg-white/5 p-0.5 text-xs">
                {(["fit", "fill"] as const).map((f) => (
                  <button key={f} onClick={() => setFraming(f)} disabled={mode === "export"} title={f === "fit" ? "Whole frame - keeps slides readable" : "Crop to the center - best for a talking head"}
                    className={`flex-1 rounded-md py-1.5 transition ${framing === f ? "bg-white/10 text-white" : "text-white/50 hover:text-white"}`}>
                    {f === "fit" ? "Fit frame" : "Fill & crop"}
                  </button>
                ))}
              </div>
            )}
            <video ref={el} src={media.url} playsInline preload="auto" className="pointer-events-none absolute h-px w-px opacity-0" />
            <div className="mx-auto mt-3 grid max-w-[260px] grid-cols-2 gap-2">
              <button onClick={preview} disabled={mode === "export"} className="flex items-center justify-center gap-1.5 rounded-lg border border-white/10 py-2 text-sm hover:bg-white/5 disabled:opacity-40">
                {mode === "preview" ? <><Pause className="h-4 w-4" /> Pause</> : <><Play className="h-4 w-4" /> Preview</>}
              </button>
              <button onClick={exportClip} disabled={mode !== "idle"} className="flex items-center justify-center gap-1.5 rounded-lg bg-accent py-2 text-sm font-medium text-white disabled:opacity-50">
                {mode === "export" ? <><Loader2 className="h-4 w-4 animate-spin" /> Rendering</> : <><Download className="h-4 w-4" /> Export</>}
              </button>
            </div>
            {downloads[sel] && (
              <a href={downloads[sel].url} download={`recap-clip-${sel + 1}.${downloads[sel].ext}`} className="mx-auto mt-2 block max-w-[260px] text-center text-xs text-accent-soft underline">
                Download again (.{downloads[sel].ext})
              </a>
            )}
            <p className="mx-auto mt-2 max-w-[260px] text-center text-[11px] text-white/35">Rendered in your browser in real time. Nothing is uploaded.</p>
          </>
        ) : (
          <p className="mx-auto mt-3 max-w-[260px] text-center text-xs text-white/45">Clip export needs the original audio or video. Pasted transcripts still get scored moments.</p>
        )}
      </div>
    </div>
  );
}

function ScoreRing({ score }: { score: number }) {
  const r = 22, c = 2 * Math.PI * r;
  const color = score >= 75 ? "#34d399" : score >= 55 ? "#a99fff" : "#fbbf24";
  return (
    <div className="relative h-14 w-14 shrink-0">
      <svg viewBox="0 0 56 56" className="h-14 w-14 -rotate-90">
        <circle cx="28" cy="28" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="5" />
        <circle cx="28" cy="28" r={r} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-sm font-bold">{score}</span>
    </div>
  );
}

const LABELS: Record<keyof ScoreBreakdown, string> = { hook: "Hook", insight: "Insight", standalone: "Standalone", energy: "Energy" };

function Breakdown({ b }: { b: ScoreBreakdown }) {
  return (
    <div className="space-y-1.5">
      {(Object.keys(LABELS) as (keyof ScoreBreakdown)[]).map((k) => (
        <div key={k} className="flex items-center gap-2 text-xs">
          <span className="w-20 text-white/55">{LABELS[k]} <span className="text-white/30">×{SCORE_WEIGHTS[k]}</span></span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-accent" style={{ width: `${b[k] * 10}%` }} />
          </div>
          <span className="w-8 text-right font-mono text-white/70">{b[k].toFixed(0)}/10</span>
        </div>
      ))}
    </div>
  );
}
