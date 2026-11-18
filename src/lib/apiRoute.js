import { NextResponse } from "next/server";
import { isAllowedRequestOrigin, parseAllowedOrigins } from "./requestOrigin.js";

/**
 * 로그인 사용자 전용 저장 API(관심 공고·저장한 비교)가 함께 쓰는 Route Handler 도구
 * - 응답: 개인 데이터라 캐시 금지 (private, no-store)
 * - 변경 요청(POST/DELETE): Origin 확인 + JSON 본문만 + 크기 제한
 */

const NO_STORE = { "Cache-Control": "private, no-store" };

export const json = (body, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });
export const unauthorized = () => json({ authenticated: false, error: "로그인이 필요해요." }, 401);
export const serverError = () => json({ error: "잠시 후 다시 시도해 주세요." }, 500);
export const forbiddenOrigin = () => json({ error: "허용되지 않은 요청이에요." }, 403);

// 같은 출처 외에 추가로 허용할 origin (예: 배포 주소). 쉼표로 구분, "*" 불가
const ALLOWED_ORIGINS = parseAllowedOrigins(process.env.APP_ALLOWED_ORIGINS);

/**
 * 다른 사이트에서 보낸 변경 요청 차단.
 * Origin을 브라우저가 실제로 접속한 주소(Host)·요청 URL·APP_ALLOWED_ORIGINS와 비교한다.
 * (request.nextUrl은 서버가 듣는 주소 기준이라 SSH 포트포워딩 주소와 다를 수 있음)
 */
export function isSameOrigin(request) {
  return isAllowedRequestOrigin({
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"),
    host: request.headers.get("host"),
    requestOrigin: request.nextUrl.origin,
    allowedOrigins: ALLOWED_ORIGINS,
  });
}

/** JSON 객체 본문만 읽는다. content-type이 다르거나, 크기를 넘거나, 깨졌으면 null */
export async function readJsonBody(request, maxBytes) {
  if (!request.headers.get("content-type")?.includes("application/json")) return null;
  const text = await request.text().catch(() => "");
  if (!text || text.length > maxBytes) return null;
  try {
    const data = JSON.parse(text);
    return data && typeof data === "object" && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}
