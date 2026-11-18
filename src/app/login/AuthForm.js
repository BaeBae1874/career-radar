"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getSafeNextPath, toAuthErrorMessage, validateAuthForm } from "@/lib/authForm";
import styles from "../auth.module.css";

const COPY = {
  login: { title: "로그인", submit: "로그인", busy: "로그인 중…" },
  signup: { title: "회원가입", submit: "회원가입", busy: "가입 중…" },
};

export default function AuthForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = getSafeNextPath(params.get("next"));
  const configured = isSupabaseConfigured();

  const [mode, setMode] = useState(params.get("mode") === "signup" ? "signup" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(
    params.get("error") === "confirm" ? "인증 링크가 만료되었거나 올바르지 않아요. 다시 시도해 주세요." : ""
  );
  const [notice, setNotice] = useState("");

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setError("");
    setNotice("");
    setPassword("");
    setPasswordConfirm("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError("");
    setNotice("");

    const problem = validateAuthForm({ mode, email, password, passwordConfirm });
    if (problem) {
      setError(problem);
      return;
    }
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setError("로그인 기능이 아직 설정되지 않았어요.");
      return;
    }

    setBusy(true);
    try {
      if (mode === "login") {
        const { error: authError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (authError) {
          setError(toAuthErrorMessage(authError, "login"));
          return;
        }
        router.replace(next);
        router.refresh();
        return;
      }

      // 회원가입: 이메일 인증을 켠 프로젝트면 session 없이 돌아오고, 메일 링크 → /auth/confirm
      const { data, error: authError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent(next)}`,
        },
      });
      if (authError) {
        setError(toAuthErrorMessage(authError, "signup"));
        return;
      }
      if (data?.session) {
        router.replace(next);
        router.refresh();
        return;
      }
      setMode("login");
      setPassword("");
      setPasswordConfirm("");
      setNotice("인증 메일을 보냈어요. 메일의 링크를 누르면 가입이 완료되고, 그다음 로그인할 수 있어요.");
    } catch {
      setError("서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  const copy = COPY[mode];

  return (
    <div className={styles.authBox}>
      <h1 className={styles.authTitle}>{copy.title}</h1>

      {!configured && (
        <p className={styles.authNotice} role="status">
          로그인 기능이 아직 설정되지 않았어요. 검색·비교·분석은 지금도 그대로 쓸 수 있어요.
        </p>
      )}

      <form className={styles.authForm} onSubmit={handleSubmit} noValidate>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>이메일</span>
          <input
            type="email"
            className={styles.input}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            inputMode="email"
            placeholder="name@example.com"
            required
          />
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>비밀번호</span>
          <input
            type="password"
            className={styles.input}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            placeholder={mode === "signup" ? "8자 이상" : undefined}
            required
          />
        </label>

        {mode === "signup" && (
          <label className={styles.field}>
            <span className={styles.fieldLabel}>비밀번호 확인</span>
            <input
              type="password"
              className={styles.input}
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              autoComplete="new-password"
              required
            />
          </label>
        )}

        {error && (
          <p className={styles.authError} role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className={styles.authNotice} role="status">
            {notice}
          </p>
        )}

        <button type="submit" className={styles.submit} disabled={busy || !configured}>
          {busy ? copy.busy : copy.submit}
        </button>
      </form>

      <p className={styles.switchRow}>
        {mode === "login" ? (
          <>
            처음이신가요?
            <button type="button" className={styles.switchButton} onClick={() => switchMode("signup")}>
              회원가입
            </button>
          </>
        ) : (
          <>
            이미 계정이 있나요?
            <button type="button" className={styles.switchButton} onClick={() => switchMode("login")}>
              로그인
            </button>
          </>
        )}
      </p>

      <p className={styles.guestNote}>
        로그인하지 않아도 공고 검색·비교·분석은 모두 사용할 수 있어요.
        <br />
        로그인은 관심 공고와 비교 결과를 저장할 때만 필요해요.
      </p>
      <Link href="/" className={styles.backLink}>
        ← 공고 찾기로 돌아가기
      </Link>
    </div>
  );
}
