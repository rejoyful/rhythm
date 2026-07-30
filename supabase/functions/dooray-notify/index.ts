// dooray-notify — 리듬에서 @멘션이 들어간 줄을 두레이 채팅방에 한 번만 전달한다.
//
// 브라우저는 "어느 주차 · 어느 항목 · 몇 번째 줄"이라는 좌표만 보낸다.
// 실제 문구는 이 함수가 DB 에서 직접 읽는다 — 그래야 누가 함수 주소를 알아내도
// 방에 아무 문구나 밀어 넣지 못한다.
//
// 필요한 환경변수(Supabase secrets):
//   DOORAY_TOKEN        업무 계정의 API 토큰
//   DOORAY_CHANNEL_ID   메시지를 보낼 대화방 ID
//   RHYTHM_URL          (선택) 메시지 끝에 붙일 리듬 주소
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DOORAY_TOKEN = Deno.env.get("DOORAY_TOKEN") ?? "";
const CHANNEL_ID = Deno.env.get("DOORAY_CHANNEL_ID") ?? "";
const RHYTHM_URL = Deno.env.get("RHYTHM_URL") ?? "https://rhythm.hakjisa.kr/";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// app.js 의 멘션·플래그 규칙과 같은 모양을 유지한다.
const MENTION = /@[A-Za-z0-9가-힣_]+/g;
const FLAG = /^(\s*(?:•\s*)?)#(목표|진행|성공|실패|보류|대기|이슈)(?=\s|$)/;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!DOORAY_TOKEN || !CHANNEL_ID) {
    return json({ error: "DOORAY_TOKEN · DOORAY_CHANNEL_ID 미설정" }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }

  const weekId = String(body.weekId ?? "");
  const taskId = String(body.taskId ?? "");
  const lineIndex = Number(body.lineIndex);
  if (!weekId || !taskId || !Number.isInteger(lineIndex) || lineIndex < 0) {
    return json({ error: "weekId · taskId · lineIndex 필요" }, 400);
  }

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: row, error } = await db
    .from("rhythm").select("data").eq("id", weekId).single();
  if (error || !row) return json({ error: "주차를 찾을 수 없음" }, 404);

  // deno-lint-ignore no-explicit-any
  const tasks: any[] = row.data?.tasks ?? [];
  const task = tasks.find((t) => t?.id === taskId);
  if (!task) return json({ skipped: "task-gone" });

  const lines = String(task.what ?? "").split("\n");
  const rawLine = lines[lineIndex];
  if (rawLine == null) return json({ skipped: "line-gone" });

  const line = rawLine.replace(FLAG, "$1").trim();
  const mentions = line.match(MENTION) ?? [];
  if (!mentions.length) return json({ skipped: "no-mention" });

  // 멱등성 — 먼저 자리를 잡는다. 이미 있으면(23505) 조용히 끝낸다.
  const key = `${taskId}|${lineIndex}`;
  const { error: logErr } = await db.from("rhythm_notify_log").insert({
    key,
    week_id: weekId,
    task_id: taskId,
    line_index: lineIndex,
    mentions: mentions.join(" "),
  });
  if (logErr) {
    if (logErr.code === "23505") return json({ skipped: "already-sent" });
    return json({ error: "발송 이력 기록 실패", detail: logErr.message }, 500);
  }

  const project = tasks.find((t) => t?.id === task.parent) ?? null;
  const projectName = String((project?.what ?? "").split("\n")[0] ?? "").trim();
  const division = String(project?.division ?? task.division ?? "").trim();
  const due = task.due && task.due !== "—" ? String(task.due) : "";

  // 이 API 는 마크다운을 해석하지 않는다(검증 완료) — 평문으로만 구성한다.
  const text = [
    ["[주간 리듬]", division, projectName].filter(Boolean).join(" · "),
    line,
    due ? `기한 ${due}` : "",
    RHYTHM_URL,
  ].filter(Boolean).join("\n");

  const res = await fetch(
    `https://api.dooray.com/messenger/v1/channels/${CHANNEL_ID}/logs`,
    {
      method: "POST",
      headers: {
        "Authorization": `dooray-api ${DOORAY_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    },
  );

  if (!res.ok) {
    // 발송이 실패했으면 자리를 도로 비워, 다음 기회에 다시 시도할 수 있게 한다.
    await db.from("rhythm_notify_log").delete().eq("key", key);
    return json(
      { error: "두레이 발송 실패", status: res.status, detail: await res.text() },
      502,
    );
  }

  return json({ sent: true, mentions });
});
