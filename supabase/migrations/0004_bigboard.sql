-- ============================================================================
-- PIXELPOP — 30,000 x 30,000 board
-- Relax the coordinate bounds from 0..999 to 0..29999 (table constraints +
-- the gameplay RPCs that validate input).
-- ============================================================================

alter table pixels drop constraint if exists pixels_x_check;
alter table pixels drop constraint if exists pixels_y_check;
alter table pixels add constraint pixels_x_check check (x between 0 and 29999);
alter table pixels add constraint pixels_y_check check (y between 0 and 29999);

-- single place (no cooldown), 30k bounds
create or replace function place_pixel(p_id uuid, p_x int, p_y int, p_color text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_x not between 0 and 29999 or p_y not between 0 and 29999 then
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

-- batch place (line / square), 30k bounds
create or replace function place_pixels(p_id uuid, p_cells jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare placed int;
begin
  perform ensure_profile(p_id, null);
  with cells as (
    select (c->>'x')::int as x, (c->>'y')::int as y, lower(c->>'color') as color
    from jsonb_array_elements(p_cells) c
  ),
  valid as (
    select x, y, color from cells
    where x between 0 and 29999 and y between 0 and 29999
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
