import { getAuthedSupabase } from "@/lib/supabase/server";
import { forbiddenOrigin, isSameOrigin, json, readJsonBody, serverError, unauthorized } from "@/lib/apiRoute";
import { deleteCustomJob, insertCustomJob, listCustomJobs, updateCustomJob } from "@/lib/customJobsDb";

/**
 * 직접 추가한 공고 API (로그인 사용자 전용)
 * - GET              → 내가 추가한 공고 목록 (최신순)
 * - POST   { job }   → 저장 (정리된 사실 데이터만, 원문 없음)
 * - PATCH  { id, job } → 수정
 * - DELETE { id }    → 삭제
 *
 * user_id는 항상 서버의 로그인 사용자(getClaims). 클라이언트 값은 받지 않는다.
 * DB 요청은 publishable key + 사용자 세션이라 RLS가 한 번 더 막는다. service-role key는 쓰지 않는다.
 */

const MAX_BODY_BYTES = 32 * 1024;

const respond = (r, okBody) => (r.ok ? json(okBody(r)) : r.status === 500 ? serverError() : json({ error: r.error }, r.status));

export async function GET() {
  const { supabase, user } = await getAuthedSupabase();
  if (!user) return json({ authenticated: false, items: [] });
  const r = await listCustomJobs(supabase, user.id);
  return respond(r, ({ items }) => ({ authenticated: true, items }));
}

export async function POST(request) {
  if (!isSameOrigin(request)) return forbiddenOrigin();
  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body) return json({ error: "공고 정보가 올바르지 않아요." }, 400);
  const { supabase, user } = await getAuthedSupabase();
  if (!user) return unauthorized();
  const r = await insertCustomJob(supabase, user.id, body.job);
  return respond(r, ({ item }) => ({ saved: true, item }));
}

export async function PATCH(request) {
  if (!isSameOrigin(request)) return forbiddenOrigin();
  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body) return json({ error: "공고 정보가 올바르지 않아요." }, 400);
  const { supabase, user } = await getAuthedSupabase();
  if (!user) return unauthorized();
  const r = await updateCustomJob(supabase, user.id, body.id, body.job);
  return respond(r, ({ item }) => ({ updated: true, item }));
}

export async function DELETE(request) {
  if (!isSameOrigin(request)) return forbiddenOrigin();
  const body = await readJsonBody(request, 1024);
  if (!body) return json({ error: "삭제할 공고 정보가 올바르지 않아요." }, 400);
  const { supabase, user } = await getAuthedSupabase();
  if (!user) return unauthorized();
  const r = await deleteCustomJob(supabase, user.id, body.id);
  return respond(r, ({ id }) => ({ deleted: true, id }));
}
