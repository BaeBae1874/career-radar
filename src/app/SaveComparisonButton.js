"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { buildLoginHref } from "@/lib/savedJobs";
import { comparisonKey, toComparisonSnapshot } from "@/lib/savedComparisons";
import { useSavedJobs } from "./savedJobsStore";
import styles from "./SaveJobButton.module.css";

/**
 * 비교 화면의 "비교 저장" 버튼 (자동 저장 없음, 눌렀을 때만)
 * - 저장 전 "비교 저장" → 저장 후 "저장됨" (삭제는 저장함에서)
 * - 같은 공고 조합(A/B/C 순서 무관)이 이미 저장돼 있으면 처음부터 "저장됨"
 * - 비로그인: /login?next=지금 경로 → 비교 선택은 sessionStorage에 있어 로그인 후 그대로 복원
 */
export default function SaveComparisonButton({ jobs, active = true }) {
  const router = useRouter();
  const { auth } = useSavedJobs([]); // 화면 표시용 로그인 상태 (권한은 서버가 판단)
  const key = comparisonKey((jobs ?? []).map((j) => j?.id));
  // { key, saved } — 지금 조합에 대해 확인한 결과만 사용 (조합이 바뀌면 자동으로 무효)
  const [status, setStatus] = useState({ key: "", saved: false });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const saved = status.key === key && status.saved;

  // 저장 여부 확인: 비교 화면이 보이고, 로그인 상태이고, 아직 이 조합을 확인하지 않았을 때 한 번
  useEffect(() => {
    if (!active || !key || auth !== "member" || status.key === key) return undefined;
    let cancelled = false;
    fetch(`/api/saved-comparisons?key=${encodeURIComponent(key)}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setStatus({ key, saved: Boolean(data.savedId) });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [active, key, auth, status.key]);

  useEffect(() => {
    if (!failed) return undefined;
    const timer = setTimeout(() => setFailed(false), 3000);
    return () => clearTimeout(timer);
  }, [failed]);

  const goLogin = () => {
    router.push(buildLoginHref(`${window.location.pathname}${window.location.search}`));
  };

  const handleClick = async () => {
    if (busy || saved) return;
    if (auth === "guest") {
      goLogin();
      return;
    }
    const snapshot = toComparisonSnapshot(jobs);
    if (!snapshot || !key) {
      setFailed(true);
      return;
    }
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch("/api/saved-comparisons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobs: snapshot.postings }),
      });
      if (res.status === 401) {
        goLogin();
        return;
      }
      if (!res.ok) {
        setFailed(true);
        return;
      }
      setStatus({ key, saved: true });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  if (!key) return null;

  return (
    <span className={styles.wrap}>
      <button
        type="button"
        className={`${styles.button} ${styles.head} ${saved ? styles.saved : ""}`}
        aria-pressed={saved}
        aria-label={saved ? "이 비교는 저장됨 (삭제는 저장함에서)" : "지금 비교 저장"}
        disabled={busy}
        onClick={handleClick}
      >
        <svg className={styles.icon} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M3 1.75h6v8.5L6 8.2l-3 2.05z"
            fill={saved ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
        </svg>
        {saved ? "저장됨" : busy ? "저장 중…" : "비교 저장"}
      </button>
      <span className={styles.status} role="status">
        {failed ? "저장하지 못했어요. 다시 시도해 주세요." : ""}
      </span>
    </span>
  );
}
