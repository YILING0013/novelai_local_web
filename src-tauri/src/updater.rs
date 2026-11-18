use serde::Serialize;
use std::{
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    revision: u64,
    phase: String,
    version: Option<String>,
    notes: Option<String>,
    downloaded: u64,
    total: Option<u64>,
    error: Option<String>,
    checked_at: u64,
}
struct PendingUpdate {
    update: Update,
    bytes: Option<Vec<u8>>,
}
struct UpdateInner {
    status: UpdateStatus,
    pending: Option<PendingUpdate>,
    cancel: Option<CancellationToken>,
}
pub struct UpdateState(Mutex<UpdateInner>);
impl Default for UpdateState {
    fn default() -> Self {
        Self(Mutex::new(UpdateInner {
            status: UpdateStatus {
                phase: "idle".into(),
                ..Default::default()
            },
            pending: None,
            cancel: None,
        }))
    }
}
impl UpdateState {
    pub fn is_installing(&self) -> bool {
        self.0
            .lock()
            .is_ok_and(|inner| inner.status.phase == "installing")
    }
}
fn publish(app: &AppHandle, inner: &mut UpdateInner) -> UpdateStatus {
    inner.status.revision += 1;
    let snapshot = inner.status.clone();
    let _ = app.emit("desktop-update", &snapshot);
    snapshot
}
fn allowed_asset(url: &url::Url) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some("github.com")
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && url
            .path()
            .starts_with("/YILING0013/novelai_local_web/releases/download/")
}

/// 读取共享更新状态；只返回版本、说明和进度，不返回安装包或私钥。
#[tauri::command]
pub fn updater_status(state: State<'_, UpdateState>) -> Result<UpdateStatus, String> {
    Ok(state
        .0
        .lock()
        .map_err(|_| "UPDATE_LOCK_FAILED")?
        .status
        .clone())
}

/// 从内嵌 HTTPS 清单检查新版本；自动检查六小时内只执行一次，手动检查可重试。
#[tauri::command]
pub async fn updater_check(
    app: AppHandle,
    state: State<'_, UpdateState>,
    automatic: bool,
) -> Result<UpdateStatus, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "UPDATE_CLOCK_FAILED")?
        .as_secs();
    {
        let mut inner = state.0.lock().map_err(|_| "UPDATE_LOCK_FAILED")?;
        if matches!(
            inner.status.phase.as_str(),
            "checking" | "downloading" | "ready" | "installing"
        ) || (automatic && now.saturating_sub(inner.status.checked_at) < 6 * 60 * 60)
        {
            return Ok(inner.status.clone());
        }
        inner.status.phase = "checking".into();
        inner.status.error = None;
        inner.status.checked_at = now;
        publish(&app, &mut inner);
    }
    let result = async {
        let updater = app
            .updater_builder()
            .timeout(Duration::from_secs(25))
            .build()
            .map_err(|_| "UPDATE_CHECK_FAILED")?;
        let update = updater.check().await.map_err(|_| "UPDATE_CHECK_FAILED")?;
        if update
            .as_ref()
            .is_some_and(|update| !allowed_asset(&update.download_url))
        {
            return Err("UPDATE_SOURCE_NOT_ALLOWED");
        }
        Ok(update)
    }
    .await;
    let mut inner = state.0.lock().map_err(|_| "UPDATE_LOCK_FAILED")?;
    match result {
        Ok(update) => {
            inner.status.version = update.as_ref().map(|value| value.version.clone());
            inner.status.notes = update.as_ref().and_then(|value| value.body.clone());
            inner.status.phase = if update.is_some() {
                "available"
            } else {
                "up-to-date"
            }
            .into();
            inner.pending = update.map(|update| PendingUpdate {
                update,
                bytes: None,
            });
            inner.status.downloaded = 0;
            inner.status.total = None;
        }
        Err(error) => {
            inner.status.phase = "error".into();
            inner.status.error = Some(error.into());
        }
    }
    Ok(publish(&app, &mut inner))
}

