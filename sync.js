/* Beer Stocking. Copyright (c) 2026 Keegan Beckstrom. All rights reserved. Not licensed for copying, modification or reuse. */
/* Accounts and shared data (Supabase).
   This phone keeps its own copy (localStorage) so the app works with no signal. Every change is sent to Supabase when there's
   a connection, and changes from everyone else's phones arrive live. Each row is one thing (an item on a store's list, a shelf
   amount, a back-stock count...), so two people working different items never overwrite each other; on the same item, the
   last change wins. */
(()=>{
const SB_URL="https://azryfyyseefrydrpuoxi.supabase.co";
const SB_KEY="sb_publishable_qtYDg-1NP5nk1RAKCTwpxQ_FJXC_SCu"; // public key, safe in the page: the database only answers signed-in team members
const sb=window.supabase&&window.supabase.createClient?window.supabase.createClient(SB_URL,SB_KEY,{auth:{persistSession:true,autoRefreshToken:true,storageKey:"bs-auth"}}):null;
let user=null;

/* ---------- Rows: what each table holds, built from this phone's copy ---------- */
const TABLES=["stores","custom_items","routes","schedule","list_items","shelf","back_stock","pulls"];
const PK={stores:"id",custom_items:"id",routes:"id",schedule:"id",list_items:"store_id,kind,item_id",shelf:"store_id,item_id",back_stock:"store_id,item_id",pulls:"id"};
const int=v=>v==null||v===""?null:(v|0);
const N={ // one shape per table, so a row from this phone and the same row from Supabase compare equal
  stores:r=>({id:r.id,name:r.name||"",chain:r.chain||null,town:r.town||null,num:r.num||null,county:r.county||null,pos:r.pos|0}),
  routes:r=>({id:r.id,name:r.name||"",county:r.county||null,store_ids:Array.isArray(r.store_ids)?r.store_ids.slice():[],pos:r.pos|0}),
  schedule:r=>({id:r.id,user_id:r.user_id,route_id:r.route_id,day:r.day|0}),
  custom_items:r=>({id:r.id,brand:r.brand,flavor:r.flavor||"",size:r.size}),
  list_items:r=>({store_id:r.store_id,kind:r.kind,item_id:r.item_id,pos:r.pos|0,qty:r.qty|0,floor:int(r.floor),seen:!!r.seen,done:!!r.done,out:int(r.out),note:r.note||null}),
  shelf:r=>({store_id:r.store_id,item_id:r.item_id,cap:r.cap|0}),
  back_stock:r=>({store_id:r.store_id,item_id:r.item_id,n:r.n|0}),
  pulls:r=>({id:r.id,store_id:r.store_id,store_name:r.store_name,kind:r.kind,at:r.at,by_name:r.by_name||"",items:r.items||{},need:r.need||{}})
};
const K={stores:r=>r.id,custom_items:r=>r.id,routes:r=>r.id,schedule:r=>r.id,list_items:r=>r.store_id+"|"+r.kind+"|"+r.item_id,shelf:r=>r.store_id+"|"+r.item_id,back_stock:r=>r.store_id+"|"+r.item_id,pulls:r=>r.id};
const J=r=>JSON.stringify(r);
const kindOf=c=>c.startsWith("store:")?"truck":"backstock", prefOf=k=>k==="truck"?"store:":"backstock:";

function localRows(){
  const R={}; TABLES.forEach(t=>R[t]={});
  const ids=new Set(store.stores.map(s=>s.id));
  store.stores.forEach((s,i)=>{R.stores[s.id]=N.stores({...s,pos:i});});
  store.custom.forEach(([b,f,z])=>{const id=key(b,f,z); R.custom_items[id]=N.custom_items({id,brand:b,flavor:f,size:z});});
  store.routes.forEach((r,i)=>{R.routes[r.id]=N.routes({...r,pos:i});});
  const rids=new Set(store.routes.map(r=>r.id));
  store.schedule.forEach(a=>{if(rids.has(a.route_id)) R.schedule[a.id]=N.schedule(a);});
  for(const c in store.lists){
    const l=store.lists[c], sid=c.slice(c.indexOf(":")+1), kind=kindOf(c); if(!ids.has(sid)) continue;
    (l.list||[]).forEach((id,i)=>{const r=N.list_items({store_id:sid,kind,item_id:id,pos:i,qty:l.qty&&l.qty[id],floor:l.floor&&id in l.floor?l.floor[id]:null,
      seen:l.seen&&l.seen[id],done:l.done&&l.done[id],out:l.out&&id in l.out?l.out[id]:null,note:l.note&&l.note[id]}); R.list_items[K.list_items(r)]=r;});
  }
  for(const sid in store.shelf) if(ids.has(sid)) for(const id in store.shelf[sid]) R.shelf[sid+"|"+id]=N.shelf({store_id:sid,item_id:id,cap:store.shelf[sid][id]});
  for(const sid in store.inv) if(ids.has(sid)) for(const id in store.inv[sid]) R.back_stock[sid+"|"+id]=N.back_stock({store_id:sid,item_id:id,n:store.inv[sid][id].n});
  store.history.forEach(e=>{if(e.id) R.pulls[e.id]=N.pulls({id:e.id,store_id:e.sid,store_name:e.sname,kind:e.kind,at:new Date(e.t).toISOString(),by_name:e.user,items:e.items,need:e.need});});
  return R;
}

/* ---------- Putting a row from Supabase into this phone's copy ---------- */
function listOf(sid,kind){const c=prefOf(kind)+sid; return store.lists[c]||(store.lists[c]={list:[],qty:{},done:{},seen:{},note:{},out:{},floor:{}});}
function applyRow(t,r){
  if(t==="routes"){const o={id:r.id,name:r.name,county:r.county||undefined,store_ids:(r.store_ids||[]).slice(),pos:r.pos}, i=store.routes.findIndex(x=>x.id===r.id);
    if(i<0) store.routes.push(o); else store.routes[i]=o; store.routes.sort((a,b)=>(a.pos??0)-(b.pos??0));}
  else if(t==="schedule"){const o={id:r.id,user_id:r.user_id,route_id:r.route_id,day:r.day}, i=store.schedule.findIndex(x=>x.id===r.id); if(i<0) store.schedule.push(o); else store.schedule[i]=o;}
  else if(t==="stores"){const o={id:r.id,name:r.name,chain:r.chain||undefined,town:r.town||undefined,num:r.num||undefined,county:r.county||undefined,pos:r.pos}, i=store.stores.findIndex(s=>s.id===r.id);
    if(i<0) store.stores.push(o); else store.stores[i]=Object.assign(store.stores[i],o);
    store.stores.sort((a,b)=>(a.pos??0)-(b.pos??0));}
  else if(t==="custom_items"){if(!store.custom.some(([b,f,z])=>key(b,f,z)===r.id)) store.custom.push([r.brand,r.flavor,r.size]); ensureBrand(r.brand); addCat(r.brand,r.flavor,r.size,true);}
  else if(t==="list_items"){const l=listOf(r.store_id,r.kind), id=r.item_id;
    ["qty","done","seen","note","out","floor"].forEach(k=>{l[k]=l[k]||{};});
    const at=l.list.indexOf(id); if(at!==r.pos){if(at>=0) l.list.splice(at,1); l.list.splice(Math.min(r.pos,l.list.length),0,id);}
    if(r.qty>0) l.qty[id]=r.qty; else delete l.qty[id];
    if(r.floor!=null) l.floor[id]=r.floor; else delete l.floor[id];
    if(r.seen) l.seen[id]=true; else delete l.seen[id];
    if(r.done) l.done[id]=true; else delete l.done[id];
    if(r.out!=null) l.out[id]=r.out; else delete l.out[id];
    if(r.note) l.note[id]=r.note; else delete l.note[id];}
  else if(t==="shelf"){(store.shelf[r.store_id]=store.shelf[r.store_id]||{})[r.item_id]=r.cap;}
  else if(t==="back_stock"){(store.inv[r.store_id]=store.inv[r.store_id]||{})[r.item_id]={n:r.n,t:Date.parse(r.updated_at)||Date.now()};}
  else if(t==="pulls"){if(!store.history.some(e=>e.id===r.id)){store.history.push({id:r.id,t:Date.parse(r.at)||Date.now(),sid:r.store_id,sname:r.store_name,kind:r.kind,user:r.by_name||"",items:r.items||{},need:r.need||{}}); store.history.sort((a,b)=>a.t-b.t);}}
}
function removeRow(t,k){
  if(t==="routes"){store.routes=store.routes.filter(r=>r.id!==k); store.schedule=store.schedule.filter(a=>a.route_id!==k);}
  else if(t==="schedule"){store.schedule=store.schedule.filter(a=>a.id!==k);}
  else if(t==="stores"){store.stores=store.stores.filter(s=>s.id!==k); delete store.lists["store:"+k]; delete store.lists["backstock:"+k];}
  else if(t==="custom_items"){store.custom=store.custom.filter(([b,f,z])=>key(b,f,z)!==k);}
  else if(t==="list_items"){const [sid,kind,id]=k.split("|"), l=store.lists[prefOf(kind)+sid]; if(!l) return;
    l.list=(l.list||[]).filter(x=>x!==id); ["qty","done","seen","note","out","floor"].forEach(m=>{if(l[m]) delete l[m][id];});}
  else if(t==="shelf"){const [sid,id]=k.split("|"); if(store.shelf[sid]) delete store.shelf[sid][id];}
  else if(t==="back_stock"){const [sid,id]=k.split("|"); if(store.inv[sid]) delete store.inv[sid][id];}
  else if(t==="pulls"){store.history=store.history.filter(e=>e.id!==k);}
}

/* ---------- What Supabase last confirmed, per row; anything different on this phone still needs sending ---------- */
const SYNC_KEY="bs-synced-v1";
let synced=(()=>{try{const s=JSON.parse(localStorage.getItem(SYNC_KEY)); if(s&&s.stores) return s;}catch(e){} const o={}; TABLES.forEach(t=>o[t]={}); return o;})();
TABLES.forEach(t=>{if(!synced[t]) synced[t]={};}); // tables added in later versions
const keepSynced=()=>{try{localStorage.setItem(SYNC_KEY,JSON.stringify(synced));}catch(e){}};
const keepLocal=()=>{try{localStorage.setItem(KEY,JSON.stringify(store));}catch(e){}};

/* ---------- Status pill (only shows when something hasn't reached everyone yet) ---------- */
const pill=document.createElement("div"); pill.id="syncpill"; pill.hidden=true; pill.setAttribute("role","status"); document.body.appendChild(pill);
function status(s){pill.hidden=s==="ok"; pill.textContent=s==="saving"?"Saving…":s==="offline"?"No signal · saved on this phone, will send when back online":"";}

/* ---------- Sending changes ---------- */
let flushing=false, again=false, timer=0;
window.onSave=()=>{if(!user) return; clearTimeout(timer); status("saving"); timer=setTimeout(flush,500);};
async function flush(){
  if(!user||!sb) return;
  if(flushing){again=true;return;}
  flushing=true;
  try{
    const L=localRows(); let sent=0;
    for(const t of TABLES){
      const up=[]; for(const k in L[t]){const j=J(L[t][k]); if(synced[t][k]!==j) up.push([k,L[t][k],j]);}
      if(t==="pulls"){const ins=up.filter(([k])=>!(k in synced.pulls));
        for(let i=0;i<ins.length;i+=200){const part=ins.slice(i,i+200); const {error}=await sb.from(t).upsert(part.map(x=>x[1]),{onConflict:"id",ignoreDuplicates:true}); if(error) throw error; part.forEach(([k,,j])=>{synced.pulls[k]=j;}); sent+=part.length;}
        continue;}
      for(let i=0;i<up.length;i+=400){const part=up.slice(i,i+400); const {error}=await sb.from(t).upsert(part.map(x=>x[1]),{onConflict:PK[t]}); if(error) throw error; part.forEach(([k,,j])=>{synced[t][k]=j;}); sent+=part.length;}
    }
    // Deletes after everything else is in (stores last, since their lists go with them)
    for(const t of ["schedule","list_items","shelf","back_stock","custom_items","routes","stores"]){
      const gone=Object.keys(synced[t]).filter(k=>!(k in L[t])); if(!gone.length) continue;
      if(t==="stores"||t==="custom_items"||t==="routes"||t==="schedule"){const {error}=await sb.from(t).delete().in("id",gone); if(error) throw error;}
      else{const groups={}; gone.forEach(k=>{const p=k.split("|"), g=p.slice(0,-1).join("|"); (groups[g]=groups[g]||[]).push(p[p.length-1]);});
        for(const g in groups){const p=g.split("|"); let q=sb.from(t).delete().eq("store_id",p[0]); if(t==="list_items") q=q.eq("kind",p[1]);
          for(let i=0;i<groups[g].length;i+=200){const {error}=await q.in("item_id",groups[g].slice(i,i+200)); if(error) throw error;}}}
      gone.forEach(k=>{delete synced[t][k];}); sent+=gone.length;
    }
    keepSynced(); status("ok");
  }catch(e){console.warn("sync",e); status(navigator.onLine?"saving":"offline"); clearTimeout(timer); timer=setTimeout(flush,navigator.onLine?8000:20000);}
  flushing=false;
  if(again){again=false; flush();}
}
window.addEventListener("online",()=>{if(user){loadAll();}});
window.addEventListener("offline",()=>status("offline"));
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&user) loadAll();});

