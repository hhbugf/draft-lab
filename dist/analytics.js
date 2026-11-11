(function(G){
'use strict';
const caches=new WeakMap(),sigmoid=x=>1/(1+Math.exp(-Math.max(-35,Math.min(35,x))));
function modelFor(matchId){return matchId?G.BP_MODEL.rolling[matchId]:G.BP_MODEL.full;}
function strengthValues(actions,data,profile){
 const H=G.BPEngine.index(data),out={'strength:priority':0,'structure:engage':0,'structure:frontline':0};if(!profile)return out;
 for(const c of [1,2]){const ids=actions.filter(a=>a.type==='pick'&&a.camp===c).map(a=>a.hero),sign=c===1?1:-1;
  out['strength:priority']+=sign*ids.reduce((n,id)=>n+(profile.heroes[id]?.priority||0)-.5,0)/5;
  out['structure:engage']+=sign*Math.min(1,ids.filter(id=>H[id]?.abilities.engage>=4&&H[id]?.abilities.control>=3).length);
  out['structure:frontline']+=sign*Math.min(1,ids.filter(id=>H[id]?.abilities.tank>=4).length);
 }for(const k of Object.keys(out))out[k]*=profile.scale;return out;
}
function featureValues(s,data,actions=s.actions,profile=G.BP_MODEL.full.strengthProfile){
 const E=G.BPEngine,blue=E.keyOf(s,1)==='A'?s.teamA:s.teamB,red=E.keyOf(s,2)==='A'?s.teamA:s.teamB;
 const x={side:1},ps={1:new Set(),2:new Set()};x['team:'+blue.id]=1;x['team:'+red.id]=-1;
 for(const a of actions){const k=a.type+':'+a.hero;x[k]=(x[k]||0)+(a.camp===1?1:-1);if(a.type==='pick')ps[a.camp].add(a.hero);}
 G.BP_MODEL.relations.forEach((r,i)=>{let v=0;for(const c of [1,2]){const hit=r.type==='ally'?r.ids.every(h=>ps[c].has(h)):ps[c].has(r.ids[0])&&ps[3-c].has(r.ids[1]);if(hit)v+=c===1?1:-1;}x['relation:'+i]=v;});
 return Object.assign(x,strengthValues(actions,data,profile));
}
function predict(s,data,options={}){
 const E=G.BPEngine,m=modelFor(options.matchId||s.analysisMatchId);if(!m)return {unavailable:true,reason:'缺少该场赛前模型'};
 if(E.isPeak(s)&&E.turn(s,data))return {unavailable:true,reason:'巅峰对决双盲阶段，双方阵容尚未同时公开，暂停预测以免泄露对手信息'};
 for(const c of [1,2])if(!E.lineupCheck(E.picks(s,c,E.index(data)),s,data).valid)return {unavailable:true,reason:'阵容存在位置冲突，请修正后查看预测'};
 const x=featureValues(s,data,s.actions,m.strengthProfile),contributions=G.BP_MODEL.features.map((k,i)=>({feature:k,value:(x[k]||0)*m.weights[i]})),priorContributions=G.BP_MODEL.features.map((k,i)=>({feature:k,value:(x[k]||0)*(m.candidateWeights?.[i]||0)}));
 const z=contributions.reduce((a,c)=>a+c.value,0),base=G.BP_MODEL.features.reduce((a,k,i)=>a+(x[k]||0)*m.baseline[i],0);
 const priorLogit=priorContributions.filter(c=>/^(strength|structure):/.test(c.feature)).reduce((n,c)=>n+c.value,0),priorZ=priorContributions.reduce((n,c)=>n+c.value,0);
 const coverage=[1,2].map(c=>{const heroes=s.actions.filter(a=>a.type==='pick'&&a.camp===c).map(a=>{const h=data.heroes.find(h=>h.id===a.hero),r=m.strengthProfile?.heroes[a.hero];return {id:a.hero,name:h.name,picks:r?.picks||0,wins:r?.wins||0,bans:r?.bans||0,priority:r?.priority||0,profile:h.profile};});return {camp:c,heroes,unseen:heroes.filter(h=>!h.picks).length,sparse:heroes.filter(h=>h.picks>0&&h.picks<6).length};});
 return {blue:sigmoid(z),red:1-sigmoid(z),baseline:sigmoid(base),priorBlue:sigmoid(priorZ),priorRed:1-sigmoid(priorZ),sensitivity:[sigmoid(priorZ-.5*Math.abs(priorLogit)),sigmoid(priorZ+.5*Math.abs(priorLogit))],coverage,unsupported:coverage.some(c=>c.unseen>0),n:m.n,series:m.series,through:m.through,asOf:!!(options.matchId||s.analysisMatchId),
  contributions:contributions.filter(c=>Math.abs(c.value)>.00001).sort((a,b)=>Math.abs(b.value)-Math.abs(a.value)),picks:s.actions.filter(a=>a.type==='pick').length,
  groups:Object.fromEntries(['side','team','pick','ban','relation'].map(k=>[k,contributions.filter(c=>c.feature.split(':')[0]===k).reduce((a,c)=>a+c.value,0)])),
  priorGroups:Object.fromEntries(['side','team','pick','ban','relation','strength','structure'].map(k=>[k,priorContributions.filter(c=>c.feature.split(':')[0]===k).reduce((a,c)=>a+c.value,0)]))};
}
function wilson(w,n){if(!n)return null;const z=1.96,p=w/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,r=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;return [Math.max(0,c-r),Math.min(1,c+r)];}
function dataset(s,data){
 let root=caches.get(data);if(!root){root={};caches.set(data,root);}const cutoff=s.analysisMatchId?Math.min(...data.games.filter(g=>g.matchId===s.analysisMatchId).map(g=>Date.parse(g.date.replace(' ','T')))):null;
 const key=(s.window||'all')+':'+(s.analysisMatchId||'');if(root[key])return root[key];
 const gs=data.games.filter(g=>(s.window!=='recent'||g.date>='2026-10-15')&&(!cutoff||Date.parse(g.date.replace(' ','T'))<cutoff)),rows=[],counts={},teams={};
 for(const g of gs)for(const camp of [1,2]){
  const ids=g.players.filter(p=>p.camp===camp).map(p=>p.hero),tid=(camp===1?g.blue:g.red).id;
  const baselineModel=G.BP_MODEL.rolling[g.matchId],fake={teamA:g.blue,teamB:g.red,blueKey:'A',actions:[]};
  const x=featureValues(fake,data,[]),logit=G.BP_MODEL.features.reduce((n,k,i)=>n+(x[k]||0)*(baselineModel?.baseline[i]||0),0),blueP=sigmoid(logit);
  rows.push({g,camp,ids,tid,win:g.winCamp===camp?1:0,baseline:camp===1?blueP:1-blueP});
  teams[tid]??={n:0,counts:{}};teams[tid].n++;
  for(const id of ids){counts[id]=(counts[id]||0)+1;teams[tid].counts[id]=(teams[tid].counts[id]||0)+1;}
 }
 return root[key]={games:gs,rows,counts,teams,pairs:new Map()};
}
function evidence(ids,type,s,data){
 const ds=dataset(s,data),key=type+':'+ids.join(',');if(ds.pairs.has(key))return ds.pairs.get(key);
 const matches=ds.rows.filter(r=>type==='ally'?ids.every(id=>r.ids.includes(id)):r.ids.includes(ids[0])&&r.g.players.some(p=>p.camp!==r.camp&&p.hero===ids[1]));
 let w=0,residual=0,after=0,ordered=0,phase1=0;const teams=new Set(),examples=[];
 for(const r of matches){w+=r.win;residual+=r.win-r.baseline;teams.add(r.tid);examples.push({id:r.g.id,camp:r.camp});
  if(r.g.sequenceValid){const positions=ids.map((id,i)=>r.g.actions.findIndex(a=>a.type==='pick'&&a.hero===id&&(type==='ally'||a.camp===(i?3-r.camp:r.camp))));
   if(positions.every(i=>i>=0)){ordered++;if(positions[0]>positions[1])after++;if(Math.max(...positions)<10)phase1++;}}
 }
 const n=matches.length,total=ds.rows.length,marginal=ids.map(id=>ds.counts[id]||0),expected=total?marginal.reduce((a,b)=>a*b/total,total):0;
 let adjustedExpected=0;if(type==='ally')for(const t of Object.values(ds.teams))adjustedExpected+=ids.reduce((a,id)=>a*(t.counts[id]||0)/t.n,t.n);
 const r={ids,type,n,w,rate:n?w/n:null,interval:wilson(w,n),teams:teams.size,expected,lift:expected?n/expected:null,
  adjustedLift:adjustedExpected?n/adjustedExpected:null,adjustedResidual:n?residual/n:0,after,ordered,phase1,examples};
 ds.pairs.set(key,r);return r;
}
function relationScore(s,id,ally,enemy,data){
 let value=0;const links=[];
 for(const h of ally){const e=evidence([id,h.id],'ally',s,data);if(e.n<3||e.teams<2)continue;
  const association=Math.max(0,Math.min(2,Math.log(e.adjustedLift||1))),shrink=e.n/(e.n+12),v=shrink*(association*.22+e.adjustedResidual*.5);
  value+=v;links.push({type:'empirical-ally',a:id,b:h.id,evidence:e,weight:v,reason:`年总配合 ${h.name}：${e.n}局/${e.w}胜，${e.teams}队；队伍分层共现${(e.adjustedLift||0).toFixed(1)}倍`});
 }
 for(const h of enemy){const e=evidence([id,h.id],'enemy',s,data);if(e.n<3||e.teams<2)continue;
  const catalog=G.BP_DISCOVERY&&G.BP_DATA===data&&!s.analysisMatchId?(s.window==='recent'?G.BP_DISCOVERY.recent:G.BP_DISCOVERY.full):null;
  const mined=catalog?.responses.filter(r=>r.ids[0]===id&&r.ids[1]===h.id&&r.k>=3&&r.series>=2&&r.matchedCoverage>=.5).sort((a,b)=>b.score-a.score)[0];
  const response=mined?{target:{n:mined.n,picks:mined.k,rate:mined.rate},other:{n:mined.controlN,picks:mined.controlK,rate:mined.controlRate},matchedDelta:mined.matchedDelta}:catalog?null:responseEvidence(id,h.id,s,data);
  const selection=response&&response.target.n?Math.max(0,response.matchedDelta??(response.target.rate-(response.other.rate||0)))*.6:0;
  const v=(e.adjustedResidual*.8+selection)*e.n/(e.n+12);value+=v;
  links.push({type:'empirical-enemy',a:id,b:h.id,evidence:e,response,weight:v,negative:v<0,reason:`年总对抗 ${h.name}：${e.n}局/${e.w}胜；${e.after}/${e.ordered}次在其后选出${response?`；可响应时选用${response.target.picks}/${response.target.n}`:''}，非因果克制`});
 }
 // Discover all higher-order completions, never just named examples. Add at most one
 // extension term so nested pairs/triples/quads do not multiply the same evidence.
 const completed=G.BPDiscovery&&G.BP_DISCOVERY?G.BPDiscovery.get(s,data,{responses:false}).allies.filter(r=>r.size>=3&&r.n>=3&&r.series>=2&&r.classification!=='observed'&&r.ids.includes(id)&&r.ids.filter(h=>h!==id).every(x=>ally.some(h=>h.id===x))).sort((a,b)=>b.size-a.size||b.score-a.score)[0]:null;
 if(completed){const e=evidence(completed.ids,'ally',s,data),v=Math.min(.18,e.n/(e.n+12)*Math.max(0,Math.min(2,Math.log(e.adjustedLift||1)))*.15);value+=v;links.push({type:'empirical-extension',a:id,evidence:e,patternId:completed.id,weight:v,reason:`自动发现${completed.size}人扩展：${completed.n}局/${completed.teams}队/${completed.series}系列赛；非独立增益证明`});}
 links.sort((a,b)=>Math.abs(b.weight)-Math.abs(a.weight));return {value:Math.max(-1,Math.min(1,value)),links};
}
function responseEvidence(candidate,target,s,data){
 const ds=dataset(s,data);ds.responses??=new Map();const cacheKey=candidate+':'+target;if(ds.responses.has(cacheKey))return ds.responses.get(cacheKey);
 const H=G.BPEngine.index(data),family=id=>H[id]?.family,mode=id=>{const count={};for(const g of ds.games)for(const p of g.players)if(p.hero===id)count[p.role]=(count[p.role]||0)+1;return Object.entries(count).sort((a,b)=>b[1]-a[1])[0]?.[0];};
 const targetRole=mode(target),candidateRole=mode(candidate),groups={target:{n:0,picks:0},other:{n:0,picks:0}};
 for(const g of ds.games){if(!g.sequenceValid||g.seq===7||g.roleIssues?.length)continue;for(const camp of [1,2]){
  const opp=g.players.find(p=>p.camp===3-camp&&p.role===targetRole);if(!opp)continue;
  const at=g.actions.findIndex(a=>a.type==='pick'&&a.camp===3-camp&&a.hero===opp.hero);if(at<0)continue;
  const prior=g.actions.slice(0,at+1),tid=(camp===1?g.blue:g.red).id;
  const consumed=data.games.some(old=>old.matchId===g.matchId&&old.seq<g.seq&&old.players.some(p=>p.teamId===tid&&family(p.hero)===family(candidate)));
  if(consumed||prior.some(a=>a.type==='ban'&&a.hero===candidate)||prior.some(a=>a.type==='pick'&&family(a.hero)===family(candidate)))continue;
  const roleHero=g.players.find(p=>p.camp===camp&&p.role===candidateRole)?.hero;
  if(prior.some(a=>a.type==='pick'&&a.camp===camp&&a.hero===roleHero))continue;
  const group=groups[opp.hero===target?'target':'other'];group.n++;if(g.players.some(p=>p.camp===camp&&p.hero===candidate))group.picks++;
 }}
 for(const g of Object.values(groups))g.rate=g.n?g.picks/g.n:null;
 const result={...groups,targetRole,candidateRole,retrospectiveRoles:true};ds.responses.set(cacheKey,result);return result;
}
function topPairs(s,data){const ds=dataset(s,data),pairs=new Map();for(const r of ds.rows)for(let i=0;i<r.ids.length;i++)for(let j=i+1;j<r.ids.length;j++){const ids=[r.ids[i],r.ids[j]].sort((a,b)=>a-b);pairs.set(ids.join(','),ids);}
 return [...pairs.values()].map(ids=>evidence(ids,'ally',s,data)).filter(e=>e.n>=4&&e.teams>=2&&e.adjustedLift>1).sort((a,b)=>b.n-a.n||b.adjustedLift-a.adjustedLift);}
G.BPAnalytics={predict,featureValues,strengthValues,evidence,relationScore,responseEvidence,topPairs,wilson,modelFor};
})(globalThis);
