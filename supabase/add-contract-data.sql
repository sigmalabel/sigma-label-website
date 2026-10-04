-- Migration: Add contract_data to public.submissions
-- Run this in the Supabase SQL Editor to support custom contract settings per submission.

alter table public.submissions
add column if not exists contract_data jsonb;

comment on column public.submissions.contract_data is 'Stores customized contract and split settings (labels, artists, legal names, custom dates, split percentages)';
