package cc.idlecloud.nai.local;

import static org.junit.Assert.*;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.ClipData;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import android.provider.MediaStore;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.webkit.WebView;
import androidx.core.content.IntentCompat;
import androidx.test.core.app.ActivityScenario;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import java.io.ByteArrayOutputStream;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.zip.CRC32;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.json.JSONArray;
import org.junit.Test;
import org.junit.runner.RunWith;

/** 通过真正的分享 Intent 和触屏长按验证 WebView 导入与原文件导出。 */
@RunWith(AndroidJUnit4.class)
public class ImageSharingUiTest {
    private final Instrumentation instrument = InstrumentationRegistry.getInstrumentation();

    @Test
    public void limitAppliesToMeasuredBytesEvenWhenLengthIsUnknown() throws Exception {
        Context context = ApplicationProvider.getApplicationContext();
        File result = File.createTempFile("shared-limit", ".tmp", context.getCacheDir());
        int limit = (int) MobileImageShare.MAX_BYTES;
        try {
            MobileImageShare.copyLimited(new ByteArrayInputStream(new byte[limit]), result, -1);
            assertEquals(limit, result.length());
            assertEquals("SHARED_IMAGE_TOO_LARGE", assertThrows(IOException.class, () ->
                    MobileImageShare.copyLimited(new ByteArrayInputStream(new byte[limit + 1]), result, -1)).getMessage());
        } finally {
            result.delete();
        }
    }

