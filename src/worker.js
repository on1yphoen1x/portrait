import { handleRepair } from "./api/repair.js";
import { handleState } from "./api/state.js";
import { decay } from "./decay.js";

const routes = {
  "GET /api/state": handleState,
  "POST /api/repair": handleRepair,
};

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const handler = routes[`${request.method} ${pathname}`];
    if (handler) return handler(request, env);
    return env.ASSETS.fetch(request);
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(decay(env));
  },
};
