const fs=require('fs'),path=require('path'),{transformSync}=require('esbuild');
const root=path.resolve(__dirname,'..'),dist=path.join(root,'dist'),out=path.resolve(__dirname,'../build');fs.mkdirSync(out,{recursive:true});
const read=file=>fs.readFileSync(path.join(dist,file),'utf8');
const data=JSON.parse(read('data/snapshot.json'));
for(const h of data.heroes)h.image='data:image/svg+xml;base64,'+fs.readFileSync(path.join(dist,'assets/hero-placeholder.svg')).toString('base64');
const escapeScript=s=>s.replace(/<\/script/gi,'<\\/script');
const script=(name,source)=>'<script data-bp-source="'+name+'">'+escapeScript(source)+'</script>';
function stylesheet(name){
 const source=read(name),parsed=transformSync(source,{loader:'css',sourcefile:name,logLevel:'silent'});
 if(parsed.warnings.length)throw new Error('CSS syntax warnings in '+name+': '+parsed.warnings.map(x=>x.text).join('; '));
 // Never strip CSS using a semicolon regex: valid URL strings may contain semicolons.
 if(/@import\b/i.test(source))throw new Error('Offline CSS must use bundled local resources: '+name);
 const embedded=source.replace(/url\(['"]?(fonts\/[^)'"\s]+\.ttf)['"]?\)/g,(_,file)=>'url(data:font/ttf;base64,'+fs.readFileSync(path.join(dist,file)).toString('base64')+')');
 return '<style data-bp-source="'+name+'">'+embedded+'</style>';
}
// Callback replacements preserve literal replacement tokens in source code/data.
const complete=read('index.html')
 .replace(/<link rel="stylesheet" href="([^"?]+)(?:\?[^"]*)?">/g,(_,name)=>stylesheet(name))
 .replace(/<script src="([^"?]+)(?:\?[^"]*)?"><\/script>/g,(_,name)=>script(name,name==='data/snapshot.js'?'window.BP_DATA='+JSON.stringify(data)+';':read(name)))
 .replace('<!--DISCOVERY_DATA-->',()=>script('data/discovery-data.js',read('data/discovery-data.js')));
fs.writeFileSync(path.join(out,'DRAFT-LAB-Demo.html'),complete);
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
fs.writeFileSync(path.join(out,'DRAFT-LAB-离线测试版-v'+version+'.html'),complete);
console.log(JSON.stringify({file:path.join(out,'DRAFT-LAB-Demo.html'),bytes:Buffer.byteLength(complete),heroes:data.heroes.length,games:data.games.length}));
