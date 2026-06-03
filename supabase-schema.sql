create table if not exists public.app_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_states enable row level security;

drop policy if exists "Users can read own app state" on public.app_states;
drop policy if exists "Users can insert own app state" on public.app_states;
drop policy if exists "Users can update own app state" on public.app_states;
drop policy if exists "Users can delete own app state" on public.app_states;

create policy "Users can read own app state"
on public.app_states for select
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy "Users can insert own app state"
on public.app_states for insert
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy "Users can update own app state"
on public.app_states for update
using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy "Users can delete own app state"
on public.app_states for delete
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);
