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
  var CLIENT=Math.random().toString(36).slice(2);
  var sb=null,saveT=null;
  var curWeek=null,viewWeek=null,readOnly=false,weeksList=[],weekLabels={},EDITABLE=true;
  function isoDate(d){return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());}
  function mondayOf(d){var x=new Date(d);var day=(x.getDay()+6)%7;x.setDate(x.getDate()-day);x.setHours(0,0,0,0);return x;}
  function isoWeekId(d){var t=mondayOf(d);t.setDate(t.getDate()+3);var w1=new Date(t.getFullYear(),0,4);
    var n=1+Math.round(((t-w1)/864e5-3+((w1.getDay()+6)%7))/7);return t.getFullYear()+"-W"+pad(n);}
  function normalize(st){st=st||{};if(!st.title)st.title="주간 리듬 미팅";if(!st.part)st.part="UX 기획파트";if(!st.tasks)st.tasks=[];
    st.tasks.forEach(function(t,i){if(t.id==null)t.id="t"+i+"_"+Math.random().toString(36).slice(2,7);if(t.asis===undefined&&t.tobe===undefined){t.asis=t.why||"";t.tobe="";}});return st;}
  function applyView(d){state=normalize(d);readOnly=(viewWeek!==curWeek);
    var dt=document.getElementById("docTitle"),dp=document.getElementById("docPart");if(dt)dt.textContent=state.title;if(dp)dp.textContent=state.part;
    refreshWeekSel();render();}
  function saveRemote(){if(!sb||readOnly||!viewWeek)return;clearTimeout(saveT);saveT=setTimeout(function(){
    if(!state.label)state.label=weekLabel(new Date());
    sb.from("rhythm").upsert({id:viewWeek,data:Object.assign({},state,{_by:CLIENT}),updated_at:new Date().toISOString()}).then(function(){},function(){});},400);}
  function touch(t){if(t)t._v=Date.now();}
  var pendingRender=false;
  function isEditing(){var a=document.activeElement;if(!a)return false;
    if(a.id==="docTitle"||a.id==="docPart")return true;
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
    var dt=document.getElementById("docTitle"),dp=document.getElementById("docPart");
    if(dt&&document.activeElement!==dt)dt.textContent=state.title;
    if(dp&&document.activeElement!==dp)dp.textContent=state.part;
    refreshWeekSel();scheduleRender();
    if(dirty)saveRemote();}
  function refreshWeekSel(){var sel=document.getElementById("weekSel");if(!sel)return;
    sel.innerHTML=weeksList.map(function(id){var lb=(weekLabels[id]||id)+(id===curWeek?" · 현재":"");
      return '<option value="'+id+'"'+(id===viewWeek?" selected":"")+'>'+lb+'</option>';}).join("");}
  function switchWeek(id){if(!sb||id===viewWeek)return;
    sb.from("rhythm").select("data").eq("id",id).single().then(function(r){if(r&&r.data&&r.data.data){viewWeek=id;applyView(r.data.data);}},function(){});}
  function startNewWeek(){if(!sb){alert("DB 연결이 필요합니다.");return;}
    if(viewWeek!==curWeek){alert("현재 주차에서만 새 주차를 시작할 수 있습니다.\n주차 선택을 '현재'로 바꿔 주세요.");return;}
    if(!confirm("이번 주를 마감하고 새 주차를 시작할까요?\n\n· 완료된 과업은 이번 주 기록에 보관됩니다.\n· 미완료 과업만 새 주차로 이월됩니다."))return;
    var curStart=state.start?new Date(state.start):mondayOf(new Date());
    var ns=new Date(curStart);ns.setDate(ns.getDate()+7);var newId=isoWeekId(ns);
    while(weeksList.indexOf(newId)>=0){ns.setDate(ns.getDate()+7);newId=isoWeekId(ns);}
    var carried=state.tasks.filter(function(t){return !t._del&&t.friStatus!=="완료";}).map(function(t){
      return {id:t.id,parent:(t.parent||null),pri:t.pri,what:t.what,asis:t.asis,tobe:t.tobe,owner:t.owner,due:t.due,wedPct:null,wedNote:"—",friStatus:"진행중",friNote:"—",_v:Date.now()};});
    var keep={};carried.forEach(function(t){keep[t.id]=1;});
    carried.forEach(function(t){if(t.parent&&!keep[t.parent])t.parent=null;});
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
  var COLS_PROJECT="4.2rem minmax(0,1fr) 9rem 10rem";        // NO | 프로젝트(+히스토리) | 담당 | 기한
  var COLS_HISTORY="4.2rem auto minmax(0,1fr) 9rem 10rem";   // ↳ | 상태 | 한 일 | 담당 | 기한
  var STATUS=[
    {k:"진행중",icon:"radio_button_unchecked",cls:""},
    {k:"완료",icon:"check_circle",cls:"done"},
    {k:"보류",icon:"pause_circle",cls:"hold"},
    {k:"이월",icon:"arrow_circle_right",cls:"carry"},
    {k:"대기",icon:"pending",cls:"wait"}
  ];
  function statusObj(k){for(var i=0;i<STATUS.length;i++)if(STATUS[i].k===k)return STATUS[i];return STATUS[0];}
  function esc(s){return String(s).replace(/[&<>]/g,function(m){return{"&":"&amp;","<":"&lt;",">":"&gt;"}[m];});}
  function escAttr(s){return esc(s).replace(/"/g,"&quot;");}
  function CE(){return EDITABLE?" contenteditable":"";}
  function edWhat(t){return '<div class="what"'+CE()+' data-field="what" data-id="'+t.id+'" title="'+escAttr(t.what)+'">'+esc(t.what)+'</div>';}
  function segHtml(p){var on=Math.round((p||0)/20),h="";for(var i=0;i<5;i++)h+='<span class="seg'+(i<on?" on":"")+'" data-i="'+i+'"></span>';return h;}
  function progCell(t){
    var hold=(t.wedPct===null||t.wedPct===undefined||t.wedPct==="");
    var bar='<div class="bar">'+segHtml(hold?0:t.wedPct)+'</div>';
    var val=hold
      ? '<span class="val"><span class="holdv"'+CE()+' data-field="wedPct" data-id="'+t.id+'"></span></span>'
      : '<span class="val"><span'+CE()+' data-field="wedPct" data-id="'+t.id+'">'+t.wedPct+'</span><span class="sign">%</span></span>';
    return '<div class="prog" data-id="'+t.id+'">'+val+bar+'</div>';
  }
  function chipCell(t){var s=statusObj(t.friStatus);
    return '<button class="chip '+s.cls+'" data-id="'+t.id+'"><span class="ms">'+s.icon+'</span>'+esc(t.friStatus)+'</button>';}
  function ed(f,id,v,cls,lab){return '<div class="'+cls+'"'+CE()+' data-field="'+f+'" data-id="'+id+'"'+(lab?' data-label="'+lab+'"':'')+'>'+esc(v)+'</div>';}
  function purposeCell(t){
    if(t.asis===undefined&&t.tobe===undefined)
      return '<div class="why"'+CE()+' data-field="why" data-id="'+t.id+'">'+esc(t.why||"")+'</div>';
    return '<div class="purpose">'
      +'<div class="pl"><span class="plk asis">AS-IS</span><span class="ped"'+CE()+' data-field="asis" data-id="'+t.id+'">'+esc(t.asis||"")+'</span></div>'
      +'<div class="pl"><span class="plk tobe">TO-BE</span><span class="ped"'+CE()+' data-field="tobe" data-id="'+t.id+'">'+esc(t.tobe||"")+'</span></div>'
      +'</div>';
  }
  var ROSTER=["이해원 차장","이재현 대리","정유나 대리","UX 파트"];
  function ownerList(){return ["—"].concat(ROSTER);}
  function ownerCell(t){
    var label=(t.owner&&t.owner!=="—")?t.owner:"미정";
    var idx=(!t.owner||t.owner==="—")?0:(ROSTER.indexOf(t.owner)+1);if(idx<0)idx=0;
    return '<button class="ochip o'+idx+'" data-field="owner" data-id="'+t.id+'"><span class="ms">person</span>'+esc(label)+'</button>';
  }
  function dueToISO(d){if(!d)return"";if(/^\d{4}-\d{2}-\d{2}$/.test(d))return d;
    var m=/^(\d{1,2})[\/.\-](\d{1,2})$/.exec(d);if(m)return new Date().getFullYear()+"-"+pad(+m[1])+"-"+pad(+m[2]);return"";}
  function dueCell(t){var iso=dueToISO(t.due);return '<div class="duec'+(iso?"":" empty")+'" data-label="기한"><input type="date" class="fdate"'+(EDITABLE?"":" disabled")+' data-field="due" data-id="'+t.id+'" value="'+iso+'"></div>';}

  // ----- tree (group) helpers -----
  function childrenOf(pid){return state.tasks.filter(function(x){return !x._del&&(x.parent||null)===pid;}).sort(function(a,b){return(a.pri||99)-(b.pri||99);});}
  function buildOrder(){var res=[];(function walk(pid,depth){childrenOf(pid).forEach(function(t){res.push({t:t,depth:depth});walk(t.id,depth+1);});})(null,0);return res;}
  function isDesc(aId,bId){var t=getTask(aId),g=0;while(t&&t.parent&&g++<200){if(t.parent===bId)return true;t=getTask(t.parent);}return false;}
  function renumberAll(){
    var pids=[null].concat(state.tasks.map(function(t){return t.id;}));
    pids.forEach(function(pid){childrenOf(pid).forEach(function(t,i){if(t.pri!==i+1){t.pri=i+1;touch(t);}});});
  }

  // Every top-level task is a PROJECT header (name + owner + date + "+히스토리"); its own
  // legacy day-fields stay in the data but aren't shown. Its children are the project's
  // HISTORY log — one line each: status + what(한 일) + owner + date.
  function projectHeaderCells(t){
    return '<div class="pri"'+CE()+' data-field="pri" data-id="'+t.id+'">'+pad(t.pri)+'</div>'
      +'<div class="phead"><div class="what"'+CE()+' data-field="what" data-id="'+t.id+'" title="'+escAttr(t.what)+'">'+esc(t.what)+'</div>'
      +(EDITABLE?'<button class="addhist" data-id="'+t.id+'" title="히스토리 추가"><span class="ms">add</span>히스토리</button>':'')+'</div>'
      +ownerCell(t)+dueCell(t);
  }
  function historyCells(t){
    return '<div class="pri sub" data-id="'+t.id+'"><span class="ms">subdirectory_arrow_right</span></div>'
      +chipCell(t)+ed("what",t.id,t.what||"","note histwhat","한 일")+ownerCell(t)+dueCell(t);
  }

  function render(){
    EDITABLE=!readOnly;
    document.getElementById("today").textContent=fmtToday(new Date());
    document.getElementById("weekLabel").textContent=(state.label||weekLabel(new Date()))+(readOnly?"  ·  보기 전용":"");
    var dtt=document.getElementById("docTitle"),dpp=document.getElementById("docPart");if(dtt)dtt.contentEditable=EDITABLE;if(dpp)dpp.contentEditable=EDITABLE;
    var ab=document.getElementById("addBtn");if(ab)ab.style.display=EDITABLE?"":"none";

    var order=buildOrder();
    var tb=document.getElementById("tbody");
    tb.style.gridTemplateRows="repeat("+Math.max(order.length,1)+",minmax(min-content,1fr))";
    tb.innerHTML=order.map(function(o){
      var t=o.t,depth=o.depth,cells,gridCols,extra;
      if(depth>0){                         // child → history entry (faint grey, indented)
        cells=historyCells(t);gridCols=COLS_HISTORY;extra=" history child";
      }else{                               // top-level → project header (no tint) even with no children yet
        cells=projectHeaderCells(t);gridCols=COLS_PROJECT;extra=" project";
      }
      var done=depth>0&&/완료/.test(t.friStatus);
      return '<div class="row'+(done?" done":"")+extra+'" data-id="'+t.id+'" style="grid-template-columns:'+gridCols+'">'+
        (EDITABLE?'<span class="dragh" data-id="'+t.id+'" aria-label="순서 이동"><span class="ms">drag_indicator</span></span>':'')+
        cells+
        (EDITABLE?'<button class="del" data-id="'+t.id+'" aria-label="삭제"><span class="ms">delete</span></button>':'')+'</div>';
    }).join("");
    pendingRender=false;
  }
  function getTask(id){return state.tasks.filter(function(x){return String(x.id)===String(id);})[0];}

  var tb=document.getElementById("tbody");
  tb.addEventListener("input",function(e){
    if(readOnly)return;
    var el=e.target;if(!el.dataset||!el.dataset.field)return;
    if(el.tagName==="SELECT"||el.tagName==="INPUT")return;
    var t=getTask(el.dataset.id);if(!t)return;
    var f=el.dataset.field;
    if(f==="wedPct"){var raw=el.textContent.replace(/[^0-9]/g,"");var box=el.closest(".prog");
      if(raw===""){t.wedPct=null;if(box)box.querySelector(".bar").innerHTML=segHtml(0);}
      else{var n=Math.max(0,Math.min(100,parseInt(raw,10)));t.wedPct=n;if(box)box.querySelector(".bar").innerHTML=segHtml(n);}
      if(t.wedPct===100)t.friStatus="완료";else if(t.friStatus==="완료")t.friStatus="진행중";}
    else if(f==="pri"){var p=parseInt(el.textContent.replace(/[^0-9]/g,""),10);if(!isNaN(p))t.pri=p;}
    else t[f]=el.innerText;
    touch(t);saveLocal();
  });
  tb.addEventListener("focusout",function(e){
    var f=e.target&&e.target.dataset&&e.target.dataset.field;
    if(f==="pri"||f==="wedPct")render();
  });
  tb.addEventListener("change",function(e){
    if(readOnly)return;
    var el=e.target;if(!el.dataset||!el.dataset.field)return;var t=getTask(el.dataset.id);if(!t)return;
    if(el.dataset.field==="due"){t.due=el.value||"—";var dc=el.closest(".duec");if(dc)dc.classList.toggle("empty",!el.value);touch(t);saveLocal();return;}
  });
  tb.addEventListener("click",function(e){
    if(readOnly)return;
    var ah=e.target.closest(".addhist");
    if(ah){var pp=getTask(ah.dataset.id);if(pp){
      var mp=childrenOf(pp.id).reduce(function(m,x){return Math.max(m,x.pri||0);},0);
      var nt={id:"t"+Date.now(),parent:pp.id,pri:mp+1,what:"",asis:"",tobe:"",owner:"—",due:"—",wedPct:null,wedNote:"—",friStatus:"진행중",friNote:"—",_v:Date.now()};
      state.tasks.push(nt);touch(pp);saveLocal();render();
      setTimeout(function(){var el=document.querySelector('.row[data-id="'+nt.id+'"] [data-field="what"]');if(el)el.focus();},30);
    }return;}
    var del=e.target.closest(".del");
    if(del){var t=getTask(del.dataset.id);if(t&&confirm("이 과업을 삭제할까요?\n\n"+t.what)){
      state.tasks.forEach(function(x){if((x.parent||null)===t.id){x.parent=null;touch(x);}});
      t._del=true;touch(t);renumberAll();saveLocal();render();}return;}
    var seg=e.target.closest(".seg");
    if(seg){var pg=seg.closest(".prog");var ts=pg&&getTask(pg.dataset.id);if(ts){
      var nv=(+seg.dataset.i+1)*20;if(ts.wedPct===nv)nv-=20;ts.wedPct=nv;
      if(nv===100)ts.friStatus="완료";else if(ts.friStatus==="완료")ts.friStatus="진행중";touch(ts);saveLocal();render();}return;}
    var oc=e.target.closest(".ochip");
    if(oc){var to=getTask(oc.dataset.id);if(!to)return;
      var list=ownerList();var oi=list.indexOf(to.owner);if(oi<0)oi=0;
      to.owner=list[(oi+1)%list.length];touch(to);saveLocal();render();return;}
    var chip=e.target.closest(".chip");
    if(chip){var tt=getTask(chip.dataset.id);if(!tt)return;
      var idx=STATUS.map(function(s){return s.k;}).indexOf(tt.friStatus);
      tt.friStatus=STATUS[(idx+1)%STATUS.length].k;touch(tt);saveLocal();render();}
  });

  // ----- multi-line bullet editing (keeps newlines; Enter starts/continues a bullet list) -----
  function placeCaretEnd(el){el.focus();var r=document.createRange();r.selectNodeContents(el);r.collapse(false);var s=window.getSelection();s.removeAllRanges();s.addRange(r);}
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
  tb.addEventListener("keydown",function(e){
    if(e.key!=="Enter"||readOnly)return;
    var el=e.target;if(!el||!el.isContentEditable)return;
    if(el.classList.contains("why")||el.classList.contains("note")){   // multi-line content fields
      e.preventDefault();
      if(e.shiftKey){insertAtCaret(el,"\n");return;}                    // plain line break
      var txt=el.innerText;
      if(txt.indexOf("•")===-1&&txt.trim()){                           // first Enter → bullet every line
        var lines=bulletLines(txt);lines.push("• ");
        el.innerText=lines.join("\n");placeCaretEnd(el);
        el.dispatchEvent(new Event("input",{bubbles:true}));
      }else{insertAtCaret(el,txt.trim()?"\n• ":"• ");}                 // add a bullet at the caret
      return;
    }
    e.preventDefault();el.blur();   // title / number cells: Enter commits, no newline
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
    if(mode==="nest"){
      var groupId=(tgt.parent||null)!=null?tgt.parent:tgt.id;   // 깊이 1단계로 고정
      if(groupId===srcId)return;
      if(childrenOf(srcId).length>0){alert("하위 과업이 있는 항목은 그룹에 넣을 수 없습니다.\n먼저 하위 과업을 분리해 주세요.");return;}
      src.parent=groupId;src.pri=9999;touch(src);
    }else{
      var newParent=tgt.parent||null;
      if(newParent===srcId)return;
      if(newParent!=null&&childrenOf(srcId).length>0){alert("하위 과업이 있는 항목은 그룹 안으로 옮길 수 없습니다.");return;}
      src.parent=newParent;
      var sibs=childrenOf(newParent).filter(function(x){return x.id!==srcId;}).map(function(x){return x.id;});
      var ti=sibs.indexOf(tgtId);
      if(ti<0)sibs.push(srcId);else sibs.splice(mode==="before"?ti:ti+1,0,srcId);
      sibs.forEach(function(id,i){var x=getTask(id);if(x){x.pri=i+1;touch(x);}});
    }
    renumberAll();saveLocal();render();
  }

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
    state.tasks.push({id:"t"+Date.now(),parent:null,pri:maxp+1,what:p.what,asis:"",tobe:"",owner:p.owner||"—",due:p.due||"—",
      wedPct:null,wedNote:"—",friStatus:"진행중",friNote:"—",_v:Date.now()});
    saveLocal();closeModal();render();
  });



  // ----- editable title / part -----
  var docTitle=document.getElementById("docTitle"),docPart=document.getElementById("docPart");
  docTitle.textContent=state.title;docPart.textContent=state.part;
  docTitle.addEventListener("input",function(){if(readOnly)return;state.title=docTitle.textContent.trim();state._mv=Date.now();saveLocal();});
  docPart.addEventListener("input",function(){if(readOnly)return;state.part=docPart.textContent.trim();state._mv=Date.now();saveLocal();});
  [docTitle,docPart].forEach(function(el){el.addEventListener("keydown",function(e){if(e.key==="Enter"){e.preventDefault();el.blur();}});});
  document.getElementById("weekSel").addEventListener("change",function(e){switchWeek(e.target.value);});
  document.getElementById("newWeekBtn").addEventListener("click",startNewWeek);

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
