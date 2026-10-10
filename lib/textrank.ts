// Two classic NLP algorithms that make the offline engine's notes noticeably better,
// with no model and no network:
// - TextRank (Mihalcea & Tarau, 2004): rank sentences by how much they "agree" with the
//   rest of the talk, PageRank-style, over TF-IDF cosine similarity.
// - TextTiling (Hearst, 1997): find chapter breaks where the vocabulary of the next few
//   sentences stops overlapping with the previous few.

export type Vec = Map<string, number>;

export function tfidf(docs: string[][]): Vec[] {
  const df = new Map<string, number>();
  for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) ?? 0) + 1);
  const n = docs.length;
  return docs.map((d) => {
    const tf = new Map<string, number>();
    for (const w of d) tf.set(w, (tf.get(w) ?? 0) + 1);
    const v: Vec = new Map();
    let norm = 0;
    for (const [w, c] of tf) {
      const x = (1 + Math.log(c)) * Math.log(1 + n / (df.get(w) ?? 1));
      v.set(w, x);
      norm += x * x;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [w, x] of v) v.set(w, x / norm);
    return v;
  });
}

export function cosine(a: Vec, b: Vec): number {
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [w, x] of small) dot += x * (big.get(w) ?? 0);
  return dot; // vectors are unit length
}

function addVecs(vs: Vec[]): Vec {
  const out: Vec = new Map();
  for (const v of vs) for (const [w, x] of v) out.set(w, (out.get(w) ?? 0) + x);
  let norm = 0;
  for (const x of out.values()) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (const [w, x] of out) out.set(w, x / norm);
  return out;
}

export function textRank(vecs: Vec[], damping = 0.85, iterations = 40): number[] {
  const n = vecs.length;
  if (n === 0) return [];
  // Long talks: only link sentences within a window, keeping this O(n·w) instead of O(n²).
  const window = n > 600 ? 150 : n;
  const edges: { j: number; w: number }[][] = Array.from({ length: n }, () => []);
  const outSum = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < Math.min(n, i + window); j++) {
      const w = cosine(vecs[i], vecs[j]);
      if (w > 0.05) {
        edges[i].push({ j, w });
        edges[j].push({ j: i, w });
        outSum[i] += w;
        outSum[j] += w;
      }
    }
  }
  let score = new Array(n).fill(1 / n);
  for (let it = 0; it < iterations; it++) {
    const next = new Array(n).fill((1 - damping) / n);
    for (let i = 0; i < n; i++) {
      if (!outSum[i]) continue;
      for (const { j, w } of edges[i]) next[j] += (damping * score[i] * w) / outSum[i];
    }
    score = next;
  }
  return score;
}

// Indices where a new topic starts (always includes 0).
export function topicBreaks(vecs: Vec[], starts: number[], opts = { block: 4, minGapSec: 45, maxChapters: 8 }): number[] {
  const n = vecs.length;
  const { block, minGapSec, maxChapters } = opts;
  if (n < block * 2 + 2) return [0];
  const gaps: { i: number; sim: number }[] = [];
  for (let i = block; i <= n - block; i++) {
    gaps.push({ i, sim: cosine(addVecs(vecs.slice(i - block, i)), addVecs(vecs.slice(i, i + block))) });
  }
  // Depth score: how far a gap dips below the peaks on either side of it.
  const depth = gaps.map((g, k) => {
    let l = g.sim, r = g.sim;
    for (let a = k - 1; a >= 0 && gaps[a].sim >= l; a--) l = gaps[a].sim;
    for (let b = k + 1; b < gaps.length && gaps[b].sim >= r; b++) r = gaps[b].sim;
    return { i: g.i, d: l - g.sim + (r - g.sim) };
  });
  const mean = depth.reduce((s, x) => s + x.d, 0) / depth.length;
  const sd = Math.sqrt(depth.reduce((s, x) => s + (x.d - mean) ** 2, 0) / depth.length);
  const candidates = depth.filter((x) => x.d > mean + 0.5 * sd).sort((a, b) => b.d - a.d);
  const breaks = [0];
  for (const c of candidates) {
    if (breaks.length >= maxChapters) break;
    const farFromEnd = starts[n - 1] - starts[c.i] >= minGapSec / 2;
    if (farFromEnd && breaks.every((b) => Math.abs(starts[c.i] - starts[b]) >= minGapSec)) breaks.push(c.i);
  }
  return breaks.sort((a, b) => a - b);
}
