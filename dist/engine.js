(function(G){
'use strict';
const ROLES=['对抗路','打野','中路','发育路','游走'];
const METRICS={engage:'先手',peel:'保护反手',tank:'前排',control:'控制',wave:'清线',split:'单带',dps:'持续输出',burst:'爆发',poke:'消耗',macro:'支援',push:'推塔'};
const W={presence:35,win:10,fit:20,structure:15,relations:8,familiarity:7,reserve:5};
const ROLE_POLICY={minimumSample:6,minimumCount:3,minimumShare:0.1,recentStart:'2026-10-15',priorStrength:4};
const roleCache=new WeakMap();
const num=n=>Number.isFinite(Number(n))?Number(n):0;
const other=k=>k==='A'?'B':'A';
function initial(data){return {schema:1,teamA:{...data.teams.find(t=>t.name.includes('AG'))||data.teams[0]},teamB:{...data.teams.find(t=>t.name.includes('狼'))||data.teams[1]},blueKey:'A',bo:7,peak:true,games:[],actions:[],excluded:{A:[],B:[]},window:'all',note:''};}
function index(data){return Object.fromEntries(data.heroes.map(h=>[h.id,h]));}
function keyOf(s,camp){return camp===1?s.blueKey:other(s.blueKey);}
function isPeak(s){return s.peak&&s.bo===7&&s.games.length===6;}
function sequence(s,data){return isPeak(s)?[...Array.from({length:5},()=>({camp:1,type:'pick'})),...Array.from({length:5},()=>({camp:2,type:'pick'}))]:data.meta.steps;}
function turn(s,data){return sequence(s,data)[s.actions.length]||null;}
function used(s,key,data){const ids=s.games.flatMap(g=>g.actions.filter(a=>a.type==='pick'&&g.blueKey===key&&a.camp===1||a.type==='pick'&&g.blueKey!==key&&a.camp===2).map(a=>a.hero));return [...new Set(ids)];}
function picks(s,camp,idx){return s.actions.filter(a=>a.type==='pick'&&a.camp===camp).map(a=>idx[a.hero]).filter(Boolean);}
function assign(heroes){
 if(heroes.length>5)return null;
 let best=null;const sorted=heroes.map(h=>({...h,roles:h.roles.filter(r=>ROLES.includes(r))})).sort((a,b)=>a.roles.length-b.roles.length);
 function walk(i,slots){if(i===sorted.length){best={...slots};return true;}for(const r of sorted[i].roles)if(!slots[r]){slots[r]=sorted[i].id;if(walk(i+1,slots))return true;delete slots[r];}return false;}
 walk(0,{});return best;
}
// Recommendation roles are empirical, separate from the broad roles used for manual draft legality.
// A listed/off-meta lane is not automatically a credible competitive flex lane.
function roleEvidence(s,h,data){
 let cache=roleCache.get(data);
 if(!cache){
  cache={all:{},recent:{},profiles:{}};
  for(const g of data.games)for(const p of g.players){if(!ROLES.includes(p.role))continue;cache.all[p.hero]??={};cache.all[p.hero][p.role]=(cache.all[p.hero][p.role]||0)+1;if(g.date>=ROLE_POLICY.recentStart){cache.recent[p.hero]??={};cache.recent[p.hero][p.role]=(cache.recent[p.hero][p.role]||0)+1;}}
  roleCache.set(data,cache);
 }
 const cacheKey=s.window+':'+h.id;if(cache.profiles[cacheKey])return cache.profiles[cacheKey];
 const all=cache.all[h.id]||{},recent=cache.recent[h.id]||{};
 const total=Object.values(all).reduce((a,b)=>a+b,0),recentTotal=Object.values(recent).reduce((a,b)=>a+b,0);
 const probabilities={};let roles=[],basis='职业样本不足，使用位置先验';
 if(total>=ROLE_POLICY.minimumSample){
  for(const r of ROLES){
   const prior=(all[r]||0)/total;
   // Recent evidence updates a small all-event prior. Zero recent observations alone never erase a lane.
   probabilities[r]=recentTotal>=ROLE_POLICY.minimumSample?((recent[r]||0)+ROLE_POLICY.priorStrength*prior)/(recentTotal+ROLE_POLICY.priorStrength):prior;
   if((all[r]||0)>=ROLE_POLICY.minimumCount&&probabilities[r]>=ROLE_POLICY.minimumShare)roles.push(r);
  }
  basis=recentTotal>=ROLE_POLICY.minimumSample?'近期分路 + 全赛事先验':'全赛事实测分路';
 }else{
  const priorRoles=[...new Set([...(h.officialRoles||h.roles),...Object.keys(all)])].filter(r=>ROLES.includes(r));
  for(const r of priorRoles)probabilities[r]=((all[r]||0)+2/Math.max(1,priorRoles.length))/(total+2);
  roles=priorRoles;
 }
 if(!roles.length&&Object.values(probabilities).some(p=>p>0))roles=[Object.entries(probabilities).sort((a,b)=>b[1]-a[1])[0][0]];
 roles.sort((a,b)=>probabilities[b]-probabilities[a]);
 const profile={roles,probabilities,all:{...all},recent:{...recent},total,recentTotal,basis,confidence:total>=ROLE_POLICY.minimumSample?'sample':'prior',rareRoles:h.roles.filter(r=>!roles.includes(r))};
 cache.profiles[cacheKey]=profile;return profile;
}
function inferRoles(list,s,data){
 const profiles=list.map(h=>({h,e:roleEvidence(s,h,data)}));
 function enumerate(){const results=[];function walk(i,slots,weight){if(i===profiles.length){results.push({slots:{...slots},weight});return;}const {h,e}=profiles[i];for(const role of e.roles)if(!slots[role]){slots[role]=h.id;walk(i+1,slots,weight*e.probabilities[role]);delete slots[role];}}walk(0,{},1);return results;}
 let assignments=enumerate(),observedException=false;
 // Never manufacture a lane from a broad tag. Rare selected lineups need joint evidence
 // of those exact heroes sharing one camp with distinct recorded positions.
 if(!assignments.length&&list.length){
  const patterns=new Map();
  for(const g of data.games)for(const camp of [1,2]){
   const players=g.players.filter(p=>p.camp===camp&&list.some(h=>h.id===p.hero));
   if(players.length!==list.length||new Set(players.map(p=>p.role)).size!==list.length||players.some(p=>!ROLES.includes(p.role)))continue;
   const slots=Object.fromEntries(players.map(p=>[p.role,p.hero])),key=JSON.stringify(Object.entries(slots).sort());
   if(patterns.has(key))patterns.get(key).weight++;else patterns.set(key,{slots,weight:1});
  }
  assignments=[...patterns.values()];observedException=assignments.length>0;
 }
 const total=assignments.reduce((n,a)=>n+a.weight,0);for(const a of assignments)a.weight=total?a.weight/total:0;
 assignments.sort((a,b)=>b.weight-a.weight);
 return {assignments,assignment:assignments[0]?.slots||null,fallback:false,observedException,valid:assignments.length>0,lowConfidence:observedException||profiles.some(p=>p.e.confidence==='prior')};
}
function lineupCheck(list,s,data){
 const inferred=inferRoles(list,s,data);if(inferred.valid)return {valid:true,inferred,reason:inferred.observedException?'按真实同阵容记录的罕见分路分配':''};
 const duplicates=ROLES.filter(r=>list.filter(h=>roleEvidence(s,h,data).roles.length===1&&roleEvidence(s,h,data).roles[0]===r).length>1);
 const reason=duplicates.length?'位置冲突：多名英雄只能分配到'+duplicates.join('/')+'，不能组成五路阵容':'位置冲突：没有可信的独立分路分配，不能强行补位';
 return {valid:false,inferred,reason};
}
function roleContext(s,h,data,idx,t){
 const camp=t.type==='ban'?3-t.camp:t.camp,key=keyOf(s,camp);
 if((s.excluded[key]||[]).includes(h.id))return {coverage:0,roles:[],reason:'目标队伍已排除此英雄'};
 const list=picks(s,camp,idx),inferred=inferRoles(list,s,data),evidence=roleEvidence(s,h,data),weights={};
 // Integrate over credible assignments, so real flex picks remain uncertain instead of being fixed too early.
 for(const a of inferred.assignments)for(const role of evidence.roles)if(!a.slots[role])weights[role]=(weights[role]||0)+a.weight*evidence.probabilities[role];
 const roles=Object.keys(weights).filter(r=>weights[r]>0).sort((a,b)=>weights[b]-weights[a]);
 const coverage=Math.min(1,Object.values(weights).reduce((a,b)=>a+b,0));
 return {coverage,roles,weights,evidence,inferred,reason:coverage?'可覆盖目标阵容空位':'可信分路均已被目标阵容占用'};
}
function legal(s,id,data,options={}){
 const idx=options.idx||index(data),h=idx[id],t=turn(s,data);if(!h)return '英雄不存在';if(!t)return '本局BP已完成';
 const key=keyOf(s,t.camp),opp=other(key),peak=isPeak(s);
 const chosen=s.actions.filter(a=>a.type==='pick'&&(!peak||a.camp===t.camp));
 if(chosen.some(a=>idx[a.hero].family===h.family))return '本局已有同一英雄或形态被选择';
 if(!peak&&s.actions.some(a=>a.type==='ban'&&a.hero===id))return '本局已禁用';
 if(!peak){const relevant=used(s,t.type==='ban'?opp:key,data);if(relevant.some(id=>idx[id]?.family===h.family))return t.type==='ban'?'对手已用英雄不进入我方禁用池':'己方在系列赛中已使用该英雄';}
 if(t.type==='pick'){
  if((s.excluded[key]||[]).includes(id))return '已在本队英雄池中排除';
  if(options.allowLegacyRoles){
   const legacy=[...picks(s,t.camp,idx),h].map(x=>({...x,roles:x.legacyRoles||x.roles}));
   if(!assign(legacy))return '无法分配到五个不同位置';
  }else{const check=lineupCheck([...picks(s,t.camp,idx),h],s,data);if(!check.valid)return check.reason;}
 }
 return null;
}
function apply(s,id,data,options={}){const err=legal(s,id,data,options);if(err)throw Error(err);const t=turn(s,data);return {...s,actions:[...s.actions,{...t,hero:id}]};}
function totals(list){const sum=Object.fromEntries(Object.keys(METRICS).map(k=>[k,0]));for(const h of list)for(const k of Object.keys(sum))sum[k]+=num(h.abilities[k]);return sum;}
function assess(list){const t=totals(list),warnings=[];if(list.length>=3){if(t.engage<6)warnings.push('可靠先手偏少，后续优先补开团');if(t.peel<7)warnings.push('保护反手不足，核心易被切入');if(t.tank<8)warnings.push('前排承伤偏薄，避免正面硬接');if(t.wave<9)warnings.push('兵线处理偏弱，注意转线成本');if(t.dps<9)warnings.push('持续输出不足，需检查打前排能力');}if(list.length===5&&!list.some(h=>h.damage==='法术'))warnings.push('缺少明确法术输出，注意伤害结构');return {totals:t,warnings,assignment:assign(list)};}
function sampleGames(s,data){return data.games.filter(g=>s.window!=='recent'||g.date>='2026-10-15');}
function sampleStats(s,h,data){if(s.window==='all')return h.stats;const gs=sampleGames(s,data);let n=0,w=0,bans=0;for(const g of gs){const p=g.players.find(p=>p.hero===h.id);if(p){n++;if(g.winCamp===p.camp)w++;}if(g.actions.some(a=>a.hero===h.id&&a.type==='ban'))bans++;}return n||bans?{battle_count:n,victory_battle_count:w,win_rate:n?w/n:0,pick_num:n,ban_num:bans,pick_rate:n/gs.length,ban_rate:bans/gs.length}:null;}
function pairEvidence(a,b,s,data,type='ally'){
 const gs=sampleGames(s,data);let n=0,w=0;for(const g of gs){const pa=g.players.find(p=>p.hero===a),pb=g.players.find(p=>p.hero===b);if(!pa||!pb||(type==='ally'?pa.camp!==pb.camp:pa.camp===pb.camp))continue;n++;if(g.winCamp===pa.camp)w++;}return {n,w,rate:n?w/n:null};
}
function score(s,h,data,idx,t,context){
 const isBan=t.type==='ban',camp=isBan?3-t.camp:t.camp,key=keyOf(s,camp),team=key==='A'?s.teamA:s.teamB;
 const ally=picks(s,camp,idx),enemy=isPeak(s)?[]:picks(s,3-camp,idx),a=assess(ally),st=sampleStats(s,h,data),n=num(st?.pick_num),w=num(st?.victory_battle_count);
 const presence=Math.min(1,num(st?.pick_rate)+num(st?.ban_rate));
 const smooth=(w+10)/(n+20); // Beta(10,10) prior; this is not an estimate of BP causal advantage.
 const placement=inferRoles([...ally,h],s,data).assignment;
 const fit=Math.min(1,0.8+0.1*(context.roles.length>1));
 const deficits={engage:8,peel:9,tank:10,wave:12,dps:12};let structure=0;
 for(const [k,goal] of Object.entries(deficits))structure+=Math.min(num(h.abilities[k]),Math.max(0,goal-a.totals[k]))/5;
 structure=Math.min(1,structure/3.3);
 // Empirical co-selection and team-baseline-adjusted matchup results replace manual relationship bonuses.
 // Mechanism hypotheses remain visible in the atlas but never masquerade as match evidence.
 const empirical=G.BPAnalytics?G.BPAnalytics.relationScore(s,h.id,ally,enemy,data):{value:0,links:[]};
 const relation=empirical.value,links=empirical.links;
 const teamGames=sampleGames(s,data).filter(g=>g.blue.id===team.id||g.red.id===team.id);const teamN=teamGames.filter(g=>g.players.some(p=>p.teamId===team.id&&p.hero===h.id)).length;
 const familiarity=teamGames.length?Math.min(1,teamN/Math.max(2,teamGames.length/5)):0.25;
 const leftByRole=ROLES.map(role=>data.heroes.filter(x=>x.roles.includes(role)&&!used(s,key,data).some(id=>idx[id]?.family===x.family)&&!(s.excluded[key]||[]).includes(x.id)).length);
 const scarce=h.roles.some(role=>leftByRole[ROLES.indexOf(role)]<4);
 // Resource term is a small explicit heuristic; it does not model full series win probability.
 const reserve=scarce&&s.games.length<3?0.1:0.6;
 const parts={presence:presence*W.presence,win:smooth*W.win,fit:fit*W.fit,structure:structure*W.structure,relations:relation*W.relations,familiarity:familiarity*W.familiarity,reserve:reserve*W.reserve};
 if(isBan){parts.fit*=0.55;parts.structure*=0.55;}
 const rawValue=Object.values(parts).reduce((x,y)=>x+y,0);
 // Every benefit is conditional on the target actually being able to field this hero.
 // A popular marksman with its only lane occupied has zero ban value, not merely a small fit penalty.
 const value=rawValue*context.coverage;
 const reasons=[];
 if(st)reasons.push(`职业样本：${n}次选用 / ${num(st.ban_num)}次禁用`);else reasons.push('本赛事暂无出场样本，依赖机制先验');
 if(isBan){
  reasons.push(`针对对方待补${context.roles.join('/')}；位置适配${Math.round(context.coverage*100)}%`);
  const e=context.evidence;reasons.push(e.total?`职业分路：${Object.entries(e.all).map(([r,n])=>r+' '+n+'/'+e.total).join('，')}`:'分路样本不足，采用位置先验，需人工确认');
 }else{const best=Object.entries(h.abilities).sort((a,b)=>b[1]-a[1]).slice(0,2).map(([k])=>METRICS[k]);reasons.push(`补充${best.join('、')}；可分配${context.roles.join('/')}`);}
 if(links.length)reasons.splice(1,0,links[0].reason);
 if(teamN)reasons.push(`${team.name}在所选样本中使用${teamN}局`);
 const risk=context.inferred.lowConfidence||context.evidence.confidence==='prior'?'位置推断含小样本先验，需人工确认':n<8?'样本偏少，推荐稳定性有限':h.profile==='职业类型先验'?'能力来自类型先验，需教练复核':'能力评分为教练规则，尚未训练赛校准';
 return {hero:h.id,value,rawValue,parts,reasons,risk,links,n,smoothed:smooth,scarce,teamN,placement,roleCoverage:context.coverage,targetRoles:context.roles,roleEvidence:context.evidence};
}
function candidates(s,data,idx,t){
 return data.heroes.filter(h=>!legal(s,h.id,data,{idx})).map(h=>({h,context:roleContext(s,h,data,idx,t)})).filter(({context})=>context.coverage>=ROLE_POLICY.minimumShare).map(({h,context})=>score(s,h,data,idx,t,context)).sort((a,b)=>b.value-a.value||a.hero-b.hero);
}
function recommend(s,data,limit=3,options={}){
 const idx=index(data),t=turn(s,data);if(!t)return [];
 let list=candidates(s,data,idx,t);
 if(options.lookahead!==false){
  // One opponent decision plus our next available pick; retain explicit branches, not a solved game claim.
  for(const cand of list.slice(0,Math.max(limit,5))){let next=apply(s,cand.hero,data),nt=turn(next,data);cand.branch=[];let penalty=0;
   if(nt){const response=candidates(next,data,idx,nt).slice(0,2);
    for(const r of response){const ns=apply(next,r.hero,data);const last=turn(ns,data);let follow=null;if(last)follow=candidates(ns,data,idx,last)[0];cand.branch.push({hero:r.hero,camp:nt.camp,type:nt.type,nextHero:follow?.hero,nextCamp:last?.camp,nextType:last?.type});}
    if(nt.camp!==t.camp&&response.length)penalty=response[0].value*0.035;
   }cand.searchValue=cand.value-penalty;
  }
  list=list.slice(0,Math.max(limit,5)).sort((a,b)=>b.searchValue-a.searchValue);
 }
 return list.slice(0,limit);
}
function seriesStatus(s){const wins={A:0,B:0};s.games.forEach(g=>{if(g.winner)wins[g.winner]++;});return {...wins,complete:Math.max(wins.A,wins.B)>=Math.ceil(s.bo/2)};}
function finish(s,winner,data,options={}){if(turn(s,data))throw Error('请先完成全部禁选');if(!['A','B'].includes(winner))throw Error('请选择获胜方');if(!options.allowLegacyRoles){const idx=index(data);for(const camp of [1,2]){const check=lineupCheck(picks(s,camp,idx),s,data);if(!check.valid)throw Error((camp===1?'蓝方':'红方')+check.reason);}}const g={blueKey:s.blueKey,actions:s.actions.map(a=>({...a})),winner,note:s.note||''};return {...s,games:[...s.games,g],actions:[],note:''};}
function stateIssues(s,data){const idx=index(data),issues=[];for(const [i,g] of [...s.games,{actions:s.actions}].entries())for(const camp of [1,2]){const list=g.actions.filter(a=>a.type==='pick'&&a.camp===camp).map(a=>idx[a.hero]).filter(Boolean),check=lineupCheck(list,s,data);if(!check.valid)issues.push({game:i+1,camp,current:i===s.games.length,reason:check.reason});}return issues;}
function validate(s,data,options={}){
 if(!s||s.schema!==1||![1,5,7].includes(s.bo)||!['A','B'].includes(s.blueKey)||!Array.isArray(s.actions)||!Array.isArray(s.games)||s.games.length>s.bo||s.actions.length>20)throw Error('文件格式不正确');
 for(const k of ['teamA','teamB'])if(!s[k]||typeof s[k].id!=='string'||typeof s[k].name!=='string'||s[k].name.length>40)throw Error('队伍信息无效');
 if(s.teamA.id===s.teamB.id)throw Error('双方战队不能相同');
 if(typeof s.peak!=='boolean'||!['all','recent'].includes(s.window)||typeof s.note!=='string'||s.note.length>3000)throw Error('设置无效');
 const validIds=new Set(data.heroes.map(h=>h.id));if(!s.excluded||!['A','B'].every(k=>Array.isArray(s.excluded[k])&&s.excluded[k].length<=data.heroes.length&&s.excluded[k].every(id=>validIds.has(id))))throw Error('英雄池格式无效');
 let base={...s,games:[],actions:[]};
 for(const g of s.games){if(!['A','B'].includes(g.blueKey)||!['A','B'].includes(g.winner)||!Array.isArray(g.actions))throw Error('历史局格式无效');if(seriesStatus(base).complete)throw Error('系列赛已结束，存在多余历史局');base.blueKey=g.blueKey;for(const a of g.actions){const t=turn(base,data);if(!t||a.camp!==t.camp||a.type!==t.type)throw Error('历史禁选顺序无效');base=apply(base,a.hero,data,options);}base=finish(base,g.winner,data,options);}
 if(seriesStatus(base).complete&&s.actions.length)throw Error('系列赛已结束');base.blueKey=s.blueKey;
 for(const a of s.actions){const t=turn(base,data);if(!t||a.camp!==t.camp||a.type!==t.type)throw Error('当前禁选顺序无效');base=apply(base,a.hero,data,options);}
 return structuredClone({...s,importedAt:undefined});
}
G.BPEngine={ROLES,METRICS,W,ROLE_POLICY,initial,index,other,keyOf,isPeak,sequence,turn,used,picks,assign,roleEvidence,inferRoles,lineupCheck,stateIssues,roleContext,legal,apply,assess,sampleStats,sampleGames,pairEvidence,recommend,seriesStatus,finish,validate};
})(globalThis);
