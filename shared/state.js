import { portraitText } from "./portrait.js";

export const STAGE_INTACT = 0;
export const STAGE_FADED = 1;
export const STAGE_GLITCHED = 2;
export const STAGE_MISSING = 3;

export const STATE_KEY = "state";
export const REPAIRS_PER_HOUR = 20;

const HOUR_MS = 60 * 60 * 1000;

export const characters = Array.from(portraitText);

// FNV-1a is enough to notice that the text has been edited; it is not a security boundary.
export function hashText(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

const textHash = hashText(portraitText);

const isWhitespace = (ch) => /\s/.test(ch);

export const wordRanges = (() => {
  const ranges = [];
  let start = -1;
  characters.forEach((ch, i) => {
    if (isWhitespace(ch)) {
      if (start !== -1) ranges.push([start, i]);
      start = -1;
    } else if (start === -1) {
      start = i;
    }
  });
  if (start !== -1) ranges.push([start, characters.length]);
  return ranges;
})();

export function encodeCells(cells) {
  let binary = "";
  for (const byte of cells) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeCells(encoded) {
  const binary = atob(encoded);
  const cells = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) cells[i] = binary.charCodeAt(i);
  return cells;
}

export function isIntact(cells) {
  return cells.every((stage) => stage === STAGE_INTACT);
}

export function isWordDamaged(cells, wordIndex) {
  const [start, end] = wordRanges[wordIndex];
  for (let i = start; i < end; i++) {
    if (cells[i] !== STAGE_INTACT) return true;
  }
  return false;
}

export function repairWord(cells, wordIndex) {
  const [start, end] = wordRanges[wordIndex];
  cells.fill(STAGE_INTACT, start, end);
}

function freshState(previous) {
  return {
    textHash,
    cells: new Uint8Array(characters.length),
    repairs: previous?.repairs ?? 0,
    lastIntact: new Date().toISOString(),
  };
}

export async function loadState(kv) {
  const stored = await kv.get(STATE_KEY, "json");
  if (!stored || stored.textHash !== textHash) return freshState(stored);
  return {
    textHash: stored.textHash,
    cells: decodeCells(stored.cells),
    repairs: stored.repairs,
    lastIntact: stored.lastIntact,
  };
}

export async function saveState(kv, state) {
  await kv.put(
    STATE_KEY,
    JSON.stringify({
      textHash: state.textHash,
      cells: encodeCells(state.cells),
      repairs: state.repairs,
      lastIntact: state.lastIntact,
    }),
  );
}

function randomInt(maxExclusive) {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] % maxExclusive;
}

export function applyDecay(state, count) {
  const candidates = [];
  characters.forEach((ch, i) => {
    if (!isWhitespace(ch) && state.cells[i] < STAGE_MISSING) candidates.push(i);
  });
  if (candidates.length === 0) return 0;

  if (isIntact(state.cells)) state.lastIntact = new Date().toISOString();

  // Partial Fisher-Yates: shuffle only the first `picks` slots so each character is chosen at most once.
  const picks = Math.min(count, candidates.length);
  for (let i = 0; i < picks; i++) {
    const j = i + randomInt(candidates.length - i);
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    state.cells[candidates[i]] += 1;
  }
  return picks;
}

export function currentHourBucket(now = Date.now()) {
  return Math.floor(now / HOUR_MS);
}

export function hourBucketEnd(bucket) {
  return new Date((bucket + 1) * HOUR_MS).toISOString();
}

export async function hashVisitor(ip, salt) {
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest).slice(0, 16), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function rateKey(visitorHash, bucket) {
  return `rate:${visitorHash}:${bucket}`;
}

export async function readAllowance(kv, visitorHash, bucket) {
  const used = Number(await kv.get(rateKey(visitorHash, bucket))) || 0;
  return Math.max(0, REPAIRS_PER_HOUR - used);
}

export function publicState(state, allowance, bucket) {
  return {
    text: portraitText,
    cells: encodeCells(state.cells),
    repairs: state.repairs,
    intact: isIntact(state.cells),
    lastIntact: state.lastIntact,
    allowance,
    allowanceResetsAt: hourBucketEnd(bucket),
  };
}
