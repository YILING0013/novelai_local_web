package cc.idlecloud.nai.local;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.Context;
import android.util.AtomicFile;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** 将 WebView 的本地业务请求交给 Rust，文件导出由系统选择器授权。 */
@CapacitorPlugin(name = "NovelAILocal")
public class LocalPlugin extends Plugin {
    private static final long MAX_TRANSFER = 256L * 1024 * 1024;
    private final ExecutorService requests = Executors.newFixedThreadPool(4);

    @PluginMethod
    public void request(PluginCall call) {
        requests.execute(() -> {
            File file = null;
            try {
                String path = call.getString("path", "");
                if (!path.startsWith("/api/")) { call.reject("INVALID_LOCAL_ROUTE"); return; }
                AndroidCore.open(getContext());
                String body = call.getString("body", "null");
                String transferId = call.getString("transfer");
                if (transferId != null) {
                    file = transfer(transferId);
                    try (var input = new FileInputStream(file); var buffer = new java.io.ByteArrayOutputStream()) {
                        AndroidCore.copy(input, buffer);
                        body = new String(buffer.toByteArray(), StandardCharsets.UTF_8);
                    }
                }
                String reply = AndroidCore.request(call.getString("method", "GET"), path, body);
                if (reply == null) { call.reject("INVALID_LOCAL_REQUEST"); return; }
                call.resolve(new JSObject(reply));
            } catch (Exception error) {
                call.reject("LOCAL_REQUEST_FAILED");
            } finally {
                if (file != null) file.delete();
            }
        });
    }

    @PluginMethod
    public void stage(PluginCall call) {
        requests.execute(() -> {
            try {
                File file = transfer(call.getString("id", ""));
                String data = call.getString("data", "");
                boolean append = call.getBoolean("append", false);
                if (data.length() > 350000 || (append && !file.isFile())) {
                    throw new IOException("INVALID_TRANSFER");
                }
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                if ((append ? file.length() : 0) + bytes.length > MAX_TRANSFER) {
                    throw new IOException("TRANSFER_TOO_LARGE");
                }
                try (FileOutputStream out = new FileOutputStream(file, append)) { out.write(bytes); }
                call.resolve();
            } catch (Exception error) {
                call.reject("LOCAL_TRANSFER_FAILED");
            }
        });
    }

    @PluginMethod
    public void discard(PluginCall call) {
        requests.execute(() -> {
            try { transfer(call.getString("id", "")).delete(); call.resolve(); }
            catch (IOException error) { call.reject("INVALID_TRANSFER"); }
        });
    }

    @PluginMethod
    public void save(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("mime", "application/octet-stream"));
        intent.putExtra(Intent.EXTRA_TITLE, call.getString("name", "image.png"));
        getActivity().runOnUiThread(() -> startActivityForResult(call, intent, "fileSelected"));
    }

    /** 将已暂存的 PNG 作为受控的内容 URI 交给系统剪贴板。 */
    @PluginMethod
    public void copyImage(PluginCall call) {
        requests.execute(() -> {
            try {
                File source = transfer(call.getString("id", ""));
                Context context = getContext();
                File directory = new File(context.getCacheDir(), "clipboard");
                if (!directory.isDirectory() && !directory.mkdirs() && !directory.isDirectory()) {
                    throw new IOException("LOCAL_DIRECTORY_ERROR");
                }
                File image = new File(directory, "image.png");
                synchronized (this) {
                    AtomicFile destination = new AtomicFile(image);
                    try (FileInputStream input = new FileInputStream(source)) {
                        FileOutputStream output = destination.startWrite();
                        try {
                            AndroidCore.copy(input, output);
                            destination.finishWrite(output);
                        } catch (IOException error) {
                            destination.failWrite(output);
                            throw error;
                        }
                    }
                    var uri = FileProvider.getUriForFile(context, context.getPackageName() + ".update-files", image);
                    var clip = ClipData.newUri(context.getContentResolver(), "NovelAI Local", uri);
                    getActivity().runOnUiThread(() -> {
                        try {
                            context.getSystemService(ClipboardManager.class).setPrimaryClip(clip);
                            call.resolve();
                        } catch (RuntimeException error) {
                            call.reject("LOCAL_CLIPBOARD_FAILED");
                        }
                    });
                }
            } catch (IOException | RuntimeException error) {
                call.reject("LOCAL_CLIPBOARD_FAILED");
            }
        });
    }

    @ActivityCallback
    private void fileSelected(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.resolve(new JSObject().put("saved", false));
            return;
        }
        requests.execute(() -> {
            try (var input = new FileInputStream(transfer(call.getString("id", "")));
                    OutputStream output = getContext().getContentResolver().openOutputStream(result.getData().getData(), "wt")) {
                if (output == null) throw new IOException("DOCUMENT_UNAVAILABLE");
                AndroidCore.copy(input, output);
                call.resolve(new JSObject().put("saved", true));
            } catch (IOException error) {
                call.reject("LOCAL_SAVE_FAILED");
            }
        });
    }

    private File transfer(String id) throws IOException {
        if (!id.matches("[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}")) throw new IOException("INVALID_TRANSFER");
        File directory = new File(getContext().getCacheDir(), "transfers");
        if (!directory.isDirectory() && !directory.mkdirs() && !directory.isDirectory()) throw new IOException("LOCAL_DIRECTORY_ERROR");
        return new File(directory, id);
    }
}
