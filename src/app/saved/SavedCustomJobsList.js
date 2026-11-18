"use client";

import { scheduleLine } from "@/lib/schedule";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import rowStyles from "../JobSearch.module.css";
import styles from "../auth.module.css";
import { addJobToCompare, writeAnalyzeIntent } from "../savedIntent";
import { setHomeView } from "../SiteNav";

const MAX_ROW_KEYWORDS = 3;

const COMPARE_NOTES = {
  added: (n) => `비교에 담았어요 (${n}/3).`,
  already: () => "이미 비교에 담겨 있어요.",
  full: () => "비교는 최대 3개까지 담을 수 있어요.",
  invalid: () => "비교에 담지 못했어요.",
};

/**
 * 내가 추가한 공고 목록 (최신순). 관심 공고와 같은 흰색 목록 surface + row
 * - 공고 분석: 저장된 공고 정보(업무·자격요건·우대사항)로 메인 분석 화면을 연다 (원문은 저장하지 않음)
 * - 비교에 담기: 메인 화면의 비교 선택(최대 3개)에 그대로 추가 → 샘플·다른 공고와 A/B/C 비교
 * - 삭제: 서버에서 삭제가 끝나면 목록에서 뺀다
 */
export default function SavedCustomJobsList({ items, loadFailed, onDeleted }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState("");
  const [note, setNote] = useState({ id: "", text: "", canGo: false });

  useEffect(() => {
    if (!note.text) return undefined;
    const timer = setTimeout(() => setNote({ id: "", text: "", canGo: false }), 5000);
    return () => clearTimeout(timer);
  }, [note]);

  const analyze = (item) => {
    if (!writeAnalyzeIntent(item.job)) return;
    router.push("/");
  };

  const addToCompare = (item) => {
    const r = addJobToCompare(item.job);
    setNote({
      id: item.rowId,
      text: COMPARE_NOTES[r.status](r.count),
      canGo: r.status === "added" || r.status === "already",
    });
  };

  const goCompare = () => {
    setHomeView("compare");
    router.push("/");
  };

  const remove = async (item) => {
    if (pendingId) return;
    setPendingId(item.rowId);
    try {
      const res = await fetch("/api/custom-jobs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.rowId }),
      });
      if (res.status === 401) {
        router.push("/login?next=%2Fsaved%3Ftab%3Dcustom");
        return;
      }
      if (!res.ok) {
        setNote({ id: item.rowId, text: "삭제하지 못했어요. 다시 시도해 주세요.", canGo: false });
        return;
      }
      onDeleted(item.rowId);
    } catch {
      setNote({ id: item.rowId, text: "삭제하지 못했어요. 다시 시도해 주세요.", canGo: false });
    } finally {
      setPendingId("");
    }
  };

  if (loadFailed) {
    return (
      <div className={styles.savedEmpty} role="alert">
        <p className={styles.savedEmptyTitle}>내가 추가한 공고를 불러오지 못했어요.</p>
        <p className={styles.savedEmptyDesc}>잠시 후 다시 시도해 주세요.</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={styles.savedEmpty}>
        <p className={styles.savedEmptyTitle}>직접 추가한 공고가 아직 없어요.</p>
        <p className={styles.savedEmptyDesc}>공고 찾기 화면의 &lsquo;공고 직접 추가&rsquo;에서 채용공고를 붙여넣어 보세요.</p>
      </div>
    );
  }

  return (
    <ul className={`${rowStyles.list} ${styles.savedList}`}>
      {items.map((item) => {
        const { job } = item;
        const meta = [job.company, job.employmentType, job.career, job.location].filter(Boolean);
        const firstTask = job.tasks?.[0];
        const keywords = (job.keywords ?? []).slice(0, MAX_ROW_KEYWORDS);
        return (
          <li key={item.rowId} className={`${rowStyles.row} ${styles.savedRow}`}>
            <div className={rowStyles.rowBody}>
              <div className={rowStyles.rowTop}>
                <h3 className={rowStyles.title}>{job.title}</h3>
                {scheduleLine(job) && <span className={`${rowStyles.deadline} ${styles.savedDeadline}`}>{scheduleLine(job)}</span>}
              </div>
              {meta.length > 0 && (
                <p className={`${rowStyles.meta} ${styles.savedMeta}`}>
                  {meta.map((m, i) => (
                    <span key={i}>{m}</span>
                  ))}
                </p>
              )}
              {firstTask && (
                <p className={rowStyles.task}>
                  <span className={rowStyles.taskLabel}>하는 일</span>
                  <span className={rowStyles.taskText}>{firstTask}</span>
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
                <div className={`${rowStyles.actions} ${styles.savedActions}`} role="group" aria-label="내가 추가한 공고 작업">
                  <button type="button" className={rowStyles.analyzeAction} onClick={() => analyze(item)}>
                    공고 분석
                  </button>
                  <button type="button" className={rowStyles.linkAction} onClick={() => addToCompare(item)}>
                    비교에 담기
                  </button>
                  <span className={styles.savedActionDivider} aria-hidden="true" />
                  <button
                    type="button"
                    className={rowStyles.linkAction}
                    disabled={pendingId === item.rowId}
                    onClick={() => remove(item)}
                  >
                    {pendingId === item.rowId ? "삭제 중…" : "삭제"}
                  </button>
                </div>
                {note.id === item.rowId && note.text && (
                  <p className={styles.customNote} role="status">
                    {note.text}{" "}
                    {note.canGo && (
                      <button type="button" className={styles.customNoteLink} onClick={goCompare}>
                        비교하러 가기
                      </button>
                    )}
                  </p>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
