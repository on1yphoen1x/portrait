import {
  currentHourBucket,
  hashVisitor,
  loadState,
  publicState,
  readAllowance,
} from "../../shared/state.js";

export async function handleState(request, env) {
  const bucket = currentHourBucket();
  const visitorHash = await hashVisitor(request.headers.get("CF-Connecting-IP") ?? "local", env.IP_SALT);
  const [state, allowance] = await Promise.all([
    loadState(env.PORTRAIT),
    readAllowance(env.PORTRAIT, visitorHash, bucket),
  ]);

  return Response.json(publicState(state, allowance, bucket), {
    headers: { "Cache-Control": "no-store" },
  });
}
