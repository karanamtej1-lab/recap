# Recap

**Sat through it once. Never rewatch it again.**

**Live: [karanamtej1-lab.github.io/recap](https://karanamtej1-lab.github.io/recap/)** (click *Try a sample lecture*)

Drop in a lecture or meeting recording. Recap makes the transcript in your browser, then gives you:

- **Notes**: a TL;DR, key points with timestamps, notes organized by chapter, key terms, and to-dos and deadlines
- **A quiz** where every answer links back to the moment it was taught
- **Flashcards with spaced review**: terms and quiz questions become a deck scheduled with SM-2, with Anki export
- **Ask**: question-and-answer over the recording, with clickable timestamp citations
- **Scored vertical clips**: the best 15–60 second moments, rendered at 9:16 with word-by-word captions and exported as MP4 or WebM
- **A library**: every recap is saved in your browser (including the video), so reopening one is instant

Recap is a fully static site. There's no server: transcription, analysis, clip rendering, and storage all happen in the browser tab.

## How it works

```
file / mic / sample ──► decodeAudioData (16 kHz mono)
                     ──► Web Worker: Whisper (transformers.js, WebGPU → WASM fallback)
                         30 s windows, word timestamps, streamed live to the UI
                     ──► words → sentence segments
                     ──► analyze():
                           no key      → offline engine (TextRank + TextTiling + cue phrases)
                           short talk  → one AI call
                           long talk   → ~30-min parts in parallel → local merge + 1 small title/TL;DR call
                     ──► normalize: snap times to real segments, clamp sub-scores,
                         recompute clip scores, drop impossible ranges
                     ──► IndexedDB library ──► Workspace: Notes · Clips · Quiz · Cards · Ask
```

- **Bring your own key.** Claude or Gemini (both allow requests straight from the browser), or any OpenAI-compatible endpoint, such as OpenRouter or Ollama / LM Studio on your own machine. The key is stored in `localStorage` and sent only to that provider. Only the transcript is sent, never the audio. (The publik API doesn't allow browser requests: its CORS preflight returns no `Access-Control-Allow-Origin` header. So it can't be used from a static site.)
- **Nothing breaks without a key.** `lib/offline.ts` ranks sentences with TextRank (`lib/textrank.ts`), finds chapter breaks with TextTiling and snaps them to spoken cues like "So here's…" or "Now, …", and builds a fill-in-the-blank quiz from repeated two-word phrases. If an AI call fails, Recap falls back to this engine and shows why.
- **The model never sets the final score.** It returns four 0–10 sub-scores (hook, insight, standalone, energy). The 0–100 score is computed in `lib/format.ts`.
- **Long lectures are split up.** Transcripts over ~28k characters (about 30 minutes) are analyzed in parts, 3 at a time. Picking the best clips, removing duplicate terms, and spreading quiz questions across parts are all done locally.
- **Clips are rendered on a canvas.** A hidden `<video>` draws into a 720×1280 canvas (Fit mode keeps slides readable; Fill mode crops to the center), and `MediaRecorder` captures the canvas plus the audio.

## Run it

```bash
npm install
npm run dev        # http://localhost:3200
```

The first run downloads the Whisper model (~40 MB); after that it's cached. To turn on AI, click **AI: offline · change** and paste a key.

## Deploy

```bash
npm run deploy     # static export with basePath /recap → force-pushes out/ to gh-pages
```

GitHub Pages serves the `gh-pages` branch. The script adds `.nojekyll`; without it, Pages would drop the `_next/` folder.

`npm run sample` rebuilds `public/sample/lecture.mp4` from `scripts/lecture.txt`. It needs macOS `say`, `ffmpeg`, and Python with Pillow.

## Notes

- transformers.js is loaded from jsDelivr at runtime (pinned to 4.3.1). Bundling it breaks Next's minifier on onnxruntime's ES-module workers.
- Big videos may not fit in browser storage. If so, the recap is still saved without the media file, and you're told.
