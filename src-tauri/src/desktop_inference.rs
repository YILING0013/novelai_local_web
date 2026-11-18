use crate::{
    inference::{self, ModelRecord},
    service::Shared,
};
use tauri::{
    ipc::{InvokeBody, Request, Response},
    State,
};

#[tauri::command]
pub async fn inference_model_status(
    core: State<'_, Shared>,
    model_id: String,
) -> Result<Option<ModelRecord>, String> {
    inference::inference_model_status(core.inner().clone(), model_id).await
}

#[tauri::command]
pub async fn inference_model_import(
    core: State<'_, Shared>,
    model_id: String,
    paths: Vec<String>,
    job_id: String,
) -> Result<ModelRecord, String> {
    inference::inference_model_import(core.inner().clone(), model_id, paths, job_id).await
}

#[tauri::command]
pub async fn inference_model_download(
    core: State<'_, Shared>,
    model_id: String,
    job_id: String,
) -> Result<ModelRecord, String> {
    inference::inference_model_download(core.inner().clone(), model_id, job_id).await
}

#[tauri::command]
pub async fn inference_model_remove(
    core: State<'_, Shared>,
    model_id: String,
) -> Result<(), String> {
    inference::inference_model_remove(core.inner().clone(), model_id).await
}

#[tauri::command]
pub async fn inference_open(
    core: State<'_, Shared>,
    model_id: String,
    session_id: String,
    job_id: String,
    prefer_gpu: bool,
) -> Result<serde_json::Value, String> {
    inference::inference_open(
        core.inner().clone(),
        model_id,
        session_id,
        job_id,
        prefer_gpu,
    )
    .await
}

#[tauri::command]
pub fn inference_close(core: State<'_, Shared>, session_id: String) {
    inference::inference_close(&core.inference, session_id)
}

#[tauri::command]
pub fn inference_cancel(core: State<'_, Shared>, job_id: String) {
    inference::inference_cancel(&core.inference, job_id)
}

/// 接收二进制 Float32 输入，在计算队列执行后返回带形状头的二进制输出。
/// 请求头包括 x-session-id、x-job-id、x-input-name、x-input-shape；正文不使用 JSON 数字数组。
#[tauri::command]
pub async fn inference_run(
    core: State<'_, Shared>,
    request: Request<'_>,
) -> Result<Response, String> {
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned)
            .ok_or_else(|| format!("INVALID_TENSOR_HEADER: {name}"))
    };
    let session_id = header("x-session-id")?;
    let job_id = header("x-job-id")?;
    let input_name = header("x-input-name")?;
    let shape: Vec<i64> =
        serde_json::from_str(&header("x-input-shape")?).map_err(|e| e.to_string())?;
    let bytes = match request.body() {
        InvokeBody::Raw(bytes) => bytes.clone(),
        _ => return Err("BINARY_TENSOR_REQUIRED".into()),
    };
    inference::tensor_run(
        &core.inference,
        session_id,
        job_id,
        input_name,
        shape,
        bytes,
    )
    .await
    .map(Response::new)
}
