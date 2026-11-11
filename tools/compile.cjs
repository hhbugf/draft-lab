const fs=require('fs'),path=require('path');
const existing=path.resolve(__dirname,'../dist/data/snapshot.json');
if(fs.existsSync(existing)&&JSON.parse(fs.readFileSync(existing,'utf8')).meta.checkedThrough>'2026-10-20')throw Error('Legacy full compiler uses 2026-10-20 hero/patch assumptions. Use tools/update-matches.cjs --as-of YYYY-MM-DD for reviewed match refreshes; do not overwrite a newer snapshot with legacy labels.');
const root=path.resolve(__dirname,'../.cache'),out=path.resolve(__dirname,'../dist/data');
fs.mkdirSync(out,{recursive:true});
const raw=JSON.parse(fs.readFileSync(root+'/heroes.json','utf8'));
const stats=JSON.parse(fs.readFileSync(root+'/stats.json','utf8')).data;
const matches=JSON.parse(fs.readFileSync(root+'/matches.json','utf8')).results;
const roleMap={1:'对抗路',2:'打野',3:'中路',4:'发育路',5:'游走'};
const roles=['对抗路','打野','中路','发育路','游走'];
const clean=s=>s.replace(/<[^>]+>/g,'').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').trim();
const steps='1b 2b 1b 2b 1p 2p 2p 1p 1p 2p 2b 1b 2b 1b 2b 1b 2p 1p 1p 2p'.split(' ').map(s=>({camp:Number(s[0]),type:s[1]==='b'?'ban':'pick'}));
const matchesById=Object.fromEntries(matches.map(m=>[m.match_id,m]));
const games=[];
for(const m of matches.filter(m=>m.status===2))for(const br of m.match_battle_video_list||[]){
 const f=root+'/battles/'+br.battle_id+'.json';if(!fs.existsSync(f))continue;
 const d=JSON.parse(fs.readFileSync(f,'utf8')).data;
 const actions=d.bp_list.map(a=>({camp:a.camp,type:a.is_ban_or_pick===0?'ban':'pick',hero:a.hero_id}));
 const valid=actions.length===20&&actions.every((a,i)=>a.camp===steps[i].camp&&a.type===steps[i].type);
 games.push({id:d.battle_id,matchId:m.match_id,seq:d.battle_seq,date:m.start_time,bo:m.bo,stage:m.match_stage_desc,winCamp:d.win_camp,duration:d.game_duration/1000,blue:{id:d.camp1.team_id,name:d.camp1.team_name},red:{id:d.camp2.team_id,name:d.camp2.team_name},actions,sequenceValid:valid,players:d.battle_player_list.map(p=>({hero:p.hero_id,camp:p.camp,teamId:p.team_id,name:p.player_name,role:p.position_desc,k:p.kill_num,d:p.death_num,a:p.assist_num,gold:p.gold,damage:p.hurt_to_hero_total,tank:p.be_hurt_by_hero_total})),video:br.video_list?.[0]?.video_url||d.video_list?.[0]?.video_url||null,source:'https://prod.comp.smoba.qq.com/leaguesite/battle/open?battle_id='+d.battle_id});
}
games.sort((a,b)=>a.date.localeCompare(b.date)||a.seq-b.seq);
for(const g of games)g.replayable=g.sequenceValid&&!games.some(p=>p.matchId===g.matchId&&p.seq<g.seq&&!p.sequenceValid);
const heroStats={};for(const s of stats)heroStats[s.hero_info.hero_id]={...s.statistics_info,...s.bp_statistics_info};
const observed={};for(const g of games)for(const p of g.players){observed[p.hero]??={};observed[p.hero][p.role]=(observed[p.hero][p.role]||0)+1;}
const manual={
 '鲁班大师':{engage:5,peel:5,tank:4,control:5},'盾山':{engage:4,peel:5,tank:5,control:4},'张飞':{engage:4,peel:5,tank:5,control:4},'牛魔':{engage:5,peel:4,tank:5,control:5},'廉颇':{engage:5,peel:3,tank:5,control:5},'苏烈':{engage:5,peel:4,tank:5,control:5},'白起':{engage:5,peel:3,tank:5,control:5},'东皇太一':{engage:3,peel:5,tank:4,control:5},'钟馗':{engage:5,peel:3,tank:3,control:5},'大乔':{engage:2,peel:4,macro:5,wave:3},'孙膑':{engage:2,peel:4,macro:5,control:3},'太乙真人':{engage:4,peel:5,tank:3},'蔡文姬':{engage:1,peel:5,tank:2},'瑶':{engage:1,peel:4,tank:1},'庄周':{engage:1,peel:5,tank:3},
 '海月':{wave:5,control:4,engage:3,burst:5},'沈梦溪':{wave:5,poke:5,macro:4,burst:4},'女娲':{wave:5,poke:5,macro:5,control:4},'弈星':{wave:4,engage:4,control:5,peel:4},'王昭君':{wave:5,control:5,peel:4},'嬴政':{wave:5,poke:5,dps:4},'周瑜':{wave:5,push:5,control:3},'不知火舞':{wave:2,engage:4,burst:5,control:4},'西施':{wave:4,engage:4,control:5},'张良':{wave:4,control:5,peel:5},'干将莫邪':{wave:5,poke:5,burst:5},
 '关羽':{wave:4,split:5,engage:5,macro:5,control:5},'马超':{wave:4,split:5,macro:5,dps:4},'夏洛特':{wave:4,split:4,tank:3,dps:4},'老夫子':{split:5,push:5,control:4,dps:4},'姬小满':{burst:4,control:4,split:4},'夏侯惇':{tank:5,control:4,engage:4},'猪八戒':{tank:5,control:4,engage:4},'吕布':{tank:4,engage:4,control:4,dps:4},'司空震':{dps:5,wave:4,split:4},'杨戬':{wave:4,burst:4,split:4},
 '赵云':{engage:4,control:4,burst:4,tank:3},'镜':{burst:5,macro:4,engage:3},'澜':{burst:5,engage:4,macro:4},'大司命':{dps:5,tank:4,macro:4},'铠':{tank:4,dps:4,burst:4},'裴擒虎':{macro:5,push:4,dps:4},'阿古朵':{macro:4,push:4,peel:3},'兰陵王':{burst:5,macro:4,engage:4},'宫本武藏':{engage:4,burst:4,control:4},
 '戈娅':{dps:5,control:3,peel:2},'敖隐':{burst:4,dps:4,peel:3},'公孙离':{dps:5,split:3,burst:3},'马可波罗':{dps:5,poke:4},'狄仁杰':{dps:5,wave:4,control:3},'孙尚香':{burst:5,dps:4,push:4},'鲁班七号':{dps:5,push:5},'黄忠':{dps:5,push:5,wave:4},'虞姬':{burst:4,dps:4},'百里守约':{poke:5,wave:4},'伽罗':{dps:5,push:4},
};
const baseline={1:{engage:2,peel:1,tank:3,control:2,wave:3,split:3,dps:3,burst:3,poke:1,macro:2,push:3},2:{engage:1,peel:2,tank:1,control:3,wave:4,split:1,dps:2,burst:4,poke:3,macro:2,push:2},3:{engage:4,peel:3,tank:5,control:4,wave:3,split:2,dps:1,burst:2,poke:1,macro:2,push:2},4:{engage:3,peel:1,tank:1,control:2,wave:3,split:3,dps:3,burst:5,poke:1,macro:4,push:3},5:{engage:1,peel:1,tank:1,control:1,wave:3,split:2,dps:5,burst:2,poke:3,macro:2,push:4},6:{engage:2,peel:4,tank:2,control:3,wave:1,split:1,dps:1,burst:1,poke:2,macro:3,push:1}};
const heroes=raw.map(h=>{
 const file=root+'/hero-pages/'+h.ename+'.html';const html=fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
 const skills=[...html.matchAll(/<p class="skill-name"><b>(.*?)<\/b>(.*?)<\/p>\s*<p class="skill-desc">([\s\S]*?)<\/p>/g)].filter(m=>clean(m[1])).map(m=>({name:clean(m[1]),description:clean(m[3])}));
 const text=skills.map(s=>s.description).join('');const abilities={...baseline[h.hero_type],...manual[h.cname]};
 // Mechanism extraction supplements class priors; every numeric capability is explicitly a coach heuristic.
 if(/压制|击飞|眩晕|嘲讽|击退|冰冻|冻结|拉回/.test(text))abilities.control=Math.max(abilities.control,3);
 if(/护盾|治疗|友方.*回复|友方.*恢复/.test(text))abilities.peel=Math.max(abilities.peel,3);
 const knownRoles=h.cname==='王维'?['中路']:(h.roles||'').split('|').map(r=>roleMap[r]).filter(Boolean);
 const obs=observed[h.ename]||{};
 const usable=Object.entries(obs).filter(([r,n])=>roles.includes(r)&&n>=1).sort((a,b)=>b[1]-a[1]).map(([r])=>r);
 const damage=['艾琳','芈月','露娜','司马懿','司空震'].includes(h.cname)?'法术':['梦奇','嬴政'].includes(h.cname)?'混合':/真实伤害/.test(text)?'混合/真实':h.hero_type===2?'法术':h.hero_type===6?'功能为主/待复核':'物理为主';
 return {id:h.ename,name:h.cname,pinyin:h.id_name||'',title:h.title,release:h.time||null,family:h.cname.startsWith('元流之子')?'yuanliu':String(h.ename),types:[h.hero_type,h.hero_type2].filter(Boolean),officialRoles:knownRoles,roles:[...new Set([...usable,...knownRoles])],observedRoles:obs,abilities,profile:manual[h.cname]?'教练规则标注':'职业类型先验',damage,mechanics:[...new Set((text.match(/压制|击飞|眩晕|嘲讽|击退|沉默|减速|护盾|霸体|无法选中|真实伤害|传送|治疗|隐身|视野/g)||[]))],skills:skills.map(s=>({name:s.name,mechanics:[...new Set(s.description.match(/压制|击飞|眩晕|嘲讽|击退|沉默|减速|护盾|霸体|无法选中|真实伤害|传送|治疗|隐身|视野/g)||[])]})),stats:heroStats[h.ename]||null,source:html?'https://pvp.qq.com/web201605/herodetail/'+h.ename+'.shtml':(h.m_bl_link?.startsWith('//')?'https:'+h.m_bl_link:h.m_bl_link)||'https://pvp.qq.com/web201605/herolist.shtml',image:'assets/heroes/'+h.ename+'.jpg'};
});
const corrected=heroes.find(h=>h.id===547);if(corrected){corrected.legacyRoles=[...corrected.roles];corrected.rawOfficialRoles=[...corrected.officialRoles];corrected.officialRoles=['发育路'];corrected.roles=['发育路'];corrected.roleCorrection={"verifiedAt":"2026-10-20","roles":["发育路"],"reason":"原始roles字段与射手职业及9次职业比赛的实际发育路记录冲突，规范化后仅采用已核实的发育路；原始值单独保留。","source":"https://pvp.qq.com/ingame/all/tobe/newheros/luyana.html","matchCount":9};}
const teams=[...new Map(games.flatMap(g=>[g.blue,g.red]).map(t=>[t.id,t])).values()];
const relationships=[
 ['鲁班大师','鲁班七号','synergy','提供位移交互，改善无位移射手的位置调整','需要队友及时交互，连接不能替代视野'],
 ['鲁班大师','黄忠','synergy','帮助固定阵地输出核心调整位置','需协调架炮与位移时机'],
 ['牛魔','马可波罗','synergy','范围控制为射手进场提供窗口','需先确认敌方反手技能与输出位置'],
 ['鬼谷子','高渐离','synergy','聚拢敌人后衔接范围输出','依赖进场空间和控制命中'],
 ['大乔','老夫子','synergy','单带牵制与回转支援形成运营思路','需确认当前回城机制和队伍沟通执行'],
 ['孙膑','白起','synergy','加速与回复窗口帮助前排接近和持续作战','依赖血量管理和团战时机'],
 ['弈星','吕布','synergy','限制战场空间，帮助范围技能落点衔接','需避免重复交出关键控制'],
 ['张飞','鲁班七号','synergy','保护与反手为持续输出争取空间','保护技能不能过早交出'],
 ['庄周','白起','counter','解控机制可缓解范围控制压力','需要核验控制类型与解控覆盖窗口'],
 ['张良','公孙离','counter','压制机制限制灵活英雄的操作窗口','需要施法距离和队友保护，非整局必胜'],
 ['东皇太一','镜','counter','压制可约束近身切入窗口','需要接近目标，不能忽略敌方远程消耗'],
 ['盾山','嬴政','counter','阻挡机制可限制部分飞行物输出','受攻击类型、站位和打断技能影响'],
 ['盾山','干将莫邪','counter','阻挡机制可限制飞行物消耗','需核验当前技能交互，留意绕侧和打断'],
 ['宫本武藏','蔡文姬','counter','限制回复窗口，影响依赖治疗的团战','需命中关键目标，不能等同于全面克制'],
].map(([a,b,type,reason,condition])=>({a:heroes.find(h=>h.name===a)?.id,b:heroes.find(h=>h.name===b)?.id,type,reason,condition,evidence:'教练机制假设，待训练赛校准'})).filter(x=>x.a&&x.b);
const news=JSON.parse(fs.readFileSync(root+'/newslist.json','utf8')).data.items.filter(x=>!x.sTitle.includes('体验服')&&!x.sTitle.includes('抢先服')).map(x=>({id:x.iId,title:x.sTitle,date:x.sIdxTime,url:'https://pvp.qq.com/web201706/newsdetail.shtml?tid='+x.iId,version:x.sGameVersion||null}));
const meta={generatedAt:new Date().toISOString(),clientDate:'2026-10-20',season:'S45 · 月照长安',patch:'2026-10-15 正式服更新',league:'2026年KPL年度总决赛',leagueId:'20260004',gameCount:games.length,heroCount:heroes.length,statsCount:stats.length,latestMatch:games.at(-1)?.date,earliestMatch:games[0]?.date,matchVersionVerified:false,ruleSource:'https://pvp.qq.com/web201706/newsdetail.shtml?tid=808728',steps,roles,sourceNote:'官方赛事聚合样本跨比赛日期；接口未提供比赛服版本字段。正式服S45与赛事服同步状态未确认，不能将跨日期统计解释为10月15日更新后的独立胜率。',sources:[{name:'官方英雄列表',url:'https://pvp.qq.com/web201605/js/herolist.json',kind:'官方公开JSON',count:heroes.length},{name:'官方年度总决赛英雄统计',url:'https://prod.comp.smoba.qq.com/leaguesite/league/hero/settle_list/open?league_id=20260004',kind:'官网赛事数据中心引用接口',count:stats.length},{name:'官方年度总决赛赛程',url:'https://prod.comp.smoba.qq.com/leaguesite/matches/open?league_id=20260004',kind:'官网赛事数据中心引用接口',count:matches.length},{name:'官方赛事数据中心',url:'https://pvp.qq.com/matchdata/',kind:'数据入口'},{name:'2026年度总决赛官方规则',url:'https://pvp.qq.com/web201706/newsdetail.shtml?tid=808728',kind:'赛事规则'}]};
const patches=JSON.parse(fs.readFileSync(root+'/patch-findings.json','utf8'));
const data={meta,heroes,teams,games,relationships,news,patches};
fs.writeFileSync(out+'/snapshot.json',JSON.stringify(data));
fs.writeFileSync(out+'/snapshot.js','window.BP_DATA = '+JSON.stringify({...data,heroes:data.heroes.map(h=>({...h,image:'assets/hero-placeholder.svg'}))})+';\n');
console.log(JSON.stringify({heroes:heroes.length,skills:heroes.filter(h=>h.skills.length).length,profiles:heroes.filter(h=>h.profile==='教练规则标注').length,games:games.length,validSequences:games.filter(g=>g.sequenceValid).length,stats:stats.length,teams:teams.length,latest:meta.latestMatch,bytes:fs.statSync(out+'/snapshot.json').size}));
