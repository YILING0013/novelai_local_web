import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { unzipSync } from 'fflate';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cache = resolve(root, 'output/runtime-downloads');
const destination = resolve(root, 'src-tauri/resources/runtime');
const packages = [
  {
    name: 'microsoft.ml.onnxruntime.directml', version: '1.24.4',
    sha256: '57e9f11b73437bef7a309496135d4c1f96b1a8e9ddba60013fa27bfc1d788681',
    files: {
      'runtimes/win-x64/native/onnxruntime.dll': 'onnxruntime.dll',
      'runtimes/win-x64/native/onnxruntime_providers_shared.dll': 'onnxruntime_providers_shared.dll',
      LICENSE: 'ONNX-Runtime-LICENSE.txt',
      'ThirdPartyNotices.txt': 'ONNX-Runtime-ThirdPartyNotices.txt',
    },
  },
  {
    name: 'microsoft.ai.directml', version: '1.15.4',
    sha256: '4e7cb7ddce8cf837a7a75dc029209b520ca0101470fcdf275c1f49736a3615b9',
    files: {
      'bin/x64-win/DirectML.dll': 'DirectML.dll',
      'LICENSE.txt': 'DirectML-LICENSE.txt',
      'LICENSE-CODE.txt': 'DirectML-Code-LICENSE.txt',
    },
  },
];

await mkdir(cache, { recursive: true });
await mkdir(destination, { recursive: true });
const installed = [];
for (const item of packages) {
  const filename = item.name + '.' + item.version + '.nupkg';
  const path = resolve(cache, filename);
  let bytes;
  try { bytes = await readFile(path); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const url = 'https://api.nuget.org/v3-flatcontainer/' + item.name + '/' + item.version + '/' + filename;
    console.log('Downloading ' + item.name + ' ' + item.version);
    const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw new Error('Native runtime download failed: HTTP ' + response.status);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (createHash('sha256').update(bytes).digest('hex') !== item.sha256) {
    throw new Error('Native runtime package checksum failed: ' + filename);
  }
  await writeFile(path, bytes);
  // 仅解压固定 DLL 和许可证，不把 nupkg 内其它平台和开发调试文件打进安装包。
  const archive = unzipSync(bytes, { filter: (entry) => Object.hasOwn(item.files, entry.name) });
  for (const [entry, name] of Object.entries(item.files)) {
    if (!archive[entry]) throw new Error('Native runtime package is missing ' + entry);
    const sha256 = createHash('sha256').update(archive[entry]).digest('hex');
    const target = resolve(destination, name);
    let existingHash;
    try { existingHash = createHash('sha256').update(await readFile(target)).digest('hex'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    // 正在验证的原生进程会锁住 DLL；内容相同就复用，避免重复构建覆盖已校验的运行库。
    // 内容不同仍必须成功写入，EBUSY 和其他写入错误会阻断构建，不能使用错误版本继续。
    if (existingHash !== sha256) await writeFile(target, archive[entry]);
    installed.push({ name, sha256 });
  }
}
await writeFile(resolve(destination, 'runtime-manifest.json'), JSON.stringify({
  architecture: 'x86_64', onnxruntime: packages[0].version, directml: packages[1].version,
  packages: packages.map(({ name, version, sha256 }) => ({ name, version, sha256 })), files: installed,
}, null, 2) + '\n');
console.log('Native CPU/DirectML runtime verified and prepared: ' + destination);
