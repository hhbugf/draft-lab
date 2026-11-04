import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {transformSync} from 'esbuild';
const dist=new URL('../dist/',import.meta.url),offline=new URL('../build/DRAFT-LAB-Demo.html',import.meta.url);
const read=file=>fs.readFileSync(new URL(file,dist),'utf8'),exists=fs.existsSync(offline);
const html=exists?fs.readFileSync(offline,'utf8'):'';
const styles=[...html.matchAll(/<style data-bp-source="([^"]+)">([\s\S]*?)<\/style>/g)];
const scripts=[...html.matchAll(/<script data-bp-source="([^"]+)">([\s\S]*?)<\/script>/g)];
test('shared styles parse without warnings and retain the original dark theme',()=>{
 for(const file of ['styles.css','mobile.css'])assert.deepEqual(transformSync(read(file),{loader:'css',logLevel:'silent'}).warnings,[],file);
 assert.match(read('styles.css'),/:root\{--bg:#0a1018;--panel:#101923/);
 assert.match(read('styles.css'),/body\{[^}]*background:var\(--bg\);color:var\(--text\)/);
 assert.ok(!read('styles.css').includes('family=Noto+Sans'));
});
test('offline styles are exactly the same shared styles; every embedded font has identical bytes',{skip:!exists},()=>{
 assert.equal(styles.length,2);
 const fonts=fs.readdirSync(new URL('fonts/',dist)).filter(x=>x.endsWith('.ttf'));
 for(const [,name,embedded] of styles){
  let normalized=embedded;
  for(const font of fonts){const base64=fs.readFileSync(new URL('fonts/'+font,dist)).toString('base64');normalized=normalized.replace('url(data:font/ttf;base64,'+base64+')',"url('fonts/"+font+"')");}
  assert.equal(normalized,read(name),name+' differs from the online source');
  assert.deepEqual(transformSync(embedded,{loader:'css',logLevel:'silent'}).warnings,[]);
 }
 assert.equal((styles[0][2].match(/data:font\/ttf;base64,/g)||[]).length,4);
});
test('offline application modules are unmodified shared web modules; snapshot keeps identical public records',{skip:!exists},()=>{
 const sourceOrder=[...read('index.html').matchAll(/<script src="([^"?]+)/g)].map(x=>x[1]);
 sourceOrder.splice(sourceOrder.indexOf('compat/analytics.js'),0,'data/discovery-data.js');
 assert.deepEqual(scripts.map(x=>x[1]),sourceOrder);
 for(const [,name,code] of scripts){
  new vm.Script(code);
  if(name!=='data/snapshot.js')assert.equal(code,read(name).replace(/<\/script/gi,'<\\/script'),name);
 }
 const context={window:{}};vm.runInNewContext(scripts.find(x=>x[1]==='data/snapshot.js')[2],context);
 const original=JSON.parse(read('data/snapshot.json')),embedded=JSON.parse(JSON.stringify(context.window.BP_DATA));
 assert.deepEqual(embedded.games,original.games);assert.deepEqual(embedded.meta,original.meta);
 for(let i=0;i<original.heroes.length;i++){
  const expected=original.heroes[i],actual=embedded.heroes[i];
  assert.equal(actual.image,'data:image/svg+xml;base64,'+fs.readFileSync(new URL('assets/hero-placeholder.svg',dist)).toString('base64'));
  actual.image=expected.image;assert.deepEqual(actual,expected);
 }
});
