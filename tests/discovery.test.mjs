import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import '../dist/data/model.js';
import '../dist/engine.js';
import '../dist/discovery.js';
import '../dist/data/discovery-data.js';
import '../dist/analytics.js';
import '../dist/discovery-ui.js';
const bytes=fs.readFileSync(new URL('../dist/data/snapshot.json',import.meta.url)),D=JSON.parse(bytes),F=globalThis.BPDiscovery,E=globalThis.BPEngine,A=globalThis.BPAnalytics,C=globalThis.BP_DISCOVERY.full;
globalThis.BP_DATA=D;
const H=E.index(D),id=name=>D.heroes.find(h=>h.name===name).id,combo=names=>C.allies.find(r=>r.ids.join(',')===names.map(id).sort((a,b)=>a-b).join(',')),state=()=>E.initial(D);
test('exhaustive discovery matches independent audit counts, occurrence totals and hash',()=>{
 assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),globalThis.BP_DISCOVERY.sourceHash);
 assert.equal(C.allies.length,7339);
 assert.deepEqual([2,3,4,5].map(n=>C.meta.bySize[n].observed),[1400,3342,2135,462]);
 assert.deepEqual([2,3,4,5].map(n=>C.meta.bySize[n].occurrences),[4740,4740,2370,474]);
 assert.deepEqual([2,3,4,5].map(n=>C.meta.bySize[n].repeated),[594,272,37,2]);
 assert.equal(new Set(C.allies.map(r=>r.id)).size,7339);
});
test('every observed itemset and win count is backed by its complete actual case list',()=>{
 const games=new Map(D.games.map(g=>[g.id,g]));
 for(const r of C.allies){assert.equal(r.cases.length,r.n);let w=0;for(const x of r.cases){const g=games.get(x.game),ps=g.players.filter(p=>p.camp===x.camp).map(p=>p.hero);assert.ok(r.ids.every(id=>ps.includes(id)));w+=Number(g.winCamp===x.camp);}assert.equal(w,r.w);}
 assert.equal(Math.max(...C.allies.filter(r=>r.size===5).map(r=>r.n)),5);assert.ok(C.allies.filter(r=>r.n<3).every(r=>r.classification==='observed'));
});
test('named examples do not constrain mining; previously unseen triple gains its real case',()=>{
 for(const [names,n,w] of [[['艾琳','盾山'],47,26],[['朵莉亚','杨戬'],10,5],[['曹操','海月'],27,22],[['曹操','艾琳','盾山'],14,8]]){const r=combo(names);assert.ok(r);assert.equal(r.n,n);assert.equal(r.w,w);}
 assert.equal(combo(['狄仁杰','元流之子(辅助)','嬴政']).n,1);assert.equal(combo(['狄仁杰','元流之子(辅助)','嬴政']).cases[0].game,'1054884368_3_1792492829');
});
test('same-side consecutive picks count as one turn; abnormal sequence never supplies timing',()=>{
 const a=combo(['朵莉亚','杨戬']);assert.equal(a.n,10);assert.equal(a.sequenceN,9);assert.equal(a.sameTurn,9);
 for(const r of C.allies)assert.ok(r.sameTurn<=r.sequenceN&&r.phase1<=r.sequenceN&&r.sequenceN<=r.n);
});
test('higher-order combinations expose actual parent completion instead of invented interaction strength',()=>{
 const t=combo(['曹操','艾琳','盾山']),parent=t.parents.find(p=>p.added===id('曹操'));assert.equal(parent.n,47);assert.equal(parent.completion,14/47);
 for(const r of C.allies)for(const p of r.parents){assert.equal(p.ids.length+1,r.size);assert.ok(p.ids.every(id=>r.ids.includes(id)));assert.ok(p.n>=r.n);}
});
test('all response cases follow target and preserve correct pick/ban ownership',()=>{
 const games=new Map(D.games.map(g=>[g.id,g]));
 for(const r of [...C.responses,...C.bans]){assert.ok(r.k<=r.n);assert.ok(r.matchedN<=r.n);assert.equal(r.cases.length,r.k);assert.ok(r.matchedExpected>=-1e-8&&r.matchedExpected<=r.matchedN+1e-8);
  for(const x of r.cases){const g=games.get(x.game),a=g.actions[x.response-1],b=g.actions[x.reveal-1];assert.ok(g.sequenceValid&&x.response>x.reveal);assert.equal(a.camp,x.camp);assert.equal(a.hero,r.ids[0]);assert.equal(a.type,r.type==='ban'?'ban':'pick');assert.equal(b.hero,r.ids[1]);assert.equal(b.camp,3-x.camp);assert.equal(b.type,'pick');
   const prior=g.actions.slice(0,x.decision-1),candidate=H[r.ids[0]],targetCamp=r.type==='ban'?3-x.camp:x.camp;
   assert.ok(!prior.some(a=>a.type==='ban'&&a.hero===candidate.id));assert.ok(!prior.some(a=>a.type==='pick'&&H[a.hero].family===candidate.family));
   assert.ok(E.lineupCheck([...prior.filter(a=>a.type==='pick'&&a.camp===targetCamp).map(a=>H[a.hero]),candidate],state(),D).valid);
   const decisionAction=g.actions[x.decision-1];assert.equal(decisionAction.camp,x.camp);assert.equal(decisionAction.type,a.type);
  }
 }
});
test('generic conditional responses and ban signals go beyond two manual counters',()=>{
 const r=C.responses.find(r=>r.ids[0]===id('曹操')&&r.ids[1]===id('夏洛特')&&r.targetRole==='对抗路');assert.equal(r.k,22);assert.equal(r.n,36);
 const z=C.responses.find(r=>r.ids[0]===id('张飞')&&r.ids[1]===id('海月'));assert.equal(z.k,27);assert.equal(z.n,38);
 assert.ok(C.bans.some(r=>r.k>=3&&r.series>=2));assert.ok(C.meta.responseTests>C.responses.length);assert.ok(C.meta.banTests>C.bans.length);
});
test('recent and historical scopes recompute discovery without own-series future cases',()=>{
 const recent=globalThis.BP_DISCOVERY.recent;assert.equal(recent.meta.games,125);assert.ok(recent.allies.length<C.allies.length);assert.ok(recent.allies.every(r=>r.classification!=='cross'&&r.classification!=='emerging'));
 const first=F.get({...state(),analysisMatchId:'2026100201'},D,{responses:false});assert.equal(first.meta.games,0);assert.equal(first.allies.length,0);
 const mid=F.get({...state(),analysisMatchId:'2026100303'},D,{responses:false});assert.ok(mid.meta.games>0);const start=D.games.find(g=>g.matchId==='2026100303').date;
 for(const r of mid.allies)for(const c of r.cases)assert.ok(D.games.find(g=>g.id===c.game).date<start);
});
test('recommendation uses generic response patterns and higher-order completions once',()=>{
 const r=A.relationScore(state(),id('张飞'),[],[H[id('海月')]],D);assert.ok(r.links[0].response);assert.equal(r.links[0].response.target.n,38);
 const t=A.relationScore(state(),id('曹操'),[H[id('艾琳')],H[id('盾山')]],[],D);assert.equal(t.links.filter(x=>x.type==='empirical-extension').length,1);assert.equal(t.links.find(x=>x.type==='empirical-extension').evidence.n,14);
});
test('all observed patterns stay searchable without an eight-card limit',()=>{
 const U=globalThis.BPDiscoveryUI,context={render(){},dialog(){},download(){},page:'research'},s=state();
 U.click({dataset:{discoveryAction:'reset'}},s,D,context);U.change({id:'discovery-evidence',value:'all'},context);U.change({id:'discovery-size',value:'all'},context);
 assert.equal(U.rows(s,D).length,7339);const rendered=U.view(s,D);assert.equal((rendered.match(/data-pattern-card=/g)||[]).length,24);
 U.click({dataset:{discoveryAction:'more'}},s,D,context);assert.equal((U.view(s,D).match(/data-pattern-card=/g)||[]).length,48);
 const d=U.detail(s,D,combo(['艾琳','盾山']).id);assert.ok(d.body.includes('全部47条实际案例'));assert.ok(d.body.includes('14/47'));
});
