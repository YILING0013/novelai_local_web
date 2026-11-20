use crate::{desktop_inference, desktop_windows, files, service, updater, web};
use serde_json::Value;
#[cfg(windows)]
use std::io::Write;
use tauri::ipc::{InvokeBody, Request};
use tauri::{Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
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
/// 将当前 PNG 解码为 RGBA 并写入系统剪贴板。
#[tauri::command]
async fn native_copy_png(app: tauri::AppHandle, request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("需要 PNG 图像内容".into());
    };
    let pixels = image::load_from_memory_with_format(bytes, image::ImageFormat::Png)
        .map_err(|error| error.to_string())?
        .into_rgba8();
    let (width, height) = pixels.dimensions();
    let image = tauri::image::Image::new_owned(pixels.into_raw(), width, height);
    app.clipboard()
        .write_image(&image)
        .map_err(|error| error.to_string())
}

/// 将当前预览交给 Windows Shell 拖出，以文件复制形式保留图像字节与文件名。
#[cfg(windows)]
#[tauri::command]
async fn native_drag_image(
    window: tauri::WebviewWindow,
    request: Request<'_>,
) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::{
        core::{Interface, PCWSTR},
        Win32::{
            System::{
                Com::IDataObject,
                Ole::{
                    IDropSource, OleInitialize, OleUninitialize, DROPEFFECT_COPY, DROPEFFECT_NONE,
                },
            },
            UI::{
                Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON},
                Shell::{
                    BHID_DataObject, IDataObjectAsyncCapability, IShellItem,
                    SHCreateItemFromParsingName, SHDoDragDrop,
                },
            },
        },
    };

    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("需要图像文件内容".into());
    };
    let header = request
        .headers()
        .get("x-image-name")
        .ok_or("缺少图像文件名")?;
    let (_, filename) = url::form_urlencoded::parse(header.as_bytes())
        .next()
        .ok_or("缺少图像文件名")?;
    if filename.is_empty()
        || filename.ends_with(['.', ' '])
        || filename
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
    {
        return Err("无效图像文件名".into());
    }

    let directory = std::env::temp_dir().join(format!("yihan-rat-drag-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&directory).map_err(|e| e.to_string())?;
    let path = directory.join(filename.as_ref());
    let result = async {
        std::fs::File::create_new(&path)
            .and_then(|mut file| file.write_all(bytes))
            .map_err(|e| e.to_string())?;
        let drag_path: Vec<u16> = path.as_os_str().encode_wide().chain([0]).collect();
        let (send, receive) = tokio::sync::oneshot::channel();
        let owner = window.clone();
        window
            .run_on_main_thread(move || {
                let result = (|| {
                    // WebView 保留 HTML 拖入，拖出时在同一窗口线程启动系统文件拖放。
                    let hwnd = owner.hwnd().map_err(|e| e.to_string())?;
                    unsafe {
                        if GetAsyncKeyState(VK_LBUTTON.0.into()) >= 0 {
                            return Ok(false);
                        }
                        OleInitialize(None).map_err(|e| e.to_string())?;
                        let drag = (|| -> windows::core::Result<bool> {
                            let item: IShellItem =
                                SHCreateItemFromParsingName(PCWSTR(drag_path.as_ptr()), None)?;
                            let data: IDataObject = item.BindToHandler(None, &BHID_DataObject)?;
                            if let Ok(capability) = data.cast::<IDataObjectAsyncCapability>() {
                                capability.SetAsyncMode(false)?;
                            }
                            let effect = SHDoDragDrop(
                                Some(hwnd),
                                &data,
                                None::<&IDropSource>,
                                DROPEFFECT_COPY,
                            )?;
                            Ok(effect != DROPEFFECT_NONE)
                        })();
                        OleUninitialize();
                        drag.map_err(|e| e.to_string())
                    }
                })();
                let _ = send.send(result);
            })
            .map_err(|e| e.to_string())?;
        receive.await.map_err(|e| e.to_string())?
    }
    .await;
    let cleanup = move || {
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_dir(&directory);
    };
    if matches!(result, Ok(true)) {
        // 浏览器或聊天工具可能在放下文件后才打开路径，给接收方留出读取时间。
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(300)).await;
            cleanup();
        });
    } else {
        cleanup();
    }
    result.map(|_| ())
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
                native_copy_png,
                #[cfg(windows)]
                native_drag_image,
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
