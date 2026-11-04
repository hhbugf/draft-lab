const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..'),file=path.join(root,'dist/data/research.json');
const raw=JSON.parse(fs.readFileSync(path.join(root,'.cache/annual-research.json'),'utf8'));
const r={meta:raw.meta,hypotheses:raw.hypotheses,supplemental:raw.supplemental,strongAlliances:raw.strongAlliances.slice(0,8)};
fs.writeFileSync(file,JSON.stringify(r));fs.writeFileSync(path.join(root,'dist/data/research.js'),'globalThis.BP_RESEARCH='+JSON.stringify(r)+';');
console.log('Research artifact generated: '+r.hypotheses.length+' hypotheses');
