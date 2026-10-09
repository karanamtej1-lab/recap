// Runs Whisper inside the browser (transformers.js + ONNX), off the main thread.
// Audio never leaves the device - the same local-first idea as WhimprFlow.
import type { AutomaticSpeechRecognitionPipeline, pipeline as Pipeline } from "@huggingface/transformers";
import type { Word } from "./types";

// Loaded from the CDN at runtime rather than bundled: onnxruntime-web ships ES-module
// workers and .wasm files that Next's bundler can't minify. Version pinned to package.json.
const TRANSFORMERS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1";
let lib: Promise<{ pipeline: typeof Pipeline }> | null = null;
const loadLib = () => (lib ??= import(/* webpackIgnore: true */ TRANSFORMERS_URL));

export type WorkerIn = { type: "transcribe"; audio: Float32Array; model: string };
export type WorkerOut =
  | { type: "loading"; progress: number }
  | { type: "ready"; device: string }
  | { type: "words"; words: Word[]; done: number; total: number }
  | { type: "done" }
  | { type: "error"; message: string };

const SAMPLE_RATE = 16000;
const WINDOW_S = 30; // Whisper's native window; we feed it one at a time for real progress

const post = (m: WorkerOut) => (self as unknown as Worker).postMessage(m);
const cache = new Map<string, Promise<AutomaticSpeechRecognitionPipeline>>();

async function load(model: string, device: "webgpu" | "wasm") {
  const { pipeline } = await loadLib();
  const key = `${model}:${device}`;
  if (!cache.has(key)) {
    const files = new Map<string, { loaded: number; total: number }>();
    const p = pipeline("automatic-speech-recognition", model, {
      device,
      dtype: device === "webgpu" ? "fp32" : "q8",
      progress_callback: (e: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (e.status !== "progress" || !e.file) return;
        files.set(e.file, { loaded: e.loaded ?? 0, total: e.total ?? 0 });
        let loaded = 0, total = 0;
        for (const f of files.values()) { loaded += f.loaded; total += f.total; }
        if (total) post({ type: "loading", progress: loaded / total });
      },
    }) as Promise<AutomaticSpeechRecognitionPipeline>;
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return cache.get(key)!;
}

// Whisper invents text on silence ("[BLANK_AUDIO]", "(music)", "Thank you.").
const NOISE = /^\s*[\[(][^\])]*[\])]\s*$/;

type Chunk = { text: string; timestamp: [number, number | null] };

self.onmessage = async (event: MessageEvent<WorkerIn>) => {
  const { audio, model } = event.data;
  try {
    let device: "webgpu" | "wasm" = "wasm";
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (gpu && (await gpu.requestAdapter().catch(() => null))) device = "webgpu";
    let asr: AutomaticSpeechRecognitionPipeline;
    try {
      asr = await load(model, device);
    } catch {
      device = "wasm";
      asr = await load(model, device);
    }
    post({ type: "ready", device });

    const step = WINDOW_S * SAMPLE_RATE;
    const total = Math.ceil(audio.length / step);
    let wordLevel = true;
    for (let i = 0; i < total; i++) {
      const offset = i * WINDOW_S;
      const slice = audio.subarray(i * step, Math.min(audio.length, (i + 1) * step));
      const windowEnd = offset + slice.length / SAMPLE_RATE;
      let chunks: Chunk[];
      try {
        chunks = ((await asr(slice, { return_timestamps: wordLevel ? "word" : true })) as { chunks?: Chunk[] }).chunks ?? [];
      } catch (err) {
        if (!wordLevel) throw err;
        wordLevel = false; // some backends can't align words; fall back to phrase timestamps
        chunks = ((await asr(slice, { return_timestamps: true })) as { chunks?: Chunk[] }).chunks ?? [];
      }
      const words: Word[] = [];
      for (const c of chunks) {
        const text = c.text.trim();
        if (!text || NOISE.test(text)) continue;
        const start = offset + (c.timestamp[0] ?? 0);
        const end = Math.max(start + 0.1, Math.min(windowEnd, offset + (c.timestamp[1] ?? WINDOW_S)));
        // Word mode gives one word per chunk. Phrase mode: spread the words across the
        // phrase, weighted by length (long words take longer to say).
        const parts = text.split(/\s+/);
        const weights = parts.map((w) => w.replace(/[^\w]/g, "").length + 2);
        const per = (end - start) / weights.reduce((a, b) => a + b, 0);
        let t = start;
        parts.forEach((w, k) => {
          words.push({ text: w, start: t, end: t + weights[k] * per });
          t += weights[k] * per;
        });
      }
      post({ type: "words", words, done: i + 1, total });
    }
    post({ type: "done" });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
