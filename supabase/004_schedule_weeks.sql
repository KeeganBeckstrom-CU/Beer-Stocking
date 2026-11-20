-- Beer Stocking: the schedule is set week by week (so future weeks can be set early). Run after 003. Safe to re-run.
-- week = the Monday that week starts on.
alter table schedule add column if not exists week date;
update schedule set week = date_trunc('week', (now() at time zone 'America/Detroit'))::date where week is null;
create index if not exists schedule_week on schedule (week);
select count(*) as entries, count(*) filter (where week is null) as without_week from schedule;
