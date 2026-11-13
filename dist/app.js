
'use strict';
const $=s=>document.querySelector(s),meals=['Desayuno','Almuerzo','Cena','Snacks'],icons=['☀','🥗','☾','🍎'];
let state=null,version=0,csrf='',account='',page='Diario',date=today(),base=[],recipes=[],config={},legacyRecipeIds=[],busy=false,authMode='login',widget=null,captchaToken='',tsPromise;
function today(d=new Date()){return new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,10)}
function esc(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
const round=n=>Math.round(n);
function day(on=date){return state.days[on]||(state.days[on]={entries:[],water:0})}
function foods(){return [...base,...state.foods]}
function totals(entries=day().entries){return entries.reduce((a,e)=>{for(const k of ['k','p','c','f'])a[k]+=e[k]*e.grams/100;return a},{k:0,p:0,c:0,f:0})}
function button(text,action,data='',cls='quiet'){return '<button class="'+cls+'" data-action="'+action+'" '+data+'>'+text+'</button>'}
function toast(t){$('#toast').textContent=t;$('#toast').classList.remove('hidden');setTimeout(()=>$('#toast').classList.add('hidden'),4000)}
async function api(p,method='GET',data){const r=await fetch('/api/'+p,{method,credentials:'same-origin',cache:'no-store',headers:{...(data?{'Content-Type':'application/json'}:{}),...(method!=='GET'?{'X-CSRF-Token':csrf}:{})},body:data?JSON.stringify(data):undefined});const b=await r.json();if(!r.ok){const e=Error(b.error||'No se pudo completar la solicitud.');e.status=r.status;throw e}return b}
let saveQueue=Promise.resolve(),saveEpoch=0;
function persist(change){
  const epoch=saveEpoch;
  const save=async()=>{
    if(epoch!==saveEpoch||!state)return false;
    busy=true;
    const prior=structuredClone(state);
    try{
      change();
      const r=await api('state','PUT',{state,version});
      version=r.version;
    }catch(error){
      state=prior;
      saveEpoch++;
      if(error.status===409){
        try{const latest=await api('state');state=latest.state;version=latest.version}
        catch(reloadError){if(reloadError.status===401)error=reloadError}
      }
      if(error.status===401){state=null;csrf='';close()}
      render();
      if(state&&$('#modal').open&&$('#modal').querySelector('[data-check]'))shopping();
      toast(error.message+' No se aplicaron los cambios pendientes.');
      return false;
    }finally{busy=false}
    render();
    toast('Guardado en tu cuenta');
    return true;
  };
  const pending=saveQueue.then(save);
  saveQueue=pending.catch(()=>{});
  return pending;
}
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
function diary(){const t=totals(),g=state.profile,n=Math.abs(g.k-t.k),pct=Math.min(100,t.k/g.k*100);return heading('Tu día, en equilibrio','Cada comida cuenta. Un hábito a la vez.')+'<div class="between"><input class="dates" aria-label="Fecha" id="date" type="date" value="'+date+'">'+button('＋ Registrar','add','data-meal="0"','')+'</div><div class="card"><div class="between"><h2>Resumen diario</h2><span class="pill">'+g.k+' kcal</span></div><div class="summary"><div class="ring"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="45" fill="none" stroke="#edf2e6" stroke-width="6"/><circle cx="50" cy="50" r="45" fill="none" stroke="#93af75" stroke-width="6" stroke-linecap="round" pathLength="100" stroke-dasharray="'+pct+' 100"/></svg><div class="value"><small>'+(g.k>=t.k?'TE QUEDAN':'SOBRE EL OBJETIVO')+'</small><strong>'+round(n)+'</strong><small>kcal</small></div></div><div>'+[['p','Proteínas'],['c','Carbohidratos'],['f','Grasas']].map(([k,l])=>'<div class="macro"><div class="between"><b>'+l+'</b><span>'+round(t[k])+'/'+g[k]+' g</span></div><progress max="'+g[k]+'" value="'+t[k]+'"></progress></div>').join('')+'</div></div><small>'+round(t.k)+' kcal consumidas · Objetivos editables</small></div><div class="between section"><h2>Tus comidas</h2>'+button('Copiar ayer','copy','','text-btn')+'</div>'+meals.map((m,i)=>{const entries=day().entries.filter(e=>e.meal===i);return '<section class="card"><div class="between"><div class="row"><span>'+icons[i]+'</span><div><h3>'+m+'</h3><small>'+round(totals(entries).k)+' kcal</small></div></div>'+button('＋','add','data-meal="'+i+'" aria-label="Agregar a '+m+'"')+'</div>'+(entries.length?entries.map(e=>'<div class="entry"><span>'+esc(e.emoji)+'</span><div class="grow"><b>'+esc(e.name)+'</b><small>'+formatAmount(e.grams)+' g · '+round(e.k*e.grams/100)+' kcal</small></div>'+button('✎','edit','data-id="'+esc(e.uid)+'" aria-label="Editar porción"')+button('×','delete','data-id="'+esc(e.uid)+'" aria-label="Eliminar alimento"')+'</div>').join(''):'<p class="empty">Registra lo que comiste. Este espacio es tuyo.</p>')+'</section>'}).join('')+'<div class="card"><div class="between"><h2>💧 Agua</h2><b>'+day().water/1000+' / '+g.water/1000+' L</b></div><progress max="'+g.water+'" value="'+day().water+'"></progress><div class="between section">'+button('− 250 ml','water','data-value="-250"')+button('＋ 250 ml','water','data-value="250"')+'</div>'+button('Otra cantidad','water-custom','','quiet wide')+'</div>'}
let meal=0,chosen=null,editing=null;

function add(m){
  meal=m;
  editing=null;
  const categories=[...new Set(foods().map(f=>f.category||'Mis alimentos'))].sort((a,b)=>a.localeCompare(b,'es'));
  modal('Registrar en '+meals[m],'<label>Buscar alimento<input id="search" type="search" placeholder="Pollo, arroz, palta…" autocomplete="off"></label>'+
    '<label>Categoría<select id="food-category"><option value="">Todas</option>'+categories.map(c=>'<option>'+esc(c)+'</option>').join('')+'</select></label>'+
    '<div id="results" class="results"></div><div class="row wrap section">'+button('＋ Crear alimento','custom')+button('Código de barras','barcode')+'</div>');
  search('');
}
function normalizeSearch(value){
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
}
function search(query){
  const category=$('#food-category').value;
  const words=normalizeSearch(query).split(/\s+/).filter(Boolean);
  const matches=foods().filter(food=>{
    const name=normalizeSearch([food.name,...(food.aliases||[])].join(' '));
    return (!category||category===(food.category||'Mis alimentos'))&&words.every(word=>name.includes(word));
  });
  const visible=matches.slice(0,40);
  $('#results').innerHTML=visible.map(food=>button(
    '<span>'+esc(food.emoji)+' '+esc(food.name)+(food.preparation?'<small class="result-detail">'+esc(food.preparation)+'</small>':'')+'</span><small>'+food.k+' kcal / 100 g</small>',
    'choose','data-id="'+esc(food.id)+'"','result'
  )).join('')||'<p class="empty">No encontramos ese alimento. Prueba otro nombre o créalo con la etiqueta.</p>';
  if(matches.length>visible.length)$('#results').insertAdjacentHTML('beforeend','<p class="note">Mostrando '+visible.length+' de '+matches.length+'. Escribe un nombre o elige una categoría.</p>');
}
const customMeasures=['Unidad','Taza','Cucharada','Vaso','Puñado','Porción'];
function formatAmount(value,digits=3){
  return new Intl.NumberFormat('es-PE',{maximumFractionDigits:digits}).format(value);
}
function catalogFood(id){return base.find(food=>food.id===id)}
function portionFood(){
  const catalog=catalogFood(chosen.id);
  if(catalog)return catalog;
  const recipe=chosen.id.startsWith('recipe-')&&recipeById(chosen.id.slice(7));
  if(recipe&&!chosen.portions)return {...chosen,
    source:{name:'Estimación a partir de ingredientes y peso final',estimated:true},
    portions:[{label:'Receta completa',grams:recipe.yieldGrams}]};
  if(/^off\d{8,14}$/.test(chosen.id))return {...chosen,source:{name:'Open Food Facts',url:'https://world.openfoodfacts.org/product/'+chosen.id.slice(3)}};
  return chosen;
}
function foodSnapshot(food){
  const {id,name,emoji,k,p,c,f}=food;
  return {id,name,emoji,k,p,c,f};
}
function sourceLink(label,url){
  return url?'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(label)+'</a>':esc(label);
}
function mealOptions(selected){
  return meals.map((name,i)=>'<option value="'+i+'" '+(i===selected?'selected':'')+'>'+name+'</option>').join('');
}
function portion(grams){
  const food=portionFood();
  const references=food.portions||[];
  const startingUnit=grams===undefined&&references.length?'ref-0':'g';
  const amount=grams??(references.length?1:100);
  const source=food.source;
  const sourceHtml=source?'<p class="note">Composición por 100 g · '+sourceLink(source.name+(source.code?' '+source.code:''),source.url)+(source.estimated?' · valores aproximados':'')+'</p>':'';
  modal(chosen.name,'<form id="portion"><div class="portion-fields">'+
    '<label>Cantidad<input name="amount" id="portion-amount" type="text" inputmode="decimal" value="'+amount+'" required></label>'+
    '<label>Medida<select id="portion-unit" data-previous="'+startingUnit+'"><option value="g">Gramos (g)</option><option value="mg">Miligramos (mg)</option>'+
    references.map((measure,i)=>'<option value="ref-'+i+'" '+(startingUnit==='ref-'+i?'selected':'')+'>'+esc(measure.label)+' (≈ '+formatAmount(measure.grams)+' g)</option>').join('')+
    '<optgroup label="Mis medidas">'+customMeasures.map(label=>'<option value="custom-'+label+'">'+label+' (mi medida)</option>').join('')+'</optgroup></select></label></div>'+
    '<label id="custom-portion" class="hidden">Gramos por medida<input id="portion-unit-weight" type="text" inputmode="decimal" placeholder="Ej.: 30" disabled></label>'+
    '<p id="measure-note" class="note"></p><p id="estimate" class="portion-preview" aria-live="polite"></p>'+
    '<label>Comida<select name="meal">'+mealOptions(meal)+'</select></label>'+sourceHtml+'<button class="wide">Guardar comida</button></form>');
  estimate();
}
function decimal(input){
  const value=input.value.trim().replace(',','.');
  return /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)?Number(value):NaN;
}
function measureFactor(unit){
  const references=portionFood().portions||[];
  if(unit==='g')return 1;
  if(unit==='mg')return 0.001;
  if(unit.startsWith('ref-'))return references[Number(unit.slice(4))]?.grams??NaN;
  return unit.startsWith('custom-')?decimal($('#portion-unit-weight')):NaN;
}
function measuredGrams(){
  const grams=decimal($('#portion-amount'))*measureFactor($('#portion-unit').value);
  return grams>=0.001&&grams<=10000?Math.round(grams*1000)/1000:NaN;
}
function nutritionText(values){
  return formatAmount(values.k,1)+' kcal · P '+formatAmount(values.p,2)+' g · C '+formatAmount(values.c,2)+' g · G '+formatAmount(values.f,2)+' g';
}
function changePortionUnit(select){
  const amount=$('#portion-amount');
  const previous=select.dataset.previous;
  const value=decimal(amount);
  const grams=value*measureFactor(previous),factor=measureFactor(select.value);
  if(Number.isFinite(grams)&&Number.isFinite(factor)&&factor>0)amount.value=Number((grams/factor).toPrecision(12));
  else if(select.value!==previous)amount.value=1;
  select.dataset.previous=select.value;
  estimate();
}
function estimate(){
  const unit=$('#portion-unit').value;
  const custom=unit.startsWith('custom-');
  $('#custom-portion').classList.toggle('hidden',!custom);
  const weight=$('#portion-unit-weight');
  weight.disabled=!custom;
  weight.required=custom;
  const reference=unit.startsWith('ref-')?portionFood().portions?.[Number(unit.slice(4))]:null;
  $('#measure-note').innerHTML=custom?'Pesa una medida de este alimento y escribe su peso en gramos. Un vaso o un puñado cambia de peso según el alimento.':
    reference?'Peso de referencia aproximado · '+sourceLink(reference.url?'USDA':'Rendimiento de la receta',reference.url):'';
  const grams=measuredGrams();
  const valid=Number.isFinite(grams)&&grams>=0.001&&grams<=10000;
  $('#estimate').textContent=valid?formatAmount(grams)+' g · '+nutritionText(totals([{...chosen,grams}])):'Escribe una cantidad equivalente a entre 1 mg y 10 000 g.';
  $('#portion button').disabled=!valid;
}
function custom(){modal('Crear alimento','<form id="custom"><label>Nombre<input name="name" maxlength="90" required></label><p class="note">Información por 100 g, según la etiqueta.</p><div class="form-grid">'+[['k','Calorías (kcal)'],['p','Proteínas (g)'],['c','Carbohidratos (g)'],['f','Grasas (g)']].map(([k,n])=>'<label>'+n+'<input name="'+k+'" type="number" min="0" max="'+(k==='k'?1000:100)+'" step="0.1" required></label>').join('')+'</div><button class="wide">Crear y elegir porción</button></form>')}

