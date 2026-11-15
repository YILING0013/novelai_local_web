//! 固定本地模型的文件管理和 ONNX Runtime 推理；图像不会发送给模型下载服务。

#[path = "lettering.rs"]
pub(crate) mod lettering;
use ort::{
    environment::Environment,
    ep,
    session::{RunOptions, Session},
    value::Tensor,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{
    ipc::{InvokeBody, Request, Response},
    path::BaseDirectory,
    AppHandle, Emitter, Manager, State,
};
use tokio::sync::{Notify, Semaphore};

const MANIFEST: &str = include_str!("../resources/models.json");
const CANCELLED: &str = "INFERENCE_CANCELLED";

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelFile {
    name: String,
    url: String,
    bytes: u64,
    sha256: String,
    archive_path: Option<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Model {
    id: String,
    version: Option<String>,
    revision: Option<String>,
    kind: String,
    input_layout: String,
    preferred_backend: Option<String>,
    model_file: String,
    labels_file: Option<String>,
    input_size: Option<usize>,
    tile_size: Option<usize>,
    files: Vec<ModelFile>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelRecord {
    generation: String,
    imported_at: u64,
    bytes: u64,
}

struct Runtime {
    environment: Environment,
    _libraries: Vec<libloading::Library>,
}
struct LoadedModel {
    model_id: String,
    session: Mutex<Session>,
}
struct Operation {
    cancelled: AtomicBool,
    changed: Notify,
    run: Mutex<Option<Arc<RunOptions>>>,
    session_id: Option<String>,
}

impl Operation {
    fn check(&self) -> Result<(), String> {
        if self.cancelled.load(Ordering::Acquire) {
            Err(CANCELLED.into())
        } else {
            Ok(())
        }
    }
    fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
        self.changed.notify_one();
        if let Some(run) = self.run.lock().unwrap().as_ref() {
            let _ = run.terminate();
        }
    }
}

struct InferenceInner {
    ocr: Mutex<Option<lettering::Models>>,
    sessions: Mutex<HashMap<String, Arc<LoadedModel>>>,
    operations: Mutex<HashMap<String, Arc<Operation>>>,
    model_writes: Mutex<std::collections::HashSet<String>>,
    queue: Arc<Semaphore>,
    // 会话先析构，运行库及其依赖 DLL 最后释放。
    runtime: Mutex<Option<Runtime>>,
}

struct JobGuard {
    inner: Arc<InferenceInner>,
    id: String,
    model_write: Option<String>,
}
impl Drop for JobGuard {
    fn drop(&mut self) {
        self.inner.operations.lock().unwrap().remove(&self.id);
        if let Some(model) = &self.model_write {
            self.inner.model_writes.lock().unwrap().remove(model);
        }
    }
}

/// 保存原生会话、取消句柄和单任务计算队列；供应用 setup 注册一次。
#[derive(Clone)]
pub struct InferenceState {
    inner: Arc<InferenceInner>,
}

impl InferenceState {
    /// 原生模型下载、导入、加载或推理未结束时，更新安装必须等待。
    pub fn is_busy(&self) -> Result<bool, String> {
        Ok(!self
            .inner
            .operations
            .lock()
            .map_err(|_| "INFERENCE_LOCK_FAILED")?
            .is_empty())
    }
}

impl Default for InferenceState {
    fn default() -> Self {
        Self {
            inner: Arc::new(InferenceInner {
                ocr: Mutex::new(None),
                runtime: Mutex::new(None),
                sessions: Mutex::new(HashMap::new()),
                operations: Mutex::new(HashMap::new()),
                model_writes: Mutex::new(Default::default()),
                queue: Arc::new(Semaphore::new(1)),
            }),
        }
    }
}

fn model(id: &str) -> Result<Model, String> {
    serde_json::from_str::<Vec<Model>>(MANIFEST)
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|m| m.id == id)
        .ok_or_else(|| "UNKNOWN_MODEL".into())
}

fn model_dir(app: &AppHandle, model: &Model) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("models")
        .join(&model.id)
        .join(model.revision.as_ref().or(model.version.as_ref()).unwrap()))
}

fn read_record(directory: &Path) -> Result<Option<ModelRecord>, String> {
    let path = directory.join("active.json");
    if !path.exists() {
        return Ok(None);
    }
    let record: ModelRecord = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| format!("MODEL_RECORD_INVALID: {e}"))?;
    uuid::Uuid::parse_str(&record.generation).map_err(|_| "MODEL_RECORD_INVALID")?;
    Ok(Some(record))
}

fn progress(app: &AppHandle, job_id: &str, stage: &str, completed: u64, total: u64) {
    if let Some(core) = app.try_state::<crate::service::Shared>() {
        crate::jobs::progress(&core, job_id, stage, completed, total);
    }
    let _ = app.emit(
        "native-inference-progress",
        serde_json::json!({"jobId":job_id,"stage":stage,"completed":completed,"total":total}),
    );
}

