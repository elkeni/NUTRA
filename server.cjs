
'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {promisify}=require('node:util'),{DatabaseSync}=require('node:sqlite');
const {validState,fresh}=require('./src/validation.cjs');
const derive=promisify(crypto.scrypt),hash=x=>crypto.createHash('sha256').update(x).digest('hex'),token=()=>crypto.randomBytes(32).toString('hex');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
const fail=(status,message)=>Object.assign(new Error(message),{status});
async function passwordHash(password,salt){return (await derive(password,salt,64,{N:32768,r:8,p:3,maxmem:64*1024*1024})).toString('hex')}
function createApp(config={},dependencies={}){
const origin=config.origin||'http://127.0.0.1:4173',urlOrigin=new URL(origin),secure=urlOrigin.protocol==='https:';
const production=config.production===true,host=config.host||'127.0.0.1';
if(production&&(!secure||!config.turnstileSecret||!config.turnstileSiteKey||!config.allowedEmails?.length||!config.registrationCode||config.registrationCode.length<32))throw Error('Producción requiere HTTPS, claves Turnstile, ALLOWED_EMAILS y REGISTRATION_CODE de 32 caracteres.');
if(!secure&&!['127.0.0.1','localhost','[::1]'].includes(urlOrigin.hostname))throw Error('HTTP permitido únicamente en loopback. Usa HTTPS para acceso desde celulares.');
if(production&&(/^(1x|2x|3x)000000000/.test(config.turnstileSiteKey)||dependencies.verifyCaptcha))throw Error('No se admiten claves CAPTCHA de prueba ni verificadores alternativos en producción.');
const dir=config.dataDir||path.join(__dirname,'data');fs.mkdirSync(dir,{recursive:true});
const db=new DatabaseSync(path.join(dir,'nutra.sqlite'));db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
db.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,salt TEXT NOT NULL,password TEXT NOT NULL,state TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,csrf TEXT NOT NULL,expires INTEGER NOT NULL,last_seen INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS captcha_used(token TEXT PRIMARY KEY,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS cache(code TEXT PRIMARY KEY,data TEXT NOT NULL,expires INTEGER NOT NULL);`);
const cookieName=secure?'__Host-nutra':'nutra_local';
let hashing=0,external=0;
const cleanup=setInterval(()=>{const now=Date.now();for(const table of ['sessions','limits','captcha_used','cache'])db.prepare('DELETE FROM '+table+' WHERE expires < ?').run(now)},60000);cleanup.unref();
function limit(key,max,windowMs){const now=Date.now(),k=hash(key);const row=db.prepare('SELECT * FROM limits WHERE key=?').get(k);
if(row&&row.expires>now&&row.count>=max)throw fail(429,'Demasiados intentos. Espera unos minutos.');
db.prepare('INSERT INTO limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires<=? THEN 1 ELSE count+1 END,expires=CASE WHEN expires<=? THEN excluded.expires ELSE expires END').run(k,now+windowMs,now,now)}
function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data))}
function cookie(res,value,seconds){res.setHeader('Set-Cookie',cookieName+'='+value+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+seconds+(secure?'; Secure':''))}
function session(req){const cookies=(req.headers.cookie||'').split(';').map(x=>x.trim());const raw=cookies.find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
if(!raw||!/^[a-f0-9]{64}$/.test(raw))throw fail(401,'Inicia sesión para continuar.');
const s=db.prepare('SELECT * FROM sessions WHERE id=? AND expires>? AND last_seen>?').get(hash(raw),Date.now(),Date.now()-1800000);if(!s)throw fail(401,'Tu sesión terminó. Vuelve a ingresar.');
db.prepare('UPDATE sessions SET last_seen=? WHERE id=?').run(Date.now(),s.id);return s}
async function body(req,max=262144){if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw fail(415,'Se requiere JSON.');if(Number(req.headers['content-length'])>max)throw fail(413,'Solicitud demasiado grande.');let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>max)throw fail(413,'Solicitud demasiado grande.');chunks.push(chunk)}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw fail(400,'JSON inválido.')}}
async function captcha(value,action){if(typeof value!=='string'||!value||value.length>2048)throw fail(400,'Completa la verificación de seguridad.');
if(!config.turnstileSecret&&!dependencies.verifyCaptcha)throw fail(503,'La verificación CAPTCHA aún no está configurada.');
const digest=hash(value);try{db.prepare('INSERT INTO captcha_used VALUES(?,?)').run(digest,Date.now()+600000)}catch{throw fail(400,'Verificación vencida. Inténtalo nuevamente.')}
let valid=false;try{if(dependencies.verifyCaptcha)valid=await dependencies.verifyCaptcha(value,action);else{
const r=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:config.turnstileSecret,response:value}),signal:AbortSignal.timeout(6000)});const v=await r.json();valid=r.ok&&v.success===true&&v.hostname===urlOrigin.hostname&&v.action===action;
}}catch{throw fail(503,'No pudimos verificar el CAPTCHA. Intenta de nuevo.')}if(!valid)throw fail(400,'Verificación de seguridad inválida.')}
async function handle(req,res){
res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self'; img-src 'self' data:; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'");
res.setHeader('Cache-Control','no-store');if(secure)res.setHeader('Strict-Transport-Security','max-age=31536000');
try{
if(req.headers.host!==urlOrigin.host)throw fail(421,'Host no permitido.');
const url=new URL(req.url,origin),p=url.pathname,ip=req.socket.remoteAddress||'unknown';
limit('global',6000,60000);limit('ip:'+ip,300,60000);
if(p.startsWith('/api/')){
if(req.headers['sec-fetch-site']==='cross-site')throw fail(403,'Origen no permitido.');
if(!['GET','POST','PUT'].includes(req.method))throw fail(405,'Método no permitido.');
if(req.method!=='GET'&&req.headers.origin!==origin)throw fail(403,'Origen no permitido.');
if(p==='/api/config'&&req.method==='GET')return send(res,200,{siteKey:config.turnstileSiteKey||null,configured:!!(config.turnstileSecret&&config.turnstileSiteKey&&config.registrationCode&&config.allowedEmails?.length),personalOnly:true});
if(['/api/auth/register','/api/auth/login'].includes(p)&&req.method==='POST'){
limit('auth:'+ip,12,900000);limit('auth-global',60,60000);
const b=await body(req,8192);if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!['email','password','name','captcha','website','invitation'].includes(k)))throw fail(400,'Datos inválidos.');
if(b.website)throw fail(400,'Solicitud inválida.');
const email=typeof b.email==='string'?b.email.trim().toLowerCase():'';
if(email.length>254||!/^([^\s@]+)@([^\s@]+)\.([^\s@]+)$/.test(email)||typeof b.password!=='string'||b.password.length<15||b.password.length>128)throw fail(400,'Usa un correo válido y una contraseña de 15 a 128 caracteres.');
limit('account:'+email,10,900000);
const register=p.endsWith('register');await captcha(b.captcha,register?'register':'login');
if(hashing>=2)throw fail(503,'Servidor ocupado. Intenta nuevamente.');hashing++;
let user;
try{
const found=db.prepare('SELECT * FROM users WHERE email=?').get(email);
if(register){
if(typeof b.name!=='string'||!b.name.trim()||b.name.trim().length>50||/[\u0000-\u001f]/.test(b.name))throw fail(400,'Nombre inválido.');
const salt=token(),pw=await passwordHash(b.password,salt);
if(found||!(config.allowedEmails||[]).includes(email)||!config.registrationCode||!equal(b.invitation,config.registrationCode))throw fail(400,'No se pudo crear la cuenta. Comprueba que tu correo esté autorizado o inicia sesión.');
user={id:crypto.randomUUID(),email};db.prepare('INSERT INTO users(id,email,salt,password,state) VALUES(?,?,?,?,?)').run(user.id,email,salt,pw,JSON.stringify(fresh(b.name.trim())));
}else{
const pw=await passwordHash(b.password,found?.salt||'00000000000000000000000000000000');
if(!found||!equal(pw,found.password))throw fail(401,'Correo o contraseña incorrectos.');user=found;
}
}finally{hashing--}
const raw=token(),csrf=token();db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run(hash(raw),user.id,csrf,Date.now()+43200000,Date.now());cookie(res,raw,43200);return send(res,200,{csrf,email:user.email});
}
const s=session(req);limit('user:'+s.user_id,180,60000);
if(req.method!=='GET'&&!equal(req.headers['x-csrf-token'],s.csrf))throw fail(403,'Verificación de sesión inválida.');
if(p==='/api/auth/me'&&req.method==='GET'){const u=db.prepare('SELECT email FROM users WHERE id=?').get(s.user_id);return send(res,200,{csrf:s.csrf,email:u.email})}
if(p==='/api/auth/logout'&&req.method==='POST'){db.prepare('DELETE FROM sessions WHERE id=?').run(s.id);cookie(res,'',0);return send(res,200,{ok:true})}
if(p==='/api/state'&&req.method==='GET'){const u=db.prepare('SELECT state,version FROM users WHERE id=?').get(s.user_id);return send(res,200,{state:JSON.parse(u.state),version:u.version})}
if(p==='/api/state'&&req.method==='PUT'){
limit('save:'+s.user_id,90,60000);const b=await body(req);if(!b||!Number.isInteger(b.version)||b.version<0||!validState(b.state))throw fail(400,'Los registros contienen valores inválidos o exceden el límite.');
const result=db.prepare('UPDATE users SET state=?,version=version+1 WHERE id=? AND version=?').run(JSON.stringify(b.state),s.user_id,b.version);if(!result.changes)throw fail(409,'Tus datos cambiaron en otra sesión. Recarga antes de continuar.');
return send(res,200,{version:b.version+1})}
if(p.startsWith('/api/food/')&&req.method==='GET'){
limit('food:'+s.user_id,20,60000);limit('food-global',100,60000);
const code=p.slice('/api/food/'.length);if(!/^\d{8,14}$/.test(code)||url.search)throw fail(400,'Código inválido.');
const cached=db.prepare('SELECT data FROM cache WHERE code=? AND expires>?').get(code,Date.now());if(cached)return send(res,200,JSON.parse(cached.data));
if(external>=4)throw fail(503,'Búsqueda ocupada. Inténtalo en unos segundos.');external++;
try{
const r=await fetch('https://world.openfoodfacts.org/api/v2/product/'+code+'.json?fields=product_name,nutriments',{headers:{'User-Agent':'NutraPersonal/2.0 (personal nutrition diary)'},signal:AbortSignal.timeout(8000),redirect:'error'});
if(!r.ok)throw fail(502,'No se pudo consultar el producto.');const raw=await r.text();if(raw.length>131072)throw fail(502,'Respuesta no válida.');
const v=JSON.parse(raw),n=v.product?.nutriments;if(v.status!==1||!Number.isFinite(n?.['energy-kcal_100g']))throw fail(404,'Producto no encontrado. Puedes crearlo manualmente.');
const food={id:'off'+code,name:String(v.product.product_name||'Producto '+code).replace(/[\u0000-\u001f]/g,'').slice(0,90),emoji:'📦',k:n['energy-kcal_100g'],p:n.proteins_100g||0,c:n.carbohydrates_100g||0,f:n.fat_100g||0};
if(![food.k,food.p,food.c,food.f].every(x=>Number.isFinite(x)&&x>=0)||food.k>1000||Math.max(food.p,food.c,food.f)>100)throw fail(502,'Etiqueta nutricional no válida.');
db.prepare('INSERT OR REPLACE INTO cache VALUES(?,?,?)').run(code,JSON.stringify(food),Date.now()+86400000);return send(res,200,food);
}finally{external--}
}
throw fail(404,'Ruta no encontrada.');
}
if(!['GET','HEAD'].includes(req.method))throw fail(405,'Método no permitido.');
const staticFiles={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/styles.css':'styles.css','/foods.json':'foods.json','/icon.svg':'icon.svg','/manifest.json':'manifest.json','/sw.js':'sw.js'};
const file=staticFiles[p];if(!file)throw fail(404,'No encontrado.');
const ext=path.extname(file),types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml'};
res.setHeader('Content-Type',types[ext]);const content=fs.readFileSync(path.join(__dirname,'dist',file));res.writeHead(200);res.end(req.method==='HEAD'?undefined:content);
}catch(e){if(!res.headersSent){if(e.status===429)res.setHeader('Retry-After','900');send(res,e.status||500,{error:e.status?e.message:'Error interno. Intenta nuevamente.'})}else res.end()}
}
const server=http.createServer({maxHeaderSize:8192,requestTimeout:10000,headersTimeout:10000,keepAliveTimeout:5000,connectionsCheckingInterval:1000},handle);server.maxConnections=100;
server.on('close',()=>{clearInterval(cleanup);db.close()});return server;
}
if(require.main===module){
if(fs.existsSync(path.join(__dirname,'.env')))require('node:process').loadEnvFile(path.join(__dirname,'.env'));
const env=process.env;const server=createApp({origin:env.APP_ORIGIN||'http://127.0.0.1:4173',production:env.NODE_ENV==='production',turnstileSiteKey:env.TURNSTILE_SITE_KEY,turnstileSecret:env.TURNSTILE_SECRET_KEY,registrationCode:env.REGISTRATION_CODE,allowedEmails:(env.ALLOWED_EMAILS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean),dataDir:env.DATA_DIR});
server.listen(Number(env.PORT||4173),'127.0.0.1',()=>console.log('Nutra: '+(env.APP_ORIGIN||'http://127.0.0.1:4173')));
}
module.exports={createApp,passwordHash};
