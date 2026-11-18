"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import styles from "./auth.module.css";

/**
 * 헤더 오른쪽 계정 영역
 * - 비회원: "로그인" (작은 outline)
 * - 회원: "저장함" + "계정 ▾" (메뉴: 로그인한 이메일 / 저장함 / 로그아웃)
 * 화면 표시용 상태는 브라우저 세션 이벤트로 즉시 반영한다.
 * (실제 접근 제어는 서버에서 getClaims로 다시 확인: /saved 페이지·proxy)
 */
export default function AuthMenu() {
  const router = useRouter();
  const pathname = usePathname();
  // 설정이 없으면 바로 비회원 상태, 있으면 세션 확인 전까지 아무것도 그리지 않음 (깜빡임 방지)
  const [auth, setAuth] = useState(() =>
    isSupabaseConfigured() ? { status: "loading", email: "" } : { status: "guest", email: "" }
  );
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuRef = useRef(null);

  // 세션 상태 구독: 첫 상태(INITIAL_SESSION) + 로그인/로그아웃 즉시 반영
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return undefined;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const email = session?.user?.email ?? "";
      setAuth(session?.user ? { status: "member", email } : { status: "guest", email: "" });
      if (!session?.user) setOpen(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // 메뉴: 바깥 클릭·Escape로 닫기
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (!menuRef.current?.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const handleSignOut = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || signingOut) return;
    setSigningOut(true);
    await supabase.auth.signOut().catch(() => {});
    setSigningOut(false);
    setOpen(false);
    setAuth({ status: "guest", email: "" }); // 이벤트를 기다리지 않고 즉시 비회원 표시
    if (pathname?.startsWith("/saved")) router.replace("/");
    router.refresh(); // 서버 컴포넌트도 비회원 기준으로 다시 그림
  };

  if (auth.status === "loading") return null;
  const onSaved = pathname === "/saved" || pathname?.startsWith("/saved/");

  if (auth.status === "guest") {
    const next = pathname && pathname !== "/login" ? `?next=${encodeURIComponent(pathname)}` : "";
    return (
      <Link href={`/login${next}`} className={styles.loginLink}>
        로그인
      </Link>
    );
  }

  return (
    <div className={styles.member}>
      <Link
        href="/saved"
        className={`${styles.savedLink} ${onSaved ? styles.savedLinkActive : ""}`}
        aria-current={onSaved ? "page" : undefined}
      >
        저장함
      </Link>
      <div className={styles.account} ref={menuRef}>
        <button
          type="button"
          className={styles.accountButton}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls="account-menu"
          onClick={() => setOpen((v) => !v)}
        >
          계정
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M3 4.5 6 7.5 9 4.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        {open && (
          <div id="account-menu" className={styles.menu} role="menu">
            <p className={styles.menuEmail} title={auth.email}>
              {auth.email}
            </p>
            <Link href="/saved" className={styles.menuItem} role="menuitem" onClick={() => setOpen(false)}>
              저장함
            </Link>
            <button
              type="button"
              className={styles.menuItem}
              role="menuitem"
              disabled={signingOut}
              onClick={handleSignOut}
            >
              {signingOut ? "로그아웃 중…" : "로그아웃"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
