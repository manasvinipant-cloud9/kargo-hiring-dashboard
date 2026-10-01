-- Kargo Hiring schema. Safe to run in a shared Supabase project: only touches public.candidates
-- and a function with a unique name (candidates_set_updated_at).
create table if not exists public.candidates (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  file_name text not null,
  applied_role text not null check (applied_role in ('PM','SPM')),
  full_name text,
  email text,
  phone text,
  redacted_text text,
  status text not null default 'processing' check (status in ('processing','scored','error')),
  error text,
  pm_score numeric,
  spm_score numeric,
  pm_breakdown jsonb,
  spm_breakdown jsonb,
  years_pm_experience numeric,
  summary text,
  best_fit_role text,
  recommendation text check (recommendation in ('interview','maybe','reject')),
  interview_brief jsonb,
  invite_subject text,
  invite_body text,
  rejection_subject text,
  rejection_body text,
  decision text not null default 'pending' check (decision in ('pending','invite','reject')),
  email_status text not null default 'draft' check (email_status in ('draft','sent','failed')),
  email_sent_at timestamptz,
  email_error text,
  sent_email_type text check (sent_email_type in ('invite','rejection'))
);
create index if not exists candidates_role_idx on public.candidates (applied_role);
create index if not exists candidates_pm_score_idx on public.candidates (pm_score desc);
create index if not exists candidates_spm_score_idx on public.candidates (spm_score desc);

create or replace function public.candidates_set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists candidates_updated_at on public.candidates;
create trigger candidates_updated_at before update on public.candidates
for each row execute function public.candidates_set_updated_at();

-- Deny-all to anon/authenticated. Only the server (secret key) reads/writes.
alter table public.candidates enable row level security;
