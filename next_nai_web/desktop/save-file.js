import { invoke } from '@tauri-apps/api/core';
import { message } from '@tauri-apps/plugin-dialog';
export async function saveAs(source, name='image.png'){
 try{const file=source instanceof Blob?source:await (await fetch(source)).blob();
 return await invoke('native_save_file',{name,bytes:Array.from(new Uint8Array(await file.arrayBuffer()))});
 }catch(error){await message(String(error),{title:'NovelAI Local',kind:'error'});return false}
}
export default saveAs;
