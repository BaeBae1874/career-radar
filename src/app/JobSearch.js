"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import styles from "./JobSearch.module.css";
import JobRadar from "./JobRadar";
import { patchSession } from "./sessionStore";
import { getCheckPoints, isSpecialCondition } from "@/lib/jobInsights";
import { scheduleLine } from "@/lib/schedule";
import { getPageNumbers, paginate } from "@/lib/pagination";
import { getSourceLabel, hasSaraminSource, matchesEmploymentFilter } from "@/lib/postingMeta";
import {
  getRecentServerSnapshot,
  getRecentSnapshot,
  recordRecent,
  subscribeRecent,
} from "./recentStore";
import SaveJobButton from "./SaveJobButton";
import { useSavedJobs } from "./savedJobsStore";

const MAX_CARD_KEYWORDS = 3;
export const EMPLOYMENT_FILTERS = ["전체", "인턴", "정규직", "계약직"];

// 직무 바로가기: label은 화면 표시용, query는 기존 검색에 그대로 넣는 검색어
// (예: "기획"으로 찾아야 서비스·사업·운영기획이 함께 나옴)
const JOB_SHORTCUTS = [
  { label: "마케팅", query: "마케팅" },
  { label: "프론트엔드", query: "프론트엔드" },
  { label: "데이터 분석", query: "데이터" },
  { label: "서비스·사업 기획", query: "기획" },
  { label: "UX/UI·디자인", query: "디자인" },
];

const RECENT_VISIBLE = 3;
const MOBILE_PAGE_BUTTONS = 3;

