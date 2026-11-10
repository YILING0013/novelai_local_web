"""Build the per-user Windows x64 installer from source and locked runtime wheels."""
import argparse
import hashlib
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

DESKTOP = Path(__file__).resolve().parent
ROOT = DESKTOP.parent
BACKEND = ROOT / "nai_flask"
FRONTEND = ROOT / "next_nai_web"
ICON = FRONTEND / "src/app/favicon.ico"
SDK = "1.0.4258.31"
SDK_HASH = "56f7f4b8bf9aee4b8efefbbdd4f67d5f74ebd1b100ed0806da71bf76af481aa9"


def download(url, target):
    if not target.exists():
        part = target.with_suffix(".part")
        urllib.request.urlretrieve(url, part)
        part.replace(target)
    return target


def build_host(dest, cache, source=False):
    dest.mkdir(parents=True, exist_ok=True)
    sdk = download(f"https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/{SDK}/"
                   f"microsoft.web.webview2.{SDK}.nupkg", cache / "webview2.nupkg")
    with sdk.open("rb") as file:
        digest = hashlib.file_digest(file, "sha256").hexdigest()
    if digest != SDK_HASH:
        raise ValueError(f"Incorrect SDK hash: {sdk}")
    with zipfile.ZipFile(sdk) as archive:
        for name in ("lib/net462/Microsoft.Web.WebView2.Core.dll", "lib/net462/Microsoft.Web.WebView2.WinForms.dll",
                     "runtimes/win-x64/native/WebView2Loader.dll", "LICENSE.txt", "NOTICE.txt"):
            target = dest / Path(name).name
            if name.endswith(".txt"):
                target = dest / ("WebView2-" + name)
            target.write_bytes(archive.read(name))
    compiler = Path(os.environ["WINDIR"]) / "Microsoft.NET/Framework64/v4.0.30319/csc.exe"
    subprocess.run([compiler, "/nologo", "/platform:x64", "/target:winexe", "/optimize+", "/utf8output",
                    *(["/define:SOURCE_WORKSPACE"] if source else []),
                    f"/win32icon:{ICON}", f"/win32manifest:{DESKTOP / 'app.manifest'}",
                    f"/out:{dest / 'NovelAI Local.exe'}",
                    *[f"/reference:{p}" for p in dest.glob("Microsoft.Web.WebView2.*.dll")],
                    DESKTOP / "LocalDesktop.cs", DESKTOP / "DesktopWindow.cs"], check=True)


def stage_python(dest, cache, redist):
    base = Path(sys.base_prefix)
    dest.mkdir()
    for name in ("python.exe", "python3.dll", "python312.dll", "LICENSE.txt"):
        shutil.copy2(base / name, dest)
    omit = shutil.ignore_patterns("__pycache__", "*.pyc", "*.pdb", "site-packages", "ensurepip",
                                  "test", "tests", "_test*.pyd", "_ctypes_test.pyd", "idlelib", "tkinter", "turtledemo")
    shutil.copytree(base / "DLLs", dest / "DLLs", ignore=omit)
    shutil.copytree(base / "Lib", dest / "Lib", ignore=omit)
    if not (redist / "msvcp140.dll").is_file():
        raise ValueError("Pass --crt with the Visual C++ x64 redistributable CRT directory.")
    for dll in redist.glob("*.dll"):
        shutil.copy2(dll, dest)
    target = dest / "Lib/site-packages"
    subprocess.run([sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "--no-compile",
                    "--only-binary=:all:", "--require-hashes", "--find-links", str(cache / "wheels"),
                    "--target", target, "-r", DESKTOP / "requirements-win-x64.lock"], check=True)
    # pip's generated console entry points reference the build machine's interpreter.
    # The application uses the libraries directly.
    commands = target / "bin"
    if commands.is_dir():
        for command in commands.iterdir():
            command.unlink()
        commands.rmdir()
    # Exercise native imports using only the packaged interpreter before building the installer.
    subprocess.run([dest / "python.exe", "-I", "-B", "-c",
                    "import cv2, onnxruntime, rapidocr, nacl.bindings, PIL, openai, anthropic, google.genai"], check=True)


def tracked(directory):
    result = subprocess.check_output(["git", "-C", ROOT, "ls-files", "-z", "--", directory])
    return [Path(p.decode("utf-8")) for p in result.split(b"\0") if p]