fn start_job(
    state: &Arc<InferenceInner>,
    id: &str,
    session_id: Option<String>,
    model_write: Option<String>,
) -> Result<(Arc<Operation>, JobGuard), String> {
    uuid::Uuid::parse_str(id).map_err(|_| "INVALID_JOB_ID")?;
    let operation = Arc::new(Operation {
        cancelled: AtomicBool::new(false),
        changed: Notify::new(),
        run: Mutex::new(None),
        session_id,
    });
    let mut operations = state.operations.lock().unwrap();
    if operations.contains_key(id) {
        return Err("INFERENCE_BUSY".into());
    }
    if let Some(model) = &model_write {
        if !state.model_writes.lock().unwrap().insert(model.clone()) {
            return Err("MODEL_BUSY".into());
        }
    }
    operations.insert(id.into(), operation.clone());
    Ok((
        operation,
        JobGuard {
            inner: state.clone(),
            id: id.into(),
            model_write,
        },
    ))
}

fn verify_file(path: &Path, expected: &ModelFile, operation: &Operation) -> Result<(), String> {
    let mut file =
        fs::File::open(path).map_err(|e| format!("MISSING_FILE: {} ({e})", expected.name))?;
    if file.metadata().map_err(|e| e.to_string())?.len() != expected.bytes {
        return Err(format!("FILE_SIZE: {}", expected.name));
    }
    let mut hash = Sha256::new();
    let mut buffer = vec![0; 1024 * 1024];
    loop {
        operation.check()?;
        let size = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if size == 0 {
            break;
        }
        hash.update(&buffer[..size]);
    }
    if format!("{:x}", hash.finalize()) != expected.sha256 {
        return Err(format!("FILE_HASH: {}", expected.name));
    }
    Ok(())
}

// 每次只清理此安装清单中的确切文件；绝不递归删除用户选择的目录。
fn remove_generation(directory: &Path, model: &Model, generation: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(generation).map_err(|_| "MODEL_RECORD_INVALID")?;
    let target = directory.join(generation);
    for file in &model.files {
        let path = target.join(&file.name);
        if path.is_file() {
            fs::remove_file(&path)
                .map_err(|e| format!("MODEL_REMOVE_FAILED: {} ({e})", file.name))?;
        }
    }
    if target.exists() {
        fs::remove_dir(target).map_err(|e| format!("MODEL_REMOVE_FAILED: {e}"))?;
    }
    Ok(())
}

fn commit_model(
    directory: &Path,
    model: &Model,
    generation: &str,
    operation: &Operation,
) -> Result<ModelRecord, String> {
    for file in &model.files {
        verify_file(
            &directory.join(generation).join(&file.name),
            file,
            operation,
        )?;
    }
    operation.check()?;
    let record = ModelRecord {
        generation: generation.into(),
        imported_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64,
        bytes: model.files.iter().map(|f| f.bytes).sum(),
    };
    // 先完整校验新目录，再原子替换指针；下载中断不会破坏原来可用的模型。
    let mut manifest = tempfile::NamedTempFile::new_in(directory).map_err(|e| e.to_string())?;
    serde_json::to_writer(&mut manifest, &record).map_err(|e| e.to_string())?;
    manifest.as_file().sync_all().map_err(|e| e.to_string())?;
    manifest
        .persist(directory.join("active.json"))
        .map_err(|e| e.to_string())?;
    Ok(record)
}

fn import_into(
    directory: &Path,
    model: &Model,
    selected: &[PathBuf],
    operation: &Operation,
    app: &AppHandle,
    job_id: &str,
) -> Result<(), String> {
    for (index, expected) in model.files.iter().enumerate() {
        operation.check()?;
        let output_path = directory.join(&expected.name);
        let mut output = fs::File::create(output_path).map_err(|e| e.to_string())?;
        if let Some(path) = selected
            .iter()
            .find(|path| path.file_name().and_then(|s| s.to_str()) == Some(&expected.name))
        {
            let mut input = fs::File::open(path).map_err(|e| e.to_string())?;
            copy_model_file(&mut input, &mut output, expected.bytes, operation)?;
        } else {
            let mut found = false;
            for path in selected.iter().filter(|p| {
                p.extension()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("zip"))
            }) {
                let mut archive =
                    zip::ZipArchive::new(fs::File::open(path).map_err(|e| e.to_string())?)
                        .map_err(|e| format!("MODEL_ARCHIVE_INVALID: {e}"))?;
                if let Ok(mut entry) =
                    archive.by_name(expected.archive_path.as_deref().unwrap_or(&expected.name))
                {
                    copy_model_file(&mut entry, &mut output, expected.bytes, operation)?;
                    found = true;
                    break;
                };
            }
            if !found {
                return Err(format!("MISSING_FILE: {}", expected.name));
            }
        }
        output.sync_all().map_err(|e| e.to_string())?;
        progress(
            app,
            job_id,
            "importing",
            index as u64 + 1,
            model.files.len() as u64,
        );
    }
    Ok(())
}

