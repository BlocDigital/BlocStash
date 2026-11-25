
const $=s=>document.querySelector(s),el=(t,c,x)=>{const e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e};
const LS=localStorage,TABS=[["photos","Photos","<rect x='3' y='3' width='18' height='18' rx='3'/><circle cx='9' cy='9' r='2'/><path d='M21 16l-5-5-9 9'/>"],["map","Map","<path d='M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z'/><circle cx='12' cy='10' r='2.5'/>"],["albums","Albums","<rect x='3' y='8' width='18' height='12' rx='2'/><path d='M6 4h12'/>"],["fav","Favorites","<path d='M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z'/>"]];
let cfg=JSON.parse(LS.getItem("stash.cfg")||"null"),idx={items:[]},tab="photos",album="",q="",sel=null,selectionAnchor=null,view=[],cur=0,show=null,map=null,cluster=null,pick=null,fitted=false,st,tt;
const api=p=>cfg.url+"/api/"+p,H=()=>({Authorization:"Bearer "+cfg.token});
const nm=(i,t)=>t&&i.th?`t_${i.id}.jpg`:`o_${i.id}.${i.ext}`,U=(i,t)=>D.url(nm(i,t));
const RW={mode:"readwrite"},blobs=new Map();let root=null,files=null;
let dbPromise;
const idb=()=>dbPromise||(dbPromise=new Promise((a,b)=>{const r=indexedDB.open("stash",1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains("kv"))r.result.createObjectStore("kv")};r.onsuccess=()=>{r.result.onversionchange=()=>{r.result.close();dbPromise=null};a(r.result)};r.onerror=()=>{dbPromise=null;b(r.error)}}));
const kv=async(m,k,v)=>{const d=await idb();return new Promise((a,b)=>{const tx=d.transaction("kv",m==="get"?"readonly":"readwrite"),s=tx.objectStore("kv"),r=m==="get"?s.get(k):s.put(v,k);r.onsuccess=()=>a(r.result);r.onerror=()=>b(r.error);tx.onabort=()=>b(tx.error||new Error("Storage transaction failed"))})};
async function openFolder(h){
  // Validate the remembered directory handle before changing application state.
  // A browser permission can remain "granted" after the directory is moved/deleted.
  const nextFiles=await h.getDirectoryHandle("files",{create:true});
  root=h;files=nextFiles;
}
const write=async(dir,name,data)=>{const fh=await dir.getFileHandle(name,{create:true}),w=await fh.createWritable();await w.write(data);await w.close()};
// One interface, two backends: a folder on this computer (File System Access API) or a BlocStash Drive server.
const D={
  async load(){if(cfg.mode==="household"){const r=await fetch(`/api/household/index?scope=${cfg.scope}`,{cache:"no-store",credentials:"same-origin"});if(!r.ok)throw new Error(`Library request failed (${r.status})`);idx=await r.json()}else if(cfg.mode==="folder"){try{idx=JSON.parse(await(await(await root.getFileHandle("index.json")).getFile()).text())}catch(e){if(e.name!=="NotFoundError")throw e;idx={items:[]}}}
    else{const r=await fetch(api("index"),{headers:H(),cache:"no-store"});if(!r.ok)throw new Error(`Drive index request failed (${r.status})`);idx=await r.json()}
    if(!idx||!Array.isArray(idx.items))throw new Error("The drive index is invalid. No changes were made.");
    idx.items=idx.items.filter(i=>i&&typeof i.id==="string"&&typeof i.ext==="string"&&typeof i.name==="string")},
  async saveIdx(){if(cfg.mode==="folder")return write(root,"index.json",JSON.stringify(idx));
    const household=cfg.mode==="household",r=await fetch(household?`/api/household/index?scope=${cfg.scope}`:api("index"),{method:"PUT",credentials:"same-origin",headers:household?{"Content-Type":"application/json"}:{...H(),"Content-Type":"application/json"},body:JSON.stringify(idx)});if(!r.ok)throw new Error(`Index save failed (${r.status})`)},
  async put(n,b,t,onProgress,meta={}){if(cfg.mode==="folder"){await write(files,n,b);if(onProgress)onProgress(b.size||0,b.size||0);return}
    const household=cfg.mode==="household",params=new URLSearchParams({name:n,scope:cfg.scope});if(meta.original)params.set("original",meta.original);if(meta.taken)params.set("taken",String(meta.taken));const url=household?`/api/household/f?${params}`:api("f/"+n);
    await new Promise((resolve,reject)=>{const x=new XMLHttpRequest();x.open("PUT",url);x.timeout=180000;x.withCredentials=true;x.setRequestHeader("Content-Type",t||"application/octet-stream");if(!household)x.setRequestHeader("Authorization",`Bearer ${cfg.token}`);x.upload.onprogress=e=>{if(onProgress&&e.lengthComputable)onProgress(e.loaded,e.total)};x.onload=()=>x.status>=200&&x.status<300?resolve():reject(new Error(`Upload failed (${x.status})`));x.onerror=()=>reject(new Error("Network error during upload"));x.ontimeout=()=>reject(new Error("Upload timed out"));x.onabort=()=>reject(new Error("Upload cancelled"));x.send(b)});
  },
  async del(n){if(cfg.mode==="folder"){const p=blobs.get(n);if(p){p.then(URL.revokeObjectURL,()=>{});blobs.delete(n)}return files.removeEntry(n)}
    const household=cfg.mode==="household",r=await fetch(household?`/api/household/f?name=${encodeURIComponent(n)}&scope=${cfg.scope}`:api("f/"+n),{method:"DELETE",credentials:"same-origin",headers:household?{}:H()});if(!r.ok&&r.status!==404)throw new Error(`Delete failed (${r.status})`)},
  url(n){if(cfg.mode==="household")return Promise.resolve(`/api/household/f?name=${encodeURIComponent(n)}&scope=${cfg.scope}`);if(cfg.mode!=="folder")return Promise.resolve(api(`f/${n}?t=${encodeURIComponent(cfg.token)}`));
    if(!blobs.has(n)){const p=files.getFileHandle(n).then(h=>h.getFile()).then(f=>URL.createObjectURL(f));p.catch(()=>blobs.delete(n));blobs.set(n,p)}return blobs.get(n)}};
