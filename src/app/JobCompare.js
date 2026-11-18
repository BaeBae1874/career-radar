"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./JobCompare.module.css";
import { getComparePoints, getPostingHighlights, isSpecialCondition } from "@/lib/jobInsights";
import SaveComparisonButton from "./SaveComparisonButton";
import { CLOSE_TYPE_LABELS, getApplicationSchedule, normalizeCloseType, normalizeWorkPeriod } from "@/lib/schedule";

// 마감 방식: 명시된 값, 없으면 고정 마감일이 있을 때만 "접수 마감일"
const closeTypeLabel = (j) => {
  const type = normalizeCloseType(j.closeType) || (j.applicationEndDate ? "deadline" : "");
  return type ? CLOSE_TYPE_LABELS[type] : "";
};
import { recordRecent } from "./recentStore";

export const MAX_COMPARE = 3;
const BAR_VISIBLE_JOBS = 2; // 하단 바에 제목 chip으로 보여 줄 공고 수

// 선택 순서대로 A / B / C — 하단 바와 비교 화면에서 같은 공고를 같은 글자로 가리킨다
export const MARKERS = ["A", "B", "C"];

export function Marker({ index }) {
  return (
    <span className={styles.marker} aria-hidden="true">
      {MARKERS[index] ?? index + 1}
    </span>
  );
}

// 공백·대소문자 차이를 무시하고 키워드 비교 ("데이터분석" = "데이터 분석")
const keyOf = (k) => String(k).replace(/\s+/g, "").toLowerCase();

/** 선택한 모든 공고에 공통으로 들어 있는 키워드 (AI 없이 단순 배열 비교) */
export function getCommonKeywords(jobs) {
  if (jobs.length < 2) return [];
  const [first, ...rest] = jobs;
  const restSets = rest.map((j) => new Set((j.keywords ?? []).map(keyOf)));
  const seen = new Set();
  return (first.keywords ?? []).filter((k) => {
    const key = keyOf(k);
    if (seen.has(key) || !restSets.every((set) => set.has(key))) return false;
    seen.add(key);
    return true;
  });
}

