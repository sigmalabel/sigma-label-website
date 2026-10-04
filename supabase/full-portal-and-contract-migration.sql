-- ==============================================================================
-- SIGMA LABEL LLC - CONSOLIDATED DATABASE MIGRATION
-- Applies all columns for Contract Customization and the A&R Scout Portal
-- Run this script in the Supabase SQL Editor (Dashboard -> SQL Editor -> New Query)
-- ==============================================================================

-- 1. Contract Customization & Splits (from Contract Update)
alter table public.submissions
add column if not exists contract_data jsonb;

comment on column public.submissions.contract_data is 'Stores customized contract and split settings (labels, artists, legal names, custom dates, split percentages)';

-- 2. A&R Portal Support (from A&R Update)
alter table public.submissions
add column if not exists submission_type text not null default 'artist';

alter table public.submissions
add column if not exists ar_data jsonb;

comment on column public.submissions.submission_type is 'Type of submission: artist (direct from artist) or ar (scouted through A&R portal)';
comment on column public.submissions.ar_data is 'Scout details for A&R submissions: { name, email, discovery_source, trending_link }';

-- 3. Performance Indexes
create index if not exists submissions_submission_type_idx on public.submissions(submission_type);
create index if not exists submissions_status_type_idx on public.submissions(status, submission_type);