function recipeById(id){return recipes.find(recipe=>recipe.id===id)}
function planRecipeId(value){return Number.isInteger(value)?legacyRecipeIds[value]:value}
function recipeNutrition(recipe){
  return totals(recipe.items.map(([id,grams])=>({...catalogFood(id),grams})));
}
function recipePage(){
  return heading('Recetas','Elige una receta y registra la porción que comiste.')+
    meals.map((name,mealIndex)=>'<section class="section"><h2>'+name+'</h2><div class="grid recipe-grid">'+
      recipes.filter(recipe=>recipe.meal===mealIndex).map(recipe=>'<article class="card recipe"><div class="hero">'+esc(recipe.emoji)+'</div>'+
        '<span class="pill">'+round(recipeNutrition(recipe).k)+' kcal estimadas</span><h3>'+esc(recipe.name)+'</h3><p>Receta completa · ≈ '+formatAmount(recipe.yieldGrams)+' g</p>'+
        button('Ver receta','recipe','data-recipe="'+esc(recipe.id)+'"','quiet wide')+'</article>').join('')+
    '</div></section>').join('');
}
function recipe(id){
  const item=recipeById(id);
  if(!item)return;
  modal(item.name,'<p class="note">Valores estimados para la receta completa (≈ '+formatAmount(item.yieldGrams)+' g preparados).</p>'+
    '<p class="portion-preview">'+nutritionText(recipeNutrition(item))+'</p>'+
    '<p>'+esc(item.steps)+'</p>'+
    (item.note?'<p class="note">'+esc(item.note)+'</p>':'')+
    '<h3>Ingredientes</h3>'+item.items.map(([foodId,grams])=>'<p class="between"><span>'+esc(catalogFood(foodId).name)+'</span><b>'+formatAmount(grams)+' g</b></p>').join('')+
    '<form id="recipe" data-recipe="'+esc(id)+'"><label>Agregar a<select name="meal">'+mealOptions(item.meal)+'</select></label>'+
    '<button class="wide">Elegir cantidad</button></form>');
}
function selectRecipePortion(id,mealIndex){
  const item=recipeById(id);
  const per100g=Object.fromEntries(Object.entries(recipeNutrition(item)).map(([key,value])=>[key,value*100/item.yieldGrams]));
  chosen={id:'recipe-'+item.id,name:item.name,emoji:item.emoji,...per100g,
    source:{name:'Estimación a partir de ingredientes y peso final',estimated:true},
    portions:[{label:'Receta completa',grams:item.yieldGrams}]};
  meal=mealIndex;
  editing=null;
  portion();
}
function weekDates(){
  return Array.from({length:7},(_,i)=>{const d=new Date(date+'T12:00:00');d.setDate(d.getDate()+i);return today(d)});
}
function recipeOptions(selected,mealIndex){
  const option=recipe=>'<option value="'+esc(recipe.id)+'" '+(recipe.id===selected?'selected':'')+'>'+esc(recipe.name)+'</option>';
  const matching=recipes.filter(recipe=>recipe.meal===mealIndex);
  const other=recipes.filter(recipe=>recipe.meal!==mealIndex);
  return '<option value="">Sin planificar</option><optgroup label="'+meals[mealIndex]+'">'+matching.map(option).join('')+
    '</optgroup><optgroup label="Otras comidas">'+other.map(option).join('')+'</optgroup>';
}
function planPage(){
  return heading('Plan semanal','Elige tus platos y consulta los ingredientes que necesitarás.')+
    '<div class="row wrap"><input class="dates" id="date" aria-label="Inicio de semana" type="date" value="'+date+'">'+
    button('Lista de compras','shopping')+button('Generar ideas','generate')+'</div>'+
    '<p class="note">El plan cuenta una receta completa por comida. Las ideas no ajustan las porciones a tus objetivos.</p>'+
    weekDates().map(day=>'<div class="card"><h3>'+new Date(day+'T12:00:00').toLocaleDateString('es-PE',{weekday:'long',day:'numeric',month:'short'})+'</h3>'+
      '<div class="form-grid">'+meals.map((name,mealIndex)=>'<label>'+name+'<select data-plan="'+day+'" data-meal="'+mealIndex+'">'+
        recipeOptions(planRecipeId(state.plan[day]?.[mealIndex]),mealIndex)+'</select></label>').join('')+'</div></div>').join('');
}
function generatePlan(){
  if(!confirm('¿Reemplazar el plan de estos 7 días con ideas?'))return;
  const groups=meals.map((_,index)=>recipes.filter(recipe=>recipe.meal===index));
  const dates=weekDates();
  return persist(()=>dates.forEach((day,index)=>{
    state.plan[day]=Object.fromEntries(groups.flatMap((group,mealIndex)=>group.length?[[mealIndex,group[index%group.length].id]]:[]));
  }));
}
function shopping(){
  const list=new Map();
  for(const day of weekDates()){
    for(const selection of Object.values(state.plan[day]||{})){
      const recipe=recipeById(planRecipeId(selection));
      if(!recipe)continue;
      for(const [id,grams] of recipe.items)list.set(id,(list.get(id)||0)+grams);
    }
  }
  modal('Lista de compras',[...list].map(([id,grams])=>'<label class="row shopping-item"><input type="checkbox" data-check="'+esc(id)+'" '+
    (state.checks.includes(id)?'checked':'')+'><span class="grow">'+esc(catalogFood(id).name)+'</span><b>'+formatAmount(grams)+' g</b></label>').join('')||
    '<p>Agrega recetas a tu plan para ver los ingredientes.</p>');
}
function progress(){const weights=[...state.weights].sort((a,b)=>b.date.localeCompare(a.date));return heading('Mira tu progreso','Cada registro es una parte de tu historia.')+button('＋ Registrar peso','weight','','')+'<div class="card"><small>ÚLTIMO PESO</small><h1>'+(weights[0]?.value||'—')+' kg</h1><p class="note">'+Object.values(state.days).filter(d=>d.entries.length).length+' días con comidas registradas</p></div><div class="card"><h2>Calorías · últimos 7 días</h2><div class="chart">'+Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-6+i);const t=totals(state.days[today(d)]?.entries||[]),h=Math.min(100,t.k/state.profile.k*100);return '<div class="column">'+round(t.k)+'<svg viewBox="0 0 30 110"><rect class="colbar" x="3" y="'+(110-h)+'" width="24" height="'+h+'" rx="4"/></svg>'+d.toLocaleDateString('es',{weekday:'short'})+'</div>'}).join('')+'</div></div><div class="card"><h2>Historial de peso</h2>'+(weights.map(w=>'<div class="entry"><span class="grow">'+esc(w.date)+'</span><b>'+w.value+' kg</b>'+button('×','delete-weight','data-date="'+w.date+'" aria-label="Eliminar peso"')+'</div>').join('')||'<p class="empty">Registra tu primer peso.</p>')+'</div>'}
function settings(){return heading('Tu espacio personal','Objetivos, datos y seguridad de tu cuenta.')+'<form id="settings" class="card"><h2>Objetivos diarios</h2><div class="form-grid">'+[['name','Nombre'],['k','Calorías (kcal)'],['p','Proteínas (g)'],['c','Carbohidratos (g)'],['f','Grasas (g)'],['water','Agua (ml)']].map(([k,n])=>'<label>'+n+'<input name="'+k+'" value="'+esc(state.profile[k])+'" '+(k==='name'?'maxlength="50"':'type="number" step="any" min="1" max="'+(k==='water'?15000:k==='k'?10000:1000)+'"')+' required></label>').join('')+'</div><p class="note">Los valores iniciales son ejemplos, no recomendaciones personales.</p><button class="wide">Guardar objetivos</button></form><div class="card"><h2>Tus datos</h2><p class="note">Guardados en el servidor y separados por cuenta. Las copias descargadas contienen tus registros personales.</p>'+button('↓ Exportar copia','export')+'<label>Importar una copia JSON<input id="import" type="file" accept=".json,application/json"></label>'+button('Importar datos de la versión anterior','legacy')+'</div><div class="card"><h2>Seguridad</h2><p>'+esc(account)+'</p><p class="note">Sesión de hasta 12 horas, con cierre tras 30 minutos sin actividad. Iniciar sesión en otro dispositivo cierra la sesión anterior.</p>'+button('Cerrar sesión','logout','','danger wide')+'</div>'}
const actions={
close,'retry-captcha':retryCaptcha,mode:el=>{if($('#auth-form')?.dataset.submitting==='true')return;authMode=el.dataset.mode;auth()},page:el=>{page=el.dataset.page;render()},add:el=>add(Number(el.dataset.meal)),
choose:el=>{const food=foods().find(f=>f.id===el.dataset.id);if(!food)return toast('Ese alimento ya no está disponible.');chosen=food;portion()},edit:el=>{const entry=day().entries.find(e=>e.uid===el.dataset.id);if(!entry)return toast('Ese registro ya no está disponible. Recarga la página.');chosen=entry;editing=entry.uid;meal=entry.meal;portion(entry.grams)},
delete:el=>{const on=date,id=el.dataset.id;return persist(()=>{day(on).entries=day(on).entries.filter(e=>e.uid!==id)})},
'water-custom':()=>modal('Registrar agua','<form id="water-custom"><label>Mililitros que tomaste<input name="ml" type="number" inputmode="numeric" min="1" max="20000" value="250" required></label><p class="note">Si tomaste un vaso entero, usa su capacidad en mililitros.</p><button class="wide">Agregar agua</button></form>'),
water:el=>{const on=date,amount=Number(el.dataset.value);if(!Number.isFinite(amount)||!amount)return;return persist(()=>{day(on).water=Math.min(20000,Math.max(0,day(on).water+amount))})},
custom,barcode:()=>modal('Código de barras','<form id="barcode"><label>Código del envase<input name="code" inputmode="numeric" pattern="[0-9]{8,14}" required></label><p class="note">Consulta de productos a Open Food Facts.</p><button class="wide">Buscar producto</button></form>'),
copy:()=>{const on=date,d=new Date(on+'T12:00:00');d.setDate(d.getDate()-1);const entries=state.days[today(d)]?.entries;if(!entries?.length)return toast('No hay comidas del día anterior.');if(day(on).entries.length+entries.length>100)return toast('El día supera los 100 alimentos. Elimina algunos antes de copiar.');if(confirm('¿Agregar las comidas del día anterior?'))persist(()=>{const target=day(on);if(target.entries.length+entries.length>100)throw Error('El día supera los 100 alimentos. Elimina algunos antes de copiar.');target.entries.push(...entries.map(e=>({...e,uid:crypto.randomUUID()})))})},
recipe:el=>recipe(el.dataset.recipe),shopping,
generate:generatePlan,
weight:()=>modal('Registrar peso','<form id="weight"><label>Fecha<input name="date" type="date" value="'+today()+'" required></label><label>Peso en kg<input name="weight" type="number" min="20" max="500" step="0.1" required></label><button class="wide">Guardar peso</button></form>'),
'delete-weight':el=>persist(()=>{state.weights=state.weights.filter(w=>w.date!==el.dataset.date)}),
export:()=>{const u=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=u;a.download='nutra-'+today()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)},
legacy:()=>{try{const old=JSON.parse(localStorage.getItem('nutra-v1'));if(!old)return toast('No hay registros antiguos en este navegador.');if(confirm('¿Reemplazar los datos de tu cuenta con los de la versión anterior?'))persist(()=>{state=old})}catch{toast('No se pudieron leer los registros antiguos.')}},
logout:async()=>{await saveQueue;await api('auth/logout','POST',{});saveEpoch++;state=null;csrf='';close();auth()}
};
document.addEventListener('click',async e=>{const el=e.target.closest('[data-action]');if(!el)return;try{await actions[el.dataset.action]?.(el)}catch(err){toast(err.message)}});
document.addEventListener('input',e=>{if(e.target.id==='search')search(e.target.value);if(['portion-amount','portion-unit-weight'].includes(e.target.id))estimate()});
document.addEventListener('change',async e=>{const el=e.target;if(el.id==='food-category')search($('#search').value);
if(el.id==='portion-unit')changePortionUnit(el);
if(el.id==='date'){date=el.value||today();render()}
if(el.dataset.plan){const d=el.dataset.plan,m=el.dataset.meal,v=el.value;await persist(()=>{state.plan[d]||={};if(v==='')delete state.plan[d][m];else state.plan[d][m]=v})}
if(el.dataset.check){const id=el.dataset.check,on=el.checked;await persist(()=>{state.checks=state.checks.filter(x=>x!==id);if(on)state.checks.push(id)})}
if(el.id==='import'){const f=el.files[0];if(!f)return;if(f.size>250000){toast('La copia supera el tamaño máximo.');return}try{const data=JSON.parse(await f.text());if(confirm('¿Reemplazar los datos actuales por esta copia?'))await persist(()=>{state=data})}catch{toast('Archivo JSON inválido.')}el.value=''}});
document.addEventListener('submit',async e=>{e.preventDefault();const form=e.target,f=new FormData(form),submit=form.querySelector('button[type=submit],button:not([type])');
const isAuth=form.id==='auth-form';
if(form.dataset.submitting==='true')return;
if(isAuth){
  if(!captchaToken)return;
}
form.dataset.submitting='true';
if(submit)submit.disabled=true;
try{
if(isAuth){if(authMode==='register'&&f.get('password')!==f.get('confirm'))throw Error('Las contraseñas no coinciden.');const r=await api('auth/'+authMode,'POST',{email:f.get('email'),password:f.get('password'),...(authMode==='register'?{name:f.get('name'),invitation:f.get('invitation')}:{}),website:f.get('website'),captcha:captchaToken});csrf=r.csrf;account=r.email;const data=await api('state');state=data.state;version=data.version;form.reset();if(widget!==null){window.turnstile.remove(widget);widget=null}render()}
if(form.id==='portion'){const grams=measuredGrams();if(!Number.isFinite(grams)||grams<0.001||grams>10000)throw Error('Revisa el peso de la porción.');const on=date,editId=editing,entry={...foodSnapshot(chosen),uid:editId||crypto.randomUUID(),grams,meal:Number(f.get('meal'))};if(await persist(()=>{if(editId)day(on).entries=day(on).entries.map(x=>x.uid===editId?entry:x);else day(on).entries.push(entry)}))close()}
if(form.id==='custom'){const food={id:crypto.randomUUID(),name:f.get('name').trim(),emoji:'🍽',...Object.fromEntries(['k','p','c','f'].map(k=>[k,Number(f.get(k))]))};chosen=food;if(await persist(()=>state.foods.push(food))&&$('#modal').open&&chosen===food)portion()}
if(form.id==='barcode'){const food=await api('food/'+f.get('code'));chosen=food;if(await persist(()=>{if(!state.foods.some(x=>x.id===food.id))state.foods.push(food)})&&$('#modal').open&&chosen===food)portion()}
if(form.id==='recipe'){selectRecipePortion(form.dataset.recipe,Number(f.get('meal')))}
if(form.id==='water-custom'){
  const ml=Number(f.get('ml')),on=date;
  if(await persist(()=>{
    if(!Number.isInteger(ml)||ml<1||ml>20000-day(on).water)throw Error('Revisa la cantidad. El máximo diario es 20 000 ml.');
    day(on).water+=ml;
  }))close();
}
if(form.id==='weight'){const d=f.get('date');if(await persist(()=>{state.weights=state.weights.filter(w=>w.date!==d);state.weights.push({date:d,value:Number(f.get('weight'))})}))close()}
if(form.id==='settings')await persist(()=>{for(const k of Object.keys(state.profile))state.profile[k]=k==='name'?f.get(k).trim():Number(f.get(k))});
}catch(err){
  if(isAuth){authError(err.message);retryCaptcha()}else toast(err.message);
}finally{
  delete form.dataset.submitting;
  if(isAuth){updateAuthSubmit()}
  else if(submit)submit.disabled=false;
}});
window.addEventListener('pageshow',e=>{if(e.persisted)location.reload()});
async function boot(){try{if('serviceWorker'in navigator){const regs=await navigator.serviceWorker.getRegistrations();await Promise.all(regs.map(r=>r.unregister()))}if('caches'in window)await Promise.all((await caches.keys()).filter(k=>k.startsWith('nutra-')).map(k=>caches.delete(k)));
const [c,data]=await Promise.all([api('config'),fetch('/foods.json',{cache:'no-store'}).then(r=>r.json())]);config=c;base=data.base;recipes=data.recipes;legacyRecipeIds=data.legacyRecipeIds||[];
const me=await api('auth/me');
if(!me.csrf){await auth();return;}
csrf=me.csrf;account=me.email;
try{const d=await api('state');state=d.state;version=d.version;render()}
catch(e){if(e.status!==401)throw e;csrf='';await auth()}
}catch(e){$('#app').innerHTML='<main class="auth"><h1>No pudimos conectar</h1><p>'+esc(e.message)+'</p>'+button('Reintentar','reload','','')+'</main>'}}
actions.reload=()=>location.reload();boot();