/// 下载并校验签名，下载期间可取消；只有完整验签成功后才允许安装。
#[tauri::command]
pub async fn updater_download(
    app: AppHandle,
    state: State<'_, UpdateState>,
) -> Result<UpdateStatus, String> {
    let cancel = CancellationToken::new();
    let update = {
        let mut inner = state.0.lock().map_err(|_| "UPDATE_LOCK_FAILED")?;
        if !matches!(inner.status.phase.as_str(), "available" | "error") {
            return Err("UPDATE_NOT_AVAILABLE".into());
        }
        let mut update = inner
            .pending
            .as_ref()
            .ok_or("UPDATE_NOT_AVAILABLE")?
            .update
            .clone();
        update.timeout = Some(Duration::from_secs(15 * 60));
        inner.cancel = Some(cancel.clone());
        inner.status.phase = "downloading".into();
        inner.status.downloaded = 0;
        inner.status.total = None;
        inner.status.error = None;
        publish(&app, &mut inner);
        update
    };
    let mut last_event = Instant::now();
    let result = tokio::select! {
        biased;
        _ = cancel.cancelled() => Err("UPDATE_CANCELLED"),
        result = update.download(|length, total| {
            if let Ok(mut inner) = state.0.lock() {
                inner.status.downloaded += length as u64;
                inner.status.total = total;
                if last_event.elapsed() >= Duration::from_millis(100) {
                    publish(&app, &mut inner);
                    last_event = Instant::now();
                }
            }
        }, || {}) => result.map_err(|_| "UPDATE_DOWNLOAD_OR_SIGNATURE_FAILED"),
    };
    let mut inner = state.0.lock().map_err(|_| "UPDATE_LOCK_FAILED")?;
    inner.cancel = None;
    match result {
        Ok(bytes) if !cancel.is_cancelled() => {
            inner.pending.as_mut().ok_or("UPDATE_NOT_AVAILABLE")?.bytes = Some(bytes);
            inner.status.phase = "ready".into();
        }
        Ok(_) | Err("UPDATE_CANCELLED") => {
            inner.status.phase = "available".into();
            inner.status.downloaded = 0;
            inner.status.total = None;
        }
        Err(error) => {
            inner.status.phase = "error".into();
            inner.status.error = Some(error.into());
        }
    }
    Ok(publish(&app, &mut inner))
}

/// 取消当前下载，保留旧版本及业务会话，不启动安装程序。
#[tauri::command]
pub fn updater_cancel(state: State<'_, UpdateState>) -> Result<(), String> {
    if let Some(cancel) = state
        .0
        .lock()
        .map_err(|_| "UPDATE_LOCK_FAILED")?
        .cancel
        .as_ref()
    {
        cancel.cancel();
    }
    Ok(())
}

/// 先冻结新请求，再检查桌面和 Web 任务；安装失败恢复原工作区。
#[tauri::command]
pub async fn updater_install(
    app: AppHandle,
    state: State<'_, UpdateState>,
    core: State<'_, crate::service::Shared>,
) -> Result<(), String> {
    {
        let mut inner = state.0.lock().map_err(|_| "UPDATE_LOCK_FAILED")?;
        if inner.status.phase != "ready" || inner.pending.as_ref().is_none_or(|p| p.bytes.is_none())
        {
            return Err("UPDATE_NOT_READY".into());
        }
        inner.status.phase = "installing".into();
        publish(&app, &mut inner);
    }
    let operation = core.operation_gate.clone().try_write_owned();
    if operation.is_err()
        || core.tasks.is_busy()
        || core.inference.is_busy().unwrap_or(true)
        || app
            .webview_windows()
            .keys()
            .filter(|label| matches!(label.as_str(), "main" | "auth"))
            .count()
            != 1
    {
        let mut inner = state.0.lock().map_err(|_| "UPDATE_LOCK_FAILED")?;
        inner.status.phase = "ready".into();
        publish(&app, &mut inner);
        return Err("UPDATE_WORKSPACE_BUSY".into());
    }
    let guard = operation.expect("idle operation gate");
    let pending = state
        .0
        .lock()
        .map_err(|_| "UPDATE_LOCK_FAILED")?
        .pending
        .take()
        .ok_or("UPDATE_NOT_READY")?;
    let installed = tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let result = pending
            .update
            .install(pending.bytes.as_ref().expect("verified package"));
        (
            pending,
            result.map_err(|_| "UPDATE_INSTALL_FAILED".to_owned()),
        )
    })
    .await;
    let (pending, result) = match installed {
        Ok(value) => value,
        Err(_) => {
            let mut inner = state.0.lock().map_err(|_| "UPDATE_LOCK_FAILED")?;
            inner.status.phase = "error".into();
            inner.status.error = Some("UPDATE_INSTALL_FAILED".into());
            publish(&app, &mut inner);
            return Err("UPDATE_INSTALL_FAILED".into());
        }
    };
    let mut inner = state.0.lock().map_err(|_| "UPDATE_LOCK_FAILED")?;
    inner.pending = Some(pending);
    inner.status.phase = "ready".into();
    inner.status.error = result.as_ref().err().cloned();
    publish(&app, &mut inner);
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn update_source_only_accepts_this_public_repository() {
        assert!(allowed_asset(
            &"https://github.com/YILING0013/novelai_local_web/releases/download/v2.0.0/setup.exe"
                .parse()
                .unwrap()
        ));
        for url in ["http://github.com/YILING0013/novelai_local_web/releases/download/v2/setup.exe", "https://github.com/other/repo/releases/download/v2/setup.exe", "https://user@github.com/YILING0013/novelai_local_web/releases/download/v2/setup.exe", "https://github.com.evil.test/YILING0013/novelai_local_web/releases/download/v2/setup.exe"] {
            assert!(!allowed_asset(&url.parse().unwrap()));
        }
    }
}
