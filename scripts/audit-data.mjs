import fs from 'node:fs';import '../dist/engine.js';
const D=JSON.parse(fs.readFileSync(new URL('../dist/data/snapshot.json',import.meta.url))),E=globalThis.BPEngine;
const failures=[];let valid=0;
for(const g of D.games.filter(g=>g.replayable)){
 const s={...E.initial(D),teamA:g.blue,teamB:g.red,bo:g.bo,actions:g.actions};
 for(const p of D.games.filter(x=>x.matchId===g.matchId&&x.seq<g.seq))s.games.push({blueKey:p.blue.id===g.blue.id?'A':'B',actions:p.actions,winner:(p.winCamp===1?p.blue.id:p.red.id)===g.blue.id?'A':'B',note:''});
 try{E.validate(s,D);valid++;}catch(e){failures.push({id:g.id,seq:g.seq,matchId:g.matchId,error:e.message});}
}
console.log(JSON.stringify({validated:valid,failures},null,2));
