-- ============================================================================
-- PIXELPOP — free-for-all rework
-- ----------------------------------------------------------------------------
--   * No cooldown / banking / levels — placing and destroying are unlimited.
--   * One report per (reporter, target) pair, enforced by a unique index.
--   * No automatic purging — reports only flag; removal is an admin action.
--   * Batch placement for the line / square tools.
--   * user_card(): owner display name + leaderboard rank for the hover panel.
-- These CREATE OR REPLACE the gameplay RPCs from 0001 (kept counters for the
-- leaderboard; dropped the economy checks).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- place_pixel — single cell, no cost. Still counts toward the leaderboard.
-- ---------------------------------------------------------------------------
create or replace function place_pixel(p_id uuid, p_x int, p_y int, p_color text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_x not between 0 and 999 or p_y not between 0 and 999 then
    return jsonb_build_object('ok', false, 'error', 'out_of_bounds');
  end if;
  if p_color !~* '^#[0-9a-f]{6}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_color');
  end if;

  perform ensure_profile(p_id, null);

  insert into pixels (x, y, color, owner, updated_at)
  values (p_x, p_y, lower(p_color), p_id, now())
  on conflict (x, y) do update
    set color = excluded.color, owner = excluded.owner, updated_at = now();

  update profiles set pixels_placed = pixels_placed + 1 where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- place_pixels — batch (line / square tools). p_cells: [{x,y,color}]
-- ---------------------------------------------------------------------------
create or replace function place_pixels(p_id uuid, p_cells jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare placed int;
begin
  perform ensure_profile(p_id, null);

  with cells as (
    select (c->>'x')::int as x, (c->>'y')::int as y, lower(c->>'color') as color
    from jsonb_array_elements(p_cells) c
  ),
  valid as (
    select x, y, color from cells
    where x between 0 and 999 and y between 0 and 999
      and color ~* '^#[0-9a-f]{6}$'
  ),
  ins as (
    insert into pixels (x, y, color, owner, updated_at)
    select x, y, color, p_id, now() from valid
    on conflict (x, y) do update
      set color = excluded.color, owner = excluded.owner, updated_at = now()
    returning 1
  )
  select count(*) into placed from ins;

  update profiles set pixels_placed = pixels_placed + placed where id = p_id;
  return jsonb_build_object('ok', true, 'count', placed);
end;
$$;

-- ---------------------------------------------------------------------------
-- destroy_pixels — remove any cells passed, no cost, no 2-cell cap.
-- ---------------------------------------------------------------------------
create or replace function destroy_pixels(p_id uuid, p_coords jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare removed int;
begin
  perform ensure_profile(p_id, null);

  with targets as (
    select (c->>'x')::int as x, (c->>'y')::int as y
    from jsonb_array_elements(p_coords) c
  ),
  del as (
    delete from pixels p using targets t
    where p.x = t.x and p.y = t.y
    returning 1
  )
  select count(*) into removed from del;

  update profiles set pixels_destroyed = pixels_destroyed + removed where id = p_id;
  return jsonb_build_object('ok', true, 'removed', removed);
end;
$$;

-- ---------------------------------------------------------------------------
-- One report per (reporter, target). De-dupe any existing rows first, then a
-- unique index enforces it. report_pixel no longer auto-purges.
-- ---------------------------------------------------------------------------
delete from reports a using reports b
where a.ctid < b.ctid
  and a.reported_uuid = b.reported_uuid
  and a.reporter_uuid = b.reporter_uuid;

create unique index if not exists reports_unique_pair
  on reports (reported_uuid, reporter_uuid);

create or replace function report_pixel(p_reporter uuid, p_x int, p_y int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
  did    int;
  total  int;
begin
  select owner into target from pixels where x = p_x and y = p_y;
  if target is null then
    return jsonb_build_object('ok', false, 'error', 'no_owner');
  end if;
  if p_reporter is not null and target = p_reporter then
    return jsonb_build_object('ok', false, 'error', 'cannot_report_self');
  end if;

  insert into reports (reported_uuid, reporter_uuid, x, y)
  values (target, p_reporter, p_x, p_y)
  on conflict (reported_uuid, reporter_uuid) do nothing;
  get diagnostics did = row_count;

  if did = 0 then
    select report_count into total from profiles where id = target;
    return jsonb_build_object('ok', true, 'already', true, 'reports', total);
  end if;

  update profiles set report_count = report_count + 1 where id = target
    returning report_count into total;
  return jsonb_build_object('ok', true, 'already', false, 'reports', total);
end;
$$;

-- ---------------------------------------------------------------------------
-- user_card — display name + leaderboard rank for the hover panel.
-- ---------------------------------------------------------------------------
create or replace function user_card(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id,
    'display_name', coalesce(p.display_name, 'Anonymous'),
    'pixels_placed', p.pixels_placed,
    'pixels_destroyed', p.pixels_destroyed,
    'rank', (select count(*) + 1 from profiles q where q.pixels_placed > p.pixels_placed)
  )
  from profiles p
  where p.id = p_id;
$$;