/** 페이지 번호: PC 최대 5개, 모바일 최대 3개 (현재 페이지 중심). 1페이지뿐이면 렌더링하지 않음 */
function Pagination({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null;
  const numbers = getPageNumbers(page, totalPages);
  const mobile = new Set(getPageNumbers(page, totalPages, MOBILE_PAGE_BUTTONS));
  return (
    <nav className={styles.pagination} aria-label="검색 결과 페이지">
      <button
        type="button"
        className={styles.pageArrow}
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        aria-label="이전 페이지"
      >
        <span className={styles.arrowWide} aria-hidden="true">←</span>
        <span className={styles.arrowNarrow} aria-hidden="true">‹</span>
      </button>
      <ul className={styles.pageList}>
        {numbers.map((n) => (
          <li key={n} className={mobile.has(n) ? "" : styles.pageHideMobile}>
            <button
              type="button"
              className={`${styles.pageNumber} ${n === page ? styles.pageCurrent : ""}`}
              aria-current={n === page ? "page" : undefined}
              aria-label={`${n}페이지`}
              onClick={() => n !== page && onChange(n)}
            >
              {n}
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className={styles.pageArrow}
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
        aria-label="다음 페이지"
      >
        <span className={styles.arrowWide} aria-hidden="true">→</span>
        <span className={styles.arrowNarrow} aria-hidden="true">›</span>
      </button>
    </nav>
  );
}

/** 최근 본 공고 (검색 전 첫 화면에서만, 기록이 있을 때만) */
function RecentJobs({ jobs, onOpen }) {
  if (!jobs.length) return null;
  return (
    <section className={styles.recent} aria-labelledby="recent-title">
      <h3 id="recent-title" className={styles.recentTitle}>
        최근 본 공고
      </h3>
      <ul className={styles.recentList}>
        {jobs.slice(0, RECENT_VISIBLE).map((job) => {
          // 저장된 공고 정보만 사용 (새 데이터 없음)
          const meta = [job.company, job.employmentType, job.career, job.location].filter(Boolean);
          return (
            <li key={job.id}>
              {/* 행 전체가 공고 진입점 (기존과 같이 분석 화면으로 열림) */}
              <button
                type="button"
                className={styles.recentItem}
                onClick={() => onOpen(job)}
                aria-label={`${job.company} ${job.title} 다시 보기`}
              >
                <span className={styles.recentText}>
                  <span className={styles.recentJob}>{job.title}</span>
                  {meta.length > 0 && (
                    <span className={styles.recentMeta}>
                      {meta.map((m, k) => (
                        <span key={k}>{m}</span>
                      ))}
                    </span>
                  )}
                </span>
                <svg
                  className={styles.recentChevron}
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  aria-hidden="true"
                >
                  <path
                    d="M6 3.5 10.5 8 6 12.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * 검색 결과 1행 (공고마다 카드 대신 목록 안의 행). 모든 공고에서 같은 자리에 같은 정보:
 * ① 회사명 (오른쪽: 비교 선택·저장) ② 공고 제목 ③ 실제로 하게 될 일 (한 단계 강조)
 * ④ 채용 조건: 중요한 것만 태그(신입·인턴·계약직·포트폴리오 필수 등), 나머지는 글자 + 마감
 * ⑤ 핵심 직무 키워드 2~3개 / 원문 공고 · 공고 분석(가장 약하게)
 */
function JobRow({ job, selected, compared, saved, savePending, showSource, onToggleCompare, onAnalyze }) {
  const firstTask = job.tasks?.find((t) => typeof t === "string" && t.trim());
  // 조건 태그: 경력 "신입" + 기존 핵심 체크 포인트(자격요건·근무형태에서 명확한 것만, 최대 2개)
  const conditionTags = [
    ...(typeof job.career === "string" && job.career.trim() === "신입" ? ["신입"] : []),
    ...getCheckPoints(job),
  ].filter((t, i, list) => list.indexOf(t) === i);
  // 글자 메타: 태그로 이미 보인 값은 반복하지 않음 (예: 경력 "신입")
  const conditionText = [job.career, job.employmentType, job.location]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v) => v && !conditionTags.includes(v));
  const keywords = (job.keywords ?? []).slice(0, MAX_CARD_KEYWORDS);
  const schedule = scheduleLine(job);
  const sourceLabel = showSource ? getSourceLabel(job.source) : "";
  const name = `${job.company} ${job.title}`;
  return (
    <li
      className={`${styles.post} ${compared ? styles.postCompared : ""} ${
        selected ? styles.postSelected : ""
      }`}
    >
      <div className={styles.postHead}>
        <p className={styles.postCompany}>{job.company}</p>
        <div className={styles.postPick}>
          {/* 비교 선택 (최대 3개는 page.js에서 그대로 제한) */}
          <label className={`${styles.compareToggle} ${compared ? styles.compareToggleOn : ""}`}>
            <input
              type="checkbox"
              checked={compared}
              onChange={() => onToggleCompare(job)}
              aria-label={`${name} 비교 선택`}
            />
            <span aria-hidden="true">비교</span>
          </label>
          <SaveJobButton job={job} saved={saved} pending={savePending} size="icon" />
        </div>
      </div>

      <h3 className={styles.postTitle}>{job.title}</h3>

      {/* Career Radar 핵심: 제목 바로 아래 실제 업무 (공고 tasks의 첫 번째 그대로, 없으면 숨김) */}
      {firstTask && (
        <p className={styles.postTask}>
          <span className={styles.postTaskLabel}>하는 일</span>
          <span className={styles.postTaskText}>{firstTask.trim()}</span>
        </p>
      )}

      <div className={styles.postConditions}>
        {conditionTags.length > 0 && (
          <ul className={styles.conditionTags} aria-label="주요 조건">
            {/* 특별 조건(졸업 예정자·포트폴리오·학력·근무 기간·도구 우대 등)만 amber, 신입·인턴·계약직은 기본 */}
            {conditionTags.map((c) => (
              <li key={c} className={isSpecialCondition(c) ? styles.conditionSpecial : undefined}>
                {c}
              </li>
            ))}
          </ul>
        )}
        {(conditionText.length > 0 || schedule) && (
          <p className={styles.conditionText}>
            {conditionText.map((m, i) => (
              <span key={i}>{m}</span>
            ))}
            {/* 모집 일정: "모집 11.18 ~ 12.02 · D-14" / "채용시 마감" / 상시·수시 (새 색 없이 글자 굵기만) */}
            {schedule && <span className={styles.postDeadline}>{schedule}</span>}
          </p>
        )}
      </div>

      <div className={styles.postFoot}>
        {keywords.length > 0 && (
          <ul className={styles.postKeywords} aria-label="핵심 직무 키워드">
            {keywords.map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
        )}
        {sourceLabel && <span className={styles.source}>출처 {sourceLabel}</span>}
        <div className={styles.postActions}>
          {job.originalUrl && (
            <a
              className={styles.postLink}
              href={job.originalUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => recordRecent(job)}
            >
              원문 공고 <span aria-hidden="true">↗</span>
            </a>
          )}
          {/* AI 분석: 원문·비교보다 한 단계 약한 글자 버튼 */}
          <button type="button" className={styles.postAnalyze} onClick={() => onAnalyze(job)}>
            공고 분석
          </button>
        </div>
      </div>
    </li>
  );
}

/**
 * initial: 새로고침 후 page가 sessionStorage + /api/jobs로 복원한 검색 상태 (없으면 빈 상태)
 * persist: 복원이 끝난 뒤에만 true → 복원 전 초기값이 저장된 상태를 덮어쓰지 않게
 */
export default function JobSearch({
  selectedJobId,
  compareIds = [],
  onToggleCompare,
  onAnalyze,
  initial = null,
  persist = false,
  onResultCount,
}) {
  const [query, setQuery] = useState(initial?.query ?? "");
  const [jobs, setJobs] = useState(initial?.jobs ?? null); // null = 아직 검색 전
  const [isSample, setIsSample] = useState(initial?.isSample ?? false);
  const [searchedKeyword, setSearchedKeyword] = useState(initial?.searchedKeyword ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState(initial?.filter ?? "전체");
  // 현재 결과 페이지 (1부터). 화면 전환 중에도 JobSearch는 마운트된 채라 그대로 유지되고,
  // F5 후에는 sessionStorage의 search.page로 복원된다. 범위 밖 값은 렌더링 때 paginate()가 보정
  const [page, setPage] = useState(initial?.page ?? 1);
  const resultsRef = useRef(null);
  const recentJobs = useSyncExternalStore(
    subscribeRecent,
    getRecentSnapshot,
    getRecentServerSnapshot
  );

  // 현재 검색 결과 수를 page에 알림 (null = 아직 검색 전) — 하단 비교 바 문구용
  useEffect(() => {
    onResultCount?.(jobs ? jobs.length : null);
  }, [jobs, onResultCount]);

  // 검색 결과 자체는 저장하지 않고, 다시 가져올 수 있는 검색어·필터만 저장
  useEffect(() => {
    if (!persist) return;
    patchSession({ search: { query, searchedKeyword, filter, page, hasSearched: jobs !== null } });
  }, [persist, query, searchedKeyword, filter, page, jobs]);

  const handleSearch = (e) => {
    e?.preventDefault();
    runSearch(query);
  };

  // 직무 바로가기: 검색창 값을 바꾸고 기존 검색 로직을 그대로 실행
  const handleShortcut = (q) => {
    setQuery(q);
    runSearch(q);
  };

  const runSearch = async (rawKeyword) => {
    if (loading) return;
    const keyword = rawKeyword.trim();

    setError("");
    setLoading(true);
    try {
      const res = await fetch(`/api/jobs?keyword=${encodeURIComponent(keyword)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(data?.jobs)) {
        setError(data?.error || "채용공고를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
        return;
      }
      setJobs(data.jobs);
      setIsSample(Boolean(data.isSample));
      setSearchedKeyword(keyword);
      setFilter("전체");
      setPage(1); // 새 검색·직무 바로가기 → 1페이지
    } catch {
      setError("서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  };

  // 근무형태: 실제 고용 형태 기준 분류 ("계약직 (정규직 전환가능)"은 계약직만). 샘플은 employmentType으로 fallback
  const countOf = (f) => jobs.filter((j) => matchesEmploymentFilter(j, f)).length;
  const visibleJobs =
    jobs && jobs.filter((j) => matchesEmploymentFilter(j, filter));
  // 통계(JobRadar)는 visibleJobs 전체 기준, 목록만 현재 페이지 (PAGE_SIZE개)
  const paged = visibleJobs ? paginate(visibleJobs, page) : null;
  // 저장 상태: 지금 페이지에 보이는 공고만 한 번에 조회 (공고마다 요청하지 않음)
  const savedState = useSavedJobs(paged ? paged.items.map((j) => j.id) : []);

  const changeFilter = (f) => {
    setFilter(f);
    setPage(1); // 근무형태 필터 변경 → 1페이지
  };

  // 페이지 번호를 눌렀을 때만 검색 결과 시작 지점으로 이동 (화면 전환 scroll restore와는 무관)
  const changePage = (next) => {
    setPage(next);
    requestAnimationFrame(() => {
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };
  // 출처 목록: 지금은 표시만, 실제 출처가 여러 개 붙으면 이 값으로 필터 버튼을 만들면 된다
  // 화면에는 내부 코드("saramin") 대신 표시 이름("사람인")
  const sources = jobs ? [...new Set(jobs.map((j) => getSourceLabel(j.source)).filter(Boolean))] : [];

  return (
    <section id="find-jobs" className={styles.search} aria-labelledby="search-title">
      <div className={styles.searchBox}>
        {/* Hero 바로 아래 검색창이 오도록 제목은 화면에서 숨기고 보조기기용으로만 유지 */}
        <h2 id="search-title" className={styles.srOnly}>
          어떤 일을 찾고 있나요?
        </h2>

        <form className={styles.searchForm} role="search" onSubmit={handleSearch}>
          <label htmlFor="job-search" className={styles.srOnly}>
            직무나 키워드
          </label>
          <div className={styles.searchField}>
            <svg className={styles.searchIcon} width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
              <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path d="M13.5 13.5 17 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <input
              id="job-search"
              className={styles.searchInput}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="직무명, 하는 일, 키워드로 검색 (예: 마케팅, CRM, 데이터 분석)"
              autoComplete="off"
            />
          </div>
          <button
            type="button"
            className={styles.searchButton}
            disabled={loading}
            onClick={handleSearch}
          >
            {loading ? "찾는 중..." : "검색"}
          </button>
        </form>

        {/* 직무 바로가기 (가로 한 줄, 모바일은 가로 스크롤) — 필터가 늘어나면 왼쪽 레일로 옮길 수 있게 분리 */}
        <div className={styles.shortcuts} role="group" aria-label="직무 바로가기">
          <span className={styles.shortcutsLabel}>직무</span>
          <ul className={styles.shortcutList}>
            {JOB_SHORTCUTS.map((s) => (
              <li key={s.query}>
                <button
                  type="button"
                  className={`${styles.shortcut} ${
                    jobs && searchedKeyword === s.query ? styles.shortcutActive : ""
                  }`}
                  aria-pressed={Boolean(jobs) && searchedKeyword === s.query}
                  disabled={loading}
                  onClick={() => handleShortcut(s.query)}
                >
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* 검색 결과에 없는 공고: 채용사이트에서 복사해 직접 추가 (작은 보조 링크) */}
        <p className={styles.customEntry}>
          찾는 공고가 없나요?{" "}
          <Link href="/custom-job" className={styles.customEntryLink}>
            공고 직접 추가
          </Link>
        </p>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>

      {/* 아직 검색하지 않은 첫 화면 + 최근 기록이 있을 때만 */}
      {!jobs && <RecentJobs jobs={recentJobs} onOpen={onAnalyze} />}

      {jobs && (
        <div className={styles.results} aria-live="polite" ref={resultsRef}>
          {/* 결과 요약 한 줄 + 근무형태 필터 (가로) */}
          {jobs.length > 0 && (
            <JobRadar
              jobs={visibleJobs}
              keyword={searchedKeyword}
              filter={filter}
              filters={
                <div className={styles.filters} role="group" aria-label="근무형태 필터">
                  {EMPLOYMENT_FILTERS.map((f) => (
                    <button
                      key={f}
                      type="button"
                      aria-pressed={filter === f}
                      className={`${styles.filter} ${filter === f ? styles.filterActive : ""}`}
                      onClick={() => changeFilter(f)}
                    >
                      {f} <span className={styles.filterCount}>{countOf(f)}</span>
                    </button>
                  ))}
                </div>
              }
            />
          )}

          <p className={styles.sourceRow}>
            <span className={styles.sourceLabel}>출처</span>
            {/* 샘플 상태에서는 사람인을 실제 출처처럼 보이지 않게 '샘플 데이터'로 표시 */}
            {isSample ? (
              <>
                <span className={styles.sourceChip}>샘플 데이터</span>
                <span className={styles.sampleNote}>실제 채용공고 연동은 준비 중이에요.</span>
              </>
            ) : (
              sources.map((src) => (
                <span key={src} className={styles.sourceChip}>
                  {src}
                </span>
              ))
            )}
            {/* 사람인 실데이터(source === "saramin")가 있을 때만 출처 표기. 샘플 데이터만 쓰는 지금은 표시되지 않음 */}
            {hasSaraminSource(jobs) && (
              <a
                className={styles.attribution}
                href="https://www.saramin.co.kr"
                target="_blank"
                rel="noopener noreferrer"
              >
                Powered by 취업 사람인
              </a>
            )}
          </p>

          {visibleJobs.length > 0 ? (
            <ul className={styles.list}>
              {paged.items.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  selected={job.id === selectedJobId}
                  compared={compareIds.includes(job.id)}
                  saved={savedState.saved.has(job.id)}
                  savePending={savedState.pending.has(job.id)}
                  showSource={!isSample}
                  onToggleCompare={onToggleCompare}
                  onAnalyze={onAnalyze}
                />
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>
              {jobs.length === 0
                ? "검색 결과가 없어요. 다른 직무명이나 키워드로 찾아보세요."
                : `${filter} 공고가 없어요. 다른 근무형태를 선택해 보세요.`}
            </p>
          )}

          <Pagination page={paged.page} totalPages={paged.totalPages} onChange={changePage} />
        </div>
      )}
    </section>
  );
}
