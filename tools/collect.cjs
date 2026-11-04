const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'../.cache');fs.mkdirSync(root,{recursive:true});
async function get(u){const r=await fetch(u,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(r.status+' '+u);return Buffer.from(await r.arrayBuffer());}
async function json(name,u){const b=await get(u);const j=JSON.parse(b);fs.writeFileSync(path.join(root,name+'.json'),b);return j;}
async function pool(list,fn,n=4){let i=0;await Promise.all(Array.from({length:n},async()=>{while(i<list.length){const item=list[i++];try{await fn(item)}catch(e){console.log('Unresolved:',item.ename||item.battle_id,e.message)}}}));}
(async()=>{
 const base='https://prod.comp.smoba.qq.com/leaguesite/';
 const heroes=await json('heroes','https://pvp.qq.com/web201605/js/herolist.json');
 const matches=await json('matches',base+'matches/open?league_id=20260004');
 await json('stats',base+'league/hero/settle_list/open?league_id=20260004');
 fs.writeFileSync(root+'/newslist.json',JSON.stringify({data:{items:[]}}));
 fs.mkdirSync(root+'/battles',{recursive:true});fs.mkdirSync(root+'/hero-pages',{recursive:true});
 const list=matches.results.filter(m=>m.status===2).flatMap(m=>m.match_battle_video_list||[]);
 await pool(list,async b=>{const d=JSON.parse(await get(base+'battle/open?battle_id='+b.battle_id));if(d.code!==200)throw Error('Invalid battle');fs.writeFileSync(root+'/battles/'+b.battle_id+'.json',JSON.stringify(d));});
 await pool(heroes,async h=>{
  try{const b=await get('https://pvp.qq.com/web201605/herodetail/'+h.ename+'.shtml');const html=b.toString('utf8').includes('charset="gb')?new TextDecoder('gbk').decode(b):b.toString('utf8');fs.writeFileSync(root+'/hero-pages/'+h.ename+'.html',html);}catch{}
 });
 fs.copyFileSync(path.join(__dirname,'verified-version.json'),root+'/patch-findings.json');
 console.log('Downloaded to .cache. Review dates, version mapping, new heroes and BP integrity before compiling.');
})().catch(e=>{console.error(e.message);process.exit(1)});
