use crate::service::*;
use serde_json::{json, Value as V};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
#[tauri::command]
pub async fn pick_files(
    app: AppHandle,
    window: WebviewWindow,
    multiple: bool,
    extensions: Vec<String>,
) -> Result<Vec<V>, String> {
    tauri::async_runtime::spawn_blocking(move ||{let mut dlg=app.dialog().file().set_parent(&window);let exts=extensions.iter().take(50).filter(|x|!x.is_empty()&&x.len()<15&&x.bytes().all(|c|c.is_ascii_alphanumeric())).map(String::as_str).collect::<Vec<_>>();if !exts.is_empty(){dlg=dlg.add_filter("Files",&exts)}let files=if multiple{dlg.blocking_pick_files().unwrap_or_default()}else{dlg.blocking_pick_file().into_iter().collect()};let core=app.state::<Shared>();let mut selected=core.picked.lock().unwrap();selected.retain(|_,(_,t)|t.elapsed()<Duration::from_secs(300));let mut result=vec![];for file in files{let path=file.into_path().map_err(|e|e.to_string())?;let meta=std::fs::metadata(&path).map_err(|e|e.to_string())?;if !meta.is_file()||meta.len()>256*1024*1024{return Err("The selected file exceeds 256 MiB.".into())}let name=path.file_name().ok_or("Invalid selection")?.to_string_lossy().into_owned();let mime=mime_guess::from_path(&path).first_or_octet_stream().to_string();let key=id();selected.insert(key.clone(),(path,Instant::now()));result.push(json!({"name":name,"type":mime,"url":format!("http://naiasset.localhost/picked/{key}")}));}Ok(result)}).await.map_err(|e|e.to_string())?
}