const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){io.unobserve(e.target);e.target._load()}}),{rootMargin:"600px"});
const when=i=>i.taken||i.added,fmt=b=>b>1e9?(b/1e9).toFixed(1)+" GB":b>1e6?Math.round(b/1e6)+" MB":Math.round(b/1e3)+" KB";
const SCENE='<svg viewBox="0 0 160 100" aria-hidden="true"><circle cx="112" cy="40" r="20" fill="#FFC93C"/><path d="M0 72q30-30 62-8t58-12q24-6 40 6v36H0z" fill="#7fb7b0"/><path d="M0 84q36-26 74-6t86-4v26H0z" fill="#5BB382"/></svg>';
const toast=(m,ms=3000)=>{let t=$("#toast");if(!t){t=el("div");t.id="toast";document.body.append(t)}t.textContent=m;t.hidden=false;clearTimeout(tt);tt=setTimeout(()=>t.hidden=true,ms)};

// ---- drive I/O
const load=()=>D.load();
let saveChain=Promise.resolve();
const flushSave=()=>{clearTimeout(st);saveChain=saveChain.catch(()=>{}).then(()=>D.saveIdx());return saveChain};
const save=()=>{clearTimeout(st);st=setTimeout(()=>flushSave().catch(()=>toast("Couldn’t save your library index. Keep this page open and retry.")),350)};
async function remove(its){
  const unique=[...new Map(its.map(it=>[it.id,it])).values()],ids=new Set(unique.map(it=>it.id));
  const before=idx.items;idx.items=before.filter(it=>!ids.has(it.id));
  try{await flushSave()}catch(e){idx.items=before;render();toast("Couldn’t save the deletion. Your original files were left untouched.",6000);return}
  let failed=0;
  for(const it of unique){try{if(cfg.mode==="household"){const r=await fetch(`/api/household/trash-item?scope=${cfg.scope}`,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({item:it})});if(!r.ok)throw new Error(`Trash failed (${r.status})`)}else{if(it.th)await D.del(nm(it,1));await D.del(nm(it))}}catch(e){failed++}}
  render();if(failed)toast(`${failed} file${failed===1?"":"s"} could not be removed from storage`,5000)
}

// ---- modal helpers
function modal(title,body,btns){return new Promise(res=>{const c=$("#card");c.textContent="";c.append(el("h2","",title));const content=el("div","modal-body");content.append(...body);c.append(content);const row=el("div","acts");
  for(const [t,v,k] of btns){const b=el("button","link "+(k||""),t);b.onclick=()=>{$("#dlg").classList.remove("open");res(v)};row.append(b)}c.append(row);$("#dlg").classList.add("open")})}
async function ask(title,o={}){const body=[];let inp;if(o.input){inp=el("input");inp.placeholder="Album name";inp.value=o.value||"";
  if(o.sugg&&o.sugg.length){const s=el("div","sug");o.sugg.forEach(a=>{const c=el("button","chip",a);c.onclick=()=>{inp.value=a};s.append(c)});body.push(s)}body.push(inp)}
  const r=await modal(title,body,[["Cancel",null],["OK",true]]);return r?(o.input?inp.value.trim():true):null}
const albumNames=()=>[...new Set(idx.items.map(i=>i.album).filter(Boolean))].sort();
async function setAlbum(its){const n=await ask("Add to album (leave blank to remove)",{input:true,sugg:albumNames()});if(n===null)return false;its.forEach(i=>i.album=n);save();render();return true}

// ---- views
function vis(){const s=q.toLowerCase();return idx.items.filter(i=>(!album||i.album===album)&&(tab!=="fav"||i.fav)&&(!s||i.name.toLowerCase().includes(s)||(i.album||"").toLowerCase().includes(s))).sort((a,b)=>when(b)-when(a))}
// Desktop drag selection rectangle; modifier-click selection remains available.
const marquee=document.getElementById("selectionMarquee");
let dragSelect=null,suppressTileClick=false;
function updateMarquee(x,y){
 const d=dragSelect;if(!d)return;
 const left=Math.min(d.x,x),top=Math.min(d.y,y),width=Math.abs(x-d.x),height=Math.abs(y-d.y);
 marquee.style.display="block";marquee.style.left=left+"px";marquee.style.top=top+"px";marquee.style.width=width+"px";marquee.style.height=height+"px";
 if(width+height<8)return;
 const selected=new Set(d.initial);
 document.querySelectorAll("#main .tile").forEach((tile,i)=>{const r=tile.getBoundingClientRect();if(r.right>=left&&r.left<=left+width&&r.bottom>=top&&r.top<=top+height&&view[i])selected.add(view[i].id)});
 sel=selected;
}
document.addEventListener("pointerdown",e=>{if(e.pointerType!=="mouse"||e.button!==0||!sel||!e.target.closest("#main .grid"))return;dragSelect={x:e.clientX,y:e.clientY,initial:[...sel],moved:false}});
document.addEventListener("pointermove",e=>{if(!dragSelect)return;if(Math.abs(e.clientX-dragSelect.x)+Math.abs(e.clientY-dragSelect.y)>5){dragSelect.moved=true;suppressTileClick=true;updateMarquee(e.clientX,e.clientY)}});
document.addEventListener("pointerup",()=>{if(!dragSelect)return;const moved=dragSelect.moved;dragSelect=null;marquee.style.display="none";if(moved){render();setTimeout(()=>{suppressTileClick=false},0)}else suppressTileClick=false});

