//! Android 的 Capacitor 插件在后台线程调用这些入口。

use crate::service::{Core, Shared, APP_CALLER};
use jni::{
    objects::{GlobalRef, JByteArray, JClass, JString, JValue},
    sys::jstring,
    JNIEnv, JavaVM,
};
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    ptr,
    sync::OnceLock,
};

static JAVA: OnceLock<(JavaVM, GlobalRef)> = OnceLock::new();
static CORE: OnceLock<(Shared, tokio::runtime::Runtime)> = OnceLock::new();

/// 由系统密钥库加密或解密。Rust 的 Tokio 线程临时加入 JVM，不把凭据交给 WebView。
pub fn crypt(bytes: &[u8], method: &str) -> Result<Vec<u8>, String> {
    let (vm, class) = JAVA.get().ok_or("KEYSTORE_UNAVAILABLE")?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|_| "KEYSTORE_UNAVAILABLE")?;
    let result = env.with_local_frame(16, |env| {
        let input = env.byte_array_from_slice(bytes)?;
        let class: &JClass = class.as_obj().into();
        let output = env
            .call_static_method(class, method, "([B)[B", &[JValue::Object(&input)])?
            .l()?;
        env.convert_byte_array(JByteArray::from(output))
    });
    if env.exception_check().unwrap_or(false) {
        let _ = env.exception_clear();
    }
    result.map_err(|_| "KEYSTORE_ERROR".into())
}

#[no_mangle]
pub extern "system" fn Java_cc_idlecloud_nai_local_AndroidCore_initialize(
    mut env: JNIEnv,
    class: JClass,
    data: JString,
    resources: JString,
    libraries: JString,
) -> jstring {
    let result = (|| -> Result<(), String> {
        if CORE.get().is_some() {
            return Ok(());
        }
        let paths: Vec<String> = [data, resources, libraries]
            .iter()
            .map(|s| {
                env.get_string(s)
                    .map(Into::into)
                    .map_err(|_| "Invalid Android app directories")
            })
            .collect::<Result<_, _>>()?;
        JAVA.set((
            env.get_java_vm().map_err(|_| "JVM unavailable")?,
            env.new_global_ref(class)
                .map_err(|_| "Keystore bridge unavailable")?,
        ))
        .ok();
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .worker_threads(2)
            .build()
            .map_err(|_| "Could not start local runtime")?;
        let core = Core::open_with_runtime(
            Path::new(&paths[0]),
            Path::new(&paths[1]),
            PathBuf::from(&paths[2]),
        )
        .map_err(|f| f.2)?;
        CORE.set((core, runtime))
            .map_err(|_| "Local workspace already initialized")?;
        Ok(())
    })();
    match result {
        Ok(()) => ptr::null_mut(),
        Err(error) => env
            .new_string(error)
            .map_or(ptr::null_mut(), JString::into_raw),
    }
}

#[no_mangle]
pub extern "system" fn Java_cc_idlecloud_nai_local_AndroidCore_request(
    mut env: JNIEnv,
    _: JClass,
    method: JString,
    path: JString,
    body: JString,
) -> jstring {
    let result = (|| {
        let (core, runtime) = CORE.get()?;
        let method: String = env.get_string(&method).ok()?.into();
        let path: String = env.get_string(&path).ok()?.into();
        let body: String = env.get_string(&body).ok()?.into();
        let body: Value = serde_json::from_str(&body).ok()?;
        let reply = runtime.block_on(core.dispatch(APP_CALLER, &method, &path, body));
        env.new_string(serde_json::to_string(&reply).ok()?).ok()
    })();
    result.map_or(ptr::null_mut(), JString::into_raw)
}

#[no_mangle]
pub extern "system" fn Java_cc_idlecloud_nai_local_AndroidCore_asset(
    mut env: JNIEnv,
    _: JClass,
    path: JString,
) -> jstring {
    let result = (|| {
        let (core, _) = CORE.get()?;
        let path: String = env.get_string(&path).ok()?.into();
        let (file, mime) = core.asset_file(&path).ok()?;
        env.new_string(serde_json::json!({"file":file,"mime":mime}).to_string())
            .ok()
    })();
    result.map_or(ptr::null_mut(), JString::into_raw)
}
