// Decode any audio/video file the browser can play into 16 kHz mono samples for Whisper.
export async function decodeToMono16k(file: Blob): Promise<{ samples: Float32Array; duration: number }> {
  const buf = await file.arrayBuffer();
  const ctx = new AudioContext({ sampleRate: 16000 });
  try {
    const audio = await ctx.decodeAudioData(buf);
    const { numberOfChannels: n, length } = audio;
    const samples = new Float32Array(length);
    for (let c = 0; c < n; c++) {
      const data = audio.getChannelData(c);
      for (let i = 0; i < length; i++) samples[i] += data[i] / n;
    }
    return { samples, duration: audio.duration };
  } finally {
    ctx.close();
  }
}
