"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { buildLoginHref } from "@/lib/savedJobs";
import { toggleSavedJob } from "./savedJobsStore";
import styles from "./SaveJobButton.module.css";

/**
 * 관심 공고 저장 버튼: "저장" ↔ "저장됨"
 * - 로그인: 저장/해제 (상태는 savedJobsStore에서 받음 → 부모가 한 번에 조회)
 * - 비로그인: /login?next=지금 경로 (지금 화면 상태는 sessionStorage에 있어 돌아오면 복원됨)
 * size: "row"(검색 결과·저장함 row) | "head"(분석 화면 헤더)
 */
export default function SaveJobButton({ job, saved, pending = false, size = "row", label }) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!failed) return undefined;
    const timer = setTimeout(() => setFailed(false), 3000);
    return () => clearTimeout(timer);
  }, [failed]);

  const goLogin = () => {
    const path = `${window.location.pathname}${window.location.search}`;
    router.push(buildLoginHref(path));
  };

  const handleClick = async () => {
    setFailed(false);
    const outcome = await toggleSavedJob(job);
    if (outcome === "login") goLogin();
    else if (outcome === "error") setFailed(true);
  };

  const text = label ?? (saved ? "저장됨" : "저장");
  const name = [job?.company, job?.title].filter(Boolean).join(" ");
  // icon: 검색 결과 행용 아이콘 버튼 (빈 북마크 = 저장 안 됨, 채운 파란 북마크 = 저장됨)
  const iconOnly = size === "icon";
  const iconSize = iconOnly ? 18 : 12;

  return (
    <span className={styles.wrap}>
      <button
        type="button"
        className={`${styles.button} ${size === "head" ? styles.head : ""} ${
          iconOnly ? styles.iconOnly : ""
        } ${saved ? styles.saved : ""}`}
        aria-pressed={saved}
        aria-label={`${name} ${saved ? "저장됨, 누르면 저장 해제" : "저장"}`}
        title={iconOnly ? text : undefined}
        disabled={pending}
        onClick={handleClick}
      >
        <svg className={styles.icon} width={iconSize} height={iconSize} viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M3 1.75h6v8.5L6 8.2l-3 2.05z"
            fill={saved ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth={iconOnly ? 1.1 : 1.3}
            strokeLinejoin="round"
          />
        </svg>
        {!iconOnly && text}
      </button>
      <span className={styles.status} role="status">
        {failed ? "저장하지 못했어요. 다시 시도해 주세요." : ""}
      </span>
    </span>
  );
}
