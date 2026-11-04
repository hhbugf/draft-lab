/* Startup compatibility and local-only recovery. Keep ES5 syntax here. */
(function(g){
'use strict';
if(!g.globalThis)g.globalThis=g;
if(!g.structuredClone)g.structuredClone=function(value){return JSON.parse(JSON.stringify(value));};
if(!Array.prototype.at)Object.defineProperty(Array.prototype,'at',{configurable:true,writable:true,value:function(index){var n=Number(index)||0;n=n<0?Math.ceil(n):Math.floor(n);if(n<0)n+=this.length;return n<0||n>=this.length?undefined:this[n];}});
if(!Object.fromEntries)Object.fromEntries=function(entries){var result={};Array.from(entries).forEach(function(pair){Object.defineProperty(result,pair[0],{value:pair[1],enumerable:true,configurable:true,writable:true});});return result;};
// The app flattens ordinary arrays of games/players; older webviews lack flatMap.
if(!Array.prototype.flatMap)Object.defineProperty(Array.prototype,'flatMap',{configurable:true,writable:true,value:function(callback,thisArg){if(this==null||typeof callback!=='function')throw new TypeError('Invalid flatMap input');var source=Object(this),length=Math.min(Math.max(Math.floor(Number(source.length)||0),0),9007199254740991),out=[],i,j,value;for(i=0;i<length;i++){if(!(i in source))continue;value=callback.call(thisArg,source[i],i,source);if(Array.isArray(value)){for(j=0;j<value.length;j++)if(j in value)out.push(value[j]);}else out.push(value);}return out;}});
var memory=Object.create(null),nativeStorage=null,persistent=true,ready=false,timer=null;
try{nativeStorage=g.localStorage;nativeStorage.setItem('draftlab.storage-probe.v1','1');nativeStorage.removeItem('draftlab.storage-probe.v1');}catch(e){persistent=false;}
var storage={
 getItem:function(key){if(Object.prototype.hasOwnProperty.call(memory,key))return memory[key];try{return nativeStorage?nativeStorage.getItem(key):null;}catch(e){persistent=false;return null;}},
 setItem:function(key,value){value=String(value);try{if(!nativeStorage)throw new Error('storage unavailable');nativeStorage.setItem(key,value);delete memory[key];return true;}catch(e){persistent=false;memory[key]=value;return false;}},
 isPersistent:function(){return persistent;}
};
function observeViewport(callback){
 var media=g.matchMedia?g.matchMedia('(max-width:900px)'):null;
 if(media&&typeof media.addEventListener==='function')media.addEventListener('change',callback);
 else if(media&&typeof media.addListener==='function')media.addListener(callback);
 else if(g.addEventListener)g.addEventListener('resize',callback);
}
function readFile(file){if(file&&typeof file.text==='function')return file.text();return new Promise(function(resolve,reject){var reader=new g.FileReader();reader.onload=function(){resolve(reader.result);};reader.onerror=function(){reject(reader.error||new Error('文件读取失败'));};reader.readAsText(file,'UTF-8');});}
function fail(message){
 if(ready||!g.document)return;var root=g.document.getElementById('app');if(!root)return;
 root.innerHTML='<section class="boot-failure" style="padding:28px;max-width:680px;margin:40px auto;background:#101923;color:#ecf1f7;font:15px/1.9 sans-serif;border:1px solid #355449;border-radius:10px"><small>DRAFT LAB</small><h1 style="font-size:23px">页面没有成功载入</h1><p>本机存档没有被清除。请先重试；如果在微信或抖音内打开，可尝试在手机系统浏览器打开。</p><p id="boot-error-detail" style="overflow-wrap:anywhere;color:#e3bc79;font-size:12px"></p><button id="boot-retry" style="padding:12px 18px;margin-right:10px">重新加载</button><button id="boot-export" style="padding:12px 18px">导出本机存档备份</button><p style="font-size:12px;color:#9cb1c3">若仍失败，请把错误文字和浏览器名称发给作者；本页不会自动上传任何数据。</p></section>';
 g.document.getElementById('boot-error-detail').textContent=String(message||'加载异常').slice(0,260);
 g.document.getElementById('boot-retry').onclick=function(){g.location.reload();};
 g.document.getElementById('boot-export').onclick=function(){var raw=storage.getItem('draftlab.state.v1');if(!raw){g.document.getElementById('boot-error-detail').textContent='当前浏览器没有可读取的本机存档。';return;}var url=g.URL.createObjectURL(new Blob([raw],{type:'application/json'})),a=g.document.createElement('a');a.href=url;a.download='DRAFT-LAB-本机存档备份.json';a.click();g.setTimeout(function(){g.URL.revokeObjectURL(url);},1000);};
}
g.BPPlatform={storage:storage,observeViewport:observeViewport,readFile:readFile,fail:fail,booted:function(){ready=true;if(timer)g.clearTimeout(timer);}};
if(g.addEventListener){
 g.addEventListener('error',function(event){var target=event.target;if(target&&target.tagName==='SCRIPT'){fail('脚本未能加载：'+String(target.src||'').split('/').pop().split('?')[0]);return;}if(event.message)fail(event.message);},true);
 g.addEventListener('unhandledrejection',function(event){fail(event.reason&&event.reason.message||'初始化过程中发生异常');});
}
if(g.setTimeout)timer=g.setTimeout(function(){fail('加载时间较长，可能是网络或浏览器兼容问题。页面仍在等待资源，可以重新加载。');},45000);
})(typeof window!=='undefined'?window:globalThis);
