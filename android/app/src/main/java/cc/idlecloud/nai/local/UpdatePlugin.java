package cc.idlecloud.nai.local;

import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HashSet;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

/** 从开源仓库检查、下载和验证 APK，最终安装由 Android 系统确认。 */
@CapacitorPlugin(name = "NovelAIUpdate")
public class UpdatePlugin extends Plugin {
    private static final String API_HOST = "api.github.com";
    private static final String REPO = "YILING0013/novelai_local_web";
    private static final String API = "https://" + API_HOST + "/repos/" + REPO + "/releases?per_page=20&page=";
    private static final Pattern TAG = Pattern.compile("android-v([0-9]{1,5}\\.[0-9]{1,5}\\.[0-9]{1,5})");
    private static final Pattern DIGEST = Pattern.compile("sha256:([a-f0-9]{64})");
    private static final long MAX_APK_SIZE = 512L * 1024 * 1024;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private Release selected;
    private boolean ready;

    record Release(String version, URL url, long size, byte[] checksum) {}

    /** 只接受正式 Android 标签及其约定命名、具有 SHA-256 的 APK 资产。 */
    @PluginMethod
    public void check(PluginCall call) {
        worker.execute(() -> {
            try {
                if ((getContext().getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
                    call.resolve(new JSObject().put("debug", true));
                    return;
                }
                PackageInfo installed = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
                Release latest = null;
                for (int page = 1; latest == null; page++) {
                    HttpURLConnection connection = connect(new URL(API + page), true);
                    JSONArray releases;
                    try (InputStream input = connection.getInputStream(); ByteArrayOutputStream buffer = new ByteArrayOutputStream()) {
                        copy(input, buffer, 2 * 1024 * 1024, null);
                        releases = new JSONArray(buffer.toString(StandardCharsets.UTF_8.name()));
                    } finally {
                        connection.disconnect();
                    }
                    latest = selectRelease(releases, installed.versionName);
                    if (releases.length() < 20) break;
                }
                // 检查期间保留上次成功结果，只有候选版本发生变化才重置下载状态。
                if (latest == null || selected == null || !latest.version.equals(selected.version)
                        || !Arrays.equals(latest.checksum, selected.checksum)) ready = false;
                selected = latest;
                call.resolve(new JSObject().put("version", latest == null ? null : latest.version).put("ready", ready));
            } catch (Exception error) {
                call.reject("UPDATE_CHECK_FAILED", "UPDATE_CHECK_FAILED");
            }
        });
    }

    static Release selectRelease(JSONArray releases, String installed) throws Exception {
        Release latest = null;
        for (int index = 0; index < releases.length(); index++) {
            JSONObject release = releases.getJSONObject(index);
            String tag = release.getString("tag_name");
            Matcher match = TAG.matcher(tag);
            if (release.optBoolean("draft") || release.optBoolean("prerelease") || !match.matches()) continue;
            String version = match.group(1);
            if (compareVersions(version, installed) <= 0
                    || (latest != null && compareVersions(version, latest.version) <= 0)) continue;
            String name = "NovelAI-Local-Android-" + version + ".apk";
            String canonicalUrl = "https://github.com/" + REPO + "/releases/download/" + tag + "/" + name;
            JSONArray assets = release.getJSONArray("assets");
            for (int assetIndex = 0; assetIndex < assets.length(); assetIndex++) {
                JSONObject asset = assets.getJSONObject(assetIndex);
                if (!name.equals(asset.optString("name")) || !"uploaded".equals(asset.optString("state"))
                        || !canonicalUrl.equals(asset.optString("browser_download_url"))) continue;
                long size = asset.optLong("size");
                Matcher digest = DIGEST.matcher(asset.optString("digest"));
                if (size <= 0 || size > MAX_APK_SIZE || !digest.matches()) continue;
                byte[] checksum = new byte[32];
                for (int i = 0; i < checksum.length; i++) checksum[i] = (byte) Integer.parseInt(digest.group(1).substring(i * 2, i * 2 + 2), 16);
                latest = new Release(version, new URL(canonicalUrl), size, checksum);
                break;
            }
        }
        return latest;
    }

    private static int compareVersions(String first, String second) {
        String[] left = first.split("\\."), right = second.split("\\.");
        for (int i = 0; i < 3; i++) {
            int order = Integer.compare(Integer.parseInt(left[i]), Integer.parseInt(right[i]));
            if (order != 0) return order;
        }
        return 0;
    }

    /** 用户确认后下载，完整校验前不生成可交给系统安装器的文件。 */
    @PluginMethod
    public void download(PluginCall call) {
        worker.execute(() -> {
            File part = null;
            ready = false;
            try {
                Release release = selected;
                if (release == null) throw new IOException("Missing update");
                File apk = updateFile();
                part = new File(apk.getParentFile(), "update.partial.apk");
                HttpURLConnection connection = connect(release.url, false);
                try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(part)) {
                    copy(input, output, release.size, release);
                } finally {
                    connection.disconnect();
                }
                verify(part, release);
                if (!part.renameTo(apk)) throw new IOException("Cannot save update");
                ready = true;
                call.resolve();
            } catch (Exception error) {
                call.reject("UPDATE_DOWNLOAD_FAILED", "UPDATE_DOWNLOAD_FAILED");
            } finally {
                if (part != null) part.delete();
            }
        });
    }

