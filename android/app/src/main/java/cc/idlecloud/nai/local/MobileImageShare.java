package cc.idlecloud.nai.local;

import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.ImageDecoder;
import android.net.Uri;
import android.os.Build;
import android.os.Process;
import android.os.SystemClock;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import androidx.core.content.IntentCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import okhttp3.CookieJar;
import okhttp3.Dns;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.Proxy;
import java.net.UnknownHostException;
import java.util.ArrayDeque;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** 将系统分享转换为页面可导入的原始图片文件，并为系统分享面板准备导出文件。 */
@CapacitorPlugin(name = "NovelAIImageShare")
public class MobileImageShare extends Plugin {
    static final long MAX_BYTES = 10L * 1024 * 1024;
    private static final int MAX_PENDING = 10;
    private static final Pattern HTTPS_LINK = Pattern.compile("https://[^\\s<>\"\\p{Z}\\p{Cntrl}]+",
            Pattern.CASE_INSENSITIVE);
    private static final OkHttpClient DOWNLOADS = new OkHttpClient.Builder()
            .cookieJar(CookieJar.NO_COOKIES)
            .proxy(Proxy.NO_PROXY)
            .dns(host -> {
                // 直接给连接层返回已验证的地址，避免校验后再次查询 DNS。
                List<InetAddress> addresses = Dns.SYSTEM.lookup(host);
                for (InetAddress address : addresses)
                    if (!isPublicAddress(address)) throw new UnknownHostException("SHARED_IMAGE_UNSAFE_LINK");
                return addresses;
            })
            .followRedirects(false)
            .followSslRedirects(false)
            .connectTimeout(6, TimeUnit.SECONDS)
            .readTimeout(8, TimeUnit.SECONDS)
            .build();

