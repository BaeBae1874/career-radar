/**
 * 로그인/회원가입 폼 helper (순수 함수, 네트워크 없음)
 */

export const MIN_PASSWORD_LENGTH = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 로그인 후 돌아갈 경로. 같은 사이트 내부 경로만 허용 (open redirect 방지)
 * "/saved" ✓  "//evil.com" ✗  "https://evil.com" ✗  "/\\evil" ✗
 */
export function getSafeNextPath(next, fallback = "/") {
  if (typeof next !== "string") return fallback;
  const path = next.trim();
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f]/.test(path)) return fallback;
  return path;
}

/**
 * 입력 확인 (서버에 보내기 전). 문제가 없으면 ""
 * @param {{ mode: "login" | "signup", email: string, password: string, passwordConfirm?: string }} form
 */
export function validateAuthForm({ mode, email, password, passwordConfirm = "" }) {
  const e = typeof email === "string" ? email.trim() : "";
  const p = typeof password === "string" ? password : "";
  if (!e) return "이메일을 입력해 주세요.";
  if (!EMAIL_RE.test(e)) return "이메일 형식을 확인해 주세요.";
  if (!p) return "비밀번호를 입력해 주세요.";
  if (mode === "signup") {
    if (p.length < MIN_PASSWORD_LENGTH) return `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상으로 입력해 주세요.`;
    if (p !== passwordConfirm) return "비밀번호 확인이 일치하지 않아요.";
  }
  return "";
}

/** Supabase Auth 오류 → 사용자 문구 (내부 메시지는 그대로 보여 주지 않음) */
export function toAuthErrorMessage(error, mode = "login") {
  const code = typeof error?.code === "string" ? error.code : "";
  const status = Number(error?.status);
  switch (code) {
    case "invalid_credentials":
      return "이메일 또는 비밀번호가 맞지 않아요.";
    case "email_not_confirmed":
      return "이메일 인증이 아직 완료되지 않았어요. 받은 메일의 링크를 먼저 눌러 주세요.";
    case "user_already_exists":
    case "email_exists":
      return "이미 가입된 이메일이에요. 로그인해 주세요.";
    case "weak_password":
      return "비밀번호가 너무 단순해요. 더 길거나 복잡한 비밀번호를 사용해 주세요.";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "요청이 많아요. 잠시 후 다시 시도해 주세요.";
    case "signup_disabled":
      return "지금은 회원가입을 받을 수 없어요.";
    default:
      break;
  }
  if (status === 429) return "요청이 많아요. 잠시 후 다시 시도해 주세요.";
  return mode === "signup"
    ? "회원가입 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요."
    : "로그인 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.";
}