/* ---------- Getting everyone's data ---------- */
async function fetchAll(t){
  const out=[]; const step=1000;
  for(let i=0;;i+=step){
    let q=sb.from(t).select("*").range(i,i+step-1);
    if(t==="pulls") q=q.order("at",{ascending:false});
    const {data,error}=await q; if(error) throw error;
    out.push(...data); if(data.length<step||(t==="pulls"&&out.length>=5000)) break;
  }
  return out;
}
let loading=null;
function loadAll(){if(!loading) loading=doLoad().finally(()=>{loading=null;}); return loading;}
async function doLoad(){
  if(!user||!sb) return;
  let remote={};
  try{ for(const t of ["custom_items",...TABLES.filter(t=>t!=="custom_items")]) remote[t]=await fetchAll(t); await loadPeople(); }
  catch(e){console.warn("load",e); status("offline"); return;}
  const L=localRows();
  for(const t of ["custom_items","stores","routes","schedule","list_items","shelf","back_stock","pulls"]){
    const R={}; remote[t].forEach(r=>{R[K[t](r)]=r;});
    const pending=k=>(k in L[t])?J(L[t][k])!==synced[t][k]:(k in synced[t]); // changed or deleted here, not sent yet
    for(const k in R) if(!pending(k)) applyRow(t,R[k]);
    for(const k in L[t]) if(!(k in R)&&!pending(k)) removeRow(t,k);
    synced[t]={}; for(const k in R) synced[t][k]=J(N[t](R[k]));
  }
  // Pull lists that were on this phone before syncing started have no remote rows yet; they stay pending and get sent below
  keepSynced(); keepLocal(); refreshView(); flush();
}

