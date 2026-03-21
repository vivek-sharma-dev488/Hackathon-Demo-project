-- Extensions
create extension if not exists "pgcrypto";

-- Enums
create type public.user_role as enum ('admin', 'user');
create type public.meal_type as enum ('breakfast', 'lunch', 'dinner');
create type public.portion_size as enum ('small', 'medium', 'large');
create type public.booking_status as enum ('confirmed', 'cancelled');

-- Core tables
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role public.user_role not null default 'user',
  created_at timestamptz not null default now()
);

create table if not exists public.meals (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  type public.meal_type not null,
  menu_items jsonb not null,
  booking_deadline timestamptz not null,
  created_at timestamptz not null default now(),
  unique(date, type)
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  meal_id uuid not null references public.meals(id) on delete cascade,
  portion_size public.portion_size not null,
  status public.booking_status not null default 'confirmed',
  created_at timestamptz not null default now(),
  unique (user_id, meal_id)
);

create table if not exists public.waste_logs (
  id uuid primary key default gen_random_uuid(),
  meal_id uuid not null references public.meals(id) on delete cascade,
  prepared_quantity numeric(10,2) not null check (prepared_quantity >= 0),
  consumed_quantity numeric(10,2) not null check (consumed_quantity >= 0),
  wasted_quantity numeric(10,2) not null check (wasted_quantity >= 0),
  date date not null,
  created_at timestamptz not null default now(),
  unique(meal_id, date)
);

-- Helpful indexes
create index if not exists idx_bookings_user_id on public.bookings(user_id);
create index if not exists idx_bookings_meal_id on public.bookings(meal_id);
create index if not exists idx_meals_date on public.meals(date);
create index if not exists idx_waste_logs_date on public.waste_logs(date);

-- Enable row-level security
alter table public.users enable row level security;
alter table public.meals enable row level security;
alter table public.bookings enable row level security;
alter table public.waste_logs enable row level security;

-- Helper function: checks if current auth user has admin role.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'admin'
  );
$$;

-- USERS policies
create policy "Users can view own profile"
on public.users
for select
using (id = auth.uid());

create policy "Users can insert own profile"
on public.users
for insert
with check (id = auth.uid());

create policy "Users can update own profile"
on public.users
for update
using (id = auth.uid())
with check (id = auth.uid());

create policy "Admins can view all profiles"
on public.users
for select
using (public.is_admin());

create policy "Admins can update all profiles"
on public.users
for update
using (public.is_admin())
with check (public.is_admin());

-- MEALS policies
create policy "Anyone authenticated can read meals"
on public.meals
for select
using (auth.role() = 'authenticated');

create policy "Admins can insert meals"
on public.meals
for insert
with check (public.is_admin());

create policy "Admins can update meals"
on public.meals
for update
using (public.is_admin())
with check (public.is_admin());

create policy "Admins can delete meals"
on public.meals
for delete
using (public.is_admin());

-- BOOKINGS policies
create policy "Users can read own bookings"
on public.bookings
for select
using (user_id = auth.uid());

create policy "Admins can read all bookings"
on public.bookings
for select
using (public.is_admin());

create policy "Users can create own bookings"
on public.bookings
for insert
with check (
  user_id = auth.uid()
  and status in ('confirmed', 'cancelled')
);

create policy "Users can update own bookings"
on public.bookings
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "Admins can update all bookings"
on public.bookings
for update
using (public.is_admin())
with check (public.is_admin());

create policy "Admins can delete bookings"
on public.bookings
for delete
using (public.is_admin());

-- WASTE LOGS policies
create policy "Authenticated users can read waste logs"
on public.waste_logs
for select
using (auth.role() = 'authenticated');

create policy "Admins can insert waste logs"
on public.waste_logs
for insert
with check (public.is_admin());

create policy "Admins can update waste logs"
on public.waste_logs
for update
using (public.is_admin())
with check (public.is_admin());

create policy "Admins can delete waste logs"
on public.waste_logs
for delete
using (public.is_admin());

-- Realtime support
alter publication supabase_realtime add table public.meals;
alter publication supabase_realtime add table public.bookings;
alter publication supabase_realtime add table public.waste_logs;
