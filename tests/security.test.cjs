
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createApp}=require('../server.cjs'),{fresh,validState}=require('../src/validation.cjs');
const {requestHandler}=require('./helpers/request.cjs');
let port=49170,counter=0;
async function fixture(t,overrides={},dependencies={verifyCaptcha:async token=>token.startsWith('valid-')}){const dir=fs.mkdtempSync(path.join(__dirname,'temp-'));const origin='http://127.0.0.1:'+port++;
const server=createApp({origin,dataDir:dir,allowedEmails:['a@example.com','b@example.com'],registrationCode:'test-invitation-at-least-32-characters',...overrides},dependencies);
const appOrigin=overrides.origin||origin;
const network=process.env.NUTRA_TEST_HTTP==='1';
if(network)await new Promise(r=>server.listen(new URL(origin).port,'127.0.0.1',r));
t.after(async()=>{if(network)await new Promise(r=>server.close(r));else server.emit('close');fs.rmSync(dir,{recursive:true,force:true})});
const request=network?async(p,{method='GET',body,cookie,csrf,headers={}}={})=>{
  const payload=body===undefined?undefined:Buffer.from(JSON.stringify(body));
  return new Promise((resolve,reject)=>{
    const req=require('node:http').request({hostname:'127.0.0.1',port:new URL(origin).port,path:p,method,agent:false,headers:{Host:new URL(appOrigin).host,Origin:appOrigin,...(payload?{'Content-Type':'application/json','Content-Length':payload.length}:{}),...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...headers}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{
        const text=Buffer.concat(chunks).toString('utf8');let data;try{data=JSON.parse(text)}catch{data=text}
        const values=new Map(Object.entries(res.headers).map(([key,value])=>[key.toLowerCase(),Array.isArray(value)?value.join(', '):String(value)]));
        resolve({status:res.statusCode,headers:{get(name){return values.get(String(name).toLowerCase())??null}},data});
      });
    });
    req.on('error',reject);if(payload)req.write(payload);req.end();
  });
}:requestHandler(server,appOrigin);
const register=async(email='a@example.com')=>{const r=await request('/api/auth/register',{method:'POST',body:{name:'Prueba',email,invitation:'test-invitation-at-least-32-characters',password:'una frase extensa para pruebas',captcha:'valid-'+counter++}});assert.equal(r.status,200,JSON.stringify(r.data));return {cookie:r.headers.get('set-cookie').split(';')[0],csrf:r.data.csrf}};
return {request,register,dir,origin};}
test('Validación estricta rechaza datos fuera de rango y campos arbitrarios',()=>{assert.equal(validState(fresh('Ana')),true);const s=fresh('Ana');s.profile.k=-1;assert.equal(validState(s),false);s.profile.k=2200;s.admin=true;assert.equal(validState(s),false)});
test('Acceso anónimo, archivos privados, CSP y origen cruzado',async t=>{const {request}=await fixture(t);assert.equal((await request('/api/state')).status,401);const me=await request('/api/auth/me');assert.equal(me.status,200);assert.deepEqual(me.data,{csrf:null,email:null});for(const p of ['/.env','/data/nutra.sqlite','/server.cjs','/.git/config'])assert.equal((await request(p)).status,404);
for(const p of ['/','/app.js','/styles.css','/foods.json','/manifest.json','/sw.js','/icon.svg','/favicon.ico'])assert.equal((await request(p)).status,200,p);
const r=await request('/');assert.equal(r.status,200);assert.ok(!r.headers.get('content-security-policy').includes('unsafe-inline'));assert.equal(r.headers.get('x-frame-options'),'DENY');assert.equal((await request('/api/auth/login',{method:'POST',body:{},headers:{Origin:'https://evil.invalid'}})).status,403)});
test('Registro, cookies, CSRF, aislamiento, conflictos y logout',async t=>{const {request,register}=await fixture(t);const a=await register(),b=await register('b@example.com');
let r=await request('/api/state',{...a});assert.equal(r.status,200);const data=r.data;data.state.profile.name='Solo A';
assert.equal((await request('/api/state',{method:'PUT',cookie:a.cookie,body:data})).status,403);
assert.equal((await request('/api/state',{method:'PUT',...a,body:data})).status,200);
assert.equal((await request('/api/state',{method:'PUT',...a,body:data})).status,409);
assert.equal((await request('/api/state',b)).data.state.profile.name,'Prueba');
assert.equal((await request('/api/state',a)).data.state.profile.name,'Solo A');
assert.deepEqual((await request('/api/auth/me',a)).data,{csrf:a.csrf,email:'a@example.com'});
assert.equal((await request('/api/auth/logout',{method:'POST',...a,body:{}})).status,200);assert.equal((await request('/api/state',a)).status,401)});
test('CAPTCHA inválido, repetición, correo no autorizado y contraseña corta',async t=>{const {request}=await fixture(t);const body={name:'Ana',email:'a@example.com',invitation:'test-invitation-at-least-32-characters',password:'una contraseña extensa segura',captcha:'invalid'};
assert.equal((await request('/api/auth/register',{method:'POST',body})).status,400);body.captcha='valid-replay';
assert.equal((await request('/api/auth/register',{method:'POST',body})).status,200);
assert.equal((await request('/api/auth/login',{method:'POST',body})).status,400);
body.captcha='valid-new';body.email='notallowed@example.com';assert.equal((await request('/api/auth/register',{method:'POST',body})).status,400);
body.password='short';assert.equal((await request('/api/auth/register',{method:'POST',body})).status,400)});
test('Login rota sesión y contraseñas nunca se almacenan en claro',async t=>{const {request,register,dir}=await fixture(t),a=await register();
const r=await request('/api/auth/login',{method:'POST',body:{email:'a@example.com',password:'una frase extensa para pruebas',captcha:'valid-'+counter++}});assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/HttpOnly/);assert.match(r.headers.get('set-cookie'),/SameSite=Strict/);
assert.equal((await request('/api/state',a)).status,401);
const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(path.join(dir,'nutra.sqlite'));const u=db.prepare('SELECT password,salt FROM users').get();assert.equal(u.password.length,128);assert.notEqual(u.password,'una frase extensa para pruebas');assert.equal(u.salt.length,64);db.close()});
test('Límite de intentos de autenticación y cabecera Retry-After',async t=>{const {request}=await fixture(t);let r;for(let i=0;i<13;i++)r=await request('/api/auth/login',{method:'POST',body:{}});assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'900')});
test('Validación de API, tamaño máximo, código de barras y datos maliciosos',async t=>{const {request,register}=await fixture(t),a=await register();
const s=fresh('Ana');s.profile.p=-1;assert.equal((await request('/api/state',{method:'PUT',...a,body:{state:s,version:0}})).status,400);
assert.equal((await request('/api/state',{method:'PUT',...a,body:{padding:'x'.repeat(270000)}})).status,413);
assert.equal((await request('/api/food/abcd',a)).status,400);assert.equal((await request('/api/food/12345678?url=https://evil.invalid',a)).status,400);
assert.equal((await request('/api/state',{method:'PUT',cookie:a.cookie,csrf:'é'.repeat(64),body:{}})).status,403)});
test('Fallo cerrado sin CAPTCHA y configuración insegura de producción',async t=>{assert.throws(()=>createApp({production:true}),/Producción requiere/);assert.throws(()=>createApp({origin:'http://192.168.1.1:4173'}),/HTTPS/);
const {request}=await fixture(t,{},{});const r=await request('/api/auth/register',{method:'POST',body:{name:'Ana',email:'a@example.com',password:'una frase extensa para pruebas',captcha:'x'}});assert.equal(r.status,503)});

test('Invitación obligatoria y caducidad de sesiones en servidor',async t=>{
const {request,register,dir}=await fixture(t);let r=await request('/api/auth/register',{method:'POST',body:{name:'Ana',email:'a@example.com',password:'una frase extensa para pruebas',invitation:'incorrecta',captcha:'valid-'+counter++}});assert.equal(r.status,400);
const a=await register();const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(path.join(dir,'nutra.sqlite'));db.prepare('UPDATE sessions SET last_seen=?').run(Date.now()-1900000);db.close();assert.equal((await request('/api/state',a)).status,401);
});
test('Cookies HTTPS usan Secure y prefijo __Host; HSTS activo',async t=>{
  const {request}=await fixture(t,{origin:'https://nutra.example'});
  const r=await request('/api/auth/register',{method:'POST',body:{name:'Ana',email:'a@example.com',password:'una frase extensa para pruebas',invitation:'test-invitation-at-least-32-characters',captcha:'valid-'+counter++}});
  assert.equal(r.status,200);
  assert.match(r.headers.get('set-cookie'),/^__Host-nutra=/);
  assert.match(r.headers.get('set-cookie'),/; Secure/);
  assert.ok(r.headers.get('strict-transport-security'));
});