    private final ArrayDeque<Uri> pending = new ArrayDeque<>();
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    void accept(Intent intent) {
        if (intent == null || intent.getType() == null) return;
        String action = intent.getAction();
        boolean multiple = Intent.ACTION_SEND_MULTIPLE.equals(action);
        if (!multiple && !Intent.ACTION_SEND.equals(action)) return;
        LinkedHashSet<Uri> sources = new LinkedHashSet<>();
        try {
            String type = Intent.normalizeMimeType(intent.getType());
            if (type.startsWith("image/")) {
                if (multiple) {
                    List<?> streams = IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri.class);
                    if (streams != null) for (Object stream : streams) {
                        if (stream instanceof Uri uri) addContent(intent, sources, uri);
                        if (sources.size() == MAX_PENDING) break;
                    }
                } else {
                    addContent(intent, sources, IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri.class));
                }
                ClipData clips = intent.getClipData();
                for (int i = 0; clips != null && i < clips.getItemCount() && sources.size() < MAX_PENDING; i++)
                    addContent(intent, sources, clips.getItemAt(i).getUri());
            }
            if (sources.isEmpty() && !multiple && (type.startsWith("image/")
                    || "text/plain".equals(type) || "text/uri-list".equals(type))) {
                CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
                if (text != null && text.length() <= 16_384) {
                    Matcher match = HTTPS_LINK.matcher(text);
                    if (match.find()) sources.add(Uri.parse(match.group()));
                }
            }
        } catch (RuntimeException invalidIntent) {
            return; // 其它应用可能发送类型不符或无法读取的 Intent 附件。
        }
        if (sources.isEmpty()) return;
        synchronized (pending) {
            for (Uri source : sources) {
                if (pending.size() == MAX_PENDING) break;
                pending.add(source);
            }
        }
        notifyListeners("imageAvailable", new JSObject());
    }

    private void addContent(Intent intent, LinkedHashSet<Uri> sources, Uri uri) {
        if (uri == null || !"content".equals(uri.getScheme()) || uri.getHost() == null
                || uri.getUserInfo() != null || uri.getHost().equals(getContext().getPackageName() + ".update-files")
                || (intent.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION) == 0) return;
        if (getContext().checkUriPermission(uri, Process.myPid(), Process.myUid(),
                Intent.FLAG_GRANT_READ_URI_PERMISSION) == PackageManager.PERMISSION_GRANTED) sources.add(uri);
    }

    /** 领取下一张分享图片，保持原始字节供元数据和混淆检测使用。 */
    @PluginMethod
    public void nextImage(PluginCall call) {
        io.execute(() -> {
            Uri source;
            synchronized (pending) { source = pending.poll(); }
            if (source == null) { call.resolve(); return; }
            File file = null;
            boolean ready = false;
            try {
                String id = UUID.randomUUID().toString();
                file = new File(shareCache("incoming-images"), id);
                if ("content".equals(source.getScheme())) {
                    try (InputStream input = getContext().getContentResolver().openInputStream(source)) {
                        if (input == null) throw new IOException("SHARED_IMAGE_INVALID");
                        copyLimited(input, file, -1);
                    }
                } else {
                    download(source.toString(), file, DOWNLOADS);
                }
                String mime = imageMime(file, true);
                call.resolve(new JSObject().put("id", id).put("fileUri", Uri.fromFile(file).toString())
                        .put("name", "shared-image." + extension(mime)).put("mime", mime));
                ready = true;
            } catch (IOException | RuntimeException error) {
                String code = "SHARED_IMAGE_TOO_LARGE".equals(error.getMessage())
                        ? "SHARED_IMAGE_TOO_LARGE" : "SHARED_IMAGE_INVALID";
                call.resolve(new JSObject().put("error", code));
            } finally {
                if (!ready && file != null) file.delete();
            }
        });
    }

    /** 页面读完后释放接收图片的缓存文件。 */
    @PluginMethod
    public void releaseImage(PluginCall call) {
        try {
            String id = UUID.fromString(call.getString("id")).toString();
            new File(new File(getContext().getCacheDir(), "incoming-images"), id).delete();
            call.resolve();
        } catch (IllegalArgumentException | NullPointerException invalidId) {
            call.reject("SHARED_IMAGE_INVALID");
        }
    }

    /** 以实际图片格式发送暂存文件，系统只向收件应用授予这张图的读取权限。 */
    @PluginMethod
    public void shareImage(PluginCall call) {
        io.execute(() -> {
            try {
                var local = (LocalPlugin) getBridge().getPlugin("NovelAILocal").getInstance();
                File staged = local.transfer(call.getString("id", ""));
                String mime = imageMime(staged, false);
                String name = call.getString("name", "image").replaceFirst("\\.[a-zA-Z0-9]{1,8}$", "");
                name = name.replaceAll("[^\\p{L}\\p{N}_-]", "_");
                if (name.isEmpty() || name.length() > 80) name = "image";
                File directory = new File(shareCache("outgoing-images"), UUID.randomUUID().toString());
                if (!directory.mkdir()) throw new IOException("SHARED_IMAGE_CACHE_FAILED");
                File file = new File(directory, name + "." + extension(mime));
                if (!staged.renameTo(file)) {
                    directory.delete();
                    throw new IOException("SHARED_IMAGE_CACHE_FAILED");
                }
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".update-files", file);
                Intent send = new Intent(Intent.ACTION_SEND).setType(mime)
                        .putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                send.setClipData(ClipData.newRawUri("", uri));
                Intent chooser = Intent.createChooser(send, call.getString("title"));
                getActivity().runOnUiThread(() -> {
                    try { startActivityForResult(call, chooser, "shareFinished"); }
                    catch (RuntimeException error) { call.reject("SHARED_IMAGE_SEND_FAILED"); }
                });
            } catch (IOException | RuntimeException error) {
                call.reject("SHARED_IMAGE_SEND_FAILED");
            }
        });
    }

    @ActivityCallback
    private void shareFinished(PluginCall call, ActivityResult result) {
        if (call != null) call.resolve();
    }

    @Override
    protected void handleOnDestroy() { io.shutdownNow(); }

    private File shareCache(String name) throws IOException {
        File directory = new File(getContext().getCacheDir(), name);
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("SHARED_IMAGE_CACHE_FAILED");
        long cutoff = System.currentTimeMillis() - TimeUnit.DAYS.toMillis(1);
        File[] entries = directory.listFiles();
        if (entries != null) for (File entry : entries) {
            if (entry.lastModified() >= cutoff) continue;
            // 出站文件保留原名，接收方可在分享面板关闭后继续读取。
            File[] files = entry.listFiles();
            if (files != null) for (File file : files) file.delete();
            entry.delete();
        }
        return directory;
    }

    /** 根据解码器识别真实格式，验证入站图片尺寸与文件内容。 */
    static String imageMime(File file, boolean verifyPixels) throws IOException {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(file.getAbsolutePath(), bounds);
        extension(bounds.outMimeType);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw new IOException("SHARED_IMAGE_INVALID");
        if (verifyPixels) {
            // 与页面混淆检测使用同一像素上限，在完整解码前拒绝高压缩率的大图。
            if ((long) bounds.outWidth * bounds.outHeight > 24_000_000)
                throw new IOException("SHARED_IMAGE_INVALID");
            int sample = Math.max(1, Math.max(bounds.outWidth, bounds.outHeight) / 256);
            Bitmap bitmap;
            if (Build.VERSION.SDK_INT >= 28) {
                bitmap = ImageDecoder.decodeBitmap(ImageDecoder.createSource(file), (decoder, info, source) -> {
                    decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
                    decoder.setTargetSampleSize(sample);
                });
            } else {
                BitmapFactory.Options options = new BitmapFactory.Options();
                options.inSampleSize = sample;
                bitmap = BitmapFactory.decodeFile(file.getAbsolutePath(), options);
            }
            if (bitmap == null) throw new IOException("SHARED_IMAGE_INVALID");
            bitmap.recycle();
        }
        return bounds.outMimeType;
    }

    private static String extension(String mime) throws IOException {
        if (mime == null) throw new IOException("SHARED_IMAGE_INVALID");
        return switch (mime) {
            case "image/png" -> "png";
            case "image/jpeg" -> "jpg";
            case "image/webp" -> "webp";
            case "image/gif" -> "gif";
            case "image/bmp" -> "bmp";
            case "image/x-icon", "image/vnd.microsoft.icon" -> "ico";
            case "image/avif" -> "avif";
            default -> throw new IOException("SHARED_IMAGE_INVALID");
        };
    }

    /** 同时限制已知长度与实际读取量，包括未知长度和透明解压的响应。 */
    static void copyLimited(InputStream input, File file, long length) throws IOException {
        if (length > MAX_BYTES) throw new IOException("SHARED_IMAGE_TOO_LARGE");
        try (FileOutputStream output = new FileOutputStream(file)) {
            byte[] buffer = new byte[32 * 1024];
            long size = 0;
            for (int count; (count = input.read(buffer)) != -1;) {
                size += count;
                if (size > MAX_BYTES) throw new IOException("SHARED_IMAGE_TOO_LARGE");
                output.write(buffer, 0, count);
            }
        }
    }

    /** 限时取得链接内容，每跳单独检查，返回字节由图片解码器识别。 */
    static void download(String url, File file, OkHttpClient client) throws IOException {
        HttpUrl target = HttpUrl.parse(url);
        long deadline = SystemClock.elapsedRealtime() + 20_000;
        for (int hop = 0; hop <= 3; hop++) {
            requirePublicHttps(target);
            long remaining = deadline - SystemClock.elapsedRealtime();
            if (remaining <= 0) throw new IOException("SHARED_IMAGE_DOWNLOAD_TIMEOUT");
            okhttp3.Call call = client.newCall(new Request.Builder().url(target)
                    .header("Accept", "image/*, */*;q=0.5").build());
            call.timeout().timeout(remaining, TimeUnit.MILLISECONDS);
            try (Response response = call.execute()) {
                if (response.isRedirect()) {
                    String location = response.header("Location");
                    target = location == null ? null : target.resolve(location);
                    continue;
                }
                if (!response.isSuccessful() || response.body() == null)
                    throw new IOException("SHARED_IMAGE_DOWNLOAD_FAILED");
                copyLimited(response.body().byteStream(), file, response.body().contentLength());
                return;
            }
        }
        throw new IOException("SHARED_IMAGE_UNSAFE_LINK");
    }

    /** 每次请求（包括重定向）均验证协议、凭据和数字地址。 */
    static void requirePublicHttps(HttpUrl target) throws IOException {
        if (target == null || !target.isHttps() || !target.username().isEmpty() || !target.password().isEmpty())
            throw new IOException("SHARED_IMAGE_UNSAFE_LINK");
        // OkHttp 的数字地址不会经过自定义 DNS。
        String host = target.host();
        if ((host.indexOf(':') >= 0 || host.matches("[0-9.]+"))
                && !isPublicAddress(InetAddress.getByName(host)))
            throw new IOException("SHARED_IMAGE_UNSAFE_LINK");
    }

    /** 判断实际连接地址是否为公网地址，拒绝本机、内网、保留网段和 IPv6 隧道。 */
    static boolean isPublicAddress(InetAddress address) {
        byte[] bytes = address.getAddress();
        int a = bytes[0] & 255, b = bytes[1] & 255, c = bytes[2] & 255;
        if (bytes.length == 16) {
            return (a & 0xe0) == 0x20
                    && !(a == 0x20 && b == 0x01 && (c < 2 || (c == 0x0d && (bytes[3] & 255) == 0xb8)))
                    && !(a == 0x20 && b == 0x02)
                    && !(a == 0x3f && (b & 0xf0) == 0xf0);
        }
        return a != 0 && a != 10 && a != 127 && a < 224
                && !(a == 100 && b >= 64 && b <= 127)
                && !(a == 169 && b == 254)
                && !(a == 172 && b >= 16 && b <= 31)
                && !(a == 192 && ((b == 0 && (c == 0 || c == 2)) || (b == 88 && c == 99) || b == 168))
                && !(a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100)))
                && !(a == 203 && b == 0 && c == 113);
    }
}
