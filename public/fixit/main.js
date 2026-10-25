const CONSENT_KEY = "cookieConsent";
const REPAIR_DELAY_MS = 900;
const REFRESH_INTERVAL_MS = 2 * 60 * 1000;

const STAGE_INTACT = 0;
const STAGE_GLITCHED = 2;
const stageClasses = ["", "portrait__char--faded", "portrait__char--glitched", "portrait__char--missing"];

// Each character wears into one that looks like it has lost a stroke or a curve.
const erodedGlyphs = {
  a: "o", b: "h", c: "(", d: "o", e: "c", f: "ſ", g: "q", h: "n", i: "ı", j: "ȷ",
  k: "l", l: "ı", m: "n", n: "r", o: "c", p: "ρ", q: "o", r: "ı", s: "ſ", t: "l",
  u: "v", v: "u", w: "v", x: "×", y: "v", z: "2",
  A: "Λ", B: "P", C: "(", D: "O", E: "F", F: "Г", G: "C", H: "I", I: "|", J: "ȷ",
  K: "I", L: "I", M: "N", N: "I", O: "C", P: "Г", Q: "O", R: "P", S: "ſ", T: "I",
  U: "V", V: "\\", W: "V", X: "Y", Y: "V", Z: "2",
  0: "o", 1: "l", 2: "z", 3: "ɜ", 4: "Ч", 5: "s", 6: "b", 7: "/", 8: "3", 9: "g",
  ",": ".", ";": ":", ":": ".", "!": "|", "?": "ʔ", ".": "·", "-": "·",
  "'": ",", "‘": "'", "’": ",", "\"": "ʺ", "“": "ʺ", "”": "ʺ",
  "—": "–", "–": "-", "(": "[", ")": "]", "&": "8",
};

const portraitElement = document.querySelector("#portrait");
const repairsElement = document.querySelector("#ledger-repairs");
const intactElement = document.querySelector("#ledger-intact");
const allowanceElement = document.querySelector("#ledger-allowance");
const statusElement = document.querySelector("#ledger-status");

const numberFormat = new Intl.NumberFormat("en-GB");
const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });
const timeFormat = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

let renderedText = null;
let characters = [];
let charElements = [];
let wordElements = [];
let wordRanges = [];
let cells = new Uint8Array(0);
let allowance = 0;
let allowanceResetsAt = null;
let repairInFlight = false;
let repairTimer = null;
const pendingWords = new Set();

const isWhitespace = (ch) => /\s/.test(ch);
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

