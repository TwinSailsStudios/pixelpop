-- ============================================================================
-- PIXELPOP — initial schema
-- ----------------------------------------------------------------------------
-- Design notes
--   * 1000x1000 grid = 1,000,000 cells, but we ONLY store non-void pixels.
--     A "void" pixel is simply a row that does not exist. This keeps the table
--     small and makes Realtime broadcasts cheap.
--   * All gameplay writes go through SECURITY DEFINER RPCs (place_pixel /
--     destroy_pixels). Clients never write to `pixels` directly, so the
--     cooldown / banking economy is validated server-side and cannot be
--     speed-hacked from the browser.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Economy constants (kept in one place so the loop is easy to tune)
-- ---------------------------------------------------------------------------
--   Level :  pixels/min  &  max bank      Threshold (total pixels placed)
--     1   :       1                              0
--     2   :       2                            100
--     3   :       3                            500
--     4   :       4                           1500
--     5   :       5                           5000   (cap)
-- ---------------------------------------------------------------------------

create or replace function pp_level_for(placed bigint)
returns int
language sql
immutable
as $$
  select case
    when placed >= 5000 then 5
    when placed >= 1500 then 4
    when placed >=  500 then 3
    when placed >=  100 then 2
    else 1
  end;
$$;

-- rate (pixels/min) == max bank == level number, capped at 5
create or replace function pp_rate_for(lvl int)
returns int
language sql
immutable
as $$ select least(greatest(lvl, 1), 5); $$;

