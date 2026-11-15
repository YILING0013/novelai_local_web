fn main() {
    // The unit-test executable also imports TaskDialogIndirect from comctl32 v6.
    // tauri-build embeds these controls for the application binary only.
    println!("cargo:rerun-if-env-changed=NOVELAI_UNIT_TEST_MANIFEST");
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
        && std::env::var_os("NOVELAI_UNIT_TEST_MANIFEST").is_some()
    {
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'");
    }
    tauri_build::build();
}
