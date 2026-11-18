"use client";

import { scheduleLine } from "@/lib/schedule";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import rowStyles from "../JobSearch.module.css";
import styles from "../auth.module.css";
import SaveJobButton from "../SaveJobButton";
import { recordRecent } from "../recentStore";
import { writeAnalyzeIntent } from "../savedIntent";
import { seedSavedIds, useSavedJobs } from "../savedJobsStore";

const MAX_ROW_KEYWORDS = 3;

/**
 * 저장함 목록 (관심 공고). row는 검색 결과의 compact row 스타일을 그대로 쓴다.
 * - 원문 보기 / 공고 분석 / 저장 해제
 * - 해제한 공고는 목록에 남겨 두고 "저장"으로 다시 저장할 수 있게 한다 (실수로 누른 경우).
 *   새로고침하면 해제한 공고는 사라진다.
 */
export default function SavedJobsList({ initialItems, loadFailed }) {
  const router = useRouter();
  const [items] = useState(initialItems);
  const savedState = useSavedJobs([]);

  // 서버가 이미 준 저장 목록 → 다시 조회하지 않고 "저장됨"으로 표시
  useEffect(() => {
    seedSavedIds(initialItems.map((i) => i.jobId));
  }, [initialItems]);

  const openAnalysis = (job) => {
    if (!writeAnalyzeIntent(job)) return;
    router.push("/");
  };

  // 탭 패널 안 내용만 (제목·개수는 SavedTabs의 탭에서)
  return loadFailed ? (
    <div className={styles.savedEmpty} role="alert">
      <p className={styles.savedEmptyTitle}>저장한 공고를 불러오지 못했어요.</p>
      <p className={styles.savedEmptyDesc}>잠시 후 다시 시도해 주세요.</p>
    </div>
  ) : items.length === 0 ? (
    <div className={styles.savedEmpty}>
      <p className={styles.savedEmptyTitle}>저장한 공고가 아직 없어요.</p>
      <p className={styles.savedEmptyDesc}>공고를 둘러보고 관심 있는 공고를 저장해보세요.</p>
    </div>
  ) : (
    <ul className={`${rowStyles.list} ${styles.savedList}`}>
      {items.map(({ jobId, job }) => {
        // 처음 그릴 때(seed 전)는 서버 목록 기준으로 저장됨
        const saved = savedState.known.has(jobId) ? savedState.saved.has(jobId) : true;
        return (
          <SavedRow
            key={jobId}
            job={job}
            saved={saved}
            pending={savedState.pending.has(jobId)}
            onAnalyze={openAnalysis}
          />
        );
      })}
    </ul>
  );
}

function SavedRow({ job, saved, pending, onAnalyze }) {
  const meta = [job.company, job.employmentType, job.career, job.location].filter(Boolean);
  const keywords = (job.keywords ?? []).slice(0, MAX_ROW_KEYWORDS);
  return (
    <li className={`${rowStyles.row} ${styles.savedRow} ${saved ? "" : styles.savedRowOff}`}>
      <div className={rowStyles.rowBody}>
        <div className={rowStyles.rowTop}>
          <h3 className={rowStyles.title}>{job.title}</h3>
          {/* 마감 정보: 직무명 옆 보조 정보 (강조색 없음) */}
          {scheduleLine(job) && <span className={`${rowStyles.deadline} ${styles.savedDeadline}`}>{scheduleLine(job)}</span>}
        </div>

        {/* 직무명 다음: 회사 · 근무형태 · 경력 · 지역 */}
        {meta.length > 0 && (
          <p className={`${rowStyles.meta} ${styles.savedMeta}`}>
            {meta.map((m, i) => (
              <span key={i}>{m}</span>
            ))}
          </p>
        )}

        {job.firstTask && (
          <p className={rowStyles.task}>
            <span className={rowStyles.taskLabel}>하는 일</span>
            <span className={rowStyles.taskText}>{job.firstTask}</span>
          </p>
        )}

        <div className={`${rowStyles.rowBottom} ${styles.savedBottom}`}>
          {keywords.length > 0 && (
            <ul className={rowStyles.keywords} aria-label="핵심 키워드">
              {keywords.map((k) => (
                <li key={k}>{k}</li>
              ))}
            </ul>
          )}
          {/* 액션 한 묶음: 원문 보기 · 공고 분석 · 저장 해제 */}
          <div className={`${rowStyles.actions} ${styles.savedActions}`} role="group" aria-label="공고 작업">
            {job.originalUrl && (
              <a
                className={rowStyles.linkAction}
                href={job.originalUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => recordRecent(job)}
              >
                원문 보기 <span aria-hidden="true">↗</span>
              </a>
            )}
            <button type="button" className={rowStyles.analyzeAction} onClick={() => onAnalyze(job)}>
              공고 분석
            </button>
            <span className={styles.savedActionDivider} aria-hidden="true" />
            <SaveJobButton
              job={job}
              saved={saved}
              pending={pending}
              label={saved ? "저장 해제" : "저장"}
            />
          </div>
        </div>
      </div>
    </li>
  );
}
