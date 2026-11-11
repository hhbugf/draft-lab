import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import '../dist/engine.js';
const D=JSON.parse(fs.readFileSync(new URL('../dist/data/snapshot.json',import.meta.url))),E=globalThis.BPEngine;
const schedule=JSON.parse(fs.readFileSync(new URL('./fixtures/2026-11-11-official-series.json',import.meta.url)));

test('November refresh contains every completed official series and no upcoming final',()=>{
 assert.equal(D.meta.checkedThrough,'2026-11-11');assert.equal(D.meta.latestMatch,'2026-11-08 18:00:00');
 assert.equal(schedule.matches.length,53);assert.equal(D.games.length,237);
 assert.deepEqual(D.games.map(g=>g.id).sort(),schedule.matches.flatMap(m=>m.battles).sort());
 for(const m of schedule.matches){const gs=D.games.filter(g=>g.matchId===m.id);assert.equal(gs.length,m.score[0]+m.score[1]);assert.deepEqual(gs.map(g=>g.seq),gs.map((g,i)=>i+1));for(let i=0;i<2;i++)assert.equal(gs.filter(g=>(g.winCamp===1?g.blue:g.red).id===m.teams[i]).length,m.score[i]);}
 for(const m of schedule.upcoming)assert.ok(!D.games.some(g=>g.matchId===m.id));
});

test('every normalized hero count reconciles to authoritative players and official aggregate scopes',()=>{
 let picks=0;
 for(const h of D.heroes){const appearances=D.games.flatMap(g=>g.players.filter(p=>p.hero===h.id).map(p=>({g,p}))),unique=new Set(appearances.map(x=>x.g.id)).size,wins=appearances.filter(x=>x.g.winCamp===x.p.camp).length,bans=D.games.reduce((n,g)=>n+g.actions.filter(a=>a.type==='ban'&&a.hero===h.id).length,0);picks+=appearances.length;
  assert.equal(h.stats?.pick_num||0,appearances.length);assert.equal(h.stats?.victory_battle_count||0,wins);assert.equal(h.stats?.ban_num||0,bans);
  if(h.officialStats){assert.equal(h.officialStats.pick_num,unique);assert.equal(h.officialStats.battle_count,appearances.length);assert.equal(h.officialStats.victory_battle_count,wins);assert.equal(h.officialStats.ban_num,bans);}
  if(h.stats)assert.equal(h.stats.pick_rate,unique/D.games.length);
 }
 assert.equal(picks,2370);
});

test('blind mirrors preserve both lineups without inventing raw draft steps or response timing',()=>{
 const blind=D.games.filter(g=>g.draftMode==='blind');assert.equal(blind.length,5);
 for(const g of blind){assert.equal(g.seq,7);assert.equal(g.bo,7);assert.equal(g.sequenceValid,false);assert.equal(g.replayable,false);assert.equal(g.players.length,10);assert.ok(g.actions.length<10);assert.ok(g.actions.every(a=>a.type==='pick'));for(const c of [1,2])assert.equal(g.players.filter(p=>p.camp===c).length,5);}
 const ao=D.heroes.find(h=>h.name==='敖隐');assert.equal(ao.stats.pick_num,82);assert.equal(ao.officialStats.pick_num,77);assert.equal(ao.officialStats.battle_count,82);
 const recent=E.sampleStats({window:'recent'},ao,D),gs=D.games.filter(g=>g.date>='2026-10-15'),ps=gs.flatMap(g=>g.players.filter(p=>p.hero===ao.id));assert.equal(recent.pick_num,ps.length);assert.equal(recent.pick_rate,gs.filter(g=>g.players.some(p=>p.hero===ao.id)).length/gs.length);
});

test('ban-only heroes are visible even when official aggregate omits them',()=>{
 const h=D.heroes.find(h=>h.name==='貂蝉');assert.equal(h.officialStats,null);assert.equal(h.stats.pick_num,0);assert.equal(h.stats.ban_num,1);assert.equal(h.stats.ban_rate,1/237);
});

test('conflicting source positions remain disclosed and never create false role evidence',()=>{
 const g=D.games.find(g=>g.id==='1054884368_148_1791728915');assert.equal(g.roleIssues.length,1);assert.equal(g.roleIssues[0].camp,2);assert.equal(g.players.filter(p=>p.camp===2&&p.role==='打野').length,2);
 for(const h of D.heroes){const expected={};for(const game of D.games)for(const p of game.players)if(p.hero===h.id&&!game.roleIssues.some(x=>x.camp===p.camp))expected[p.role]=(expected[p.role]||0)+1;assert.deepEqual(h.observedRoles,expected);assert.deepEqual(E.roleEvidence(E.initial(D),h,D).all,expected);}
});