function tile(it,list,i){const b=el("button","tile"+(sel&&sel.has(it.id)?" sel":""));b.setAttribute("aria-label",it.name);
  if(it.th||it.kind==="image"){const im=el("img");im.alt="";im.loading="lazy";im.decoding="async";im._load=()=>U(it,1).then(u=>{im.src=u}).catch(()=>im.replaceWith(el("span","ph","▢")));io.observe(im);im.onerror=()=>im.replaceWith(el("span","ph","▢"));b.append(im)}else b.append(el("span","ph","▶"));
  if(it.kind==="video")b.append(el("span","vb","▶"));if(it.fav)b.append(el("span","hb","♥"));
  if(sel)b.append(el("span","tick",sel.has(it.id)?"✓":""));
  b.onclick=e=>{if(suppressTileClick){suppressTileClick=false;e.preventDefault();return}if(sel){
    if(e.shiftKey&&selectionAnchor){const anchor=list.findIndex(x=>x.id===selectionAnchor);if(anchor>=0){const lo=Math.min(anchor,i),hi=Math.max(anchor,i);for(let n=lo;n<=hi;n++)sel.add(list[n].id)}else sel.add(it.id)}
    else if(e.ctrlKey||e.metaKey||!e.shiftKey){if(sel.has(it.id))sel.delete(it.id);else sel.add(it.id);selectionAnchor=it.id}
    render();return
  }openLb(list,i)};return b}
function grid(list){const m=$("#main");io.disconnect();m.textContent="";view=list;
  if(!list.length){const e=el("div","empty"),a=el("div","art");a.innerHTML=SCENE;e.append(a,el("b","",tab==="fav"?"No favorites yet":q||album?"Nothing found":"No moments yet"),tab==="fav"?"Tap the heart on a photo you love.":q||album?"Try a different search.":"Tap the camera to add your first photos.");m.append(e);return}
  let key="",g;list.forEach((it,i)=>{const k=new Date(when(it)).toLocaleDateString(undefined,{month:"long",year:"numeric"});
    if(k!==key){key=k;m.append(el("div","mh",k));g=el("div","grid");m.append(g)}g.append(tile(it,list,i))})}
function albums(){const m=$("#main");m.textContent="";const ns=albumNames();
  if(!ns.length){const e=el("div","empty"),a=el("div","art");a.innerHTML=SCENE;e.append(a,el("b","","No albums yet"),"Choose Select, pick some photos, then tap Album.");m.append(e);return}
  const g=el("div","albums");for(const n of ns){const its=idx.items.filter(i=>i.album===n).sort((a,b)=>when(b)-when(a)),b=el("button","alb"),cv=el("div","cv");
    if(its[0]){const im=el("img");im.loading="lazy";im.decoding="async";U(its[0],1).then(u=>{im.src=u}).catch(()=>{});im.alt="";cv.append(im)}b.append(cv,el("b","",n),el("span","",its.length+" item"+(its.length===1?"":"s")));
    b.onclick=()=>{album=n;tab="photos";render()};g.append(b)}m.append(g)}

function pin(it,n){const d=el("div","pin"),i=el("img");i.loading="lazy";U(it,1).then(u=>{i.src=u}).catch(()=>{});i.alt="";d.append(i);if(n)d.append(el("b","",n));return d}
function drawMap(focus){const box=$("#map");box.style.display="block";
  if(!window.L){$("#mapnote").textContent="The map needs an internet connection.";return}
  if(!map){map=L.map("map",{zoomControl:false}).setView([25,10],2);L.control.zoom({position:"topright"}).addTo(map);
    const dk=matchMedia("(prefers-color-scheme: dark)"),tl=()=>L.tileLayer(`https://{s}.basemaps.cartocdn.com/rastertiles/${dk.matches?"dark_all":"voyager"}/{z}/{x}/{y}{r}.png?key=cb1_5frk_1_5e8928d69378af5bea9cab09`,{subdomains:"abcd",maxZoom:20,attribution:"© OpenStreetMap contributors © CARTO",referrerPolicy:"strict-origin-when-cross-origin"});
    let base=tl().addTo(map);dk.onchange=()=>{map.removeLayer(base);base=tl().addTo(map)};
    cluster=L.markerClusterGroup({showCoverageOnHover:false,maxClusterRadius:60,iconCreateFunction:c=>{const k=c.getAllChildMarkers();return L.divIcon({className:"",html:pin(k[0].options.item,k.length),iconSize:[52,52]})}}).addTo(map);
    map.on("click",e=>{if(!pick)return;pick.lat=e.latlng.lat;pick.lng=e.latlng.lng;pick=null;save();toast("Location saved");drawMap()})}
  setTimeout(()=>map.invalidateSize(),0);cluster.clearLayers();
  const geo=idx.items.filter(i=>i.lat!=null).sort((a,b)=>when(b)-when(a));
  geo.forEach((it,k)=>cluster.addLayer(L.marker([it.lat,it.lng],{icon:L.divIcon({className:"",html:pin(it),iconSize:[48,48]}),item:it}).on("click",()=>openLb(geo,k))));
  $("#mapnote").textContent=pick?"Tap the map to place this item":`${geo.length} of ${idx.items.length} have a location`;
  if(focus)map.setView([focus.lat,focus.lng],16);else if(geo.length&&!fitted){map.fitBounds(cluster.getBounds().pad(.25),{maxZoom:14});fitted=true}}

