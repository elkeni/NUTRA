'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {browserModel}=require('./helpers/browser.cjs');

test('Decimales y exponentes convierten medidas extremas sin bloquear',()=>{
  const {run,element}=browserModel();
  assert.equal(run("decimal({value:'1,5'})"),1.5);
  assert.equal(run("decimal({value:'1e-7'})"),1e-7);
  assert.equal(run("decimal({value:'.5'})"),0.5);
  for(const value of ['1e','Infinity','1,2,3','--1'])assert(Number.isNaN(run(`decimal({value:'${value}'})`)));
  run("chosen={id:'medida-test',name:'Prueba',emoji:'🍽',k:100,p:0,c:0,f:0,portions:[{label:'Unidad',grams:30}]}");
  element('#portion-unit').value='ref-0';
  element('#portion-amount').value='1e2';
  assert.equal(run('measuredGrams()'),3000);
  element('#portion-amount').value='1e-7';
  assert(Number.isNaN(run('measuredGrams()')));
});

test('Ajustes acepta valores decimales en todos los campos numéricos',()=>{
  const {run}=browserModel();
  const html=run('settings()');
  assert.equal((html.match(/type="number" step="any"/g)||[]).length,5);
  assert.match(html,/name="water" value="2500" type="number" step="any" min="1" max="15000"/);
  assert.match(html,/name="name" value="Prueba"/);
});

test('Elegir o editar registros eliminados avisa sin lanzar errores',()=>{
  const {run,element}=browserModel();
  assert.doesNotThrow(()=>run("actions.choose({dataset:{id:'no-existe'}})"));
  assert.match(element('#toast').textContent,/ya no está disponible/);
  assert.doesNotThrow(()=>run("actions.edit({dataset:{id:'no-existe'}})"));
  assert.match(element('#toast').textContent,/Recarga la página/);
});

test('Copiar ayer respeta el límite de 100 alimentos por día',()=>{
  const {run,element}=browserModel();
  run("state.days['2026-11-11']={entries:[{uid:'ayer'}],water:0};state.days['2026-11-12']={entries:Array.from({length:100},(_,i)=>({uid:'hoy-'+i})),water:0}");
  assert.doesNotThrow(()=>run('actions.copy()'));
  assert.equal(run("state.days['2026-11-12'].entries.length"),100);
  assert.match(element('#toast').textContent,/100 alimentos/);
});

test('La cola de guardado aplica los cambios en orden y actualiza la versión',async()=>{
  const {run,context}=browserModel();
  const calls=[];
  context.fetch=async(url,{body})=>{
    calls.push(JSON.parse(body));
    await new Promise(resolve=>setImmediate(resolve));
    return {ok:true,json:async()=>({version:calls.length})};
  };
  const first=run("persist(()=>state.profile.name='Uno')");
  const second=run("persist(()=>state.profile.name='Dos')");
  assert.deepEqual(await Promise.all([first,second]),[true,true]);
  assert.equal(calls.length,2);
  assert.deepEqual(calls.map(call=>call.version),[0,1]);
  assert.equal(calls[0].state.profile.name,'Uno');
  assert.equal(calls[1].state.profile.name,'Dos');
  assert.equal(run('version'),2);
  assert.equal(run('state.profile.name'),'Dos');
});

test('Un guardado fallido revierte el estado y descarta la cola',async()=>{
  const {run,context,element}=browserModel();
  const original=run('state.profile.name');
  let calls=0;
  context.fetch=async()=>{
    calls++;
    await new Promise(resolve=>setImmediate(resolve));
    return {ok:false,status:500,json:async()=>({error:'Sin conexión'})};
  };
  const first=run("persist(()=>state.profile.name='Uno')");
  const second=run("persist(()=>state.profile.name='Dos')");
  assert.deepEqual(await Promise.all([first,second]),[false,false]);
  assert.equal(calls,1);
  assert.equal(run('state.profile.name'),original);
  assert.match(element('#toast').textContent,/Sin conexión/);
});

test('Las acciones quedan guardadas en la fecha en que se iniciaron',async()=>{
  const {run,context}=browserModel();
  let calls=0;
  context.fetch=async()=>{
    calls++;
    await new Promise(resolve=>setImmediate(resolve));
    return {ok:true,json:async()=>({version:calls})};
  };
  const water=run("actions.water({dataset:{value:'250'}})");
  run("date='2026-11-13'");
  assert.equal(await water,true);
  assert.equal(run("state.days['2026-11-12'].water"),250);
  assert.equal(run("state.days['2026-11-13']?.water||0"),0);
});

test('El botón de agua ignora valores que no sean números finitos',()=>{
  const {run,context}=browserModel();
  let calls=0;
  context.fetch=async()=>{calls++;return {ok:true,json:async()=>({version:calls})}};
  run("persist=(change)=>{change();return Promise.resolve(true)}");
  assert.equal(run('actions.water({dataset:{}})'),undefined);
  assert.equal(run('actions.water({dataset:{value:"abc"}})'),undefined);
  assert.equal(run('actions.water({dataset:{value:"0"}})'),undefined);
  assert.equal(run("day().water"),0);
  assert.equal(calls,0);
  run("actions.water({dataset:{value:'-250'}})");
  assert.equal(run('day().water'),0);
});
