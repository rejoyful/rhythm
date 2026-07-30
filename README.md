# 주간 리듬 미팅 (rhythm)

UX 기획파트의 주간 업무를 **프로젝트 + 히스토리**로 기록·공유하는 웹앱.
Supabase 실시간 동기화로 여러 사람이 동시에 편집해도 서로의 화면에 바로 반영된다.

- 주소: **https://rhythm.hakjisa.kr/**
- 배포: 이 저장소(`rejoyful/rhythm`)에 push → **팀 내부 수동 배포 시스템**이 최신 코드를 받아 배포한다.
  즉 push만으로 자동 반영되지 않고, **배포를 한 번 실행해야** 사이트에 나타난다.

## 무엇을 하는 앱인가
회의 때 큰 화면(윈도우·크롬)과 개인 모바일에서 함께 보며, 각자 수정하면 **모두의 화면에 실시간 반영**된다. 한 주가 끝나면 아카이빙하고 새 주차를 시작한다.

## 주요 기능
- **프로젝트 + 히스토리 구조** — 최상위 = 프로젝트, 그 아래 히스토리(한 일)를 계속 쌓는다. 드래그로 묶거나 `+ 히스토리`로 추가. 프로젝트는 **접기/펼치기** 가능(접힌 상태는 개인 설정).
- **부문(division)** — 출판 · 심리 · 교육 · 메디컬 · AX · 전사(전사 통합). 프로젝트 앞의 색상 칩을 클릭해 순환. 상단 필터(**데스크톱=칩 / 모바일=셀렉박스**)로 부문별 보기.
- **담당(owner)** — UX 파트 · 서비스 파트 · DEV 파트 · Edu 파트(기본 미정). 칩 클릭 순환. 모바일은 이니셜 아바타.
- **진행상태** — 진행중 · 완료 · 보류 · 이월 · 대기. 칩 클릭 순환(너비 통일).
- **진행률** — 10% 단위, 저조(빨강)→완료(초록) 색 램프. 히스토리는 각각, **프로젝트는 직접 입력**(하위 평균이 아님 — 완료분이 차주에 빠져 평균이 왜곡되는 걸 방지).
- **업무내용 강조** — `@이름` 멘션은 빨강 강조(표시 전용, 호출 아님), `http(s)://` 링크는 자동 하이퍼링크로 **새 창** 오픈.
- **주간 아카이빙** — `새 주차 시작`: 완료 항목은 지난 주 기록에 보관되고 사라지며, 미완료 항목만 진행률과 함께 다음 주로 이월. 상단 드롭다운으로 지난 주차 **열람(보기 전용)**.
- **반응형** — 데스크톱(≥1280px)은 표, 그 이하는 카드. 모바일은 **좌로 스와이프하면 삭제**.
- **다크모드** — 우측 상단 토글(개인 설정).

## 파일 구조
- `index.html` — 마크업(헤더 · 부문 필터 · 목록 · 추가 모달)
- `styles.css` — 스타일(모노 "Nothing" 디자인, 라이트/다크, 반응형)
- `app.js` — 로직 전부(상태 · Supabase 주차 DB · 실시간 동기화 · 렌더 · 이벤트 · 드래그 · 스와이프 · 모달 · 두레이 알림 큐)
- `supabase/schema/rhythm_notify_log.sql` — 두레이 알림 중복 방지 표(한 번만 실행)
- `supabase/functions/dooray-notify/` — 두레이로 실제 발송하는 Edge Function(토큰 보관처)
- `.claude/settings.json` — Claude Code 종료 시 자동 git 커밋·푸시 훅
- `.gitignore`

## 데이터가 저장되는 곳
- **공유 데이터**: Supabase `rhythm` 테이블에 **주차별 레코드**로 저장(코드·깃허브엔 데이터 없음). 실시간 구독으로 여러 사람이 동시에 편집해도 **항목 단위로 병합**돼 안 날아간다.
- **개인 설정**(localStorage, 내 브라우저에만): `axp_rhythm_v3`(로컬 캐시) · `axp_divfilter_v1`(부문 필터) · `axp_collapsed_v1`(프로젝트 접기) · `axp_theme`(라이트/다크).

## Supabase 설정값 위치
`.env` 파일은 **없다**. 정적 페이지라 브라우저가 `app.js`를 그대로 읽으므로 설정을 코드 상단(`app.js` 10~11줄)에 둔다.
```js
var SB_URL="https://....supabase.co";   // 프로젝트 URL
var SB_KEY="sb_publishable_...";          // anon(public) key
```