function render(){if(!cfg)return;
  $("#app").classList.toggle("onmap",tab==="map");
  document.querySelectorAll("#tabs button").forEach(b=>b.setAttribute("aria-current",String(b.dataset.t===tab)));
  $("#bar").hidden=tab!=="photos"&&tab!=="fav";$("#tabs").hidden=!!sel;$("#selbar").hidden=!sel;$("#fab").hidden=!!sel||tab==="map"||tab==="albums";
  $("#selb").hidden=tab==="map"||tab==="albums";$("#selb").textContent=sel?"Done":"Select";if(sel){$("#sn").textContent=sel.size+" selected";$("#sall").textContent=view.length&&view.every(it=>sel.has(it.id))?"Select none":"Select all";}
  $("#meta").textContent=(cfg.mode==="household"?(cfg.scope==="shared"?"Shared · ":"Personal · "):"")+ (idx.items.length?`${idx.items.length} ${idx.items.length===1?"memory":"memories"} · ${fmt(idx.items.reduce((n,i)=>n+(i.size||0),0))}`:"Your happy place");
  const cr=$("#crumb");cr.textContent="";if(album){const c=el("button","chip","Album: "+album+"  ✕");c.onclick=()=>{album="";render()};cr.append(c)}
  if(tab==="map")drawMap();else{$("#map").style.display="none";tab==="albums"?albums():grid(vis())}}

// ---- lightbox, info, slideshow
let slideDirection=0;
function openLb(list,i){view=list;cur=i;slideDirection=0;paint();$("#lb").classList.add("open")}
function paint(){const it=view[cur];if(!it)return closeLb();const s=$("#stage");s.textContent="";let e;
  if(it.kind==="video"){e=el("video");U(it).then(u=>{if(e.isConnected)e.src=u}).catch(()=>toast("Couldn’t load this video"));e.controls=true;e.autoplay=true;e.playsInline=true;e.preload="metadata";e.onended=()=>{if(show)step(1)}}else{e=el("img");e.decoding="async";U(it).then(u=>{if(e.isConnected)e.src=u}).catch(()=>toast("Couldn’t load this photo"));e.alt=it.name}
  if(slideDirection){e.classList.add("lb-slide-in",slideDirection>0?"from-right":"from-left");slideDirection=0}
  s.append(e);$("#lm").textContent=`${cur+1} / ${view.length}`;$("#lf").textContent=it.fav?"♥":"♡";
  if(show){clearTimeout(show.t);if(it.kind!=="video")show.t=setTimeout(()=>step(1),4000)}}
const step=d=>{if(view.length){cur=(cur+d+view.length)%view.length;slideDirection=d;paint()}};
function stopShow(){if(show)clearTimeout(show.t);show=null;$("#ls").textContent="Slideshow"}
function closeLb(){stopShow();$("#lb").classList.remove("open");$("#stage").textContent="";render()}
$("#lc").onclick=closeLb;$("#lp").onclick=()=>step(-1);$("#ln").onclick=()=>step(1);
$("#ls").onclick=()=>{if(show)stopShow();else{show={t:0};$("#ls").textContent="Pause";paint()}};
$("#lf").onclick=()=>{const it=view[cur];it.fav=!it.fav;save();paint()};
$("#la").onclick=async()=>{stopShow();await setAlbum([view[cur]])};
$("#ld").onclick=async()=>{stopShow();const it=view[cur];if(await ask("Move this item to trash? You can restore it for 30 days.")){closeLb();await remove([it])}};
$("#li").onclick=async()=>{stopShow();const it=view[cur],d=new Date(when(it)),b=[el("p","",d.toLocaleString()),el("p","",`${it.kind==="video"?"Video":"Photo"} · ${fmt(it.size||0)}${it.album?" · "+it.album:""}`),el("p","",it.lat!=null?`${it.lat.toFixed(4)}, ${it.lng.toFixed(4)}`:"No location")];
  const a=el("a","link","Download original");a.download=it.name;U(it).then(u=>{a.href=cfg.mode==="folder"?u:u+"&dl=1"});const btns=[["Close",null],[it.lat!=null?"Show on map":"Add location","loc"]];
  b.push(a);const r=await modal(it.name,b,btns);
  if(r==="loc"){closeLb();tab="map";if(it.lat!=null){render();drawMap(it)}else{pick=it;render();toast("Tap the map to place it",4000)}}};
document.addEventListener("keydown",e=>{if(!$("#lb").classList.contains("open"))return;if(e.key==="Escape")closeLb();if(e.key==="ArrowRight")step(1);if(e.key==="ArrowLeft")step(-1)});
let x0=null;$("#stage").addEventListener("touchstart",e=>{x0=e.touches[0].clientX},{passive:true});
$("#stage").addEventListener("touchend",e=>{if(x0===null)return;const d=e.changedTouches[0].clientX-x0;x0=null;if(Math.abs(d)>60)step(d<0?1:-1)});

