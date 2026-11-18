import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, isSupabaseConfigured } from "./config";

/**
 * 서버(Server Component / Route Handler)용 Supabase client.
 * 요청마다 새로 만든다. (요청 간에 공유하면 다른 사용자의 세션이 섞일 수 있음)
 * 환경변수가 없으면 null.
 */
export async function createSupabaseServerClient() {
  if (!isSupabaseConfigured()) return null;
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Component에서는 cookie를 쓸 수 없다. 세션 갱신은 proxy(src/proxy.js)가 맡는다.
        }
      },
    },
  });
}

/**
 * 서버에서 믿을 수 있는 현재 사용자 (JWT 서명을 검증하는 getClaims 사용)
 * cookie 값만 읽는 getSession()은 서버 판단에 쓰지 않는다.
 * @returns {Promise<{ id: string, email: string } | null>}
 */
export async function getCurrentUser() {
  const { user } = await getAuthedSupabase();
  return user;
}

/**
 * DB 요청용: 요청 사용자의 세션이 담긴 client + 검증된 사용자 (한 client로 인증 확인과 쿼리를 함께)
 * 쿼리는 publishable key + 사용자 JWT로 나가므로 RLS가 그대로 적용된다.
 * @returns {Promise<{ supabase: import("@supabase/supabase-js").SupabaseClient | null, user: { id: string, email: string } | null }>}
 */
export async function getAuthedSupabase() {
  // getClaims()는 토큰 만료 확인에 Date.now()를 쓴다. Cache Components prerender 중에는
  // 요청 시각을 알 수 없으므로, 요청이 들어온 뒤에만 실행되게 여기서 prerender를 멈춘다.
  // (Route Handler에서는 이미 요청 시점이라 바로 지나간다)
  await connection();
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { supabase: null, user: null };
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return { supabase, user: null };
  return {
    supabase,
    user: { id: claims.sub, email: typeof claims.email === "string" ? claims.email : "" },
  };
}
