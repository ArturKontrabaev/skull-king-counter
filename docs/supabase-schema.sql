-- Skull King Counter — схема для Supabase.
-- Вставить в Supabase → SQL Editor → RUN (один раз).

-- Партии: храним всё состояние партии как JSON по её id.
create table if not exists public.games (
  id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

-- Общая база «тусовки» (игроки + статы) — по id группы.
create table if not exists public.rosters (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- RLS включаем, но для игры-считалки доступ открытый по знанию id
-- (анонимный ключ публичный; защита — случайные id партий/групп).
alter table public.games enable row level security;
alter table public.rosters enable row level security;

drop policy if exists "games_anon_all" on public.games;
create policy "games_anon_all" on public.games
  for all to anon using (true) with check (true);

drop policy if exists "rosters_anon_all" on public.rosters;
create policy "rosters_anon_all" on public.rosters
  for all to anon using (true) with check (true);

-- (опционально) живые обновления для зрителей — включим realtime на games:
alter publication supabase_realtime add table public.games;
