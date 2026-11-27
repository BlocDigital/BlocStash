#!/usr/bin/env node
'use strict';
// BlocStash Drive: dependency-free local media storage (Node 18+).
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { spawnSync, execFile } = require('node:child_process');

const E = process.env;
const PORT = Number(E.PORT) || 8787;
const ORIGIN = E.STASH_ORIGIN || '*';
const MAX_INDEX_BYTES = Number(E.STASH_MAX_INDEX_BYTES) || 50 * 1024 * 1024;
const MAX_FILE_BYTES = Number(E.STASH_MAX_FILE_BYTES) || 20 * 1024 * 1024 * 1024;
const DIR = path.resolve(E.STASH_DIR || './stash-data');
const FILES = path.join(DIR, 'files');
const IDX = path.join(DIR, 'index.json');
const APP = path.resolve(E.STASH_APP || path.join(__dirname, '..', 'public'));
fs.mkdirSync(FILES, { recursive: true });

const TF = path.join(DIR, '.token');
const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
const makeToken = () => Array.from(crypto.randomBytes(32), b => alphabet[b % alphabet.length]).join('');
const TOKEN = E.STASH_TOKEN || (fs.existsSync(TF) ? fs.readFileSync(TF, 'utf8').trim() : (() => {
  const token = makeToken();
  fs.writeFileSync(TF, token, { mode: 0o600, flag: 'wx' });
  return token;
})());
if (TOKEN.length < 16) {
  console.error('STASH_TOKEN must be at least 16 characters.');
  process.exit(1);
}

