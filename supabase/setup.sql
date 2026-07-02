-- Sigma Label LLC Supabase setup
-- Run this in Supabase SQL Editor before publishing the site.
-- This file uses Supabase Auth for admin passwords. Do NOT store admin passwords in front-end code.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.is_sigma_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = any (array[
    'sigmalabelllc@gmail.com',
    'inquiries.djsxd@gmail.com',
    'thesamuraiiikun@protonmail.com',
    'enderprice2@gmail.com',
    'heatitprod@gmail.com'
  ]);
$$;

create table if not exists public.admin_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Seed the approved admin emails into Supabase Auth so the default password works on first login.
do $$
declare
  v_email text;
  v_user_id uuid;
  v_now timestamptz := now();
  v_default_password text := 'SigmaLabelSecretAdmin218934';
  allowed_emails text[] := array[
    'sigmalabelllc@gmail.com',
    'inquiries.djsxd@gmail.com',
    'thesamuraiiikun@protonmail.com',
    'enderprice2@gmail.com',
    'heatitprod@gmail.com'
  ];
begin
  foreach v_email in array allowed_emails
  loop
    select id into v_user_id from auth.users where lower(email) = lower(v_email) limit 1;

    if v_user_id is null then
      v_user_id := gen_random_uuid();

      insert into auth.users (
        instance_id,
        id,
        aud,
        role,
        email,
        encrypted_password,
        email_confirmed_at,
        invited_at,
        confirmation_token,
        confirmation_sent_at,
        recovery_token,
        recovery_sent_at,
        email_change_token_new,
        email_change,
        email_change_sent_at,
        last_sign_in_at,
        raw_app_meta_data,
        raw_user_meta_data,
        is_super_admin,
        created_at,
        updated_at,
        phone,
        phone_confirmed_at,
        phone_change,
        phone_change_token,
        phone_change_sent_at,
        email_change_token_current,
        email_change_confirm_status,
        banned_until,
        reauthentication_token,
        reauthentication_sent_at,
        is_sso_user,
        deleted_at,
        is_anonymous
      ) values (
        '00000000-0000-0000-0000-000000000000',
        v_user_id,
        'authenticated',
        'authenticated',
        lower(v_email),
        crypt(v_default_password, gen_salt('bf')),
        v_now,
        v_now,
        '',
        null,
        '',
        null,
        '',
        '',
        null,
        null,
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{}'::jsonb,
        false,
        v_now,
        v_now,
        null,
        null,
        '',
        '',
        null,
        '',
        0,
        null,
        '',
        null,
        false,
        null,
        false
      );
    else
      -- Reset the seeded admin back to the default password when this setup file is rerun.
      -- After admins change passwords, do not rerun this seed block unless you want to reset them again.
      update auth.users
      set encrypted_password = crypt(v_default_password, gen_salt('bf')),
          email_confirmed_at = coalesce(email_confirmed_at, v_now),
          updated_at = v_now
      where id = v_user_id;
    end if;

    insert into auth.identities (
      id,
      user_id,
      identity_data,
      provider,
      provider_id,
      last_sign_in_at,
      created_at,
      updated_at
    )
    select
      gen_random_uuid(),
      v_user_id,
      jsonb_build_object('sub', v_user_id::text, 'email', lower(v_email), 'email_verified', true),
      'email',
      lower(v_email),
      null,
      v_now,
      v_now
    where not exists (
      select 1
      from auth.identities
      where user_id = v_user_id
        and provider = 'email'
    );

    insert into public.admin_profiles (user_id, email)
    values (v_user_id, lower(v_email))
    on conflict (user_id) do update set email = excluded.email;
  end loop;
end $$;

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'released')),
  release_title text not null,
  preferred_release_date date,
  release_platform text,
  release_link text,
  contact_email text not null,
  primary_artist text,
  artists jsonb not null default '[]'::jsonb,
  additional_versions text[] not null default '{}'::text[],
  notes text,
  submitted_from text,
  board_position jsonb,
  cover_art_url text,
  accepted_at timestamptz,
  rejected_at timestamptz,
  released_at timestamptz
);

create index if not exists submissions_status_idx on public.submissions(status);
create index if not exists submissions_release_date_idx on public.submissions(preferred_release_date);
create index if not exists submissions_rejected_at_idx on public.submissions(rejected_at);