-- ===========================================================================
-- PROFILES
-- ===========================================================================
create table if not exists profiles (
  id            uuid primary key,                       -- client-generated UUID
  display_name  text,
  level         int    not null default 1,
  pixels_placed    bigint not null default 0,
  pixels_destroyed bigint not null default 0,
  -- Banking state. `pixels_available` is the bank balance as of `last_refill`.
  pixels_available numeric not null default 1,
  last_refill   timestamptz not null default now(),
  report_count  int    not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists profiles_placed_idx   on profiles (pixels_placed desc);
create index if not exists profiles_destroyed_idx on profiles (pixels_destroyed desc);

-- ===========================================================================
-- PIXELS  (only non-void cells exist)
-- ===========================================================================
create table if not exists pixels (
  x          int not null check (x between 0 and 999),
  y          int not null check (y between 0 and 999),
  color      text not null check (color ~* '^#[0-9a-f]{6}$'),
  owner      uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (x, y)
);

create index if not exists pixels_owner_idx on pixels (owner);

-- ===========================================================================
-- REPORTS  (community moderation — 10+ unique-ish reports auto-purges a UUID)
-- ===========================================================================
create table if not exists reports (
  id           bigint generated always as identity primary key,
  reported_uuid uuid not null,
  reporter_uuid uuid,
  x            int,
  y            int,
  created_at   timestamptz not null default now()
);

create index if not exists reports_reported_idx on reports (reported_uuid);

-- ===========================================================================
-- ADMIN AUDIT LOG  (every god-mode action is recorded)
-- ===========================================================================
create table if not exists admin_audit_logs (
  id          bigint generated always as identity primary key,
  action      text not null,           -- 'audit_wipe' | 'force_wipe' | 'stamp' | 'auto_purge'
  target_uuid uuid,
  reason      text,
  details     jsonb,
  created_at  timestamptz not null default now()
);

-- ===========================================================================
-- LEADERBOARD VIEWS  (cheap to SELECT, fetched live by the client)
-- ===========================================================================
create or replace view leaderboard_placed as
  select id, coalesce(display_name, 'Anonymous') as display_name,
         level, pixels_placed
  from profiles
  where pixels_placed > 0
  order by pixels_placed desc
  limit 20;

create or replace view leaderboard_destroyed as
  select id, coalesce(display_name, 'Anonymous') as display_name,
         level, pixels_destroyed
  from profiles
  where pixels_destroyed > 0
  order by pixels_destroyed desc
  limit 20;

-- ===========================================================================
-- ECONOMY HELPER — refill a profile's bank based on elapsed time, return row
-- ===========================================================================
create or replace function pp_refill(p_id uuid)
returns profiles
language plpgsql
as $$
declare
  prof    profiles;
  rate    int;
  elapsed numeric;     -- minutes since last refill
  banked  numeric;
begin
  select * into prof from profiles where id = p_id for update;
  if not found then
    return null;
  end if;

  rate    := pp_rate_for(prof.level);
  elapsed := extract(epoch from (now() - prof.last_refill)) / 60.0;
  banked  := least(rate::numeric, prof.pixels_available + elapsed * rate);

  prof.pixels_available := banked;
  prof.last_refill := now();

  update profiles
     set pixels_available = prof.pixels_available,
         last_refill = prof.last_refill
   where id = prof.id;

  return prof;
end;
$$;

-- ===========================================================================
-- ensure_profile — idempotent upsert so a fresh UUID can play immediately
-- ===========================================================================
create or replace function ensure_profile(p_id uuid, p_name text default null)
returns profiles
language plpgsql
security definer
set search_path = public
as $$
declare prof profiles;
begin
  insert into profiles (id, display_name)
  values (p_id, nullif(trim(p_name), ''))
  on conflict (id) do update
    set display_name = coalesce(nullif(trim(excluded.display_name), ''), profiles.display_name)
  returning * into prof;
  return prof;
end;
$$;

-- ===========================================================================
-- place_pixel — costs 1 bank charge, validated server-side
-- ===========================================================================
create or replace function place_pixel(p_id uuid, p_x int, p_y int, p_color text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare prof profiles;
begin
  if p_x not between 0 and 999 or p_y not between 0 and 999 then
    return jsonb_build_object('ok', false, 'error', 'out_of_bounds');
  end if;
  if p_color !~* '^#[0-9a-f]{6}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_color');
  end if;

  perform ensure_profile(p_id, null);
  prof := pp_refill(p_id);

  if prof.pixels_available < 1 then
    return jsonb_build_object('ok', false, 'error', 'cooldown',
      'available', prof.pixels_available, 'level', prof.level);
  end if;

  insert into pixels (x, y, color, owner, updated_at)
  values (p_x, p_y, lower(p_color), p_id, now())
  on conflict (x, y) do update
    set color = excluded.color, owner = excluded.owner, updated_at = now();

  update profiles
     set pixels_available = pixels_available - 1,
         pixels_placed    = pixels_placed + 1,
         level            = pp_level_for(pixels_placed + 1)
   where id = p_id
   returning * into prof;

  return jsonb_build_object('ok', true, 'available', prof.pixels_available,
    'level', prof.level, 'pixels_placed', prof.pixels_placed);
end;
$$;

-- ===========================================================================
-- destroy_pixels — clears up to 2 cells back to void, costs 1 bank charge
-- ===========================================================================
create or replace function destroy_pixels(p_id uuid, p_coords jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  prof    profiles;
  removed int;
begin
  perform ensure_profile(p_id, null);
  prof := pp_refill(p_id);

  if prof.pixels_available < 1 then
    return jsonb_build_object('ok', false, 'error', 'cooldown',
      'available', prof.pixels_available, 'level', prof.level);
  end if;

  -- delete at most the first two coordinates supplied
  with targets as (
    select (c->>'x')::int as x, (c->>'y')::int as y
    from jsonb_array_elements(p_coords) c
    limit 2
  ), del as (
    delete from pixels p using targets t
    where p.x = t.x and p.y = t.y
    returning 1
  )
  select count(*) into removed from del;

  update profiles
     set pixels_available  = pixels_available - 1,
         pixels_destroyed  = pixels_destroyed + removed
   where id = p_id
   returning * into prof;

  return jsonb_build_object('ok', true, 'removed', removed,
    'available', prof.pixels_available);
end;
$$;

-- ===========================================================================
-- report_pixel — files a report; auto-purges the owner at 10+ reports
-- ===========================================================================
create or replace function report_pixel(p_reporter uuid, p_x int, p_y int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
  total  int;
begin
  select owner into target from pixels where x = p_x and y = p_y;
  if target is null then
    return jsonb_build_object('ok', false, 'error', 'no_owner');
  end if;

  insert into reports (reported_uuid, reporter_uuid, x, y)
  values (target, p_reporter, p_x, p_y);

  update profiles set report_count = report_count + 1 where id = target
    returning report_count into total;

  if total >= 10 then
    delete from pixels where owner = target;
    insert into admin_audit_logs (action, target_uuid, reason, details)
    values ('auto_purge', target, 'reached 10 community reports',
            jsonb_build_object('reports', total));
    return jsonb_build_object('ok', true, 'purged', true, 'reports', total);
  end if;

  return jsonb_build_object('ok', true, 'purged', false, 'reports', total);
end;
$$;

-- ===========================================================================
-- ROW LEVEL SECURITY
--   Reads are public. Writes happen only through the SECURITY DEFINER RPCs
--   above, which run as the owner and bypass these policies.
-- ===========================================================================
alter table profiles enable row level security;
alter table pixels   enable row level security;
alter table reports  enable row level security;
alter table admin_audit_logs enable row level security;

drop policy if exists "public read profiles" on profiles;
create policy "public read profiles" on profiles for select using (true);

drop policy if exists "public read pixels" on pixels;
create policy "public read pixels" on pixels for select using (true);

-- reports / audit logs: no direct client access (RPCs handle inserts)

-- ===========================================================================
-- REALTIME — broadcast pixel changes to every connected client
-- ===========================================================================
alter publication supabase_realtime add table pixels;
