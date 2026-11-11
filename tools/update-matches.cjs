const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),base='https://prod.comp.smoba.qq.com/leaguesite/';
const args=process.argv.slice(2),asOf=args[args.indexOf('--as-of')+1];
if(!args.includes('--as-of')||!/^\d{4}-\d{2}-\d{2}$/.test(asOf))throw Error('Usage: node tools/update-matches.cjs --as-of YYYY-MM-DD [--download-only]');
const cache=path.join(root,'.cache','updates',asOf);fs.mkdirSync(path.join(cache,'battles'),{recursive:true});
const D=JSON.parse(fs.readFileSync(path.join(root,'dist/data/snapshot.json'),'utf8'));
async function get(name,url){
 if(args.includes('--from-cache'))return JSON.parse(fs.readFileSync(path.join(cache,name),'utf8'));
 let last;for(let attempt=0;attempt<3;attempt++)try{
  const r=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('HTTP '+r.status);
  const bytes=Buffer.from(await r.arrayBuffer()),j=JSON.parse(bytes);fs.writeFileSync(path.join(cache,name),bytes);return j;
 }catch(e){last=e;}
 throw Error('Official data unavailable: '+url+' ('+last.message+')');
}
async function run(){
 const [schedule,aggregate,roster]=await Promise.all([
  get('matches.json',base+'matches/open?league_id='+D.meta.leagueId),
  get('stats.json',base+'league/hero/settle_list/open?league_id='+D.meta.leagueId),
  get('heroes.json','https://pvp.qq.com/web201605/js/herolist.json')
 ]);
 if(schedule.code!==200||aggregate.code!==200||!Array.isArray(schedule.results)||!Array.isArray(aggregate.data)||!Array.isArray(roster))throw Error('Unexpected official response schema');
 const known=new Set(D.heroes.map(h=>h.id));
 const matches=schedule.results.filter(m=>m.status===2&&m.start_time.slice(0,10)<=asOf);
 const list=matches.flatMap(m=>(m.match_battle_video_list||[]).map(b=>({m,b})));
 if(new Set(list.map(x=>x.b.battle_id)).size!==list.length)throw Error('Duplicate scheduled battle IDs');
 let cursor=0,done=0;const errors=[];
 await Promise.all(Array.from({length:4},async()=>{while(cursor<list.length){const {b}=list[cursor++];try{
  const d=await get('battles/'+b.battle_id+'.json',base+'battle/open?battle_id='+b.battle_id);
  if(d.code!==200||d.data?.battle_id!==b.battle_id)throw Error('Invalid battle payload');
  done++;if(done%40===0)console.log('Official battles downloaded: '+done+'/'+list.length);
 }catch(e){errors.push(e.message);}}}));
 if(errors.length)throw Error(errors.join('\n'));
 const stats=Object.fromEntries(aggregate.data.map(s=>[s.hero_info.hero_id,{...s.statistics_info,...s.bp_statistics_info}]));
 const games=[];
 for(const {m,b} of list){
  const d=JSON.parse(fs.readFileSync(path.join(cache,'battles/'+b.battle_id+'.json'),'utf8')).data;
  if(d.status!==2||![1,2].includes(d.win_camp)||d.battle_seq!==b.battle_seq)throw Error('Unfinished/inconsistent battle '+b.battle_id);
  const actions=d.bp_list.map(a=>({camp:a.camp,type:a.is_ban_or_pick===0?'ban':'pick',hero:a.hero_id}));
  const blind=m.bo===7&&d.battle_seq===7;
  const valid=!blind&&actions.length===D.meta.steps.length&&actions.every((a,i)=>a.camp===D.meta.steps[i].camp&&a.type===D.meta.steps[i].type);
  const players=d.battle_player_list.map(p=>({hero:p.hero_id,camp:p.camp,teamId:p.team_id,name:p.player_name,role:p.position_desc,k:p.kill_num,d:p.death_num,a:p.assist_num,gold:p.gold,damage:p.hurt_to_hero_total,tank:p.be_hurt_by_hero_total}));
  if(players.length!==10||players.some(p=>!known.has(p.hero))||actions.some(a=>!known.has(a.hero)))throw Error('Missing hero definitions or incomplete players: '+b.battle_id);
  const roleIssues=[];
  for(const camp of [1,2]){
   const side=players.filter(p=>p.camp===camp);
   if(side.length!==5||new Set(side.map(p=>p.hero)).size!==5)throw Error('Invalid player record '+b.battle_id);
   if(new Set(side.map(p=>p.role)).size!==5||side.some(p=>!D.meta.roles.includes(p.role)))roleIssues.push({camp,reason:'官方选手分路标签未形成五个独立位置；保留原始标签，不把该侧用于分路推断。'});
   if(!blind&&actions.filter(a=>a.camp===camp&&a.type==='pick').some(a=>!side.some(p=>p.hero===a.hero)))throw Error('BP and lineup disagree '+b.battle_id);
  }
  games.push({id:d.battle_id,matchId:m.match_id,seq:d.battle_seq,date:m.start_time,bo:m.bo,stage:m.match_stage_desc,winCamp:d.win_camp,duration:d.game_duration/1000,blue:{id:d.camp1.team_id,name:d.camp1.team_name},red:{id:d.camp2.team_id,name:d.camp2.team_name},actions,sequenceValid:valid,draftMode:blind?'blind':'standard',roleIssues,players,video:b.video_list?.[0]?.video_url||d.video_list?.[0]?.video_url||null,source:base+'battle/open?battle_id='+d.battle_id});
 }
 games.sort((a,b)=>a.date.localeCompare(b.date)||a.matchId.localeCompare(b.matchId)||a.seq-b.seq);
 for(const m of matches){
  const gs=games.filter(g=>g.matchId===m.match_id);
  if(gs.length!==Number(m.camp1.score)+Number(m.camp2.score)||gs.some((g,i)=>g.seq!==i+1))throw Error('Series game count/gaps '+m.match_id);
  for(const camp of [1,2]){const tid=m['camp'+camp].team_id,w=gs.filter(g=>(g.winCamp===1?g.blue:g.red).id===tid).length;if(w!==m['camp'+camp].score)throw Error('Series results disagree '+m.match_id);}
 }
 for(const g of games)g.replayable=g.sequenceValid&&!games.some(p=>p.matchId===g.matchId&&p.seq<g.seq&&!p.sequenceValid);
 const officialPickTotal=Object.values(stats).reduce((n,s)=>n+(s.pick_num||0),0);
 const actualPickTotal=games.reduce((n,g)=>n+g.players.length,0);
 const officialBattleTotal=Object.values(stats).reduce((n,s)=>n+(s.battle_count||0),0);
 const differences=[];
 const normalized={};let uniquePickTotal=0;
 for(const h of D.heroes){
  const ps=games.flatMap(g=>g.players.filter(p=>p.hero===h.id).map(p=>({g,p}))),bans=games.reduce((n,g)=>n+g.actions.filter(a=>a.type==='ban'&&a.hero===h.id).length,0),w=ps.filter(({g,p})=>g.winCamp===p.camp).length,s=stats[h.id],uniqueGames=new Set(ps.map(x=>x.g.id)).size;
  uniquePickTotal+=uniqueGames;
  // Official BP pick_num counts games containing a hero, while battle_count counts
  // side appearances. Blind mirror picks add two appearances but only one BP pick.
  // The aggregate endpoint omits heroes that were banned but never played.
  if(s&&(s.pick_num!==uniqueGames||s.battle_count!==ps.length||s.victory_battle_count!==w||s.ban_num!==bans)||!s&&ps.length)differences.push({id:h.id,name:h.name,actual:[uniqueGames,ps.length,w,bans],official:[s?.pick_num||0,s?.battle_count||0,s?.victory_battle_count||0,s?.ban_num||0]});
  normalized[h.id]=ps.length||bans?{...s,pick_num:ps.length,battle_count:ps.length,victory_battle_count:w,defeated_battle_count:ps.length-w,win_rate:ps.length?w/ps.length:0,pick_rate:uniqueGames/games.length,ban_num:bans,ban_rate:bans/games.length,pick_game_count:uniqueGames}:null;
 }
 const report={checkedThrough:asOf,checkedAt:new Date().toISOString(),previousGames:D.games.length,games:games.length,series:matches.length,latestMatch:games.at(-1)?.date,standardGames:games.filter(g=>g.draftMode==='standard').length,blindGames:games.filter(g=>g.draftMode==='blind').length,validSequences:games.filter(g=>g.sequenceValid).length,replayable:games.filter(g=>g.replayable).length,officialPickTotal,uniquePickTotal,officialBattleTotal,actualPickTotal,aggregateDifferences:differences,roleIssues:games.filter(g=>g.roleIssues.length).map(g=>({id:g.id,issues:g.roleIssues})),rosterNew:roster.filter(h=>!known.has(h.ename)).map(h=>({id:h.ename,name:h.cname})),futureMatches:schedule.results.filter(m=>m.start_time.slice(0,10)>asOf).map(m=>({id:m.match_id,date:m.start_time,status:m.status})),sources:{schedule:base+'matches/open?league_id='+D.meta.leagueId,aggregate:base+'league/hero/settle_list/open?league_id='+D.meta.leagueId}};
 fs.writeFileSync(path.join(cache,'audit.json'),JSON.stringify(report,null,2));
 fs.writeFileSync(path.join(cache,'compiled-games.json'),JSON.stringify(games));
 console.log(JSON.stringify(report,null,2));
 if(args.includes('--download-only'))return;
 if(differences.length||officialPickTotal!==uniquePickTotal||officialBattleTotal!==actualPickTotal)throw Error('Official aggregate and downloaded game facts differ; review audit.json before replacing snapshot');
 for(const h of D.heroes){h.officialStats=stats[h.id]||null;h.stats=normalized[h.id];h.observedRoles={};for(const g of games)for(const p of g.players)if(p.hero===h.id&&!g.roleIssues.some(x=>x.camp===p.camp))h.observedRoles[p.role]=(h.observedRoles[p.role]||0)+1;h.roles=[...new Set([...h.officialRoles,...Object.keys(h.observedRoles)])];}
 D.games=games;D.teams=[...new Map(games.flatMap(g=>[g.blue,g.red]).map(t=>[t.id,t])).values()];
 Object.assign(D.meta,{generatedAt:new Date().toISOString(),clientDate:asOf,gameCount:games.length,heroCount:D.heroes.length,statsCount:aggregate.data.length,latestMatch:games.at(-1)?.date,earliestMatch:games[0]?.date,checkedThrough:asOf,seriesCount:matches.length,standardGameCount:report.standardGames,blindGameCount:report.blindGames,sequenceValidCount:report.validSequences,replayableCount:report.replayable,heroProfilesVerifiedAt:D.meta.heroProfilesVerifiedAt||'2026-10-20',dataRefresh:{previousGames:report.previousGames,addedGames:games.length-report.previousGames,verifiedAgainstOfficialAggregate:true,blindPolicy:'巅峰对决按选手记录保留双方最终阵容；官方bp_list可能遗漏镜像英雄且无真实公开选取先后，不补造BP动作，不进入时序/普通BP概率训练。'}});
 D.meta.statisticsPolicy='选用次数/胜负按单方出场统计，巅峰镜像双方各计一次；选用率按含该英雄的比赛数/总局数，镜像单局仅计一次。官方汇总原值另存officialStats；仅被禁用而未出场的英雄从逐局BP补入。分路标签冲突侧不用于分路推断。';
 for(const s of D.meta.sources){if(s.url===report.sources.schedule)s.count=schedule.results.length;if(s.url===report.sources.aggregate)s.count=aggregate.data.length;}
 const json=JSON.stringify(D);fs.writeFileSync(path.join(root,'dist/data/snapshot.json'),json);
 const view=JSON.parse(json);if(fs.existsSync(path.join(root,'dist/assets/hero-placeholder.svg')))for(const h of view.heroes)h.image='assets/hero-placeholder.svg';
 fs.writeFileSync(path.join(root,'dist/data/snapshot.js'),'window.BP_DATA = '+JSON.stringify(view)+';\n');
 console.log('Snapshot replaced after official aggregate reconciliation. SHA256 '+crypto.createHash('sha256').update(json).digest('hex'));
}
run().catch(e=>{console.error(e.message);process.exitCode=1;});