// Household Edition: local-first account and library metadata store.
// Atomic JSON persistence keeps this dependency-free; the media remains in files/.
const HOUSE = path.join(DIR, 'household.json');
let household = { version: 1, users: [], sessions: [], invites: [], personal: {}, shared: { items: [] }, trash: [], assetOwners: {}, storageRoot: null };
try { household = { ...household, ...JSON.parse(fs.readFileSync(HOUSE, 'utf8')) }; }
catch (e) { if (e.code !== 'ENOENT') { console.error('household.json is invalid; refusing to overwrite it.'); process.exit(1); } }
// Household media storage is owned by the server, not by an individual browser.
let storageRoot = path.resolve(household.storageRoot || FILES);
const mediaDir = () => storageRoot;
const trashDir = () => path.join(storageRoot, '.stash-trash');
const safeFolder = value => String(value || 'user').normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+|\.+$/g, '').slice(0,64) || 'user';
const relativeMediaPath = name => household.assetOwners?.[name]?.storedPath || name;
const mediaFile = name => path.join(mediaDir(), relativeMediaPath(name));
const captureFolder = (user, timestamp) => { const d = new Date(Number(timestamp) || Date.now()); const valid = Number.isNaN(d.getTime()) ? new Date() : d; return path.join('users', safeFolder(user?.username), String(valid.getFullYear()), String(valid.getMonth()+1).padStart(2,'0')); };
async function assertStorageReady() {
  try { const st=await fsp.stat(storageRoot); if(!st.isDirectory()) throw new Error('not a directory'); await fsp.access(storageRoot,fs.constants.R_OK|fs.constants.W_OK); await fsp.mkdir(trashDir(),{recursive:true}); }
  catch { throw Object.assign(new Error(`Household storage folder is unavailable or not writable: ${storageRoot}`),{statusCode:503}); }
}
// Purge expired trash entries only after the 30-day recovery window. An offline
// selected drive is deliberately not replaced with the default storage folder.
(async()=>{try{await assertStorageReady();const cutoff=Date.now()-30*86400*1000;const keep=[];for(const item of household.trash){if(item.deleted<cutoff){await fsp.rm(path.join(trashDir(),item.stored),{force:true}).catch(()=>{});}else keep.push(item);}if(keep.length!==household.trash.length){household.trash=keep;await saveHouse();}}catch(e){console.error(e.message)}})();
async function selectHouseholdStorage(requestedPath) {
  // Windows can open a native folder picker. Other systems (Linux, ChromeOS Linux, macOS)
  // have no desktop dialog available to the server, so the administrator types the full path.
  let chosen = typeof requestedPath === 'string' ? requestedPath.trim() : '';
  if(chosen) {
    if(!path.isAbsolute(chosen)) throw Object.assign(new Error('Enter the full folder path, for example /mnt/chromeos/removable/MyDrive/BlocStash'),{statusCode:400});
  } else {
    if(process.platform!=='win32') throw Object.assign(new Error('Enter the full path of the folder to use as central storage.'),{statusCode:400});
    const script = "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description='Choose the central BlocStash household media folder'; $d.ShowNewFolderButton=$true; if($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){[Console]::Write($d.SelectedPath)}";
    const picked=spawnSync('powershell.exe',['-NoProfile','-STA','-Command',script],{encoding:'utf8',windowsHide:false,timeout:120000});
    if(picked.error) throw picked.error;
    if(picked.status!==0) throw new Error((picked.stderr||'Could not open the Windows folder picker.').trim());
    chosen=(picked.stdout||'').trim(); if(!chosen) return null;
  }
  const dest=path.resolve(chosen), rel=path.relative(DIR,dest), back=path.relative(dest,DIR);
  if(dest===DIR || (!rel.startsWith('..'+path.sep)&&rel!=='..') || (!back.startsWith('..'+path.sep)&&back!=='..')) throw Object.assign(new Error('Choose a folder outside the BlocStash application and metadata folder.'),{statusCode:400});
  try { await fsp.mkdir(dest,{recursive:true}); await fsp.access(dest,fs.constants.R_OK|fs.constants.W_OK); }
  catch(e) { throw Object.assign(new Error('That folder cannot be used (it must exist or be creatable, and be writable): '+e.message),{statusCode:400}); }
  const nextTrash=path.join(dest,'.stash-trash'); await fsp.mkdir(nextTrash,{recursive:true});
  // Copy first; only switch the active root after every existing asset and
  // recoverable-trash file has been copied successfully. Keep the old copy.
  async function copyContents(from,to){let entries=[];try{entries=await fsp.readdir(from,{withFileTypes:true})}catch(e){if(e.code==='ENOENT')return;throw e;}for(const ent of entries){const src=path.join(from,ent.name),out=path.join(to,ent.name);if(ent.isDirectory()){await fsp.mkdir(out,{recursive:true});await copyContents(src,out);continue;}if(!ent.isFile())continue;try{await fsp.copyFile(src,out,fs.constants.COPYFILE_EXCL)}catch(e){if(e.code!=='EEXIST')throw e;const [a,b]=await Promise.all([fsp.stat(src),fsp.stat(out)]);if(a.size!==b.size)throw new Error(`A different file already exists in the destination: ${ent.name}`);}}}
  await copyContents(storageRoot,dest);
  await copyContents(path.join(DIR,'trash'),nextTrash);
  await copyContents(trashDir(),nextTrash);
  storageRoot=dest; household.storageRoot=dest; await saveHouse(); return dest;
}
let houseWrite = Promise.resolve();
async function saveHouse() {
  houseWrite = houseWrite.catch(() => {}).then(async () => {
    const tmp = `${HOUSE}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(household), { flag: 'wx', mode: 0o600 });
    await fsp.rename(tmp, HOUSE);
  });
  return houseWrite;
}
const b64 = b => Buffer.from(b).toString('base64url');
const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const cookieName = 'stash_session';
function cookies(req) { return Object.fromEntries(String(req.headers.cookie || '').split(';').map(x => x.trim().split('=').map(decodeURIComponent)).filter(x => x.length === 2)); }
function sessionUser(req) {
  const token = cookies(req)[cookieName]; if (!token) return null;
  const h = hash(token), session = household.sessions.find(x => x.hash === h && x.expires > Date.now());
  return session ? household.users.find(x => x.id === session.userId && x.disabled !== true) || null : null;
}
function safeUser(u) { return { id: u.id, username: u.username, role: u.role, created: u.created }; }
function cookie(res, token, maxAge=30*86400) { res.setHeader('Set-Cookie', `${cookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`); }
function clearCookie(res) { res.setHeader('Set-Cookie', `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`); }
async function passwordHash(password, salt=crypto.randomBytes(16).toString('hex')) {
  const key = await new Promise((resolve,reject)=>crypto.scrypt(password,salt,64,(e,k)=>e?reject(e):resolve(k)));
  return { salt, hash: key.toString('hex') };
}
async function passwordOK(password, user) {
  const key = await new Promise((resolve,reject)=>crypto.scrypt(password,user.salt,64,(e,k)=>e?reject(e):resolve(k)));
  const a=Buffer.from(key.toString('hex')), b=Buffer.from(user.passwordHash);
  return a.length===b.length && crypto.timingSafeEqual(a,b);
}
const newId = () => crypto.randomBytes(16).toString('hex');
function rememberSeconds(value){const n=Number(value);return [1,30,90,365].includes(n)?n*86400:30*86400;}
function mediaNames(item) { return [`o_${item.id}.${item.ext}`, ...(item.th ? [`t_${item.id}.jpg`] : [])]; }
function referencedNames(scope, userId) {
  const list = scope === 'shared' ? household.shared.items : (household.personal[userId] || {items:[]}).items;
  return new Set(list.flatMap(mediaNames));
}
// ---- Sign-in protection: lock a client out for a while after repeated failed sign-ins ----
const AUTH_IP_MAX = Number(E.STASH_LOGIN_MAX_FAILS) > 0 ? Number(E.STASH_LOGIN_MAX_FAILS) : 5;   // failures per client address
const AUTH_USER_MAX = AUTH_IP_MAX * 4;                                                          // failures per username (all clients)
const AUTH_WINDOW_MS = 15 * 60 * 1000, AUTH_LOCK_MS = 15 * 60 * 1000;
const authFails = new Map();
function clientIp(req) {
  // Behind a local proxy (e.g. `tailscale serve`) every request arrives from 127.0.0.1; trust X-Forwarded-For only then.
  if (loopback(req)) { const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(); if (xff) return xff; }
  return String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}
const authKeys = (req, username) => [['ip:' + clientIp(req), AUTH_IP_MAX], ['user:' + String(username || '').toLowerCase().slice(0, 64), AUTH_USER_MAX]];
function authLockedSeconds(keys) {
  const now = Date.now(); let wait = 0;
  for (const [k] of keys) { const e = authFails.get(k); if (e && e.lockedUntil > now) wait = Math.max(wait, Math.ceil((e.lockedUntil - now) / 1000)); }
  return wait;
}
function authRecordFailure(keys) {
  const now = Date.now();
  if (authFails.size > 2000) for (const [k, e] of authFails) if (e.lockedUntil < now && now - e.first > AUTH_WINDOW_MS) authFails.delete(k);
  for (const [k, max] of keys) {
    let e = authFails.get(k); if (!e || (e.lockedUntil < now && now - e.first > AUTH_WINDOW_MS)) e = { n: 0, first: now, lockedUntil: 0 };
    e.n++; if (e.n >= max) { e.lockedUntil = now + AUTH_LOCK_MS; e.n = 0; e.first = now; }
    authFails.set(k, e);
  }
}
const tooManyAttempts = (res, secs) => send(res, 429, `Too many failed attempts. Try again in ${Math.max(1, Math.ceil(secs / 60))} minute${secs > 90 ? 's' : ''}.`, 'text/plain; charset=utf-8', { 'Retry-After': String(secs) });
async function householdApi(req,res,url) {
  const p=url.pathname, method=req.method;
  if (p === '/api/auth/status' && method === 'GET') return send(res,200,JSON.stringify({setup:household.users.length===0}),MIME.json,{'Cache-Control':'no-store'});
  if (p === '/api/auth/setup' && method === 'POST') {
    if (household.users.length) return send(res,409,'setup already completed');
    const body=JSON.parse((await readBody(req,8192)).toString('utf8'));
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(body.username||'') || typeof body.password!=='string' || body.password.length<12) return send(res,400,'username must be 3-32 characters and password at least 12 characters');
    const pw=await passwordHash(body.password), user={id:newId(),username:body.username,role:'admin',created:Date.now(),salt:pw.salt,passwordHash:pw.hash};
    household.users.push(user);
    // One-time safe migration: legacy index.json becomes the first admin's private library.
    try { const legacy=JSON.parse(await fsp.readFile(IDX,'utf8')); if (legacy && Array.isArray(legacy.items)) { household.personal[user.id]={items:legacy.items}; for(const item of legacy.items){for(const name of mediaNames(item))household.assetOwners[name]={scope:'personal',userId:user.id};} } }
    catch(e) { if(e.code!=='ENOENT') return send(res,409,'Existing index.json is invalid; repair or back it up before setup.'); }
    const token=b64(crypto.randomBytes(32)),days=rememberSeconds(body.rememberDays); household.sessions.push({hash:hash(token),userId:user.id,created:Date.now(),expires:Date.now()+days*1000});
    await saveHouse(); cookie(res,token,days); return send(res,201,JSON.stringify({user:safeUser(user),migrated:(household.personal[user.id]?.items||[]).length}),MIME.json,{'Cache-Control':'no-store'});
  }
  if (p === '/api/auth/login' && method === 'POST') {
    const body=JSON.parse((await readBody(req,8192)).toString('utf8'));
    const guard=authKeys(req,body.username), locked=authLockedSeconds(guard); if(locked) return tooManyAttempts(res,locked);
    const user=household.users.find(x=>x.username.toLowerCase()===String(body.username||'').toLowerCase() && !x.disabled);
    if (!user || !(await passwordOK(String(body.password||''),user))) { authRecordFailure(guard); return send(res,401,'invalid username or password'); }
    authFails.delete(guard[1][0]);
    const token=b64(crypto.randomBytes(32)),days=rememberSeconds(body.rememberDays); household.sessions=household.sessions.filter(x=>x.expires>Date.now()); household.sessions.push({hash:hash(token),userId:user.id,created:Date.now(),expires:Date.now()+days*1000});
    await saveHouse(); cookie(res,token,days); return send(res,200,JSON.stringify({user:safeUser(user)}),MIME.json,{'Cache-Control':'no-store'});
  }
  if (p === '/api/auth/logout' && method === 'POST') { const token=cookies(req)[cookieName]; if(token) household.sessions=household.sessions.filter(x=>x.hash!==hash(token)); await saveHouse(); clearCookie(res); return send(res,200,'{}',MIME.json); }
  const user=sessionUser(req);
  if (p.startsWith('/api/auth/') && p === '/api/auth/me' && method === 'GET') return user ? send(res,200,JSON.stringify({user:safeUser(user)}),MIME.json,{'Cache-Control':'no-store'}) : send(res,401,'unauthorized');
  if (p === '/api/auth/session' && method === 'POST') { if(!user)return send(res,401,'unauthorized'); const body=JSON.parse((await readBody(req,4096)).toString('utf8')); const days=rememberSeconds(body.rememberDays)/86400; const token=cookies(req)[cookieName]; const session=household.sessions.find(x=>x.hash===hash(token)); if(!session)return send(res,401,'unauthorized'); session.expires=Date.now()+days*86400*1000; await saveHouse(); cookie(res,token,days*86400); return send(res,200,JSON.stringify({rememberDays:days}),MIME.json,{'Cache-Control':'no-store'}); }
  if (p.startsWith('/api/household/')) {
    if (!user && p !== '/api/household/join') return send(res,401,'unauthorized');
    if (p === '/api/household/storage' && method === 'GET') {
      if(user.role!=='admin') return send(res,403,'admin required');
      let available=true;try{await assertStorageReady()}catch{available=false;}
      return send(res,200,JSON.stringify({path:storageRoot,available,configured:!!household.storageRoot,picker:process.platform==='win32'}),MIME.json,{'Cache-Control':'no-store'});
    }
    if (p === '/api/household/storage/select' && method === 'POST') {
      if(user.role!=='admin') return send(res,403,'admin required');
      try { let wanted=''; try { wanted=JSON.parse((await readBody(req,8192)).toString('utf8')||'{}').path||''; } catch {} const selected=await selectHouseholdStorage(wanted); if(!selected)return send(res,200,JSON.stringify({cancelled:true}),MIME.json); return send(res,200,JSON.stringify({path:selected}),MIME.json,{'Cache-Control':'no-store'}); }
      catch(e){return send(res,e.statusCode||500,e.message);}
    }
    if (p === '/api/household/remote' && method === 'GET') {
      if(user.role!=='admin') return send(res,403,'admin required');
      const ts=await tailscaleInfo(url.searchParams.get('refresh')==='1');
      const urls=[...(E.STASH_PUBLIC_URL?[String(E.STASH_PUBLIC_URL)]:[]),...(E.STASH_PUBLIC_HOST?[`${PROTO}://${E.STASH_PUBLIC_HOST}`]:[]),...ts.addresses.map(a=>`${PROTO}://${a}:${PORT}`),...(ts.dnsName?[`${PROTO}://${ts.dnsName}:${PORT}`]:[])];
      return send(res,200,JSON.stringify({ready:urls.length>0,urls,tailscale:{detected:ts.addresses.length>0,addresses:ts.addresses,dnsName:ts.dnsName},publicUrl:E.STASH_PUBLIC_URL||'',publicHost:E.STASH_PUBLIC_HOST||'',
        protection:{maxFails:AUTH_IP_MAX,windowMinutes:AUTH_WINDOW_MS/60000,lockoutMinutes:AUTH_LOCK_MS/60000}}),MIME.json,{'Cache-Control':'no-store'});
    }
    if (p === '/api/household/members' && method === 'GET') return send(res,200,JSON.stringify({members:household.users.map(safeUser)}),MIME.json);
    if (p === '/api/household/invitations' && method === 'POST') {
      if(user.role!=='admin') return send(res,403,'admin required');
      const base=await inviteBase(req);
      const code=b64(crypto.randomBytes(24)); household.invites.push({hash:hash(code),created:Date.now(),expires:Date.now()+5*60*1000,used:false}); await saveHouse();
      return send(res,201,JSON.stringify({code,expires:Date.now()+5*60*1000,url:`${base}/?invite=${encodeURIComponent(code)}`}),MIME.json,{'Cache-Control':'no-store'});
    }
    if (p === '/api/household/invitation-qr' && method === 'GET') {
      if(user.role!=='admin') return send(res,403,'admin required');
      const code=url.searchParams.get('code')||'', invite=household.invites.find(x=>x.hash===hash(code)&&!x.used&&x.expires>Date.now());
      if(!invite) return send(res,400,'invitation invalid or expired');
      const base=await inviteBase(req);
      const joinUrl=`${base}/?invite=${encodeURIComponent(code)}`;
      const script=path.join(__dirname,'qr_svg.py');
      const env={...process.env,PYTHONPATH:path.join(__dirname,'vendor')};
      let result;
      if(process.platform==='win32') { result=spawnSync('py',['-3',script],{input:joinUrl,encoding:'utf8',env,timeout:10000}); if(result.error||result.status!==0) result=spawnSync('python',[script],{input:joinUrl,encoding:'utf8',env,timeout:10000}); }
      else result=spawnSync('python3',[script],{input:joinUrl,encoding:'utf8',env,timeout:10000});
      if(result.error||result.status!==0||!result.stdout) return send(res,503,'QR generator unavailable. Install Python 3 or use the invitation link.',MIME.text,{'Cache-Control':'no-store'});
      return send(res,200,result.stdout,'image/svg+xml; charset=utf-8',{'Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; sandbox"});
    }
    if (p === '/api/household/join' && method === 'POST') {
      const body=JSON.parse((await readBody(req,8192)).toString('utf8')), invite=household.invites.find(x=>x.hash===hash(body.code||'')&&!x.used&&x.expires>Date.now());
      const guard=authKeys(req,''), locked=authLockedSeconds([guard[0]]); if(locked) return tooManyAttempts(res,locked);
      if(!invite) { authRecordFailure([guard[0]]); return send(res,400,'invitation is invalid or expired'); }
      if(!/^[a-zA-Z0-9_.-]{3,32}$/.test(body.username||'')||typeof body.password!=='string'||body.password.length<12||household.users.some(x=>x.username.toLowerCase()===body.username.toLowerCase())) return send(res,400,'invalid or already-used username, or password too short');
      const pw=await passwordHash(body.password), member={id:newId(),username:body.username,role:'member',created:Date.now(),salt:pw.salt,passwordHash:pw.hash};
      invite.used=true; household.users.push(member); await saveHouse(); const token=b64(crypto.randomBytes(32)),days=rememberSeconds(body.rememberDays); household.sessions.push({hash:hash(token),userId:member.id,created:Date.now(),expires:Date.now()+days*1000}); await saveHouse(); cookie(res,token,days);
      return send(res,201,JSON.stringify({user:safeUser(member)}),MIME.json,{'Cache-Control':'no-store'});
    }
    const lib=url.searchParams.get('scope') || 'personal';
    if (!['personal','shared'].includes(lib)) return send(res,400,'invalid library');
    if (p === '/api/household/index' && method === 'GET') {
      const data=lib==='shared'?household.shared:(household.personal[user.id]||{items:[]});
      return send(res,200,JSON.stringify(data),MIME.json,{'Cache-Control':'no-store'});
    }
    if (p === '/api/household/index' && method === 'PUT') {
      const body=JSON.parse((await readBody(req,MAX_INDEX_BYTES)).toString('utf8'));
      if(!body||!Array.isArray(body.items)) return send(res,400,'index must contain items');
      const old=lib==='shared'?household.shared:(household.personal[user.id]||{items:[]});
      const oldMap=new Map(old.items.map(x=>[x.id,x]));
      for(const item of body.items){
        if(!item||typeof item.id!=='string'||! /^[a-z0-9]{8,64}$/i.test(item.id)||typeof item.ext!=='string'||! /^[a-z0-9]{1,5}$/i.test(item.ext)||typeof item.name!=='string'||item.name.length>512) return send(res,400,'invalid media entry');
        const prior=oldMap.get(item.id);
        if(lib==='shared' && prior && prior.ownerId!==user.id && user.role!=='admin') return send(res,403,'cannot edit another member\'s shared item');
        if(lib==='shared') item.ownerId=prior?.ownerId||user.id;
      }
      // A device with an out-of-date copy of the library must not bring deleted (trashed) items back.
      const trashedIds=new Set(household.trash.filter(t=>t.scope===lib&&(lib==='shared'||t.userId===user.id)&&t.item&&t.item.id).map(t=>t.item.id));
      if(trashedIds.size) body.items=body.items.filter(x=>!trashedIds.has(x&&x.id));
      const nextIds=new Set(body.items.map(x=>x.id));
      for(const prior of old.items) if(!nextIds.has(prior.id) && lib==='shared' && prior.ownerId!==user.id && user.role!=='admin') return send(res,403,'cannot remove another member\'s shared item');
      if(lib==='shared') household.shared={items:body.items}; else household.personal[user.id]={items:body.items};
      await saveHouse(); return send(res,200,'{}',MIME.json);
    }
    if (p === '/api/household/f' && (method==='GET'||method==='HEAD'||method==='PUT'||method==='DELETE')) {
      const name=url.searchParams.get('name');
      if(!name||!NAME.test(name)) return send(res,400,'invalid media name');
      const visible=new Set([...referencedNames('personal',user.id),...referencedNames('shared',user.id)]);
      await assertStorageReady();
      if(method==='PUT'){
        const declared=Number(req.headers['content-length']); if(Number.isFinite(declared)&&declared>MAX_FILE_BYTES)return send(res,413,'file too large');
        const originalRaw=url.searchParams.get('original') || name;
        const original=path.basename(originalRaw).replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').trim().slice(0,180) || name;
        const folder=captureFolder(user,url.searchParams.get('taken'));
        let storedPath=path.join(folder,original), file=path.join(mediaDir(),storedPath);
        await fsp.mkdir(path.dirname(file),{recursive:true});
        try { await fsp.access(file); const ext=path.extname(original),base=path.basename(original,ext); storedPath=path.join(folder,`${base}__${name.slice(2,14)}${ext}`);file=path.join(mediaDir(),storedPath); } catch(e) { if(e.code!=='ENOENT') throw e; }
        const tmp=`${file}.${crypto.randomBytes(6).toString('hex')}.part`; let bytes=0;
        const limiter=new Transform({transform(c,e,cb){bytes+=c.length;cb(bytes>MAX_FILE_BYTES?Object.assign(new Error('large'),{statusCode:413}):null,c)}});
        try{await pipeline(req,limiter,fs.createWriteStream(tmp,{flags:'wx',mode:0o600}));await fsp.rename(tmp,file);household.assetOwners[name]={scope:lib,userId:user.id,storedPath};await saveHouse();return send(res,201,'{}',MIME.json)}catch(e){await fsp.rm(tmp,{force:true}).catch(()=>{});throw e}
      }
      if(!visible.has(name)) return send(res,404,'not found');
      const file=mediaFile(name);
      if(method==='DELETE'){
        const target=path.join(trashDir(),`${Date.now()}_${crypto.randomBytes(5).toString('hex')}_${name}`);
        try{await fsp.rename(file,target);household.trash.push({name,stored:path.basename(target),originalPath:relativeMediaPath(name),userId:user.id,deleted:Date.now(),scope:lib});await saveHouse();}catch(e){if(e.code!=='ENOENT')throw e}
        return send(res,200,'{}',MIME.json);
      }
      let stat;try{stat=await fsp.stat(file)}catch{return send(res,404,'not found')}
      let start=0,end=stat.size-1,status=200; const range=req.headers.range;
      if(range){const m=/^bytes=(\d*)-(\d*)$/.exec(range);if(!m||(!m[1]&&!m[2])||!stat.size)return send(res,416,'',undefined,{ 'Content-Range':`bytes */${stat.size}` });if(!m[1])start=Math.max(0,stat.size-Number(m[2]));else{start=Number(m[1]);if(m[2])end=Math.min(Number(m[2]),end)}if(start>end||start>=stat.size)return send(res,416,'',undefined,{'Content-Range':`bytes */${stat.size}`});status=206}
      const headers={'Content-Type':MIME[path.extname(name).slice(1).toLowerCase()]||'application/octet-stream','Content-Length':end-start+1,'Accept-Ranges':'bytes','Cache-Control':'private, max-age=3600'};if(status===206)headers['Content-Range']=`bytes ${start}-${end}/${stat.size}`;
      res.writeHead(status,headers);if(method==='HEAD')return res.end();return fs.createReadStream(file,{start,end}).pipe(res);
    }
    if (p === '/api/household/trash' && method==='GET') return send(res,200,JSON.stringify({items:household.trash.filter(x=>x.userId===user.id || (user.role==='admin' && x.scope==='shared')).map(({stored,...x})=>x)}),MIME.json);
    if (p === '/api/household/trash-item' && method==='POST') {
      await assertStorageReady();
      const body=JSON.parse((await readBody(req,16384)).toString('utf8')), item=body.item;
      if(!item||typeof item.id!=='string'||! /^[a-z0-9]{8,64}$/i.test(item.id)||typeof item.ext!=='string'||! /^[a-z0-9]{1,5}$/i.test(item.ext)) return send(res,400,'invalid item');
      const original=`o_${item.id}.${item.ext}`, thumb=`t_${item.id}.jpg`, names=[original,...(item.th?[thumb]:[])];
      const owner=lib==='shared'?(item.ownerId||user.id):user.id;
      const originalName=`o_${item.id}.${item.ext}`;const ownership=household.assetOwners[originalName];
      if(!ownership || ownership.scope!==lib || (ownership.userId!==user.id && user.role!=='admin')) return send(res,403,'you do not own this media');
      if(lib==='shared' && owner!==user.id && user.role!=='admin') return send(res,403,'cannot trash another member\'s item');
      const moved=[];
      try { for(const name of names){const stored=`${Date.now()}_${crypto.randomBytes(5).toString('hex')}_${name}`, originalPath=relativeMediaPath(name);try{await fsp.rename(path.join(mediaDir(),originalPath),path.join(trashDir(),stored));moved.push({name,stored,originalPath});}catch(e){if(e.code!=='ENOENT')throw e;}} }
      catch(e){for(const x of moved){const dest=path.join(mediaDir(),x.originalPath||x.name);await fsp.mkdir(path.dirname(dest),{recursive:true});await fsp.rename(path.join(trashDir(),x.stored),dest).catch(()=>{});}throw e;}
      for(const f of moved)delete household.assetOwners[f.name];household.trash.push({id:newId(),item,files:moved,userId:user.id,scope:lib,deleted:Date.now()});await saveHouse();return send(res,200,'{}',MIME.json);
    }
    if (p === '/api/household/trash-delete' && method==='POST') {
      await assertStorageReady();
      const body=JSON.parse((await readBody(req,8192)).toString('utf8'));
      const canManage=x=>x.userId===user.id || (user.role==='admin' && x.scope==='shared');
      const targets=body.all===true?household.trash.filter(canManage):household.trash.filter(x=>x.id===body.id && canManage(x));
      if(!targets.length) return send(res,404,'trash item not found');
      for(const entry of targets){
        const storedFiles=Array.isArray(entry.files)?entry.files.map(f=>f.stored).filter(Boolean):(entry.stored?[entry.stored]:[]);
        for(const stored of storedFiles) await fsp.rm(path.join(trashDir(),path.basename(stored)),{force:true});
      }
      const ids=new Set(targets.map(x=>x.id));
      household.trash=household.trash.filter(x=>!ids.has(x.id));
      await saveHouse();
      return send(res,200,JSON.stringify({deleted:targets.length}),MIME.json);
    }
    if (p === '/api/household/restore' && method==='POST') {
      await assertStorageReady();
      const body=JSON.parse((await readBody(req,8192)).toString('utf8')), entry=household.trash.find(x=>x.id===body.id && (x.userId===user.id || (user.role==='admin' && x.scope==='shared')));
      if(!entry) return send(res,404,'trash item not found');
      const occupied=new Set([...referencedNames('personal',user.id),...referencedNames('shared',user.id)]);
      if(entry.files.some(x=>occupied.has(x.name))) return send(res,409,'a file with this identifier already exists');
      for(const f of entry.files) { await fsp.rename(path.join(trashDir(),f.stored),path.join(mediaDir(),f.name)); household.assetOwners[f.name]={scope:entry.scope,userId:entry.userId}; }
      if(entry.scope==='shared' && !entry.item.ownerId)entry.item.ownerId=entry.userId;
      const target=entry.scope==='shared'?household.shared:(household.personal[entry.userId]||{items:[]});
      if(!target.items.some(x=>x.id===entry.item.id))target.items.push(entry.item);
      if(entry.scope==='shared')household.shared=target;else household.personal[entry.userId]=target;
      household.trash=household.trash.filter(x=>x.id!==entry.id);await saveHouse();return send(res,200,'{}',MIME.json);
    }
    return send(res,404,'not found');
  }
  return null;
}

const MIME = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  heic: 'image/heic', heif: 'image/heif', mp4: 'video/mp4', m4v: 'video/mp4',
  mov: 'video/quicktime', webm: 'video/webm', ttf: 'font/ttf',
  webmanifest: 'application/manifest+json', json: 'application/json; charset=utf-8', svg: 'image/svg+xml'
};
const NAME = /^[a-z]_[a-z0-9]+\.[a-z0-9]{1,5}$/i;
const lan = () => Object.values(os.networkInterfaces()).flat().filter(x => x && x.family === 'IPv4' && !x.internal).map(x => x.address);
const isChromeOSLinux = process.platform === 'linux' && (fs.existsSync('/dev/.cros_milestone') || fs.existsSync('/etc/apt/sources.list.d/cros.list'));
// The ChromeOS Linux container sits on an internal network (100.115.x.x / 100.114.x.x) that phones cannot reach.
// ---- Optional remote access over Tailscale (https://tailscale.com) ----
const isCgnat = a => { const p = String(a).split('.').map(Number); return p[0] === 100 && p[1] >= 64 && p[1] <= 127; };
// IPv4 addresses on a Tailscale interface (Linux "tailscale0", Windows "Tailscale", macOS "utunN").
function tsInterfaceAddrs() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) for (const i of list || []) {
    if (!i || i.family !== 'IPv4' || i.internal || !isCgnat(i.address)) continue;
    if (isChromeOSLinux && /^100\.11[45]\./.test(i.address)) continue;   // ChromeOS Linux container network, not Tailscale
    if (/tailscale/i.test(name) || /^utun\d+$/.test(name)) out.push(i.address);
  }
  return out;
}
// Home network addresses only: no ChromeOS container address, no Tailscale address.
const lanReachable = () => { const ts = new Set(tsInterfaceAddrs()); return lan().filter(a => !ts.has(a) && !(isChromeOSLinux && /^100\.11[45]\./.test(a))); };
let tsCache = { at: 0, value: null };
async function tailscaleInfo(force = false) {
  if (!force && tsCache.value && Date.now() - tsCache.at < 30000) return tsCache.value;
  const addresses = tsInterfaceAddrs();
  let dnsName = '';
  if (addresses.length) {
    const bins = process.platform === 'darwin' ? ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'] : ['tailscale'];
    for (const bin of bins) {
      dnsName = await new Promise(resolve => execFile(bin, ['status', '--json'], { timeout: 3000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
        try { resolve(err ? '' : String(JSON.parse(out).Self.DNSName || '').replace(/\.$/, '')); } catch { resolve(''); }
      }));
      if (dnsName) break;
    }
  }
  tsCache = { at: Date.now(), value: { addresses, dnsName } };
  return tsCache.value;
}
const PROTO = E.STASH_CERT && E.STASH_KEY ? 'https' : 'http';
// Address phones should use in invitations. STASH_PUBLIC_HOST (e.g. 192.168.1.50:8787) overrides everything;
// otherwise a localhost browser falls back to the PC's LAN address so the QR code works on phones.
function inviteHost(req) {
  if (E.STASH_PUBLIC_HOST) return E.STASH_PUBLIC_HOST;
  const host = req.headers.host || `localhost:${PORT}`;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host)) { const a = lanReachable()[0]; if (a) return `${a}:${PORT}`; }
  return host;
}
// Full base URL (scheme + host) that an invited person should use. One address for everyone, at home and away:
// STASH_PUBLIC_URL, else a Tailscale HTTPS address they browsed to, else STASH_PUBLIC_HOST or this PC's Tailscale
// address when remote access is set up, else the home network address.
async function inviteBase(req) {
  if (E.STASH_PUBLIC_URL) return String(E.STASH_PUBLIC_URL).replace(/\/+$/, '');
  const host = req.headers.host || '';
  // Behind a local HTTPS proxy such as `tailscale serve`, the browser address is https even though this server sees http.
  if (loopback(req) && /\.ts\.net(:\d+)?$/i.test(host)) return `https://${host}`;
  if (E.STASH_PUBLIC_HOST) return `${PROTO}://${E.STASH_PUBLIC_HOST}`;
  const ts = await tailscaleInfo();
  if (ts.addresses.length) return `${PROTO}://${ts.addresses[0]}:${PORT}`;
  return `${PROTO}://${inviteHost(req)}`;
}
const loopback = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const send = (res, code, body = '', type = 'text/plain; charset=utf-8', extra = {}) => {
  if (res.headersSent) return res.destroy();
  res.writeHead(code, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(body);
};
const authOK = value => {
  const a = Buffer.from(String(value || ''));
  const b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const html = value => String(value).replace(/[&<>\"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' })[c]);
const pairPage = () => {
  const tokenForUrl = encodeURIComponent(TOKEN);
  const tokenHtml = html(TOKEN);
  const urls = lan().map(a => `http://${a}:${PORT}/#t=${tokenForUrl}`);
  const safeUrls = JSON.stringify(urls).replace(/</g, '\\u003c');
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Open BlocStash</title>
  <body style="font:16px/1.5 system-ui;max-width:560px;margin:40px auto;padding:0 20px"><h1>Open BlocStash on your phone</h1>
  <p>Connect your phone to the same Wi-Fi, then scan a QR code with its camera.</p><div id="q"></div>
  <p>${urls.length ? 'Or enter the address and token manually:' : 'No local network address found. Connect this computer to Wi-Fi or Ethernet.'}</p>
  <p>Token: <b style="font-size:20px;letter-spacing:.05em">${tokenHtml}</b></p><p><a href="http://localhost:${PORT}/#t=${tokenForUrl}">Open BlocStash on this computer</a></p>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
  <script>${safeUrls}.forEach(u=>{const d=document.createElement('div');d.style.margin='18px 0';document.getElementById('q').append(d);new QRCode(d,{text:u,width:220,height:220});const p=document.createElement('p');p.textContent=u.split('#')[0];d.append(p)})</script>`;
};

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const err = new Error('Request body too large');
      err.statusCode = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed', undefined, { Allow: 'GET, HEAD' });
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return send(res, 400, 'bad path'); }
  const relative = path.posix.normalize('/' + decoded).replace(/^\/+/, '');
  const file = path.resolve(APP, relative || 'index.html');
  if (file !== APP && !file.startsWith(APP + path.sep)) return send(res, 403, 'forbidden');
  let stat;
  try { stat = await fsp.stat(file); } catch { return send(res, 404, 'not found'); }
  if (!stat.isFile()) return send(res, 404, 'not found');
  const ext = path.extname(file).slice(1).toLowerCase();
  const cache = ext === 'html' ? 'no-cache' : 'public, max-age=86400';
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': stat.size,
    'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin'
  });
  if (req.method === 'HEAD') return res.end();
  const stream = fs.createReadStream(file);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

async function handle(req, res) {
  const origin = req.headers.origin;
  if (ORIGIN === '*' || !origin || origin === ORIGIN) res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,Range');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (req.method === 'OPTIONS') return send(res, 204);

  let url;
  try { url = new URL(req.url, 'http://stash.local'); } catch { return send(res, 400, 'bad url'); }
  if (!url.pathname.startsWith('/api/')) {
    if (url.pathname === '/pair') return loopback(req)
      ? (household.users.length ? send(res,200,'<!doctype html><meta charset=utf-8><meta name=viewport content=\"width=device-width\"><title>BlocStash pairing</title><main style=\"font:16px system-ui;max-width:560px;margin:40px auto;padding:20px\"><h1>BlocStash household</h1><p>Sign in to BlocStash on this computer, then choose Household → Invite member. Invitations are now account-based.</p><a href=\"/\">Open BlocStash</a></main>','text/html; charset=utf-8',{'Cache-Control':'no-store'}) : send(res, 200, pairPage(), 'text/html; charset=utf-8', { 'Cache-Control': 'no-store' }))
      : send(res, 403, 'Open this page on the computer running BlocStash.');
    return serveStatic(req, res, url.pathname);
  }

  if (url.pathname.startsWith('/api/auth/') || url.pathname.startsWith('/api/household/')) {
    const result = await householdApi(req,res,url); if (result !== null) return result;
  }

  if (household.users.length && (url.pathname === '/api/index' || url.pathname.startsWith('/api/f/'))) return send(res,410,'legacy shared-token API disabled; use household accounts');

  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const queryToken = url.searchParams.get('t');
  if (!authOK(bearer || queryToken)) return send(res, 401, 'unauthorized');

  if (url.pathname === '/api/ping' && req.method === 'GET') return send(res, 200, '{"ok":true}', MIME.json, { 'Cache-Control': 'no-store' });
  if (url.pathname === '/api/index') {
    if (req.method === 'GET') {
      try {
        const data = await fsp.readFile(IDX);
        return send(res, 200, data, MIME.json, { 'Cache-Control': 'no-store' });
      } catch (err) {
        if (err.code === 'ENOENT') return send(res, 200, '{"items":[]}', MIME.json, { 'Cache-Control': 'no-store' });
        throw err;
      }
    }
    if (req.method === 'PUT') {
      const body = await readBody(req, MAX_INDEX_BYTES);
      let parsed;
      try { parsed = JSON.parse(body.toString('utf8')); } catch { return send(res, 400, 'invalid json'); }
      if (!parsed || !Array.isArray(parsed.items)) return send(res, 400, 'index must contain an items array');
      const temp = `${IDX}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
      try { await fsp.writeFile(temp, body, { flag: 'wx', mode: 0o600 }); await fsp.rename(temp, IDX); }
      catch (err) { await fsp.rm(temp, { force: true }).catch(() => {}); throw err; }
      return send(res, 200, '{}', MIME.json);
    }
    return send(res, 405, 'method not allowed', undefined, { Allow: 'GET, PUT' });
  }

  const match = url.pathname.match(/^\/api\/f\/([^/]+)$/);
  if (!match || !NAME.test(match[1])) return send(res, 404, 'not found');
  const fileName = match[1];
  const file = path.join(FILES, fileName);
  if (req.method === 'PUT') {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_FILE_BYTES) return send(res, 413, 'file too large');
    const temp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.part`;
    let received = 0;
    const limiter = new Transform({ transform(chunk, enc, cb) {
      received += chunk.length;
      cb(received > MAX_FILE_BYTES ? Object.assign(new Error('file too large'), { statusCode: 413 }) : null, chunk);
    }});
    try {
      await pipeline(req, limiter, fs.createWriteStream(temp, { flags: 'wx', mode: 0o600 }));
      await fsp.rename(temp, file);
      return send(res, 201, '{}', MIME.json);
    } catch (err) {
      await fsp.rm(temp, { force: true }).catch(() => {});
      if (err.statusCode === 413) return send(res, 413, 'file too large');
      if (req.aborted || res.destroyed) return;
      throw err;
    }
  }
  if (req.method === 'DELETE') {
    try { await fsp.unlink(file); } catch (err) { if (err.code !== 'ENOENT') throw err; }
    return send(res, 200, '{}', MIME.json);
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    let stat;
    try { stat = await fsp.stat(file); } catch { return send(res, 404, 'not found'); }
    let start = 0, end = stat.size - 1, status = 200;
    const range = req.headers.range;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m || (!m[1] && !m[2]) || stat.size === 0) return send(res, 416, '', undefined, { 'Content-Range': `bytes */${stat.size}` });
      if (!m[1]) { const suffix = Number(m[2]); start = Math.max(0, stat.size - suffix); }
      else { start = Number(m[1]); if (m[2]) end = Math.min(Number(m[2]), end); }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) return send(res, 416, '', undefined, { 'Content-Range': `bytes */${stat.size}` });
      status = 206;
    }
    const headers = {
      'Content-Type': MIME[path.extname(fileName).slice(1).toLowerCase()] || 'application/octet-stream',
      'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff'
    };
    if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    if (url.searchParams.has('dl')) headers['Content-Disposition'] = 'attachment';
    res.writeHead(status, headers);
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(file, { start, end });
    stream.on('error', () => res.destroy());
    return stream.pipe(res);
  }
  return send(res, 405, 'method not allowed', undefined, { Allow: 'GET, HEAD, PUT, DELETE' });
}

const server = E.STASH_CERT && E.STASH_KEY
  ? https.createServer({ cert: fs.readFileSync(E.STASH_CERT), key: fs.readFileSync(E.STASH_KEY) }, (req, res) => run(req, res))
  : http.createServer((req, res) => run(req, res));
async function run(req, res) {
  try { await handle(req, res); }
  catch (err) {
    if (res.headersSent || res.destroyed) return res.destroy();
    const code = err.statusCode || 500;
    if (code >= 500) console.error('Request failed:', err.message);
    send(res, code, code === 413 ? 'request too large' : 'request failed');
  }
}
server.requestTimeout = 30 * 60 * 1000;
server.headersTimeout = 60 * 1000;
// ---- Big "keep this window open" warning shown at startup ----
const BIG_FONT = {
  D: ['####.', '#...#', '#...#', '#...#', '####.'], O: ['.###.', '#...#', '#...#', '#...#', '.###.'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#'], T: ['#####', '..#..', '..#..', '..#..', '..#..'],
  C: ['.####', '#....', '#....', '#....', '.####'], L: ['#....', '#....', '#....', '#....', '#####'],
  S: ['.####', '#....', '.###.', '....#', '####.'], E: ['#####', '#....', '####.', '#....', '#####'],
  B: ['####.', '#...#', '####.', '#...#', '####.'], A: ['.###.', '#...#', '#####', '#...#', '#...#'],
  H: ['#...#', '#...#', '#####', '#...#', '#...#'], R: ['####.', '#...#', '####.', '#..#.', '#...#'],
  V: ['#...#', '#...#', '#...#', '.#.#.', '..#..']
};
function bigText(word) {
  const rows = ['', '', '', '', ''];
  for (const ch of word) for (let r = 0; r < 5; r++) rows[r] += ch === ' ' ? '   ' : BIG_FONT[ch][r].replace(/\./g, ' ') + ' ';
  return rows.map(x => x.trimEnd());
}
// Compact on purpose: the whole startup screen must fit the default console window (about 30 rows x 120 columns).
function titleBanner() {
  const color = process.stdout.isTTY && !process.env.NO_COLOR, cyan = x => color ? `\x1b[1;36m${x}\x1b[0m` : x;
  const wide = !process.stdout.columns || process.stdout.columns >= 100;     // one 93-column line, or two lines for narrow consoles
  const rows = (wide ? [bigText('BLOCSTASH SERVER')] : [bigText('BLOCSTASH'), bigText('SERVER')]).flatMap((r, i) => i ? ['', ...r] : r);
  return [...rows.map(x => cyan('  ' + x)), ''].join('\n');
}
function keepOpenWarning() {
  const color = process.stdout.isTTY && !process.env.NO_COLOR;
  const red = x => color ? `\x1b[1;31m${x}\x1b[0m` : x, yellow = x => color ? `\x1b[1;33m${x}\x1b[0m` : x;
  const bar = '='.repeat(72);
  return ['', red(bar), ...bigText('DO NOT CLOSE').map(x => red('  ' + x)),
    yellow(' KEEP THIS WINDOW OPEN WHILE YOU USE BLOCSTASH'),
    ' Closing it stops the server. Uploads and gallery browsing need it running.',
    ' Minimise it instead. To stop on purpose, press Ctrl+C.',
    red(bar)].join('\n');
}
process.title = 'BlocStash server - DO NOT CLOSE THIS WINDOW';

server.listen(PORT, '0.0.0.0', async () => {
  const proto = E.STASH_CERT && E.STASH_KEY ? 'https' : 'http';
  console.log(titleBanner());
  console.log(`BlocStash is running. Photos are stored in: ${DIR}`);
  console.log(`On this computer: ${proto}://localhost:${PORT}`);
  lanReachable().forEach(address => console.log(`On your phone: ${proto}://${address}:${PORT} (same Wi-Fi)`));
  const ts = await tailscaleInfo();
  if (ts.addresses.length) console.log(`Remote (Tailscale): ${proto}://${ts.addresses[0]}:${PORT}${ts.dnsName ? `  or  ${proto}://${ts.dnsName}:${PORT}` : ''}`);
  else console.log('Remote access: install Tailscale on this computer (see README).');
  if (isChromeOSLinux) {
    console.log('\nChromeOS Linux detected. Phones cannot reach this Linux container directly, so:');
    console.log(`  1. Settings > Advanced > Developers > Linux > Port forwarding: add and turn on TCP port ${PORT}.`);
    console.log("  2. Settings > Network > your Wi-Fi network: note the Chromebook's IP address.");
    console.log(`  3. On your phone open ${proto}://<that IP address>:${PORT}`);
    console.log(`  4. Optional: start with STASH_PUBLIC_HOST=<that IP address>:${PORT} so invitation QR codes use it.`);
  }
  console.log(`\nOpen ${proto}://localhost:${PORT} on this computer. Create the household administrator account on first launch.`);
  console.log(`After setup, use Settings → Invite member to invite flatmates.`);
  console.log(keepOpenWarning());
});
