'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {Readable}=require('node:stream');
const {createApp}=require('../server.cjs');
const {fresh,validState,normalizePlan}=require('../src/validation.cjs');
const catalog=require('../dist/foods.json');

function browserModel(){
  const elements=new Map();
  function element(selector){
    if(!elements.has(selector))elements.set(selector,{
      value:'',innerHTML:'',textContent:'',classList:{toggle(){}},open:false,
      showModal(){this.open=true},insertAdjacentHTML(_,html){this.innerHTML+=html}
    });
    return elements.get(selector);
  }
  const document={querySelector:element,addEventListener(){}};
  const context=vm.createContext({catalog,fresh,document,window:{addEventListener(){}},crypto,confirm:()=>true});
  const source=fs.readFileSync(path.join(__dirname,'../dist/app.js'),'utf8').replace(/boot\(\);\s*$/,'');
  vm.runInContext(source,context);
  vm.runInContext("base=catalog.base;recipes=catalog.recipes;legacyRecipeIds=catalog.legacyRecipeIds;state=fresh('Prueba');date='2026-11-12'",context);
  return {element,run:script=>vm.runInContext(script,context),context};
}

test('Catálogo con IDs únicos, fuentes y recetas calculables',()=>{
  assert(catalog.base.length>=100);
  assert.equal(catalog.recipes.length,24);
  const foodIds=new Set(catalog.base.map(food=>food.id));
  assert.equal(foodIds.size,catalog.base.length);
  assert.equal(new Set(catalog.recipes.map(recipe=>recipe.id)).size,catalog.recipes.length);
  for(const food of catalog.base){
    assert(food.category&&food.preparation&&food.source.name,food.name);
    assert(food.source.estimated||food.source.code&&food.source.url,food.name);
    for(const measure of food.portions||[])assert(measure.grams>0&&measure.url,food.name);
  }
  for(const recipe of catalog.recipes){
    assert(recipe.yieldGrams>0&&[0,1,2,3].includes(recipe.meal),recipe.name);
    for(const [id,grams] of recipe.items)assert(foodIds.has(id)&&grams>0,recipe.name);
  }
  const state=fresh('Prueba');
  state.foods=catalog.base.map(({id,name,emoji,k,p,c,f})=>({id,name,emoji,k,p,c,f}));
  assert(validState(state));
});

test('Búsqueda por sinónimo y conversión de medidas',()=>{
  const {run,element}=browserModel();
  run("search('aguacate')");
  assert.match(element('#results').innerHTML,/Palta/);
  element('#food-category').value='Cereales y panes';
  run("search('quinoa')");
  assert.match(element('#results').innerHTML,/Quinua/);
  run("chosen=base.find(food=>food.id==='f2')");
  element('#portion-unit').value='ref-0';
  element('#portion-amount').value='0,5';
  assert.equal(run('measuredGrams()'),79);
  element('#portion-unit').value='mg';
  element('#portion-amount').value='1';
  assert.equal(run('measuredGrams()'),0.001);
  element('#portion-unit').value='custom-Puñado';
  element('#portion-amount').value='2';
  element('#portion-unit-weight').value='30';
  assert.equal(run('measuredGrams()'),60);
  element('#portion-unit-weight').value='';
  assert(Number.isNaN(run('measuredGrams()')));
});

test('Planificador preserva índices antiguos y genera por tipo de comida',()=>{
  const s=fresh('Prueba');
  s.plan['2026-11-12']={0:1,1:0,2:'pescado-camote',3:3};
  assert(validState(s));
  assert.deepEqual(normalizePlan(s).plan['2026-11-12'],{
    0:'avena-platano',1:'bowl-pollo-quinua',2:'pescado-camote',3:'yogur-frutos-rojos'
  });
  s.plan['2026-11-12'][2]='inventada';
  assert.equal(validState(s),false);
  const {run}=browserModel();
  run('persist=change=>change();generatePlan()');
  const plan=run('state.plan');
  assert.equal(Object.keys(plan).length,7);
  for(const day of Object.values(plan)){
    assert.equal(Object.keys(day).length,4);
    for(const [meal,id] of Object.entries(day))assert.equal(catalog.recipes.find(recipe=>recipe.id===id).meal,Number(meal));
  }
});

test('Guardar una receta nueva, recargar el plan y sumar compras',async()=>{
  const dir=fs.mkdtempSync(path.join(__dirname,'temp-catalog-'));
  const origin='http://127.0.0.1:4173';
  const invitation='test-invitation-at-least-32-characters';
  const server=createApp({origin,dataDir:dir,allowedEmails:['test@example.com'],registrationCode:invitation},
    {verifyCaptcha:async value=>value==='test-token'});
  const handler=server.listeners('request')[0];
  const headers={origin,host:'127.0.0.1:4173','content-type':'application/json'};
  async function request(url,method='GET',body){
    const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);
    Object.assign(req,{url,method,headers,socket:{remoteAddress:'127.0.0.1'}});
    const responseHeaders={};
    const res={setHeader(key,value){responseHeaders[key]=value},writeHead(status){this.status=status},end(data){this.data=JSON.parse(data)}};
    await handler(req,res);
    return {...res,headers:responseHeaders};
  }
  try{
    const register=await request('/api/auth/register','POST',{email:'test@example.com',name:'Prueba',password:'una contraseña larga de prueba',invitation,captcha:'test-token'});
    assert.equal(register.status,200);
    headers.cookie=register.headers['Set-Cookie'].split(';')[0];
    headers['x-csrf-token']=register.data.csrf;
    const initial=await request('/api/state');
    initial.data.state.plan['2026-11-12']={0:1,1:'arroz-con-pollo'};
    initial.data.state.plan['2026-11-13']={1:'arroz-con-pollo'};
    const {run,element,context}=browserModel();
    run("selectRecipePortion('arroz-con-pollo',1)");
    const snapshot=run('foodSnapshot(chosen)');
    const half=run('chosen.portions[0].grams/2');
    const fullCalories=run("recipeNutrition(recipeById('arroz-con-pollo')).k");
    assert(Math.abs(snapshot.k*half/100-fullCalories/2)<1e-8);
    initial.data.state.days['2026-11-12']={water:0,entries:[{...snapshot,uid:'test-recipe',grams:half,meal:1}]};
    const saved=await request('/api/state','PUT',initial.data);
    assert.equal(saved.status,200);
    const reloaded=await request('/api/state');
    assert.equal(reloaded.data.version,initial.data.version+1);
    assert.equal(reloaded.data.state.plan['2026-11-12'][0],'avena-platano');
    assert.equal(reloaded.data.state.days['2026-11-12'].entries[0].grams,half);
    context.reloaded=reloaded.data.state;
    run('state=reloaded;shopping()');
    assert.match(element('#modal').innerHTML,/Arroz blanco cocido<\/span><b>340 g/);
    assert.match(element('#modal').innerHTML,/Avena en hojuelas<\/span><b>50 g/);
  }finally{
    server.emit('close');
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
