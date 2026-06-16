# PIXELPOP

A free-tier, massively-multiplayer real-time **pixel territory war** — a
1000×1000 canvas where anonymous players place and destroy pixels, bank an AFK
income, level up, and fight for the board. Built brutalist / terminal-style.

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
│       └── 0002_admin.sql       # admin_secrets + God Mode RPCs (audit/force/stamp)
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
   `0001_init.sql`, `0002_admin.sql`, `0003_freeforall.sql`
   (or `supabase db push` with the CLI).
3. `0001` creates the `profiles`, `pixels`, `reports`, `admin_audit_logs`
   tables, the `leaderboard_placed` / `leaderboard_destroyed` views, RLS
   policies, and adds `pixels` to the realtime publication. `0002` adds the
   admin secret store + God Mode RPCs. `0003` switches gameplay to free-for-all
   (no cooldown), adds batch placement + the hover card RPC, and makes reports
   one-per-user with no auto-purge.
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
  RPC), **DESTROY** (erase a pixel), **PICK** (eyedropper), **REPORT**.
- **Hover any pixel** to highlight every cell owned by that user (a stable
  per-user color tint) and see their name + leaderboard rank.
- Counts are still tracked per user to drive the live leaderboard.

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
