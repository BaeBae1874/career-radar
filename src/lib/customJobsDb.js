/**
 * 직접 추가한 공고 DB 처리 (career_custom_jobs)
 * supabase client와 로그인 사용자 id는 route가 넘겨준다 (서버의 getClaims 결과, 클라이언트 값 아님).
 * 모든 쿼리에 user_id 조건을 붙이고, DB에서도 RLS가 한 번 더 막는다.
 * route에서 분리한 이유: 가짜 client로 사용자 범위·검증을 테스트하기 위해.
 */

import { normalizeCustomRowId, toCustomJobItem, toCustomSnapshot } from "./customJobs.js";
import { formatSavedDate } from "./savedComparisons.js";

export const CUSTOM_JOBS_TABLE = "career_custom_jobs";
export const MAX_CUSTOM_JOBS = 200;
const SELECT = "id, company, title, structured_snapshot, created_at";

const fail = (status, error) => ({ ok: false, status, error });
const logCode = (tag, error) => console.error(`[custom-jobs] ${tag}`, error?.code ?? "");

/** 내가 추가한 공고 목록 (최신순) */
export async function listCustomJobs(supabase, userId) {
  const { data, error } = await supabase
    .from(CUSTOM_JOBS_TABLE)
    .select(SELECT)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(MAX_CUSTOM_JOBS);
  if (error) {
    logCode("list failed", error);
    return fail(500, "잠시 후 다시 시도해 주세요.");
  }
  return { ok: true, items: (data ?? []).map((r) => toCustomJobItem(r, formatSavedDate)).filter(Boolean) };
}

/** 저장: 서버에서 다시 거른 snapshot만 저장 (AI 응답·원문을 그대로 넣지 않음) */
export async function insertCustomJob(supabase, userId, job) {
  const snapshot = toCustomSnapshot(job);
  if (!snapshot) return fail(400, "회사명과 공고명을 확인해 주세요.");
  const { data, error } = await supabase
    .from(CUSTOM_JOBS_TABLE)
    .insert({ user_id: userId, company: snapshot.company, title: snapshot.title, structured_snapshot: snapshot })
    .select(SELECT)
    .single();
  if (error) {
    logCode("insert failed", error);
    return fail(500, "잠시 후 다시 시도해 주세요.");
  }
  const item = toCustomJobItem(data, formatSavedDate);
  return item ? { ok: true, item } : fail(500, "잠시 후 다시 시도해 주세요.");
}

/** 수정: 내 row만 (id + user_id) */
export async function updateCustomJob(supabase, userId, id, job) {
  const rowId = normalizeCustomRowId(id);
  if (!rowId) return fail(400, "수정할 공고 정보가 올바르지 않아요.");
  const snapshot = toCustomSnapshot(job);
  if (!snapshot) return fail(400, "회사명과 공고명을 확인해 주세요.");
  const { data, error } = await supabase
    .from(CUSTOM_JOBS_TABLE)
    .update({ company: snapshot.company, title: snapshot.title, structured_snapshot: snapshot })
    .eq("user_id", userId)
    .eq("id", rowId)
    .select(SELECT)
    .maybeSingle();
  if (error) {
    logCode("update failed", error);
    return fail(500, "잠시 후 다시 시도해 주세요.");
  }
  // 내 row가 아니거나 없는 id → RLS·조건 때문에 0건
  if (!data) return fail(404, "공고를 찾지 못했어요.");
  return { ok: true, item: toCustomJobItem(data, formatSavedDate) };
}

/** 삭제: 내 row만 (id + user_id) */
export async function deleteCustomJob(supabase, userId, id) {
  const rowId = normalizeCustomRowId(id);
  if (!rowId) return fail(400, "삭제할 공고 정보가 올바르지 않아요.");
  const { error } = await supabase.from(CUSTOM_JOBS_TABLE).delete().eq("user_id", userId).eq("id", rowId);
  if (error) {
    logCode("delete failed", error);
    return fail(500, "잠시 후 다시 시도해 주세요.");
  }
  return { ok: true, id: rowId };
}
