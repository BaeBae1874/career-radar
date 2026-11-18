// 실행: node --test src/lib/supabase/config.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { isProtectedPath, isSupabaseConfigured } from "./config.js";

test("보호 경로: /saved와 그 하위만", () => {
  assert.equal(isProtectedPath("/saved"), true);
  assert.equal(isProtectedPath("/saved/compare"), true);
  assert.equal(isProtectedPath("/savedx"), false);
  assert.equal(isProtectedPath("/"), false);
  assert.equal(isProtectedPath("/login"), false);
  assert.equal(isProtectedPath("/api/jobs"), false);
  assert.equal(isProtectedPath(undefined), false);
});

test("환경변수가 없으면 인증 기능만 꺼짐 (값은 출력하지 않음)", () => {
  assert.equal(typeof isSupabaseConfigured(), "boolean");
});