def stage_app(payload):
    backend_files = [Path("nai_flask/app.py"), Path("nai_flask/desktop_service.py"),
                     *tracked("nai_flask/api_utils"), *tracked("nai_flask/prompt_tags")]
    for rel in backend_files:
        (payload / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / rel, payload / rel)
    # The Next export copies public/ wholesale. Only include the repository's published assets.
    out = FRONTEND / "out"
    target = payload / "next_nai_web/out"
    target.mkdir(parents=True)
    shutil.copytree(out / "_next", target / "_next")
    for name in ("index.html", "index.txt", "login.html", "login.txt", "main.html", "main.txt", "404.html", "favicon.ico"):
        shutil.copy2(out / name, target / name)
    for rel in tracked("next_nai_web/public"):
        asset = rel.relative_to("next_nai_web/public")
        (target / asset).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(out / asset, target / asset)
    shutil.copytree(DESKTOP / "build/ui", payload / "desktop/build/ui")
    shutil.copy2(ROOT / "LICENSE", payload)


def installer(payload, cache, output, makensis):
    runtime = download("https://go.microsoft.com/fwlink/p/?LinkId=2124701", cache / "webview2-runtime.exe")
    subprocess.run(["powershell.exe", "-NoProfile", "-Command",
                    "$s=Get-AuthenticodeSignature -LiteralPath $env:NAI_RUNTIME_FILE; "
                    "if ($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch '^CN=Microsoft Corporation,') { exit 1 }"],
                   check=True, env={**{k: v for k, v in os.environ.items() if k.upper() != "PSMODULEPATH"},
                                    "NAI_RUNTIME_FILE": str(runtime)})
    manifest = payload.parent / "uninstall-files.nsh"
    lines = []
    for p in sorted(payload.rglob("*"), reverse=True):
        command = "RMDir" if p.is_dir() else "Delete"
        name = str(p.relative_to(payload)).replace("$", "$$")
        lines.append(f'{command} "$INSTDIR\\{name}"')
    manifest.write_text("\n".join(lines), encoding="utf-8-sig")
    subprocess.run([makensis, "/V2", "/INPUTCHARSET", "UTF8", f"/DOUTPUT={output}", f"/DICON={ICON}",
                    f"/DPAYLOAD={payload}", f"/DWEBVIEW_RUNTIME={runtime}", f"/DUNINSTALL_FILES={manifest}",
                    DESKTOP / "installer.nsi"], check=True)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--host-only", action="store_true", help="build a launcher for the source checkout")
    p.add_argument("--cache", type=Path, default=DESKTOP / "build/cache")
    p.add_argument("--output", type=Path, default=ROOT / "output/NovelAI-Local-1.1.0-windows-x64-setup.exe")
    p.add_argument("--crt", type=Path)
    p.add_argument("--makensis", default="makensis.exe")
    args = p.parse_args()
    if os.name != "nt" or struct.calcsize("P") != 8:
        p.error("Use Windows and x64 Python.")
    cache = args.cache.resolve()
    cache.mkdir(parents=True, exist_ok=True)
    if args.host_only:
        subprocess.run(["npm.cmd", "run", "build:desktop"], cwd=FRONTEND, check=True)
        build_host(DESKTOP / "build/dev", cache, source=True)
        return
    if sys.version_info[:2] != (3, 12) or args.crt is None:
        p.error("Packaging requires x64 CPython 3.12 and --crt.")
    (cache / "wheels").mkdir(exist_ok=True)
    subprocess.run(["npm.cmd", "ci"], cwd=FRONTEND, check=True)
    subprocess.run(["npm.cmd", "run", "build"], cwd=FRONTEND, check=True)
    subprocess.run(["npm.cmd", "run", "build:desktop"], cwd=FRONTEND, check=True)
    subprocess.run([sys.executable, ROOT / "scripts/verify_release.py"], check=True)
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="package-", dir=cache) as tmp:
        payload = Path(tmp) / "app"
        build_host(payload, cache)
        stage_python(payload / "runtime", cache, args.crt)
        stage_app(payload)
        installer(payload, cache, output, args.makensis)
    print(output)


if __name__ == "__main__":
    main()
