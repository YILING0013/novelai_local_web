package cc.idlecloud.nai.local;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.io.FileInputStream;
import java.io.IOException;
import java.util.Collections;
import org.json.JSONException;
import org.json.JSONObject;

/** 加载 APK 内的页面，并在同一 WebView 来源下提供本地图库图片。 */
public class MainActivity extends BridgeActivity {
    private boolean restoring;

    @Override
    public void onCreate(Bundle state) {
        registerPlugin(LocalPlugin.class);
        registerPlugin(UpdatePlugin.class);
        registerPlugin(MobileImageShare.class);
        restoring = state != null;
        super.onCreate(state);
        restoring = false;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // Capacitor 初始化桥接时也会将启动 Intent 交给这里。
        if (!restoring && getBridge() != null) {
            var share = (MobileImageShare) getBridge().getPlugin("NovelAIImageShare").getInstance();
            share.accept(intent);
        }
    }

    @Override
    protected void load() {
        EdgeToEdge.enable(this);
        super.load();
        getBridge().setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (isAppOrigin(url)) {
                    return !request.isForMainFrame()
                            || !("".equals(url.getPath()) || "/".equals(url.getPath()) || "/index.html".equals(url.getPath()));
                }
                return !request.isForMainFrame() || !("https".equals(url.getScheme()) || "mailto".equals(url.getScheme()))
                        || super.shouldOverrideUrlLoading(view, request);
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (!isAppOrigin(url) || url.getPath() == null || !url.getPath().startsWith("/api/")) {
                    return super.shouldInterceptRequest(view, request);
                }
                if (!request.isForMainFrame() && "GET".equals(request.getMethod())) {
                    try {
                        AndroidCore.open(getApplicationContext());
                        String asset = AndroidCore.asset(url.getPath());
                        if (asset != null) {
                            JSONObject data = new JSONObject(asset);
                            return new WebResourceResponse(data.getString("mime"), null, 200, "OK",
                                    Collections.singletonMap("X-Content-Type-Options", "nosniff"),
                                    new FileInputStream(data.getString("file")));
                        }
                    } catch (IOException | JSONException ignored) {
                        // 图片不存在或刚移入回收站时按图库资源缺失处理。
                    }
                }
                return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                        Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
            }
        });
    }

    private static boolean isAppOrigin(Uri url) {
        return "https".equals(url.getScheme()) && "localhost".equals(url.getHost())
                && (url.getPort() == -1 || url.getPort() == 443);
    }
}