fn copy_model_file(
    input: &mut impl Read,
    output: &mut impl Write,
    limit: u64,
    operation: &Operation,
) -> Result<(), String> {
    let mut buffer = vec![0; 1024 * 1024];
    let mut count = 0;
    loop {
        operation.check()?;
        let bytes = input.read(&mut buffer).map_err(|e| e.to_string())?;
        if bytes == 0 {
            break;
        }
        count += bytes as u64;
        if count > limit {
            return Err("FILE_SIZE: selected file exceeds the model manifest".into());
        }
        output
            .write_all(&buffer[..bytes])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 读取一个固定模型的安装状态；不加载权重或启动推理。
#[tauri::command]
pub async fn inference_model_status(
    app: AppHandle,
    model_id: String,
) -> Result<Option<ModelRecord>, String> {
    let model = model(&model_id)?;
    let directory = model_dir(&app, &model)?;
    tauri::async_runtime::spawn_blocking(move || {
        let record = read_record(&directory)?;
        if let Some(record) = &record {
            for file in &model.files {
                if fs::metadata(directory.join(&record.generation).join(&file.name))
                    .map(|m| m.len())
                    .unwrap_or(0)
                    != file.bytes
                {
                    return Ok(None);
                }
            }
        }
        Ok(record)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 导入用户明确选择的模型文件或 ZIP，校验大小和摘要后切换安装版本。
#[tauri::command]
pub async fn inference_model_import(
    app: AppHandle,
    state: State<'_, InferenceState>,
    model_id: String,
    paths: Vec<String>,
    job_id: String,
) -> Result<ModelRecord, String> {
    if paths.is_empty() || paths.iter().any(|path| !Path::new(path).is_absolute()) {
        return Err("MODEL_IMPORT_REQUIRES_SELECTED_FILES".into());
    }
    let model = model(&model_id)?;
    let directory = model_dir(&app, &model)?;
    let inner = state.inner.clone();
    let (operation, _job) = start_job(&inner, &job_id, None, Some(model_id.clone()))?;
    let old = read_record(&directory)?;
    let generation = uuid::Uuid::new_v4().to_string();
    let work_dir = directory.join(&generation);
    let result = tauri::async_runtime::spawn_blocking(move || {
        fs::create_dir_all(&work_dir).map_err(|e| e.to_string())?;
        let result = import_into(
            &work_dir,
            &model,
            &paths.into_iter().map(PathBuf::from).collect::<Vec<_>>(),
            &operation,
            &app,
            &job_id,
        )
        .and_then(|_| commit_model(&directory, &model, &generation, &operation));
        if result.is_err() {
            let _ = remove_generation(&directory, &model, &generation);
        }
        if result.is_ok() {
            if let Some(old) = old {
                let _ = remove_generation(&directory, &model, &old.generation);
            }
        }
        result
    })
    .await
    .map_err(|e| e.to_string())?;
    result
}

/// 从固定模型清单下载权重；支持进度和取消，网络错误不会切换成浏览器推理。
#[tauri::command]
pub async fn inference_model_download(
    app: AppHandle,
    state: State<'_, InferenceState>,
    model_id: String,
    job_id: String,
) -> Result<ModelRecord, String> {
    use tokio::io::AsyncWriteExt;
    let model = model(&model_id)?;
    let directory = model_dir(&app, &model)?;
    let inner = state.inner.clone();
    let (operation, _job) = start_job(&inner, &job_id, None, Some(model_id.clone()))?;
    let generation = uuid::Uuid::new_v4().to_string();
    let work_dir = directory.join(&generation);
    let result = async {
        let old = read_record(&directory)?;
        tokio::fs::create_dir_all(&work_dir).await.map_err(|e| e.to_string())?;
        let client = reqwest::Client::builder().https_only(true).connect_timeout(Duration::from_secs(20)).timeout(Duration::from_secs(1800)).build().map_err(|e| e.to_string())?;
        let total: u64 = model.files.iter().map(|f| f.bytes).sum(); let mut downloaded = 0;
        let mut archives = HashMap::<String, Vec<u8>>::new();
        for expected in &model.files {
            operation.check()?;
            if expected.archive_path.is_some() && archives.contains_key(&expected.url) { continue; }
            let request = client.get(&expected.url).send();
            let mut response = tokio::select! { result = request => result.map_err(|e| format!("MODEL_DOWNLOAD_FAILED: {}", e.without_url()))?, _ = operation.changed.notified() => return Err(CANCELLED.into()) };
            if !response.status().is_success() { return Err(format!("MODEL_DOWNLOAD_FAILED: HTTP {} ({})", response.status().as_u16(), expected.name)); }
            let archive = expected.archive_path.is_some();
            let mut file = if archive { None } else { Some(tokio::fs::File::create(work_dir.join(&expected.name)).await.map_err(|e| e.to_string())?) };
            let mut bytes = Vec::new(); let mut received = 0_u64;
            loop {
                operation.check()?;
                let chunk = tokio::select! { result = response.chunk() => result.map_err(|e| format!("MODEL_DOWNLOAD_FAILED: {}", e.without_url()))?, _ = operation.changed.notified() => return Err(CANCELLED.into()) };
                let Some(chunk) = chunk else { break; };
                received += chunk.len() as u64;
                let limit = if archive { total + 2 * 1024 * 1024 } else { expected.bytes };
                if received > limit { return Err(format!("FILE_SIZE: {}", expected.name)); }
                if let Some(file) = &mut file { file.write_all(&chunk).await.map_err(|e| format!("MODEL_WRITE_FAILED: {e}"))?; } else { bytes.extend_from_slice(&chunk); }
                progress(&app, &job_id, "downloading", (downloaded + received).min(total), total);
            }
            if let Some(file) = &mut file { file.sync_all().await.map_err(|e| e.to_string())?; }
            if archive { archives.insert(expected.url.clone(), bytes); } else { downloaded += received; }
        }
        let model = model.clone(); let directory = directory.clone(); let work_dir = work_dir.clone(); let generation = generation.clone(); let operation = operation.clone(); let app = app.clone(); let job_id = job_id.clone();
        tauri::async_runtime::spawn_blocking(move || {
            for expected in &model.files {
                if let Some(entry_name) = &expected.archive_path {
                    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(&archives[&expected.url])).map_err(|e| format!("MODEL_ARCHIVE_INVALID: {e}"))?;
                    let mut entry = archive.by_name(entry_name).map_err(|_| format!("MISSING_FILE: {}", expected.name))?;
                    let mut output = fs::File::create(work_dir.join(&expected.name)).map_err(|e| e.to_string())?;
                    copy_model_file(&mut entry, &mut output, expected.bytes, &operation)?;
                    output.sync_all().map_err(|e| e.to_string())?;
                }
            }
            progress(&app, &job_id, "verifying", 0, 0);
            let record = commit_model(&directory, &model, &generation, &operation)?;
            if let Some(old) = old { let _ = remove_generation(&directory, &model, &old.generation); }
            Ok::<_, String>(record)
        }).await.map_err(|e| e.to_string())?
    }.await;
    if result.is_err() {
        let _ = remove_generation(&directory, &model, &generation);
    }
    result
}

/// 卸载一个固定模型的已安装文件；正在使用的会话必须先关闭。
#[tauri::command]
pub async fn inference_model_remove(
    app: AppHandle,
    state: State<'_, InferenceState>,
    model_id: String,
) -> Result<(), String> {
    let model = model(&model_id)?;
    let directory = model_dir(&app, &model)?;
    if state
        .inner
        .sessions
        .lock()
        .unwrap()
        .values()
        .any(|session| session.model_id == model_id)
    {
        return Err("MODEL_BUSY".into());
    }
    let (_, _job) = start_job(
        &state.inner,
        &uuid::Uuid::new_v4().to_string(),
        None,
        Some(model_id),
    )?;
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(record) = read_record(&directory)? {
            remove_generation(&directory, &model, &record.generation)?;
            fs::remove_file(directory.join("active.json")).map_err(|e| e.to_string())?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn environment(inner: &InferenceInner, runtime_dir: &Path) -> Result<Environment, String> {
    let mut runtime = inner.runtime.lock().unwrap();
    if runtime.is_none() {
        let dll = runtime_dir.join("onnxruntime.dll");
        if !dll.is_file() {
            return Err(
                "INFERENCE_RUNTIME_MISSING: run npm run prepare:runtime before packaging".into(),
            );
        }
        // 依赖 DLL 位于应用资源目录，显式预加载避免误用 PATH 中其它软件的 DirectML。
        let directml = unsafe { libloading::Library::new(runtime_dir.join("DirectML.dll")) }
            .map_err(|e| format!("INFERENCE_RUNTIME_MISSING: {e}"))?;
        let env = ort::init_from(&dll)
            .map_err(|e| format!("INFERENCE_RUNTIME_INVALID: {e}"))?
            .with_name("nai-desktop")
            .with_telemetry(false)
            .build()
            .map_err(|e| e.to_string())?;
        *runtime = Some(Runtime {
            environment: env,
            _libraries: vec![directml],
        });
    }
    Ok(runtime.as_ref().unwrap().environment.clone())
}

fn create_session(
    environment: &Environment,
    path: &Path,
    directml: bool,
) -> Result<Session, String> {
    let mut builder = Session::builder(environment)
        .map_err(|e| e.to_string())?
        .with_intra_threads(std::thread::available_parallelism().map_or(2, |n| n.get().min(8)))
        .map_err(|e| e.to_string())?;
    if directml {
        builder = builder
            .with_parallel_execution(false)
            .map_err(|e| e.to_string())?
            .with_memory_pattern(false)
            .map_err(|e| e.to_string())?
            .with_execution_providers([ep::DirectML::default()
                .with_performance_preference(ep::directml::PerformancePreference::HighPerformance)
                .build()
                .error_on_failure()])
            .map_err(|e| format!("DIRECTML_UNAVAILABLE: {e}"))?;
    }
    builder
        .commit_from_file(path)
        .map_err(|e| format!("MODEL_LOAD_FAILED: {e}"))
}

/// 按固定模型的兼容性选择 CPU 或 DirectML；原生测试和正式应用共用这条加载路径。
fn create_model_session(
    environment: &Environment,
    path: &Path,
    model: &Model,
    prefer_gpu: bool,
) -> Result<(Session, &'static str, Option<serde_json::Value>), String> {
    // PixAI 会发生原生访问冲突，Swin_UNet 会输出错误近黑图；这两种情况不能等待 Result 后回退。
    if model.preferred_backend.as_deref() == Some("cpu") {
        return Ok((
            create_session(environment, path, false)?,
            "cpu",
            Some(serde_json::json!({"code":"modelCpu"})),
        ));
    }
    if prefer_gpu {
        match create_session(environment, path, true) {
            Ok(session) => return Ok((session, "directml", None)),
            Err(error) => {
                return Ok((
                    create_session(environment, path, false)?,
                    "cpu",
                    Some(serde_json::json!({"code":"gpuFallback","detail":error})),
                ))
            }
        }
    }
    Ok((create_session(environment, path, false)?, "cpu", None))
}

/// 排队加载模型并返回实际计算设备和输入输出名；DirectML 失败明确返回 CPU 降级原因。
#[tauri::command]
pub async fn inference_open(
    app: AppHandle,
    state: State<'_, InferenceState>,
    model_id: String,
    session_id: String,
    job_id: String,
    prefer_gpu: bool,
) -> Result<serde_json::Value, String> {
    uuid::Uuid::parse_str(&session_id).map_err(|_| "INVALID_SESSION_ID")?;
    let model = model(&model_id)?;
    let directory = model_dir(&app, &model)?;
    let inner = state.inner.clone();
    let (operation, _job) = start_job(&inner, &job_id, Some(session_id.clone()), None)?;
    let runtime_dir = app
        .path()
        .resolve("resources/runtime", BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;
    progress(&app, &job_id, "queued", 0, 0);
    let permit = tokio::select! { permit = inner.queue.clone().acquire_owned() => permit.map_err(|e| e.to_string())?, _ = operation.changed.notified() => { inner.operations.lock().unwrap().remove(&job_id); return Err(CANCELLED.into()); } };
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit; operation.check()?;
        let record = read_record(&directory)?.ok_or("CACHE_MISSING")?;
        progress(&app, &job_id, "verifying", 0, 0);
        for expected in &model.files { verify_file(&directory.join(&record.generation).join(&expected.name), expected, &operation)?; }
        let env = environment(&inner, &runtime_dir)?;
        progress(&app, &job_id, "loading", 0, 0);
        let path = directory.join(&record.generation).join(&model.model_file);
        let (session, backend, notice) = create_model_session(&env, &path, &model, prefer_gpu)?;
        operation.check()?;
        let input_names: Vec<_> = session.inputs().iter().map(|v| v.name().to_string()).collect();
        let output_names: Vec<_> = session.outputs().iter().map(|v| v.name().to_string()).collect();
        let labels = model.labels_file.as_ref().map(|file| fs::read_to_string(directory.join(&record.generation).join(file)).map_err(|e| e.to_string())).transpose()?;
        let mut sessions = inner.sessions.lock().unwrap();
        operation.check()?;
        sessions.insert(session_id.clone(), Arc::new(LoadedModel { model_id, session: Mutex::new(session) }));
        Ok(serde_json::json!({"sessionId":session_id,"backend":backend,"notice":notice,"inputNames":input_names,"outputNames":output_names,"labels":labels}))
    }).await.map_err(|e| e.to_string())?;
    result
}

/// 接收二进制 Float32 输入，在计算队列执行后返回带形状头的二进制输出。
/// 请求头包括 x-session-id、x-job-id、x-input-name、x-input-shape；正文不使用 JSON 数字数组。
#[tauri::command]
pub async fn inference_run(
    state: State<'_, InferenceState>,
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
    tensor_run(state, session_id, job_id, input_name, shape, bytes)
        .await
        .map(Response::new)
}
pub(crate) async fn tensor_run(
    state: State<'_, InferenceState>,
    session_id: String,
    job_id: String,
    input_name: String,
    shape: Vec<i64>,
    bytes: Vec<u8>,
) -> Result<Vec<u8>, String> {
    if shape.len() != 4 || shape.iter().any(|v| *v <= 0) {
        return Err("INVALID_TENSOR_SHAPE".into());
    }
    let expected_size = shape
        .iter()
        .try_fold(1_usize, |size, value| size.checked_mul(*value as usize))
        .ok_or("INVALID_TENSOR_SHAPE")?;
    if expected_size > 3 * 1008 * 1008 {
        return Err("TENSOR_TOO_LARGE".into());
    }
    if bytes.len() != expected_size * 4 {
        return Err("INVALID_TENSOR_BYTES".into());
    }
    let inner = state.inner.clone();
    let session = inner
        .sessions
        .lock()
        .unwrap()
        .get(&session_id)
        .cloned()
        .ok_or("SESSION_MISSING")?;
    let selected = model(&session.model_id)?;
    let size = selected
        .input_size
        .or(selected.tile_size)
        .ok_or("INVALID_TENSOR_MODEL")? as i64;
    let expected_shape = if selected.kind == "tagger" && selected.input_layout == "NHWC" {
        vec![1, size, size, 3]
    } else {
        vec![1, 3, size, size]
    };
    if shape != expected_shape {
        return Err("INVALID_TENSOR_SHAPE".into());
    }
    let (operation, _job) = start_job(&inner, &job_id, Some(session_id), None)?;
    let permit = tokio::select! { permit = inner.queue.clone().acquire_owned() => permit.map_err(|e| e.to_string())?, _ = operation.changed.notified() => { inner.operations.lock().unwrap().remove(&job_id); return Err(CANCELLED.into()); } };
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit; operation.check()?;
        let data: Vec<f32> = bytes.as_chunks::<4>().0.iter().map(|b| f32::from_le_bytes(*b)).collect();
        let input = Tensor::from_array((shape, data)).map_err(|e| e.to_string())?;
        let run = Arc::new(RunOptions::new().map_err(|e| e.to_string())?);
        *operation.run.lock().unwrap() = Some(run.clone()); operation.check()?;
        let mut session = session.session.lock().unwrap();
        let outputs = session.run_with_options(ort::inputs![input_name.as_str() => input], &run).map_err(|e| if operation.cancelled.load(Ordering::Acquire) { CANCELLED.into() } else { format!("INFERENCE_FAILED: {e}") })?;
        let mut metadata = Vec::new(); let mut payload = Vec::new();
        for (name, value) in outputs.iter() {
            let (shape, values) = value.try_extract_tensor::<f32>().map_err(|e| format!("MODEL_OUTPUT_INVALID: {e}"))?;
            metadata.push(serde_json::json!({"name":name,"dims":shape.iter().copied().collect::<Vec<_>>(),"offset":payload.len(),"length":values.len()}));
            for value in values { payload.extend_from_slice(&value.to_le_bytes()); }
        }
        let mut encoded = serde_json::to_vec(&metadata).map_err(|e| e.to_string())?;
        while encoded.len() % 4 != 0 { encoded.push(b' '); }
        let mut result = Vec::with_capacity(4 + encoded.len() + payload.len());
        result.extend_from_slice(&(encoded.len() as u32).to_le_bytes()); result.extend(encoded); result.extend(payload);
        operation.check()?;
        Ok(result)
    }).await.map_err(|e| e.to_string())?;
    result
}

/// 取消下载、排队或正在运行的计算；不会影响其他任务。
#[tauri::command]
pub fn inference_cancel(state: State<'_, InferenceState>, job_id: String) {
    if let Some(operation) = state.inner.operations.lock().unwrap().get(&job_id) {
        operation.cancel();
    }
}

/// 释放一个页面的模型会话并取消其在途操作。
#[tauri::command]
pub fn inference_close(state: State<'_, InferenceState>, session_id: String) {
    for operation in state
        .inner
        .operations
        .lock()
        .unwrap()
        .values()
        .filter(|op| op.session_id.as_deref() == Some(&session_id))
    {
        operation.cancel();
    }
    state.inner.sessions.lock().unwrap().remove(&session_id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::BufRead;

    #[test]
    fn manifest_contains_complete_pinned_models() {
        let models: Vec<Model> = serde_json::from_str(MANIFEST).unwrap();
        assert_eq!(models.iter().filter(|m| m.kind == "tagger").count(), 4);
        assert_eq!(models.iter().filter(|m| m.kind == "upscale").count(), 5);
        for model in models {
            assert!(model.files.iter().any(|file| file.name == model.model_file));
            for file in model.files {
                assert_eq!(Path::new(&file.name).components().count(), 1);
                assert!(file.url.starts_with("https://"));
                assert_eq!(file.sha256.len(), 64);
            }
        }
    }

    #[test]
    fn cancelled_job_releases_registration() {
        let state = InferenceState::default();
        assert!(!state.is_busy().unwrap());
        let id = uuid::Uuid::new_v4().to_string();
        let (operation, job) = start_job(&state.inner, &id, None, None).unwrap();
        assert!(state.is_busy().unwrap());
        operation.cancel();
        assert_eq!(operation.check().unwrap_err(), CANCELLED);
        // 取消信号不等于工作已经退出；安装需等 JobGuard 真正释放。
        assert!(state.is_busy().unwrap());
        drop(job);
        assert!(!state.is_busy().unwrap());
        assert!(state.inner.operations.lock().unwrap().is_empty());
    }

    #[test]
    fn corrupt_import_preserves_previous_installation() {
        let directory = tempfile::tempdir().unwrap();
        let model = Model {
            id: "test".into(),
            version: Some("1".into()),
            revision: None,
            kind: "upscale".into(),
            input_layout: "NCHW".into(),
            preferred_backend: None,
            model_file: "model.onnx".into(),
            labels_file: None,
            input_size: None,
            tile_size: Some(128),
            files: vec![ModelFile {
                name: "model.onnx".into(),
                url: "https://example.invalid/model.onnx".into(),
                bytes: 3,
                sha256: format!("{:x}", Sha256::digest(b"abc")),
                archive_path: None,
            }],
        };
        let operation = Operation {
            cancelled: AtomicBool::new(false),
            changed: Notify::new(),
            run: Mutex::new(None),
            session_id: None,
        };
        let first = uuid::Uuid::new_v4().to_string();
        fs::create_dir(directory.path().join(&first)).unwrap();
        fs::write(directory.path().join(&first).join("model.onnx"), b"abc").unwrap();
        commit_model(directory.path(), &model, &first, &operation).unwrap();
        let second = uuid::Uuid::new_v4().to_string();
        fs::create_dir(directory.path().join(&second)).unwrap();
        fs::write(directory.path().join(&second).join("model.onnx"), b"xyz").unwrap();
        assert!(commit_model(directory.path(), &model, &second, &operation)
            .unwrap_err()
            .starts_with("FILE_HASH:"));
        assert_eq!(
            read_record(directory.path()).unwrap().unwrap().generation,
            first
        );
        fs::write(directory.path().join(&second).join("model.onnx"), b"abc").unwrap();
        commit_model(directory.path(), &model, &second, &operation).unwrap();
        assert_eq!(
            read_record(directory.path()).unwrap().unwrap().generation,
            second
        );
        // 测试临时目录仅含测试自行写入的四个确切文件，按文件清理避免递归删除。
        remove_generation(directory.path(), &model, &first).unwrap();
        remove_generation(directory.path(), &model, &second).unwrap();
        fs::remove_file(directory.path().join("active.json")).unwrap();
    }

    #[test]
    #[ignore = "需要已下载并校验的模型与官方原生运行库"]
    fn real_quicksr_cpu_directml_and_cancellation() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let state = InferenceState::default();
        let env = environment(&state.inner, &root.join("resources/runtime")).unwrap();
        let file = root
            .join("../output/inference-validation/models/quicksrnet-small/quicksrnetsmall.onnx");
        let data: Vec<f32> = (0..3 * 128 * 128)
            .map(|i| (i % 255) as f32 / 255.0)
            .collect();
        let mut reference = Vec::new();
        for gpu in [false, true] {
            let started = std::time::Instant::now();
            let mut session = create_session(&env, &file, gpu).unwrap();
            let tensor = Tensor::from_array(([1_i64, 3, 128, 128], data.clone())).unwrap();
            let result = session.run(ort::inputs![tensor]).unwrap();
            let (shape, values) = result[0].try_extract_tensor::<f32>().unwrap();
            assert_eq!(
                shape.iter().copied().collect::<Vec<_>>(),
                vec![1, 3, 512, 512]
            );
            assert!(values.iter().all(|value| value.is_finite()));
            if gpu {
                let max_error = reference
                    .iter()
                    .zip(values)
                    .map(|(a, b): (&f32, &f32)| (a - b).abs())
                    .fold(0.0_f32, f32::max);
                assert!(
                    max_error < 0.005,
                    "CPU/DirectML output differs: {max_error}"
                );
                eprintln!("QuickSR DirectML maximum CPU difference: {max_error}");
            } else {
                reference = values.to_vec();
            }
            drop(result);
            let cancelled = RunOptions::new().unwrap();
            cancelled.terminate().unwrap();
            let tensor = Tensor::from_array(([1_i64, 3, 128, 128], data.clone())).unwrap();
            assert!(session
                .run_with_options(ort::inputs![tensor], &cancelled)
                .is_err());
            eprintln!(
                "QuickSR {} inference and cancellation verified in {:?}",
                if gpu { "DirectML" } else { "CPU" },
                started.elapsed()
            );
        }
    }

    #[test]
    #[ignore = "需要下载固定清单中的全部模型"]
    fn all_fixed_models_load_in_native_runtime() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let state = InferenceState::default();
        let env = environment(&state.inner, &root.join("resources/runtime")).unwrap();
        let operation = Operation {
            cancelled: AtomicBool::new(false),
            changed: Notify::new(),
            run: Mutex::new(None),
            session_id: None,
        };
        for model in serde_json::from_str::<Vec<Model>>(MANIFEST).unwrap() {
            let directory = root
                .join("../output/inference-validation/models")
                .join(&model.id);
            for file in &model.files {
                verify_file(&directory.join(&file.name), file, &operation).unwrap();
            }
            let started = std::time::Instant::now();
            let session = create_session(&env, &directory.join(&model.model_file), false).unwrap();
            assert_eq!(session.inputs().len(), 1);
            assert!(!session.outputs().is_empty());
            eprintln!(
                "{} CPU model load verified in {:?}",
                model.id,
                started.elapsed()
            );
            drop(session);
        }
    }

    // 供 scripts/verify-native-inference.mjs 使用的测试进程，不编译进桌面安装包。
    // 原始 tensor 通过测试目录中的二进制文件交换，stdout 只返回形状和完成状态。
    #[test]
    #[ignore = "仅由真实样本验证脚本启动；通过 stdin 接收测试任务"]
    fn native_fixture_bridge() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let model = model(&std::env::var("NAI_INFERENCE_VALIDATION_MODEL").unwrap()).unwrap();
        let requested_gpu =
            std::env::var("NAI_INFERENCE_VALIDATION_BACKEND").unwrap() == "directml";
        let state = InferenceState::default();
        let env = environment(&state.inner, &root.join("resources/runtime")).unwrap();
        let directory = root
            .join("../output/inference-validation/models")
            .join(&model.id);
        let artifact = root
            .join("../output/inference-validation/bridge")
            .join(format!(
                "{}-{}",
                model.id,
                if requested_gpu { "directml" } else { "cpu" }
            ));
        fs::create_dir_all(&artifact).unwrap();
        let (mut session, backend, fallback) = create_model_session(
            &env,
            &directory.join(&model.model_file),
            &model,
            requested_gpu,
        )
        .unwrap();
        println!(
            "NAI_NATIVE:{}",
            serde_json::json!({"ready":true,"backend":backend,"fallback":fallback,"inputNames":session.inputs().iter().map(|v| v.name()).collect::<Vec<_>>(),"outputNames":session.outputs().iter().map(|v| v.name()).collect::<Vec<_>>()})
        );
        std::io::stdout().flush().unwrap();
        for line in std::io::stdin().lock().lines() {
            let request: serde_json::Value = serde_json::from_str(&line.unwrap()).unwrap();
            let id = request["id"].as_u64().unwrap();
            let shape: Vec<i64> = serde_json::from_value(request["dims"].clone()).unwrap();
            let data = fs::read(artifact.join("input.bin"))
                .unwrap()
                .as_chunks::<4>()
                .0
                .iter()
                .map(|bytes| f32::from_le_bytes(*bytes))
                .collect::<Vec<_>>();
            let input = Tensor::from_array((shape, data)).unwrap();
            let run = Arc::new(RunOptions::new().unwrap());
            let cancel_thread = request["cancelAfterMs"].as_u64().map(|delay| {
                let run = run.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(delay));
                    run.terminate().unwrap();
                })
            });
            let started = std::time::Instant::now();
            let output = session.run_with_options(
                ort::inputs![request["inputName"].as_str().unwrap() => input],
                &run,
            );
            if let Some(thread) = cancel_thread {
                thread.join().unwrap();
            }
            let response = match output {
                Err(error) => {
                    serde_json::json!({"id":id,"error":error.to_string(),"milliseconds":started.elapsed().as_secs_f64()*1000.0})
                }
                Ok(output) => {
                    let mut raw = Vec::new();
                    let mut metadata = Vec::new();
                    for (name, value) in output.iter() {
                        let (dims, data) = value.try_extract_tensor::<f32>().unwrap();
                        metadata.push(serde_json::json!({"name":name,"dims":dims.iter().copied().collect::<Vec<_>>(),"offset":raw.len(),"length":data.len()}));
                        for value in data {
                            raw.extend_from_slice(&value.to_le_bytes());
                        }
                    }
                    fs::write(artifact.join("output.bin"), &raw).unwrap();
                    serde_json::json!({"id":id,"outputs":metadata,"milliseconds":started.elapsed().as_secs_f64()*1000.0})
                }
            };
            println!("NAI_NATIVE:{}", response);
            std::io::stdout().flush().unwrap();
        }
    }
}