// ---- tabs, search, select
const nav=$("#tabs");TABS.forEach(([t,l,p])=>{const b=el("button");b.dataset.t=t;b.innerHTML=`<svg viewBox="0 0 24 24">${p}</svg>`;b.append(l);b.onclick=()=>{tab=t;pick=null;render()};nav.append(b)});
$("#q").oninput=e=>{q=e.target.value.trim();render()};
$("#selb").onclick=()=>{sel=sel?null:new Set();selectionAnchor=null;render()};$("#sx").onclick=()=>{sel=null;selectionAnchor=null;render()};
$("#sall").onclick=()=>{if(!sel)return;const all=view.length&&view.every(it=>sel.has(it.id));if(all)view.forEach(it=>sel.delete(it.id));else view.forEach(it=>sel.add(it.id));selectionAnchor=view[0]?.id||null;render()};
document.addEventListener("keydown",e=>{if(!sel||$("#lb").classList.contains("open")||$("#dlg").classList.contains("open"))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="a"){e.preventDefault();view.forEach(it=>sel.add(it.id));selectionAnchor=view[0]?.id||null;render()}if(e.key==="Escape"){sel=null;selectionAnchor=null;render()}});
$("#sa").onclick=async()=>{const its=idx.items.filter(i=>sel.has(i.id));if(its.length&&await setAlbum(its)){sel=null;render()}};
$("#sd").onclick=async()=>{const its=idx.items.filter(i=>sel.has(i.id));if(its.length&&await ask(`Move ${its.length} item${its.length>1?"s":""} to trash? You can restore them for 30 days.`)){sel=null;toast("Deleting…");await remove(its);toast("Deleted")}};
$("#drv").onclick=async()=>{
  const actions=[["Close",null]];
  if(cfg.mode==="household"){
    actions.push(["Account & session settings","settings"],["Members","members"]);
    if(cfg.user.role==="admin")actions.push(["Central storage folder","storage"],["Invite member","invite"]);
    actions.push(["View trash","trash"],["Sign out","logout","danger"]);
  }else actions.push(["Account & session settings","settings"],["Choose a different folder","folder"],["Return to household login","household"],["Disconnect","logout","danger"]);
  const detail=cfg.mode==="household"?`Signed in as ${cfg.user.username} · ${cfg.user.role}`:(cfg.mode==="folder"?`Folder: ${root.name}`:cfg.url);
  const choice=await modal("Settings",[el("p","",detail),el("p","",`${idx.items.length} items · ${fmt(idx.items.reduce((n,i)=>n+(i.size||0),0))}`)],actions);
  if(choice==="settings"){
    const days=await ask("Persistent login duration · 30, 90 or 365 days. Passkeys require secure HTTPS, which is not yet configured for LAN phones.",{input:true,value:"30"});
    if(days!==null){const n=Number(days);if(![30,90,365].includes(n))toast("Choose 30, 90 or 365 days");else if(cfg.mode==="household"){const rr=await fetch("/api/auth/session",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({rememberDays:n})});toast(rr.ok?`Session updated to ${n} days`:"Could not update session")}else{localStorage.setItem("stash.rememberDays",String(n));toast(`Saved preference: ${n} days`)}}
  }else if(choice==="folder")await chooseFolder();else if(choice==="storage")await chooseHouseholdStorage();
  else if(choice==="household"){LS.removeItem("stash.cfg");await authScreen()}
  else if(choice==="members"){
    try{const r=await fetch("/api/household/members",{credentials:"same-origin"});const d=await r.json();const body=d.members.map(m=>el("p","",`${m.username} · ${m.role}`));await modal("Household members",body.length?body:[el("p","","No members yet.")],[["Close",null]])}catch(e){toast("Could not load household members")}
  }else if(choice==="trash"){
    async function showTrash(){
      try{
        const r=await fetch("/api/household/trash",{credentials:"same-origin",cache:"no-store"});if(!r.ok)throw new Error();const d=await r.json();const body=[];
        if(!d.items.length)body.push(el("p","","Trash is empty."));
        for(const x of d.items){
          const row=el("div","trash-row"),details=el("div","",`${x.item?.name||"Deleted media"} · deleted ${new Date(x.deleted).toLocaleDateString()}`),actions=el("div","trash-actions");
          const restore=el("button","link","Restore"),purge=el("button","link danger","Delete permanently");
          restore.onclick=async()=>{const z=await fetch("/api/household/restore",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:x.id})});if(z.ok){await load();render();showTrash()}else toast("Could not restore item")};
          purge.onclick=async()=>{if(!await ask(`Permanently delete ${x.item?.name||"this item"}? This cannot be undone.`))return;const z=await fetch("/api/household/trash-delete",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:x.id})});if(z.ok)showTrash();else toast("Could not permanently delete item")};
          actions.append(restore,purge);row.append(details,actions);body.push(row);
        }
        const footer=d.items.length?[ ["Close",null] ]:[["Close",null]];
        if(d.items.length){const empty=el("button","link danger","Empty my trash");empty.style.marginTop="12px";empty.onclick=async()=>{if(!await ask("Permanently delete all items in your trash? This cannot be undone."))return;const z=await fetch("/api/household/trash-delete",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({all:true})});if(z.ok)showTrash();else toast("Could not empty trash")};body.push(empty)}
        await modal("Recently deleted · 30 days",body,footer);
      }catch(e){toast("Could not load trash")}
    }
    await showTrash();
  }else if(choice==="invite"){
    try{const r=await fetch("/api/household/invitations",{method:"POST",credentials:"same-origin"});if(!r.ok)throw 0;const d=await r.json();const link=location.origin+"/?invite="+encodeURIComponent(d.code),copy=el("button","link","Copy invitation link"),qr=el("img");qr.alt="QR code for one-time household invitation";qr.style.cssText="display:block;width:240px;height:240px;max-width:100%;margin:12px auto;background:white;padding:10px;border-radius:12px";qr.src="/api/household/invitation-qr?code="+encodeURIComponent(d.code);copy.onclick=()=>navigator.clipboard?navigator.clipboard.writeText(link).then(()=>toast("Invitation link copied")).catch(()=>toast("Copy unavailable; select the link manually")):toast("Copy unavailable; select the link manually");await modal("Household invitation",[qr,el("p","",link),el("p","","Admin-generated invitation. Expires in five minutes and can be used once. Only administrators can create invitations."),copy],[["Close",null]])}catch(e){toast("Could not create invitation")}
  }else if(choice==="logout"){if(cfg.mode==="household")await fetch("/api/auth/logout",{method:"POST",credentials:"same-origin"});LS.removeItem("stash.cfg");location.reload()}
};
// ---- upload (EXIF location/date, thumbnails, then PUT to the drive)
async function exif(f){const o={};try{if(!window.exifr)return o;const g=await exifr.gps(f);if(g&&g.latitude!=null){o.lat=g.latitude;o.lng=g.longitude}const t=await exifr.parse(f,["DateTimeOriginal"]);if(t&&t.DateTimeOriginal)o.taken=+new Date(t.DateTimeOriginal)}catch(e){}return o}
async function thumb(f,video){let src,w,h,url,bitmap;
  try{
    if(video){url=URL.createObjectURL(f);const v=el("video");v.muted=true;v.playsInline=true;v.preload="metadata";v.src=url;
      await new Promise((a,b)=>{const timer=setTimeout(()=>b(new Error("Video thumbnail timed out")),8000);v.onloadedmetadata=()=>{clearTimeout(timer);a()};v.onerror=()=>{clearTimeout(timer);b(new Error("Video decode failed"))}});
      v.currentTime=Math.min(1,(v.duration||2)/2);await new Promise((a,b)=>{const timer=setTimeout(()=>a(),2500);v.onseeked=()=>{clearTimeout(timer);a()};v.onerror=()=>{clearTimeout(timer);b(new Error("Video seek failed"))}});src=v;w=v.videoWidth;h=v.videoHeight;
    }else{bitmap=await createImageBitmap(f,{imageOrientation:"from-image"});src=bitmap;w=src.width;h=src.height}
    if(!w||!h)throw new Error("Unsupported media dimensions");
    const side=Math.min(w,h),c=document.createElement("canvas");c.width=c.height=480;const ctx=c.getContext("2d");if(!ctx)throw new Error("Canvas unavailable");ctx.drawImage(src,(w-side)/2,(h-side)/2,side,side,0,0,480,480);
    return await new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error("Thumbnail encoding failed")),"image/jpeg",.82));
  }finally{if(bitmap)bitmap.close();if(url)URL.revokeObjectURL(url)}
}
let uploadHidden=false;
function updateUploadProgress(state){
  const done=state.saved+state.failed+state.skipped,percent=state.finished?100:(state.totalBytes?Math.min(95,Math.round(state.sentBytes/state.totalBytes*95)):0);
  const mb=n=>(n/1048576).toFixed(1)+" MB";
  $("#uploadTitle").textContent=state.finished?(state.failed?"Upload finished with errors":"Upload complete"):`Uploading ${state.total} ${state.total===1?"item":"items"}`;
  $("#uploadDetail").textContent=state.finished?`${state.saved} saved${state.skipped?` · ${state.skipped} duplicates skipped`:""}${state.failed?` · ${state.failed} failed`:""}`:`${done} of ${state.total} files completed · ${mb(Math.min(state.sentBytes,state.totalBytes))} / ${mb(state.totalBytes)} sent`;
  $("#uploadFill").style.width=percent+"%";
  $("#uploadFoot").textContent=state.finished?"Your library has been updated.":`${state.active||"Preparing files…"} · Keep BlocStash open while uploads finish.`;
  $("#uploadPanel").hidden=uploadHidden;
}
$("#uploadHide").onclick=()=>{uploadHidden=true;$("#uploadPanel").hidden=true;toast("Uploads continue. Tap Add to view progress.",3500)};
$("#fab").onclick=()=>{if(uploadState&&!uploadState.finished&&uploadHidden){uploadHidden=false;$("#uploadPanel").hidden=false;return}$("#file").click()};
let uploadState=null;
async function findDuplicateByFilename(file){
  const key=file.name.trim().toLocaleLowerCase();
  return idx.items.find(item=>String(item.name||"").trim().toLocaleLowerCase()===key)||null;
}
$("#file").addEventListener("change",async e=>{
  const picker=e.currentTarget,fs=Array.from(picker.files||[]);picker.value="";if(!fs.length)return;
  const totalBytes=fs.reduce((n,f)=>n+f.size,0);let next=0;
  uploadHidden=false;uploadState={total:fs.length,totalBytes,sentBytes:0,saved:0,failed:0,skipped:0,active:"Checking filenames…",finished:false};updateUploadProgress(uploadState);
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const duplicates=[],seenSelected=new Map();
  for(let i=0;i<fs.length;i++){
    const file=fs[i],key=file.name.trim().toLocaleLowerCase();
    uploadState.active=`Checking filename ${i+1} of ${fs.length}: ${file.name}`;updateUploadProgress(uploadState);
    const prior=seenSelected.get(key)||findDuplicateByFilename(file);
    if(prior)duplicates.push({file,match:prior});else seenSelected.set(key,file);
  }
  let duplicateMode="keep";
  if(duplicates.length){const body=[el("p","",`${duplicates.length} selected ${duplicates.length===1?"file is":"files are"} already in your library.`),el("p","","Choose whether to skip these files or upload another copy. This choice applies to all duplicates in this batch.")];const choice=await modal("Duplicates found",body,[["Cancel upload","cancel"],["Skip duplicates","skip"],["Keep both","keep"]]);if(choice==="cancel"||choice===null){uploadState.finished=true;uploadState.active="Upload cancelled";updateUploadProgress(uploadState);return}duplicateMode=choice}
  const skipSet=new Set(duplicateMode==="skip"?duplicates.map(d=>d.file):[]);uploadState.skipped=skipSet.size;
  const queue=fs.filter(f=>!skipSet.has(f));if(!queue.length){uploadState.finished=true;uploadState.active="";updateUploadProgress(uploadState);toast(`${skipSet.size} duplicate${skipSet.size===1?"":"s"} skipped`);return}
  // Three concurrent workers keep mobile memory and network use bounded.
  const worker=async()=>{while(true){const i=next++;if(i>=queue.length)return;const f=queue[i];let originalName=null,thumbName=null,accounted=0;
    const kind=(f.type||"").startsWith("video")?"video":"image",id=(crypto.randomUUID?crypto.randomUUID().replace(/-/g,""):Date.now().toString(36)+Math.random().toString(36).slice(2,10)).toLowerCase(),ext=((f.name.split(".").pop()||"bin").toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,5))||"bin";
    uploadState.active=f.name;updateUploadProgress(uploadState);
    try{
      const ex=kind==="image"?await exif(f):{};originalName=`o_${id}.${ext}`;thumbName=`t_${id}.jpg`;
      const taken=ex.taken||f.lastModified;
      await D.put(originalName,f,f.type||"application/octet-stream",loaded=>{const delta=Math.max(0,loaded-accounted);accounted=loaded;uploadState.sentBytes+=delta;updateUploadProgress(uploadState)},{original:f.name,taken});
      const tb=await thumb(f,kind==="video").catch(()=>null);if(tb)await D.put(thumbName,tb,"image/jpeg",null,{original:`.${thumbName}`,taken});
      idx.items.push({id,name:f.name,kind,ext,size:f.size,taken,lat:ex.lat,lng:ex.lng,th:!!tb,album,added:Date.now()});uploadState.saved++;
    }catch(err){uploadState.failed++;if(originalName)await D.del(originalName).catch(()=>{});if(thumbName)await D.del(thumbName).catch(()=>{});if(accounted<f.size){uploadState.sentBytes+=f.size-accounted;accounted=f.size}}
    updateUploadProgress(uploadState);
  }};
  await Promise.all(Array.from({length:Math.min(3,queue.length)},worker));
  try{await flushSave()}catch(err){uploadState.finished=true;uploadState.active="Library index save failed";updateUploadProgress(uploadState);toast("Media uploaded, but the library index could not be saved. Keep this page open and retry.",7000);render();return}
  uploadState.finished=true;uploadState.active="";updateUploadProgress(uploadState);render();
  toast(`${uploadState.saved} saved${uploadState.skipped?` · ${uploadState.skipped} duplicates skipped`:""}${uploadState.failed?` · ${uploadState.failed} failed`:""}`,4500);
  setTimeout(()=>{if(uploadState?.finished){$("#uploadPanel").hidden=true;uploadState=null;uploadHidden=false}},6500);
});

