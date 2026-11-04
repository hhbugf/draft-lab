import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import '../dist/engine.js';
const E=globalThis.BPEngine,D=JSON.parse(fs.readFileSync(new URL('../dist/data/snapshot.json',import.meta.url))),H=E.index(D);
const id=name=>D.heroes.find(h=>h.name===name).id;
function scenario(){
 let s={...E.initial(D),teamA:D.teams.find(t=>t.name==='重庆狼队'),teamB:D.teams.find(t=>t.name==='深圳DYG')};
 const names=['女娲','镜','海月','哪吒','鲁班大师','狄仁杰','元流之子(辅助)','杨戬','百里守约','司空震','沈梦溪','张飞','苏烈'];
 for(const name of names)s=E.apply(s,id(name),D);
 return s;
}
test('user regression: occupied marksman/top/support must not produce a useless ban',()=>{
 const s=scenario(),t=E.turn(s,D);assert.deepEqual(t,{camp:1,type:'ban'});
 for(const name of ['曹操','夏洛特','敖隐']){
  assert.equal(E.legal(s,id(name),D),null,'manual ban remains game-legal');
  assert.equal(E.roleContext(s,H[id(name)],D,H,t).coverage,0,name+' cannot fill the opponent remaining credible lanes');
 }
 const r=E.recommend(s,D,133,{lookahead:false});assert.ok(r.length>=3);
 for(const c of r){assert.ok(!['曹操','夏洛特','敖隐'].includes(H[c.hero].name));assert.ok(c.targetRoles.every(role=>['中路','打野'].includes(role)));}
 const lookahead=E.recommend(s,D);assert.equal(lookahead.length,3);assert.ok(lookahead.every(c=>c.targetRoles.every(r=>['中路','打野'].includes(r))));
});
test('rare jungle does not count as a normal flex; opponent Sikong is not moved to jungle to free top',()=>{
 const s=scenario();for(const name of ['曹操','夏洛特','司空震'])assert.deepEqual(E.roleEvidence(s,H[id(name)],D).roles,['对抗路']);
 assert.deepEqual(E.roleEvidence(s,H[id('敖隐')],D).roles,['发育路']);
 const inferred=E.inferRoles(E.picks(s,2,H),s,D);assert.equal(inferred.fallback,false);assert.equal(inferred.assignments.length,1);assert.equal(inferred.assignment['对抗路'],id('司空震'));assert.equal(inferred.assignment['发育路'],id('狄仁杰'));
});
test('same bug is excluded with recent-date sample filter',()=>{
 const s={...scenario(),window:'recent'};const r=E.recommend(s,D,133,{lookahead:false});assert.ok(r.length);assert.ok(r.every(c=>!['曹操','夏洛特','敖隐'].includes(H[c.hero].name)));
});
test('other side also targets only missing lanes: no further support/top/marksman bans',()=>{
 let s=scenario();s.actions=s.actions.slice(0,12);const t=E.turn(s,D);assert.equal(t.camp,2);
 const r=E.recommend(s,D,133,{lookahead:false});assert.ok(r.length);assert.ok(r.every(c=>c.targetRoles.every(role=>['中路','对抗路'].includes(role))));
 assert.ok(!r.some(c=>c.hero===id('苏烈')),'Su Lie is 48/48 support, occupied by Luban Master');
});
test('first round still allows priority heroes when all five lanes remain open',()=>{
 const s=E.initial(D),t=E.turn(s,D);for(const name of ['曹操','夏洛特','敖隐'])assert.ok(E.roleContext(s,H[id(name)],D,H,t).coverage>0.8);
});
test('confirmed true flex is retained across plausible assignments',()=>{
 const d=structuredClone(D),h=d.heroes.find(h=>h.name==='夏洛特');
 // Controlled evidence: 24 top, 24 jungle. No names are hard-coded in the policy.
 const rows=d.games.flatMap(g=>g.players.filter(p=>p.hero===h.id).map(p=>({g,p})));rows.forEach(({g,p},i)=>{p.role=i%2?'打野':'对抗路';g.date='2026-10-14 12:00:00';});
 const s=scenario(),e=E.roleEvidence(s,h,d);assert.ok(e.roles.includes('打野'));assert.ok(E.roleContext(s,h,d,E.index(d),E.turn(s,d)).coverage>0.3);
 const selected=[h,d.heroes.find(h=>h.name==='狄仁杰')];const inferred=E.inferRoles(selected,s,d);assert.equal(inferred.assignments.length,2);assert.ok(inferred.assignments.every(a=>a.weight>0));
});
test('target team excluded hero pool is honored by bans as well as picks',()=>{
 const s=scenario();s.excluded.B=[id('裴擒虎')];assert.equal(E.roleContext(s,H[id('裴擒虎')],D,H,E.turn(s,D)).coverage,0);assert.ok(!E.recommend(s,D,133,{lookahead:false}).some(c=>c.hero===id('裴擒虎')));
});
test('pick recommendations also avoid opening a duplicate filled role via historical fringe lanes',()=>{
 const s=scenario();s.actions=s.actions.slice(0,17); // Fill current bans to reach a pick below instead.
 let n=scenario();for(const name of ['猪八戒','武则天','夏侯惇'])n=E.apply(n,id(name),D);
 assert.equal(E.turn(n,D).type,'pick');assert.equal(E.turn(n,D).camp,2);
 const r=E.recommend(n,D,133,{lookahead:false});assert.ok(r.every(c=>c.targetRoles.every(role=>['打野','中路'].includes(role))));
});
export {scenario};
