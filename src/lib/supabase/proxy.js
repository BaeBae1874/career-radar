import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
  isProtectedPath,
  isSupabaseConfigured,
} from "./config";

/** 보호된 경로에 비로그인으로 들어오면 /login?next=원래경로 */
function redirectToLogin(request, response) {
  const url = request.nextUrl.clone();
  const next = request.nextUrl.pathname + request.nextUrl.search;
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(next)}`;
  const redirect = NextResponse.redirect(url);
  // 갱신된 세션 cookie가 있으면 redirect 응답에도 그대로 옮긴다
  response?.cookies.getAll().forEach((c) => redirect.cookies.set(c));
  return redirect;
}

/**
 * 요청마다 Supabase 세션 cookie를 확인·갱신하고(만료된 access token refresh),
 * 보호된 경로(/saved)는 로그인하지 않았으면 /login으로 보낸다.
 * (페이지 서버 코드에서도 다시 확인한다. proxy 확인만 믿지 않음)
 */
export async function updateSession(request) {
  let response = NextResponse.next({ request });
  const { pathname } = request.nextUrl;

  // 설정 전: 인증 기능만 꺼진 상태. 보호된 경로는 로그인 화면(설정 안내)으로
  if (!isSupabaseConfigured()) {
    return isProtectedPath(pathname) ? redirectToLogin(request, null) : response;
  }

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        // 세션 cookie를 쓰는 응답은 CDN 등에 캐시되면 안 된다 (라이브러리가 넘겨주는 no-cache 헤더)
        Object.entries(headers ?? {}).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // createServerClient와 getClaims 사이에 다른 코드를 넣지 않는다 (세션 갱신 순서 보장)
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  if (!user && isProtectedPath(pathname)) return redirectToLogin(request, response);
  return response;
}
