"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import pageStyles from "./page.module.css";
import { loadSession, patchSession } from "./sessionStore";

/**
 * 저장함·로그인 화면의 상단 메뉴. 메인 헤더와 같은 클래스(로고 / 공고 찾기 / 공고 비교)를 쓴다.
 * 메인 화면의 화면 상태는 sessionStorage에 있으므로, 이동하기 전에 열 화면(view)만 바꿔 둔다.
 * (공고 비교는 고른 공고가 2개 미만이면 메인에서 자동으로 공고 찾기로 열린다)
 */

/** 메인(/)에서 열 화면 지정. 나머지 상태(검색어·비교 선택·분석)는 그대로 둔다 */
export function setHomeView(view) {
  const page = loadSession()?.page;
  patchSession({ page: { ...(page && typeof page === "object" ? page : {}), view } });
}

const subscribe = () => () => {};
const getCompareCount = () => {
  const ids = loadSession()?.page?.compareIds;
  return Array.isArray(ids) ? ids.length : 0;
};
const getServerCount = () => 0;

/** 저장함 등에서 메인 공고 찾기 화면으로 (history back 아님) */
export function BackToSearchLink({ className }) {
  return (
    <Link href="/" className={className} onClick={() => setHomeView("search")}>
      <span aria-hidden="true">←</span> 공고 찾기로
    </Link>
  );
}

export default function SiteNav() {
  const compareCount = useSyncExternalStore(subscribe, getCompareCount, getServerCount);
  return (
    <>
      <Link
        href="/"
        className={pageStyles.logo}
        aria-label="Career Radar 공고 찾기로"
        onClick={() => setHomeView("search")}
      >
        Career Radar
      </Link>
      <nav className={pageStyles.nav} aria-label="주요 메뉴">
        <Link href="/" className={pageStyles.navItem} onClick={() => setHomeView("search")}>
          <span className={pageStyles.labelFull}>공고 찾기</span>
          <span className={pageStyles.labelShort}>찾기</span>
        </Link>
        <Link href="/" className={pageStyles.navItem} onClick={() => setHomeView("compare")}>
          <span className={pageStyles.labelFull}>공고 비교</span>
          <span className={pageStyles.labelShort}>비교</span>
          {compareCount > 0 && (
            <span className={pageStyles.navBadge} aria-label={`선택 ${compareCount}개`}>
              {compareCount}
            </span>
          )}
        </Link>
      </nav>
    </>
  );
}
