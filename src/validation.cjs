
'use strict';
const {recipes,legacyRecipeIds}=require('../dist/foods.json');
const recipeIds=new Set(recipes.map(recipe=>recipe.id));
const recipeId=value=>Number.isInteger(value)?legacyRecipeIds[value]:value;
function normalizePlan(state){
  return {...state,plan:Object.fromEntries(Object.entries(state.plan).map(([day,meals])=>[
    day,Object.fromEntries(Object.entries(meals).map(([meal,value])=>[meal,recipeId(value)]))
  ]))};
}
const obj=x=>x&&typeof x==='object'&&!Array.isArray(x);
const str=(x,n=100)=>typeof x==='string'&&x.length>0&&x.length<=n&&!/[\u0000-\u001f]/.test(x);
const num=(x,max,min=0)=>Number.isFinite(x)&&x>=min&&x<=max;
const keys=(x,allowed)=>obj(x)&&Object.keys(x).every(k=>allowed.includes(k));
const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&!isNaN(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
function food(x){return keys(x,['id','name','emoji','k','p','c','f'])&&str(x.id)&&str(x.name,90)&&str(x.emoji,16)&&num(x.k,1000)&&['p','c','f'].every(k=>num(x[k],100))}
function validState(s){
if(!keys(s,['profile','days','foods','weights','plan','checks']))return false;
const p=s.profile;if(!keys(p,['name','k','p','c','f','water'])||!str(p.name,50)||!num(p.k,10000,1)||!['p','c','f'].every(k=>num(p[k],1000,1))||!num(p.water,15000,1))return false;
if(!Array.isArray(s.foods)||s.foods.length>500||!s.foods.every(food))return false;
if(!obj(s.days)||Object.keys(s.days).length>3660)return false;
for(const [d,v] of Object.entries(s.days)){if(!date(d)||!keys(v,['entries','water'])||!num(v.water,20000)||!Array.isArray(v.entries)||v.entries.length>100)return false;
for(const e of v.entries){if(!keys(e,['id','name','emoji','k','p','c','f','uid','grams','meal']))return false;const {uid,grams,meal,...f}=e;if(!food(f)||!str(uid)||!num(grams,10000,0.001)||!Number.isInteger(meal)||meal<0||meal>3)return false}}
return Array.isArray(s.weights)&&s.weights.length<=3660&&s.weights.every(w=>keys(w,['date','value'])&&date(w.date)&&num(w.value,500,20))&&obj(s.plan)&&Object.keys(s.plan).length<=3660&&Object.entries(s.plan).every(([d,p])=>date(d)&&keys(p,['0','1','2','3'])&&Object.values(p).every(v=>recipeIds.has(recipeId(v))))&&Array.isArray(s.checks)&&s.checks.length<=500&&s.checks.every(x=>str(x));
}
function fresh(name){return {profile:{name,k:2200,p:140,c:260,f:67,water:2500},days:{},foods:[],weights:[],plan:{},checks:[]}}
module.exports={validState,fresh,normalizePlan};
