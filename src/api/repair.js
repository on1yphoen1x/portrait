import {
  REPAIRS_PER_HOUR,
  currentHourBucket,
  hashVisitor,
  isIntact,
  isWordDamaged,
  loadState,
  publicState,
  rateKey,
  readAllowance,
  repairWord,
  saveState,
  wordRanges,
} from "../../shared/state.js";

const RATE_KEY_TTL_SECONDS = 2 * 60 * 60;

function parseWords(body) {
  if (!body || !Array.isArray(body.words)) return null;
  const words = [...new Set(body.words)];
  if (words.length === 0 || words.length > REPAIRS_PER_HOUR) return null;
  const valid = words.every((word) => Number.isInteger(word) && word >= 0 && word < wordRanges.length);
  return valid ? words : null;
}

export async function handleRepair(request, env) {
  if (!env.IP_SALT) {
    return Response.json({ error: "Server is missing IP_SALT." }, { status: 500 });
  }

  const words = parseWords(await request.json().catch(() => null));
  if (!words) {
    return Response.json({ error: "Send a list of word positions to repair." }, { status: 400 });
  }

  const bucket = currentHourBucket();
  const visitorHash = await hashVisitor(request.headers.get("CF-Connecting-IP") ?? "local", env.IP_SALT);
  const [state, allowance] = await Promise.all([
    loadState(env.PORTRAIT),
    readAllowance(env.PORTRAIT, visitorHash, bucket),
  ]);

  const damaged = words.filter((word) => isWordDamaged(state.cells, word));
  const accepted = damaged.slice(0, allowance);
  const remaining = allowance - accepted.length;

  if (accepted.length > 0) {
    accepted.forEach((word) => repairWord(state.cells, word));
    state.repairs += accepted.length;
    if (isIntact(state.cells)) state.lastIntact = new Date().toISOString();

    await Promise.all([
      saveState(env.PORTRAIT, state),
      env.PORTRAIT.put(rateKey(visitorHash, bucket), String(REPAIRS_PER_HOUR - remaining), {
        expirationTtl: RATE_KEY_TTL_SECONDS,
      }),
    ]);
  }

  const status = damaged.length > accepted.length ? 429 : 200;
  return Response.json(
    { ...publicState(state, remaining, bucket), repaired: accepted.length, refused: damaged.length - accepted.length },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
