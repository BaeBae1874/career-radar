import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSafeNextPath } from "@/lib/authForm";

const EMAIL_OTP_TYPES = new Set(["signup", "email", "invite", "magiclink", "recovery", "email_change"]);

/**
 * 회원가입 인증 메일의 링크가 도착하는 곳.
 * - 기본 메일 템플릿(PKCE): ?code=...  → exchangeCodeForSession
 * - token_hash 템플릿: ?token_hash=...&type=email → verifyOtp
 * 성공하면 cookie에 세션을 쓰고 next(내부 경로만)로, 실패하면 /login?error=confirm
 */
export async function GET(request) {
  const { searchParams } = request.nextUrl;
  const next = getSafeNextPath(searchParams.get("next"));
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  const supabase = await createSupabaseServerClient();
  if (supabase) {
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(new URL(next, request.url));
    } else if (tokenHash && EMAIL_OTP_TYPES.has(type)) {
      const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
      if (!error) return NextResponse.redirect(new URL(next, request.url));
    }
  }
  return NextResponse.redirect(new URL("/login?error=confirm", request.url));
}
