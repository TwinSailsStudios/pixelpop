# PIXELPOP

A free-tier, massively-multiplayer real-time **pixel territory war** — a
**30,000 × 30,000** canvas where anonymous players (and autonomous bots) place
and destroy pixels in a free-for-all. Built brutalist / terminal-style.

The board is far too big (900M cells) to hold as one buffer, so it's stored
**sparsely** (only filled cells) and indexed by 256×256 tiles. The client draws
only the visible tiles each frame and **lazily loads pixels per viewport** as
you pan/zoom (each tile fetched once); Supabase Realtime keeps everything live
after that. Zoomed all the way out, it shows what's already loaded rather than
back-filling the entire board.

**Stack:** React + Vite + TailwindCSS (Vercel) · Supabase (Postgres + Realtime
+ RPC). No auth servers, no payments — 100% serverless / free tier.

---

## Repository layout

```
pixelpop/
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js · postcss.config.js
├── .env.example                 # copy to .env and fill in
├── vercel.json                 # SPA rewrites + Vite build config
├── supabase/
│   └── migrations/
│       ├── 0001_init.sql        # tables, RPCs, RLS, leaderboard views, realtime
│       ├── 0002_admin.sql       # admin_secrets + God Mode RPCs (audit/force/stamp)
│       ├── 0003_freeforall.sql  # free-for-all gameplay, batch place, hover card
│       ├── 0004_bigboard.sql    # widen the board to 30,000 x 30,000
│       └── 0005_bots.sql        # autonomous bots + pg_cron schedule
└── src/
    ├── main.jsx                 # mounts the router (/ board, /admin God Mode)
    ├── App.jsx · index.css
    ├── lib/
    │   ├── supabase.js          # configured client
    │   ├── constants.js         # grid size, zoom limits, level curve, palette
    │   └── stamps.js            # predefined seedable pixel art for the stamp tool
    ├── hooks/
    │   ├── useUser.js           # anonymous UUID identity + profile
    │   ├── usePixels.js         # offscreen board buffer + realtime stream
    │   └── useEconomy.js        # live bank extrapolation (cooldown + optimistic gate)
    └── components/
        ├── PixelCanvas.jsx      # zoom / pan / optimistic paint / destroy / eyedropper
        ├── Toolbar.jsx          # tools, color wheel, recent swatches, cooldown bar
        ├── Leaderboard.jsx      # live "placed" / "destroyed" boards
        ├── NameModal.jsx        # set display name
        ├── DiscordCTA.jsx
        └── AdminPanel.jsx       # /admin God Mode dashboard
```

## Getting started

### 1. Database

1. Create a free Supabase project.
2. Open the **SQL Editor** and run the migrations in order:
   `0001_init.sql`, `0002_admin.sql`, `0003_freeforall.sql`,
   `0004_bigboard.sql`, `0005_bots.sql` (or `supabase db push` with the CLI).
3. What each adds: `0001` tables/views/RLS/realtime; `0002` admin secret +
   God Mode RPCs; `0003` free-for-all gameplay + batch placement + hover card +
   one-report-per-user; `0004` widens the board to 30,000×30,000; `0005` seeds
   the autonomous bots and schedules them via `pg_cron`.
4. **Set your admin secret** (one time) so `/admin` can unlock:
   ```sql
   insert into admin_secrets (id, token) values (1, 'YOUR_LONG_RANDOM_TOKEN')
     on conflict (id) do update set token = excluded.token;
   ```

### 2. Frontend

```bash
cp .env.example .env      # fill in your Supabase URL + anon key, Discord, admin token
npm install
npm run dev
```

Open http://localhost:5173.

## Gameplay (free-for-all)

- No cooldown, no banking, no levels — **placing and destroying are unlimited**.
- Tools: **PLACE** (1 pixel), **LINE** and **SQUARE** (click two points — the
  line/rectangle is placed in your active color via the `place_pixels` batch
  RPC; SQUARE has an **outline / filled** toggle), **DESTROY** (erase a pixel),
  **PICK** (eyedropper), **REPORT**.
- **Hover any pixel** to highlight every cell owned by that user (a stable
  per-user color tint) and see their name + leaderboard rank.
- Counts are still tracked per user to drive the live leaderboard.

## Bots (`0005_bots.sql`)

Autonomous bots run **server-side** via `pg_cron` (every 5s), so the board keeps
moving with nobody watching. Each owns a `profiles` row (shows on the
leaderboard + hover card) and builds its art up gradually for a lifelike feel:

- **spammer** — scatters pixels in a drifting blob
- **walker** — random-walk trail (organic squiggle)
- **spiral** — expanding geometric spiral
- **flagger** — draws a striped national flag row by row, then relocates

They're seeded near the board centre (≈15000, 15000). Controls:

```sql
select bot_tick();                         -- step once manually (if no pg_cron)
update bots set active = false;            -- pause all bots
select create_bot('▰ MYBOT','spiral', 16000, 16000, 6, array['#00ff9c']); -- add one
select cron.unschedule('pixelpop-bots');   -- stop the schedule entirely
```

> `pg_cron` must be available for the schedule (Supabase: Database → Extensions).
> If it isn't, the migration still succeeds — just call `bot_tick()` yourself.

## Moderation & `/admin` God Mode

- **Report** flags a user. You can report a given user **only once** (enforced
  by a unique `(reported, reporter)` index). Reports never auto-remove anything
  — **only an admin can wipe**.
- Visit **`/admin`** and enter the secret you stored in `admin_secrets`. The
  token is validated server-side by the `admin_check` RPC — it is **never**
  baked into the client bundle (set `VITE_ADMIN_TOKEN` only if you want the
  login box prefilled in dev). The dashboard provides:
  - **Audit Wipe** — clear one user's drawings; a reason is required and logged.
  - **Force-Wipe** — clear a rectangular area.
  - **Stamp Tool** — inject predefined pixel art (`src/lib/stamps.js`) at any
    origin to seed the map and spark faction wars, with a live preview and an
    optional color override.
  - Live audit log + top-reported list with one-click wipe targeting.
- Every admin RPC re-validates the token, so even a direct API call can't act
  without the secret.

## Deploy to Vercel

1. Push this repo to GitHub and **Import Project** in Vercel (it auto-detects
   Vite; `vercel.json` pins the build and adds the SPA rewrite so `/admin`
   resolves).
2. Add env vars in the Vercel project settings: `VITE_SUPABASE_URL`,
   `VITE_SUPABASE_ANON_KEY`, `VITE_DISCORD_URL` (and optionally
   `VITE_ADMIN_TOKEN`).
3. Deploy. Supabase Realtime works straight from the static client — no server
   to run.

## Roadmap

- [x] Schema, RPCs, RLS, realtime, leaderboard views
- [x] Canvas (zoom/pan), realtime sync, tools, identity, economy readout
- [x] `/admin` God Mode dashboard + stamp/seed tool
- [x] Optimistic placement + cooldown countdown UI
- [x] Deploy to Vercel (config + guide)
