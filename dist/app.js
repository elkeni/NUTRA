
'use strict';
const $=s=>document.querySelector(s),meals=['Desayuno','Almuerzo','Cena','Snacks'],icons=['☀','🥗','☾','🍎'];
let state=null,version=0,csrf='',account='',page='Diario',date=today(),base=[],recipes=[],config={},busy=false,authMode='login',widget=null,captchaToken='',tsPromise;
function today(d=new Date()){return new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,10)}
function esc(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
const round=n=>Math.round(n);
function day(){return state.days[date]||(state.days[date]={entries:[],water:0})}
function foods(){return [...base,...state.foods]}
function totals(entries=day().entries){return entries.reduce((a,e)=>{for(const k of ['k','p','c','f'])a[k]+=e[k]*e.grams/100;return a},{k:0,p:0,c:0,f:0})}
function button(text,action,data='',cls='quiet'){return '<button class="'+cls+'" data-action="'+action+'" '+data+'>'+text+'</button>'}
function toast(t){$('#toast').textContent=t;$('#toast').classList.remove('hidden');setTimeout(()=>$('#toast').classList.add('hidden'),4000)}
async function api(p,method='GET',data){const r=await fetch('/api/'+p,{method,credentials:'same-origin',cache:'no-store',headers:{...(data?{'Content-Type':'application/json'}:{}),...(method!=='GET'?{'X-CSRF-Token':csrf}:{})},body:data?JSON.stringify(data):undefined});const b=await r.json();if(!r.ok){const e=Error(b.error||'No se pudo completar la solicitud.');e.status=r.status;throw e}return b}
async function persist(change){if(busy)return;busy=true;const prior=structuredClone(state);change();try{const r=await api('state','PUT',{state,version});version=r.version;render();toast('Guardado en tu cuenta');return true}catch(e){state=prior;if(e.status===401){state=null;csrf='';auth()}else if(e.status===409){try{const r=await api('state');state=r.state;version=r.version;render()}catch{}}toast(e.message)}finally{busy=false}}
function modal(title,body){$('#modal').innerHTML='<div class="between"><h2>'+esc(title)+'</h2>'+button('✕','close','','text-btn')+'</div>'+body;if(!$('#modal').open)$('#modal').showModal()}
function close(){ $('#modal').close()}
function heading(title,sub){return '<div class="heading"><h1>'+title+'</h1><p>'+sub+'</p></div>'}
async function loadTurnstile(){
  if(window.turnstile)return;
  if(!tsPromise)tsPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async=true;
    script.onload=resolve;
    script.onerror=()=>{
      script.remove();
      tsPromise=null;
      reject(Error('No se pudo cargar la verificación. Revisa tu conexión.'));
    };
    document.head.appendChild(script);
  });
  return tsPromise;
}
function updateAuthSubmit(){
  const form=$('#auth-form');
  if(form)$('#auth-submit').disabled=!captchaToken||form.dataset.submitting==='true';
}
function captchaStatus(message='',canRetry=false){
  $('#captcha-status').textContent=message;
  $('#captcha-retry').classList.toggle('hidden',!canRetry);
  updateAuthSubmit();
}
async function mountCaptcha(){
  const container=$('#captcha');
  captchaStatus('Cargando verificación…');
  try{
    await loadTurnstile();
    if(container!==$('#captcha'))return;
    const onFailure=message=>{
      if(container!==$('#captcha'))return;
      captchaToken='';
      captchaStatus(message,true);
    };
    widget=window.turnstile.render(container,{
      sitekey:config.siteKey,action:authMode,theme:'light',size:container.clientWidth<300?'compact':'flexible',retry:'never',
      'refresh-expired':'never','refresh-timeout':'never',
      callback(token){
        if(container!==$('#captcha'))return;
        captchaToken=token;
        captchaStatus();
      },
      'error-callback'(){
        onFailure('No se completó la verificación. Puedes intentarlo de nuevo.');
        return true;
      },
      'expired-callback'(){
        onFailure('La verificación venció. Inténtalo de nuevo.');
      },
      'timeout-callback'(){
        onFailure('Se agotó el tiempo de verificación. Inténtalo de nuevo.');
      }
    });
  }catch(error){
    if(container===$('#captcha'))captchaStatus(error.message,true);
  }
}
function retryCaptcha(){
  captchaToken='';
  if(widget===null)return mountCaptcha();
  captchaStatus('Verificando…');
  window.turnstile.reset(widget);
}
async function auth(){captchaToken='';if(widget!==null&&window.turnstile){window.turnstile.remove(widget);widget=null}$('#app').innerHTML='<main class="auth"><div class="brand">nutra<b>●</b></div>'+heading('Tu bienestar, contigo.','Registra tus comidas y acompaña tu progreso, estés donde estés.')+'<div class="card"><div class="tabs">'+button('Ingresar','mode','data-mode="login"',authMode==='login'?'':'quiet')+button('Crear cuenta','mode','data-mode="register"',authMode==='register'?'':'quiet')+'</div><form id="auth-form">'+(authMode==='register'?'<label>Tu nombre<input name="name" autocomplete="given-name" maxlength="50" required></label>':'')+'<label>Correo electrónico<input type="email" name="email" autocomplete="username" maxlength="254" required></label><label>Contraseña<input type="password" name="password" autocomplete="'+(authMode==='register'?'new-password':'current-password')+'" minlength="15" maxlength="128" required></label><small>Usa una frase de al menos 15 caracteres.</small>'+(authMode==='register'?'<label>Código de invitación<input name="invitation" autocomplete="off" minlength="32" maxlength="256" required></label><label>Confirmar contraseña<input type="password" name="confirm" autocomplete="new-password" minlength="15" maxlength="128" required></label>':'')+'<div class="hp" aria-hidden="true"><label>Deja este campo vacío<input name="website" tabindex="-1" autocomplete="off"></label></div><p class="note">Espacio personal. Solo pueden registrarse los correos autorizados por el propietario.</p><div id="captcha"></div><p id="captcha-status" class="note" role="status"></p><button type="button" id="captcha-retry" class="quiet hidden" data-action="retry-captcha">Reintentar verificación</button><p id="auth-error" class="error hidden" role="alert"></p><button class="wide" id="auth-submit" disabled>'+(authMode==='register'?'Crear mi cuenta':'Entrar a Nutra')+'</button></form></div><p class="note">'+(config.configured?'Tus registros se guardan en tu cuenta. Cierra sesión en dispositivos compartidos.':'Configuración pendiente: el propietario debe activar Turnstile y autorizar su correo en el servidor. El acceso permanece bloqueado hasta entonces.')+'</p></main>';
if(config.configured)await mountCaptcha();}
function authError(t){$('#auth-error').textContent=t;$('#auth-error').classList.remove('hidden')}
function render(){if(!state)return auth();$('#app').innerHTML='<main class="shell"><header class="top"><div class="brand">nutra<b>●</b></div><div class="row"><small>'+esc(state.profile.name)+'</small><span class="avatar">'+esc(state.profile.name.slice(0,1).toUpperCase())+'</span></div></header>'+({Diario:diary,Plan:planPage,Recetas:recipePage,Progreso:progress,Ajustes:settings}[page])()+'</main><nav aria-label="Navegación principal">'+['Diario','Plan','Recetas','Progreso','Ajustes'].map((p,i)=>button('<span>'+['◉','▦','♧','↗','⚙'][i]+'</span>'+p,'page','data-page="'+p+'"',page===p?'active':'')).join('')+'</nav>'}
function diary(){const t=totals(),g=state.profile,n=Math.abs(g.k-t.k),pct=Math.min(100,t.k/g.k*100);return heading('Tu día, en equilibrio','Cada comida cuenta. Un hábito a la vez.')+'<div class="between"><input class="dates" aria-label="Fecha" id="date" type="date" value="'+date+'">'+button('＋ Registrar','add','data-meal="0"','')+'</div><div class="card"><div class="between"><h2>Resumen diario</h2><span class="pill">'+g.k+' kcal</span></div><div class="summary"><div class="ring"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="45" fill="none" stroke="#edf2e6" stroke-width="6"/><circle cx="50" cy="50" r="45" fill="none" stroke="#93af75" stroke-width="6" stroke-linecap="round" pathLength="100" stroke-dasharray="'+pct+' 100"/></svg><div class="value"><small>'+(g.k>=t.k?'TE QUEDAN':'SOBRE EL OBJETIVO')+'</small><strong>'+round(n)+'</strong><small>kcal</small></div></div><div>'+[['p','Proteínas'],['c','Carbohidratos'],['f','Grasas']].map(([k,l])=>'<div class="macro"><div class="between"><b>'+l+'</b><span>'+round(t[k])+'/'+g[k]+' g</span></div><progress max="'+g[k]+'" value="'+t[k]+'"></progress></div>').join('')+'</div></div><small>'+round(t.k)+' kcal consumidas · Objetivos editables</small></div><div class="between section"><h2>Tus comidas</h2>'+button('Copiar ayer','copy','','text-btn')+'</div>'+meals.map((m,i)=>{const entries=day().entries.filter(e=>e.meal===i);return '<section class="card"><div class="between"><div class="row"><span>'+icons[i]+'</span><div><h3>'+m+'</h3><small>'+round(totals(entries).k)+' kcal</small></div></div>'+button('＋','add','data-meal="'+i+'" aria-label="Agregar a '+m+'"')+'</div>'+(entries.length?entries.map(e=>'<div class="entry"><span>'+esc(e.emoji)+'</span><div class="grow"><b>'+esc(e.name)+'</b><small>'+e.grams+' g · '+round(e.k*e.grams/100)+' kcal</small></div>'+button('✎','edit','data-id="'+esc(e.uid)+'" aria-label="Editar porción"')+button('×','delete','data-id="'+esc(e.uid)+'" aria-label="Eliminar alimento"')+'</div>').join(''):'<p class="empty">Registra lo que comiste. Este espacio es tuyo.</p>')+'</section>'}).join('')+'<div class="card"><div class="between"><h2>💧 Agua</h2><b>'+day().water/1000+' / '+g.water/1000+' L</b></div><progress max="'+g.water+'" value="'+day().water+'"></progress><div class="between section">'+button('− 250 ml','water','data-value="-250"')+button('＋ 250 ml','water','data-value="250"')+'</div></div>'}
let meal=0,chosen=null,editing=null;
function add(m){meal=m;editing=null;modal('Registrar en '+meals[m],'<div class="row wrap section">'+button('＋ Crear alimento','custom')+button('Código de barras','barcode')+'</div><label>Buscar alimento<input id="search" placeholder="Pollo, arroz, palta…" autocomplete="off"></label><div id="results" class="results"></div><p class="note">Valores genéricos aproximados por 100 g. Para productos envasados, consulta la etiqueta.</p>');search('');$('#search').focus()}
function search(q){const normalize=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();$('#results').innerHTML=foods().filter(f=>normalize(f.name).includes(normalize(q))).map(f=>button('<span>'+esc(f.emoji)+' '+esc(f.name)+'</span><small>'+f.k+' kcal</small>','choose','data-id="'+esc(f.id)+'"','result')).join('')||'<p class="empty">No encontrado. Puedes crear un alimento.</p>'}
function portion(g=100){modal(chosen.name,'<form id="portion"><label>Porción en gramos<input name="grams" id="grams" type="number" min="0.1" max="10000" step="0.1" value="'+g+'" required></label><p id="estimate"></p><label>Comida<select name="meal">'+meals.map((m,i)=>'<option value="'+i+'" '+(i===meal?'selected':'')+'>'+m+'</option>').join('')+'</select></label><button class="wide">Guardar comida</button></form>');estimate()}
function estimate(){const g=Number($('#grams').value)/100;$('#estimate').textContent=round(chosen.k*g)+' kcal · P '+round(chosen.p*g)+' g · C '+round(chosen.c*g)+' g · G '+round(chosen.f*g)+' g'}
function custom(){modal('Crear alimento','<form id="custom"><label>Nombre<input name="name" maxlength="90" required></label><p class="note">Información por 100 g, según la etiqueta.</p><div class="form-grid">'+[['k','Calorías (kcal)'],['p','Proteínas (g)'],['c','Carbohidratos (g)'],['f','Grasas (g)']].map(([k,n])=>'<label>'+n+'<input name="'+k+'" type="number" min="0" max="'+(k==='k'?1000:100)+'" step="0.1" required></label>').join('')+'</div><button class="wide">Crear y elegir porción</button></form>')}
function recipeEntries(i,m){return recipes[i].items.filter(x=>x[1]>0).map(([id,grams])=>({...base.find(f=>f.id===id),grams,meal:m,uid:crypto.randomUUID()}))}
function recipePage(){return heading('Simple, rico y a tu medida','Ideas de casa, con porciones claras.')+'<div class="grid">'+recipes.map((r,i)=>'<article class="card recipe"><div class="hero">'+r.emoji+'</div><span class="pill">'+round(totals(recipeEntries(i,0)).k)+' kcal</span><h2>'+esc(r.name)+'</h2><p>'+esc(r.desc)+'</p>'+button('Ver receta','recipe','data-index="'+i+'"','quiet wide')+'</article>').join('')+'</div>'}
function recipe(i){const r=recipes[i];modal(r.name,'<div class="hero">'+r.emoji+'</div><p>'+esc(r.steps)+'</p>'+recipeEntries(i,0).map(e=>'<p class="between"><span>'+esc(e.name)+'</span><b>'+e.grams+' g</b></p>').join('')+'<form id="recipe" data-index="'+i+'"><label>Agregar a<select name="meal">'+meals.map((m,j)=>'<option value="'+j+'">'+m+'</option>').join('')+'</select></label><button class="wide">Registrar receta</button></form>')}
function weekDates(){return Array.from({length:7},(_,i)=>{const d=new Date(date+'T12:00:00');d.setDate(d.getDate()+i);return today(d)})}
function planPage(){return heading('Tu semana, más simple','Organiza tus recetas y prepara tus compras.')+'<div class="row wrap"><input class="dates" id="date" aria-label="Inicio de semana" type="date" value="'+date+'">'+button('Lista de compras','shopping')+button('Generar ideas','generate')+'</div><p class="note">Las ideas no ajustan automáticamente las porciones a tus objetivos.</p>'+weekDates().map(d=>'<div class="card"><h3>'+new Date(d+'T12:00:00').toLocaleDateString('es-PE',{weekday:'long',day:'numeric',month:'short'})+'</h3><div class="form-grid">'+meals.map((m,j)=>'<label>'+m+'<select data-plan="'+d+'" data-meal="'+j+'"><option value="">Sin planificar</option>'+recipes.map((r,i)=>'<option value="'+i+'" '+(state.plan[d]?.[j]===i?'selected':'')+'>'+esc(r.name)+'</option>').join('')+'</select></label>').join('')+'</div></div>').join('')}
function shopping(){const list={};weekDates().forEach(d=>Object.values(state.plan[d]||{}).forEach(i=>recipes[i].items.forEach(([id,g])=>list[id]=(list[id]||0)+g)));modal('Lista de compras',Object.entries(list).filter(x=>x[1]>0).map(([id,g])=>'<label class="row"><input type="checkbox" data-check="'+esc(id)+'" '+(state.checks.includes(id)?'checked':'')+'><span class="grow">'+esc(base.find(f=>f.id===id).name)+'</span><b>'+g+' g</b></label>').join('')||'<p>Agrega recetas a tu plan para ver los ingredientes.</p>')}
function progress(){const weights=[...state.weights].sort((a,b)=>b.date.localeCompare(a.date));return heading('Mira tu progreso','Cada registro es una parte de tu historia.')+button('＋ Registrar peso','weight','','')+'<div class="card"><small>ÚLTIMO PESO</small><h1>'+(weights[0]?.value||'—')+' kg</h1><p class="note">'+Object.values(state.days).filter(d=>d.entries.length).length+' días con comidas registradas</p></div><div class="card"><h2>Calorías · últimos 7 días</h2><div class="chart">'+Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-6+i);const t=totals(state.days[today(d)]?.entries||[]),h=Math.min(100,t.k/state.profile.k*100);return '<div class="column">'+round(t.k)+'<svg viewBox="0 0 30 110"><rect class="colbar" x="3" y="'+(110-h)+'" width="24" height="'+h+'" rx="4"/></svg>'+d.toLocaleDateString('es',{weekday:'short'})+'</div>'}).join('')+'</div></div><div class="card"><h2>Historial de peso</h2>'+(weights.map(w=>'<div class="entry"><span class="grow">'+esc(w.date)+'</span><b>'+w.value+' kg</b>'+button('×','delete-weight','data-date="'+w.date+'" aria-label="Eliminar peso"')+'</div>').join('')||'<p class="empty">Registra tu primer peso.</p>')+'</div>'}
function settings(){return heading('Tu espacio personal','Objetivos, datos y seguridad de tu cuenta.')+'<form id="settings" class="card"><h2>Objetivos diarios</h2><div class="form-grid">'+[['name','Nombre'],['k','Calorías (kcal)'],['p','Proteínas (g)'],['c','Carbohidratos (g)'],['f','Grasas (g)'],['water','Agua (ml)']].map(([k,n])=>'<label>'+n+'<input name="'+k+'" value="'+esc(state.profile[k])+'" '+(k==='name'?'maxlength="50"':'type="number" min="1" max="'+(k==='water'?15000:k==='k'?10000:1000)+'"')+' required></label>').join('')+'</div><p class="note">Los valores iniciales son ejemplos, no recomendaciones personales.</p><button class="wide">Guardar objetivos</button></form><div class="card"><h2>Tus datos</h2><p class="note">Guardados en el servidor y separados por cuenta. Las copias descargadas contienen tus registros personales.</p>'+button('↓ Exportar copia','export')+'<label>Importar una copia JSON<input id="import" type="file" accept=".json,application/json"></label>'+button('Importar datos de la versión anterior','legacy')+'</div><div class="card"><h2>Seguridad</h2><p>'+esc(account)+'</p><p class="note">Sesión de hasta 12 horas, con cierre tras 30 minutos sin actividad. Iniciar sesión en otro dispositivo cierra la sesión anterior.</p>'+button('Cerrar sesión','logout','','danger wide')+'</div>'}
const actions={
close,'retry-captcha':retryCaptcha,mode:el=>{if($('#auth-form')?.dataset.submitting==='true')return;authMode=el.dataset.mode;auth()},page:el=>{page=el.dataset.page;render()},add:el=>add(Number(el.dataset.meal)),
choose:el=>{chosen=foods().find(f=>f.id===el.dataset.id);portion()},edit:el=>{chosen=day().entries.find(e=>e.uid===el.dataset.id);editing=chosen.uid;meal=chosen.meal;portion(chosen.grams)},
delete:el=>persist(()=>{day().entries=day().entries.filter(e=>e.uid!==el.dataset.id)}),
water:el=>persist(()=>{day().water=Math.min(20000,Math.max(0,day().water+Number(el.dataset.value)))}),
custom,barcode:()=>modal('Código de barras','<form id="barcode"><label>Código del envase<input name="code" inputmode="numeric" pattern="[0-9]{8,14}" required></label><p class="note">Consulta de productos a Open Food Facts.</p><button class="wide">Buscar producto</button></form>'),
copy:()=>{const d=new Date(date+'T12:00:00');d.setDate(d.getDate()-1);const entries=state.days[today(d)]?.entries;if(!entries?.length)return toast('No hay comidas del día anterior.');if(confirm('¿Agregar las comidas del día anterior?'))persist(()=>day().entries.push(...entries.map(e=>({...e,uid:crypto.randomUUID()}))))},
recipe:el=>recipe(Number(el.dataset.index)),shopping,
generate:()=>{if(confirm('¿Reemplazar el plan de estos 7 días con ideas?'))persist(()=>weekDates().forEach((d,i)=>state.plan[d]={0:i%2?1:2,1:i%2?0:4,2:i%2?5:0,3:3}))},
weight:()=>modal('Registrar peso','<form id="weight"><label>Fecha<input name="date" type="date" value="'+today()+'" required></label><label>Peso en kg<input name="weight" type="number" min="20" max="500" step="0.1" required></label><button class="wide">Guardar peso</button></form>'),
'delete-weight':el=>persist(()=>{state.weights=state.weights.filter(w=>w.date!==el.dataset.date)}),
export:()=>{const u=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=u;a.download='nutra-'+today()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)},
legacy:()=>{try{const old=JSON.parse(localStorage.getItem('nutra-v1'));if(!old)return toast('No hay registros antiguos en este navegador.');if(confirm('¿Reemplazar los datos de tu cuenta con los de la versión anterior?'))persist(()=>{state=old})}catch{toast('No se pudieron leer los registros antiguos.')}},
logout:async()=>{await api('auth/logout','POST',{});state=null;csrf='';close();auth()}
};
document.addEventListener('click',async e=>{const el=e.target.closest('[data-action]');if(!el)return;try{await actions[el.dataset.action]?.(el)}catch(err){toast(err.message)}});
document.addEventListener('input',e=>{if(e.target.id==='search')search(e.target.value);if(e.target.id==='grams')estimate()});
document.addEventListener('change',async e=>{const el=e.target;if(el.id==='date'){date=el.value||today();render()}
if(el.dataset.plan){const d=el.dataset.plan,m=el.dataset.meal,v=el.value;await persist(()=>{state.plan[d]||={};if(v==='')delete state.plan[d][m];else state.plan[d][m]=Number(v)})}
if(el.dataset.check){const id=el.dataset.check,on=el.checked;await persist(()=>{state.checks=state.checks.filter(x=>x!==id);if(on)state.checks.push(id)})}
if(el.id==='import'){const f=el.files[0];if(!f)return;if(f.size>250000){toast('La copia supera el tamaño máximo.');return}try{const data=JSON.parse(await f.text());if(confirm('¿Reemplazar los datos actuales por esta copia?'))await persist(()=>{state=data})}catch{toast('Archivo JSON inválido.')}el.value=''}});
document.addEventListener('submit',async e=>{e.preventDefault();const form=e.target,f=new FormData(form),submit=form.querySelector('button[type=submit],button:not([type])');
const isAuth=form.id==='auth-form';
if(isAuth){
  if(!captchaToken||form.dataset.submitting==='true')return;
  form.dataset.submitting='true';
}
if(submit)submit.disabled=true;
try{
if(isAuth){if(authMode==='register'&&f.get('password')!==f.get('confirm'))throw Error('Las contraseñas no coinciden.');const r=await api('auth/'+authMode,'POST',{email:f.get('email'),password:f.get('password'),...(authMode==='register'?{name:f.get('name'),invitation:f.get('invitation')}:{}),website:f.get('website'),captcha:captchaToken});csrf=r.csrf;account=r.email;const data=await api('state');state=data.state;version=data.version;form.reset();if(widget!==null){window.turnstile.remove(widget);widget=null}render()}
if(form.id==='portion'){const {uid,grams,meal:unused,...food}=chosen;const entry={...food,uid:editing||crypto.randomUUID(),grams:Number(f.get('grams')),meal:Number(f.get('meal'))};close();await persist(()=>{if(editing)day().entries=day().entries.map(x=>x.uid===editing?entry:x);else day().entries.push(entry)})}
if(form.id==='custom'){chosen={id:crypto.randomUUID(),name:f.get('name').trim(),emoji:'🍽',...Object.fromEntries(['k','p','c','f'].map(k=>[k,Number(f.get(k))]))};if(await persist(()=>state.foods.push(chosen)))portion()}
if(form.id==='barcode'){chosen=await api('food/'+f.get('code'));if(await persist(()=>{if(!state.foods.some(x=>x.id===chosen.id))state.foods.push(chosen)}))portion()}
if(form.id==='recipe'){const entries=recipeEntries(Number(form.dataset.index),Number(f.get('meal')));close();await persist(()=>day().entries.push(...entries))}
if(form.id==='weight'){const d=f.get('date');close();await persist(()=>{state.weights=state.weights.filter(w=>w.date!==d);state.weights.push({date:d,value:Number(f.get('weight'))})})}
if(form.id==='settings')await persist(()=>{for(const k of Object.keys(state.profile))state.profile[k]=k==='name'?f.get(k).trim():Number(f.get(k))});
}catch(err){
  if(isAuth){authError(err.message);retryCaptcha()}else toast(err.message);
}finally{
  if(isAuth){delete form.dataset.submitting;updateAuthSubmit()}
  else if(submit)submit.disabled=false;
}});
window.addEventListener('pageshow',e=>{if(e.persisted)location.reload()});
async function boot(){try{if('serviceWorker'in navigator){const regs=await navigator.serviceWorker.getRegistrations();await Promise.all(regs.map(r=>r.unregister()))}if('caches'in window)await Promise.all((await caches.keys()).filter(k=>k.startsWith('nutra-')).map(k=>caches.delete(k)));
const [c,data]=await Promise.all([api('config'),fetch('/foods.json',{cache:'no-store'}).then(r=>r.json())]);config=c;base=data.base;recipes=data.recipes;
const me=await api('auth/me');
if(!me.csrf){await auth();return;}
csrf=me.csrf;account=me.email;
try{const d=await api('state');state=d.state;version=d.version;render()}
catch(e){if(e.status!==401)throw e;csrf='';await auth()}
}catch(e){$('#app').innerHTML='<main class="auth"><h1>No pudimos conectar</h1><p>'+esc(e.message)+'</p>'+button('Reintentar','reload','','')+'</main>'}}
actions.reload=()=>location.reload();boot();
