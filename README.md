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
├── supabase/
│   └── migrations/
│       └── 0001_init.sql        # tables, RPCs, RLS, leaderboard views, realtime
└── src/
    ├── main.jsx · App.jsx · index.css
    ├── lib/
    │   ├── supabase.js          # configured client
    │   └── constants.js         # grid size, zoom limits, level curve, palette
    ├── hooks/
    │   ├── useUser.js           # anonymous UUID identity + profile
    │   └── usePixels.js         # offscreen board buffer + realtime stream
    └── components/
        ├── PixelCanvas.jsx      # zoom / pan / paint / destroy / eyedropper
        ├── Toolbar.jsx          # tools, color wheel, recent swatches
        ├── Leaderboard.jsx      # live "placed" / "destroyed" boards
        ├── NameModal.jsx        # set display name
        └── DiscordCTA.jsx
```

## Getting started

### 1. Database

1. Create a free Supabase project.
2. Open the **SQL Editor** and run `supabase/migrations/0001_init.sql`.
   (Or `supabase db push` if you use the CLI.)
3. This creates the `profiles`, `pixels`, `reports`, `admin_audit_logs`
   tables, the `leaderboard_placed` / `leaderboard_destroyed` views, the
   gameplay RPCs, RLS policies, and adds `pixels` to the realtime publication.

### 2. Frontend

```bash
cp .env.example .env      # fill in your Supabase URL + anon key, Discord, admin token
npm install
npm run dev
```

Open http://localhost:5173.

## How the economy works (server-validated)

| Level | Pixels/min | Max bank | Unlocks at (total placed) |
|------:|-----------:|---------:|--------------------------:|
| 1 | 1 | 1 | 0 |
| 2 | 2 | 2 | 100 |
| 3 | 3 | 3 | 500 |
| 4 | 4 | 4 | 1,500 |
| 5 | 5 | 5 | 5,000 |

- **Place** costs 1 charge. **Destroy** removes up to 2 cells for 1 charge.
- Charges refill at your level's rate and bank up to your level cap while AFK.
- All of this is enforced in `place_pixel` / `destroy_pixels` (SECURITY DEFINER
  RPCs) by comparing server timestamps — the client cannot speed-hack it.

## Moderation

- **Report** any pixel; at **10+ reports** the owner's drawings auto-purge
  (logged to `admin_audit_logs`).
- The `/admin` "God Mode" panel (audit wipe, force-wipe, stamp tool) is the
  next milestone — gated by `VITE_ADMIN_TOKEN`.

## Roadmap

- [x] Schema, RPCs, RLS, realtime, leaderboard views
- [x] Canvas (zoom/pan), realtime sync, tools, identity, economy readout
- [ ] `/admin` God Mode dashboard + stamp/seed tool
- [ ] Optimistic placement + cooldown countdown UI
- [ ] Deploy to Vercel
