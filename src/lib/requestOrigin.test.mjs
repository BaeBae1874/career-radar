import { test } from "node:test";
import assert from "node:assert/strict";
import { isAllowedRequestOrigin, parseAllowedOrigins, toOrigin } from "./requestOrigin.js";

// next dev가 듣는 주소 (SSH 터널 안쪽)
const SERVER = "http://localhost:3016";

test("SSH 포트포워딩: 브라우저 주소 18016, 서버 3016 → Host 기준으로 허용", () => {
  assert.equal(
    isAllowedRequestOrigin({
      origin: "http://localhost:18016",
      secFetchSite: "same-origin",
      host: "localhost:18016",
      requestOrigin: SERVER,
    }),
    true
  );
});

test("서버에 직접 접속: localhost:3016 허용", () => {
  assert.equal(
    isAllowedRequestOrigin({ origin: SERVER, host: "localhost:3016", requestOrigin: SERVER }),
    true
  );
});

test("Host 헤더가 없어도 요청 URL origin과 같으면 허용", () => {
  assert.equal(isAllowedRequestOrigin({ origin: SERVER, host: null, requestOrigin: SERVER }), true);
});

test("APP_ALLOWED_ORIGINS에 적은 주소는 허용 (배포 주소 등)", () => {
  const allowedOrigins = parseAllowedOrigins(
    "http://localhost:3016, http://localhost:18016 ,https://career-radar.netlify.app"
  );
  for (const origin of ["http://localhost:18016", "https://career-radar.netlify.app"]) {
    assert.equal(
      isAllowedRequestOrigin({ origin, host: "internal:8080", requestOrigin: "http://internal:8080", allowedOrigins }),
      true,
      origin
    );
  }
});

test("다른 사이트에서 보낸 요청은 거부", () => {
  const base = { host: "localhost:18016", requestOrigin: SERVER };
  assert.equal(isAllowedRequestOrigin({ ...base, origin: "https://evil.example" }), false);
  assert.equal(isAllowedRequestOrigin({ ...base, origin: "http://localhost:18017" }), false);
  // 포트가 같아도 다른 호스트는 거부
  assert.equal(isAllowedRequestOrigin({ ...base, origin: "http://evil.localhost:18016" }), false);
});

test("허용 목록에 없는 배포 주소 흉내는 거부", () => {
  const allowedOrigins = parseAllowedOrigins("https://career-radar.netlify.app");
  assert.equal(
    isAllowedRequestOrigin({
      origin: "https://career-radar.netlify.app.evil.example",
      host: "career-radar.netlify.app",
      requestOrigin: "https://career-radar.netlify.app",
      allowedOrigins,
    }),
    false
  );
});

test("형식이 이상한 Origin·null Origin은 거부", () => {
  const base = { host: "localhost:18016", requestOrigin: SERVER };
  for (const origin of ["null", "not a url", "file:///etc/passwd", "javascript:alert(1)"]) {
    assert.equal(isAllowedRequestOrigin({ ...base, origin }), false, origin);
  }
});

test("Host 헤더에 이상한 값이 오면 Host 비교에 쓰지 않는다", () => {
  assert.equal(
    isAllowedRequestOrigin({ origin: "http://evil.example", host: "evil.example/../", requestOrigin: SERVER }),
    false
  );
});

test("Origin이 없을 때: cross-site 표시는 거부, 그 외는 기존처럼 허용", () => {
  const base = { host: "localhost:18016", requestOrigin: SERVER };
  assert.equal(isAllowedRequestOrigin({ ...base, origin: null, secFetchSite: "cross-site" }), false);
  assert.equal(isAllowedRequestOrigin({ ...base, origin: null, secFetchSite: "same-origin" }), true);
  assert.equal(isAllowedRequestOrigin({ ...base, origin: null, secFetchSite: null }), true);
});

test("APP_ALLOWED_ORIGINS 파싱: '*'·잘못된 값 제외, 경로 제거, 중복 제거", () => {
  assert.deepEqual(
    parseAllowedOrigins("*, https://*.netlify.app, ftp://x.com, nope, https://a.com/path, https://a.com"),
    ["https://a.com"]
  );
  assert.deepEqual(parseAllowedOrigins(""), []);
  assert.deepEqual(parseAllowedOrigins(undefined), []);
});

test("toOrigin: http(s)만, 기본 포트는 생략된 형태로", () => {
  assert.equal(toOrigin("https://a.com:443/x"), "https://a.com");
  assert.equal(toOrigin("http://localhost:18016/"), "http://localhost:18016");
  assert.equal(toOrigin("null"), "");
  assert.equal(toOrigin(1), "");
});