// Everyone with an account, for the schedule (read only here; each person edits their own name)
async function loadPeople(){
  const {data,error}=await sb.from("profiles").select("id,first,last").order("first"); if(error) throw error;
  store.people=data.map(p=>({id:p.id,first:p.first,last:p.last}));
}

/* ---------- Live changes from other phones ---------- */
let queue=[], qtimer=0, channel=null;
function subscribe(){
  if(channel) return;
  channel=sb.channel("beer-stocking");
  TABLES.forEach(t=>channel.on("postgres_changes",{event:"*",schema:"public",table:t},ev=>{queue.push([t,ev]); clearTimeout(qtimer); qtimer=setTimeout(drain,250);}));
  channel.on("postgres_changes",{event:"*",schema:"public",table:"profiles"},()=>{loadPeople().then(()=>{keepLocal(); refreshView();}).catch(()=>{});});
  channel.subscribe(st=>{if(st==="SUBSCRIBED") loadAll();});
}
function drain(){
  const evs=queue; queue=[]; if(!evs.length) return;
  const L=localRows();
  for(const [t,ev] of evs){
    const del=ev.eventType==="DELETE", row=del?ev.old:ev.new; if(!row) continue;
    const k=K[t](row); if(!k||k.includes("undefined")) continue;
    const pending=(k in L[t])?J(L[t][k])!==synced[t][k]:(k in synced[t]);
    if(del){if(!pending) removeRow(t,k); delete synced[t][k];}
    else{if(!pending) applyRow(t,row); synced[t][k]=J(N[t](row));}
  }
  keepSynced(); keepLocal(); refreshView();
}
let refreshLater=false;
function refreshView(){
  const vis=n=>!document.getElementById("screen-"+n).hidden, a=document.activeElement;
  if(a&&a.tagName==="INPUT"&&a.closest("#fill,#pull,#shelflist,#screen-sched")){refreshLater=true; return;} // don't redraw under someone's thumb
  refreshLater=false;
  if(vis("list")){if(ctx) state=getList(ctx); if(document.getElementById("view-pull").hidden) renderFill(); else {renderPull(); updateTotals();}}
  if(vis("stores")) renderStores();
  if(vis("home")) renderHome();
  if(vis("shelf")) renderShelf();
  if(vis("report")) renderReport();
  if(vis("sched")) renderSched();
}
document.addEventListener("focusout",()=>{setTimeout(()=>{if(refreshLater) refreshView();},50);});

