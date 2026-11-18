"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import rowStyles from "../JobSearch.module.css";
import styles from "../auth.module.css";
import { Marker } from "../JobCompare";
import { writeCompareIntent } from "../savedIntent";

/**
 * 저장한 비교 목록 (최신 저장순). 관심 공고와 같은 흰색 목록 surface + row.
 * - 비교 다시 보기: 저장 당시 snapshot·A/B/C 순서로 메인 비교 화면을 연다 (AI 요약 없이)
 * - 삭제: 서버에서 삭제가 끝나면 목록에서 뺀다
 */
export default function SavedComparisonsList({ items, loadFailed, onDeleted }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState("");
  const [failedId, setFailedId] = useState("");

  useEffect(() => {
    if (!failedId) return undefined;
    const timer = setTimeout(() => setFailedId(""), 3000);
    return () => clearTimeout(timer);
  }, [failedId]);

  const reopen = (item) => {
    if (!writeCompareIntent(item.postings)) return;
    router.push("/");
  };

  const remove = async (item) => {
    if (pendingId) return;
    setPendingId(item.id);
    setFailedId("");
    try {
      const res = await fetch("/api/saved-comparisons", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id }),
      });
      if (res.status === 401) {
        router.push("/login?next=%2Fsaved");
        return;
      }
      if (!res.ok) {
        setFailedId(item.id);
        return;
      }
      onDeleted(item.id);
    } catch {
      setFailedId(item.id);
    } finally {
      setPendingId("");
    }
  };

  if (loadFailed) {
    return (
      <div className={styles.savedEmpty} role="alert">
        <p className={styles.savedEmptyTitle}>저장한 비교를 불러오지 못했어요.</p>
        <p className={styles.savedEmptyDesc}>잠시 후 다시 시도해 주세요.</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={styles.savedEmpty}>
        <p className={styles.savedEmptyTitle}>저장한 비교가 아직 없어요.</p>
        <p className={styles.savedEmptyDesc}>공고 2~3개를 비교한 뒤 비교 화면에서 저장해보세요.</p>
      </div>
    );
  }

  return (
    <ul className={`${rowStyles.list} ${styles.savedList}`}>
      {items.map((item) => (
        <li key={item.id} className={`${rowStyles.row} ${styles.savedRow}`}>
          <div className={rowStyles.rowBody}>
            <p className={`${rowStyles.meta} ${styles.compareSavedMeta}`}>
              <span>공고 {item.postings.length}개 비교</span>
              {item.savedDate && <span>{item.savedDate} 저장</span>}
            </p>

            {/* A/B/C: 저장 당시 순서 그대로 회사 · 공고 제목 */}
            <ol className={styles.compareSavedJobs}>
              {item.postings.map((p, i) => (
                <li key={p.id}>
                  <Marker index={i} />
                  <span className={styles.compareSavedText}>
                    {p.company && <span className={styles.compareSavedCompany}>{p.company}</span>}
                    <span className={styles.compareSavedTitle}>{p.title}</span>
                  </span>
                </li>
              ))}
            </ol>

            <div className={`${rowStyles.rowBottom} ${styles.savedBottom}`}>
              <div className={`${rowStyles.actions} ${styles.savedActions}`} role="group" aria-label="저장한 비교 작업">
                <button type="button" className={rowStyles.analyzeAction} onClick={() => reopen(item)}>
                  비교 다시 보기
                </button>
                <span className={styles.savedActionDivider} aria-hidden="true" />
                <button
                  type="button"
                  className={rowStyles.linkAction}
                  disabled={pendingId === item.id}
                  onClick={() => remove(item)}
                >
                  {pendingId === item.id ? "삭제 중…" : "삭제"}
                </button>
                {failedId === item.id && (
                  <span className={styles.compareSavedError} role="status">
                    삭제하지 못했어요. 다시 시도해 주세요.
                  </span>
                )}
              </div>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
