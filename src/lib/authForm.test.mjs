// 실행: node --test src/lib/authForm.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { getSafeNextPath, toAuthErrorMessage, validateAuthForm } from "./authForm.js";

test("next: 같은 사이트 내부 경로만", () => {
  assert.equal(getSafeNextPath("/saved"), "/saved");
  assert.equal(getSafeNextPath("/saved?tab=compare"), "/saved?tab=compare");
  assert.equal(getSafeNextPath("//evil.com"), "/");
  assert.equal(getSafeNextPath("https://evil.com"), "/");
  assert.equal(getSafeNextPath("/\\evil.com"), "/");
  assert.equal(getSafeNextPath("saved"), "/");
  assert.equal(getSafeNextPath("/a\nb"), "/");
  assert.equal(getSafeNextPath(null), "/");
  assert.equal(getSafeNextPath(undefined, "/saved"), "/saved");
});

test("로그인 입력 확인", () => {
  assert.equal(validateAuthForm({ mode: "login", email: "", password: "x" }), "이메일을 입력해 주세요.");
  assert.equal(validateAuthForm({ mode: "login", email: "a@b", password: "x" }), "이메일 형식을 확인해 주세요.");
  assert.equal(validateAuthForm({ mode: "login", email: "a@b.co", password: "" }), "비밀번호를 입력해 주세요.");
  // 로그인은 길이 제한 없이 서버에 확인 (기존 계정 비밀번호 규칙이 달라도 막지 않음)
  assert.equal(validateAuthForm({ mode: "login", email: " a@b.co ", password: "short" }), "");
});

test("회원가입 입력 확인: 8자 이상 + 비밀번호 확인 일치", () => {
  assert.match(validateAuthForm({ mode: "signup", email: "a@b.co", password: "1234567", passwordConfirm: "1234567" }), /8자 이상/);
  assert.equal(
    validateAuthForm({ mode: "signup", email: "a@b.co", password: "12345678", passwordConfirm: "12345679" }),
    "비밀번호 확인이 일치하지 않아요."
  );
  assert.equal(validateAuthForm({ mode: "signup", email: "a@b.co", password: "12345678", passwordConfirm: "12345678" }), "");
});

test("Supabase 오류 → 사용자 문구 (내부 메시지 노출 없음)", () => {
  assert.equal(toAuthErrorMessage({ code: "invalid_credentials" }), "이메일 또는 비밀번호가 맞지 않아요.");
  assert.match(toAuthErrorMessage({ code: "email_not_confirmed" }), /이메일 인증/);
  assert.match(toAuthErrorMessage({ code: "user_already_exists" }, "signup"), /이미 가입된/);
  assert.match(toAuthErrorMessage({ status: 429 }), /잠시 후/);
  assert.match(toAuthErrorMessage({ message: "internal db error xyz" }, "signup"), /회원가입 중 문제/);
  assert.match(toAuthErrorMessage(null), /로그인 중 문제/);
});
