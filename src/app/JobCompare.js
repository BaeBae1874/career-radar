"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./JobCompare.module.css";

export const MAX_COMPARE = 3;

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

/** 화면 아래 고정 비교 바 */
// fromPreviousSearch: 현재 검색 결과가 0건인데 선택이 남아 있을 때 (문구만 바뀜)
export function CompareBar({ jobs, notice, fromPreviousSearch = false, onRemove, onClear, onCompare }) {
  if (!jobs.length) return null;
  const canCompare = jobs.length >= 2;
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
          <ul className={styles.barList}>
            {jobs.map((job) => (
              <li key={job.id}>
                <span className={styles.barJob}>
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
          </ul>
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
  if (!items?.length) return <span className={styles.none}>공고에 명시되어 있지 않아요.</span>;
  return (
    <ul className={styles.lines}>
      {items.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ul>
  );
}

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
      <div className={styles.aiHead}>
        <h3 className={styles.aiTitle}>Career Radar 비교 요약</h3>
        <span className={styles.aiMark}>AI 해석</span>
      </div>

      {!summary ? (
        <div className={styles.aiIdle}>
          {error && !loading ? (
            // AI 요약만 실패: 비교 화면 전체가 고장 난 것처럼 보이지 않게 (경고색 X)
            <div className={styles.aiFail} role="status">
              <p className={styles.aiFailTitle}>AI 비교 요약을 불러오지 못했어요.</p>
              <p className={styles.aiFailDesc}>
                {error === "network"
                  ? "인터넷 연결을 확인한 뒤 다시 시도해 주세요. "
                  : ""}
                30초 비교와 지원 조건은 그대로 확인할 수 있어요.
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
                <p className={styles.aiLead}>{summary.mainDifference}</p>
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
            공고에 적힌 업무와 조건만 바탕으로 AI가 해석한 참고 정보예요. 자세한 내용은 아래
            비교표와 원문 공고를 함께 확인해 주세요.
          </p>
        </>
      )}
    </div>
  );
}

/** 30초 비교 — 기존 공고 데이터만 사용 (AI 호출·추론 없음) */
function QuickCompare({ jobs }) {
  return (
    <section className={styles.fact} aria-labelledby="quick-title">
      <h2 id="quick-title" className={styles.factTitle}>
        30초 비교
      </h2>
      {/* 공고마다 같은 기준(헤더·근무형태·주요 업무·핵심 키워드)이 같은 높이에 오도록 subgrid로 정렬 */}
      <div className={`${styles.factGrid} ${styles.quickGrid}`} data-cols={jobs.length}>
        {jobs.map((j) => {
          // 주요 업무: 공고 tasks의 첫 번째 항목 그대로
          const firstTask = j.tasks?.find((t) => isNonEmpty(t));
          return (
            <div key={j.id} className={styles.factCol}>
              <div className={styles.quickHead}>
                <p className={styles.factCompany}>{j.company}</p>
                <p className={styles.factJob}>{j.title}</p>
              </div>
              <dl className={styles.quickRow}>
                <dt>근무형태</dt>
                <dd className={styles.quickStrong}>
                  {j.employmentType || "-"}
                </dd>
              </dl>
              <dl className={styles.quickRow}>
                <dt>주요 업무</dt>
                <dd className={styles.clamp2}>{firstTask ? firstTask.trim() : "-"}</dd>
              </dl>
              <dl className={styles.quickRow}>
                <dt>핵심 키워드</dt>
                <dd>{j.keywords?.length ? j.keywords.join(" · ") : "-"}</dd>
              </dl>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** 지원 전 먼저 확인 — required(필수조건)만 그대로 (preferred는 섞지 않음, 지원 가능 여부는 판단하지 않음) */
function RequiredCheck({ jobs }) {
  return (
    <section className={`${styles.fact} ${styles.factRequired}`} aria-labelledby="required-title">
      <h2 id="required-title" className={styles.factTitle}>
        지원 전 먼저 확인
      </h2>
      <p className={styles.factDesc}>각 공고에 적힌 필수 조건이에요. 우대 조건은 아래 상세 비교표에서 볼 수 있어요.</p>
      <div className={styles.factGrid} data-cols={jobs.length}>
        {jobs.map((j) => {
          const required = (j.required ?? []).filter(isNonEmpty);
          return (
            <div key={j.id} className={styles.factCol}>
              <p className={styles.factCompany}>{j.company}</p>
              <p className={styles.factJobSmall}>{j.title}</p>
              {required.length ? (
                <ul className={styles.reqList}>
                  {required.map((t, i) => (
                    <li key={i}>{t.trim()}</li>
                  ))}
                </ul>
              ) : (
                <p className={styles.none}>공고에서 별도 필수 조건을 찾지 못했어요.</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

const isNonEmpty = (t) => typeof t === "string" && t.trim() !== "";

/** 선택한 공고 나란히 비교 */
export function CompareView({
  jobs,
  active = true,
  savedSummary = null,
  onSummary,
  onAnalyze,
  onBack,
}) {
  const titleRef = useRef(null);
  // 상세 비교표: 위에서 핵심을 먼저 보고 필요할 때만 펼치도록 기본 접힘 (client state만, 저장하지 않음)
  const [tableOpen, setTableOpen] = useState(false);

  // 비교 화면이 보일 때마다 제목으로 포커스 이동 (스크린리더·키보드 사용자도 화면 전환을 알 수 있게)
  // (분석 화면에 다녀와도 AI 비교 결과가 유지되도록 숨김 상태로 마운트되어 있음)
  useEffect(() => {
    if (active) titleRef.current?.focus({ preventScroll: true });
  }, [active]);

  const common = getCommonKeywords(jobs);
  const commonKeys = new Set(common.map(keyOf));
  const hasCompanyType = jobs.some((j) => j.companyType);

  const rows = [
    { label: "근무형태", render: (j) => j.employmentType || "-" },
    { label: "경력조건", render: (j) => j.career || "-" },
    { label: "지역", render: (j) => j.location || "-" },
    {
      label: "마감일",
      render: (j) => <span className={styles.deadline}>{j.deadline || "-"}</span>,
    },
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
        <h1 id="compare-title" className={styles.compareTitle} tabIndex={-1} ref={titleRef}>
          공고 비교
        </h1>
        <p className={styles.summary}>{jobs.length}개의 공고를 비교하고 있어요.</p>
      </div>

      {/* 정보 순서: 30초 비교 → 지원 전 먼저 확인 → AI 비교 요약 → 공통 키워드 → 상세 비교표 */}
      <QuickCompare jobs={jobs} />
      <RequiredCheck jobs={jobs} />

      {/* 선택 공고가 바뀌면 key가 바뀌어 기존 AI 비교 결과가 초기화된다 */}
      <CompareSummary
        key={jobs.map((j) => j.id).join("|")}
        jobs={jobs}
        savedSummary={savedSummary}
        onSummary={onSummary}
      />

      <div className={styles.common}>
        <p className={styles.commonLabel}>공통으로 보이는 키워드</p>
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
          <p className={styles.none}>{jobs.length}개 공고 모두에 공통인 키워드는 없어요.</p>
        )}
      </div>

      <div className={styles.tableSection}>
        <h2 className={styles.tableTitle}>상세 비교표</h2>
        <p className={styles.tableDesc}>
          근무형태부터 자격요건·우대사항까지 같은 기준으로 자세히 비교해 보세요.
        </p>
        {/* 펼치기/접기 모두 같은 위치·크기 (가운데) */}
        <div className={styles.tableToggleWrap}>
          <button
            type="button"
            className={styles.tableToggle}
            aria-expanded={tableOpen}
            aria-controls="compare-table"
            onClick={() => setTableOpen((v) => !v)}
          >
            {tableOpen ? "상세 비교표 접기" : "상세 비교표 펼쳐보기"}
            <span aria-hidden="true">{tableOpen ? "↑" : "↓"}</span>
          </button>
        </div>
        {tableOpen && (
          <div id="compare-table" className={styles.tableWrap}>
            <table className={styles.table} data-cols={jobs.length}>
              <thead>
                <tr>
                  <th scope="col" className={styles.labelCell}>
                    <span className={styles.srOnly}>항목</span>
                  </th>
                  {jobs.map((j) => (
                    <th key={j.id} scope="col" className={styles.jobHead}>
                      <span className={styles.company}>{j.company}</span>
                      <span className={styles.title}>{j.title}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label}>
                    <th scope="row" className={styles.labelCell}>
                      {row.label}
                    </th>
                    {jobs.map((j) => (
                      <td key={j.id}>{row.render(j)}</td>
                    ))}
                  </tr>
                ))}
                <tr className={styles.actionRow}>
                  <th scope="row" className={styles.labelCell}>
                    <span className={styles.srOnly}>공고 보기</span>
                  </th>
                  {jobs.map((j) => (
                    <td key={j.id}>
                      <div className={styles.actions}>
                        <button
                          type="button"
                          className={styles.analyzeButton}
                          onClick={() => onAnalyze(j)}
                        >
                          Career Radar 분석
                        </button>
                        {j.originalUrl && (
                          <a
                            className={styles.linkButton}
                            href={j.originalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            원문 공고 보기 <span aria-hidden="true">↗</span>
                          </a>
                        )}
                      </div>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
