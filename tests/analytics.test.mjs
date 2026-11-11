import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import '../dist/data/model.js';
import '../dist/engine.js';
import '../dist/analytics.js';
const A=globalThis.BPAnalytics,E=globalThis.BPEngine,M=globalThis.BP_MODEL;
const bytes=fs.readFileSync(new URL('../dist/data/snapshot.json',import.meta.url)),D=JSON.parse(bytes),id=n=>D.heroes.find(h=>h.name===n).id;
const sigmoid=z=>1/(1+Math.exp(-z));
function state(g,actions=g.actions){return {...E.initial(D),teamA:g.blue,teamB:g.red,blueKey:'A',actions};}
test('model matches actual snapshot hash and excludes abnormal sequence',()=>{
 assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),M.dataHash);
 assert.equal(M.full.n,D.games.filter(g=>g.sequenceValid).length);assert.equal(M.features.length,M.full.weights.length);
 assert.ok(M.features.every(k=>/^(side|team:|pick:|ban:|relation:|strength:|structure:)/.test(k)),'no in-game result features');
});
test('chronological holdout is disjoint by whole series and time',()=>{
 const tr=D.games.filter(g=>M.validation.trainIds.includes(g.id)),te=D.games.filter(g=>M.validation.testIds.includes(g.id));
 assert.equal(tr.length,143);assert.equal(te.length,87);
 assert.ok(tr.every(g=>!te.some(t=>t.matchId===g.matchId)));
 assert.ok(Math.max(...tr.map(g=>Date.parse(g.date)))<Math.min(...te.map(g=>Date.parse(g.date))));
});
test('browser feature implementation reproduces reported independent metrics',()=>{
 const te=D.games.filter(g=>M.validation.testIds.includes(g.id)),m=M.validation.model;
 for(const n of [0,10,20]){
  const predictions=te.map(g=>{const x=A.featureValues(state(g),D,g.actions.slice(0,n),m.strengthProfile);return sigmoid(M.features.reduce((z,k,i)=>z+(x[k]||0)*m.weights[i],0));});
  const brier=predictions.reduce((z,p,i)=>z+(p-Number(te[i].winCamp===1))**2,0)/te.length;
  assert.ok(Math.abs(brier-M.validation.stages[n].draft.brier)<1e-8);
 }
});
test('all replay models precede their entire series and never consume own match outcome',()=>{
 for(const [matchId,m] of Object.entries(M.rolling)){
  const gs=D.games.filter(g=>g.matchId===matchId),start=gs.map(g=>g.date).sort()[0];
  assert.ok(!m.through||m.through<start);
  const prior=D.games.filter(g=>g.sequenceValid&&g.date<start);assert.equal(m.n,prior.length);
 }
});
test('prediction updates from picks and bans; both camps sum to one; full game is retrospective-free in replay',()=>{
 const g=D.games.find(g=>g.replayable),s=state(g,[]),p0=A.predict(s,D),p1=A.predict(state(g,g.actions.slice(0,1)),D),pf=A.predict(state(g),D);
 assert.ok(p0.blue>0&&p0.blue<1);assert.equal(p0.blue+p0.red,1);
 assert.notEqual(p0.blue,p1.blue);assert.notEqual(p0.blue,pf.blue);
 const historic=A.predict({...state(g),analysisMatchId:g.matchId},D);assert.equal(historic.n,0);assert.equal(historic.blue,.5);
});
test('replay evidence excludes own and future matches, recent is recomputed',()=>{
 const s=E.initial(D),full=A.evidence([id('钟馗'),id('小乔')],'ally',s,D),recent=A.evidence([id('钟馗'),id('小乔')],'ally',{...s,window:'recent'},D);
 assert.equal(full.n,44);assert.equal(full.w,19);assert.equal(full.teams,12);assert.equal(full.phase1,41);
 assert.ok(recent.n<full.n);const first=D.games.find(g=>g.matchId==='2026100201');
 assert.equal(A.evidence([id('钟馗'),id('小乔')],'ally',{...s,analysisMatchId:first.matchId},D).n,0);
});
test('named hypotheses reflect new real triple while sparse counters stay honest',()=>{
 const s=E.initial(D),tri=A.evidence([id('狄仁杰'),id('元流之子(辅助)'),id('嬴政')],'ally',s,D);
 assert.equal(tri.n,1);assert.equal(tri.rate,0);assert.ok(tri.interval);assert.equal(tri.examples[0].id,'1054884368_3_1792492829');
 const pair=A.evidence([id('狄仁杰'),id('元流之子(辅助)')],'ally',s,D);assert.equal(pair.n,8);assert.equal(pair.w,4);
 const a=A.evidence([id('钟无艳'),id('镜')],'enemy',s,D),b=A.evidence([id('项羽'),id('关羽')],'enemy',s,D);
 assert.deepEqual([a.n,a.w,a.after],[3,1,3]);assert.deepEqual([b.n,b.w,b.after],[22,10,20]);
});
test('manual mechanism labels never create an empirical bonus with zero samples',()=>{
 const s=E.initial(D),nobody={...D.heroes.find(h=>h.name==='嬴政')};
 const z=A.relationScore(s,id('狄仁杰'),[nobody],[],D);assert.equal(z.links.length,0);assert.equal(z.value,0);
 const known=A.relationScore(s,id('钟馗'),[D.heroes.find(h=>h.name==='小乔')],[],D);assert.ok(known.value>0);assert.equal(known.links[0].evidence.n,44);
});
test('counter response opportunity uses known availability and correct conditional denominators',()=>{
 const s=E.initial(D),a=A.responseEvidence(id('钟无艳'),id('镜'),s,D),b=A.responseEvidence(id('项羽'),id('关羽'),s,D);
 assert.deepEqual([a.target.picks,a.target.n,a.other.picks,a.other.n],[3,18,1,170]);
 assert.deepEqual([b.target.picks,b.target.n,b.other.picks,b.other.n],[20,48,10,135]);
 const linked=A.relationScore(s,id('项羽'),[],[D.heroes.find(h=>h.name==='关羽')],D);assert.equal(linked.links[0].response.target.n,48);
 const pairs=A.topPairs(s,D);assert.ok(pairs.length>5);assert.ok(pairs.every((e,i)=>!i||pairs[i-1].n>=e.n));
});
test('probability suppresses double-ADC lineup and incomplete blind draft',()=>{
 const s=E.initial(D),bad={...s,actions:[{camp:1,type:'pick',hero:id('戈娅')},{camp:1,type:'pick',hero:id('卢雅那')}]};
 assert.equal(A.predict(bad,D).unavailable,true);
 const peak={...s,games:Array.from({length:6},()=>({blueKey:'A',actions:[],winner:'A'}))};assert.equal(A.predict(peak,D).unavailable,true);
});
test('real empirical scoring keeps the occupied-lane ban regression fixed',()=>{
 let s={...E.initial(D),teamA:D.teams.find(t=>t.name==='重庆狼队'),teamB:D.teams.find(t=>t.name==='深圳DYG')};
 for(const name of ['女娲','镜','海月','哪吒','鲁班大师','狄仁杰','元流之子(辅助)','杨戬','百里守约','司空震','沈梦溪','张飞','苏烈'])s=E.apply(s,id(name),D);
 const rec=E.recommend(s,D);assert.equal(rec.length,3);assert.ok(rec.every(r=>!['曹操','夏洛特','敖隐'].includes(D.heroes.find(h=>h.id===r.hero).name)));
});
