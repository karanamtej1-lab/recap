# Recap

**Sat through it once. Never rewatch it again.**

Drop in a lecture or meeting recording. Recap makes a transcript in your browser, then gives you:

- **Study notes**: TL;DR, timestamped key points, structured notes, key terms, and to-dos and deadlines
- **A quiz** where every answer links back to the moment it was taught
- **Ask**: question-and-answer over the recording, with clickable timestamp citations
- **Scored vertical clips**: the best 15–60 second moments, rendered at 9:16 with word-by-word captions and exported as MP4 or WebM, all in the browser

It brings together ideas from the open-source projects in the publik ecosystem:

| Idea | Inspired by |
|---|---|
| Transcribing on your own machine; audio never leaves it | WhimprFlow (local-first dictation) |
| Scored clips that show their work (4 visible sub-scores, weighted) | publikclip |
| Asking questions about what you just watched or heard | cue |
| Choose your AI provider: Claude, Gemini, or the publik API | all of them |

## How it works

```
file / mic / sample ──► decodeAudioData (16 kHz mono)
                     ──► Web Worker: Whisper (transformers.js, WebGPU → WASM fallback)
                         30 s windows, word timestamps, streamed live to the UI
                     ──► words → sentence segments
                     ──► /api/analyze  (Claude → Gemini → publik → offline engine)
                     ──► normalize: snap times to real segments, clamp sub-scores,
                         recompute the clip score, drop impossible ranges
                     ──► Workspace: player · chapters · transcript · Notes / Clips / Quiz / Ask
```

- **Nothing breaks without a key.** `lib/offline.ts` is a statistical analyzer (keyword density, repeated two-word phrases, cue phrases). It writes notes, a fill-in-the-blank quiz, terms, deadlines, and clip scores with no API at all. If an AI call fails, the app falls back to it and shows why.
- **The model never sets the final score.** It returns four 0–10 sub-scores (hook, insight, standalone, energy). The 0–100 score is computed in `lib/format.ts` (`scoreFrom`), so every point can be traced back to a visible bar.
- **Clips are rendered with a canvas.** A hidden `<video>` draws into a 720×1280 canvas (Fit mode keeps slides readable; Fill mode crops to the center). `MediaRecorder` captures the canvas plus the audio graph.

## Run it

```bash
npm install
cp .env.example .env.local   # optional: add ONE of ANTHROPIC_API_KEY / GEMINI_API_KEY / PUBLIK_API_KEY
npm run dev                  # http://localhost:3200
```

Click **Try a sample lecture** for a 2-minute demo. The first run downloads the Whisper model (~40 MB); after that it's cached.

`npm run sample` rebuilds `public/sample/lecture.mp4` from `scripts/lecture.txt`. It needs macOS `say`, `ffmpeg`, and Python with Pillow.

## Notes

- Whisper runs in the browser through transformers.js, which is loaded from jsDelivr at runtime (pinned to 4.3.1). Bundling it breaks Next's minifier on onnxruntime's ES-module workers.
- Long recordings are fine for transcription. `/api/analyze` sends the whole transcript in one request, so with an AI key the cost grows with the recording's length.
- Deploys to Vercel as-is. `maxDuration` is 300 s for analysis, and AI keys are read only on the server.
