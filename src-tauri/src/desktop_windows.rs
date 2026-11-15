use std::sync::Mutex;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

#[derive(Clone, Debug, PartialEq)]
struct PendingWindow {
    source: String,
    target: String,
    route: String,
}

/// 一次只交接一对本地窗口，来源保留到目标页面明确就绪。
#[derive(Default)]
pub struct DesktopWindowState(Mutex<Option<PendingWindow>>);

/// 判断安装包来源；开发服务器只在调试构建中开放。
///
/// Args:
///   url: 窗口正在请求的完整地址。
/// Returns:
///   是否属于允许的本地应用来源。
pub(crate) fn is_app_origin(url: &url::Url) -> bool {
    matches!(
        url.origin().ascii_serialization().as_str(),
        "http://tauri.localhost" | "https://tauri.localhost" | "tauri://localhost"
    ) || (cfg!(debug_assertions) && url.origin().ascii_serialization() == "http://127.0.0.1:1420")
}

/// 限定自定义 IPC 的调用窗口和来源，验证码窗口不获得本地能力。
///
/// Args:
///   label: 实际调用窗口标签。
///   url: 实际调用窗口地址，不能使用前端传入的地址代替。
/// Returns:
///   是否允许调用本地命令。
pub(crate) fn is_app_window(label: &str, url: &url::Url) -> bool {
    matches!(label, "auth" | "main") && is_app_origin(url)
}

fn route_window(route: &str) -> Result<&'static str, String> {
    match route {
        "/main" | "/local" | "/documentation" => Ok("main"),
        "/login"
        | "/account-setup"
        | "/account-migration"
        | "/account-verification"
        | "/reset-password"
        | "/invite"
        | "/terms"
        | "/user-agreement" => Ok("auth"),
        _ => Err("DESKTOP_ROUTE_NOT_ALLOWED".into()),
    }
}

fn begin_switch(
    pending: &mut Option<PendingWindow>,
    source: &str,
    target: &str,
    route: &str,
) -> Result<bool, String> {
    let next = PendingWindow {
        source: source.into(),
        target: target.into(),
        route: route.into(),
    };
    if let Some(current) = pending {
        if *current == next {
            return Ok(false);
        }
        if current.target != source {
            return Err("DESKTOP_WINDOW_SWITCH_PENDING".into());
        }
        // 目标页的账号门禁可以重定向或返回仍保留的来源，不能把界面卡在隐藏窗口中。
        if source == target {
            current.route = route.into();
            return Ok(true);
        }
    }
    *pending = (source != target).then_some(next);
    Ok(true)
}

/// 按固定配置创建隐藏的本地窗口，并限制导航和弹窗。
///
/// Args:
///   app: 当前应用。
///   label: auth 或 main，必须与路由归属一致。
///   route: 已允许的固定路由，不包含查询参数或 Token。
///   trial_welcome: 新用户欢迎标记，不包含账号凭据。
/// Returns:
///   已创建但尚未显示的窗口，显示由前端就绪命令完成。
pub(crate) fn create_app_window(
    app: &AppHandle,
    label: &str,
    route: &str,
    trial_welcome: bool,
) -> Result<WebviewWindow, String> {
    if route_window(route)? != label {
        return Err("DESKTOP_WINDOW_ROUTE_MISMATCH".into());
    }
    let mut config = app
        .config()
        .app
        .windows
        .iter()
        .find(|config| config.label == label)
        .cloned()
        .ok_or("DESKTOP_WINDOW_CONFIG_MISSING")?;
    config.url = WebviewUrl::App(format!("index.html#{route}").into());
    let window = WebviewWindowBuilder::from_config(app, &config)
        .map_err(|_| "DESKTOP_WINDOW_CREATE_FAILED")?
        .visible(false)
        .initialization_script(format!(
            "if(window.top===window){{window.__DESKTOP_TRIAL_WELCOME__={trial_welcome};}}"
        ))
        .on_navigation(is_app_origin)
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .build()
        .map_err(|_| "DESKTOP_WINDOW_CREATE_FAILED")?;
    #[cfg(windows)]
    {
        use windows_sys::Win32::{
            System::LibraryLoader::GetModuleHandleW,
            UI::WindowsAndMessaging::{
                LoadImageW, SendMessageW, ICON_BIG, IMAGE_ICON, LR_DEFAULTSIZE, LR_SHARED,
                WM_SETICON,
            },
        };
        let hwnd = window.hwnd().map_err(|error| error.to_string())?;
        // Tauri 默认仅设置小图标；显式提供任务栏大图标，避免回退到 Shell 的旧图标缓存。
        // 图标取自当前 EXE 的共享资源，由 Windows 管理生命周期。
        unsafe {
            let icon = LoadImageW(
                GetModuleHandleW(std::ptr::null()),
                tauri::utils::platform::WINDOWS_APP_ICON_RESOURCE_ID as usize as *const u16,
                IMAGE_ICON,
                0,
                0,
                LR_DEFAULTSIZE | LR_SHARED,
            );
            if icon.is_null() {
                return Err(std::io::Error::last_os_error().to_string());
            }
            SendMessageW(hwnd.0, WM_SETICON, ICON_BIG as usize, icon as isize);
        }
    }
    let closed_label = label.to_owned();
    let closed_app = app.clone();
    window.on_window_event(move |event| {
        if !matches!(event, tauri::WindowEvent::Destroyed) {
            return;
        }
        let state = closed_app.state::<DesktopWindowState>();
        let close_target = {
            let Ok(mut pending) = state.0.lock() else {
                return;
            };
            match pending.as_ref() {
                Some(handoff) if handoff.source == closed_label => {
                    pending.take().map(|handoff| handoff.target)
                }
                Some(handoff) if handoff.target == closed_label => {
                    pending.take();
                    None
                }
                _ => None,
            }
        };
        // 用户在加载期间退出来源时，一并结束隐藏目标；主动交接已先清除 pending。
        if let Some(target) = close_target.and_then(|label| closed_app.get_webview_window(&label)) {
            let _ = target.destroy();
        }
    });
    Ok(window)
}

