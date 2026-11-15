// Do not package private uploads or other files dropped into public/ by a user.
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const allowed=new Set(JSON.parse(await readFile(new URL('./public-assets.json',import.meta.url),'utf8')));
const pages=new Set(['index','login','main','404'].flatMap(page=>[page+'.html',page+'.txt']).concat(['favicon.ico']));
async function walk(folder,callback,prefix=''){
 for(const entry of await readdir(join(folder,prefix),{withFileTypes:true})){
  const name=prefix+entry.name;
  if(entry.isDirectory())await walk(folder,callback,name+'/');else if(!entry.isFile()||!callback(name))throw Error('Unexpected packaged resource: '+name);
 }
}
await walk(join(root,'public'),name=>allowed.has(name));
await walk(join(root,'out'),name=>allowed.has(name)||pages.has(name)||name.startsWith('_next/static/'));
await walk(join(root,'dist'),name=>allowed.has(name)||name==='index.html'||name.startsWith('assets/'));
