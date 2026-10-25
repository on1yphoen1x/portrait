import { applyDecay, loadState, saveState } from "../shared/state.js";

const DEFAULT_CHARACTERS_PER_HOUR = 6;

export async function decay(env) {
  const count = Number(env.DECAY_PER_HOUR) || DEFAULT_CHARACTERS_PER_HOUR;
  const state = await loadState(env.PORTRAIT);
  const decayed = applyDecay(state, count);
  if (decayed > 0) await saveState(env.PORTRAIT, state);
  console.log(`Decayed ${decayed} characters`);
}
