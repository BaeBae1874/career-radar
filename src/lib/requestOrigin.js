/**
 * 변경 요청(POST/DELETE)의 출처 확인 helper (순수 함수, 네트워크 없음)
 *
 * 허용하는 경우:
 *  1) Origin이 요청이 실제로 도착한 주소(Host 헤더)와 같다
 *     - 브라우저는 다른 사이트에서 보낸 요청에도 Host는 우리 주소로, Origin은 그 사이트로 보낸다.
 *       그래서 Origin = Host 이면 같은 출처에서 보낸 요청이다.
 *     - SSH 포트포워딩(18016 → 3016)처럼 서버가 듣는 포트와 브라우저 주소가 달라도 동작한다.
 *  2) Origin이 서버가 인식한 요청 URL의 origin과 같다
 *  3) Origin이 APP_ALLOWED_ORIGINS(쉼표로 구분한 origin 목록)에 있다 (배포 주소 등)
 *
 * 막는 경우:
 *  - 위에 해당하지 않는 Origin (다른 사이트), 형식이 이상한 Origin, "null"
 *  - Origin이 없는데 Sec-Fetch-Site가 cross-site
 * "*" 같은 전체 허용은 지원하지 않는다.
 */

/** "https://a.com/path" → "https://a.com". http(s)가 아니거나 형식이 틀리면 "" */
export function toOrigin(value) {
  if (typeof value !== "string") return "";
  const raw = value.trim();
  if (!raw || raw === "null" || raw.includes("*")) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.origin;
  } catch {
    return "";
  }
}

/** APP_ALLOWED_ORIGINS 값 → origin 목록 (잘못된 항목·"*"는 버림, 중복 제거) */
export function parseAllowedOrigins(value) {
  if (typeof value !== "string") return [];
  const out = [];
  for (const part of value.split(",")) {
    const origin = toOrigin(part);
    if (origin && !out.includes(origin)) out.push(origin);
  }
  return out;
}

/** Host 헤더 값 확인: 호스트명[:포트]만 (경로·공백·사용자 정보 등 거부). 소문자로 */
function normalizeHost(host) {
  if (typeof host !== "string") return "";
  const value = host.trim().toLowerCase();
  return /^[a-z0-9.[\]:-]+$/.test(value) ? value : "";
}

/**
 * @param {{
 *   origin?: string | null,        // Origin 헤더
 *   secFetchSite?: string | null,  // Sec-Fetch-Site 헤더
 *   host?: string | null,          // Host 헤더
 *   requestOrigin?: string,        // 서버가 인식한 요청 URL의 origin (request.nextUrl.origin)
 *   allowedOrigins?: string[],     // parseAllowedOrigins(process.env.APP_ALLOWED_ORIGINS)
 * }} input
 */
export function isAllowedRequestOrigin({
  origin,
  secFetchSite,
  host,
  requestOrigin = "",
  allowedOrigins = [],
}) {
  // Origin이 없는 요청: 브라우저가 다른 사이트에서 보낸 것으로 표시했으면 거부, 아니면 기존처럼 허용
  // (같은 출처의 fetch POST/DELETE에는 브라우저가 Origin을 붙인다)
  if (origin === null || origin === undefined || origin === "") {
    return secFetchSite !== "cross-site";
  }

  const value = toOrigin(origin);
  if (!value) return false;

  const originHost = new URL(value).host;
  const requestHost = normalizeHost(host);
  if (requestHost && originHost === requestHost) return true;
  if (requestOrigin && value === toOrigin(requestOrigin)) return true;
  return allowedOrigins.includes(value);
}