/* ---------- Accounts ---------- */
let amode="in";
const $=id=>document.getElementById(id);
function openAuth(m){
  amode=m; const up=m==="up", nm=m==="name";
  $("am-in").setAttribute("aria-selected",m==="in"); $("am-up").setAttribute("aria-selected",up);
  $("am-in").parentElement.hidden=nm;
  $("authtitle").textContent=nm?"Change your name":up?"Create your account":"Sign in";
  $("namewrap").hidden=!(up||nm); $("credwrap").hidden=nm;
  $("ap").autocomplete=up?"new-password":"current-password";
  $("asub").textContent=nm?"Save":up?"Create account":"Sign in";
  $("acancel").hidden=!nm; $("authhint").hidden=nm;
  if(nm){$("pf").value=(store.me&&store.me.first)||""; $("pl").value=(store.me&&store.me.last)||"";}
  $("perr").hidden=true; showScreen("auth");
}
const say=t=>{$("perr").textContent=t; $("perr").hidden=false;};
function friendly(e){
  const m=String(e&&e.message||e||"");
  if(/invalid login/i.test(m)) return "That email and password don't match. Check them, or tap Create account if you're new.";
  if(/already registered|already exists/i.test(m)) return "There's already an account with that email. Tap Sign in instead.";
  if(/password/i.test(m)&&/6|short|weak/i.test(m)) return "Your password needs at least 6 characters.";
  if(/email/i.test(m)&&/invalid/i.test(m)) return "That email doesn't look right.";
  if(/fetch|network|failed/i.test(m)) return "Can't reach the server. Check your signal and try again.";
  if(/rate|too many/i.test(m)) return "Too many tries. Wait a minute and try again.";
  return m||"Something went wrong. Try again.";
}
$("am-in").addEventListener("click",()=>openAuth("in"));
$("am-up").addEventListener("click",()=>openAuth("up"));
$("acancel").addEventListener("click",()=>showScreen("home"));
$("authform").addEventListener("submit",async e=>{
  e.preventDefault(); $("perr").hidden=true;
  const first=$("pf").value.trim(), last=$("pl").value.trim(), email=$("ae").value.trim(), pw=$("ap").value, btn=$("asub");
  if(amode!=="in"&&(!first||!last)){say("Type your first and last name.");return;}
  if(amode==="name"){
    store.me={first,last}; keepLocal(); showScreen("home");
    if(sb&&user){const {error}=await sb.from("profiles").upsert({id:user.id,first,last}); if(error) toast("Name saved on this phone; it will update for everyone next time you're online"); sb.auth.updateUser({data:{first,last}}).catch(()=>{});}
    return;
  }
  if(!sb){say("Can't reach the server. Check your signal and try again.");return;}
  if(!email||!pw){say("Type your email and password.");return;}
  btn.disabled=true; const label=btn.textContent; btn.textContent=amode==="up"?"Creating…":"Signing in…";
  try{
    if(amode==="up"){
      if(pw.length<6){say("Your password needs at least 6 characters.");return;}
      const {data,error}=await sb.auth.signUp({email,password:pw,options:{data:{first,last}}}); if(error) throw error;
      if(!data.session){say("Account made. Tap Sign in to go in.");openAuth("in");return;}
      await sb.from("profiles").upsert({id:data.user.id,first,last});
      await signedIn(data.user,{first,last});
    }else{
      const {data,error}=await sb.auth.signInWithPassword({email,password:pw}); if(error) throw error;
      await signedIn(data.user);
    }
    $("ap").value="";
  }catch(err){say(friendly(err));}
  finally{btn.disabled=false; btn.textContent=label;}
});
$("editname").addEventListener("click",()=>openAuth("name"));
armButton($("signout"),"Sign out","Tap again to sign out",async()=>{
  try{if(sb) await sb.auth.signOut();}catch(e){}
  // Clear this phone's copy: the team's data stays in Supabase for the next sign-in
  try{localStorage.removeItem(KEY); localStorage.removeItem(SYNC_KEY);}catch(e){}
  location.reload();
});

