# AXP 주간 리듬 미팅

Supabase 실시간 공유 + GitHub Pages 호스팅용 정적 웹앱.

## 파일 구조
- `index.html` — 마크업
- `styles.css` — 스타일(Nothing 디자인, 라이트/다크)
- `app.js` — 로직(상태·Supabase 주차 DB·렌더·이벤트·드래그·모달·다크모드)
- `.claude/settings.json` — Claude Code 종료 시 자동 git 커밋·푸시 훅
- `.gitignore`

## 최초 설정 (한 번만)

1) GitHub 인증 (둘 중 하나)
```
gh auth login        # GitHub CLI 사용 (없으면: brew install gh)
```

2) 이 폴더를 기존 레포와 연결
```
cd rhythm-project
git init
git remote add origin https://github.com/rejoyful/rhythm.git
git branch -M main
git add -A && git commit -m "init: rhythm app"
git push -u origin main --force   # 기존 내용 덮어쓰기(최초 1회)
```
> 이미 레포를 clone해서 쓰는 경우엔 위 init/remote 단계는 건너뛰고 파일만 이 폴더에 복사.

3) GitHub Pages 확인: 레포 Settings → Pages → main / root.
   주소: https://rejoyful.github.io/rhythm/

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

## 주의
- Supabase **anon key**는 공개돼도 되는 키라 커밋 OK. service_role 키 등 비밀키는 절대 커밋 금지.
- 데이터는 Supabase `rhythm` 테이블에 주차별 레코드로 저장됨(코드/깃허브엔 데이터 없음).
