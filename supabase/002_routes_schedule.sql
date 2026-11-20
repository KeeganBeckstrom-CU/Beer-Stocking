-- Beer Stocking: counties, routes and the schedule. Run after schema.sql. Safe to re-run.

-- Every store belongs to a county
alter table stores add column if not exists county text;
update stores set county = 'Livingston' where county is null;

-- A route is a set of stores worked together
create table if not exists routes (
  id text primary key,
  name text not null,
  county text,
  store_ids text[] not null default '{}',
  pos int not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

-- Who works which route on which day (day: 0 = Sunday ... 6 = Saturday)
create table if not exists schedule (
  id text primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  route_id text not null references routes(id) on delete cascade,
  day int not null check (day between 0 and 6),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

do $$ declare t text; begin
  foreach t in array array['routes','schedule'] loop
    execute format('drop trigger if exists touch_%1$s on %1$s', t);
    execute format('create trigger touch_%1$s before insert or update on %1$s for each row execute function touch()', t);
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists team_all on %I', t);
    execute format('create policy team_all on %I for all to authenticated using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    execute format('revoke all on %I from anon', t);
    execute format('alter table %I replica identity full', t);
    begin execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null; end;
  end loop;
  -- new people show up on the schedule live
  begin alter publication supabase_realtime add table profiles;
  exception when duplicate_object then null; end;
end $$;

-- Two starting routes for the Livingston stores (rename or change them on the Schedule screen)
insert into routes (id, name, county, store_ids, pos) values
  ('livingston-hartland-howell','Hartland · Howell','Livingston',
    array['meijer-hartland-245','kroger-hartland-444','meijer-howell-172','walmart-howell-1754'],0),
  ('livingston-brighton-pinckney','Brighton · Hamburg · Pinckney','Livingston',
    array['kroger-brighton-638','kroger-brighton','buschs-pinckney-1051'],1)
on conflict (id) do nothing;