/** 하단 바의 공고 chip (+N은 같은 줄 안에서 펼침/접기 — 새 줄을 만들지 않음) */
function BarChips({ jobs, onRemove }) {
  const [expanded, setExpanded] = useState(false);
  const listRef = useRef(null);
  const hiddenCount = Math.max(0, jobs.length - BAR_VISIBLE_JOBS);
  // 선택이 2개 이하가 되면 자동으로 접힌 상태 (다시 3개가 돼도 +1부터)
  const [prevHidden, setPrevHidden] = useState(hiddenCount);
  if (prevHidden !== hiddenCount) {
    setPrevHidden(hiddenCount);
    if (hiddenCount === 0) setExpanded(false);
  }
  const isExpanded = expanded && hiddenCount > 0;
  const visible = isExpanded ? jobs : jobs.slice(0, BAR_VISIBLE_JOBS);

  // 펼친 상태: bar 바깥 클릭·Escape로 접기
  useEffect(() => {
    if (!isExpanded) return;
    const onPointerDown = (e) => {
      if (!listRef.current?.contains(e.target)) setExpanded(false);
    };
    const onKeyDown = (e) => {
      if (e.key === "Escape") setExpanded(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isExpanded]);

  return (
    <ul ref={listRef} className={`${styles.barList} ${isExpanded ? styles.barListExpanded : ""}`}>
      {visible.map((job, i) => (
        <li key={job.id}>
          <Marker index={i} />
          <span className={styles.barJob} title={`${job.company} ${job.title}`}>
            {job.company} {job.title}
          </span>
          <button
            type="button"
            className={styles.barRemove}
            onClick={() => onRemove(job)}
            aria-label={`${job.company} ${job.title} 선택 해제`}
          >
            ×
          </button>
        </li>
      ))}
      {hiddenCount > 0 && (
        <li className={styles.barToggleItem}>
          {isExpanded ? (
            <button
              type="button"
              className={styles.barFold}
              aria-expanded="true"
              onClick={() => setExpanded(false)}
            >
              접기
            </button>
          ) : (
            <button
              type="button"
              className={styles.barMoreButton}
              aria-expanded="false"
              aria-label={`선택한 공고 ${hiddenCount}개 더 보기`}
              onClick={() => setExpanded(true)}
            >
              +{hiddenCount}
            </button>
          )}
        </li>
      )}
    </ul>
  );
}

/** 화면 아래 고정 비교 바 */
// fromPreviousSearch: 현재 검색 결과가 0건인데 선택이 남아 있을 때 (문구만 바뀜)
export function CompareBar({ jobs, notice, fromPreviousSearch = false, onRemove, onClear, onCompare }) {
  if (!jobs.length) return null;
  const canCompare = jobs.length >= 2;
  // 선택한 공고끼리 값이 다른 항목 (AI 없이 단순 비교, 최대 3개)
  const points = canCompare ? getComparePoints(jobs) : [];
  return (
    <div className={styles.bar} role="region" aria-label="비교할 공고">
      <div className={styles.barInner}>
        <div className={styles.barInfo}>
          <p className={styles.barCount}>
            {fromPreviousSearch ? (
              <>
                이전 검색에서 선택한 공고 <strong>{jobs.length}개</strong>
              </>
            ) : (
              <>
                선택한 공고 <strong>{jobs.length}개</strong>
                <span className={styles.barMax}> · 최대 {MAX_COMPARE}개</span>
              </>
            )}
          </p>
          {/* 3개 선택 시 앞의 2개만 제목 chip + "+1" (누르면 같은 줄에서 세 번째 chip 펼침, 선택 데이터는 그대로 3개) */}
          <BarChips jobs={jobs} onRemove={onRemove} />
          {points.length > 0 && (
            <p className={styles.barPoints}>
              <span className={styles.barPointsLabel}>비교 포인트</span>
              {points.join(" · ")}
            </p>
          )}
          <p className={styles.barNotice} role="status">
            {notice || (!canCompare ? "공고를 1개 더 선택하면 비교할 수 있어요." : "")}
          </p>
        </div>
        <div className={styles.barActions}>
          <button type="button" className={styles.clearButton} onClick={onClear}>
            선택 초기화
          </button>
          <button
            type="button"
            className={styles.compareButton}
            disabled={!canCompare}
            onClick={onCompare}
          >
            공고 비교하기
          </button>
        </div>
      </div>
    </div>
  );
}

function Lines({ items }) {
  const list = (items ?? []).filter(isNonEmpty);
  if (!list.length) return <span className={styles.none}>공고에 명시되어 있지 않아요.</span>;
  return (
    <ul className={styles.lines}>
      {list.map((t, i) => (
        <li key={i}>{t.trim()}</li>
      ))}
    </ul>
  );
}

const isNonEmpty = (t) => typeof t === "string" && t.trim() !== "";

// AI 비교에 보내는 필드 (description 원문은 보내지 않음)
const toComparePayload = (j) => ({
  company: j.company,
  title: j.title,
  employmentType: j.employmentType,
  career: j.career,
  location: j.location,
  keywords: j.keywords ?? [],
  tasks: j.tasks ?? [],
  required: j.required ?? [],
  preferred: j.preferred ?? [],
});

/** Career Radar 비교 요약 — 버튼을 눌렀을 때만 /api/compare-jobs 호출 */
// savedSummary: 같은 공고 조합으로 이미 만든 AI 비교 결과 (새로고침 후 복원용, 없으면 null)
// onSummary(idsKey, summary): 결과를 page에 알려 sessionStorage에 저장
function CompareSummary({ jobs, savedSummary = null, onSummary }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState(savedSummary);
  const abortRef = useRef(null);

  // 선택 공고가 바뀌어 이 컴포넌트가 사라지면 진행 중인 요청도 취소
  useEffect(() => () => abortRef.current?.abort(), []);

  const handleSummarize = async () => {
    if (loading) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/compare-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobs: jobs.map(toComparePayload) }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.result) {
        // AI 요약만 실패한 것 → 아래 안내 블록에서 "비교 화면은 그대로"임을 함께 보여 준다
        setError(data?.error || "failed");
        return;
      }
      setSummary(data.result);
      onSummary?.(jobs.map((j) => j.id).join("|"), data.result);
    } catch (err) {
      if (err?.name === "AbortError") return;
      setError("network");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  return (
    <div className={styles.ai} aria-live="polite">
      {!summary ? (
        <div className={styles.aiIdle}>
          {error && !loading ? (
            // AI 요약만 실패: 비교 화면 전체가 고장 난 것처럼 보이지 않게 (경고색 X)
            <div className={styles.aiFail} role="status">
              {/* 원인(402·429 등)은 보여 주지 않음. 위·아래 사실 기반 비교는 AI와 무관하게 그대로 */}
              <p className={styles.aiFailTitle}>AI 요약을 잠시 불러오지 못했어요.</p>
              <p className={styles.aiFailDesc}>
                {error === "network"
                  ? "인터넷 연결을 확인한 뒤 다시 시도해 주세요. "
                  : ""}
                공고 비교 내용은 정상적으로 확인할 수 있어요.
              </p>
            </div>
          ) : (
            <p className={styles.aiDesc}>
              선택한 공고의 업무와 지원 조건이 어떻게 다른지 AI가 짧게 정리해 드려요.
            </p>
          )}
          <button
            type="button"
            className={styles.aiButton}
            disabled={loading}
            onClick={handleSummarize}
          >
            {loading ? "공고 차이 분석 중..." : error ? "다시 시도하기" : "AI로 차이 요약하기"}
          </button>
        </div>
      ) : (
        <>
          <dl className={styles.aiRows}>
            <div className={styles.aiRow}>
              <dt>가장 큰 차이</dt>
              <dd>
                {/* 공고마다 한 줄(키워드 · 키워드)이면 A/B/C를 붙여 줄로, 아니면 기존처럼 한 문단 */}
                {(() => {
                  const lines = summary.mainDifference.split("\n").filter((t) => t.trim());
                  return lines.length === jobs.length && lines.length > 1 ? (
                    <ul className={styles.diffLines}>
                      {lines.map((line, i) => (
                        <li key={i}>
                          <Marker index={i} />
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className={styles.aiLead}>{summary.mainDifference}</p>
                  );
                })()}
              </dd>
            </div>
            <div className={styles.aiRow}>
              <dt>공통으로 보이는 점</dt>
              <dd>
                {summary.commonPoints.length ? (
                  <ul className={styles.lines}>
                    {summary.commonPoints.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                ) : (
                  <span className={styles.none}>뚜렷한 공통점을 찾지 못했어요.</span>
                )}
              </dd>
            </div>
            {summary.bestFor.length > 0 && (
              <div className={styles.aiRow}>
                <dt>어떤 방향에 더 가까울까?</dt>
                <dd>
                  <ul className={styles.bestFor}>
                    {summary.bestFor.map((b, i) => (
                      <li key={i}>
                        <p className={styles.bestForTitle}>{b.jobTitle}</p>
                        <p className={styles.bestForText}>{b.summary}</p>
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
            {summary.watchPoints.length > 0 && (
              <div className={styles.aiRow}>
                <dt>비교할 때 확인할 점</dt>
                <dd>
                  <ul className={styles.lines}>
                    {summary.watchPoints.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
          </dl>
          <p className={styles.aiNote}>
            공고에 적힌 업무와 조건만 바탕으로 AI가 해석한 참고 정보예요. 자세한 내용은 아래 상세
            비교와 원문 공고를 함께 확인해 주세요.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * 그룹 제목 행 (30초 비교 / 지원 전 먼저 확인 …) — 표 전체 폭
 * 기본은 제목 + 여백 + 얇은 선. subtle: 펼침 컨트롤이 있는 큰 구분(상세 비교)에만 연한 배경
 */
function GroupRow({ id, title, cols, mark, note, action, subtle = false }) {
  return (
    <tr className={`${styles.groupRow} ${subtle ? styles.groupRowSubtle : ""}`}>
      <th id={id} scope="colgroup" colSpan={cols + 1}>
        <span className={styles.groupTitle}>
          {title}
          {mark}
          {note && <span className={styles.groupNote}>{note}</span>}
        </span>
        {action}
      </th>
    </tr>
  );
}

/** 비교 기준 1행: 왼쪽 기준 이름 + 공고별 값 (모바일에서는 기준 아래에 A/B/C 순서로 쌓임) */
function CriterionRow({ label, jobs, render, className = "" }) {
  return (
    <tr className={`${styles.row} ${className}`}>
      <th scope="row" className={styles.labelCell}>
        {label}
      </th>
      {jobs.map((j, i) => (
        <td key={j.id} data-marker={MARKERS[i]}>
          {render(j, i)}
        </td>
      ))}
    </tr>
  );
}

/** 공고 전체 폭 1행 (AI 요약, 공통 키워드) */
function WideRow({ label, cols, children }) {
  return (
    <tr className={`${styles.row} ${styles.wideRow}`}>
      {label ? (
        <>
          <th scope="row" className={styles.labelCell}>
            {label}
          </th>
          <td colSpan={cols}>{children}</td>
        </>
      ) : (
        <td colSpan={cols + 1}>{children}</td>
      )}
    </tr>
  );
}

/**
 * 선택한 공고 나란히 비교 — 하나의 비교 작업 공간
 * 공고(회사·제목)는 sticky 머리글에서 한 번만, 아래는 기준별 행.
 * 순서: 30초 비교 → 지원 전 먼저 확인 → 이 공고만의 포인트 → AI 비교 요약 → 공통 키워드 → 상세 비교
 */
export function CompareView({
  jobs,
  active = true,
  savedSummary = null,
  onSummary,
  onAnalyze,
  onBack,
}) {
  const titleRef = useRef(null);
  // 상세 비교: 위에서 핵심을 먼저 보고 필요할 때만 펼치도록 기본 접힘 (client state만, 저장하지 않음)
  const [tableOpen, setTableOpen] = useState(false);

  // 비교 화면이 보일 때마다 제목으로 포커스 이동 (스크린리더·키보드 사용자도 화면 전환을 알 수 있게)
  // (분석 화면에 다녀와도 AI 비교 결과가 유지되도록 숨김 상태로 마운트되어 있음)
  useEffect(() => {
    if (active) titleRef.current?.focus({ preventScroll: true });
  }, [active]);

  const cols = jobs.length;
  const common = getCommonKeywords(jobs);
  const commonKeys = new Set(common.map(keyOf));
  const hasCompanyType = jobs.some((j) => j.companyType);
  const hasCloseType = jobs.some((j) => closeTypeLabel(j));
  const hasWorkPeriod = jobs.some((j) => normalizeWorkPeriod(j.workPeriod));
  const highlights = getPostingHighlights(jobs);

  // 상세 비교 행 (기존 상세 비교표와 같은 항목)
  const detailRows = [
    { label: "근무형태", render: (j) => j.employmentType || "-" },
    { label: "경력조건", render: (j) => j.career || "-" },
    { label: "지역", render: (j) => j.location || "-" },
    // 모집 일정: "11.18 ~ 12.02 · D-14" / "채용시 마감" / 상시·수시 (예전 데이터는 기존 마감 문구)
    {
      label: "모집기간",
      render: (j) => <span className={styles.deadline}>{getApplicationSchedule(j).text || "-"}</span>,
    },
    // 마감 방식·근무기간: 하나라도 값이 있는 공고가 있을 때만 행 표시
    ...(hasCloseType
      ? [{ label: "마감 방식", render: (j) => closeTypeLabel(j) || "-" }]
      : []),
    ...(hasWorkPeriod
      ? [{ label: "근무기간", render: (j) => normalizeWorkPeriod(j.workPeriod) || "-" }]
      : []),
    // 기업유형은 데이터가 있을 때만 (현재는 샘플 값)
    ...(hasCompanyType ? [{ label: "기업유형", render: (j) => j.companyType || "-" }] : []),
    {
      label: "핵심 키워드",
      render: (j) =>
        j.keywords?.length ? (
          <ul className={styles.tags}>
            {j.keywords.map((k) => (
              <li key={k} className={commonKeys.has(keyOf(k)) ? styles.tagCommon : ""}>
                {k}
              </li>
            ))}
          </ul>
        ) : (
          "-"
        ),
    },
    { label: "주요 업무", render: (j) => <Lines items={j.tasks} /> },
    { label: "자격요건", render: (j) => <Lines items={j.required} /> },
    { label: "우대사항", render: (j) => <Lines items={j.preferred} /> },
  ];

  return (
    <section id="compare-jobs" className={styles.compare} aria-labelledby="compare-title">
      <button type="button" className={styles.backButton} onClick={onBack}>
        <span aria-hidden="true">←</span> 공고 목록으로
      </button>

      <div className={styles.compareHead}>
        <div className={styles.compareHeadText}>
          <h1 id="compare-title" className={styles.compareTitle} tabIndex={-1} ref={titleRef}>
            공고 비교
          </h1>
          <p className={styles.summary}>{cols}개 공고를 같은 기준으로 비교하고 있어요.</p>
        </div>
        {/* 비교 저장: 사실 데이터만 저장 (AI 요약 제외), 눌렀을 때만 */}
        <SaveComparisonButton jobs={jobs} active={active} />
      </div>

      {/* 모바일 전용: 표 머리글 대신 A/B/C가 어떤 공고인지 */}
      <ol className={styles.legend} aria-label="비교 중인 공고">
        {jobs.map((j, i) => (
          <li key={j.id}>
            <Marker index={i} />
            <span className={styles.legendText}>
              <span className={styles.legendCompany}>{j.company}</span>
              <span className={styles.legendTitle}>{j.title}</span>
            </span>
          </li>
        ))}
      </ol>

      <table className={styles.ws} data-cols={cols}>
        <caption className={styles.srOnly}>선택한 공고 {cols}개 비교</caption>
        <colgroup>
          <col className={styles.labelCol} />
          {jobs.map((j) => (
            <col key={j.id} />
          ))}
        </colgroup>
        {/* 공고 머리글: 한 번만, 스크롤해도 위에 고정 */}
        <thead>
          <tr>
            <th scope="col" className={styles.labelCell}>
              <span className={styles.srOnly}>비교 기준</span>
            </th>
            {jobs.map((j, i) => (
              <th key={j.id} scope="col" className={styles.jobHead}>
                <span className={styles.jobHeadTop}>
                  <Marker index={i} />
                  <span className={styles.company}>{j.company}</span>
                </span>
                <span className={styles.title}>{j.title}</span>
              </th>
            ))}
          </tr>
        </thead>

        {/* ① 30초 비교 — 공고 데이터 그대로 (AI 없음) */}
        <tbody>
          <GroupRow id="quick-title" title="30초 비교" cols={cols} />
          <CriterionRow
            label="하는 일"
            jobs={jobs}
            render={(j) => {
              const firstTask = j.tasks?.find(isNonEmpty);
              return <span className={styles.clamp2}>{firstTask ? firstTask.trim() : "-"}</span>;
            }}
          />
          <CriterionRow
            label="근무형태"
            jobs={jobs}
            render={(j) => <span className={styles.strong}>{j.employmentType || "-"}</span>}
          />
          <CriterionRow
            label="핵심 키워드"
            jobs={jobs}
            render={(j) => (j.keywords?.length ? j.keywords.join(" · ") : "-")}
          />
        </tbody>

        {/* ② 지원 전 먼저 확인 — required(필수조건)만 그대로 (우대는 상세 비교에서) */}
        <tbody>
          <GroupRow id="required-title" title="지원 전 먼저 확인" cols={cols} />
          <CriterionRow
            label="필수 조건"
            jobs={jobs}
            render={(j) => {
              const required = (j.required ?? []).filter(isNonEmpty);
              return required.length ? (
                <ul className={styles.reqList}>
                  {required.map((t, k) => (
                    <li key={k}>{t.trim()}</li>
                  ))}
                </ul>
              ) : (
                <span className={styles.none}>공고에서 별도 필수 조건을 찾지 못했어요.</span>
              );
            }}
          />
        </tbody>

        {/* ③ 이 공고만의 포인트 — 다른 선택 공고에 없는 근무형태·필수조건·키워드·우대 도구 (AI 없음) */}
        <tbody>
          <GroupRow
            id="highlights-title"
            title="이 공고만의 포인트"
            note="다른 선택 공고에는 없는 조건"
            cols={cols}
          />
          <CriterionRow
            label="핵심 포인트"
            jobs={jobs}
            className={styles.rowHighlight}
            render={(j, i) => {
              const points = highlights[i]?.points ?? [];
              return (
                // PC: 각 열 위에 A/B/C를 한 번 더 붙여 어느 공고의 포인트인지 바로 연결
                <div className={styles.hlCell}>
                  <Marker index={i} />
                  {points.length ? (
                    <ul className={styles.highlightList}>
                      {/* 업무 키워드 차이는 그대로, 특별 조건(필수조건·우대·전환 등)만 amber */}
                      {points.map((p) => (
                        <li
                          key={p.text}
                          className={
                            p.kind !== "keyword" && isSpecialCondition(p.text)
                              ? styles.highlightSpecial
                              : undefined
                          }
                        >
                          <span>{p.text}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className={styles.none}>뚜렷한 고유 조건 없음</span>
                  )}
                </div>
              );
            }}
          />
        </tbody>

        {/* ④ Career Radar 비교 요약 — 보조 정보 (버튼을 눌렀을 때만 AI 호출) */}
        <tbody>
          <GroupRow
            id="ai-title"
            title="Career Radar 비교 요약"
            cols={cols}
            mark={<span className={styles.aiMark}>AI 해석</span>}
          />
          <WideRow cols={cols}>
            {/* 선택 공고가 바뀌면 key가 바뀌어 기존 AI 비교 결과가 초기화된다 */}
            <CompareSummary
              key={jobs.map((j) => j.id).join("|")}
              jobs={jobs}
              savedSummary={savedSummary}
              onSummary={onSummary}
            />
          </WideRow>
        </tbody>

        {/* ⑤ 공통 키워드 */}
        <tbody>
          <WideRow label="공통 키워드" cols={cols}>
            {common.length ? (
              <ul className={styles.tags}>
                {common.map((k) => (
                  <li key={k} className={styles.tagCommon}>
                    {k}
                  </li>
                ))}
              </ul>
            ) : (
              // 현재 계산은 "선택한 모든 공고에 똑같이 있는 키워드"이므로 그 의미를 그대로 설명
              <span className={styles.none}>{cols}개 공고 모두에 공통인 키워드는 없어요.</span>
            )}
          </WideRow>
        </tbody>

        {/* ⑥ 상세 비교 — 기본 접힘 */}
        <tbody id="compare-table">
          <GroupRow
            id="detail-title"
            title="상세 비교"
            cols={cols}
            subtle
            action={
              <button
                type="button"
                className={styles.groupToggle}
                aria-expanded={tableOpen}
                aria-controls="compare-table"
                onClick={() => setTableOpen((v) => !v)}
              >
                {tableOpen ? "상세 비교 접기" : "근무형태부터 우대사항까지 펼쳐보기"}
                <span aria-hidden="true">{tableOpen ? "↑" : "↓"}</span>
              </button>
            }
          />
          {tableOpen &&
            detailRows.map((row) => (
              <CriterionRow key={row.label} label={row.label} jobs={jobs} render={row.render} />
            ))}
        </tbody>

        {/* 공고별 이동: 항상 표시 */}
        <tfoot>
          <tr className={styles.actionRow}>
            <th scope="row" className={styles.labelCell}>
              <span className={styles.srOnly}>공고 보기</span>
            </th>
            {jobs.map((j, i) => (
              <td key={j.id} data-marker={MARKERS[i]}>
                <div className={styles.actions}>
                  {j.originalUrl && (
                    <a
                      className={styles.linkButton}
                      href={j.originalUrl}
                      onClick={() => recordRecent(j)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      원문 공고 보기 <span aria-hidden="true">↗</span>
                    </a>
                  )}
                  <button type="button" className={styles.analyzeButton} onClick={() => onAnalyze(j)}>
                    공고 분석
                  </button>
                </div>
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </section>
  );
}
