'use strict';
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {fresh}=require('../../src/validation.cjs');
const catalog=require('../../dist/foods.json');
function browserModel(){
  const elements=new Map(),listeners=new Map();
  function element(selector){
    if(!elements.has(selector)){
      const classes=new Set();
      let value='';
      const instance={
        innerHTML:'',textContent:'',dataset:{},open:false,disabled:false,required:false,checked:false,files:[],
        classList:{toggle(name,force){const on=force===undefined?!classes.has(name):force;if(on)classes.add(name);else classes.delete(name)},add(...names){names.forEach(name=>classes.add(name))},remove(...names){names.forEach(name=>classes.delete(name))},contains(name){return classes.has(name)}},
        showModal(){this.open=true},close(){this.open=false},focus(){},
        querySelector(selector){return selector==='[data-check]'&&this.innerHTML.includes('data-check')?{}:null},
        insertAdjacentHTML(_,html){this.innerHTML+=html}
      };
      Object.defineProperty(instance,'value',{get:()=>value,set:next=>{value=String(next)}});
      elements.set(selector,instance);
    }
    return elements.get(selector);
  }
  const document={querySelector:element,addEventListener(name,handler){listeners.set(name,handler)},createElement(){return {click(){},style:{},setAttribute(){}}}};
  const context=vm.createContext({catalog,fresh,document,window:{addEventListener(){}},crypto,
    structuredClone,setTimeout(){},confirm:()=>true,FormData:class{constructor(form){this.form=form}get(key){return this.form.values[key]}}});
  const source=fs.readFileSync(path.join(__dirname,'../../dist/app.js'),'utf8').replace(/boot\(\);\s*$/,'');
  vm.runInContext(source,context);
  vm.runInContext("base=catalog.base;recipes=catalog.recipes;legacyRecipeIds=catalog.legacyRecipeIds;state=fresh('Prueba');date='2026-11-12'",context);
  return {element,run:script=>vm.runInContext(script,context),context,listeners};
}
module.exports={browserModel};
