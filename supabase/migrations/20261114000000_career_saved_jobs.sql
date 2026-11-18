-- Career Radar: 관심 공고 저장 (career_saved_jobs)
-- my-intro 프로젝트와 같은 Supabase를 쓰므로 Career Radar 테이블은 career_ prefix를 사용한다.
-- Supabase SQL Editor에서 한 번 실행한다. (여러 번 실행해도 안전하도록 if not exists / drop policy if exists 사용)

create table if not exists public.career_saved_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id text not null check (char_length(job_id) between 1 and 200),
  job_snapshot jsonb not null check (jsonb_typeof(job_snapshot) = 'object'),
  created_at timestamptz not null default now(),
  constraint career_saved_jobs_user_job_unique unique (user_id, job_id)
);

-- 저장함 목록: 내 저장 공고를 최신순으로
create index if not exists career_saved_jobs_user_created_idx
  on public.career_saved_jobs (user_id, created_at desc);

-- Row Level Security: 반드시 켠다
alter table public.career_saved_jobs enable row level security;

-- 비로그인(anon)에게는 아무 권한도 주지 않는다. 로그인 사용자에게는 읽기·추가·삭제만 (수정 없음)
revoke all on table public.career_saved_jobs from anon;
revoke all on table public.career_saved_jobs from authenticated;
grant select, insert, delete on table public.career_saved_jobs to authenticated;

drop policy if exists "career_saved_jobs_select_own" on public.career_saved_jobs;
drop policy if exists "career_saved_jobs_insert_own" on public.career_saved_jobs;
drop policy if exists "career_saved_jobs_delete_own" on public.career_saved_jobs;

-- 자신의 row만 조회
create policy "career_saved_jobs_select_own"
  on public.career_saved_jobs
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- 자신의 user_id로만 추가
create policy "career_saved_jobs_insert_own"
  on public.career_saved_jobs
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

-- 자신의 row만 삭제
create policy "career_saved_jobs_delete_own"
  on public.career_saved_jobs
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