function decodeCells(encoded) {
  const binary = atob(encoded);
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

function createParagraph() {
  const paragraph = document.createElement("p");
  paragraph.className = "portrait__paragraph";
  portraitElement.append(paragraph);
  return paragraph;
}

function buildPortrait(text) {
  characters = Array.from(text);
  charElements = [];
  wordElements = [];
  wordRanges = [];
  portraitElement.replaceChildren();

  let paragraph = createParagraph();
  let i = 0;

  while (i < characters.length) {
    if (isWhitespace(characters[i])) {
      let lineBreaks = 0;
      while (i < characters.length && isWhitespace(characters[i])) {
        if (characters[i] === "\n") lineBreaks++;
        i++;
      }
      if (lineBreaks >= 2) {
        paragraph = createParagraph();
      } else {
        paragraph.append(" ");
      }
      continue;
    }

    const start = i;
    const word = document.createElement("span");
    word.className = "portrait__word";
    word.dataset.word = wordRanges.length;

    while (i < characters.length && !isWhitespace(characters[i])) {
      const char = document.createElement("span");
      char.className = "portrait__char";
      char.textContent = characters[i];
      charElements[i] = char;
      word.append(char);
      i++;
    }

    wordRanges.push([start, i]);
    wordElements.push(word);
    paragraph.append(word);
  }

  renderedText = text;
  portraitElement.removeAttribute("aria-busy");
}

function isWordDamaged(wordIndex) {
  const [start, end] = wordRanges[wordIndex];
  return cells.subarray(start, end).some((stage) => stage !== STAGE_INTACT);
}

function renderCells() {
  charElements.forEach((element, index) => {
    const stage = cells[index] ?? STAGE_INTACT;
    element.className = `portrait__char ${stageClasses[stage]}`.trim();
    element.textContent = stage === STAGE_GLITCHED
      ? erodedGlyphs[characters[index]] ?? characters[index]
      : characters[index];
  });

  wordElements.forEach((element, index) => {
    const damaged = isWordDamaged(index);
    element.classList.toggle("portrait__word--damaged", damaged);
    if (damaged) {
      element.setAttribute("role", "button");
      element.setAttribute("tabindex", "0");
    } else {
      element.removeAttribute("role");
      element.removeAttribute("tabindex");
    }
  });
}

function remainingAllowance() {
  return Math.max(0, allowance - pendingWords.size);
}

function renderLedger(repairs, intact, lastIntact) {
  if (repairs !== undefined) repairsElement.textContent = numberFormat.format(repairs);
  if (intact !== undefined) {
    intactElement.textContent = intact ? "Right now" : dateFormat.format(new Date(lastIntact));
  }
  allowanceElement.textContent = `${remainingAllowance()} of 20`;
}

function setStatus(message) {
  statusElement.textContent = message;
}

function applyState(data) {
  if (data.text !== renderedText) buildPortrait(data.text);
  cells = decodeCells(data.cells);
  allowance = data.allowance;
  allowanceResetsAt = new Date(data.allowanceResetsAt);

  // Words clicked while a request was in flight stay restored until their own request settles.
  pendingWords.forEach((wordIndex) => {
    const [start, end] = wordRanges[wordIndex];
    cells.fill(STAGE_INTACT, start, end);
  });

  renderCells();
  renderLedger(data.repairs, data.intact, data.lastIntact);
}

async function refresh() {
  if (repairInFlight || pendingWords.size > 0) return;
  try {
    const response = await fetch("/fixit/api/state", { cache: "no-store" });
    if (!response.ok) throw new Error(response.statusText);
    applyState(await response.json());
  } catch {
    if (!renderedText) {
      portraitElement.innerHTML = '<p class="portrait__loading">The page could not be loaded. Try again in a minute.</p>';
    }
  }
}

function describeRepair(result) {
  if (result.refused > 0) {
    return `${plural(result.repaired, "word")} restored. You have used this hour's repairs; more are available at ${timeFormat.format(allowanceResetsAt)}.`;
  }
  if (result.repaired === 0) return "Someone else restored that before you.";
  return `${plural(result.repaired, "word")} restored. Thank you.`;
}

async function sendRepairs() {
  repairTimer = null;
  if (repairInFlight || pendingWords.size === 0) return;

  const words = [...pendingWords];
  pendingWords.clear();
  repairInFlight = true;

  try {
    const response = await fetch("/fixit/api/repair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ words }),
    });
    const result = await response.json();
    if (!result.cells) throw new Error(result.error);
    applyState(result);
    setStatus(describeRepair(result));
  } catch {
    setStatus("That repair did not go through. Please try again.");
    repairInFlight = false;
    await refresh();
  } finally {
    repairInFlight = false;
    if (pendingWords.size > 0) sendRepairs();
  }
}

function repair(wordIndex) {
  if (pendingWords.has(wordIndex) || !isWordDamaged(wordIndex)) return;

  if (remainingAllowance() === 0) {
    const resetTime = allowanceResetsAt ? ` More are available at ${timeFormat.format(allowanceResetsAt)}.` : "";
    setStatus(`You have used all 20 repairs for this hour.${resetTime}`);
    return;
  }

  pendingWords.add(wordIndex);
  const [start, end] = wordRanges[wordIndex];
  cells.fill(STAGE_INTACT, start, end);
  renderCells();
  renderLedger();

  clearTimeout(repairTimer);
  repairTimer = setTimeout(sendRepairs, REPAIR_DELAY_MS);
}

function wordFromEvent(event) {
  const word = event.target.closest(".portrait__word--damaged");
  return word ? Number(word.dataset.word) : null;
}

function initPortrait() {
  if (!portraitElement) return;

  portraitElement.addEventListener("click", (event) => {
    const wordIndex = wordFromEvent(event);
    if (wordIndex !== null) repair(wordIndex);
  });

  portraitElement.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const wordIndex = wordFromEvent(event);
    if (wordIndex === null) return;
    event.preventDefault();
    repair(wordIndex);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refresh();
  });

  setInterval(() => {
    if (document.visibilityState === "visible") refresh();
  }, REFRESH_INTERVAL_MS);

  refresh();
}

function initConsent() {
  const banner = document.querySelector("#consent");
  if (!banner) return;

  let choice = null;
  try {
    choice = localStorage.getItem(CONSENT_KEY);
  } catch {}
  if (choice) return;

  banner.hidden = false;
  banner.addEventListener("click", (event) => {
    const button = event.target.closest("[data-consent]");
    if (!button) return;
    try {
      localStorage.setItem(CONSENT_KEY, button.dataset.consent);
    } catch {}
    banner.hidden = true;
  });
}

initConsent();
initPortrait();