/// 请求固定路由所属窗口；目标就绪前保留来源窗口。
///
/// Args:
///   window: Tauri 注入的实际调用窗口，不能由 JavaScript 指定。
///   route: 固定路由白名单中的路径。
///   trial_welcome: 可选欢迎标记，省略为 false。
/// Returns:
///   已创建或已通知目标窗口；创建失败时来源窗口保持不变。
#[tauri::command]
pub async fn desktop_switch_window(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, DesktopWindowState>,
    route: String,
    trial_welcome: Option<bool>,
) -> Result<(), String> {
    let target = route_window(&route)?;
    let source = window.label();
    {
        let mut pending = state.0.lock().map_err(|_| "DESKTOP_WINDOW_LOCK_FAILED")?;
        if !begin_switch(&mut pending, source, target, &route)? {
            return Ok(());
        }
    }
    let trial_welcome = trial_welcome.unwrap_or(false);
    // 不持锁执行窗口操作，这些操作可能同步触发窗口事件或前端 IPC。
    let result = if let Some(existing) = app.get_webview_window(target) {
        let detail = serde_json::json!({ "route": route, "trialWelcome": trial_welcome });
        existing
            .eval(format!(
                "(()=>{{const next={detail};window.__DESKTOP_TRIAL_WELCOME__=next.trialWelcome;window.location.hash=next.route;window.dispatchEvent(new CustomEvent('desktop-window-route',{{detail:next}}));}})()"
            ))
            .map_err(|_| "DESKTOP_WINDOW_NAVIGATION_FAILED".to_owned())
    } else {
        create_app_window(&app, target, &route, trial_welcome).and_then(|created| {
            // 创建 WebView 期间用户仍能关闭来源；销毁事件可能早于目标登记完成。
            // 已就绪的目标会先显示再销毁来源，因此只收起仍隐藏的遗留窗口。
            if app.get_webview_window(source).is_none()
                && !created
                    .is_visible()
                    .map_err(|_| "DESKTOP_WINDOW_SHOW_FAILED")?
            {
                created
                    .destroy()
                    .map_err(|_| "DESKTOP_WINDOW_CLOSE_FAILED")?;
                return Err("DESKTOP_WINDOW_SWITCH_CANCELLED".into());
            }
            Ok(())
        })
    };
    if result.is_err() {
        let mut pending = state.0.lock().map_err(|_| "DESKTOP_WINDOW_LOCK_FAILED")?;
        if pending.as_ref().is_some_and(|handoff| {
            handoff.source == source && handoff.target == target && handoff.route == route
        }) {
            pending.take();
        }
    }
    result
}

