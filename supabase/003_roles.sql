-- Beer Stocking: roles. Run after 002. Safe to re-run.
-- admin (Keegan) and managers set the schedule and routes; employees see the schedule.
-- The database enforces this, not just the app.

alter table profiles add column if not exists role text not null default 'employee';
do $$ begin
  alter table profiles add constraint profiles_role_check check (role in ('admin','manager','employee'));
exception when duplicate_object then null; end $$;

create or replace function is_lead() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('admin','manager'));
$$;
create or replace function is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

-- Schedule entries are for a Backstock day or a Truck Day
alter table schedule add column if not exists kind text not null default 'backstock';
do $$ begin
  alter table schedule add constraint schedule_kind_check check (kind in ('backstock','truck'));
exception when duplicate_object then null; end $$;

-- Routes and schedule: everyone signed in can read; only admin/managers can change
do $$ declare t text; begin
  foreach t in array array['routes','schedule'] loop
    execute format('drop policy if exists team_all on %I', t);
    execute format('drop policy if exists read_all on %I', t);
    execute format('drop policy if exists lead_insert on %I', t);
    execute format('drop policy if exists lead_update on %I', t);
    execute format('drop policy if exists lead_delete on %I', t);
    execute format('create policy read_all on %I for select to authenticated using (true)', t);
    execute format('create policy lead_insert on %I for insert to authenticated with check (is_lead())', t);
    execute format('create policy lead_update on %I for update to authenticated using (is_lead()) with check (is_lead())', t);
    execute format('create policy lead_delete on %I for delete to authenticated using (is_lead())', t);
  end loop;
end $$;

-- People can change their own name, never their own role; new accounts start as employees
revoke update on profiles from authenticated;
grant update (first, last) on profiles to authenticated;
drop policy if exists write_own on profiles;
create policy write_own on profiles for insert to authenticated with check (id = auth.uid() and role = 'employee');

-- Only the admin changes roles
create or replace function set_role(target uuid, new_role text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Only the admin can change roles'; end if;
  if new_role not in ('admin','manager','employee') then raise exception 'Unknown role %', new_role; end if;
  if target = auth.uid() and new_role <> 'admin' then raise exception 'The admin can''t take away their own admin role'; end if;
  update profiles set role = new_role where id = target;
end $$;
revoke execute on function set_role(uuid, text) from public, anon;
grant execute on function set_role(uuid, text) to authenticated;

-- Keegan is the admin
update profiles set role = 'admin' where first = 'Keegan' and last = 'Beckstrom';
