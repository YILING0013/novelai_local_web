use crate::{desktop_inference, desktop_windows, files, service, updater, web};
use serde_json::Value;
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;
#[tauri::command]
async fn local_request(
    state: State<'_, service::Shared>,
    method: String,
    path: String,
    body: Option<Value>,
) -> Result<service::Reply, String> {
    Ok(state
        .dispatch(
            service::APP_CALLER,
            &method,
            &path,
            body.unwrap_or(Value::Null),
        )
        .await)
}
#[tauri::command]
async fn web_status(state: State<'_, web::Web>) -> Result<Value, String> {
    Ok(state.status().await)
}
#[tauri::command]
async fn web_configure(
    state: State<'_, web::Web>,
    core: State<'_, service::Shared>,
    config: web::Config,
) -> Result<Value, String> {
    let _operation = core
        .operation_gate
        .clone()
        .try_read_owned()
        .map_err(|_| "UPDATE_INSTALLING")?;
    state.set(config).await
}
#[tauri::command]
async fn native_save_file(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    name: String,
    bytes: Vec<u8>,
) -> Result<bool, String> {
    let _operation = app
        .state::<service::Shared>()
        .operation_gate
        .clone()
        .read_owned()
        .await;
    let filename = std::path::Path::new(&name)
        .file_name()
        .and_then(|x| x.to_str())
        .unwrap_or("image.png")
        .to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_file_name(filename)
            .blocking_save_file()
        else {
            return Ok(false);
        };
        std::fs::write(file.into_path().map_err(|e| e.to_string())?, bytes)
            .map_err(|e| e.to_string())?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}
pub fn run() {
    tauri::Builder::default()
        .register_uri_scheme_protocol("naiasset", |ctx, req| {
            let core = ctx.app_handle().state::<service::Shared>();
            let path = req.uri().path();
            let reply = if let Some(k) = path.strip_prefix("/picked/") {
                (|| {
                    let (p, t) = core
                        .picked
                        .lock()
                        .unwrap()
                        .remove(k)
                        .ok_or_else(service::Fault::missing)?;
                    if t.elapsed().as_secs() > 300 {
                        return Err(service::Fault::missing());
                    }
                    Ok((
                        std::fs::read(&p)?,
                        mime_guess::from_path(&p)
                            .first_or_octet_stream()
                            .to_string(),
                    ))
                })()
            } else {
                core.asset(path)
            };
            let res = tauri::http::Response::builder()
                .header("Access-Control-Allow-Origin", "http://tauri.localhost")
                .header("X-Content-Type-Options", "nosniff");
            match reply {
                Ok((data, mime)) => res.header("Content-Type", mime).body(data).unwrap(),
                Err(e) => res.status(e.0).body(vec![]).unwrap(),
            }
        })
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            let window = ["auth", "main"]
                .into_iter()
                .filter_map(|label| app.get_webview_window(label))
                .find(|window| window.is_visible().unwrap_or(false));
            if let Some(window) = window {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updater::UpdateState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .with_filter(|label| matches!(label, "auth" | "main"))
                .build(),
        )
        .setup(|app| {
            let core = service::Core::open(
                &app.path().app_local_data_dir()?,
                &app.path().resource_dir()?,
            )
            .map_err(|e| std::io::Error::other(e.2))?;
            let _ = core.app.set(app.handle().clone());
            app.manage(web::Web::new(core.clone()));
            app.manage(core);
            app.manage(desktop_windows::DesktopWindowState::default());
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move { handle.state::<web::Web>().restore().await });
            let offline = std::env::args().skip(1).any(|v| v == "--local-tools");
            desktop_windows::create_app_window(
                app.handle(),
                if offline { "main" } else { "auth" },
                if offline { "/local" } else { "/login" },
                false,
            )
            .map_err(std::io::Error::other)?;
            Ok(())
        })
        .invoke_handler(|invoke: tauri::ipc::Invoke<tauri::Wry>| {
            if !invoke.message.webview_ref().url().is_ok_and(|url| {
                desktop_windows::is_app_window(invoke.message.webview_ref().label(), &url)
            }) {
                invoke.resolver.reject("DESKTOP_WINDOW_NOT_ALLOWED");
                return true;
            }
            if invoke
                .message
                .webview_ref()
                .app_handle()
                .state::<updater::UpdateState>()
                .is_installing()
                && !matches!(
                    invoke.message.command(),
                    "updater_status" | "updater_cancel"
                )
            {
                invoke.resolver.reject("UPDATE_INSTALLING");
                return true;
            }
            let handler: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![
                updater::updater_status,
                updater::updater_check,
                updater::updater_download,
                updater::updater_cancel,
                updater::updater_install,
                local_request,
                web_status,
                web_configure,
                native_save_file,
                files::pick_files,
                desktop_windows::desktop_switch_window,
                desktop_windows::desktop_window_ready,
                desktop_inference::inference_model_status,
                desktop_inference::inference_model_import,
                desktop_inference::inference_model_download,
                desktop_inference::inference_model_remove,
                desktop_inference::inference_open,
                desktop_inference::inference_run,
                desktop_inference::inference_cancel,
                desktop_inference::inference_close
            ];
            handler(invoke)
        })
        .run(tauri::generate_context!())
        .expect("Desktop application startup failed.");
}
