import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import '../dist/data/model.js';
import '../dist/engine.js';
import '../dist/discovery.js';
import '../dist/data/discovery-data.js';
import '../dist/analytics.js';
const D=JSON.parse(fs.readFileSync(new URL('../dist/data/snapshot.json',import.meta.url))),E=globalThis.BPEngine;
test('draft recommendations remain legal before on-demand catalog arrives; no synchronous mining',()=>{
 const catalog=globalThis.BP_DISCOVERY,get=globalThis.BPDiscovery.get;delete globalThis.BP_DISCOVERY;
 globalThis.BPDiscovery.get=()=>{throw new Error('must not synchronously enumerate the catalog at boot');};
 try{const s=E.initial(D),rs=E.recommend(s,D);assert.equal(rs.length,3);for(const r of rs)assert.equal(E.legal(s,r.hero,D),null);}
 finally{globalThis.BP_DISCOVERY=catalog;globalThis.BPDiscovery.get=get;}
});
test('offline deliverable embeds responsive assets and all scripts compile without network imports',{skip:!fs.existsSync(new URL('../build/DRAFT-LAB-Demo.html',import.meta.url))},()=>{
 const html=fs.readFileSync(new URL('../build/DRAFT-LAB-Demo.html',import.meta.url),'utf8');
 assert.ok(!/<script[^>]+src=/.test(html));assert.ok(!/<link[^>]+rel="stylesheet"/.test(html));
 const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];assert.ok(scripts.length>=10);
 for(const [,source] of scripts)new vm.Script(source);
 assert.ok(/G\.BPMobile\s*=/.test(html)&&html.includes('globalThis.BP_DISCOVERY='));
});
