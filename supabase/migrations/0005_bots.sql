-- ============================================================================
-- PIXELPOP — autonomous bots
-- ----------------------------------------------------------------------------
-- Bots run server-side via pg_cron so the board stays alive even with nobody
-- watching. Each bot owns a `profiles` row (so it shows on the leaderboard and
-- in the hover card) and draws a few pixels per tick with a distinct behavior,
-- keeping per-bot progress in `state` so patterns build up gradually (lifelike,
-- not instant dumps).
--   spammer  — scatters pixels in a drifting blob
--   walker   — random-walk trail (organic squiggle)
--   spiral   — expanding geometric spiral
--   flagger  — draws a striped flag row by row, then relocates
-- ============================================================================

create table if not exists bots (
  id       uuid primary key default gen_random_uuid(),
  name     text not null,
  behavior text not null,
  palette  text[] not null default array['#ff4d4d'],
  x        int  not null default 15000,
  y        int  not null default 15000,
  speed    int  not null default 6,
  state    jsonb not null default '{}'::jsonb,
  active   boolean not null default true,
  created_at timestamptz not null default now()
);
alter table bots enable row level security; -- no client policies; admin/cron only

-- Create a bot + its profile row in one shot.
create or replace function create_bot(
  p_name text, p_behavior text, p_x int, p_y int, p_speed int, p_palette text[])
returns uuid language plpgsql security definer set search_path = public as $$
declare bid uuid := gen_random_uuid();
begin
  insert into profiles (id, display_name) values (bid, p_name)
    on conflict (id) do nothing;
  insert into bots (id, name, behavior, x, y, speed, palette)
    values (bid, p_name, p_behavior, p_x, p_y, p_speed, p_palette);
  return bid;
end;
$$;

-- ---------------------------------------------------------------------------
-- One step for every active bot.
-- ---------------------------------------------------------------------------
create or replace function bot_tick()
returns void language plpgsql security definer set search_path = public as $$
declare
  b record;
  i int; n int;
  px int; py int; col text;
  cx int; cy int;
  ang float8; rad float8;
  fw int; fh int; rrow int; nb int; bi int; cc int; rr int;
  bands text[]; orient text;
  placed int;
