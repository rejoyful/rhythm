# 주간 리듬 미팅 (rhythm)

UX 기획파트의 주간 업무를 **프로젝트 + 히스토리**로 기록·공유하는 정적 웹앱.
Supabase 실시간 동기화 + GitHub Pages 호스팅으로, **서버 없이 브라우저만으로** 동작한다.

- 주소: https://rejoyful.github.io/rhythm/

## 무엇을 하는 앱인가
회의 때 큰 화면(윈도우·크롬)과 개인 모바일에서 함께 보며, 각자 수정하면 **모두의 화면에 실시간 반영**된다. 한 주가 끝나면 아카이빙하고 새 주차를 시작한다.

## 주요 기능
- **프로젝트 + 히스토리 구조** — 최상위 = 프로젝트, 그 아래 히스토리(한 일)를 계속 쌓는다. 드래그로 묶거나 `+ 히스토리`로 추가. 프로젝트는 **접기/펼치기** 가능(접힌 상태는 개인 설정).
- **부문(division)** — 출판 · 심리 · 교육 · 메디컬. 프로젝트 앞의 색상 칩을 클릭해 순환. 상단 필터(**데스크톱=칩 / 모바일=셀렉박스**)로 부문별 보기.
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
- `app.js` — 로직 전부(상태 · Supabase 주차 DB · 실시간 동기화 · 렌더 · 이벤트 · 드래그 · 스와이프 · 모달)
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

3) GitHub Pages 확인: 레포 Settings → Pages → main / root → https://rejoyful.github.io/rhythm/

## Claude Code로 작업하기
```
cd rhythm-project
claude
```
- 수정을 시키면 파일이 바뀌고, **턴이 끝날 때마다 `.claude/settings.json` 훅이 자동으로 커밋·푸시**한다.
- push되면 GitHub Pages가 1~2분 내 자동 반영된다.

## 수동 커밋이 필요할 때
```
git add -A && git commit -m "메모" && git push
```

## 보안 주의
- Supabase **anon(public) 키는 공개돼도 되는 키**라 커밋 OK(행 보안 RLS로 보호).
- **`service_role` 같은 비밀키는 절대 코드·저장소에 넣지 말 것.** 정적 페이지에선 안전하게 다룰 수 없고, 서버/서버리스에서만 써야 한다.