## 최초 설정 (한 번만)
1) GitHub 인증
```
gh auth login        # 없으면: brew install gh
```
2) 폴더를 레포와 연결
```
cd rhythm-project
git init
git remote add origin https://github.com/rejoyful/rhythm.git
git branch -M main
git add -A && git commit -m "init: rhythm app"
git push -u origin main --force   # 최초 1회만(덮어쓰기)
```
> 이미 clone해서 쓰는 경우엔 위 init/remote 단계는 건너뛴다.

3) 배포는 팀 내부 수동 배포 시스템에서 실행 → https://rhythm.hakjisa.kr/
   (GitHub Pages는 사용하지 않는다. `rejoyful.github.io/rhythm/` 는 더 이상 열리지 않음)

## Claude Code로 작업하기
```
cd rhythm-project
claude
```
- 수정을 시키면 파일이 바뀌고, **턴이 끝날 때마다 `.claude/settings.json` 훅이 자동으로 커밋·푸시**한다.
- 여기까지는 GitHub 저장소만 최신이 된다. 실제 사이트에 반영하려면 **수동 배포를 한 번 실행**해야 한다.

## 수동 커밋이 필요할 때
```
git add -A && git commit -m "메모" && git push
```

## 두레이 알림

업무내용에 `@이름` 을 적고 **그 칸에서 포커스가 빠지면**, 그 줄이 팀 두레이 대화방에 자동으로 전달된다.
보내는 주체는 팀 **업무 계정**이라 메시지에 그 계정 이름으로 뜬다.

- **한 줄당 딱 한 번만** 간다. 나중에 오타를 고치거나 문장을 다듬어도 다시 가지 않는다.
- 지난 주차를 **열람 중일 때는 보내지 않는다**(보기 전용).
- 두레이 API 는 마크다운도 멘션도 해석하지 않는다(검증 완료). `@이름` 은 **평문**으로 들어가며
  파란 멘션으로 걸리지 않는다 — 방 인원 전원이 어차피 방 알림을 받으므로 실사용엔 문제없다.
- 끄고 싶으면 `app.js` 의 `NOTIFY_FN` 을 `""` 로 바꾸면 된다.

### 최초 설정 (한 번만)

1) **표 만들기** — Supabase 대시보드 → SQL Editor 에 `supabase/schema/rhythm_notify_log.sql` 붙여넣고 실행.

2) **비밀값 등록** — 토큰은 코드·저장소에 절대 넣지 않는다. Supabase 에만 둔다.
```
supabase secrets set DOORAY_TOKEN=<업무계정 API 토큰>
supabase secrets set DOORAY_CHANNEL_ID=<대화방 ID>
```

3) **함수 배포**
```
supabase functions deploy dooray-notify
```

> `supabase` 명령이 없으면 `brew install supabase/tap/supabase` 후 `supabase login`,
> `supabase link --project-ref <프로젝트 ref>` 를 먼저 한다.
> 터미널이 부담스러우면 Supabase 대시보드의 **Edge Functions** 화면에서 코드를 붙여넣어 배포하고,
> **Settings → Edge Functions → Secrets** 에서 위 두 값을 넣어도 똑같다.

### 대화방 ID 를 다시 찾아야 할 때
```
curl -s -H "Authorization: dooray-api <업무계정 토큰>" https://api.dooray.com/messenger/v1/channels | jq '.result[] | {id, title}'
```

## 보안 주의
- Supabase **anon(public) 키는 공개돼도 되는 키**라 커밋 OK(행 보안 RLS로 보호).
- **`service_role` 같은 비밀키는 절대 코드·저장소에 넣지 말 것.** 정적 페이지에선 안전하게 다룰 수 없고, 서버/서버리스에서만 써야 한다.
- **두레이 업무계정 토큰도 같은 등급의 비밀키다.** 유출되면 그 계정 명의로 아무 메시지나 보낼 수 있다.
  `app.js` 에 넣지 말고 Supabase secrets 에만 두며, 브라우저는 `dooray-notify` 함수를 부를 뿐 토큰을 모른다.
  함수는 문구를 클라이언트에서 받지 않고 **DB 에서 직접 읽으므로**, 함수 주소를 알아내도 임의 문구를 방에 밀어 넣을 수 없다.
