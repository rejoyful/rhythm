/* =========================================================
   AXP 주간 리듬 미팅 — app.js
   구조: 설정 / 유틸 / 상태·정규화 / Supabase(주차 DB)
        / 셀 빌더 / 트리(그룹) / 렌더 / 이벤트 / 드래그
        / 과업추가 모달 / 불러오기 / 제목·붙여넣기 / 다크모드 / 초기화
   ========================================================= */
(function(){
  "use strict";
  // ===== Supabase 설정 (여기 두 줄만 채우면 팀 공유 활성화) =====
  var SB_URL="https://nbuxqkxbvygvzlfoezro.supabase.co";   // 예: https://xxxx.supabase.co
  var SB_KEY="sb_publishable_yx7HPeG_bJeXoYTz6RcqCA_IdhEKxZE";   // anon public key
  // ============================================================
  // 두레이 알림 — @멘션이 들어간 줄을 업무 계정 명의로 팀 대화방에 보낸다.
  // 토큰·대화방 ID 는 여기 없다(정적 페이지라 공개되므로). Supabase Edge Function 이 들고 있다.
  var NOTIFY_FN="dooray-notify";   // "" 로 두면 알림이 완전히 꺼진다.
  var CLIENT=Math.random().toString(36).slice(2);
  var sb=null,saveT=null;
  var curWeek=null,viewWeek=null,readOnly=false,weeksList=[],weekLabels={},EDITABLE=true;
  function isoDate(d){return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());}
  function mondayOf(d){var x=new Date(d);var day=(x.getDay()+6)%7;x.setDate(x.getDate()-day);x.setHours(0,0,0,0);return x;}
  function isoWeekId(d){var t=mondayOf(d);t.setDate(t.getDate()+3);var w1=new Date(t.getFullYear(),0,4);
    var n=1+Math.round(((t-w1)/864e5-3+((w1.getDay()+6)%7))/7);return t.getFullYear()+"-W"+pad(n);}
  function normalize(st){st=st||{};if(!st.title)st.title="주간 리듬 미팅";if(!st.part)st.part="UX 기획파트";if(!st.tasks)st.tasks=[];
    st.tasks.forEach(function(t,i){if(t.id==null)t.id="t"+i+"_"+Math.random().toString(36).slice(2,7);if(t.asis===undefined&&t.tobe===undefined){t.asis=t.why||"";t.tobe="";}});
    splitGoalLines(st.tasks);backfillFlags(st.tasks);return st;}
  // 구버전 이관 — 한 칸에 여러 줄이던 Goal 을 **줄마다 한 행**으로 나눈다.
  // 첫 줄은 원래 행에 남겨 id·담당·자식을 유지하고, 나머지는 바로 뒤 형제로 끼운다. 멱등.
  function splitGoalLines(tasks){
    var list=tasks||[];
    var targets=list.filter(function(t){return t&&t.parent&&String(t.what||"").indexOf("\n")>=0;});
    targets.forEach(function(t){
      var parts=String(t.what||"").split("\n").map(stripFlag)
        .filter(function(pp){return pp.text||pp.flag;});
      if(!parts.length)return;
      t.what=parts[0].text;if(!t.flag)t.flag=parts[0].flag;
      parts.slice(1).forEach(function(pp,i){
        var nt=Object.assign({},t,{
          id:"t"+Date.now()+"_"+i+"_"+Math.random().toString(36).slice(2,7),
          pri:(t.pri||0)+(i+1)/(parts.length+1),
          what:pp.text,flag:pp.flag,_v:Date.now()});
        list.push(nt);});
    });
    if(!targets.length)return;
    // 같은 부모끼리 pri 를 정수로 다시 매긴다(전역 renumberAll 은 state 를 보므로 여기선 직접).
    var byP={};
    list.forEach(function(t){var k=String(t.parent||"");(byP[k]=byP[k]||[]).push(t);});
    Object.keys(byP).forEach(function(k){
      byP[k].sort(function(a,b){return (a.pri||0)-(b.pri||0);})
            .forEach(function(t,i){t.pri=i+1;});});}
  // 플래그 기본값 #진행 — 플래그가 없는 하위(Goal·세부)에 한 번 붙여준다.
  function backfillFlags(tasks){(tasks||[]).forEach(function(t){
    if(!t||!t.parent)return;                                   // 프로젝트는 대상 아님
    if(t.flag)return;                                          // 이미 있으면 유지
    var sp=stripFlag(String(t.what||""));
    if(sp.flag){t.flag=sp.flag;t.what=sp.text;return;}          // 구버전 줄머리 → 필드로
    if(!sp.text)return;                                        // 빈 내용은 그대로(안내문 표시)
    t.what=sp.text;t.flag="진행";
  });}
  function applyView(d){state=normalize(d);readOnly=(viewWeek!==curWeek);
    var dt=document.getElementById("docTitle");if(dt)dt.textContent=state.title;
    refreshWeekSel();render();}
  function saveRemote(){if(!sb||readOnly||!viewWeek)return;clearTimeout(saveT);saveT=setTimeout(function(){
    if(!state.label)state.label=weekLabel(new Date());
    sb.from("rhythm").upsert({id:viewWeek,data:Object.assign({},state,{_by:CLIENT}),updated_at:new Date().toISOString()}).then(flushNotify,function(){});},400);}

  // ----- 두레이 알림 -----
  // 좌표(주차·항목·줄번호)만 보내고 문구는 서버가 DB 에서 읽는다. 중복 차단도 서버 몫이라
  // 새로고침하거나 두 사람이 같은 줄을 건드려도 알림은 한 번만 간다.
  // 표시(강조)는 "@"+글자 아무거나에 붙지만, **알림은 팀원 이름일 때만** 나간다.
  // (@외부업체 · @검토 같은 메모까지 대화방에 울리면 안 되므로)
  var MENTIONRE=/@([A-Za-z0-9가-힣_]+)/g;
  function mentionNamesOf(line){   // 부를 때는 직급 없이 "@이해원" 이므로 이름 토큰만 본다
    var names=ROSTER.map(function(o){return String(o).split(/\s+/)[0];}),out=[],m;
    MENTIONRE.lastIndex=0;
    while((m=MENTIONRE.exec(String(line))))if(names.indexOf(m[1])>=0&&out.indexOf(m[1])<0)out.push(m[1]);
    return out;}
  var notifyQ={};
  function queueNotify(t){
    if(!NOTIFY_FN||!sb||readOnly||!viewWeek||viewWeek!==curWeek||!t)return;
    String(t.what||"").split("\n").forEach(function(line,i){
      if(mentionNamesOf(line).length)notifyQ[t.id+"|"+i]=1;
    });
  }
  // 저장이 실제로 끝난 뒤에 부른다 — 서버가 읽을 때 그 문구가 DB 에 있어야 하므로.
  function flushNotify(){
    var keys=Object.keys(notifyQ);if(!keys.length)return;
    notifyQ={};
    keys.forEach(function(k){
      var p=k.split("|");
      sb.functions.invoke(NOTIFY_FN,{body:{weekId:viewWeek,taskId:p[0],lineIndex:+p[1]}})
        .then(function(){},function(){});   // 알림 실패가 편집을 방해하지 않게 조용히 넘긴다
    });
  }
  function touch(t){if(t)t._v=Date.now();}
  var pendingRender=false;
  function isEditing(){var a=document.activeElement;if(!a)return false;
    if(a.id==="docTitle")return true;
    return (a.isContentEditable||a.tagName==="INPUT"||a.tagName==="TEXTAREA")&&!!(a.closest&&a.closest("#tbody"));}
  function scheduleRender(){if(isEditing())pendingRender=true;else render();}
  // Per-task merge: keep the newer version of each task by _v (deletes travel as _del tombstones),
  // so two people editing different tasks never overwrite each other. If our local copy is the
  // newer one, we re-upload so the shared row converges.
  function mergeInto(remote){
    remote=normalize(remote);
    var lById={};state.tasks.forEach(function(t){lById[t.id]=t;});
    var rById={};remote.tasks.forEach(function(t){rById[t.id]=t;});
    var dirty=false;
    remote.tasks.forEach(function(rt){
      var lt=lById[rt.id];
      if(!lt){state.tasks.push(rt);}
      else{var i=state.tasks.indexOf(lt),rv=rt._v||0,lv=lt._v||0;
        if(rv>lv)state.tasks[i]=rt;else if(lv>rv)dirty=true;}
    });
    state.tasks.forEach(function(lt){if(!rById[lt.id])dirty=true;});   // local-only task not yet in the row
    if((remote._mv||0)>=(state._mv||0)){state.title=remote.title;state.part=remote.part;state._mv=remote._mv||state._mv;}
    else dirty=true;
    if(remote.label)state.label=remote.label;if(remote.start)state.start=remote.start;
    return dirty;
  }
  function applyRemote(d){if(!d||d._by===CLIENT)return;delete d._by;
    var dirty=mergeInto(d);
    var dt=document.getElementById("docTitle");
    if(dt&&document.activeElement!==dt)dt.textContent=state.title;
    refreshWeekSel();scheduleRender();
    if(dirty)saveRemote();}
  function refreshWeekSel(){var sel=document.getElementById("weekSel");if(!sel)return;
    sel.innerHTML=weeksList.map(function(id){var lb=(weekLabels[id]||id)+(id===curWeek?" · 현재":"");
      return '<option value="'+id+'"'+(id===viewWeek?" selected":"")+'>'+lb+'</option>';}).join("");}
  function switchWeek(id){if(!sb||id===viewWeek)return;
    sb.from("rhythm").select("data").eq("id",id).single().then(function(r){if(r&&r.data&&r.data.data){viewWeek=id;applyView(r.data.data);}},function(){});}
  function startNewWeek(){if(!sb){alert("DB 연결이 필요합니다.");return;}
    if(viewWeek!==curWeek){alert("현재 주차에서만 새 주차를 시작할 수 있습니다.\n주차 선택을 '현재'로 바꿔 주세요.");return;}
    if(!confirm("이번 주를 마감하고 새 주차를 시작할까요?\n\n· 달성한 Goal 은 이번 주 기록에 보관됩니다.\n· 미달성 Goal 만 새 주차로 이월됩니다."))return;
    var curStart=state.start?new Date(state.start):mondayOf(new Date());
    var ns=new Date(curStart);ns.setDate(ns.getDate()+7);var newId=isoWeekId(ns);
    while(weeksList.indexOf(newId)>=0){ns.setDate(ns.getDate()+7);newId=isoWeekId(ns);}
    var carried=state.tasks.filter(carries).map(function(t){
      return {id:t.id,parent:(t.parent||null),pri:t.pri,what:t.what,division:t.division,asis:t.asis,tobe:t.tobe,owner:t.owner,flag:(t.parent?"진행":undefined),due:t.due,wedPct:t.wedPct,wedNote:"—",friStatus:"진행중",friNote:"—",_v:Date.now()};});   // 부문·진행률은 이월, 플래그는 #진행 으로 되돌림
    // carries() 가 조상까지 검사하므로 부모 없는 고아가 생기지 않는다 → 최상위 승격 처리 불필요
    var data=normalize({start:isoDate(ns),label:weekLabel(ns),title:state.title,part:state.part,tasks:carried});
    sb.from("rhythm").upsert({id:newId,data:Object.assign({},data,{_by:CLIENT}),updated_at:new Date().toISOString()}).then(function(){
      sb.from("rhythm").upsert({id:"_meta",data:{current:newId}});
      curWeek=newId;viewWeek=newId;weekLabels[newId]=data.label;if(weeksList.indexOf(newId)<0)weeksList.unshift(newId);
      applyView(data);
    },function(){alert("새 주차 생성 실패");});
  }
  function initSupabase(){if(!SB_URL||!SB_KEY||!window.supabase)return;
    sb=window.supabase.createClient(SB_URL,SB_KEY);
    sb.from("rhythm").select("id,data").then(function(r){
      var rows=(r&&r.data)||[],meta=null,wk=[];
      rows.forEach(function(row){if(row.id==="_meta")meta=row.data;else if(/^\d{4}-W\d+/.test(row.id)){wk.push(row);weekLabels[row.id]=(row.data&&row.data.label)||row.id;}});
      if(wk.length===0){
        var mainRow=rows.filter(function(x){return x.id==="main";})[0];
        var base=(mainRow&&mainRow.data&&mainRow.data.tasks)?mainRow.data:state;
        var d=new Date();curWeek=isoWeekId(d);
        var data=normalize({start:isoDate(mondayOf(d)),label:weekLabel(d),title:base.title,part:base.part,tasks:base.tasks});
        weeksList=[curWeek];weekLabels[curWeek]=data.label;viewWeek=curWeek;
        sb.from("rhythm").upsert({id:curWeek,data:Object.assign({},data,{_by:CLIENT}),updated_at:new Date().toISOString()});
        sb.from("rhythm").upsert({id:"_meta",data:{current:curWeek}});
        applyView(data);
      }else{
        weeksList=wk.map(function(x){return x.id;}).sort().reverse();
        curWeek=(meta&&meta.current)||weeksList[0];viewWeek=curWeek;
        var cur=wk.filter(function(x){return x.id===curWeek;})[0];
        applyView(cur&&cur.data?cur.data:state);
      }
      subscribeRT();
    },function(){});
  }
  function subscribeRT(){sb.channel("rhythm-all").on("postgres_changes",{event:"*",schema:"public",table:"rhythm"},function(p){
    var row=p&&p.new;if(!row||!row.id)return;
    if(row.id==="_meta"){if(row.data&&row.data.current){curWeek=row.data.current;if(weeksList.indexOf(curWeek)<0)weeksList.unshift(curWeek);readOnly=(viewWeek!==curWeek);refreshWeekSel();render();}return;}
    if(/^\d{4}-W\d+/.test(row.id)){if(weeksList.indexOf(row.id)<0){weeksList.push(row.id);weeksList.sort().reverse();}weekLabels[row.id]=(row.data&&row.data.label)||row.id;if(row.id===viewWeek)applyRemote(row.data);else refreshWeekSel();}
  }).subscribe();}
  var LS="axp_rhythm_v3";
  var DOW=["SUN","MON","TUE","WED","THU","FRI","SAT"];
  var DOWK=["일","월","화","수","목","금","토"];
  function pad(n){return(n<10?"0":"")+n;}
  function fmtToday(d){return d.getFullYear()+"."+pad(d.getMonth()+1)+"."+pad(d.getDate())+" "+DOW[d.getDay()];}
  function weekLabel(d){var day=(d.getDay()+6)%7,mon=new Date(d);mon.setDate(d.getDate()-day);
    var fri=new Date(mon);fri.setDate(mon.getDate()+4);
    return mon.getFullYear()+"."+pad(mon.getMonth()+1)+"."+pad(mon.getDate())+" – "+pad(fri.getMonth()+1)+"."+pad(fri.getDate());}

  function seed(){return{tasks:[
    {pri:1,what:"마인드커넥트 UIUX 개선 디자인",asis:"UX·화면 구조 문제",tobe:"톤앤매너 일관성 있게 정리",owner:"이해원 차장",due:"06/26",wedPct:60,wedNote:"담당자 검토 일정 조율",friStatus:"진행중",friNote:"차주 검토·반영"},
    {pri:2,what:"학지사 자사몰 UX 개선",asis:"도서 선택 부담",tobe:"큐레이션으로 개선",owner:"—",due:"—",wedPct:30,wedNote:"—",friStatus:"진행중",friNote:"차주 지속"},
    {pri:3,what:"교원연수 2과정 오픈",asis:"연수 과정 수요",tobe:"학습 과정 확대",owner:"—",due:"06/18",wedPct:80,wedNote:"—",friStatus:"완료",friNote:"—"},
    {pri:4,what:"전사 카탈로그 출판 자동화",asis:"반복 출판 수작업",tobe:"출판 자동화",owner:"—",due:"—",wedPct:10,wedNote:"자료 취합 지연",friStatus:"진행중",friNote:"차주 자료 재요청"},
    {pri:5,what:"번역 플랫폼 개발",asis:"번역 중복 작업",tobe:"플랫폼 통합",owner:"—",due:"—",wedPct:null,wedNote:"의학용어 번역과 중복 (결정 필요)",friStatus:"보류",friNote:"결정 대기"},
    {pri:6,what:"인싸이트 프로모션 게시판 UIUX·기획",asis:"프로모션 진입 동선",tobe:"동선 정리",owner:"—",due:"—",wedPct:100,wedNote:"—",friStatus:"완료",friNote:"—"}
  ]};}

  function loadState(){
    var sd=document.getElementById("seedData");
    if(sd){try{return JSON.parse(sd.textContent);}catch(e){}}
    try{var r=localStorage.getItem(LS);if(r)return JSON.parse(r);}catch(e){}
    return seed();
  }
  var saveTimer;
  function saveLocal(){try{localStorage.setItem(LS,JSON.stringify(state));}catch(e){}saveRemote();
    var el=document.getElementById("saveind");el.classList.add("on");
    clearTimeout(saveTimer);saveTimer=setTimeout(function(){el.classList.remove("on");},1400);}

  var state=loadState();
  if(!state.title)state.title="주간 리듬 미팅";
  if(!state.part)state.part="UX 기획파트";
  state.tasks.forEach(function(t,i){
    if(t.id==null)t.id="t"+i+"_"+Math.random().toString(36).slice(2,7);
    if(t.asis===undefined&&t.tobe===undefined){t.asis=t.why||"";t.tobe="";}
  });
  // Single unified view — tabs removed. Every top-level task is a PROJECT header;
  // its children are HISTORY entries. Two column templates, no per-day variants.
  // 뎁스1 프로젝트: 부문칩 | 이름 | 진행률 | (빈칸) | 기한
  // 뎁스2~3 Goal:   ↳ | 내용 | 담당 | 상태   ← 담당·상태가 프로젝트의 (빈칸)·기한 열과 정렬된다
  var COLS_PROJECT="4.2rem minmax(0,1fr) 13rem 3rem 10rem";   // 부문 | 이름 | 진행률 | 여백 | 기한
  var COLS_GOAL="4.2rem 5rem minmax(0,1fr) 10rem";            // ↳ | 플래그 | 내용 | 담당(= 기한 열과 정렬)
  var MAXDEPTH=2;   // 0=프로젝트, 1=Goal, 2=세부 (최대 3단계)
  var STATUS=[
    {k:"진행중",icon:"radio_button_unchecked",cls:""},
    {k:"완료",icon:"check_circle",cls:"done"},
    {k:"보류",icon:"pause_circle",cls:"hold"},
    {k:"이월",icon:"arrow_circle_right",cls:"carry"},
    {k:"대기",icon:"pending",cls:"wait"}
  ];
  function statusObj(k){for(var i=0;i<STATUS.length;i++)if(STATUS[i].k===k)return STATUS[i];return STATUS[0];}
  function esc(s){return String(s).replace(/[&<>]/g,function(m){return{"&":"&amp;","<":"&lt;",">":"&gt;"}[m];});}
  // ----- 줄머리 플래그 -----
  // 내용 칸의 "각 줄" 앞에 #목표 처럼 적으면 틴트 칩으로 보이고, 칩을 클릭하면 다음 플래그로 순환한다.
  // 칩에 보이는 글자가 저장된 텍스트와 똑같아서(#목표) contenteditable 의 innerText 왕복이 깨지지 않는다.
  var FLAGS=["목표","진행","성공","실패","보류","대기","이슈"];
  // 타이핑 단축 입력·구버전 이관에 쓰는 줄머리 패턴(불릿도 함께 걷어낸다).
  var FLAGRE=/^(\s*(?:•\s*)?)#(목표|진행|성공|실패|보류|대기|이슈)(?=\s|$)/;
  function stripFlag(line){
    var raw=String(line),m=FLAGRE.exec(raw);
    if(m)return {flag:m[2],text:raw.slice(m[0].length).trim()};
    return {flag:"",text:raw.replace(/^\s*•\s*/,"").trim()};}
  // **한 행 = 한 줄**이라 플래그는 행의 값(t.flag)이다. 본문 텍스트에 섞지 않는다.
  function flagOf(t){return (t&&t.flag)||"";}
  function goalDone(t){return flagOf(t)==="성공";}
  // 플래그칩 — 본문 밖 독립 칸.
  function flagCell(t){
    var v=flagOf(t),i=FLAGS.indexOf(v);
    return '<button class="flag f'+i+(v?"":" none")+'" data-id="'+t.id+'"'+(EDITABLE?"":" disabled")
      +' title="'+(v?"상태: #"+v:"상태 지정")+'">'+(v?"#"+esc(v):"—")+'</button>';}

  // ----- 플래그 드롭다운 -----
  var flagPop=null;
  function closeFlagPop(){if(flagPop){flagPop.remove();flagPop=null;}}
  // setFlag — 행의 값만 바꾼다(v="" 이면 없음). 본문 텍스트는 건드리지 않는다.
  function setFlag(id,v){
    var t=getTask(id);if(!t)return;
    t.flag=v;touch(t);saveLocal();render();
  }
  function openFlagPop(chip,id){
    closeFlagPop();if(readOnly||!id)return;
    var el=document.createElement("div");el.className="flagpop";
    el.innerHTML=FLAGS.map(function(f,i){
      return '<button class="flagopt f'+i+'" data-v="'+f+'">#'+f+'</button>';}).join("")
      +'<button class="flagopt none" data-v="">플래그 없음</button>';
    document.body.appendChild(el);flagPop=el;
    var r=chip.getBoundingClientRect(),pr=el.getBoundingClientRect();
    var left=Math.min(r.left,window.innerWidth-pr.width-8);
    var top=(r.bottom+pr.height+8>window.innerHeight)?(r.top-pr.height-4):(r.bottom+4);
    el.style.left=Math.max(8,left)+"px";el.style.top=Math.max(8,top)+"px";
    el.addEventListener("mousedown",function(e){e.preventDefault();});   // 캐럿 이동 방지
    el.addEventListener("click",function(e){
      var b=e.target.closest(".flagopt");if(!b)return;
      setFlag(id,b.dataset.v);closeFlagPop();
    });
  }
  document.addEventListener("mousedown",function(e){
    if(flagPop&&!e.target.closest(".flagpop")&&!e.target.closest(".flag"))closeFlagPop();},true);
  document.addEventListener("keydown",function(e){if(e.key==="Escape")closeFlagPop();});

  // 업무내용 렌더: (1) 줄머리 플래그 칩, (2) http(s) 링크 → 새 창, (3) "@이름" 강조. 모두 표시 전용.
  // URL·텍스트를 각각 이스케이프해 삽입하므로 XSS 안전(http(s)만 매칭돼 javascript: 등은 배제).
  function inlineHtml(s){
    s=String(s);
    function plain(t){return esc(t).replace(/@([A-Za-z0-9가-힣_]+)/g,'<span class="mention">@$1</span>');}
    var re=/https?:\/\/[^\s<]+[^\s<.,;:!?)\]}'"]/g,out="",last=0,m;
    while((m=re.exec(s))){
      out+=plain(s.slice(last,m.index))
        +'<a class="tlink" href="'+escAttr(m[0])+'" target="_blank" rel="noopener noreferrer">'+esc(m[0])+'</a>';
      last=m.index+m[0].length;
    }
    return out+plain(s.slice(last));
  }
  // 한 행 = 한 줄이므로 줄 분해가 없다. 플래그는 본문 밖 칩(flagCell), #성공 취소선은 행(.row.done)이 담당.
  function mentionHtml(s){return inlineHtml(s);}
  function escAttr(s){return esc(s).replace(/"/g,"&quot;");}
  function CE(){return EDITABLE?" contenteditable":"";}
  function edWhat(t){return '<div class="what"'+CE()+' data-field="what" data-id="'+t.id+'" title="'+escAttr(t.what)+'">'+esc(t.what)+'</div>';}
  // ----- 진행률: 10% 단위, 세그먼트를 눌러 조정 -----
  var PSTEP=10,PSEG=100/PSTEP;
  function pctOf(t){var v=t&&t.wedPct;return(v===null||v===undefined||v==="")?0:Math.max(0,Math.min(100,parseInt(v,10)||0));}
  function segHtml(p){var on=Math.round((p||0)/PSTEP),h="";for(var i=0;i<PSEG;i++)h+='<span class="seg'+(i<on?" on":"")+'" data-i="'+i+'"></span>';return h;}
  function progCell(t){var v=pctOf(t);
    return '<div class="prog" data-id="'+t.id+'"><div class="bar">'+segHtml(v)+'</div>'
      +'<span class="pval">'+v+'<span class="sign">%</span></span></div>';
  }
  // 프로젝트 전체 진행률은 직접 입력한다(하위 평균 아님). 차주로 넘어가면 완료된 하위가 빠져
  // 평균이 오히려 내려가 버리기 때문에, 프로젝트의 누적 진척은 사람이 판단해 적는 게 맞다.
  function chipCell(t){var s=statusObj(t.friStatus);
    return '<button class="chip '+s.cls+'" data-id="'+t.id+'"><span class="ms">'+s.icon+'</span>'+esc(t.friStatus)+'</button>';}
  function ed(f,id,v,cls,lab){return '<div class="'+cls+'"'+CE()+' data-field="'+f+'" data-id="'+id+'"'+(lab?' data-label="'+lab+'"':'')+'>'+mentionHtml(v)+'</div>';}
  function purposeCell(t){
    if(t.asis===undefined&&t.tobe===undefined)
      return '<div class="why"'+CE()+' data-field="why" data-id="'+t.id+'">'+esc(t.why||"")+'</div>';
    return '<div class="purpose">'
      +'<div class="pl"><span class="plk asis">AS-IS</span><span class="ped"'+CE()+' data-field="asis" data-id="'+t.id+'">'+esc(t.asis||"")+'</span></div>'
      +'<div class="pl"><span class="plk tobe">TO-BE</span><span class="ped"'+CE()+' data-field="tobe" data-id="'+t.id+'">'+esc(t.tobe||"")+'</span></div>'
      +'</div>';
  }
  var ROSTER=["박찬영 부장","조용선 차장","이해원 차장","김인성 과장","박성배 과장","이민석 과장",
    "박동한 대리","이재현 대리","이제홍 대리","이새임 대리","정유나 대리","김현석 책임","양희주 책임"];
  var RANKS=["부장","차장","과장","대리","책임"];   // 인원수만큼 색을 쓰면 구분이 안 되므로 직급별 5색 틴트(o1~o5)
  function ownerList(){return ["—"].concat(ROSTER);}
  function ownerInitials(name){if(!name||name==="—")return "";return String(name).split(/\s+/)[0].slice(0,3);}   // 이름 3자
  function ownerIdx(name){if(!name||name==="—")return 0;var i=RANKS.indexOf(String(name).split(/\s+/)[1]||"");return i<0?0:i+1;}
  function ownerCell(t){
    var label=(t.owner&&t.owner!=="—")?t.owner:"미정";
    var idx=ownerIdx(t.owner);
    var ini=ownerInitials(t.owner);
    // 담당 = 셀렉트박스. 데스크톱은 select 가 풀네임을 보여주고,
    // 모바일은 폭이 없으니 래퍼가 data-ini 를 ::before 로 찍고 select 가 투명하게 덮는다.
    var opts=ownerList().map(function(o){
      return '<option value="'+escAttr(o)+'"'+(o===(t.owner||"—")?" selected":"")+'>'+esc(o==="—"?"미정":o)+'</option>';}).join("");
    return '<div class="ochip o'+idx+'" data-ini="'+escAttr(ini||"미정")+'" title="담당: '+escAttr(label)+'">'
      +'<span class="ms">person</span>'
      +'<select class="osel"'+(EDITABLE?"":" disabled")+' data-field="owner" data-id="'+t.id+'" aria-label="담당 선택">'+opts+'</select></div>';
  }
  // ----- 부문(division): 프로젝트를 출판/심리/교육/메디컬 로 분류. 담당처럼 클릭해 순환. -----
  var DIVISIONS=["출판","심리","교육","메디컬","AX","전사"];
  function divIdx(v){var i=DIVISIONS.indexOf(v||"");return i<0?0:i+1;}  // 0=미지정, 1..6
  function divCell(t){var v=t.division||"";
    var opts=[""].concat(DIVISIONS).map(function(d){
      return '<option value="'+escAttr(d)+'"'+(d===v?" selected":"")+'>'+esc(d||"미지정")+'</option>';}).join("");
    return '<div class="divchip d'+divIdx(v)+'" title="부문: '+escAttr(v||"미지정")+'">'
      +'<select class="dsel"'+(EDITABLE?"":" disabled")+' data-field="division" data-id="'+t.id+'" aria-label="부문 선택">'+opts+'</select></div>';}
  // 부문별 보기 필터도 "보는 사람"의 설정이라 공유 데이터가 아니라 localStorage. "" = 전체
  var DIV_LS="axp_divfilter_v1",viewDiv="";
  try{viewDiv=localStorage.getItem(DIV_LS)||"";}catch(e){viewDiv="";}
  function setViewDiv(v){viewDiv=v||"";try{localStorage.setItem(DIV_LS,viewDiv);}catch(e){}render();}
  function renderDivBar(){var bar=document.getElementById("divbar");if(!bar)return;
    var tops=childrenOf(null);
    var items=[{v:"",label:"전체",n:tops.length}].concat(DIVISIONS.map(function(d){
      return {v:d,label:d,n:tops.filter(function(p){return(p.division||"")===d;}).length};}));
    var chips=items.map(function(it){
      return '<button class="dfil'+(viewDiv===it.v?" on":"")+(it.v?" d"+divIdx(it.v):"")+'" data-div="'+escAttr(it.v)+'">'
        +esc(it.label)+'<span class="dfn">'+it.n+'</span></button>';}).join("");
    var opts=items.map(function(it){
      return '<option value="'+escAttr(it.v)+'"'+(viewDiv===it.v?" selected":"")+'>'+esc(it.label)+'</option>';}).join("");   // 셀렉엔 개수 표기 생략
    // 데스크톱: 칩(.dfilset) / 모바일: 셀렉박스(.dfsel) — CSS로 전환
    bar.innerHTML='<div class="dfilset">'+chips+'</div>'
      +'<div class="dfsel"><select id="divsel" class="fsel" aria-label="부문 필터">'+opts+'</select><span class="ms selcar">expand_more</span></div>';}
  function dueToISO(d){if(!d)return"";if(/^\d{4}-\d{2}-\d{2}$/.test(d))return d;
    var m=/^(\d{1,2})[\/.\-](\d{1,2})$/.exec(d);if(m)return new Date().getFullYear()+"-"+pad(+m[1])+"-"+pad(+m[2]);return"";}
  function dueCell(t){var iso=dueToISO(t.due);var md=iso?iso.slice(5).replace("-","."):"";
    return '<div class="duec'+(iso?"":" empty")+'" data-label="기한"><input type="date" class="fdate"'+(EDITABLE?"":" disabled")+' data-field="due" data-id="'+t.id+'" value="'+iso+'"><span class="ddisp">'+(md||"미정")+'</span></div>';}

  // ----- tree (group) helpers -----
  function childrenOf(pid){return state.tasks.filter(function(x){return !x._del&&(x.parent||null)===pid;}).sort(function(a,b){return(a.pri||99)-(b.pri||99);});}
  // 접기 상태는 "보는 사람"의 취향이라 공유 데이터가 아니라 localStorage 에 둔다(남의 화면을 접지 않음)
  var COL_LS="axp_collapsed_v1",collapsed={};
  try{collapsed=JSON.parse(localStorage.getItem(COL_LS)||"{}")||{};}catch(e){collapsed={};}
  function isCollapsed(id){return !!collapsed[id];}
  function toggleCollapse(id){if(collapsed[id])delete collapsed[id];else collapsed[id]=1;
    try{localStorage.setItem(COL_LS,JSON.stringify(collapsed));}catch(e){}render();}
  function buildOrder(){var res=[];(function walk(pid,depth){childrenOf(pid).forEach(function(t){
    if(depth===0&&viewDiv&&(t.division||"")!==viewDiv)return;   // 부문 필터: 다른 부문 프로젝트(+하위) 숨김
    res.push({t:t,depth:depth});
    if(!(depth===0&&isCollapsed(t.id)))walk(t.id,depth+1);      // 접힌 프로젝트는 하위를 건너뜀
  });})(null,0);return res;}
  function isDesc(aId,bId){var t=getTask(aId),g=0;while(t&&t.parent&&g++<200){if(t.parent===bId)return true;t=getTask(t.parent);}return false;}
  function depthOf(id){var t=getTask(id),d=0;while(t&&t.parent&&d<200){d++;t=getTask(t.parent);}return d;}   // 0=프로젝트
  function subDepth(id){var kids=childrenOf(id),m=0;kids.forEach(function(k){var v=1+subDepth(k.id);if(v>m)m=v;});return m;}  // 자기 아래로 몇 단인지
  // 이월 대상: 자신과 모든 조상이 미완료일 때만. (부모가 마감되면 자손도 함께 이번 주 기록에 남는다)
  function carries(t){var cur=t,g=0;while(cur&&g++<200){
    if(cur._del)return false;
    if(cur.parent&&goalDone(cur))return false;   // 하위는 첫 줄 플래그 #성공 이면 달성 → 이번 주 기록에 보관
    if(!cur.parent)return true;cur=getTask(cur.parent);}return true;}
  function renumberAll(){
    var pids=[null].concat(state.tasks.map(function(t){return t.id;}));
    pids.forEach(function(pid){childrenOf(pid).forEach(function(t,i){if(t.pri!==i+1){t.pri=i+1;touch(t);}});});
  }

  // Every top-level task is a PROJECT header (name + owner + date + "+히스토리"); its own
  // legacy day-fields stay in the data but aren't shown. Its children are the project's
  // HISTORY log — one line each: status + what(한 일) + owner + date.
  function projectHeaderCells(t){
    var kids=childrenOf(t.id).length,col=isCollapsed(t.id);
    return divCell(t)   // 앞 번호(01) 자리 → 부문 칩(출판/심리/교육/메디컬). 클릭해 순환.
      +'<div class="phead">'
      +'<button class="coltog'+(kids?"":" off")+'" data-id="'+t.id+'" title="'+(col?"펼치기":"접기")+'" aria-label="'+(col?"펼치기":"접기")+'"><span class="ms">'+(col?"chevron_right":"expand_more")+'</span></button>'
      +'<div class="what"'+CE()+' data-field="what" data-id="'+t.id+'" title="'+escAttr(t.what)+'">'+esc(t.what)+'</div>'
      +(kids&&col?'<span class="cnt">'+kids+'</span>':'')
      +(EDITABLE?'<button class="addhist" data-id="'+t.id+'" title="Goal 추가" aria-label="Goal 추가"><span class="ms">add</span></button>':'')
      +'</div>'
      +progCell(t)+'<div class="sp"></div>'+dueCell(t);   // 담당 자리는 빈칸 — 기한 열을 Goal 행과 맞추기 위함
  }
  // Goal(뎁스2) / 세부(뎁스3) — 이번 주 안에 끝낼 단위. 기한·진행률 없음(프로젝트에만), 상태칩은 행 끝.
  function goalCells(t){
    return '<div class="pri sub" data-id="'+t.id+'"><span class="ms">subdirectory_arrow_right</span></div>'
      +flagCell(t)+ed("what",t.id,t.what||"","note goalwhat","Goal")+ownerCell(t);   // 플래그는 본문 밖 칸, 담당은 행 끝
  }

  function render(){
    EDITABLE=!readOnly;
    document.getElementById("today").textContent=fmtToday(new Date())+(readOnly?"  ·  보기 전용":"");   // 중앙 주차 라벨 제거 → 보기전용은 우측 날짜에 표기
    var dtt=document.getElementById("docTitle");if(dtt)dtt.contentEditable=EDITABLE;
    var ab=document.getElementById("addBtn");if(ab)ab.style.display=EDITABLE?"":"none";

    renderDivBar();
    var order=buildOrder();
    var tb=document.getElementById("tbody");
    var gdiv=0;   // 그룹(프로젝트+하위)의 부문 인덱스 — 왼쪽 레일 색을 부문 색과 맞추기 위해
    tb.innerHTML=order.map(function(o,i){
      var t=o.t,depth=o.depth,cells,gridCols,extra;
      if(depth===0)gdiv=divIdx(t.division);
      if(depth>0){                         // Goal(1) / 세부(2) — 뎁스가 깊을수록 작고 흐리게
        cells=goalCells(t);gridCols=COLS_GOAL;extra=" goal"+(depth>1?" deep":"");
      }else{                               // 최상위 → 프로젝트 헤더
        cells=projectHeaderCells(t);gridCols=COLS_PROJECT;extra=" project";
      }
      // 그룹(프로젝트+하위)의 마지막 행 → 아래에만 경계·여백을 줘서 한 덩어리로 보이게
      if(i===order.length-1||order[i+1].depth===0)extra+=" groupend";
      extra+=" gd"+gdiv;   // 부문 색 레일
      var done=depth>0&&goalDone(t);
      return '<div class="row'+(done?" done":"")+extra+'" data-id="'+t.id+'" style="grid-template-columns:'+gridCols+'">'+
        (EDITABLE?'<span class="dragh" data-id="'+t.id+'" aria-label="순서 이동"><span class="ms">drag_indicator</span></span>':'')+
        cells+
        (EDITABLE?'<button class="del" data-id="'+t.id+'" aria-label="삭제"><span class="ms">delete</span></button>':'')+'</div>';
    }).join("");
    pendingRender=false;
  }
  function getTask(id){return state.tasks.filter(function(x){return String(x.id)===String(id);})[0];}

  var tb=document.getElementById("tbody");
  // 포커스가 들어오면 강조를 평문으로 되돌린다(타이핑 중 캐럿 안정 + 취소선 span 흡수 방지).
  tb.addEventListener("focusin",function(e){
    var el=e.target;
    if(readOnly||!el||!el.classList||!el.classList.contains("note"))return;
    plainify(el);
  });
  tb.addEventListener("input",function(e){
    if(readOnly)return;
    var el=e.target;if(!el.dataset||!el.dataset.field)return;
    if(el.tagName==="SELECT"||el.tagName==="INPUT")return;
    if(el.classList.contains("note")&&!composing)plainify(el);
    var t=getTask(el.dataset.id);if(!t)return;
    var f=el.dataset.field;
    if(f==="wedPct"){var raw=el.textContent.replace(/[^0-9]/g,"");var box=el.closest(".prog");
      if(raw===""){t.wedPct=null;if(box)box.querySelector(".bar").innerHTML=segHtml(0);}
      else{var n=Math.max(0,Math.min(100,parseInt(raw,10)));t.wedPct=n;if(box)box.querySelector(".bar").innerHTML=segHtml(n);}
      if(t.wedPct===100)t.friStatus="완료";else if(t.friStatus==="완료")t.friStatus="진행중";}
    else if(f==="pri"){var p=parseInt(el.textContent.replace(/[^0-9]/g,""),10);if(!isNaN(p))t.pri=p;}
    else if(f==="what"&&t.parent){
      // 입력 방법은 예전 그대로 — 내용 앞에 "#성공 " 을 치면 그 자리에서 플래그 필드로 뺀다.
      var sp=stripFlag(el.innerText);
      if(sp.flag){t.flag=sp.flag;t.what=sp.text;
        var off=caretOffset(el),removed=el.innerText.length-sp.text.length;
        el.textContent=sp.text;
        setCaretOffset(el,Math.max(0,(off==null?sp.text.length:off)-removed));
        touch(t);saveLocal();
        var chip=tb.querySelector('.flag[data-id="'+t.id+'"]');
        if(chip){chip.className="flag f"+FLAGS.indexOf(sp.flag);chip.textContent="#"+sp.flag;}
        return;}
      t.what=el.innerText;}
    else t[f]=el.innerText;
    touch(t);saveLocal();
  });
  tb.addEventListener("focusout",function(e){
    var el=e.target,f=el&&el.dataset&&el.dataset.field;
    if(f==="pri"||f==="wedPct"){render();return;}
    // 타이핑 중에는 평문으로 두고, 포커스가 빠질 때 @멘션 강조를 다시 입힌다(캐럿 안 튐)
    if(!readOnly&&el&&el.classList&&el.classList.contains("note"))el.innerHTML=mentionHtml(el.innerText);
    // 작성이 끝난 시점 = 두레이로 내보낼 시점. 저장이 끝나면 flushNotify 가 실제로 보낸다.
    if(!readOnly&&f==="what")queueNotify(getTask(el.dataset.id));
  });
  tb.addEventListener("change",function(e){
    if(readOnly)return;
    var el=e.target;if(!el.dataset||!el.dataset.field)return;var t=getTask(el.dataset.id);if(!t)return;
    if(el.dataset.field==="division"){t.division=el.value;touch(t);saveLocal();render();return;}
    if(el.dataset.field==="owner"){t.owner=el.value||"—";touch(t);saveLocal();render();return;}
    if(el.dataset.field==="due"){t.due=el.value||"—";var dc=el.closest(".duec");if(dc){dc.classList.toggle("empty",!el.value);var dd=dc.querySelector(".ddisp");if(dd)dd.textContent=el.value?el.value.slice(5).replace("-","."):"미정";}touch(t);saveLocal();return;}
  });
  tb.addEventListener("click",function(e){
    var ct=e.target.closest(".coltog");
    if(ct){toggleCollapse(ct.dataset.id);return;}     // 접기/펼치기는 보기 전용 주차에서도 동작
    var lk=e.target.closest("a.tlink");               // 업무내용의 링크는 새 창으로(편집·보기 전용 모두)
    if(lk){e.preventDefault();window.open(lk.href,"_blank","noopener");return;}
    if(readOnly)return;
    var ah=e.target.closest(".addhist");
    if(ah){var pp=getTask(ah.dataset.id);if(pp){
      var mp=childrenOf(pp.id).reduce(function(m,x){return Math.max(m,x.pri||0);},0);
      var nt={id:"t"+Date.now(),parent:pp.id,pri:mp+1,what:"#진행 ",asis:"",tobe:"",owner:"—",due:"—",wedPct:null,wedNote:"—",friStatus:"진행중",friNote:"—",_v:Date.now()};   // 새 Goal 기본 플래그
      state.tasks.push(nt);touch(pp);saveLocal();render();
      setTimeout(function(){var el=document.querySelector('.row[data-id="'+nt.id+'"] [data-field="what"]');if(el)el.focus();},30);
    }return;}
    var del=e.target.closest(".del");
    if(del){var t=getTask(del.dataset.id);if(t&&confirm("이 과업을 삭제할까요?\n\n"+t.what)){
      state.tasks.forEach(function(x){if((x.parent||null)===t.id){x.parent=(t.parent||null);touch(x);}});   // 하위는 조부모로(3뎁스에서 최상위 승격 방지)
      t._del=true;touch(t);renumberAll();saveLocal();render();}return;}
    var seg=e.target.closest(".seg");
    if(seg){var pg=seg.closest(".prog");
      var ts=pg&&getTask(pg.dataset.id);if(ts){
      var nv=(+seg.dataset.i+1)*PSTEP;if(ts.wedPct===nv)nv-=PSTEP;if(nv<0)nv=0;ts.wedPct=nv;
      // 상태 자동연동은 하위 업무만. 프로젝트까지 100%→완료로 바꾸면 다음 주차에 통째로 사라진다.
      if(ts.parent){if(nv===100)ts.friStatus="완료";else if(ts.friStatus==="완료")ts.friStatus="진행중";}
      touch(ts);saveLocal();render();}return;}
    // 모바일에선 바를 작게 줄여 표시만 하므로(칸이 좁아 오터치), 진행률 영역을 탭하면 10%씩 오른다
    var pgc=e.target.closest(".prog");
    if(pgc){var tp=getTask(pgc.dataset.id);if(tp){
      var nx=pctOf(tp)>=100?0:pctOf(tp)+PSTEP;tp.wedPct=nx;
      if(tp.parent){if(nx===100)tp.friStatus="완료";else if(tp.friStatus==="완료")tp.friStatus="진행중";}
      touch(tp);saveLocal();render();}return;}
    var chip=e.target.closest(".chip");
    if(chip){var tt=getTask(chip.dataset.id);if(!tt)return;
      var idx=STATUS.map(function(s){return s.k;}).indexOf(tt.friStatus);
      tt.friStatus=STATUS[(idx+1)%STATUS.length].k;touch(tt);saveLocal();render();return;}
    // 플래그칩 클릭 → 드롭다운에서 골라 바꾼다. 칩이 본문 밖 칸이라 저장값과 섞이지 않는다.
    var fl=e.target.closest(".flag");
    if(fl){openFlagPop(fl,fl.dataset.id);return;}
  });

  // ----- multi-line bullet editing (keeps newlines; Enter starts/continues a bullet list) -----
  function placeCaretEnd(el){el.focus();var r=document.createRange();r.selectNodeContents(el);r.collapse(false);var s=window.getSelection();s.removeAllRanges();s.addRange(r);}
  // 캐럿의 텍스트 오프셋(요소 시작 기준). 마크업을 걷어내도 같은 자리로 되돌리려고 잰다.
  function caretOffset(el){
    var sel=window.getSelection();if(!sel||!sel.rangeCount)return null;
    var r=sel.getRangeAt(0);if(!el.contains(r.endContainer))return null;
    var pre=document.createRange();pre.selectNodeContents(el);pre.setEnd(r.endContainer,r.endOffset);
    return pre.toString().length;}
  function setCaretOffset(el,off){
    var walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),acc=0,node;
    while((node=walker.nextNode())){
      var len=node.textContent?node.textContent.length:0;
      if(acc+len>=off){var r=document.createRange();r.setStart(node,off-acc);r.collapse(true);
        var s=window.getSelection();s.removeAllRanges();s.addRange(r);return;}
      acc+=len;}
    placeCaretEnd(el);}
  // plainify — 편집 중에는 강조 마크업이 남아 있으면 안 된다.
  // #성공 줄 뒷부분은 <span class="lndone">(취소선)로 감싸여 있어서, 그 span 이 열린 채 캐럿이 끝에 있으면
  // Enter·타이핑이 span 안쪽으로 들어가 새 줄과 그 아래가 전부 성공처럼 보인다. 캐럿은 오프셋으로 보존.
  function plainify(el){
    if(!el.querySelector(".flag, .lndone, .mention, a.tlink"))return;
    var off=caretOffset(el);el.textContent=el.innerText;
    if(off!=null)setCaretOffset(el,off);}
  function bulletLines(txt){return txt.split("\n").map(function(l){l=l.replace(/^\s*•\s*/,"");return l.trim()?"• "+l:l;});}
  // insert a REAL newline text node at the caret (execCommand("insertText","\n") is unreliable in
  // Chrome — it often drops the break, so the newline never reaches innerText/state and vanishes on
  // the next render). white-space:pre-wrap makes the "\n" show as a line break; innerText reads it back.
  function insertAtCaret(el,text){
    el.focus();var sel=window.getSelection();var range;
    if(sel.rangeCount&&el.contains(sel.anchorNode)){range=sel.getRangeAt(0);}
    else{range=document.createRange();range.selectNodeContents(el);range.collapse(false);}
    range.deleteContents();
    var node=document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);range.setEndAfter(node);
    sel.removeAllRanges();sel.addRange(range);
    el.dispatchEvent(new Event("input",{bubbles:true}));
  }
  var composing=false;   // 한글 IME 조합 중에는 DOM 을 건드리면 조합이 깨진다
  tb.addEventListener("compositionstart",function(){composing=true;});
  tb.addEventListener("compositionend",function(e){composing=false;
    if(!readOnly&&e.target&&e.target.classList&&e.target.classList.contains("note"))plainify(e.target);});
  // 한 줄 = 한 행. Enter 는 바로 뒤에 같은 레벨 행을 만들고, 빈 행 Backspace 는 그 행을 지운다.
  function addSibling(id){
    var cur=getTask(id);if(!cur||!cur.parent)return null;
    var nt={id:"t"+Date.now(),parent:cur.parent,pri:(cur.pri||0)+0.5,what:"",asis:"",tobe:"",
      owner:cur.owner||"—",flag:"진행",due:"—",wedPct:null,wedNote:"—",
      friStatus:"진행중",friNote:"—",_v:Date.now()};
    state.tasks.push(nt);renumberAll();saveLocal();render();return nt.id;}
  function removeEmpty(id){
    var t=getTask(id);if(!t||!t.parent)return null;
    if(String(t.what||"").trim())return null;              // 내용이 있으면 지우지 않는다
    if(childrenOf(t.id).length)return null;                // 하위가 달려 있으면 보호
    var sibs=childrenOf(t.parent);if(sibs.length<=1)return null;   // 마지막 한 줄은 남긴다
    var i=sibs.map(function(x){return x.id;}).indexOf(t.id);
    var prev=i>0?sibs[i-1]:sibs[i+1];
    t._del=true;touch(t);renumberAll();saveLocal();render();
    return prev?prev.id:null;}
  function focusGoal(id){
    if(!id)return;
    var el=tb.querySelector('.goalwhat[data-id="'+id+'"]');
    if(el)placeCaretEnd(el);}
  tb.addEventListener("keydown",function(e){
    if(readOnly)return;
    var el=e.target;if(!el||!el.isContentEditable)return;
    var isGoal=el.classList.contains("goalwhat");
    if(e.key==="Backspace"&&isGoal&&!e.isComposing&&!el.innerText.trim()){
      e.preventDefault();focusGoal(removeEmpty(el.dataset.id));return;}
    if(e.key!=="Enter")return;
    if(!e.isComposing)plainify(el);   // 강조 span 안으로 빨려 들어가지 않게
    e.preventDefault();
    if(e.isComposing)return;          // 한글 조합 확정용 Enter 는 행을 만들지 않는다
    if(isGoal){focusGoal(addSibling(el.dataset.id));return;}
    el.blur();   // title / number cells: Enter commits, no newline
  });

  // ----- drag & drop reorder -----
  var drag=null;
  function clearMarks(){[].forEach.call(tb.querySelectorAll(".dropbefore,.dropafter,.dropnest"),function(r){r.classList.remove("dropbefore","dropafter","dropnest");});}
  function zoneOf(row,clientY){var r=row.getBoundingClientRect(),y=clientY-r.top,h=r.height;
    var edge=Math.min(h*0.22,14);
    return y<edge?"before":(y>h-edge?"after":"nest");}
  function rowFromPoint(x,y){var el=document.elementFromPoint(x,y);return el&&el.closest?el.closest(".row"):null;}
  function onMove(e){
    if(!drag)return;clearMarks();
    var row=rowFromPoint(e.clientX,e.clientY);
    if(row&&row.dataset.id!==drag.id){var z=zoneOf(row,e.clientY);
      row.classList.add(z==="before"?"dropbefore":z==="after"?"dropafter":"dropnest");}
  }
  function onUp(e){
    document.removeEventListener("mousemove",onMove);document.removeEventListener("mouseup",onUp);
    document.body.classList.remove("dragging-active");
    var dr=tb.querySelector(".dragrow");if(dr)dr.classList.remove("dragrow");
    var row=rowFromPoint(e.clientX,e.clientY),d=drag;drag=null;clearMarks();
    if(d&&row&&row.dataset.id!==d.id)reorder(d.id,row.dataset.id,zoneOf(row,e.clientY));
  }
  tb.addEventListener("mousedown",function(e){
    var h=e.target.closest(".dragh");if(!h)return;
    e.preventDefault();
    drag={id:h.dataset.id};
    var row=h.closest(".row");if(row)row.classList.add("dragrow");
    document.body.classList.add("dragging-active");
    document.addEventListener("mousemove",onMove);document.addEventListener("mouseup",onUp);
  });
  function reorder(srcId,tgtId,mode){
    if(srcId===tgtId)return;
    var src=getTask(srcId),tgt=getTask(tgtId);if(!src||!tgt)return;
    if(isDesc(tgtId,srcId))return;                 // 자기 하위로는 이동 불가
    // 최대 3단계(MAXDEPTH=2). 옮기려는 항목이 자기 하위를 데리고 가므로 그 깊이까지 합산해 검사한다.
    if(mode==="nest"){
      if(tgt.id===srcId)return;
      if(depthOf(tgt.id)+1+subDepth(srcId)>MAXDEPTH){alert("최대 3단계까지만 묶을 수 있습니다.");return;}
      src.parent=tgt.id;src.pri=9999;touch(src);
    }else{
      var newParent=tgt.parent||null;
      if(newParent===srcId)return;
      if(depthOf(tgt.id)+subDepth(srcId)>MAXDEPTH){alert("최대 3단계까지만 묶을 수 있습니다.");return;}
      src.parent=newParent;
      var sibs=childrenOf(newParent).filter(function(x){return x.id!==srcId;}).map(function(x){return x.id;});
      var ti=sibs.indexOf(tgtId);
      if(ti<0)sibs.push(srcId);else sibs.splice(mode==="before"?ti:ti+1,0,srcId);
      sibs.forEach(function(id,i){var x=getTask(id);if(x){x.pri=i+1;touch(x);}});
    }
    renumberAll();saveLocal();render();
  }

  // ----- mobile swipe-to-delete (touch): drag a card left past the threshold to remove it -----
  (function(){
    var sw=null;                     // active swipe: {row,id,x0,y0,dir}
    var THRESH=110;                  // px past which a release deletes
    function reset(row){row.classList.remove("swiping","willdel");row.style.transition="transform .18s ease";row.style.transform="";}
    tb.addEventListener("touchstart",function(e){
      if(readOnly||e.touches.length!==1)return;
      var row=e.target.closest(".row");if(!row)return;
      sw={row:row,id:row.dataset.id,x0:e.touches[0].clientX,y0:e.touches[0].clientY,dir:0};
      row.style.transition="";
    },{passive:true});
    tb.addEventListener("touchmove",function(e){
      if(!sw)return;
      var dx=e.touches[0].clientX-sw.x0,dy=e.touches[0].clientY-sw.y0;
      if(sw.dir===0){
        if(Math.abs(dx)<8&&Math.abs(dy)<8)return;
        sw.dir=Math.abs(dx)>Math.abs(dy)?"h":"v";
        if(sw.dir==="v"){sw=null;return;}          // vertical intent → let the list scroll
        sw.row.classList.add("swiping");
      }
      e.preventDefault();                           // horizontal: block scroll, follow the finger
      var t=Math.max(-window.innerWidth*0.9,Math.min(0,dx));
      sw.row.style.transform="translateX("+t+"px)";
      sw.row.classList.toggle("willdel",t<=-THRESH);
    },{passive:false});
    tb.addEventListener("touchend",function(e){
      if(!sw)return;
      var s=sw;sw=null;
      var dx=e.changedTouches[0].clientX-s.x0;
      if(s.dir==="h"&&dx<=-THRESH){
        var t=getTask(s.id);
        if(t&&confirm("이 항목을 삭제할까요?\n\n"+(t.what||""))){
          s.row.style.transition="transform .18s ease";s.row.style.transform="translateX(-100%)";
          setTimeout(function(){
            state.tasks.forEach(function(x){if((x.parent||null)===t.id){x.parent=(t.parent||null);touch(x);}});   // 하위는 조부모로(3뎁스에서 최상위 승격 방지)
            t._del=true;touch(t);renumberAll();saveLocal();render();
          },170);
          return;
        }
      }
      reset(s.row);
    },{passive:true});
    tb.addEventListener("touchcancel",function(){if(sw){reset(sw.row);sw=null;}},{passive:true});
  })();

  // ----- add project modal -----
  var TPL="프로젝트명 : \n담당 : \n기한(월/일) : ";
  function openModal(){if(readOnly){alert("지난 주는 보기 전용입니다. '현재' 주차에서 추가해 주세요.");return;}
    document.getElementById("taskInput").value=TPL;document.getElementById("modal").hidden=false;
    setTimeout(function(){document.getElementById("taskInput").focus();},30);}
  function closeModal(){document.getElementById("modal").hidden=true;}
  document.getElementById("addBtn").addEventListener("click",openModal);
  document.getElementById("mClose").addEventListener("click",closeModal);
  document.getElementById("mCancel").addEventListener("click",closeModal);
  document.getElementById("modal").addEventListener("click",function(e){if(e.target.id==="modal")closeModal();});

  // simple project registration — one field per line, only the name is required
  function parseTask(text){
    function line(re){var m=re.exec(text);return m?text.slice(m.index+m[0].length).split("\n")[0].trim():"";}
    return {what:line(/프로젝트명?\s*[:：]/),owner:line(/담당\s*[:：]/),due:line(/기한[^:：\n]*[:：]/)};
  }
  document.getElementById("mAdd").addEventListener("click",function(){
    var p=parseTask(document.getElementById("taskInput").value);
    if(!p.what){alert("프로젝트명을 입력해 주세요.");return;}
    var maxp=state.tasks.reduce(function(m,t){return t._del?m:Math.max(m,t.pri||0);},0);
    state.tasks.push({id:"t"+Date.now(),parent:null,pri:maxp+1,what:p.what,division:"",asis:"",tobe:"",owner:p.owner||"—",due:p.due||"—",
      wedPct:null,wedNote:"—",friStatus:"진행중",friNote:"—",_v:Date.now()});
    saveLocal();closeModal();render();
  });



  // ----- editable title -----
  var docTitle=document.getElementById("docTitle");
  docTitle.textContent=state.title;
  docTitle.addEventListener("input",function(){if(readOnly)return;state.title=docTitle.textContent.trim();state._mv=Date.now();saveLocal();});
  docTitle.addEventListener("keydown",function(e){if(e.key==="Enter"){e.preventDefault();docTitle.blur();}});
  document.getElementById("weekSel").addEventListener("change",function(e){switchWeek(e.target.value);});
  document.getElementById("newWeekBtn").addEventListener("click",startNewWeek);
  var divbarEl=document.getElementById("divbar");   // 부문 필터바 (데스크톱 칩 / 모바일 셀렉)
  if(divbarEl){
    divbarEl.addEventListener("click",function(e){var b=e.target.closest(".dfil");if(b)setViewDiv(b.dataset.div);});
    divbarEl.addEventListener("change",function(e){if(e.target.id==="divsel")setViewDiv(e.target.value);});
  }

  // 서식 없는 순수 텍스트로만 붙여넣기 (문서 기본 폰트 유지)
  document.addEventListener("paste",function(e){
    var el=e.target;if(!el||!el.isContentEditable)return;
    e.preventDefault();
    var text=((e.clipboardData||window.clipboardData).getData("text/plain")||"").replace(/\r/g,"");
    document.execCommand("insertText",false,text);
  });

  document.addEventListener("keydown",function(e){if(e.key==="Escape")closeModal();});
  // a remote change that arrived while the user was typing is applied once they leave the field
  document.addEventListener("focusout",function(){setTimeout(function(){if(pendingRender&&!isEditing())render();},0);});

  // ----- dark mode -----
  function applyTheme(d){document.body.classList.toggle("dark",d);
    document.querySelector("#themeBtn .ms").textContent=d?"light_mode":"dark_mode";}
  var dark=false;try{dark=localStorage.getItem("axp_theme")==="dark";}catch(e){}
  applyTheme(dark);
  document.getElementById("themeBtn").addEventListener("click",function(){
    dark=!dark;applyTheme(dark);try{localStorage.setItem("axp_theme",dark?"dark":"light");}catch(e){}});

  render();
  initSupabase();
})();
