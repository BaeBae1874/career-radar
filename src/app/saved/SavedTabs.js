"use client";

import { useState } from "react";
import styles from "../auth.module.css";
import SavedJobsList from "./SavedJobsList";
import SavedComparisonsList from "./SavedComparisonsList";
import SavedCustomJobsList from "./SavedCustomJobsList";

const TABS = [
  { id: "jobs", label: "관심 공고" },
  { id: "comparisons", label: "저장한 비교" },
  { id: "custom", label: "내가 추가한 공고" },
];

/**
 * 저장함 탭: 관심 공고 N / 저장한 비교 N
 * 두 목록은 서버에서 함께 받아 오고, 탭 전환은 화면 안에서만 (요청 없음)
 */
export default function SavedTabs({
  jobs,
  jobsFailed,
  comparisons,
  comparisonsFailed,
  customJobs = [],
  customFailed = false,
  initialTab = "jobs",
}) {
  const [tab, setTab] = useState(initialTab);
  const [comparisonItems, setComparisonItems] = useState(comparisons);
  const [customItems, setCustomItems] = useState(customJobs);
  const counts = { jobs: jobs.length, comparisons: comparisonItems.length, custom: customItems.length };

  const onKeyDown = (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const step = e.key === "ArrowRight" ? 1 : TABS.length - 1;
    const next = TABS[(TABS.findIndex((t) => t.id === tab) + step) % TABS.length].id;
    setTab(next);
    document.getElementById(`saved-tab-${next}`)?.focus();
  };

  return (
    <div className={styles.savedSection}>
      <div className={styles.savedTabs} role="tablist" aria-label="저장함" onKeyDown={onKeyDown}>
        {TABS.map((t) => {
          const selected = tab === t.id;
          return (
            <button
              key={t.id}
              id={`saved-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`saved-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              className={`${styles.savedTab} ${selected ? styles.savedTabActive : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label} <span className={styles.savedCount}>{counts[t.id]}</span>
            </button>
          );
        })}
      </div>

      <div
        id="saved-panel-jobs"
        role="tabpanel"
        aria-labelledby="saved-tab-jobs"
        hidden={tab !== "jobs"}
      >
        <SavedJobsList initialItems={jobs} loadFailed={jobsFailed} />
      </div>
      <div
        id="saved-panel-comparisons"
        role="tabpanel"
        aria-labelledby="saved-tab-comparisons"
        hidden={tab !== "comparisons"}
      >
        <SavedComparisonsList
          items={comparisonItems}
          loadFailed={comparisonsFailed}
          onDeleted={(id) => setComparisonItems((prev) => prev.filter((c) => c.id !== id))}
        />
      </div>
      <div
        id="saved-panel-custom"
        role="tabpanel"
        aria-labelledby="saved-tab-custom"
        hidden={tab !== "custom"}
      >
        <SavedCustomJobsList
          items={customItems}
          loadFailed={customFailed}
          onDeleted={(rowId) => setCustomItems((prev) => prev.filter((c) => c.rowId !== rowId))}
        />
      </div>
    </div>
  );
}