    /** 安装前重验缓存 APK，并在需要时打开 Android 的逐应用安装授权。 */
    @PluginMethod
    public void install(PluginCall call) {
        worker.execute(() -> {
            try {
                if (!ready || selected == null) throw new IOException("Missing verified update");
                File apk = updateFile();
                verify(apk, selected);
                boolean permissionRequired = Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls();
                String app = getContext().getPackageName();
                Intent intent = permissionRequired
                        ? new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + app))
                        : new Intent(Intent.ACTION_VIEW)
                            .setDataAndType(FileProvider.getUriForFile(getContext(), app + ".update-files", apk), "application/vnd.android.package-archive")
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                getActivity().runOnUiThread(() -> {
                    try {
                        getActivity().startActivity(intent);
                        call.resolve(new JSObject().put("permissionRequired", permissionRequired));
                    } catch (RuntimeException error) {
                        call.reject("UPDATE_INSTALL_FAILED", "UPDATE_INSTALL_FAILED");
                    }
                });
            } catch (Exception error) {
                ready = false;
                call.reject("UPDATE_INSTALL_FAILED", "UPDATE_INSTALL_FAILED");
            }
        });
    }

    private File updateFile() throws IOException {
        File directory = new File(getContext().getCacheDir(), "android-update");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Cannot create update directory");
        return new File(directory, "update.apk");
    }

    private HttpURLConnection connect(URL url, boolean metadata) throws IOException {
        for (int redirects = 0; redirects <= 5; redirects++) {
            String host = url.getHost();
            boolean allowed = metadata ? API_HOST.equals(host) : "github.com".equals(host)
                    || "release-assets.githubusercontent.com".equals(host) || "objects.githubusercontent.com".equals(host);
            if (!allowed || !"https".equals(url.getProtocol()) || url.getUserInfo() != null
                    || (url.getPort() != -1 && url.getPort() != 443)) throw new IOException("Unexpected update host");
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(12000);
            connection.setReadTimeout(metadata ? 12000 : 30000);
            connection.setRequestProperty("User-Agent", "NovelAI-Local-Android");
            if (metadata) connection.setRequestProperty("Accept", "application/vnd.github+json");
            try {
                int status = connection.getResponseCode();
                if (status == 200) return connection;
                String location = connection.getHeaderField("Location");
                if (status < 300 || status >= 400 || location == null) throw new IOException("Update HTTP " + status);
                url = new URL(url, location);
            } catch (IOException error) {
                connection.disconnect();
                throw error;
            }
            connection.disconnect();
        }
        throw new IOException("Too many update redirects");
    }

    private void copy(InputStream input, OutputStream output, long limit, Release release) throws IOException {
        byte[] buffer = new byte[65536];
        long total = 0;
        int lastProgress = -1;
        for (int count; (count = input.read(buffer)) != -1;) {
            total += count;
            if (total > limit) throw new IOException("Update file exceeds size limit");
            output.write(buffer, 0, count);
            if (release == null) continue;
            int progress = (int) (total * 100 / release.size);
            if (lastProgress != progress) {
                lastProgress = progress;
                notifyListeners("progress", new JSObject().put("percent", progress));
            }
        }
    }

    @SuppressWarnings("deprecation")
    private void verify(File file, Release release) throws Exception {
        if (!file.isFile() || file.length() != release.size) throw new IOException("Incorrect update size");
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[65536];
            for (int count; (count = input.read(buffer)) != -1;) digest.update(buffer, 0, count);
        }
        if (!MessageDigest.isEqual(digest.digest(), release.checksum)) throw new IOException("Incorrect update hash");
        PackageManager manager = getContext().getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo installed = manager.getPackageInfo(getContext().getPackageName(), flags);
        PackageInfo candidate = manager.getPackageArchiveInfo(file.getAbsolutePath(), flags);
        if (candidate == null || !installed.packageName.equals(candidate.packageName)
                || !release.version.equals(candidate.versionName) || versionCode(candidate) <= versionCode(installed)
                || !signers(installed).equals(signers(candidate))) throw new IOException("Invalid update package");
    }

    @SuppressWarnings("deprecation")
    private static long versionCode(PackageInfo info) {
        return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
    }

    @SuppressWarnings("deprecation")
    private static HashSet<Signature> signers(PackageInfo info) throws IOException {
        Signature[] values = Build.VERSION.SDK_INT >= 28 && info.signingInfo != null
                ? info.signingInfo.getApkContentsSigners() : info.signatures;
        if (values == null || values.length == 0) throw new IOException("Missing signing certificate");
        return new HashSet<>(Arrays.asList(values));
    }
}
