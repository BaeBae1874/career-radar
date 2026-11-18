-- Career Radar: 비교 결과 저장 (career_saved_comparisons)
-- my-intro 프로젝트와 같은 Supabase를 쓰므로 Career Radar 테이블은 career_ prefix를 사용한다.
-- Supabase SQL Editor에서 한 번 실행한다. (여러 번 실행해도 안전하도록 if not exists / drop policy if exists 사용)
--
-- 저장 내용: A/B/C 비교를 다시 그리는 데 필요한 공고 사실 데이터 snapshot (2~3개, 저장 당시 순서)
-- 저장하지 않음: AI 비교 요약, 공고 본문
-- 중복: 같은 사용자의 같은 공고 조합(A/B/C 순서 무관)은 한 번만 (job_key unique)

create table if not exists public.career_saved_comparisons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- 저장 당시 A/B/C 순서 그대로의 공고 id
  job_ids text[] not null check (cardinality(job_ids) between 2 and 3),
  -- 순서와 상관없는 공고 조합 키 (정렬한 id 목록의 JSON 문자열)
  job_key text not null check (char_length(job_key) between 2 and 1000),
  comparison_snapshot jsonb not null check (
    jsonb_typeof(comparison_snapshot) = 'object'
    and jsonb_typeof(comparison_snapshot -> 'postings') = 'array'
    and jsonb_array_length(comparison_snapshot -> 'postings') between 2 and 3
  ),
  created_at timestamptz not null default now(),
  constraint career_saved_comparisons_user_key_unique unique (user_id, job_key)
);

-- 저장한 비교 목록: 내 비교를 최신순으로
create index if not exists career_saved_comparisons_user_created_idx
  on public.career_saved_comparisons (user_id, created_at desc);

-- Row Level Security: 반드시 켠다
alter table public.career_saved_comparisons enable row level security;

-- 비로그인(anon)에게는 아무 권한도 주지 않는다. 로그인 사용자에게는 읽기·추가·삭제만 (수정 없음)
revoke all on table public.career_saved_comparisons from anon;
revoke all on table public.career_saved_comparisons from authenticated;
grant select, insert, delete on table public.career_saved_comparisons to authenticated;

drop policy if exists "career_saved_comparisons_select_own" on public.career_saved_comparisons;
drop policy if exists "career_saved_comparisons_insert_own" on public.career_saved_comparisons;
drop policy if exists "career_saved_comparisons_delete_own" on public.career_saved_comparisons;

-- 자신의 row만 조회
create policy "career_saved_comparisons_select_own"
  on public.career_saved_comparisons
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- 자신의 user_id로만 추가
create policy "career_saved_comparisons_insert_own"
  on public.career_saved_comparisons
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

-- 자신의 row만 삭제
create policy "career_saved_comparisons_delete_own"
  on public.career_saved_comparisons
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