/// 前端确认目标路由已可用后显示窗口，再销毁仍保留的来源窗口。
///
/// Args:
///   window: Tauri 注入的实际调用窗口。
/// Returns:
///   当前窗口已显示并取得焦点；只有匹配当前交接的窗口才能结束来源。
#[tauri::command]
pub async fn desktop_window_ready(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, DesktopWindowState>,
) -> Result<(), String> {
    let url = window.url().map_err(|_| "DESKTOP_WINDOW_URL_UNAVAILABLE")?;
    let route = url
        .fragment()
        .ok_or("DESKTOP_WINDOW_ROUTE_MISMATCH")?
        .split('?')
        .next()
        .ok_or("DESKTOP_WINDOW_ROUTE_MISMATCH")?;
    if route_window(route)? != window.label() {
        return Err("DESKTOP_WINDOW_ROUTE_MISMATCH".into());
    }
    let handoff = {
        let pending = state.0.lock().map_err(|_| "DESKTOP_WINDOW_LOCK_FAILED")?;
        match pending.as_ref() {
            Some(handoff) if handoff.target == window.label() => {
                if handoff.route != route {
                    return Err("DESKTOP_WINDOW_ROUTE_MISMATCH".into());
                }
                Some(handoff.clone())
            }
            _ => None,
        }
    };
    // 旧版保存的窗口尺寸可能小于新布局下限；状态恢复后再检查，避免升级后表单被裁切。
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|config| config.label == window.label())
        .ok_or("DESKTOP_WINDOW_CONFIG_MISSING")?;
    let size = window
        .inner_size()
        .map_err(|_| "DESKTOP_WINDOW_SIZE_FAILED")?
        .to_logical::<f64>(
            window
                .scale_factor()
                .map_err(|_| "DESKTOP_WINDOW_SIZE_FAILED")?,
        );
    if config.min_width.is_some_and(|minimum| size.width < minimum)
        || config
            .min_height
            .is_some_and(|minimum| size.height < minimum)
    {
        window
            .set_size(tauri::LogicalSize::new(
                size.width.max(config.width),
                size.height.max(config.height),
            ))
            .map_err(|_| "DESKTOP_WINDOW_SIZE_FAILED")?;
    }
    window.show().map_err(|_| "DESKTOP_WINDOW_SHOW_FAILED")?;
    window
        .unminimize()
        .map_err(|_| "DESKTOP_WINDOW_SHOW_FAILED")?;
    window
        .set_focus()
        .map_err(|_| "DESKTOP_WINDOW_FOCUS_FAILED")?;
    if let Some(handoff) = handoff {
        {
            let mut pending = state.0.lock().map_err(|_| "DESKTOP_WINDOW_LOCK_FAILED")?;
            if pending.as_ref() != Some(&handoff) {
                return Ok(());
            }
            pending.take();
        }
        if let Some(source) = app.get_webview_window(&handoff.source) {
            source
                .destroy()
                .map_err(|_| "DESKTOP_WINDOW_CLOSE_FAILED")?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_and_origins_are_limited_to_the_two_local_windows() {
        for route in ["/main", "/local", "/documentation"] {
            assert_eq!(route_window(route).unwrap(), "main");
        }
        for route in [
            "/login",
            "/account-setup",
            "/account-migration",
            "/account-verification",
            "/reset-password",
            "/invite",
            "/terms",
            "/user-agreement",
        ] {
            assert_eq!(route_window(route).unwrap(), "auth");
        }
        for route in [
            "https://example.com",
            "//example.com",
            "/login?token=secret",
            "/main#other",
            "../login",
            "/admin",
            "main",
        ] {
            assert!(route_window(route).is_err());
        }
        let local = url::Url::parse("http://tauri.localhost/index.html#/login").unwrap();
        assert!(is_app_window("auth", &local));
        assert!(is_app_window("main", &local));
        assert!(!is_app_window("verification-one", &local));
        for remote in [
            "https://ai.yihan.art/desktop-verification",
            "https://captcha.idlecloud.cc",
            "https://tauri.localhost.evil.test/",
        ] {
            assert!(!is_app_window("auth", &url::Url::parse(remote).unwrap()));
        }
    }

    #[test]
    fn switching_is_idempotent_and_target_can_return_to_preserved_source() {
        let mut pending = None;
        assert!(begin_switch(&mut pending, "auth", "main", "/main").unwrap());
        assert!(!begin_switch(&mut pending, "auth", "main", "/main").unwrap());
        assert!(begin_switch(&mut pending, "auth", "main", "/local").is_err());
        assert!(begin_switch(&mut pending, "main", "main", "/local").unwrap());
        assert_eq!(pending.as_ref().unwrap().source, "auth");
        assert_eq!(pending.as_ref().unwrap().route, "/local");
        assert!(begin_switch(&mut pending, "main", "auth", "/login").unwrap());
        let returned = pending.unwrap();
        assert_eq!(returned.source, "main");
        assert_eq!(returned.target, "auth");
    }
}
