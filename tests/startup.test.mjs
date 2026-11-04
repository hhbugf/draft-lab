import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parse} from 'acorn';
const read=name=>fs.readFileSync(new URL('../dist/'+name,import.meta.url),'utf8');
function browser(options={}){
 const events={},nodes={},disk=new Map(options.saved?[['draftlab.state.v1',options.saved]]:[]),node=()=>({addEventListener(){},classList:{add(){},remove(){}},querySelectorAll(){return []},scrollTop:0});
 for(const id of ['app','import-file','toast','hero-grid','hero-search'])nodes[id]=node();
 const context={console,innerWidth:390,document:{activeElement:null,getElementById:id=>nodes[id]||(nodes[id]=node()),querySelector:s=>nodes[s.slice(1)]||null,addEventListener:(type,fn)=>{events['document:'+type]=fn;}},addEventListener:(type,fn)=>{events[type]=fn;},setTimeout:()=>1,clearTimeout(){}};
 context.window=context;
 if(!options.noMedia)context.matchMedia=()=>options.legacy?{matches:true,addListener(fn){events.media=fn;}}:{matches:true,addEventListener(type,fn){events.media=fn;}};
 if(options.storageDenied)Object.defineProperty(context,'localStorage',{get(){throw new Error('SecurityError: storage denied');}});
 else context.localStorage={getItem:key=>disk.get(key)||null,setItem(key,value){if(options.quota)throw new Error('QuotaExceededError');disk.set(key,String(value));},removeItem:key=>disk.delete(key)};
 vm.createContext(context);
 vm.runInContext('Array.prototype.at=undefined;Array.prototype.flatMap=undefined;Object.fromEntries=undefined;structuredClone=undefined;',context);
 vm.runInContext(read('runtime.js'),context,{filename:'runtime.js'});
 return {context,events,nodes,disk,start(){for(const file of ['data/snapshot.js','data/model.js','engine.js','discovery.js','analytics.js','insights.js','discovery-ui.js','mobile.js','app.js']){const served=options.compat&&!file.startsWith('data/')?'compat/'+file:file;vm.runInContext(read(served),context,{filename:served});}}};
}
test('older MediaQueryList.addListener browsers render and register a working viewport listener',()=>{
 const b=browser({legacy:true});assert.doesNotThrow(()=>b.start());assert.equal(typeof b.events.media,'function');assert.match(b.nodes.app.innerHTML,/BP工作台/);assert.equal(typeof b.context.BP_APP.getState,'function');
});
test('blocked localStorage getter does not blank the app and warns that records are temporary',()=>{
 const b=browser({storageDenied:true});assert.doesNotThrow(()=>b.start());assert.match(b.nodes.app.innerHTML,/本次记录仅暂存在此页面/);assert.equal(b.context.BPPlatform.storage.isPersistent(),false);
 b.context.BPPlatform.storage.setItem('example','private draft');assert.equal(b.context.BPPlatform.storage.getItem('example'),'private draft');
});
test('quota errors preserve old disk save while new edits remain exportable in page memory',()=>{
 const saved=fs.readFileSync(new URL('./fixtures/weak-professional-lineup.json',import.meta.url),'utf8'),b=browser({quota:true,saved});b.start();assert.equal(b.context.BP_APP.getState().actions.length,20);
 b.events['document:click']({target:{closest:()=>({disabled:false,dataset:{action:'undo'}})}});
 assert.equal(b.context.BP_APP.getState().actions.length,19);assert.equal(b.disk.get('draftlab.state.v1'),saved);assert.equal(JSON.parse(b.context.BPPlatform.storage.getItem('draftlab.state.v1')).actions.length,19);
});
test('missing matchMedia falls back to resize; clone/array/object helpers support BP data',()=>{
 const b=browser({noMedia:true});b.start();assert.equal(typeof b.events.resize,'function');
 assert.equal(vm.runInContext('[1,2,3].at(-1)',b.context),3);
 assert.equal(vm.runInContext('Object.fromEntries([["x",2]]).x',b.context),2);
 assert.equal(vm.runInContext('structuredClone({a:[1]}).a[0]',b.context),1);
});
test('startup script failures show recovery controls without erasing or uploading saved data',()=>{
 const b=browser({saved:'{"actions":[]}'});b.events.error({target:{tagName:'SCRIPT',src:'https://example.com/mobile.js?v=1'}});
 assert.match(b.nodes.app.innerHTML,/页面没有成功载入/);assert.match(b.nodes.app.innerHTML,/导出本机存档备份/);assert.match(b.nodes['boot-error-detail'].textContent,/mobile.js/);assert.equal(b.disk.get('draftlab.state.v1'),'{"actions":[]}');
});
test('critical font styles do not fetch an external stylesheet or font server',()=>{
 const css=read('styles.css');assert.ok(!/@import|fonts\.googleapis|fonts\.gstatic/.test(css));
 const sources=[...css.matchAll(/src:url\('([^']+)'\)/g)].map(m=>m[1]);assert.equal(sources.length,4);
 for(const source of sources){assert.ok(source.startsWith('fonts/'));assert.ok(fs.readFileSync(new URL('../dist/'+source,import.meta.url)).length>50000);}
});
test('every published script parses as ES2017, including lazily loaded catalog; bootstrap parses as ES5',()=>{
 assert.throws(()=>parse(read('engine.js'),{ecmaVersion:2017}),SyntaxError,'original source reproduces older-parser failure');
 const scripts=[...read('index.html').matchAll(/<script src="([^"?]+)/g)].map(m=>m[1]);
 for(const file of [...scripts,'data/discovery-data.js'])assert.doesNotThrow(()=>parse(read(file),{ecmaVersion:2017}),file);
 assert.equal(scripts.filter(x=>x.startsWith('compat/')).length,7);
 assert.doesNotThrow(()=>parse(read('runtime.js'),{ecmaVersion:5}));
});
test('published compatible modules retain identical recommendations, selection, lock, undo and local save',()=>{
 const source=browser({legacy:true}),served=browser({compat:true,legacy:true});source.start();served.start();
 const score=b=>JSON.stringify(b.context.BPEngine.recommend(b.context.BP_APP.getState(),b.context.BP_DATA));
 assert.equal(score(served),score(source));
 const E=served.context.BPEngine,D=served.context.BP_DATA,id=D.heroes.find(h=>!E.legal(served.context.BP_APP.getState(),h.id,D)).id;
 const click=dataset=>served.events['document:click']({target:{closest:()=>({disabled:false,dataset})}});
 click({hero:String(id)});assert.equal(served.context.BP_APP.getState().actions.length,0);
 click({lock:String(id)});assert.equal(served.context.BP_APP.getState().actions[0].hero,id);
 assert.equal(JSON.parse(served.disk.get('draftlab.state.v1')).actions.length,1);
 click({action:'undo'});assert.equal(served.context.BP_APP.getState().actions.length,0);
 assert.equal(JSON.parse(served.disk.get('draftlab.state.v1')).actions.length,0);
 assert.equal(vm.runInContext('JSON.stringify([1,,2].flatMap(function(x){return [x,x+1]}))',served.context),'[1,2,2,3]');
});
test('FileReader fallback imports text when older webview files lack Blob.text',async()=>{
 const b=browser();b.context.FileReader=function(){this.readAsText=function(file,encoding){assert.equal(encoding,'UTF-8');this.result=file.raw;this.onload();};};
 assert.equal(await b.context.BPPlatform.readFile({raw:'{"actions":[]}'}),'{"actions":[]}');
 assert.equal(await b.context.BPPlatform.readFile({text:()=>Promise.resolve('modern')}),'modern');
});
