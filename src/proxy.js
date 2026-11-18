import { updateSession } from "@/lib/supabase/proxy";

// Next.js 16: middleware → proxy. 페이지 요청마다 Supabase 세션 cookie를 갱신하고 /saved를 보호한다.
export async function proxy(request) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // 기존 API route(/api/*), 정적 파일, 이미지는 건드리지 않는다
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
