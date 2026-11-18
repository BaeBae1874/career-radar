#!/usr/bin/env bash
# Career Radar 개발 서버 자동 재시작 (개발 환경 전용)
#
# - `npm run dev -- -p 3016`을 실행하고, 종료되면 종료 코드·시각을 ~/career-radar-dev.log에 남긴 뒤 2초 후 다시 실행
# - Ctrl+C / tmux 세션 종료(SIGHUP) / SIGTERM을 받으면 서버를 정리하고 멈춘다 (다시 실행하지 않음)
# - 3016 포트를 다른 프로세스가 쓰고 있으면 새로 띄우지 않고 기다린다 (중복 실행 방지)
# - 짧은 시간 안에 연달아 실패하면(설정 오류 등) 무한 재시작 대신 멈춘다
# - 이 스크립트가 띄운 프로세스 그룹만 정리한다. 다른 프로젝트·포트의 프로세스는 건드리지 않는다.
#
# 사용: tmux career-radar 창에서  bash scripts/dev-keepalive.sh

set -u
set -m # 백그라운드 작업을 별도 프로세스 그룹으로 → 이 스크립트가 띄운 npm/next만 한 번에 정리

PORT=3016
RESTART_DELAY=2
LOG_FILE="${HOME}/career-radar-dev.log"
QUICK_FAIL_SECONDS=15 # 이보다 빨리 끝나면 "바로 실패"로 센다
MAX_QUICK_FAILS=5     # 연속 바로 실패 횟수가 이만큼이면 멈춤
PORT_WAIT_SECONDS=5

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR" || exit 1

child_pid=""
stopping=0

log() {
  local line
  line="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
  echo "$line"
  echo "$line" >>"$LOG_FILE"
}

# 종료 코드 설명: 128+N은 시그널 N으로 종료 (예: 143 = SIGTERM, 137 = SIGKILL, 130 = SIGINT)
describe_exit() {
  local code=$1
  if ((code > 128 && code < 160)); then
    local sig
    sig=$(kill -l $((code - 128)) 2>/dev/null || echo "?")
    echo "code=${code} (signal ${sig})"
  else
    echo "code=${code}"
  fi
}

port_in_use() {
  ss -ltnH "sport = :${PORT}" 2>/dev/null | grep -q .
}

stop_child() {
  [[ -z "$child_pid" ]] && return
  if kill -0 "$child_pid" 2>/dev/null; then
    # 이 스크립트가 만든 프로세스 그룹(npm → next)에만 신호
    kill -TERM -- "-${child_pid}" 2>/dev/null
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      kill -0 "$child_pid" 2>/dev/null || break
      sleep 0.5
    done
    kill -0 "$child_pid" 2>/dev/null && kill -KILL -- "-${child_pid}" 2>/dev/null
  fi
  wait "$child_pid" 2>/dev/null
  child_pid=""
}

on_signal() {
  local sig=$1
  ((stopping)) && return
  stopping=1
  log "keepalive: ${sig} 받음 → 개발 서버를 정리하고 멈춥니다."
  stop_child
  log "keepalive: 종료"
  exit 0
}

trap 'on_signal SIGINT' INT
trap 'on_signal SIGTERM' TERM
trap 'on_signal SIGHUP' HUP

log "keepalive: 시작 (dir=${PROJECT_DIR}, port=${PORT}, log=${LOG_FILE})"

quick_fails=0
while ((!stopping)); do
  if port_in_use; then
    log "keepalive: ${PORT} 포트를 이미 다른 프로세스가 사용 중 → ${PORT_WAIT_SECONDS}초 후 다시 확인 (새로 띄우지 않음)"
    sleep "$PORT_WAIT_SECONDS" &
    wait $! 2>/dev/null
    continue
  fi

  started_at=$(date +%s)
  npm run dev -- -p "$PORT" &
  child_pid=$!
  log "keepalive: 개발 서버 시작 (pid=${child_pid})"

  # wait는 시그널이 오면 바로 돌아오므로 trap이 즉시 실행된다
  wait "$child_pid"
  code=$?
  child_pid=""
  ((stopping)) && break

  ran=$(($(date +%s) - started_at))
  log "SERVER EXIT $(describe_exit "$code") after ${ran}s"

  if ((ran < QUICK_FAIL_SECONDS)); then
    quick_fails=$((quick_fails + 1))
  else
    quick_fails=0
  fi
  if ((quick_fails >= MAX_QUICK_FAILS)); then
    log "keepalive: ${MAX_QUICK_FAILS}번 연속으로 ${QUICK_FAIL_SECONDS}초 안에 종료됨 → 자동 재시작을 멈춥니다. 오류를 확인해 주세요."
    exit 1
  fi

  log "keepalive: ${RESTART_DELAY}초 후 다시 시작"
  sleep "$RESTART_DELAY" &
  wait $! 2>/dev/null
done
