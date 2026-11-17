/** Default embedding dimensionality for local sqlite-vec index. */
export const EMBED_DIM = 256;

export const EMBED_MODEL_ID = "local-hash-v1";

/**
 * Deterministic bag-of-hashed-token/ngram embedding.
 * Keeps Markdown cards as source of truth; vectors are a derived index for
 * Retrieve-before-act similarity (works offline without cloud embed APIs).
 */
export function embedText(text: string, dim = EMBED_DIM): Float32Array {
  const vec = new Float32Array(dim);
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) return vec;

  const tokens = normalized.split(/[^a-z0-9_+#./:-]+/).filter((t) => t.length > 0);

  for (const tok of tokens) {
    add(vec, hash32(tok) % dim, 2);
    for (let n = 2; n <= Math.min(4, tok.length); n++) {
      for (let i = 0; i <= tok.length - n; i++) {
        add(vec, hash32(tok.slice(i, i + n)) % dim, 1);
      }
    }
  }

  // Character bigrams over the whole string for short selectors.
  for (let i = 0; i < normalized.length - 1; i++) {
    add(vec, hash32(normalized.slice(i, i + 2)) % dim, 0.35);
  }

  l2Normalize(vec);
  return vec;
}

export function embedKnowledgeCard(input: {
  title: string;
  body_md: string;
  tags?: string[];
  stack?: string | null;
  kind?: string;
}): Float32Array {
  const parts = [
    input.title,
    input.kind ?? "",
    input.stack ?? "",
    ...(input.tags ?? []),
    input.body_md,
  ];
  return embedText(parts.join("\n"));
}

export function embedRetrieveQuery(hints: {
  selector?: string | null;
  note?: string | null;
  componentNames?: string[];
  stack?: string | null;
}): Float32Array {
  const parts = [
    hints.selector ?? "",
    hints.note ?? "",
    hints.stack ?? "",
    ...(hints.componentNames ?? []),
  ];
  return embedText(parts.join("\n"));
}

function add(vec: Float32Array, idx: number, weight: number): void {
  const i = idx < 0 ? idx + vec.length : idx;
  vec[i]! += weight;
}

function l2Normalize(vec: Float32Array): void {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i]! * vec[i]!;
  const norm = Math.sqrt(sum);
  if (norm < 1e-12) return;
  for (let i = 0; i < vec.length; i++) vec[i]! /= norm;
}

function hash32(s: string): number {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
