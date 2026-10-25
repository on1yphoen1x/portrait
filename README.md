# Decaying portrait

A single page of text that wears away by a few characters every hour. Visitors repair damaged words, and the state is shared between everyone. It is served at `joetaylor.org/fixit`.

## Layout

```
wrangler.toml            One Worker: static files, API, hourly cron, route on joetaylor.org/fixit*
public/fixit/            index.html, styles.css, main.js, privacy.html, terms.html
src/worker.js            Routes /fixit/api/* to the handlers, everything else to the static files
src/api/state.js         GET  /fixit/api/state   current state and your remaining repairs
src/api/repair.js        POST /fixit/api/repair  { "words": [3, 17] }
src/decay.js             Runs at minute 0 of every hour
shared/portrait.js       THE TEXT. Edit this file to change the copy.
shared/state.js          Encoding, decay, rate limiting
```

A Pages project can only own a whole hostname, so serving under a path of `joetaylor.org` uses a Worker route instead. The same Worker serves the static files, the API and the cron trigger, so there is one deploy.

## KV layout

Namespace `fixit-portrait` (id `d55e91c2ddb24f09b0fa4a8160becf41`), bound as `PORTRAIT`.

| Key | Value |
| --- | --- |
| `state` | JSON: `textHash`, `cells` (base64, one byte per character: 0 intact, 1 faded, 2 glitched, 3 missing), `repairs`, `lastIntact` |
| `rate:<hash>:<hour>` | Repairs used by one visitor in one clock hour. The hash is SHA-256 of `IP_SALT:ip`, truncated to 128 bits. Expires after 2 hours. |

## Deploying

The KV namespace already exists and its id is in `wrangler.toml`. `joetaylor.org` must be a zone in the same Cloudflare account with its DNS proxied (orange cloud). Run these from the project root with Wrangler 4:

```
npx wrangler login
npx wrangler deploy
openssl rand -hex 32 | npx wrangler secret put IP_SALT
```

If you ever need to recreate the namespace, use `npx wrangler kv namespace create fixit-portrait` and paste the new id into `wrangler.toml`.

## Uploading through the dashboard instead

`upload/decaying-portrait-pages.zip` is the site prepared for a Pages project at the root of its own hostname (for example `fixit.joetaylor.org`), because a Pages project cannot sit under `/fixit` on another site. It contains the static files plus a bundled `_worker.js` that serves `/api/state` and `/api/repair`.

1. Workers & Pages > Create > Pages > Upload assets, then drop in the zip.
2. In the project's Settings > Bindings, add a KV namespace binding named `PORTRAIT` pointing at `fixit-portrait`.
3. In Settings > Variables and Secrets, add a secret `IP_SALT` with any long random string.
4. Upload the zip again so the new deployment picks up the binding and secret.
5. Pages cannot run cron triggers. Create a Worker (Create > Start with Hello World), replace its code with `upload/decay-worker.js`, add the same `PORTRAIT` KV binding, and add a cron trigger of `0 * * * *` under Settings > Trigger Events.

If `/api/state` returns 404 after step 4, the dashboard upload ignored `_worker.js`; use `npx wrangler deploy` as above instead.

## Changing the text

Edit `shared/portrait.js` and run `npx wrangler deploy`. The stored state records a hash of the text, so the first request after the change resets every character to intact. The total repair count is kept. To wipe everything by hand instead:

```
npx wrangler kv key delete state --binding PORTRAIT --remote
```

## Tuning

- Characters decayed per hour: `DECAY_PER_HOUR` in `wrangler.toml` (default 6). With roughly 1,600 letters and three stages each, an untended page takes about five weeks to disappear completely.
- Repairs per visitor per hour: `REPAIRS_PER_HOUR` in `shared/state.js`.

## Running locally

```
echo 'IP_SALT="local-dev-salt"' > .dev.vars
npx wrangler dev --test-scheduled
```

Open `http://localhost:8787/fixit/`. To run decay once: `curl "http://localhost:8787/__scheduled?cron=0+*+*+*+*"`.

## Limits worth knowing

- KV is last-write-wins and takes up to a minute to propagate between Cloudflare locations. If two visitors in different regions repair within the same few seconds, one repair can be overwritten. For a personal page this is rare; moving `state` into a Durable Object would make it exact.
- The rate limit is also approximate for the same reason.
- The free plan allows 1,000 KV writes a day. Each batch of repairs costs two writes (clicks within a second are sent together) and decay costs 24 a day.
