"use client";

import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, isSupabaseConfigured } from "./config";

/**
 * 브라우저용 Supabase client (publishable key만 사용, 세션은 cookie에 저장)
 * 환경변수가 없으면 null → 화면에서는 로그인 기능만 비활성
 */
export function getSupabaseBrowserClient() {
  if (!isSupabaseConfigured()) return null;
  // createBrowserClient는 브라우저에서 같은 인스턴스를 재사용한다
  return createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
}