    @Test
    public void extensionlessLinkUsesTheDecodedFormatAndRejectsUnsafeRedirects() throws Exception {
        Context context = ApplicationProvider.getApplicationContext();
        byte[] png = pngWithMetadata();
        File result = File.createTempFile("shared-test", ".tmp", context.getCacheDir());
        OkHttpClient client = new OkHttpClient.Builder().addInterceptor(chain -> {
            Response.Builder response = new Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1)
                    .message("Fixture").body(ResponseBody.create(new byte[0], null));
            return switch (chain.request().url().encodedPath()) {
                case "/redirect" -> response.code(302).header("Location", "/image").build();
                case "/blocked" -> response.code(302).header("Location", "https://127.0.0.1/image").build();
                case "/html" -> response.code(200).body(ResponseBody.create("<html>Not an image</html>", MediaType.get("image/png"))).build();
                case "/image" -> response.code(200).body(ResponseBody.create(png, MediaType.get("application/octet-stream"))).build();
                default -> throw new AssertionError("Unexpected destination");
            };
        }).build();
        try {
            MobileImageShare.download("https://example.com/redirect", result, client);
            assertEquals("image/png", MobileImageShare.imageMime(result, true));
            try (InputStream bytes = new FileInputStream(result)) {
                assertArrayEquals(png, bytes.readAllBytes());
            }
            MobileImageShare.download("https://example.com/html", result, client);
            assertThrows(IOException.class, () -> MobileImageShare.imageMime(result, true));
            assertThrows(IOException.class, () -> MobileImageShare.download("https://example.com/blocked", result, client));
        } finally {
            result.delete();
        }
    }

    @Test
    public void importsSharedPngAndSharesTheSameBytesWithALongPress() throws Exception {
        org.junit.Assume.assumeTrue(Build.VERSION.SDK_INT >= 29);
        Context context = ApplicationProvider.getApplicationContext();
        byte[] png = pngWithMetadata();
        Uri uri = media(context, png);
        Uri invalid = media(context, "This is not an image".getBytes(StandardCharsets.UTF_8));
        context.grantUriPermission(context.getPackageName(), uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        context.grantUriPermission(context.getPackageName(), invalid, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        AtomicReference<Intent> chosen = new AtomicReference<>();
        CountDownLatch chooserOpened = new CountDownLatch(1);
        Instrumentation.ActivityMonitor monitor = new Instrumentation.ActivityMonitor() {
            @Override public Instrumentation.ActivityResult onStartActivity(Intent intent) {
                if (!Intent.ACTION_CHOOSER.equals(intent.getAction())) return null;
                chosen.set(IntentCompat.getParcelableExtra(intent, Intent.EXTRA_INTENT, Intent.class));
                chooserOpened.countDown();
                return new Instrumentation.ActivityResult(Activity.RESULT_CANCELED, null);
            }
        };
        instrument.addMonitor(monitor);
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(send(context, uri))) {
            AtomicReference<WebView> view = new AtomicReference<>();
            scenario.onActivity(activity -> view.set(activity.getBridge().getWebView()));
            WebView web = view.get();
            await(web, "document.querySelector('#image-import-title') && document.querySelector('[role=dialog]').textContent.includes('shared-image.png')");
            await(web, "[...document.querySelectorAll('[role=dialog] textarea')].some(input=>input.value.includes('share test prompt'))");
            await(web, "Boolean(document.querySelector('[data-image-purpose-actions] button:not(:disabled)'))");
            holdImage(web);
            assertTrue("Long press did not open the Android sharesheet", chooserOpened.await(15, TimeUnit.SECONDS));
            Intent outgoing = chosen.get();
            assertEquals(Intent.ACTION_SEND, outgoing.getAction());
            assertEquals("image/png", outgoing.getType());
            assertTrue((outgoing.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0);
            Uri exported = IntentCompat.getParcelableExtra(outgoing, Intent.EXTRA_STREAM, Uri.class);
            assertEquals("content", exported.getScheme());
            try (InputStream bytes = context.getContentResolver().openInputStream(exported)) {
                assertArrayEquals(png, bytes.readAllBytes());
            }

            evaluate(web, "document.querySelector('#image-import-title button').click()");
            await(web, "!document.querySelector('#image-import-title')");
            scenario.onActivity(activity -> activity.startActivity(send(context, invalid)));
            await(web, "[...document.querySelectorAll('.MuiSnackbar-root')].some(node=>/Could not read an image|无法读取分享中的图片/.test(node.textContent))");
            assertEquals("true", evaluate(web, "!document.querySelector('#image-import-title')"));
            evaluate(web, "location.hash = '/local'");
            await(web, "location.hash === '#/local' && document.querySelector('[role=tablist]')");
            scenario.onActivity(activity -> activity.startActivity(send(context, uri)));
            await(web, "Boolean(document.querySelector('#image-import-title'))");
            String editorAction = "[...document.querySelectorAll('[data-image-purpose-actions] button:not(:disabled)')].find(button => /^(Image editor|图像处理)$/.test(button.textContent.trim()))";
            await(web, editorAction);
            evaluate(web, editorAction + ".click()");
            await(web, "location.hash.includes('/local?page=image-processing') && !document.querySelector('#image-import-title')");

            // 只替换账户查询，验证分享从其它标签转到绘画页并提供正常的参数导入。
            evaluate(web, """
                    (() => {
                      const request = window.fetch;
                      const snapshot = {subscription: {active: true, tier: 3}, anlas: {total: 500}, information: {}};
                      window.fetch = (input, init) => {
                        const path = new URL(input instanceof Request ? input.url : input, location.href).pathname;
                        if (path === '/api/session') return Promise.resolve(Response.json({authenticated: true, account_snapshot: snapshot}));
                        if (path === '/api/account') return Promise.resolve(Response.json({account_snapshot: snapshot}));
                        return request(input, init);
                      };
                      location.hash = '/main?page=gallery';
                    })()
                    """);
            await(web, "location.hash.includes('/main?page=gallery')");
            scenario.onActivity(activity -> activity.startActivity(send(context, uri)));
            await(web, "location.hash.includes('page=ai-painting') && document.querySelector('[role=dialog] button.MuiButton-contained')");
        } finally {
            instrument.removeMonitor(monitor);
            context.getContentResolver().delete(uri, null, null);
            context.getContentResolver().delete(invalid, null, null);
        }
    }

    private static Intent send(Context context, Uri uri) {
        Intent intent = new Intent(Intent.ACTION_SEND).setClass(context, MainActivity.class).setType("image/png")
                .putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.setClipData(ClipData.newRawUri("", uri));
        return intent;
    }

    private static Uri media(Context context, byte[] bytes) throws Exception {
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, "share-test-" + UUID.randomUUID() + ".png");
        values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
        Uri uri = context.getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
        try (OutputStream output = context.getContentResolver().openOutputStream(uri)) {
            output.write(bytes);
        }
        return uri;
    }

    private static byte[] pngWithMetadata() throws Exception {
        Bitmap bitmap = Bitmap.createBitmap(96, 96, Bitmap.Config.ARGB_8888);
        bitmap.eraseColor(0xff446688);
        ByteArrayOutputStream encoded = new ByteArrayOutputStream();
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, encoded);
        bitmap.recycle();
        byte[] png = encoded.toByteArray();
        byte[] text = ("tEXtComment\0{\"prompt\":\"share test prompt\",\"steps\":28,\"seed\":123}")
                .getBytes(StandardCharsets.UTF_8);
        CRC32 crc = new CRC32();
        crc.update(text);
        return ByteBuffer.allocate(png.length + text.length + 8)
                .put(png, 0, png.length - 12).putInt(text.length - 4).put(text).putInt((int) crc.getValue())
                .put(png, png.length - 12, 12).array();
    }

    private void holdImage(WebView web) throws Exception {
        String center = evaluate(web, """
                (() => {
                  const box = document.querySelector('[role=dialog] img').getBoundingClientRect();
                  return [Math.round((box.left + box.width / 2) * devicePixelRatio),
                    Math.round((box.top + box.height / 2) * devicePixelRatio)];
                })()
                """);
        JSONArray point = new JSONArray(center);
        int[] screen = new int[2];
        instrument.runOnMainSync(() -> web.getLocationOnScreen(screen));
        long down = SystemClock.uptimeMillis();
        for (int action : new int[] {MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP}) {
            MotionEvent event = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action,
                    screen[0] + point.getInt(0), screen[1] + point.getInt(1), 0);
            event.setSource(InputDevice.SOURCE_TOUCHSCREEN);
            assertTrue(instrument.getUiAutomation().injectInputEvent(event, true));
            event.recycle();
            if (action == MotionEvent.ACTION_DOWN) Thread.sleep(750);
        }
    }

    private String evaluate(WebView web, String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>();
        CountDownLatch done = new CountDownLatch(1);
        web.post(() -> web.evaluateJavascript(script, value -> { result.set(value); done.countDown(); }));
        assertTrue(done.await(10, TimeUnit.SECONDS));
        return result.get();
    }

    private void await(WebView web, String expression) throws Exception {
        for (int i = 0; i < 100; i++) {
            if ("true".equals(evaluate(web, "Boolean(" + expression + ")"))) return;
            Thread.sleep(200);
        }
        fail("Did not observe: " + expression + ". Current view: " + evaluate(web, """
                JSON.stringify({route: location.hash, title: document.querySelector('#image-import-title')?.textContent,
                  actions: [...document.querySelectorAll('[data-image-purpose-actions] button')].map(button => [button.textContent, button.disabled])})
                """));
    }
}
