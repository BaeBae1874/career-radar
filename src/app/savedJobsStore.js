"use client";

import { useEffect, useSyncExternalStore } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { MAX_STATUS_IDS, normalizeJobIds, toSavedSnapshot } from "@/lib/savedJobs";

/**
 * 관심 공고 저장 상태 (브라우저 메모리, 탭 안에서 공유)
 * - 화면에 보이는 공고 id를 모아 /api/saved-jobs로 한 번에 조회 (공고마다 요청하지 않음)
 * - 이미 확인한 id는 다시 묻지 않는다
 * - 로그인/로그아웃/사용자 변경 시 비우고 다시 조회
 * 이 값은 화면 표시용일 뿐이고, 실제 권한은 서버(getClaims)와 RLS가 판단한다.
 */

const EMPTY = Object.freeze(new Set());
const SERVER_STATE = Object.freeze({ auth: "unknown", saved: EMPTY, known: EMPTY, pending: EMPTY });

let state = {
  auth: isSupabaseConfigured() ? "unknown" : "guest", // "unknown" | "guest" | "member"
  saved: new Set(),
  known: new Set(), // 저장 여부를 확인한 id
  pending: new Set(), // 저장/해제 요청 중인 id
};
let userId = null;
let generation = 0; // 사용자 바뀜 → 진행 중이던 조회 결과 버림
const inflight = new Set();
const listeners = new Set();
let authListening = false;

function setState(patch) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function resetFor(auth, nextUserId) {
  generation += 1;
  userId = nextUserId;
  inflight.clear();
  setState({ auth, saved: new Set(), known: new Set(), pending: new Set() });
}

function listenAuth() {
  if (authListening || typeof window === "undefined") return;
  authListening = true;
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return;
  supabase.auth.onAuthStateChange((_event, session) => {
    const nextId = session?.user?.id ?? null;
    const nextAuth = nextId ? "member" : "guest";
    if (nextAuth !== state.auth || nextId !== userId) resetFor(nextAuth, nextId);
  });
}

function subscribe(listener) {
  listenAuth();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => state;
const getServerSnapshot = () => SERVER_STATE;

/** 아직 확인하지 않은 id만 모아 한 번에 조회 */
async function ensureStatus(ids) {
  if (state.auth !== "member") return;
  const todo = normalizeJobIds(ids).filter((id) => !state.known.has(id) && !inflight.has(id));
  if (!todo.length) return;
  const gen = generation;
  for (let i = 0; i < todo.length; i += MAX_STATUS_IDS) {
    const chunk = todo.slice(i, i + MAX_STATUS_IDS);
    chunk.forEach((id) => inflight.add(id));
    const params = new URLSearchParams();
    chunk.forEach((id) => params.append("id", id));
    try {
      const res = await fetch(`/api/saved-jobs?${params}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (gen !== generation) return;
      if (!res.ok) continue; // 다음 화면 변경 때 다시 시도
      if (data?.authenticated === false) {
        resetFor("guest", null);
        return;
      }
      const savedIds = new Set(Array.isArray(data?.savedIds) ? data.savedIds : []);
      const saved = new Set(state.saved);
      const known = new Set(state.known);
      chunk.forEach((id) => {
        known.add(id);
        if (savedIds.has(id)) saved.add(id);
        else saved.delete(id);
      });
      setState({ saved, known });
    } catch {
      // 네트워크 오류: 표시만 "저장"으로 남고 다음 기회에 다시 조회
    } finally {
      if (gen === generation) chunk.forEach((id) => inflight.delete(id));
    }
  }
}

/** 저장함 화면처럼 서버가 이미 저장 목록을 준 경우: 조회 없이 저장됨으로 표시 */
export function seedSavedIds(ids) {
  const list = normalizeJobIds(ids);
  if (!list.length) return;
  const saved = new Set(state.saved);
  const known = new Set(state.known);
  list.forEach((id) => {
    saved.add(id);
    known.add(id);
  });
  setState({ saved, known, auth: state.auth === "unknown" ? "member" : state.auth });
}

/**
 * 저장 ↔ 해제. 화면은 먼저 바꾸고(optimistic), 실패하면 되돌린다.
 * @returns {Promise<"saved" | "unsaved" | "login" | "error" | "busy">}
 */
export async function toggleSavedJob(job) {
  const snapshot = toSavedSnapshot(job);
  if (!snapshot) return "error";
  const id = snapshot.id;
  if (state.auth === "guest") return "login";
  if (state.pending.has(id)) return "busy";

  const wasSaved = state.saved.has(id);
  const gen = generation;
  const apply = (isSaved, pendingOn) => {
    const saved = new Set(state.saved);
    const known = new Set(state.known);
    const pending = new Set(state.pending);
    if (isSaved) saved.add(id);
    else saved.delete(id);
    known.add(id);
    if (pendingOn) pending.add(id);
    else pending.delete(id);
    setState({ saved, known, pending });
  };
  apply(!wasSaved, true);

  try {
    const res = await fetch("/api/saved-jobs", {
      method: wasSaved ? "DELETE" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(wasSaved ? { jobId: id } : { job: snapshot }),
    });
    if (gen !== generation) return "error";
    if (res.status === 401) {
      resetFor("guest", null);
      return "login";
    }
    if (!res.ok) {
      apply(wasSaved, false);
      return "error";
    }
    apply(!wasSaved, false);
    return wasSaved ? "unsaved" : "saved";
  } catch {
    if (gen === generation) apply(wasSaved, false);
    return "error";
  }
}

/**
 * 화면에 보이는 공고들의 저장 상태. ids가 바뀔 때 확인하지 않은 것만 한 번에 조회
 * @param {string[]} ids
 */
export function useSavedJobs(ids) {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const key = (ids ?? []).join("\n");
  useEffect(() => {
    if (snap.auth !== "member" || !key) return;
    ensureStatus(key.split("\n"));
  }, [key, snap.auth]);
  return snap;
}