create table if not exists public.release_messages (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  admin_user_id uuid references auth.users(id) on delete set null,
  admin_email text,
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists release_messages_submission_idx on public.release_messages(submission_id, created_at);

create or replace trigger admin_profiles_updated_at
before update on public.admin_profiles
for each row execute function public.set_updated_at();

create or replace trigger submissions_updated_at
before update on public.submissions
for each row execute function public.set_updated_at();

alter table public.admin_profiles enable row level security;
alter table public.submissions enable row level security;
alter table public.release_messages enable row level security;

-- Admin profiles: approved admin emails can read/upsert their own profile.
drop policy if exists "admins can read admin profiles" on public.admin_profiles;
create policy "admins can read admin profiles"
on public.admin_profiles
for select
to authenticated
using (public.is_sigma_admin());

drop policy if exists "admins can insert own profile" on public.admin_profiles;
create policy "admins can insert own profile"
on public.admin_profiles
for insert
to authenticated
with check (public.is_sigma_admin() and user_id = auth.uid() and lower(email) = lower(auth.jwt() ->> 'email'));

drop policy if exists "admins can update own profile" on public.admin_profiles;
create policy "admins can update own profile"
on public.admin_profiles
for update
to authenticated
using (public.is_sigma_admin() and user_id = auth.uid())
with check (public.is_sigma_admin() and user_id = auth.uid());

-- Public submission insert only. Public users cannot read the board.
drop policy if exists "public can create submissions" on public.submissions;
create policy "public can create submissions"
on public.submissions
for insert
to anon, authenticated
with check (status = 'pending');

drop policy if exists "admins can read submissions" on public.submissions;
create policy "admins can read submissions"
on public.submissions
for select
to authenticated
using (public.is_sigma_admin());

drop policy if exists "admins can update submissions" on public.submissions;
create policy "admins can update submissions"
on public.submissions
for update
to authenticated
using (public.is_sigma_admin())
with check (public.is_sigma_admin());

drop policy if exists "admins can delete submissions" on public.submissions;
create policy "admins can delete submissions"
on public.submissions
for delete
to authenticated
using (public.is_sigma_admin());

-- Admin chat. The UI deletes old messages on load and only displays messages from the last 24 hours.
drop policy if exists "admins can read recent release messages" on public.release_messages;
create policy "admins can read recent release messages"
on public.release_messages
for select
to authenticated
using (public.is_sigma_admin() and created_at >= now() - interval '24 hours');

drop policy if exists "admins can create release messages" on public.release_messages;
create policy "admins can create release messages"
on public.release_messages
for insert
to authenticated
with check (public.is_sigma_admin() and admin_user_id = auth.uid());

drop policy if exists "admins can delete release messages" on public.release_messages;
create policy "admins can delete release messages"
on public.release_messages
for delete
to authenticated
using (public.is_sigma_admin());

create or replace function public.cleanup_old_release_messages()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.release_messages where created_at < now() - interval '24 hours';
$$;

create or replace function public.cleanup_old_rejected_submissions()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.submissions
  where status = 'rejected'
    and coalesce(rejected_at, updated_at, created_at) < now() - interval '7 days';
$$;

-- Optional database-side automation for fully automatic cleanup without opening the admin page.
-- In Supabase, enable pg_cron first if you want this scheduled cleanup to run daily:
-- create extension if not exists pg_cron with schema extensions;
-- select cron.schedule(
--   'cleanup-old-rejected-submissions',
--   '0 3 * * *',
--   'select public.cleanup_old_rejected_submissions();'
-- );

-- Optional storage bucket for release cover uploads from the admin board.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('release-covers', 'release-covers', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public can read release covers" on storage.objects;
create policy "public can read release covers"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'release-covers');

drop policy if exists "admins can upload release covers" on storage.objects;
create policy "admins can upload release covers"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'release-covers' and public.is_sigma_admin());

drop policy if exists "admins can update release covers" on storage.objects;
create policy "admins can update release covers"
on storage.objects
for update
to authenticated
using (bucket_id = 'release-covers' and public.is_sigma_admin())
with check (bucket_id = 'release-covers' and public.is_sigma_admin());

drop policy if exists "admins can delete release covers" on storage.objects;
create policy "admins can delete release covers"
on storage.objects
for delete
to authenticated
using (bucket_id = 'release-covers' and public.is_sigma_admin());
