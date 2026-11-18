import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import pageStyles from "../page.module.css";
import styles from "../auth.module.css";
import SiteHeader from "../SiteHeader";
import SavedTabs from "./SavedTabs";
import { BackToSearchLink } from "../SiteNav";
import { getAuthedSupabase } from "@/lib/supabase/server";
import { toSavedItem } from "@/lib/savedJobs";
import { toSavedComparisonItem } from "@/lib/savedComparisons";
import { listCustomJobs } from "@/lib/customJobsDb";

export const metadata = {
  title: "저장함 · Career Radar",
};

const MAX_SAVED_ROWS = 200;

/**
 * /saved — 저장함 (관심 공고)
 * 보호: proxy에서 1차로 /login으로 보내고, 여기서 서버(getClaims)로 다시 확인한다.
 * 목록은 로그인 사용자의 세션으로 읽으므로 RLS가 다른 사용자의 row를 막는다.
 * 세션(cookie)을 읽는 부분은 Suspense 안에서 (Cache Components)
 */
export default function SavedPage({ searchParams }) {
  return (
    <div className={pageStyles.page}>
      <SiteHeader />
      <main className={`${pageStyles.container} ${styles.savedMain}`}>
        {/* 목록을 불러오는 동안에도 바로 보이도록 Suspense 밖에 둔다 */}
        <BackToSearchLink className={`${pageStyles.backButton} ${styles.savedBack}`} />
        <Suspense fallback={<p className={styles.savedLoading}>불러오는 중…</p>}>
          <SavedContent searchParams={searchParams} />
        </Suspense>
      </main>
    </div>
  );
}

const TAB_IDS = ["jobs", "comparisons", "custom"];

async function SavedContent({ searchParams }) {
  // 사용자별 저장 목록: 여기부터는 요청 시점에만 렌더링 (prerender는 위 Suspense fallback까지)
  await connection();
  const { supabase, user } = await getAuthedSupabase();
  if (!user) redirect("/login?next=/saved");

  // 관심 공고 + 저장한 비교를 함께 (둘 다 로그인 사용자의 세션으로 읽어 RLS 적용)
  // ?tab=custom 등으로 처음 열 탭 지정 (직접 추가 후 "저장함에서 보기")
  const tabParam = (await searchParams)?.tab;
  const initialTab = TAB_IDS.includes(tabParam) ? tabParam : "jobs";

  const [jobsResult, comparisonsResult, customResult] = await Promise.all([
    supabase
      .from("career_saved_jobs")
      .select("job_id, job_snapshot, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(MAX_SAVED_ROWS),
    supabase
      .from("career_saved_comparisons")
      .select("id, comparison_snapshot, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(MAX_SAVED_ROWS),
    // 내가 추가한 공고 (같은 정리·검증 로직: lib/customJobsDb)
    listCustomJobs(supabase, user.id),
  ]);
  if (jobsResult.error) console.error("[saved] list query failed", jobsResult.error.code ?? "");
  if (comparisonsResult.error) {
    console.error("[saved] comparisons query failed", comparisonsResult.error.code ?? "");
  }

  const items = jobsResult.error ? [] : (jobsResult.data ?? []).map(toSavedItem).filter(Boolean);
  const comparisons = comparisonsResult.error
    ? []
    : (comparisonsResult.data ?? []).map(toSavedComparisonItem).filter(Boolean);

  return (
    <section className={styles.saved} aria-labelledby="saved-title">
      <h1 id="saved-title" className={styles.savedTitle}>
        저장함
      </h1>
      <SavedTabs
        jobs={items}
        jobsFailed={Boolean(jobsResult.error)}
        comparisons={comparisons}
        comparisonsFailed={Boolean(comparisonsResult.error)}
        customJobs={customResult.ok ? customResult.items : []}
        customFailed={!customResult.ok}
        initialTab={initialTab}
      />
    </section>
  );
}
