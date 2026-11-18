-- Career Radar: 직접 추가한 공고 (career_custom_jobs)
-- my-intro 프로젝트와 같은 Supabase를 쓰므로 Career Radar 테이블은 career_ prefix를 사용한다.
-- Supabase SQL Editor에서 한 번 실행한다. (여러 번 실행해도 안전하도록 if not exists / drop policy if exists 사용)
--
-- 저장 내용: 사용자가 붙여넣은 공고를 정리한 사실 데이터(structured_snapshot)만
--   (회사명·공고명·주요 업무·자격요건·우대사항·키워드·근무형태·경력·지역·마감)
-- 저장하지 않음: 붙여넣은 공고 원문 전체, AI 분석 결과

create table if not exists public.career_custom_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  company text not null check (char_length(company) between 1 and 100),
  title text not null check (char_length(title) between 1 and 200),
  structured_snapshot jsonb not null check (
    jsonb_typeof(structured_snapshot) = 'object'
    and pg_column_size(structured_snapshot) <= 65536
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 내가 추가한 공고 목록: 최신순
create index if not exists career_custom_jobs_user_created_idx
  on public.career_custom_jobs (user_id, created_at desc);

-- 수정 시각 자동 갱신
create or replace function public.career_custom_jobs_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists career_custom_jobs_touch_updated_at on public.career_custom_jobs;
create trigger career_custom_jobs_touch_updated_at
  before update on public.career_custom_jobs
  for each row execute function public.career_custom_jobs_touch_updated_at();

-- Row Level Security: 반드시 켠다
alter table public.career_custom_jobs enable row level security;

-- 비로그인(anon)에게는 아무 권한도 주지 않는다. 로그인 사용자에게는 읽기·추가·수정·삭제
revoke all on table public.career_custom_jobs from anon;
revoke all on table public.career_custom_jobs from authenticated;
grant select, insert, update, delete on table public.career_custom_jobs to authenticated;

drop policy if exists "career_custom_jobs_select_own" on public.career_custom_jobs;
drop policy if exists "career_custom_jobs_insert_own" on public.career_custom_jobs;
drop policy if exists "career_custom_jobs_update_own" on public.career_custom_jobs;
drop policy if exists "career_custom_jobs_delete_own" on public.career_custom_jobs;

-- 자신의 row만 조회
create policy "career_custom_jobs_select_own"
  on public.career_custom_jobs
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- 자신의 user_id로만 추가
create policy "career_custom_jobs_insert_own"
  on public.career_custom_jobs
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

-- 자신의 row만 수정 (다른 사용자에게 넘기는 것도 불가)
create policy "career_custom_jobs_update_own"
  on public.career_custom_jobs
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- 자신의 row만 삭제
create policy "career_custom_jobs_delete_own"
  on public.career_custom_jobs
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
