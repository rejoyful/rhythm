-- 두레이 알림 발송 이력.
-- "한 줄당 딱 한 번만 알린다"를 보장하는 표. key 가 중복되면 발송을 건너뛴다.
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 한 번 실행하면 끝.

create table if not exists public.rhythm_notify_log (
  key         text primary key,          -- "{taskId}|{lineIndex}"
  week_id     text,
  task_id     text,
  line_index  int,
  mentions    text,
  sent_at     timestamptz not null default now()
);

-- 브라우저(anon 키)는 이 표에 손댈 수 없다.
-- 정책을 하나도 만들지 않으므로 RLS 가 전부 막고, Edge Function(service_role)만 통과한다.
alter table public.rhythm_notify_log enable row level security;
