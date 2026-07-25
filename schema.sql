-- 揪呷團 資料庫結構
-- 使用方式：登入 Neon 專案的 Dashboard，打開左側選單的 "SQL Editor"，貼上整份檔案內容執行一次即可。

create extension if not exists pgcrypto;

create table if not exists menus (
  id uuid primary key default gen_random_uuid(),
  store_name text not null,
  items jsonb not null default '[]'::jsonb,
  image text,
  store_phone text,
  store_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid references menus(id) on delete set null,
  store_name text not null,
  group_name text not null,
  creator_name text not null,
  payer_name text,
  payer_contact text,
  payer_qr_image text,
  status text not null default 'open' check (status in ('open', 'closed')),
  member_orders jsonb not null default '{}'::jsonb,
  paid_status jsonb not null default '{}'::jsonb,
  extra_charges jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists payment_profiles (
  name text primary key,
  contact text,
  qr_image text,
  updated_at timestamptz not null default now()
);

create index if not exists idx_groups_status on groups (status);
create index if not exists idx_groups_created_at on groups (created_at desc);
create index if not exists idx_menus_created_at on menus (created_at desc);
