#[cfg(windows)]
pub fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
    windows_protect(data, false)
}
#[cfg(windows)]
pub fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
    windows_protect(data, true)
}

#[cfg(windows)]
fn windows_protect(data: &[u8], decrypt: bool) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: data.len().try_into().map_err(|_| "CREDENTIALS_TOO_LARGE")?,
        pbData: data.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    // DPAPI 默认绑定当前 Windows 用户，安装包及备份中均不包含解密密钥。
    let success = unsafe {
        if decrypt {
            CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptProtectData(
                &input,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
    };
    if success == 0 {
        return Err("CREDENTIALS_PROTECTION_FAILED".into());
    }
    let result =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        LocalFree(output.pbData.cast());
    }
    Ok(result)
}

#[cfg(target_os = "android")]
pub fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
    crate::android::crypt(data, "protect")
}

#[cfg(target_os = "android")]
pub fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
    crate::android::crypt(data, "unprotect")
}

#[cfg(not(any(windows, target_os = "android")))]
pub fn protect(_: &[u8]) -> Result<Vec<u8>, String> {
    Err("WINDOWS_CREDENTIAL_STORAGE_REQUIRED".into())
}
#[cfg(not(any(windows, target_os = "android")))]
pub fn unprotect(_: &[u8]) -> Result<Vec<u8>, String> {
    Err("WINDOWS_CREDENTIAL_STORAGE_REQUIRED".into())
}
