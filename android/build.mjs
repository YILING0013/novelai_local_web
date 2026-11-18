import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const repo = fileURLToPath(new URL('..', import.meta.url));
const android = join(repo, 'android');
const frontend = join(repo, 'next_nai_web');
const generated = join(android, 'app/build/generated/nai');
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
const jdk = process.env.JAVA_HOME;
const windows = process.platform === 'win32';
if (!sdk || !jdk) throw new Error('Set ANDROID_HOME and JAVA_HOME before building.');

mkdirSync(generated, { recursive: true });
// 每次只打包当前构建的资源，避免把上次构建的旧脚本混进 APK。
const assets = mkdtempSync(join(generated, 'assets-'));
const env = {
  ...process.env,
  ANDROID_HOME: sdk,
  ANDROID_NDK_HOME: join(sdk, 'ndk/28.2.13676358'),
  NAI_ANDROID_ASSETS: assets,
  RUSTFLAGS: [process.env.RUSTFLAGS, '-C link-arg=-Wl,-z,max-page-size=16384'].filter(Boolean).join(' '),
};
function run(executable, args, cwd) {
  const result = spawnSync(executable, args, { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.execPath, [join(frontend, 'desktop/verify-assets.mjs'), '--public-only'], frontend);
mkdirSync(join(assets, 'prompt_tags'));
for (const name of readdirSync(join(repo, 'nai_flask/prompt_tags')).filter(name => name.endsWith('.csv'))) {
  copyFileSync(join(repo, 'nai_flask/prompt_tags', name), join(assets, 'prompt_tags', name));
}
copyFileSync(join(repo, 'LICENSE'), join(assets, 'AGPL-3.0.txt'));
run(process.execPath, [join(frontend, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'android.vite.mjs'], frontend);
run('cargo', ['ndk', '-t', 'arm64-v8a', '-t', 'x86_64', '--platform', '24',
  '-o', join(generated, 'jniLibs'), 'build', '--lib', '--release', '--locked'], join(repo, 'src-tauri'));
run(join(jdk, 'bin', windows ? 'java.exe' : 'java'), [
  '-classpath', join(android, 'gradle/wrapper/gradle-wrapper.jar'), 'org.gradle.wrapper.GradleWrapperMain',
  '--no-daemon', `-PnaiAssets=${assets}`, ...(process.argv.slice(2).length ? process.argv.slice(2) : [':app:assembleDebug']),
], android);
