-- ============================================================================
-- PIXELPOP — admin "God Mode"
-- ----------------------------------------------------------------------------
-- The admin secret lives ONLY in the database (admin_secrets), never in the
-- client bundle. The /admin UI takes a typed token and passes it to these
-- SECURITY DEFINER RPCs, which validate it server-side before doing anything.
-- RLS gives clients zero direct access to the secret, reports, or audit logs.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Secret store (single row). Seed it once, then keep it out of source control.
-- ---------------------------------------------------------------------------
create table if not exists admin_secrets (
  id    int  primary key default 1 check (id = 1),
  token text not null
);
alter table admin_secrets enable row level security;
-- No policies => no anon/auth client can read or write it. DEFINER funcs bypass.

-- >>> RUN THIS ONCE with your own long random string, then delete the line <<<
--   insert into admin_secrets (id, token) values (1, 'CHANGE_ME_LONG_RANDOM')
--     on conflict (id) do update set token = excluded.token;

create or replace function admin_is_valid(p_token text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from admin_secrets
    where token = p_token and length(coalesce(p_token, '')) > 0
  );
$$;

-- Lightweight gate used by the UI to unlock the dashboard.
create or replace function admin_check(p_token text)
returns jsonb
language sql
security definer
set search_path = public
as $$ select jsonb_build_object('ok', admin_is_valid(p_token)); $$;

-- ---------------------------------------------------------------------------
-- THE AUDIT WIPE — clear one user's drawings; reason is mandatory & logged.
-- ---------------------------------------------------------------------------
create or replace function admin_audit_wipe(p_token text, p_target uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare removed int;
begin
  if not admin_is_valid(p_token) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  if coalesce(trim(p_reason), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'reason_required');
  end if;

  with del as (delete from pixels where owner = p_target returning 1)
  select count(*) into removed from del;

  insert into admin_audit_logs (action, target_uuid, reason, details)
  values ('audit_wipe', p_target, p_reason,
          jsonb_build_object('removed', removed));

  return jsonb_build_object('ok', true, 'removed', removed);
end;
$$;

-- ---------------------------------------------------------------------------
-- FORCE-WIPE — clear a rectangular area, bypassing the 10-report rule.
-- ---------------------------------------------------------------------------
create or replace function admin_force_wipe(
  p_token text, p_x1 int, p_y1 int, p_x2 int, p_y2 int, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare removed int; lx int; ly int; hx int; hy int;
begin
  if not admin_is_valid(p_token) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  lx := greatest(0, least(p_x1, p_x2)); hx := least(999, greatest(p_x1, p_x2));
  ly := greatest(0, least(p_y1, p_y2)); hy := least(999, greatest(p_y1, p_y2));

  with del as (
    delete from pixels
    where x between lx and hx and y between ly and hy
    returning 1
  )
  select count(*) into removed from del;

  insert into admin_audit_logs (action, reason, details)
  values ('force_wipe', coalesce(nullif(trim(p_reason), ''), 'force wipe area'),
          jsonb_build_object('x1', lx, 'y1', ly, 'x2', hx, 'y2', hy, 'removed', removed));

  return jsonb_build_object('ok', true, 'removed', removed,
    'area', jsonb_build_object('x1', lx, 'y1', ly, 'x2', hx, 'y2', hy));
end;
$$;

-- ---------------------------------------------------------------------------
-- THE STAMP / TRAFFIC-SPOOF TOOL — inject a 2D pattern to seed the map.
--   p_pattern: jsonb array of { "dx": int, "dy": int, "color": "#rrggbb" }
--   placed at origin (p_ox, p_oy). Out-of-bounds / bad colors are skipped.
-- ---------------------------------------------------------------------------
create or replace function admin_stamp(
  p_token text, p_ox int, p_oy int, p_pattern jsonb,
  p_owner uuid default null, p_reason text default 'stamp')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare inserted int;
begin
  if not admin_is_valid(p_token) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  with pts as (
    select p_ox + (e->>'dx')::int as x,
           p_oy + (e->>'dy')::int as y,
           lower(e->>'color')      as color
    from jsonb_array_elements(p_pattern) e
  ),
  valid as (
    select x, y, color from pts
    where x between 0 and 999 and y between 0 and 999
      and color ~* '^#[0-9a-f]{6}$'
  ),
  ins as (
    insert into pixels (x, y, color, owner, updated_at)
    select x, y, color, p_owner, now() from valid
    on conflict (x, y) do update
      set color = excluded.color, owner = excluded.owner, updated_at = now()
    returning 1
  )
  select count(*) into inserted from ins;

  insert into admin_audit_logs (action, target_uuid, reason, details)
  values ('stamp', p_owner, p_reason,
          jsonb_build_object('origin', jsonb_build_array(p_ox, p_oy), 'count', inserted));

  return jsonb_build_object('ok', true, 'count', inserted);
end;
$$;

-- ---------------------------------------------------------------------------
-- Read helpers for the dashboard (audit-gated; clients can't read these tables)
-- ---------------------------------------------------------------------------
create or replace function admin_recent_logs(p_token text, p_limit int default 50)
returns setof admin_audit_logs
language plpgsql
security definer
set search_path = public
as $$
begin
  if not admin_is_valid(p_token) then return; end if;
  return query
    select * from admin_audit_logs
    order by created_at desc
    limit greatest(1, least(p_limit, 200));
end;
$$;

create or replace function admin_top_reported(p_token text, p_limit int default 50)
returns table (reported_uuid uuid, reports bigint, display_name text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not admin_is_valid(p_token) then return; end if;
  return query
    select r.reported_uuid, count(*)::bigint as reports,
           coalesce(p.display_name, 'Anonymous') as display_name
    from reports r
    left join profiles p on p.id = r.reported_uuid
    group by r.reported_uuid, p.display_name
    order by reports desc
    limit greatest(1, least(p_limit, 200));
end;
$$;
