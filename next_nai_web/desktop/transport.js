import { invoke } from '@tauri-apps/api/core';
import { message, confirm } from '@tauri-apps/plugin-dialog';
function assetUrls(value) {
  if (Array.isArray(value)) return value.map(assetUrls);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key,data])=>[key,
    typeof data==='string' && /^\/api\/local\/(gallery|versions\/assets)\//.test(data) && /url$/i.test(key)
      ? 'http://naiasset.localhost'+data : assetUrls(data)]));
}
export function installTransport() {
  const fetchOriginal=window.fetch.bind(window);
  document.addEventListener('click',async event=>{
    const input=event.target;
    if(!(input instanceof HTMLInputElement)||input.type!=='file'||input.disabled)return;
    event.preventDefault();event.stopImmediatePropagation();
    const mime={ 'image/*':['png','jpg','jpeg','webp','gif','bmp'], 'application/json':['json'],'image/jpeg':['jpg','jpeg'] };
    const extensions=input.accept.split(',').flatMap(v=>{v=v.trim();return mime[v]??(v.startsWith('.')?[v.slice(1)]:v.startsWith('image/')?[v.slice(6)]:[]);});
    try{const chosen=await invoke('pick_files',{multiple:input.multiple,extensions});
      if(!chosen.length)return;const transfer=new DataTransfer();
      for(const f of chosen){const reply=await fetchOriginal(f.url);if(!reply.ok)throw Error('Could not open '+f.name);
        transfer.items.add(new File([await reply.blob()],f.name,{type:f.type}));}
      input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    }catch(error){await message(String(error),{title:'NovelAI Local',kind:'error'});}
  },true);
  window.novelaiDialog={ alert:text=>message(text,{title:'NovelAI Local'}),confirm:text=>confirm(text,{title:'NovelAI Local'}) };
  window.fetch=async(input,init={})=>{
    const url=new URL(input instanceof Request?input.url:input,location.href);
    if(url.origin!==location.origin||!url.pathname.startsWith('/api/')) return fetchOriginal(input,init);
    init.signal?.throwIfAborted();
    let body=null;
    if (init.body instanceof FormData) {
      body={files:[]};
      for(const [key,file] of init.body.entries()) {
        if(typeof file==='string'){body[key]=file;continue;}
        const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file)});
        body.files.push({name:file.name,data});
      }
    } else if(init.body) body=JSON.parse(init.body);
    const reply=await invoke('local_request',{method:init.method||'GET',path:url.pathname+url.search,body});
    init.signal?.throwIfAborted();
    return Response.json(assetUrls(reply.body),{status:reply.status});
  };
}
