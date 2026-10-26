-- Pixtale Items Table Schema
create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('caption','text','sentiment')),
  text text not null,
  thumb text,
  mood text,
  fav boolean not null default false,
  is_public boolean not null default false,
  created_at timestamptz not null default now()
);

-- Enable Row Level Security
alter table items enable row level security;

-- Policy: users can perform all operations on their own rows
create policy "own rows" on items
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Policy: public rows are readable by anyone
create policy "public rows readable" on items
  for select
  using (is_public = true);
