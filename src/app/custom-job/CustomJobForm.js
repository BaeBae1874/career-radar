"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "../page.module.css";
import { buildLoginHref } from "@/lib/savedJobs";
import { LIMITS, PREVIEW_EMPTY_HINT, fromPreviewEdit, isValidDateInput, toPreviewEdit } from "@/lib/customJobs";
import { useSavedJobs } from "../savedJobsStore";
import { setHomeView } from "../SiteNav";
import {
  addJobToCompare,
  clearCustomDraft,
  loadCustomDraft,
  saveCustomDraft,
  writeAnalyzeIntent,
} from "../savedIntent";

const AI_FAIL = "공고 내용을 정리하지 못했어요. 입력한 내용은 그대로 유지돼요. 다시 시도해 주세요.";

// 미리보기 편집 변환·빈 칸 안내는 lib/customJobs (테스트 공용)
const toEdit = toPreviewEdit;
const fromEdit = fromPreviewEdit;

/**
 * 공고 직접 추가: 붙여넣기 → AI로 정리(미리보기·수정) → 내 공고에 추가
 * - 입력과 정리 결과는 sessionStorage에도 보관 → 로그인하러 다녀와도·새로고침해도 다시 붙여넣지 않음
 * - AI 정리가 실패해도 입력은 그대로 (화면 상태를 지우지 않음)
 * - 저장은 정리된 사실 데이터만 (붙여넣은 원문은 이번 세션의 분석에만 사용)
 */
