import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import '../dist/data/model.js';
import '../dist/engine.js';
import '../dist/analytics.js';
import '../dist/insights.js';
const D=JSON.parse(fs.readFileSync(new URL('../dist/data/snapshot.json',import.meta.url))),E=globalThis.BPEngine,A=globalThis.BPAnalytics,M=globalThis.BP_MODEL,id=n=>D.heroes.find(h=>h.name===n).id;
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/weak-professional-lineup.json',import.meta.url)));
test('correct screenshot identity and official aggregate are 橘右京 18 picks 6 wins',()=>{
 assert.equal(D.heroes.find(h=>h.id===fixture.actions.find(a=>a.type==='pick'&&a.camp===1).hero).name,'橘右京');
 const h=D.heroes.find(h=>h.name==='橘右京');assert.deepEqual([h.stats.pick_num,h.stats.victory_battle_count,h.stats.ban_num],[18,6,12]);
 assert.ok(!fixture.actions.some(a=>a.type==='pick'&&a.hero===id('铠')));
});
test('unseen and one-game heroes carry explicit evidence status, never fabricated 0%/100% strength',()=>{
 const p=A.predict(fixture,D);assert.equal(p.unavailable,undefined);
 assert.deepEqual(p.coverage.map(c=>[c.unseen,c.sparse]),[[3,1],[0,0]]);
 for(const name of ['瑶','妲己','亚瑟'])assert.equal(p.coverage[0].heroes.find(h=>h.name===name).picks,0);
 assert.equal(p.coverage[0].heroes.find(h=>h.name==='鲁班七号').picks,1);
 assert.ok(p.coverage[0].heroes.find(h=>h.name==='鲁班七号').priority<.5);
 assert.ok(p.priorBlue<p.blue);assert.ok(p.priorGroups.strength<0);assert.ok(p.priorGroups.structure<0);assert.equal(p.unsupported,true);
 assert.ok(p.priorBlue<.5,'stress test only; not a claim of measured true win rate');
 assert.ok(p.sensitivity[0]<p.priorBlue&&p.sensitivity[1]>p.priorBlue);
});
test('strength features are camp antisymmetric and mechanism coverage cannot stack five times',()=>{
 const original=A.featureValues(fixture,D),swapped=A.featureValues({...fixture,actions:fixture.actions.map(a=>({...a,camp:3-a.camp}))},D);
 for(const k of ['strength:priority','structure:engage','structure:frontline']){assert.equal(original[k],-swapped[k]);assert.ok(Math.abs(original[k])<=1);}
 const cap=A.strengthValues([171,107,126,135,524].map(hero=>({hero,camp:1,type:'pick'})),D,M.full.strengthProfile);
 assert.ok(cap['structure:engage']<=1);assert.ok(cap['structure:frontline']<=1);
});
test('all demand profiles use only completed earlier series; no self-game demand/win leakage',()=>{
 for(const [matchId,m] of Object.entries(M.rolling)){
  const start=D.games.filter(g=>g.matchId===matchId).map(g=>g.date).sort()[0],prior=D.games.filter(g=>g.sequenceValid&&g.date<start);
  assert.equal(m.strengthProfile.n,prior.length);
  for(const h of D.heroes){const rows=prior.flatMap(g=>g.players.filter(p=>p.hero===h.id));assert.equal(m.strengthProfile.heroes[h.id].picks,rows.length);}
 }
 const first=Object.values(M.rolling).find(m=>m.n===0);assert.equal(first.strengthProfile.scale,0);assert.ok(first.weights.every(w=>w===0));
});
test('holdout demand is frozen to training and comparison includes the unchanged old model',()=>{
 const m=M.validation.model,tr=D.games.filter(g=>M.validation.trainIds.includes(g.id));
 assert.equal(m.strengthProfile.n,100);
 for(const h of D.heroes)assert.equal(m.strengthProfile.heroes[h.id].picks,tr.flatMap(g=>g.players).filter(p=>p.hero===h.id).length);
 assert.ok(Math.abs(M.validation.stages['20'].draft.brier-.2108651726898559)<1e-10);
 assert.ok(M.validation.stages['20'].strengthExperiment.brier>M.validation.stages['20'].draft.brier,'must disclose failed global accuracy improvement');
});
test('Python strength experiment and browser features reproduce identical holdout probabilities',()=>{
 const m=M.validation.model,te=D.games.filter(g=>M.validation.testIds.includes(g.id));
 for(const n of [0,10,20]){
  const ps=te.map(g=>{const s={...E.initial(D),teamA:g.blue,teamB:g.red,actions:g.actions.slice(0,n)},x=A.featureValues(s,D,s.actions,m.strengthProfile),z=M.features.reduce((z,k,i)=>z+(x[k]||0)*m.candidateWeights[i],0);return 1/(1+Math.exp(-z));});
  const brier=ps.reduce((z,p,i)=>z+(p-Number(te[i].winCamp===1))**2,0)/te.length;
  assert.ok(Math.abs(brier-M.validation.stages[n].strengthExperiment.brier)<1e-8);
 }
 assert.equal(M.strengthExperimentPromoted,false);
});
test('unsupported lineup UI withholds the headline point estimate, while normal drafts retain the curve',()=>{
 const UI=globalThis.BPInsightUI,html=UI.prediction(fixture,D);
 assert.match(html,/data-testid="blue-probability">—/);assert.match(html,/准确性验收未通过/);assert.match(html,/橘右京/);assert.match(html,/data-testid="prior-blue-probability"/);
 const g=D.games.find(g=>g.replayable),s={...E.initial(D),teamA:g.blue,teamB:g.red,actions:g.actions};
 assert.equal(A.predict(s,D).unsupported,false);assert.match(UI.prediction(s,D),/统计模型BP预测变化曲线/);
});