async function chooseHouseholdStorage(){
  if(cfg?.mode!=="household"||cfg.user?.role!=="admin"){toast("Only the household administrator can change storage.");return}
  const current=await fetch("/api/household/storage",{credentials:"same-origin",cache:"no-store"}).then(r=>r.ok?r.json():Promise.reject(new Error("Could not read storage settings"))).catch(e=>{toast(e.message);return null});
  if(!current)return;
  const promptText=`Current folder: ${current.path}${current.available?"":"\n\nSTORAGE UNAVAILABLE"}\n\nThe Windows server will open a folder picker. Existing media and trash will be copied before switching. The old folder is kept as a backup.`;
  if(!confirm(promptText+"\n\nChoose a new central folder?"))return;
  try{const r=await fetch("/api/household/storage/select",{method:"POST",credentials:"same-origin"});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||data.message||"Folder selection failed");if(data.cancelled){toast("Storage selection cancelled");return}toast("Central storage updated. All household devices now use this folder.",6000)}catch(e){toast(e.message||"Could not change central storage",7000)}
}
async function chooseFolder(){
  if(!cfg || cfg.mode!=="folder"){toast("Choose the household storage folder after signing in as administrator.");return}
  try{
    let h=await kv("get","dir").catch(()=>null);
    if(h){try{let permission=await h.queryPermission(RW);if(permission!=="granted")permission=await h.requestPermission(RW);if(permission!=="granted")h=null;if(h)await openFolder(h)}catch(e){h=null;root=null;files=null;await kv("put","dir",null).catch(()=>{})}}
    if(!h){h=await showDirectoryPicker({id:"stash",mode:"readwrite"});await openFolder(h)}
    await kv("put","dir",h);cfg={mode:"folder"};LS.setItem("stash.cfg",JSON.stringify(cfg));await boot();
  }catch(e){if(e.name!=="AbortError")toast("Could not open folder. Check browser permissions.")}
}
async function authScreen(){cfg=null;LS.removeItem("stash.cfg");$("#app").hidden=true;$("#conn").hidden=false;try{const r=await fetch('/api/auth/status',{cache:'no-store'});const state=await r.json();authSetup=state.setup;$("#authintro").textContent=authSetup?"Create the household administrator account. This account manages members and shared content, not private libraries.":"Sign in to your household BlocStash account.";const invite=new URLSearchParams(location.search).get('invite');if(invite){authSetup=false;$("#authintro").textContent="Join this BlocStash household. Choose your own username and password.";$("#go").textContent="Join household";$("#cf").dataset.invite=invite;}else{$("#cf").dataset.invite="";$("#go").textContent=authSetup?"Create household":"Sign in";}$("#password").autocomplete=authSetup?"new-password":"current-password";}catch(e){$("#err").textContent="Cannot reach the BlocStash server. Start it on your PC and open its local address."}}
$("#cf").onsubmit=async e=>{e.preventDefault();const body={username:$("#username").value.trim(),password:$("#password").value,rememberDays:$("#remember").checked?30:1};try{const r=await fetch($("#cf").dataset.invite?'/api/household/join':(authSetup?'/api/auth/setup':'/api/auth/login'),{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify($("#cf").dataset.invite?{...body,code:$("#cf").dataset.invite}:body)});if(!r.ok){$("#err").textContent=await r.text();return}const data=await r.json();cfg={mode:'household',scope:'personal',user:data.user};LS.setItem('stash.cfg',JSON.stringify(cfg));$("#password").value='';await boot()}catch(x){$("#err").textContent="Could not connect to BlocStash. Check that the server is running."}};
$("#library").onchange=async()=>{if(cfg?.mode!=='household')return;cfg.scope=$("#library").value;LS.setItem('stash.cfg',JSON.stringify(cfg));album='';sel=null;await load();render()};
$("#refreshBtn").onclick=async()=>{const b=$("#refreshBtn");if(!cfg||b.disabled)return;b.disabled=true;b.textContent="Refreshing…";try{await load();sel=null;render();toast("Library refreshed")}catch(e){toast("Could not refresh the library. Check your connection.",5000)}finally{b.disabled=false;b.textContent="Refresh"}};
function showConnection(message){
  root=null;files=null;
  $("#app").hidden=true;$("#conn").hidden=false;
  if(message)$("#err").textContent=message;
}
async function boot(){
  // Folder mode was a browser-local shortcut that could open the dashboard
  // without household authentication. It is no longer supported in Household Edition.
  if(cfg?.mode==="folder"){cfg=null;LS.removeItem("stash.cfg");await authScreen();return}
  if(!cfg || cfg.mode==="server"){await authScreen();return}
  if(cfg.mode==="household"){try{const me=await fetch("/api/auth/me",{credentials:"same-origin",cache:"no-store"});if(!me.ok)throw 0;const d=await me.json();cfg.user=d.user;$("#folderBtn").hidden=d.user.role!=="admin";$("#library").hidden=false;$("#library").value=cfg.scope||"personal";}catch(e){await authScreen();return}}else $("#library").hidden=true;
  if(cfg&&cfg.mode==="folder"&&!root){
    const h=await kv("get","dir").catch(()=>null);
    try{
      if(!h)throw new Error("No saved folder handle");
      const permission=await h.queryPermission(RW);
      if(permission!=="granted")throw new Error("Folder permission needs to be renewed");
      await openFolder(h);
    }catch(e){
      // Do not keep retrying a stale handle or silently initialise a new library.
      await kv("put","dir",null).catch(()=>{});
      cfg=null;LS.removeItem("stash.cfg");
      showConnection("Your previous folder is unavailable. Select the original folder if it still exists, or choose another folder.");
      return;
    }
  }
  $("#conn").hidden=!!cfg;$("#app").hidden=!cfg;if(!cfg)return;
  try{await load()}catch(e){toast(cfg.mode==="folder"?"Can’t read this folder. Check that it still exists and is accessible.":"Can’t reach your drive")}render()
}
$("#fn").hidden=true;$("#folderBtn").hidden=true;$("#folderBtn").onclick=chooseHouseholdStorage;
document.addEventListener("visibilitychange",()=>{if(document.hidden){if(cfg)flushSave().catch(()=>{})}else if(cfg&&!sel)load().then(render).catch(()=>{})});
window.addEventListener("pagehide",()=>{if(st)clearTimeout(st);if(cfg)D.saveIdx().catch(()=>{})});
if("serviceWorker"in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});
// Scanning the PC's QR code opens http://<pc>:8787/#t=TOKEN: pair automatically, then clear the token from the address bar.
async function pair(){const m=/[#&]t=([^&]+)/.exec(location.hash);if(!m)return;history.replaceState(null,"",location.pathname+location.search);const old=cfg;
  try{cfg={mode:"server",url:location.origin,token:decodeURIComponent(m[1])};const r=await fetch(api("ping"),{headers:H()});if(r.ok)LS.setItem("stash.cfg",JSON.stringify(cfg));else cfg=old}catch(e){cfg=old}}
if(!cfg)fetch("/api/ping").then(r=>{if(r.status===401&&!$("#u").value)$("#u").value=location.origin}).catch(()=>{});
pair().then(boot);