async function signedIn(u,names){
  user=u;
  let first=names&&names.first, last=names&&names.last;
  if(!first){try{const {data}=await sb.from("profiles").select("first,last").eq("id",u.id).maybeSingle(); if(data){first=data.first; last=data.last;}}catch(e){}}
  if(!first){const m=u.user_metadata||{}; first=m.first; last=m.last;}
  if(!first&&store.me){first=store.me.first; last=store.me.last;}
  if(first){store.me={first,last:last||""}; try{await sb.from("profiles").upsert({id:u.id,first,last:last||""});}catch(e){}}
  store.owner=u.id; keepLocal();
  $("whoami").textContent=`Signed in as ${u.email}`;
  if(!first){openAuth("name");} else showScreen("home");
  subscribe(); loadAll();
}

/* ---------- Start ---------- */
(async()=>{
  if(!sb){ // Supabase couldn't load: keep working on this phone only
    status("offline");
    if(store.me&&store.me.first) showScreen("home"); else openAuth("name");
    return;
  }
  let session=null;
  try{({data:{session}}=await sb.auth.getSession());}catch(e){}
  if(session&&session.user) await signedIn(session.user);
  else openAuth("in");
  sb.auth.onAuthStateChange((ev,s)=>{if(ev==="SIGNED_OUT"&&user){user=null; openAuth("in");}});
})();
})();