export default function CustomJobForm() {
  const router = useRouter();
  const { auth } = useSavedJobs([]);
  const [company, setCompany] = useState("");
  const [title, setTitle] = useState("");
  const [posting, setPosting] = useState("");
  const [edit, setEdit] = useState(null); // 정리 결과 (null = 아직 정리 전)
  const [structuring, setStructuring] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(""); // 입력 확인 등 사용자가 고칠 수 있는 오류
  const [aiFailed, setAiFailed] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedItem, setSavedItem] = useState(null);
  const [compareNote, setCompareNote] = useState("");
  const [restored, setRestored] = useState(false);
  const previewRef = useRef(null);

  // 처음 한 번: 보관해 둔 입력 복원 (로그인 후 돌아온 경우 등)
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      const draft = loadCustomDraft();
      if (draft) {
        setCompany(draft.company);
        setTitle(draft.title);
        setPosting(draft.posting);
        if (draft.structured) setEdit(toEdit(draft.structured));
      }
      setRestored(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 입력·정리 결과가 바뀔 때마다 보관 (저장을 마친 뒤에는 보관하지 않음)
  useEffect(() => {
    if (!restored || savedItem) return;
    saveCustomDraft({ company, title, posting, structured: edit ? fromEdit(edit) : null });
  }, [restored, savedItem, company, title, posting, edit]);

  const handleStructure = async (e) => {
    e?.preventDefault();
    if (structuring) return;
    setError("");
    setAiFailed(false);
    if (!company.trim()) return setError("회사명을 입력해 주세요.");
    if (!title.trim()) return setError("공고명을 입력해 주세요.");
    if (posting.trim().length < 20) return setError("공고 내용을 붙여넣어 주세요.");
    setStructuring(true);
    try {
      const res = await fetch("/api/custom-jobs/structure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, title, posting }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.result) {
        setEdit(toEdit(data.result));
        requestAnimationFrame(() => previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
        return;
      }
      // 400: 입력 문제(길이 등)는 그대로 안내, 그 밖은 짧은 안내만 (원인 노출 없음)
      if (res.status === 400 && data?.error) setError(data.error);
      else setAiFailed(true);
    } catch {
      setAiFailed(true);
    } finally {
      setStructuring(false);
    }
  };

  const handleSave = async () => {
    if (saving || !edit) return;
    setSaveError("");
    if (!isValidDateInput(edit.applicationStartDate) || !isValidDateInput(edit.applicationEndDate)) {
      setSaveError("모집 날짜는 2026-12-02 형식으로 적어 주세요.");
      return;
    }
    const job = { company, title, ...fromEdit(edit) };
    if (!job.tasks.length && !job.required.length && !job.preferred.length) {
      setSaveError("실제로 하게 될 일이나 지원 조건을 한 가지 이상 넣어 주세요.");
      return;
    }
    if (auth === "guest") {
      router.push(buildLoginHref("/custom-job")); // 입력은 sessionStorage에 보관돼 있음
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/custom-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job }),
      });
      if (res.status === 401) {
        router.push(buildLoginHref("/custom-job"));
        return;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.item) {
        setSaveError(data?.error && res.status === 400 ? data.error : "저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
        return;
      }
      clearCustomDraft();
      setSavedItem(data.item);
    } catch {
      setSaveError("서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  };

  // 저장 후: 이번 세션에서 붙여넣은 원문으로 분석 (원문은 DB가 아니라 sessionStorage에만)
  const analyzeSaved = () => {
    if (!savedItem || !writeAnalyzeIntent(savedItem.job, { description: posting })) return;
    router.push("/");
  };

  const compareSaved = () => {
    if (!savedItem) return;
    const r = addJobToCompare(savedItem.job);
    setCompareNote(
      r.status === "added"
        ? `비교에 담았어요 (${r.count}/3).`
        : r.status === "already"
          ? "이미 비교에 담겨 있어요."
          : r.status === "full"
            ? "비교는 최대 3개까지 담을 수 있어요."
            : "비교에 담지 못했어요."
    );
  };

  const goCompare = () => {
    setHomeView("compare");
    router.push("/");
  };

  const startOver = () => {
    clearCustomDraft();
    setCompany("");
    setTitle("");
    setPosting("");
    setEdit(null);
    setSavedItem(null);
    setCompareNote("");
    setError("");
    setAiFailed(false);
    setSaveError("");
  };

  const setField = (key) => (e) => setEdit((prev) => ({ ...prev, [key]: e.target.value }));

  if (savedItem) {
    return (
      <section className={styles.analyze} aria-live="polite">
        <p className={styles.loadedNotice}>
          <strong>{savedItem.job.company}</strong> · {savedItem.job.title} 공고를 내 공고에 추가했어요.
        </p>
        <div className={styles.failActions}>
          <button type="button" className={styles.failAction} onClick={analyzeSaved}>
            공고 분석
          </button>
          <button type="button" className={styles.failAction} onClick={compareSaved}>
            비교에 담기
          </button>
          <Link href="/saved?tab=custom" className={styles.failAction}>
            저장함에서 보기
          </Link>
          <button type="button" className={styles.failAction} onClick={startOver}>
            다른 공고 추가
          </button>
        </div>
        {compareNote && (
          <p className={styles.help} role="status">
            {compareNote}{" "}
            {compareNote.startsWith("비교에 담았어요") || compareNote.startsWith("이미") ? (
              <button type="button" className={styles.textButton} onClick={goCompare}>
                비교하러 가기
              </button>
            ) : null}
          </p>
        )}
      </section>
    );
  }

  return (
    <>
      <section className={styles.analyze} aria-labelledby="custom-input-title">
        <h2 id="custom-input-title" className={styles.analyzeTitle}>
          붙여넣을 공고
        </h2>
        <form className={styles.form} onSubmit={handleStructure}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="custom-company">
              회사명
            </label>
            <input
              id="custom-company"
              className={styles.input}
              value={company}
              maxLength={LIMITS.company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="예: 오렌지커머스"
              autoComplete="off"
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="custom-title">
              공고명
            </label>
            <input
              id="custom-title"
              className={styles.input}
              value={title}
              maxLength={LIMITS.title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: CRM 마케팅 인턴"
              autoComplete="off"
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="custom-posting">
              공고 내용
            </label>
            <textarea
              id="custom-posting"
              className={styles.textarea}
              rows={10}
              value={posting}
              maxLength={LIMITS.posting}
              onChange={(e) => setPosting(e.target.value)}
              placeholder="채용사이트에서 주요 업무, 자격요건, 우대사항 등을 복사해 붙여넣어 주세요."
            />
            <p className={styles.help}>
              링크가 아니라 공고 본문을 붙여넣어 주세요. (최대 {LIMITS.posting.toLocaleString()}자)
            </p>
          </div>

          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          {aiFailed && !structuring && (
            <div className={styles.aiFail} role="status">
              <p className={styles.aiFailTitle}>{AI_FAIL}</p>
            </div>
          )}

          <button type="submit" className={styles.submit} disabled={structuring}>
            {structuring ? "공고 내용 정리 중..." : edit ? "다시 정리하기" : "공고 내용 정리하기"}
          </button>
        </form>
      </section>

      {edit && (
        <article className={styles.result} ref={previewRef} aria-labelledby="custom-preview-title">
          <header className={`${styles.resultHead} ${styles.resultHeadCompact}`}>
            <h2 id="custom-preview-title" className={styles.analyzeTitle}>
              정리된 공고 확인
            </h2>
            <p className={styles.help}>
              AI가 공고 본문에서 옮겨 적은 내용이에요. 틀리거나 빠진 부분은 고친 뒤 추가해 주세요. 목록은 한 줄에 하나씩
              적어요.
            </p>
          </header>

          <div className={styles.form}>
            <div className={styles.field}>
              <span className={styles.label}>기본 조건</span>
              <div className={styles.conditions}>
                <div className={styles.condCol}>
                  <label className={styles.condTitle} htmlFor="custom-employment">
                    근무형태
                  </label>
                  <input id="custom-employment" className={styles.input} value={edit.employmentType} onChange={setField("employmentType")} placeholder={PREVIEW_EMPTY_HINT} />
                  <label className={styles.condTitle} htmlFor="custom-career">
                    경력
                  </label>
                  <input id="custom-career" className={styles.input} value={edit.career} onChange={setField("career")} placeholder={PREVIEW_EMPTY_HINT} />
                </div>
                <div className={styles.condCol}>
                  <label className={styles.condTitle} htmlFor="custom-location">
                    지역
                  </label>
                  <input id="custom-location" className={styles.input} value={edit.location} onChange={setField("location")} placeholder={PREVIEW_EMPTY_HINT} />
                  <label className={styles.condTitle} htmlFor="custom-close-type">
                    마감 방식
                  </label>
                  <select id="custom-close-type" className={styles.input} value={edit.closeType} onChange={setField("closeType")}>
                    <option value="">공고에서 확인되지 않았어요</option>
                    <option value="deadline">접수 마감일</option>
                    <option value="rolling">채용시 마감</option>
                    <option value="always">상시채용</option>
                    <option value="occasional">수시채용</option>
                  </select>
                </div>
              </div>
            </div>

            {/* 모집 일정(지원 접수)과 실제 근무기간은 서로 다른 정보 */}
            <div className={styles.field}>
              <span className={styles.label}>
                일정 <span className={styles.labelHint}>날짜는 2026-12-02 형식</span>
              </span>
              <div className={styles.conditions}>
                <div className={styles.condCol}>
                  <label className={styles.condTitle} htmlFor="custom-apply-start">
                    모집 시작
                  </label>
                  <input id="custom-apply-start" className={styles.input} value={edit.applicationStartDate} onChange={setField("applicationStartDate")} placeholder={PREVIEW_EMPTY_HINT} inputMode="numeric" />
                  <label className={styles.condTitle} htmlFor="custom-apply-end">
                    모집 마감
                  </label>
                  <input id="custom-apply-end" className={styles.input} value={edit.applicationEndDate} onChange={setField("applicationEndDate")} placeholder={PREVIEW_EMPTY_HINT} inputMode="numeric" />
                </div>
                <div className={styles.condCol}>
                  <label className={styles.condTitle} htmlFor="custom-work-period">
                    근무기간
                  </label>
                  <input id="custom-work-period" className={styles.input} value={edit.workPeriod} onChange={setField("workPeriod")} placeholder={PREVIEW_EMPTY_HINT} />
                </div>
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="custom-tasks">
                실제로 하게 될 일
              </label>
              <textarea id="custom-tasks" className={styles.textarea} rows={4} placeholder={PREVIEW_EMPTY_HINT} value={edit.tasks} onChange={setField("tasks")} />
            </div>

            <div className={styles.conditions}>
              <div className={`${styles.field} ${styles.condCol}`}>
                <label className={styles.label} htmlFor="custom-required">
                  필수 조건
                </label>
                <textarea id="custom-required" className={styles.textarea} rows={4} placeholder={PREVIEW_EMPTY_HINT} value={edit.required} onChange={setField("required")} />
              </div>
              <div className={`${styles.field} ${styles.condCol}`}>
                <label className={styles.label} htmlFor="custom-preferred">
                  우대 조건
                </label>
                <textarea id="custom-preferred" className={styles.textarea} rows={4} placeholder={PREVIEW_EMPTY_HINT} value={edit.preferred} onChange={setField("preferred")} />
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="custom-keywords">
                키워드 <span className={styles.labelHint}>쉼표로 구분</span>
              </label>
              <input id="custom-keywords" className={styles.input} value={edit.keywords} onChange={setField("keywords")} placeholder={PREVIEW_EMPTY_HINT} />
            </div>

            {saveError && (
              <p className={styles.error} role="alert">
                {saveError}
              </p>
            )}
            <button type="button" className={styles.submit} disabled={saving} onClick={handleSave}>
              {saving ? "추가하는 중..." : "내 공고에 추가"}
            </button>
            {auth === "guest" && <p className={styles.help}>추가하려면 로그인이 필요해요. 입력한 내용은 로그인 후에도 그대로 남아 있어요.</p>}
          </div>
        </article>
      )}
    </>
  );
}
