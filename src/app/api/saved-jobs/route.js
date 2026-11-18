import { getAuthedSupabase } from "@/lib/supabase/server";
import { forbiddenOrigin, isSameOrigin, json, readJsonBody, serverError, unauthorized } from "@/lib/apiRoute";
import {
  MAX_STATUS_IDS,
  isUniqueViolation,
  normalizeJobId,
  normalizeJobIds,
  toSavedSnapshot,
} from "@/lib/savedJobs";

/**
 * 관심 공고 저장 API (로그인 사용자 전용)
 * - GET    ?id=a&id=b…   → 이 중 저장된 job_id 목록 (검색 결과 한 페이지를 한 번에 조회, N+1 없음)
 * - POST   { job }       → 저장 (user_id는 서버의 로그인 사용자, 클라이언트 값은 받지 않음)
 * - DELETE { jobId }     → 저장 해제
 *
 * 인증: getClaims로 검증한 사용자만. DB 요청은 publishable key + 사용자 세션이라 RLS가 한 번 더 막는다.
 * service-role key는 쓰지 않는다. 로그에는 공고 내용·키를 남기지 않는다.
 */

const TABLE = "career_saved_jobs";
const MAX_BODY_BYTES = 16 * 1024;

export async function GET(request) {
  const raw = request.nextUrl.searchParams.getAll("id");
  if (raw.length > MAX_STATUS_IDS) return json({ error: "한 번에 확인할 수 있는 공고 수를 넘었어요." }, 400);
  const ids = normalizeJobIds(raw);

  const { supabase, user } = await getAuthedSupabase();
  // 비로그인은 오류가 아니라 "저장된 공고 없음" 상태 (화면은 그대로 사용 가능)
  if (!user) return json({ authenticated: false, savedIds: [] });
  if (!ids.length) return json({ authenticated: true, savedIds: [] });

  const { data, error } = await supabase
    .from(TABLE)
    .select("job_id")
    .eq("user_id", user.id)
    .in("job_id", ids);
  if (error) {
    console.error("[saved-jobs] status query failed", error.code ?? "");
    return serverError();
  }
  return json({ authenticated: true, savedIds: (data ?? []).map((r) => r.job_id) });
}

export async function POST(request) {
  if (!isSameOrigin(request)) return forbiddenOrigin();
  const body = await readJsonBody(request, MAX_BODY_BYTES);
  const snapshot = toSavedSnapshot(body?.job);
  if (!snapshot) return json({ error: "저장할 공고 정보가 올바르지 않아요." }, 400);

  const { supabase, user } = await getAuthedSupabase();
  if (!user) return unauthorized();

  const { error } = await supabase
    .from(TABLE)
    .insert({ user_id: user.id, job_id: snapshot.id, job_snapshot: snapshot });
  // 이미 저장된 공고(다른 탭에서 저장 등)는 성공으로 처리
  if (error && !isUniqueViolation(error)) {
    console.error("[saved-jobs] insert failed", error.code ?? "");
    return serverError();
  }
  return json({ saved: true, jobId: snapshot.id });
}

export async function DELETE(request) {
  if (!isSameOrigin(request)) return forbiddenOrigin();
  const body = await readJsonBody(request, MAX_BODY_BYTES);
  const jobId = normalizeJobId(body?.jobId);
  if (!jobId) return json({ error: "해제할 공고 정보가 올바르지 않아요." }, 400);

  const { supabase, user } = await getAuthedSupabase();
  if (!user) return unauthorized();

  const { error } = await supabase.from(TABLE).delete().eq("user_id", user.id).eq("job_id", jobId);
  if (error) {
    console.error("[saved-jobs] delete failed", error.code ?? "");
    return serverError();
  }
  return json({ saved: false, jobId });
}
