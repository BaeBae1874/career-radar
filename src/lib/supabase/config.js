/**
 * Supabase 공개 설정 (브라우저에 노출돼도 되는 값만)
 * - NEXT_PUBLIC_SUPABASE_URL: 프로젝트 API URL (DB 접속 문자열 아님)
 * - NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishable key (RLS로 보호되는 공개 키)
 * service-role / secret key는 이 앱에서 쓰지 않는다.
 *
 * 값이 없으면 인증 기능만 꺼지고, 검색·비교·분석은 그대로 동작한다.
 * (NEXT_PUBLIC_ 값은 빌드 때 그대로 치환되므로 process.env.이름 형태로 직접 읽는다)
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

export const isSupabaseConfigured = () => Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

/** 로그인해야 들어갈 수 있는 경로 (proxy에서 1차, 페이지 서버 코드에서 다시 확인) */
export const PROTECTED_PATHS = ["/saved"];

export const isProtectedPath = (pathname) =>
  typeof pathname === "string" &&
  PROTECTED_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
