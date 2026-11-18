import { getAuthedSupabase } from "@/lib/supabase/server";
import { forbiddenOrigin, isSameOrigin, json, readJsonBody, serverError, unauthorized } from "@/lib/apiRoute";
import { isUniqueViolation } from "@/lib/savedJobs";
import {
  comparisonKey,
  normalizeComparisonId,
  toComparisonSnapshot,
  toSavedComparisonItem,
} from "@/lib/savedComparisons";

/**
 * 저장한 비교 API (로그인 사용자 전용, AI 요약은 저장하지 않음)
 * - GET                → 내 저장한 비교 목록 (최신순)
 * - GET ?key=<조합 키> → 지금 비교 중인 공고 조합이 이미 저장됐는지 { savedId }
 * - POST   { jobs }    → 현재 비교(공고 2~3개) 저장. 같은 조합이 이미 있으면 그대로 성공
 * - DELETE { id }      → 저장한 비교 삭제
 *
 * user_id는 항상 서버의 로그인 사용자(getClaims). 클라이언트 값은 받지 않는다.
 * DB 요청은 publishable key + 사용자 세션이라 RLS가 한 번 더 막는다. service-role key는 쓰지 않는다.
 * 로그에는 공고 내용·키를 남기지 않는다.
 */

const TABLE = "career_saved_comparisons";
const MAX_BODY_BYTES = 64 * 1024; // 공고 3개 × (업무·자격요건·우대사항) 여유
const MAX_LIST = 100;

export async function GET(request) {
  const rawKey = request.nextUrl.searchParams.get("key");
  const { supabase, user } = await getAuthedSupabase();
  // 비로그인은 오류가 아니라 "저장한 비교 없음" 상태
  if (!user) return json({ authenticated: false, items: [], savedId: null });

  // 저장 여부 확인 (조합 키 기준)
  if (rawKey !== null) {
    let key = "";
    try {
      key = comparisonKey(JSON.parse(rawKey));
    } catch {
      key = "";
    }
    if (!key) return json({ error: "비교 정보가 올바르지 않아요." }, 400);
    const { data, error } = await supabase
      .from(TABLE)
      .select("id")
      .eq("user_id", user.id)
      .eq("job_key", key)
      .maybeSingle();
    if (error) {
      console.error("[saved-comparisons] status query failed", error.code ?? "");
      return serverError();
    }
    return json({ authenticated: true, savedId: data?.id ?? null });
  }

  const { data, error } = await supabase
    .from(TABLE)
    .select("id, comparison_snapshot, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(MAX_LIST);
  if (error) {
    console.error("[saved-comparisons] list query failed", error.code ?? "");
    return serverError();
  }
  return json({ authenticated: true, items: (data ?? []).map(toSavedComparisonItem).filter(Boolean) });
}

export async function POST(request) {
  if (!isSameOrigin(request)) return forbiddenOrigin();
  const body = await readJsonBody(request, MAX_BODY_BYTES);
  const snapshot = toComparisonSnapshot(body?.jobs);
  if (!snapshot) return json({ error: "공고 2~3개를 골라 비교한 뒤 저장해 주세요." }, 400);
  const jobIds = snapshot.postings.map((p) => p.id);
  const key = comparisonKey(jobIds);
  if (!key) return json({ error: "비교 정보가 올바르지 않아요." }, 400);

  const { supabase, user } = await getAuthedSupabase();
  if (!user) return unauthorized();

  const { data, error } = await supabase
    .from(TABLE)
    .insert({ user_id: user.id, job_ids: jobIds, job_key: key, comparison_snapshot: snapshot })
    .select("id")
    .single();

  // 같은 공고 조합을 이미 저장함 → 기존 비교를 그대로 성공으로 (A/B/C 순서만 달라도 같은 비교)
  if (error && isUniqueViolation(error)) {
    const existing = await supabase
      .from(TABLE)
      .select("id")
      .eq("user_id", user.id)
      .eq("job_key", key)
      .maybeSingle();
    if (existing.error) {
      console.error("[saved-comparisons] existing lookup failed", existing.error.code ?? "");
      return serverError();
    }
    return json({ saved: true, id: existing.data?.id ?? null, alreadySaved: true });
  }
  if (error) {
    console.error("[saved-comparisons] insert failed", error.code ?? "");
    return serverError();
  }
  return json({ saved: true, id: data?.id ?? null });
}

export async function DELETE(request) {
  if (!isSameOrigin(request)) return forbiddenOrigin();
  const body = await readJsonBody(request, 1024);
  const id = normalizeComparisonId(body?.id);
  if (!id) return json({ error: "삭제할 비교 정보가 올바르지 않아요." }, 400);

  const { supabase, user } = await getAuthedSupabase();
  if (!user) return unauthorized();

  const { error } = await supabase.from(TABLE).delete().eq("user_id", user.id).eq("id", id);
  if (error) {
    console.error("[saved-comparisons] delete failed", error.code ?? "");
    return serverError();
  }
  return json({ deleted: true, id });
}
