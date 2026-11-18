package cc.idlecloud.nai.local;

import static org.junit.Assert.*;

import android.app.UiAutomation;
import android.os.ParcelFileDescriptor;
import android.view.accessibility.AccessibilityNodeInfo;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class LocalAppTest {
    private static final String IMAGE = "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAFElEQVR4nGNMqdjCAAZMEIqBgQEAHAwBlIeZ0sAAAAAASUVORK5CYII=";

    private static JSONObject request(String method, String path, JSONObject body, int status) throws Exception {
        JSONObject reply = new JSONObject(AndroidCore.request(method, path, body == null ? "null" : body.toString()));
        assertEquals(reply.toString(), status, reply.getInt("status"));
        return reply.getJSONObject("body");
    }

    @Test
    public void galleryRoundTripAndProtectedPaths() throws Exception {
        AndroidCore.open(InstrumentationRegistry.getInstrumentation().getTargetContext());
        JSONObject file = new JSONObject().put("name", "android-fixture.png").put("data", IMAGE);
        JSONObject imported = request("POST", "/api/local/gallery/import",
                new JSONObject().put("source", "references").put("files", new JSONArray().put(file)), 200);
        JSONObject image = imported.getJSONArray("items").getJSONObject(0);
        String id = image.getString("id");
        assertNotNull(AndroidCore.asset(image.getString("url")));
        assertNull(AndroidCore.asset("/api/local/gallery/../file"));
        assertNull(AndroidCore.asset("/api/local/metadata-exports/../../library.sqlite3"));
        request("PUT", "/api/local/settings",
                new JSONObject().put("settings", new JSONObject().put("outputDirectory", "/data/local/tmp")), 400);
        JSONObject batch = new JSONObject().put("ids", new JSONArray().put(id));
        try {
            JSONObject export = request("POST", "/api/local/gallery/batch", batch.put("action", "export").put("mode", "strip"), 200);
            String copy = export.getJSONArray("items").getJSONObject(0).getString("file_url");
            assertNotNull(AndroidCore.asset(copy));
            request("DELETE", copy, null, 200);
            assertNotNull(AndroidCore.asset(image.getString("url")));
        } finally {
            request("POST", "/api/local/gallery/batch", batch.put("action", "trash"), 200);
            request("POST", "/api/local/gallery/batch", batch.put("action", "delete"), 200);
        }
    }

    @Test
    public void keystoreEncryptsAndAuthenticates() throws Exception {
        AndroidCore.open(InstrumentationRegistry.getInstrumentation().getTargetContext());
        Method protect = AndroidCore.class.getDeclaredMethod("protect", byte[].class);
        Method unprotect = AndroidCore.class.getDeclaredMethod("unprotect", byte[].class);
        protect.setAccessible(true);
        unprotect.setAccessible(true);
        byte[] clear = "synthetic-local-credential".getBytes(StandardCharsets.UTF_8);
        byte[] cipher = (byte[]) protect.invoke(null, (Object) clear);
        assertFalse(new String(cipher, StandardCharsets.UTF_8).contains("synthetic-local-credential"));
        assertArrayEquals(clear, (byte[]) unprotect.invoke(null, (Object) cipher));
        cipher[cipher.length - 1] ^= 1;
        assertThrows(java.lang.reflect.InvocationTargetException.class, () -> unprotect.invoke(null, (Object) cipher));
    }

    private static String evaluate(ActivityScenario<MainActivity> activity, String js) throws Exception {
        CountDownLatch finished = new CountDownLatch(1);
        AtomicReference<String> value = new AtomicReference<>();
        activity.onActivity(main -> {
            WebView view = main.getBridge().getWebView();
            view.evaluateJavascript(js, result -> { value.set(result); finished.countDown(); });
        });
        assertTrue("WebView did not respond", finished.await(12, TimeUnit.SECONDS));
        return value.get();
    }

    @Test
    public void packagedUiReachesOfflineGallery() throws Exception {
        try (ActivityScenario<MainActivity> activity = ActivityScenario.launch(MainActivity.class)) {
            for (int i = 0; i < 50; i++) {
                if ("true".equals(evaluate(activity, "Boolean(document.querySelector('form input[type=password]'))"))) break;
                Thread.sleep(250);
            }
            assertEquals("true", evaluate(activity, "Boolean(document.querySelector('form input[type=password]'))"));
            assertEquals("true", evaluate(activity, """
                    (() => {
                      const link = [...document.querySelectorAll('button')].find(x => /本机工具|Local tools/.test(x.innerText));
                      link?.click();
                      return Boolean(link);
                    })()
                    """));
            evaluate(activity, "window.androidSmoke = ''; fetch('/api/local/inference').then(x=>x.json()).then(x=>window.androidSmoke=x.runtime.providers.join(','));");
            for (int i = 0; i < 50; i++) {
                if ("\"CPUExecutionProvider\"".equals(evaluate(activity, "window.androidSmoke"))) break;
                Thread.sleep(250);
            }
            assertEquals("\"CPUExecutionProvider\"", evaluate(activity, "window.androidSmoke"));
            assertEquals("\"#/local\"", evaluate(activity, "location.hash"));
            evaluate(activity, """
                    window.androidSave = null;
                    window.novelaiSaveFile(new Blob(['fixture'], { type: 'text/plain' }), 'android-fixture.txt')
                      .then(saved => window.androidSave = saved);
                    """);
            UiAutomation system = InstrumentationRegistry.getInstrumentation().getUiAutomation();
            boolean pickerOpened = false;
            for (int i = 0; i < 50; i++) {
                AccessibilityNodeInfo root = system.getRootInActiveWindow();
                if (root != null && root.getPackageName().toString().endsWith(".documentsui")) {
                    pickerOpened = true;
                    break;
                }
                Thread.sleep(250);
            }
            assertTrue("Android document picker did not open", pickerOpened);
            system.waitForIdle(500, 5000);
            try (var key = new ParcelFileDescriptor.AutoCloseInputStream(system.executeShellCommand("input keyevent 4"))) {
                assertEquals(-1, key.read());
            }
            for (int i = 0; i < 50; i++) {
                if ("false".equals(evaluate(activity, "window.androidSave"))) break;
                Thread.sleep(250);
            }
            assertEquals("false", evaluate(activity, "window.androidSave"));
        }
    }

    @Test
    public void cpuModelLoadsWhenRequested() throws Exception {
        org.junit.Assume.assumeTrue("true".equals(InstrumentationRegistry.getArguments().getString("loadModel")));
        AndroidCore.open(InstrumentationRegistry.getInstrumentation().getTargetContext());
        JSONObject job = request("POST", "/api/local/inference/jobs",
                new JSONObject().put("model_id", "quicksrnet-small").put("action", "load").put("device", "cpu"), 202);
        for (int i = 0; i < 180 && "running".equals(job.getString("status")); i++) {
            Thread.sleep(1000);
            job = request("GET", "/api/local/inference/jobs/" + job.getString("id"), null, 200);
        }
        assertEquals(job.toString(), "completed", job.getString("status"));
        assertEquals("cpu", job.getJSONObject("result").getString("backend"));
        request("POST", "/api/local/inference/release", new JSONObject(), 200);
    }
}
