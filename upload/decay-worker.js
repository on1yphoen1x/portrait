var portraitText = `My name is Joe Taylor. I am seventeen, I live in England, and I am in the second year of A-Levels, which mostly means I spend my evenings writing Python and my mornings wishing I had gone to bed earlier.

Computer Science is the subject I would choose again without thinking about it. My NEA project has taken over more of my life than I expected. I have rewritten the database layer three times, and each version was the one I was sure would be final. I like the moment a program stops being a pile of functions and starts behaving like something with its own logic. I also like finding the bug that has been hiding in plain sight for two days, although I like it less while I am still looking.

Outside of school I build small websites, mostly to see whether an idea works. Some of them are useful. Most of them are not, but I learn something from every one, usually about what not to do next time. This page is one of those experiments.

The words you are reading are wearing away. Every hour a few letters fade, then lose their shape, then disappear entirely. Nothing here is permanent unless somebody decides it is worth keeping. If you see a word that has started to go, you can click it and put it back. Your repairs are shared with everyone who visits, so the state of this page is a record of how much attention it has been given.

I find that idea more honest than a normal about page. People are not fixed descriptions. We are kept up by the people around us, and we drift when nobody is paying attention.

If you have read this far, thank you. Repair a word on your way out.`;

var STAGE_INTACT = 0;
var STAGE_MISSING = 3;
var STATE_KEY = "state";
var HOUR_MS = 60 * 60 * 1e3;
var characters = Array.from(portraitText);
function hashText(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
var textHash = hashText(portraitText);
var isWhitespace = (ch) => /\s/.test(ch);
var wordRanges = (() => {
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
function encodeCells(cells) {
  let binary = "";
  for (const byte of cells) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function decodeCells(encoded) {
  const binary = atob(encoded);
  const cells = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) cells[i] = binary.charCodeAt(i);
  return cells;
}
function isIntact(cells) {
  return cells.every((stage) => stage === STAGE_INTACT);
}
function freshState(previous) {
  return {
    textHash,
    cells: new Uint8Array(characters.length),
    repairs: previous?.repairs ?? 0,
    lastIntact: (/* @__PURE__ */ new Date()).toISOString()
  };
}
async function loadState(kv) {
  const stored = await kv.get(STATE_KEY, "json");
  if (!stored || stored.textHash !== textHash) return freshState(stored);
  return {
    textHash: stored.textHash,
    cells: decodeCells(stored.cells),
    repairs: stored.repairs,
    lastIntact: stored.lastIntact
  };
}
async function saveState(kv, state) {
  await kv.put(
    STATE_KEY,
    JSON.stringify({
      textHash: state.textHash,
      cells: encodeCells(state.cells),
      repairs: state.repairs,
      lastIntact: state.lastIntact
    })
  );
}
function randomInt(maxExclusive) {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] % maxExclusive;
}
function applyDecay(state, count) {
  const candidates = [];
  characters.forEach((ch, i) => {
    if (!isWhitespace(ch) && state.cells[i] < STAGE_MISSING) candidates.push(i);
  });
  if (candidates.length === 0) return 0;
  if (isIntact(state.cells)) state.lastIntact = (/* @__PURE__ */ new Date()).toISOString();
  const picks = Math.min(count, candidates.length);
  for (let i = 0; i < picks; i++) {
    const j = i + randomInt(candidates.length - i);
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    state.cells[candidates[i]] += 1;
  }
  return picks;
}

var DEFAULT_CHARACTERS_PER_HOUR = 6;
async function decay(env) {
  const count = Number(env.DECAY_PER_HOUR) || DEFAULT_CHARACTERS_PER_HOUR;
  const state = await loadState(env.PORTRAIT);
  const decayed = applyDecay(state, count);
  if (decayed > 0) await saveState(env.PORTRAIT, state);
  console.log(`Decayed ${decayed} characters`);
}

// src/decay-entry.js
var decay_entry_default = {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(decay(env));
  }
};
export {
  decay_entry_default as default
};