begin
  for b in select * from bots where active loop
    if random() < 0.15 then continue; end if; -- occasional pauses
    placed := 0;
    n := array_length(b.palette, 1);

    if b.behavior = 'spammer' then
      for i in 1..b.speed loop
        px := least(29999, greatest(0, b.x + (floor(random() * 81) - 40)::int));
        py := least(29999, greatest(0, b.y + (floor(random() * 81) - 40)::int));
        col := b.palette[1 + floor(random() * n)::int];
        insert into pixels (x, y, color, owner, updated_at)
          values (px, py, lower(col), b.id, now())
          on conflict (x, y) do update set color = excluded.color, owner = excluded.owner, updated_at = now();
        placed := placed + 1;
      end loop;
      update bots set
        x = least(29999, greatest(0, x + (floor(random() * 21) - 10)::int)),
        y = least(29999, greatest(0, y + (floor(random() * 21) - 10)::int))
      where id = b.id;

    elsif b.behavior = 'walker' then
      cx := coalesce((b.state->>'cx')::int, b.x);
      cy := coalesce((b.state->>'cy')::int, b.y);
      for i in 1..b.speed loop
        case floor(random() * 4)::int
          when 0 then cx := cx + 1;
          when 1 then cx := cx - 1;
          when 2 then cy := cy + 1;
          else cy := cy - 1;
        end case;
        cx := least(29999, greatest(0, cx));
        cy := least(29999, greatest(0, cy));
        col := b.palette[1 + floor(random() * n)::int];
        insert into pixels (x, y, color, owner, updated_at)
          values (cx, cy, lower(col), b.id, now())
          on conflict (x, y) do update set color = excluded.color, owner = excluded.owner, updated_at = now();
        placed := placed + 1;
      end loop;
      update bots set state = jsonb_build_object('cx', cx, 'cy', cy) where id = b.id;

    elsif b.behavior = 'spiral' then
      ang := coalesce((b.state->>'ang')::float8, 0);
      rad := coalesce((b.state->>'rad')::float8, 1);
      for i in 1..b.speed loop
        px := least(29999, greatest(0, (b.x + rad * cos(ang))::int));
        py := least(29999, greatest(0, (b.y + rad * sin(ang))::int));
        col := b.palette[1 + floor(random() * n)::int];
        insert into pixels (x, y, color, owner, updated_at)
          values (px, py, lower(col), b.id, now())
          on conflict (x, y) do update set color = excluded.color, owner = excluded.owner, updated_at = now();
        ang := ang + 0.35;
        rad := rad + 0.18;
        if rad > 140 then rad := 1; ang := 0; end if;
        placed := placed + 1;
      end loop;
      update bots set state = jsonb_build_object('ang', ang, 'rad', rad) where id = b.id;

    elsif b.behavior = 'flagger' then
      if not (b.state ? 'fh') then
        case floor(random() * 4)::int
          when 0 then bands := array['#0055a4','#ffffff','#ef4135']; orient := 'v'; -- France
          when 1 then bands := array['#000000','#dd0000','#ffce00']; orient := 'h'; -- Germany
          when 2 then bands := array['#009246','#ffffff','#ce2b37']; orient := 'v'; -- Italy
          else      bands := array['#ae1c28','#ffffff','#21468b']; orient := 'h'; -- Netherlands
        end case;
        fw := 40; fh := 26; rrow := 0;
        update bots set state = jsonb_build_object(
          'fw', fw, 'fh', fh, 'row', 0, 'orient', orient, 'bands', to_jsonb(bands)
        ) where id = b.id;
      else
        fw := (b.state->>'fw')::int;
        fh := (b.state->>'fh')::int;
        rrow := (b.state->>'row')::int;
        orient := b.state->>'orient';
        bands := array(select jsonb_array_elements_text(b.state->'bands'));
      end if;
      nb := array_length(bands, 1);
      for rr in rrow .. least(fh - 1, rrow + b.speed - 1) loop
        for cc in 0 .. fw - 1 loop
          if orient = 'h' then bi := 1 + least(nb - 1, (rr * nb / fh));
          else bi := 1 + least(nb - 1, (cc * nb / fw)); end if;
          px := least(29999, greatest(0, b.x + cc));
          py := least(29999, greatest(0, b.y + rr));
          insert into pixels (x, y, color, owner, updated_at)
            values (px, py, lower(bands[bi]), b.id, now())
            on conflict (x, y) do update set color = excluded.color, owner = excluded.owner, updated_at = now();
          placed := placed + 1;
        end loop;
      end loop;
      rrow := rrow + b.speed;
      if rrow >= fh then
        update bots set state = '{}'::jsonb,
          x = 8000 + floor(random() * 14000)::int,
          y = 8000 + floor(random() * 14000)::int
        where id = b.id;
      else
        update bots set state = jsonb_set(state, '{row}', to_jsonb(rrow)) where id = b.id;
      end if;
    end if;

    if placed > 0 then
      update profiles set pixels_placed = pixels_placed + placed where id = b.id;
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Seed a roster once (clustered near the board centre so it's easy to find).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from bots) then
    perform create_bot('▰ SPAMBOT',  'spammer', 15000, 15000, 8,
      array['#ff4d4d','#ffb000','#00b3ff','#7a5cff']);
    perform create_bot('▰ STATIC',   'spammer', 14600, 15300, 6,
      array['#ffe600','#8a8a8a','#ffffff']);
    perform create_bot('▰ SQUIGGLE', 'walker',  15300, 14700, 6, array['#00ff9c']);
    perform create_bot('▰ DRUNKARD', 'walker',  14800, 14800, 6,
      array['#ff5cf0','#00b3ff','#ffffff']);
    perform create_bot('▰ HELIX',    'spiral',  15200, 15200, 5,
      array['#ff5cf0','#00b3ff']);
    perform create_bot('▰ VEXILLO',  'flagger', 14700, 14600, 2, array['#ffffff']);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Schedule the tick every 5s. Best-effort: if pg_cron isn't available the rest
-- of the migration still succeeds and you can run `select bot_tick();` manually.
--   Disable later with:  select cron.unschedule('pixelpop-bots');
--   Or pause bots with:  update bots set active = false;
-- ---------------------------------------------------------------------------
do $$
begin
  begin execute 'create extension if not exists pg_cron';
  exception when others then raise notice 'pg_cron extension: %', sqlerrm; end;

  begin perform cron.unschedule('pixelpop-bots'); exception when others then null; end;

  begin perform cron.schedule('pixelpop-bots', '5 seconds', 'select bot_tick();');
  exception when others then raise notice 'pg_cron schedule failed (run bot_tick() manually): %', sqlerrm; end;
end $$;
