"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./page.module.css";
import JobSearch, { EMPLOYMENT_FILTERS } from "./JobSearch";
import { loadSession, patchSession } from "./sessionStore";
import { CompareBar, CompareView, MAX_COMPARE } from "./JobCompare";

const INTERESTS = ["마케팅", "기획", "데이터", "개발", "디자인", "금융", "콘텐츠"];

const JOB_POSTING_PLACEHOLDER = `예:
주요 업무
- 고객 데이터를 분석해 타깃 캠페인을 기획합니다.
- 이메일, 앱푸시 등 CRM 캠페인을 운영합니다.

자격요건
- 데이터 기반으로 문제를 해결할 수 있는 분

우대사항
- SQL 또는 GA 사용 경험`;

const EMPTY_TEXT = "공고에 명시되어 있지 않아요.";

function SourceMark() {
  return <span className={`${styles.mark} ${styles.markSource}`}>원문 추출</span>;
}

function AiMark() {
  return <span className={`${styles.mark} ${styles.markAi}`}>AI 해석</span>;
}

function TextList({ items }) {
  if (!items.length) return <p className={styles.empty}>{EMPTY_TEXT}</p>;
  return (
    <ul className={styles.list}>
      {items.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ul>
  );
}

// 기본으로 limit개만 보여주고 나머지는 "+N개 더보기" / "접기" (client-side만, API 호출 없음)
function useCollapsible(items, limit) {
  const [open, setOpen] = useState(false);
  // 다른 분석 결과로 바뀌면 다시 접힌 상태로
  const [prevItems, setPrevItems] = useState(items);
  if (prevItems !== items) {
    setPrevItems(items);
    setOpen(false);
  }
  const hidden = Math.max(0, items.length - limit);
  const visible = open || !hidden ? items : items.slice(0, limit);
  const toggle = hidden > 0 && (
    <button
      type="button"
      className={styles.moreButton}
      aria-expanded={open}
      onClick={() => setOpen((v) => !v)}
    >
      {open ? "접기" : `+${hidden}개 더보기`}
    </button>
  );
  return { visible, toggle };
}

// 공백·대소문자만 다른 키워드는 하나로 (새 내용을 만들지 않고 기존 키워드만 사용)
const dedupeKeywords = (list) => {
  const seen = new Set();
  return list.filter((t) => {
    const key = String(t).replace(/\s+/g, "").toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const MAX_SKILLS = 6;
const MAX_CHECK_POINTS = 3;

function SkillChips({ skills }) {
  const items = useMemo(() => dedupeKeywords(skills), [skills]);
  const { visible, toggle } = useCollapsible(items, MAX_SKILLS);
  if (!items.length) return <p className={styles.empty}>{EMPTY_TEXT}</p>;
  return (
    <div className={styles.chipsWrap}>
      <ul className={styles.chips}>
        {visible.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
      {toggle}
    </div>
  );
}

function CheckPoints({ points }) {
  const { visible, toggle } = useCollapsible(points, MAX_CHECK_POINTS);
  if (!points.length) return <p className={styles.muted}>공고만으로 특별히 불명확한 부분은 없었어요.</p>;
  return (
    <>
      <ul className={styles.checkList}>
        {visible.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
      {toggle}
    </>
  );
}

function Section({ title, mark, children, className = "" }) {
  return (
    <section className={`${styles.section} ${className}`}>
      <h3 className={styles.sectionTitle}>
        {title}
        {mark}
      </h3>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

// AI 분석만 실패했을 때: 화면 전체가 고장 난 것처럼 보이지 않게 차분한 안내 (공고 정보·원문 링크는 그대로)
function AiFailNotice({ kind, isManual }) {
  return (
    <div className={styles.aiFail} role="status">
      <p className={styles.aiFailTitle}>공고 분석을 불러오지 못했어요.</p>
      <p className={styles.aiFailDesc}>
        {kind === "network" && "인터넷 연결을 확인한 뒤 다시 시도해 주세요. "}
        {isManual
          ? "입력한 공고 내용은 그대로 남아 있어요."
          : "원문 공고는 그대로 확인할 수 있어요."}
      </p>
    </div>
  );
}

function Chevron({ open }) {
  return (
    <svg
      className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" className={styles.infoIcon}>
      <circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 9v5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="10" cy="6.3" r="1" fill="currentColor" />
    </svg>
  );
}

// ───── sessionStorage 복원 검증 ─────
// 저장된 값이 오래됐거나 형식이 다르면 해당 상태만 버리고 기본(search) 화면으로 시작한다
const isStr = (v) => typeof v === "string";
const isStrArray = (v) => Array.isArray(v) && v.every(isStr);
const VIEWS = ["search", "compare", "analysis"];
const ANALYSIS_FROM = ["search", "compare", "manual"];

/** /api/analyze-job 결과 형태인지 */
function isValidAnalysisResult(r) {
  return (
    r &&
    typeof r === "object" &&
    isStr(r.jobTitle) &&
    isStr(r.simpleExplanation) &&
    ["explanationEvidence", "actualTasks", "skills", "required", "preferred", "unclearPoints"].every(
      (k) => isStrArray(r[k])
    ) &&
    Array.isArray(r.similarRoles) &&
    r.similarRoles.every((x) => x && isStr(x.name) && isStr(x.difference))
  );
}

/** /api/compare-jobs 결과 형태이고, bestFor가 지금 비교 중인 공고 제목에만 해당하는지 */
function isValidCompareSummary(r, jobs) {
  const titles = new Set(jobs.map((j) => j.title));
  return (
    r &&
    typeof r === "object" &&
    isStr(r.mainDifference) &&
    isStrArray(r.commonPoints) &&
    isStrArray(r.watchPoints) &&
    Array.isArray(r.bestFor) &&
    r.bestFor.every((b) => b && isStr(b.summary) && titles.has(b.jobTitle))
  );
}

/** 분석 화면 헤더에 필요한 만큼만 저장하는 공고 요약 */
const SNAPSHOT_FIELDS = ["company", "title", "originalUrl", "employmentType", "career", "location", "deadline"];
const toJobSnapshot = (job) =>
  job && {
    id: job.id,
    ...Object.fromEntries(SNAPSHOT_FIELDS.map((k) => [k, isStr(job[k]) ? job[k] : ""])),
  };

async function fetchJobList(keyword) {
  try {
    const res = await fetch(`/api/jobs?keyword=${encodeURIComponent(keyword)}`);
    const data = await res.json().catch(() => null);
    return res.ok && Array.isArray(data?.jobs) ? data : null;
  } catch {
    return null;
  }
}

export default function Home() {
  const [interests, setInterests] = useState([]);
  const [keyword, setKeyword] = useState("");
  const [jobPosting, setJobPosting] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(""); // 입력 확인 등 사용자가 고칠 수 있는 오류
  // AI 분석만 실패한 경우 ("failed" | "network"): 경고색 없이 안내 + 다시 시도
  const [aiFail, setAiFail] = useState("");
  const [result, setResult] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState(null);
  const resultRef = useRef(null);
  const analyzeRef = useRef(null);
  const [compareJobs, setCompareJobs] = useState([]);
  // 화면 단계: "search"(공고 찾기) / "compare"(공고 비교) / "analysis"(공고 1개 분석)
  // 모든 상태는 page에 두고 화면만 바꾸므로, 돌아왔을 때 검색·선택·비교 결과가 그대로 유지된다
  const [view, setView] = useState("search");
  // analysis 화면에 어디서 들어왔는지: "search" | "compare" | "manual"(공고 직접 입력)
  const [analysisFrom, setAnalysisFrom] = useState("search");
  // 화면별 스크롤 위치 (화면 전환 + F5 복원에 사용, sessionStorage에도 저장)
  const scrollPositions = useRef({ search: 0, compare: 0, analysis: 0 });
  const viewRef = useRef("search");
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  // 분석 대상이 바뀌면 증가 → 이전 공고의 늦게 도착한 분석 응답을 무시
  const analysisRunId = useRef(0);
  const [compareNotice, setCompareNotice] = useState("");
  // AI 비교 결과: { ids: "공고ID|공고ID", summary } — ids가 지금 선택과 다르면 사용하지 않음
  const [compareSummary, setCompareSummary] = useState(null);
  // 분석 결과를 만든 입력 원문 (새로고침 후 입력과 결과가 일치할 때만 결과 복원)
  const [resultPosting, setResultPosting] = useState("");
  // 공고 직접 입력일 때 사용자가 적은 공고 제목/직무명 (선택)
  const [manualTitle, setManualTitle] = useState("");
  // sessionStorage 복원 완료 여부 (복원 전에는 화면을 숨겨 잘못된 초기 화면이 보이지 않게)
  const [restored, setRestored] = useState(false);
  const [initialSearch, setInitialSearch] = useState(null);
  const [searchMountKey, setSearchMountKey] = useState(0);
  // 현재 검색 결과 수 (null = 검색 전) — 0건일 때 하단 바 문구만 바꾼다
  const [resultCount, setResultCount] = useState(null);

  // ① 마운트 후 1회: sessionStorage → 상태 복원 (서버 렌더링 중에는 실행되지 않음)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = loadSession();
      const search = saved?.search && typeof saved.search === "object" ? saved.search : null;
      const pageState = saved?.page && typeof saved.page === "object" ? saved.page : null;

      // 검색 결과는 저장하지 않았으므로 검색어로 /api/jobs를 다시 불러온다
      const searchedKeyword = isStr(search?.searchedKeyword)
        ? search.searchedKeyword.slice(0, 100)
        : "";
      const listData = search?.hasSearched ? await fetchJobList(searchedKeyword) : null;

      // 비교 선택 ID → 다시 불러온 공고와 매칭 (현재 목록에 없으면 전체 목록에서 한 번 더 찾기)
      const ids = (isStrArray(pageState?.compareIds) ? pageState.compareIds : []).slice(
        0,
        MAX_COMPARE
      );
      let pool = listData?.jobs ?? [];
      if (ids.some((id) => !pool.some((j) => j.id === id))) {
        const all = await fetchJobList("");
        if (all) pool = [...pool, ...all.jobs];
      }
      const restoredCompare = [...new Set(ids)]
        .map((id) => pool.find((j) => j.id === id))
        .filter(Boolean);
      const canRestoreCompare = restoredCompare.length >= 2;

      if (cancelled) return;

      // 검색 화면
      if (search) {
        setInitialSearch({
          query: isStr(search.query) ? search.query : "",
          searchedKeyword,
          filter: EMPLOYMENT_FILTERS.includes(search.filter) ? search.filter : "전체",
          jobs: listData?.jobs ?? null,
          isSample: Boolean(listData?.isSample),
        });
        setSearchMountKey((k) => k + 1); // 복원값으로 JobSearch를 다시 시작
      }

      // 비교 선택 + AI 비교 결과 (같은 공고 조합일 때만)
      setCompareJobs(restoredCompare);
      const savedSummary = pageState?.compareSummary;
      const compareKey = restoredCompare.map((j) => j.id).join("|");
      if (
        canRestoreCompare &&
        savedSummary?.ids === compareKey &&
        isValidCompareSummary(savedSummary.summary, restoredCompare)
      ) {
        setCompareSummary({ ids: compareKey, summary: savedSummary.summary });
      }

      // 분석 화면 상태
      const a = pageState?.analysis && typeof pageState.analysis === "object" ? pageState.analysis : null;
      let from = ANALYSIS_FROM.includes(pageState?.analysisFrom) ? pageState.analysisFrom : "search";
      let hasAnalysis = false;
      if (a) {
        const job =
          a.job && isStr(a.job.id) && isStr(a.job.title)
            ? toJobSnapshot(a.job)
            : null;
        const posting = isStr(a.jobPosting) ? a.jobPosting : "";
        if (!job) from = "manual";
        if (from === "compare" && !canRestoreCompare) from = "search";
        const resultOk =
          isValidAnalysisResult(a.result) && isStr(a.resultPosting) && a.resultPosting === posting;

        setSelectedJob(job);
        setInterests(isStrArray(a.interests) ? a.interests.filter((i) => INTERESTS.includes(i)) : []);
        setKeyword(isStr(a.keyword) ? a.keyword : "");
        setJobPosting(posting);
        setManualTitle(isStr(a.manualTitle) ? a.manualTitle.slice(0, 100) : "");
        if (resultOk) {
          setResult(a.result);
          setResultPosting(posting);
        }
        setFormOpen(typeof a.formOpen === "boolean" ? a.formOpen : !resultOk);
        hasAnalysis = Boolean(job) || posting.trim() !== "" || from === "manual";
      }
      setAnalysisFrom(from);

      // 화면: 복원 가능한 경우에만, 아니면 search
      let nextView = VIEWS.includes(pageState?.view) ? pageState.view : "search";
      if (nextView === "compare" && !canRestoreCompare) nextView = "search";
      if (nextView === "analysis" && !hasAnalysis) nextView = "search";
      setView(nextView);

      // 화면별 스크롤 위치: 콘텐츠 복원(렌더)이 끝난 다음 프레임에 적용
      const savedScroll = saved?.scroll && typeof saved.scroll === "object" ? saved.scroll : {};
      VIEWS.forEach((v) => {
        const y = Number(savedScroll[v]);
        scrollPositions.current[v] = Number.isFinite(y) && y > 0 ? y : 0;
      });
      setRestored(true);
      const targetY = scrollPositions.current[nextView];
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!cancelled) window.scrollTo({ top: targetY });
        })
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 최대 개수 안내는 잠시 보여준 뒤 사라지게
  useEffect(() => {
    if (!compareNotice) return;
    const timer = setTimeout(() => setCompareNotice(""), 3000);
    return () => clearTimeout(timer);
  }, [compareNotice]);

  const scrollToId = (id) => {
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const canCompare = compareJobs.length >= 2;
  const compareKey = compareJobs.map((j) => j.id).join("|");
  // 지금 선택한 공고 조합과 같은 경우에만 AI 비교 결과 사용
  const currentCompareSummary =
    compareSummary && compareSummary.ids === compareKey ? compareSummary.summary : null;

  // ② 복원이 끝난 뒤부터 작업 상태를 sessionStorage에 저장
  //    (검색 결과·로딩·오류·알림 같은 일시 상태는 저장하지 않음)
  useEffect(() => {
    if (!restored) return;
    patchSession({
      page: {
        view,
        analysisFrom,
        compareIds: compareJobs.map((j) => j.id),
        compareSummary: currentCompareSummary
          ? { ids: compareKey, summary: currentCompareSummary }
          : null,
        analysis: {
          job: toJobSnapshot(selectedJob),
          interests,
          keyword,
          jobPosting,
          manualTitle,
          formOpen,
          // 결과는 그 결과를 만든 입력 원문과 함께 저장 → 복원 시 입력과 같을 때만 사용
          result: result && resultPosting === jobPosting ? result : null,
          resultPosting: result && resultPosting === jobPosting ? resultPosting : "",
        },
      },
    });
  }, [
    restored,
    view,
    analysisFrom,
    compareJobs,
    compareKey,
    currentCompareSummary,
    selectedJob,
    interests,
    keyword,
    jobPosting,
    manualTitle,
    formOpen,
    result,
    resultPosting,
  ]);

  // ③ 스크롤 위치: 브라우저 자동 복원 대신 직접 복원하고, 스크롤이 멈추면 가볍게 저장 (debounce)
  useEffect(() => {
    if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
  }, []);
  useEffect(() => {
    if (!restored) return;
    let timer = null;
    const onScroll = () => {
      scrollPositions.current[viewRef.current] = window.scrollY;
      clearTimeout(timer);
      timer = setTimeout(() => patchSession({ scroll: { ...scrollPositions.current } }), 250);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
    };
  }, [restored]);
  const isCompareView = view === "compare" && canCompare;
  const isManual = analysisFrom === "manual" || !selectedJob;

  // 화면 전환: 떠나는 화면의 스크롤 위치를 기억하고, 새 화면은 지정한 위치로 이동
  const switchView = (next, scrollTop = 0) => {
    scrollPositions.current[view] = window.scrollY;
    viewRef.current = next;
    setView(next);
    requestAnimationFrame(() => window.scrollTo({ top: scrollTop }));
  };
  // 이전에 보던 위치로 돌아가기
  const restoreView = (next) => switchView(next, scrollPositions.current[next] ?? 0);

  const updateCompareJobs = (next) => {
    setCompareJobs(next);
    // 공고 조합이 바뀌면 기존 AI 비교 결과는 폐기
    const nextKey = next.map((j) => j.id).join("|");
    setCompareSummary((prev) => (prev && prev.ids === nextKey ? prev : null));
    if (next.length < 2 && view === "compare") setView("search");
  };

  const toggleCompare = (job) => {
    if (compareJobs.some((j) => j.id === job.id)) {
      updateCompareJobs(compareJobs.filter((j) => j.id !== job.id));
      setCompareNotice("");
      return;
    }
    if (compareJobs.length >= MAX_COMPARE) {
      setCompareNotice(`공고는 최대 ${MAX_COMPARE}개까지 비교할 수 있어요.`);
      return;
    }
    updateCompareJobs([...compareJobs, job]);
  };

  const clearCompare = () => {
    updateCompareJobs([]);
    setCompareNotice("");
  };

  // search → compare
  const openCompare = () => {
    if (!canCompare) return;
    switchView("compare", 0);
  };

  // compare → search
  const backToList = () => restoreView("search");

  // analysis → 들어온 화면으로
  const backFromAnalysis = () =>
    analysisFrom === "compare" && canCompare ? restoreView("compare") : restoreView("search");

  // 분석 결과/진행 상태 초기화 (다른 공고를 분석하게 될 때)
  const resetAnalysis = () => {
    analysisRunId.current += 1;
    setResult(null);
    setResultPosting("");
    setEvidenceOpen(false);
    setError("");
    setAiFail("");
    setLoading(false);
  };

  // 상단 메뉴
  const goToSearch = () => {
    if (view === "search") scrollToId("find-jobs");
    else restoreView("search");
  };
  const goToCompare = () => {
    if (isCompareView) window.scrollTo({ top: 0, behavior: "smooth" });
    else if (canCompare) switchView("compare", 0);
    else {
      switchView("search");
      scrollToId("find-jobs");
    }
  };
  // 공고 직접 입력 → analysis 화면 (빈 입력 form)
  const goToManual = () => {
    const continuingManual = analysisFrom === "manual" && !selectedJob;
    if (!continuingManual) {
      resetAnalysis();
      setSelectedJob(null);
      setKeyword("");
      setJobPosting("");
      setManualTitle("");
      setFormOpen(true);
    } else if (!result) {
      setFormOpen(true);
    }
    setAnalysisFrom("manual");
    switchView("analysis", 0);
  };

  // 검색 결과/비교표에서 고른 공고 → analysis 화면
  // 공고 내용은 입력칸에 채워 두고, OpenRouter 요청은 사용자가 분석 버튼을 눌러야 보낸다
  const handleSelectJob = (job, from = "search") => {
    if (selectedJob?.id !== job.id || analysisFrom === "manual") {
      resetAnalysis();
      setSelectedJob(job);
      setKeyword((job.keywords ?? []).join(", "));
      setJobPosting(`공고명: ${job.title}\n회사명: ${job.company}\n\n${job.description ?? ""}`.trim());
    }
    setAnalysisFrom(from);
    setFormOpen(false);
    switchView("analysis", 0);
  };

  const toggleInterest = (item) => {
    setInterests((prev) =>
      prev.includes(item) ? prev.filter((v) => v !== item) : [...prev, item]
    );
  };

  const handleSubmit = async (e) => {
    // form 기본 submit(페이지 새로고침)으로 입력값이 초기화되지 않도록 막는다
    e?.preventDefault();
    if (loading) return;

    if (!jobPosting.trim()) {
      setError("분석할 채용공고 내용을 입력해 주세요.");
      return;
    }

    const runId = analysisRunId.current;
    const postingSent = jobPosting;
    setError("");
    setAiFail("");
    setLoading(true);
    try {
      const res = await fetch("/api/analyze-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interests, keyword, jobPosting }),
      });
      const data = await res.json().catch(() => null);
      if (runId !== analysisRunId.current) return;
      if (!res.ok || !data?.result) {
        // 400: 입력 문제(내용 없음·너무 김) → 그대로 안내. 그 외: AI 분석만 실패 (내부 원인은 노출하지 않음)
        if (res.status === 400 && data?.error) setError(data.error);
        else setAiFail("failed");
        return;
      }
      setResult(data.result);
      setResultPosting(postingSent);
      setFormOpen(false);
      setEvidenceOpen(false);
      requestAnimationFrame(() => {
        resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch {
      if (runId !== analysisRunId.current) return;
      setAiFail("network");
    } finally {
      if (runId === analysisRunId.current) setLoading(false);
    }
  };

  const showForm = formOpen;
  // 화면에 보이는 공고 제목: 원본 공고 title → 사용자가 입력한 제목 → AI jobTitle 순
  // (AI jobTitle이 원본 제목을 덮어쓰지 않도록)
  const aiJobTitle = result && result.jobTitle && result.jobTitle !== "없음" ? result.jobTitle : "";
  const displayTitle =
    (!isManual && selectedJob?.title) ||
    (isManual && manualTitle.trim()) ||
    aiJobTitle ||
    "직무명 확인 어려움";
  const resultTags = result ? [...interests, ...(keyword.trim() ? [keyword.trim()] : [])] : [];
  // 접힌 "분석할 공고"에 보여줄 이름
  const postingLabel =
    (!isManual && selectedJob?.title) ||
    (isManual && manualTitle.trim()) ||
    (result ? displayTitle : jobPosting.trim().split("\n")[0]?.slice(0, 60)) ||
    "아직 입력한 공고가 없어요";

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.topbarInner}>
          <span className={styles.logo}>Career Radar</span>
          <div className={styles.topbarRight}>
            {/* 기존 선택 개수만 보조로 표시 (search 화면, PC에서만) */}
            {view === "search" && compareJobs.length > 0 && (
              <span className={styles.headerMeta}>
                비교 선택 <strong>{compareJobs.length}개</strong>
              </span>
            )}
            <nav className={styles.nav} aria-label="주요 메뉴">
              <button
                type="button"
                className={`${styles.navItem} ${view === "search" ? styles.navItemActive : ""}`}
                aria-current={view === "search" ? "page" : undefined}
                onClick={goToSearch}
              >
                공고 찾기
              </button>
              <button
                type="button"
                className={`${styles.navItem} ${isCompareView ? styles.navItemActive : ""}`}
                aria-current={isCompareView ? "page" : undefined}
                onClick={goToCompare}
              >
                공고 비교
                {compareJobs.length > 0 && (
                  <span className={styles.navBadge}>{compareJobs.length}</span>
                )}
              </button>
              <button
                type="button"
                className={`${styles.navItem} ${view === "analysis" && isManual ? styles.navItemActive : ""}`}
                aria-current={view === "analysis" && isManual ? "page" : undefined}
                onClick={goToManual}
              >
                공고 직접 입력
              </button>
            </nav>
          </div>
        </div>
      </header>

      {/* 복원 전에는 숨겨서 초기 화면이 잠깐 보였다 바뀌는 현상을 막는다 (SSR과 동일한 마크업 유지) */}
      <main className={styles.container} style={restored ? undefined : { visibility: "hidden" }}>
        {/* ① search: 공고를 찾고 고르는 화면 (숨기기만 해서 검색어·필터·결과 유지) */}
        <div hidden={view !== "search"}>
          <section className={styles.hero}>
            <h1 className={styles.heroTitle}>
              채용공고, 제목보다 <br className={styles.mobileBreak} />
              실제 일을 먼저 보세요.
            </h1>
            <p className={styles.heroDesc}>
              실제 공고를 구조화하고, AI 해석의 원문 근거까지 함께 확인해보세요.
            </p>
          </section>

          <JobSearch
            key={searchMountKey}
            initial={initialSearch}
            persist={restored}
            onResultCount={setResultCount}
            selectedJobId={selectedJob?.id}
            compareIds={compareJobs.map((j) => j.id)}
            onToggleCompare={toggleCompare}
            onAnalyze={(job) => handleSelectJob(job, "search")}
          />

          <p className={styles.manualToggle}>
            <span className={styles.manualToggleText}>원하는 공고가 없나요?</span>
            <button type="button" className={styles.textButton} onClick={goToManual}>
              공고 직접 입력하기 <span aria-hidden="true">→</span>
            </button>
          </p>

          <p className={styles.intro}>
            Career Radar는 직업을 추천하기보다, 실제 채용공고를 바탕으로 직무의 차이를
            이해하도록 돕는 것을 목표로 합니다.
          </p>
        </div>

        {/* ② compare: 고른 공고 비교 (분석하러 갔다 와도 AI 비교 결과 유지되도록 숨기기만) */}
        {canCompare && (
          <div hidden={!isCompareView}>
            <CompareView
              jobs={compareJobs}
              active={isCompareView}
              savedSummary={currentCompareSummary}
              onSummary={(ids, summary) => setCompareSummary({ ids, summary })}
              onAnalyze={(job) => handleSelectJob(job, "compare")}
              onBack={backToList}
            />
          </div>
        )}

        {/* ③ analysis: 공고 1개 분석 (검색 공고 / 직접 입력 두 가지 진입) */}
        {view === "analysis" && (
          <div className={styles.analysisView}>
            <button type="button" className={styles.backButton} onClick={backFromAnalysis}>
              <span aria-hidden="true">←</span>{" "}
              {analysisFrom === "compare" && canCompare ? "공고 비교로" : "공고 목록으로"}
            </button>

            <header className={styles.viewHead}>
              {isManual ? (
                <>
                  <h1 className={styles.viewTitle}>공고 직접 입력</h1>
                  <p className={styles.viewDesc}>
                    검색 결과에 없는 채용공고도 직접 붙여넣어 분석할 수 있어요.
                  </p>
                </>
              ) : (
                <>
                  <h1 className={styles.viewEyebrow}>공고 분석</h1>
                  <p className={styles.viewCompany}>{selectedJob.company}</p>
                  <p className={styles.viewJobTitle}>{selectedJob.title}</p>
                  {(() => {
                    const meta = [
                      selectedJob.employmentType,
                      selectedJob.career,
                      selectedJob.location,
                      selectedJob.deadline,
                    ].filter(Boolean);
                    return meta.length > 0 ? (
                      <p className={styles.viewMeta}>
                        {meta.map((m, i) => (
                          <span key={i}>{m}</span>
                        ))}
                      </p>
                    ) : null;
                  })()}
                  {selectedJob.originalUrl && (
                    <a
                      className={styles.linkButton}
                      href={selectedJob.originalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      원문 공고 보기 <span aria-hidden="true">↗</span>
                    </a>
                  )}
                </>
              )}
            </header>

            <section
              className={`${styles.analyze} ${showForm ? "" : styles.analyzeCollapsed}`}
              aria-labelledby="analyze-title"
              ref={analyzeRef}
            >
              <div className={styles.analyzeHead}>
                <div className={styles.analyzeHeadText}>
                  <h2 id="analyze-title" className={styles.analyzeTitle}>
                    분석할 공고
                  </h2>
                  {/* 검색 공고는 위에 제목이 이미 있으므로 접힌 상태에서 제목을 반복하지 않음 */}
                  {!showForm && isManual && (
                    <p className={styles.collapsedPreview}>{postingLabel}</p>
                  )}
                </div>
                <button
                  type="button"
                  className={styles.textButton}
                  aria-expanded={formOpen}
                  aria-controls="analyze-form"
                  onClick={() => setFormOpen((v) => !v)}
                >
                  {formOpen ? "접기" : "분석할 공고 수정하기"}
                  <Chevron open={formOpen} />
                </button>
              </div>

              {/* 입력 영역이 접혀 있고 아직 결과가 없으면, 바로 분석할 수 있는 버튼만 */}
              {!showForm && !result && (
                <div className={styles.collapsedActions}>
                  {error && (
                    <p className={styles.error} role="alert">
                      {error}
                    </p>
                  )}
                  {aiFail && !loading && <AiFailNotice kind={aiFail} isManual={isManual} />}
                  <button
                    type="button"
                    className={styles.submit}
                    disabled={loading}
                    onClick={handleSubmit}
                  >
                    {loading ? "채용공고 분석 중..." : aiFail ? "다시 시도하기" : "채용공고 분석하기"}
                  </button>
                </div>
              )}

              {showForm && (
                <form id="analyze-form" className={styles.form} onSubmit={handleSubmit}>
                  {selectedJob && (
                    <p className={styles.loadedNotice}>
                      <strong>{selectedJob.company}</strong> · {selectedJob.title} 공고를 불러왔어요.
                      내용을 확인한 뒤 아래 분석 버튼을 눌러 주세요.
                    </p>
                  )}

                  <div className={styles.field}>
                    <span className={styles.label} id="interest-label">
                      관심 분야 <span className={styles.labelHint}>여러 개 선택 가능</span>
                    </span>
                    <div className={styles.options} role="group" aria-labelledby="interest-label">
                      {INTERESTS.map((item) => (
                        <button
                          key={item}
                          type="button"
                          aria-pressed={interests.includes(item)}
                          className={`${styles.option} ${interests.includes(item) ? styles.optionActive : ""}`}
                          onClick={() => toggleInterest(item)}
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="keyword">
                      궁금한 직무나 키워드 <span className={styles.labelHint}>선택</span>
                    </label>
                    <input
                      id="keyword"
                      className={styles.input}
                      value={keyword}
                      onChange={(e) => setKeyword(e.target.value)}
                      placeholder="예: CRM, 그로스 마케팅, 서비스 기획"
                    />
                    <p className={styles.help}>
                      정확한 직무명을 몰라도 괜찮아요. 아는 단어만 적어도 됩니다.
                    </p>
                  </div>

                  {isManual && (
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor="manual-title">
                        공고 제목 또는 직무명 <span className={styles.labelHint}>선택</span>
                      </label>
                      <input
                        id="manual-title"
                        className={styles.input}
                        value={manualTitle}
                        onChange={(e) => setManualTitle(e.target.value.slice(0, 100))}
                        placeholder="예: CRM 마케팅 어시스턴트"
                      />
                      <p className={styles.help}>
                        적어 주시면 분석 결과 제목으로 그대로 사용해요. 비워 두면 공고 내용에서 찾아요.
                      </p>
                    </div>
                  )}

                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="posting">
                      채용공고 내용
                    </label>
                    <textarea
                      id="posting"
                      className={styles.textarea}
                      rows={6}
                      value={jobPosting}
                      onChange={(e) => setJobPosting(e.target.value)}
                      placeholder={JOB_POSTING_PLACEHOLDER}
                    />
                    <p className={styles.help}>
                      분석하고 싶은 채용공고의 주요 업무, 자격요건, 우대사항 등을 붙여넣어 주세요.
                    </p>
                  </div>

                  {error && (
                    <p className={styles.error} role="alert">
                      {error}
                    </p>
                  )}
                  {aiFail && !loading && <AiFailNotice kind={aiFail} isManual={isManual} />}

                  <button
                    type="button"
                    className={styles.submit}
                    disabled={loading}
                    onClick={handleSubmit}
                  >
                    {loading ? "채용공고 분석 중..." : aiFail ? "다시 시도하기" : "채용공고 분석하기"}
                  </button>
                </form>
              )}
            </section>

            {result && (
              <article className={styles.result} ref={resultRef} aria-live="polite">
                <header className={`${styles.resultHead} ${isManual ? "" : styles.resultHeadCompact}`}>
                  {/* 공고 제목은 화면 상단에 한 번만. 직접 입력일 때만 여기서 제목 표시 */}
                  {isManual && (
                    <>
                      <p className={styles.resultEyebrow}>분석 결과</p>
                      <h2 className={styles.jobTitle}>{displayTitle}</h2>
                    </>
                  )}
                  {resultTags.length > 0 && (
                    <ul className={styles.metaTags}>
                      {resultTags.map((t, i) => (
                        <li key={i}>{t}</li>
                      ))}
                    </ul>
                  )}
                  <p className={styles.legend}>
                    <span>
                      <SourceMark /> 공고에 적힌 내용을 그대로 정리
                    </span>
                    <span>
                      <AiMark /> 공고를 바탕으로 AI가 해석
                    </span>
                  </p>
                </header>

                <Section title="30초 만에 이해하기" mark={<AiMark />} className={styles.sectionLead}>
                  {result.simpleExplanation ? (
                    <p className={styles.lead}>{result.simpleExplanation}</p>
                  ) : (
                    <p className={styles.empty}>{EMPTY_TEXT}</p>
                  )}

                  {result.explanationEvidence?.length > 0 ? (
                    <>
                      <button
                        type="button"
                        className={styles.textButton}
                        aria-expanded={evidenceOpen}
                        aria-controls="evidence"
                        onClick={() => setEvidenceOpen((v) => !v)}
                      >
                        왜 이렇게 해석했나요?
                        <Chevron open={evidenceOpen} />
                      </button>
                      {evidenceOpen && (
                        <div id="evidence" className={styles.evidence}>
                          <p className={styles.evidenceTitle}>공고 원문 근거</p>
                          {result.explanationEvidence.map((t, i) => (
                            <blockquote key={i} className={styles.quote}>
                              {t}
                            </blockquote>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <p className={styles.muted}>이 해석과 바로 연결되는 원문 문장은 찾지 못했어요.</p>
                  )}
                </Section>

                <Section title="실제로 하게 될 일" mark={<SourceMark />}>
                  <TextList items={result.actualTasks} />
                </Section>

                <Section title="지원 조건" mark={<SourceMark />} className={styles.sectionBreak}>
                  <div className={styles.conditions}>
                    <div className={styles.condCol}>
                      <h4 className={styles.condTitle}>필수 조건</h4>
                      <TextList items={result.required} />
                    </div>
                    <div className={styles.condCol}>
                      <h4 className={styles.condTitle}>우대 조건</h4>
                      <TextList items={result.preferred} />
                    </div>
                  </div>
                </Section>

                <Section title="핵심 업무·역량 키워드" mark={<AiMark />}>
                  <SkillChips skills={result.skills} />
                </Section>

                {result.similarRoles.length > 0 && (
                  <Section
                    title="비슷한 직무와 뭐가 다를까?"
                    mark={<AiMark />}
                    className={styles.sectionBreak}
                  >
                    <p className={styles.muted}>
                      아래 내용은 공고의 업무 내용을 바탕으로 AI가 비교한 참고 정보예요.
                    </p>
                    <dl className={styles.roles}>
                      {result.similarRoles.map((r, i) => (
                        <div key={i} className={styles.role}>
                          <dt>{r.name}</dt>
                          {r.difference && <dd>{r.difference}</dd>}
                        </div>
                      ))}
                    </dl>
                  </Section>
                )}

                <Section title="확인하고 지원하세요">
                  <p className={styles.checkIntro}>
                    <InfoIcon />
                    공고에 없는 내용이라 지원 전에 확인해 보면 좋아요.
                  </p>
                  <CheckPoints points={result.unclearPoints} />
                </Section>
              </article>
            )}
          </div>
        )}
      </main>

      {view === "analysis" && result && (
        <footer className={styles.footer}>
          <div className={styles.footerInner}>
            <p>
              AI가 붙여넣은 공고 내용만 바탕으로 정리한 결과예요. 지원 전에는 원문 공고를 꼭 함께
              확인해 주세요.
            </p>
          </div>
        </footer>
      )}

      {/* 하단 선택 바는 search 화면에서만 (compare·analysis에서는 숨김, 선택 상태는 유지) */}
      {view === "search" && compareJobs.length > 0 && (
        <>
          {/* 고정 비교 바가 페이지 마지막 내용을 가리지 않도록 여백 확보 */}
          <div className={styles.barSpacer} aria-hidden="true" />
          <CompareBar
            jobs={compareJobs}
            notice={compareNotice}
            fromPreviousSearch={resultCount === 0}
            onRemove={toggleCompare}
            onClear={clearCompare}
            onCompare={openCompare}
          />
        </>
      )}
    </div>
  );
}
