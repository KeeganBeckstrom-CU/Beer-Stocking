-- Beer Stocking: shared data for every signed-in person on the team.
-- Run once in the Supabase SQL editor. Safe to re-run.
-- Every table is readable and writable by signed-in users only (row level security); nobody without an account can see anything.

-- People: one row per account, made by the app right after sign-up
create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  first text not null default '',
  last text not null default '',
  created_at timestamptz not null default now()
);

-- Stores (chain = kroger / meijer / walmart / buschs, num = store #)
create table if not exists stores (
  id text primary key,
  name text not null,
  chain text,
  town text,
  num text,
  pos int not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

-- Items typed in on a phone that aren't in the built-in catalog
create table if not exists custom_items (
  id text primary key,
  brand text not null,
  flavor text not null default '',
  size text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

-- One row per item on a store's list. kind = 'truck' or 'backstock'
-- floor = how many were counted on the shelf, qty = how many are needed, out = how many actually went out
create table if not exists list_items (
  store_id text not null references stores on delete cascade,
  kind text not null check (kind in ('truck','backstock')),
  item_id text not null,
  pos int not null default 0,
  qty int not null default 0,
  floor int,
  seen boolean not null default false,
  done boolean not null default false,
  out int,
  note text,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (store_id, kind, item_id)
);

-- How many fit on the shelf for each item at each store (changes with resets and end caps)
create table if not exists shelf (
  store_id text not null references stores on delete cascade,
  item_id text not null,
  cap int not null check (cap >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (store_id, item_id)
);

-- Back stock on hand at each store
create table if not exists back_stock (
  store_id text not null references stores on delete cascade,
  item_id text not null,
  n int not null check (n >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (store_id, item_id)
);

-- Every change to back stock, kept automatically (filled by the trigger below)
create table if not exists back_stock_log (
  id bigint generated always as identity primary key,
  store_id text not null,
  item_id text not null,
  n_before int,
  n_after int,
  by_user uuid,
  at timestamptz not null default now()
);

-- Finished pull lists: items = how many went out, need = how many were needed
create table if not exists pulls (
  id uuid primary key default gen_random_uuid(),
  store_id text not null,
  store_name text not null,
  kind text not null,
  at timestamptz not null default now(),
  by_name text,
  by_user uuid default auth.uid(),
  items jsonb not null default '{}',
  need jsonb not null default '{}'
);
create index if not exists pulls_at on pulls (at desc);

-- Keep updated_at / updated_by current on every change
create or replace function touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); new.updated_by := coalesce(auth.uid(), new.updated_by); return new; end $$;

do $$ declare t text; begin
  foreach t in array array['stores','custom_items','list_items','shelf','back_stock'] loop
    execute format('drop trigger if exists touch_%1$s on %1$s', t);
    execute format('create trigger touch_%1$s before insert or update on %1$s for each row execute function touch()', t);
  end loop;
end $$;

-- Back stock log
create or replace function log_back_stock() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    insert into back_stock_log (store_id, item_id, n_before, n_after, by_user) values (old.store_id, old.item_id, old.n, null, auth.uid());
    return old;
  end if;
  if tg_op = 'INSERT' or old.n is distinct from new.n then
    insert into back_stock_log (store_id, item_id, n_before, n_after, by_user)
    values (new.store_id, new.item_id, case when tg_op = 'UPDATE' then old.n end, new.n, auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists back_stock_logger on back_stock;
create trigger back_stock_logger after insert or update or delete on back_stock for each row execute function log_back_stock();

-- Row level security: signed-in team members can read and change everything; profiles can only be edited by their owner
do $$ declare t text; begin
  foreach t in array array['stores','custom_items','list_items','shelf','back_stock','pulls'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists team_all on %I', t);
    execute format('create policy team_all on %I for all to authenticated using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;
alter table back_stock_log enable row level security;
drop policy if exists team_read on back_stock_log;
create policy team_read on back_stock_log for select to authenticated using (true);
grant select on back_stock_log to authenticated;

alter table profiles enable row level security;
drop policy if exists read_all on profiles;
create policy read_all on profiles for select to authenticated using (true);
drop policy if exists write_own on profiles;
create policy write_own on profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists update_own on profiles;
create policy update_own on profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
grant select, insert, update on profiles to authenticated;

-- Nothing for people who aren't signed in
revoke all on profiles, stores, custom_items, list_items, shelf, back_stock, back_stock_log, pulls from anon;

-- Live updates between phones
do $$ declare t text; begin
  foreach t in array array['stores','custom_items','list_items','shelf','back_stock','pulls'] loop
    begin execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;
alter table list_items replica identity full;
alter table shelf replica identity full;
alter table back_stock replica identity full;
alter table stores replica identity full;
alter table custom_items replica identity full;

-- The seven Livingston County stores
insert into stores (id, name, chain, town, num, pos) values
  ('meijer-hartland-245','Meijer Hartland','meijer','Hartland','245',0),
  ('kroger-hartland-444','Kroger Hartland','kroger','Hartland','444',1),
  ('meijer-howell-172','Meijer Howell','meijer','Howell','172',2),
  ('walmart-howell-1754','Walmart Howell','walmart','Howell','1754',3),
  ('kroger-brighton-638','Kroger Brighton','kroger','Brighton','638',4),
  ('kroger-brighton','Kroger Hamburg','kroger','Hamburg','721',5),
  ('buschs-pinckney-1051','Busch''s Pinckney','buschs','Pinckney','1051',6)
on conflict (id) do nothing;
