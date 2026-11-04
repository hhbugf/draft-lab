const fs=require('fs'),path=require('path');const root=path.resolve(__dirname,'..');
const file=root+'/dist/data/snapshot.json',data=JSON.parse(fs.readFileSync(file,'utf8'));
const h=data.heroes.find(h=>h.id===547);
if(!h.legacyRoles)h.legacyRoles=[...h.roles];
if(!h.rawOfficialRoles)h.rawOfficialRoles=[...h.officialRoles];
h.officialRoles=['发育路'];h.roles=['发育路'];
h.roleCorrection={verifiedAt:'2026-10-20',roles:['发育路'],reason:'原始roles字段与射手职业及9次职业比赛的实际发育路记录冲突，规范化后仅采用已核实的发育路；原始值单独保留。',source:h.source,matchCount:9};
data.meta.roleCorrections=[{hero:h.id,...h.roleCorrection}];
fs.writeFileSync(file,JSON.stringify(data));fs.writeFileSync(root+'/dist/data/snapshot.js','window.BP_DATA = '+JSON.stringify(data)+';\n');
const compiler=root+'/tools/compile.cjs';let text=fs.readFileSync(compiler,'utf8');
const anchor='const teams=[...new Map(games.flatMap(g=>[g.blue,g.red]).map(t=>[t.id,t])).values()];';
const correction=`const corrected=heroes.find(h=>h.id===547);if(corrected){corrected.legacyRoles=[...corrected.roles];corrected.rawOfficialRoles=[...corrected.officialRoles];corrected.officialRoles=['发育路'];corrected.roles=['发育路'];corrected.roleCorrection=${JSON.stringify(h.roleCorrection)};}\n`;
if(!text.includes('const corrected=heroes.find')){if(!text.includes(anchor))throw Error('Compiler anchor missing');text=text.replace(anchor,correction+anchor);}
fs.writeFileSync(compiler,text);
console.log(JSON.stringify({hero:h.name,roles:h.roles,original:h.rawOfficialRoles,observed:h.observedRoles}));
