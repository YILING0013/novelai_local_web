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
            waitFor(activity, "Boolean(document.querySelector('form input[type=password]'))");
            evaluate(activity, "document.querySelector('[data-mobile-titlebar] button[aria-haspopup=menu]').click()");
            waitFor(activity, "Boolean(document.querySelector('[role=menuitem]'))");
            assertEquals("true", evaluate(activity, """
                    (() => {
                      const link = [...document.querySelectorAll('[role=menuitem]')].find(x => /本机工具|Local tools/.test(x.innerText));
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
            waitFor(activity, "document.querySelectorAll('[role=tab]').length >= 6");
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

    private static void waitFor(ActivityScenario<MainActivity> activity, String expression) throws Exception {
        for (int i = 0; i < 50; i++) {
            if ("true".equals(evaluate(activity, expression))) return;
            Thread.sleep(250);
        }
        fail("Expected UI condition: " + expression
                + " at " + evaluate(activity, "location.hash")
                + ", UI: " + evaluate(activity, "document.body.innerText.slice(0, 160)"));
    }

    private static void capture(ActivityScenario<MainActivity> activity, String name) throws Exception {
        // DOM 状态和屏幕合成分属两个线程，等待 WebView 提交画面后再拍摄。
        CountDownLatch visualState = new CountDownLatch(1);
        activity.onActivity(main -> main.getBridge().getWebView().postVisualStateCallback(0, new WebView.VisualStateCallback() {
            @Override public void onComplete(long requestId) { visualState.countDown(); }
        }));
        assertTrue("WebView did not render", visualState.await(5, TimeUnit.SECONDS));
        Thread.sleep(400);
        UiAutomation system = InstrumentationRegistry.getInstrumentation().getUiAutomation();
        system.waitForIdle(400, 5000);
        android.graphics.Bitmap picture = system.takeScreenshot();
        assertNotNull(picture);
        java.io.File path = new java.io.File(InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir(), name + ".png");
        try (java.io.FileOutputStream output = new java.io.FileOutputStream(path)) {
            assertTrue(picture.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, output));
        }
    }

    private static void pressBack() throws Exception {
        UiAutomation system = InstrumentationRegistry.getInstrumentation().getUiAutomation();
        try (var key = new ParcelFileDescriptor.AutoCloseInputStream(system.executeShellCommand("input keyevent KEYCODE_BACK"))) {
            assertEquals(-1, key.read());
        }
    }

    private static void tap(ActivityScenario<MainActivity> activity, String selector) throws Exception {
        String element = "document.querySelector(" + JSONObject.quote(selector) + ")";
        try {
            waitFor(activity, """
                    (() => {
                      const node = %s;
                      if (!node) return false;
                      const { x, y, width, height } = node.getBoundingClientRect();
                      return node.contains(document.elementFromPoint(x + width / 2, y + height / 2));
                    })()
                    """.formatted(element));
        } catch (AssertionError failure) {
            String hit = evaluate(activity, """
                    (() => {
                      const node = %s;
                      if (!node) return ['missing'];
                      const { x, y, width, height } = node.getBoundingClientRect();
                      const target = document.elementFromPoint(x + width / 2, y + height / 2);
                      return target ? [target.outerHTML.split('>')[0],
                        target.closest('.MuiModal-root')?.className,
                        target.closest('[role=dialog]')?.getAttribute('aria-labelledby'),
                        target.closest('.MuiPopover-root')?.className] : null;
                    })()
                    """.formatted(element));
            throw new AssertionError("Tap target " + selector + " was blocked by " + hit, failure);
        }
        JSONArray point = new JSONArray(evaluate(activity, """
                (() => {
                  const { x, y, width, height } = %s.getBoundingClientRect();
                  return [(x + width / 2) * devicePixelRatio, (y + height / 2) * devicePixelRatio];
                })()
                """.formatted(element)));
        int[] offset = new int[2];
        activity.onActivity(main -> main.getBridge().getWebView().getLocationOnScreen(offset));
        int x = offset[0] + (int) point.getDouble(0);
        int y = offset[1] + (int) point.getDouble(1);
        UiAutomation system = InstrumentationRegistry.getInstrumentation().getUiAutomation();
        try (var result = new ParcelFileDescriptor.AutoCloseInputStream(system.executeShellCommand("input tap " + x + " " + y))) {
            assertEquals(-1, result.read());
        }
    }

    @Test
    public void nativeMobileWorkspacesAndSettingsLayout() throws Exception {
        try (ActivityScenario<MainActivity> activity = ActivityScenario.launch(MainActivity.class)) {
            activity.onActivity(main -> main.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));
            waitFor(activity, "Boolean(document.querySelector('[data-mobile-titlebar]'))");
            // 只替换当前 WebView 的账户快照。模型、设置和图库仍经由原生桥接，不访问官方账户。
            evaluate(activity, """
                    (() => {
                      const request = window.fetch;
                      const snapshot = { subscription: { active: true, tier: 3 }, anlas: { total: 500, fixed: 350, purchased: 150 }, information: {} };
                      window.fetch = (input, init) => {
                        const path = new URL(input instanceof Request ? input.url : input, location.href).pathname;
                        if (path === '/api/session') return Promise.resolve(Response.json({ authenticated: true, account_snapshot: snapshot }));
                        if (path === '/api/account') return Promise.resolve(Response.json({ account_snapshot: snapshot }));
                        return request(input, init);
                      };
                      location.hash = '#/main?page=ai-painting';
                    })()
                    """);
            waitFor(activity, "Boolean(document.querySelector('[data-testid=mobile-generation-toolbar]'))");
            capture(activity, "painting");
            String footer = evaluate(activity, """
                    (() => {
                      const bar = document.querySelector('[data-mobile-generation-footer]');
                      const rect = bar.getBoundingClientRect();
                      return { height: rect.height, bottom: rect.bottom, windowHeight: innerHeight,
                        titleBar: document.querySelector('[data-mobile-titlebar]').getBoundingClientRect().height,
                        root: document.querySelector('#root').getBoundingClientRect().height };
                    })()
                    """);
            JSONObject bounds = new JSONObject(footer);
            assertTrue(footer, bounds.getDouble("height") >= 44 && bounds.getDouble("height") < 76
                    && bounds.getDouble("bottom") <= bounds.getDouble("windowHeight") + 1);
            // 从漫画两次返回，覆盖实际触摸命中及普通绘画参数的恢复。
            for (int mode : new int[]{1, 2, 3, 1, 3, 2, 1}) {
                tap(activity, "[data-mobile-titlebar] button[aria-controls=main-navigation]");
                waitFor(activity, "document.querySelector('[data-mobile-titlebar] button[aria-controls=main-navigation]').getAttribute('aria-expanded') === 'true'");
                waitFor(activity, "Math.abs(document.querySelector('#main-navigation').getBoundingClientRect().x) < 1");
                tap(activity, "#main-navigation [role=group] button:nth-child(" + mode + ")");
                waitFor(activity, "document.querySelector('#main-navigation [role=group] button:nth-child(" + mode + ")')?.getAttribute('aria-pressed') === 'true'");
                waitFor(activity, "document.querySelector('[data-mobile-titlebar] button[aria-controls=main-navigation]').getAttribute('aria-expanded') === 'false'");
                waitFor(activity, mode == 3
                        ? "document.querySelector('[data-comic-toolbar]')?.getClientRects().length > 0"
                        : "document.querySelector('[data-mobile-generation-footer]')?.getClientRects().length > 0");
            }
            waitFor(activity, "document.querySelector('[data-mobile-generation-footer] button[aria-haspopup=dialog]')?.getAttribute('aria-label').includes('Opus')");
            tap(activity, "[data-mobile-generation-footer] button[aria-haspopup=dialog]");
            capture(activity, "subscription");
            waitFor(activity, "document.querySelector('#anlas-details-title')?.getClientRects().length > 0");
            waitFor(activity, """
                    (() => {
                      const dialog = document.querySelector('[role=dialog][aria-labelledby=anlas-details-title]');
                      return Boolean(dialog && dialog.getBoundingClientRect().height < innerHeight * 0.8
                        && ['Opus', '500', '350', '150'].every(value => dialog.innerText.includes(value))
                        && !document.querySelector('[data-mobile-account]'));
                    })()
                    """);
            pressBack();
            waitFor(activity, "document.querySelector('#anlas-details-title') === null");

            tap(activity, "[data-mobile-titlebar] button[aria-haspopup=menu]");
            tap(activity, "[role=menu] [role=menuitem]:first-child");
            waitFor(activity, "document.querySelector('[data-mobile-account]')?.getClientRects().length > 0");
            pressBack();
            waitFor(activity, "document.querySelector('[data-mobile-account]') === null");

            evaluate(activity, "document.querySelector('[data-mobile-generation-footer] button[aria-label=打开参数面板], [data-mobile-generation-footer] button[aria-label=\"Open parameters\"]').click()");
            waitFor(activity, "getComputedStyle(document.querySelector('[data-mobile-parameter-header]')).visibility === 'visible'");
            pressBack();
            waitFor(activity, "getComputedStyle(document.querySelector('[data-mobile-parameter-header]')).visibility === 'hidden'");
            evaluate(activity, "document.querySelector('[data-mobile-titlebar] button[aria-controls=main-navigation]').click()");
            waitFor(activity, "document.querySelector('[data-mobile-titlebar] button[aria-controls=main-navigation]').getAttribute('aria-expanded') === 'true'");
            waitFor(activity, "document.querySelectorAll('#main-navigation [aria-pressed]').length === 3");
            capture(activity, "sidebar");
            evaluate(activity, "document.querySelectorAll('#main-navigation [aria-pressed]')[1].click()");
            waitFor(activity, "document.querySelectorAll('#main-navigation [aria-pressed]')[1]?.getAttribute('aria-pressed') === 'true'");
            capture(activity, "inpaint");
            evaluate(activity, "document.querySelector('[data-mobile-titlebar] button[aria-controls=main-navigation]').click()");
            evaluate(activity, "document.querySelectorAll('#main-navigation [aria-pressed]')[2].click()");
            waitFor(activity, "Boolean(document.querySelector('[data-comic-toolbar]'))");
            waitFor(activity, "document.querySelector('[data-comic-dock]')?.getClientRects().length === 0");
            waitFor(activity, "document.querySelector('[data-testid=comic-viewport]')?.getBoundingClientRect().height > 180");
            capture(activity, "comic");
            tap(activity, "[data-comic-toolbar] button[aria-label=手动编排], [data-comic-toolbar] button[aria-label=\"Manual layout\"]");
            tap(activity, "[data-comic-toolbar] button[aria-label=参数], [data-comic-toolbar] button[aria-label=Parameters]");
            evaluate(activity, "[...document.querySelectorAll('[data-comic-dock] button')].find(button => ['编辑生成参数', 'Edit generation settings'].includes(button.textContent.trim())).click()");
            waitFor(activity, "document.querySelector('#mobile-comic-editor-title')?.getClientRects().length > 0");
            pressBack();
            waitFor(activity, "document.querySelector('#mobile-comic-editor-title').getClientRects().length === 0");
            evaluate(activity, "document.querySelector('[data-comic-toolbar] button[aria-label=绘图工具], [data-comic-toolbar] button[aria-label=\"Drawing tools\"]').click()");
            waitFor(activity, "getComputedStyle(document.querySelector('#comic-tools-title')).visibility === 'visible'");
            capture(activity, "comic-tools");
            pressBack();
            waitFor(activity, "getComputedStyle(document.querySelector('#comic-tools-title')).visibility === 'hidden'");
            evaluate(activity, "document.querySelector('[data-comic-toolbar] button[aria-label=参数], [data-comic-toolbar] button[aria-label=Parameters]').click()");
            waitFor(activity, "document.querySelector('[data-comic-dock]').getClientRects().length > 0");
            pressBack();
            waitFor(activity, "document.querySelector('[data-comic-dock]').getClientRects().length === 0");
            tap(activity, "[data-comic-toolbar] button[aria-label=AI制作], [data-comic-toolbar] button[aria-label=\"AI creation\"]");
            waitFor(activity, "document.querySelector('[data-comic-toolbar] button[aria-label=AI制作], [data-comic-toolbar] button[aria-label=\"AI creation\"]').getAttribute('aria-pressed') === 'true'");
            activity.onActivity(main -> main.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE));
            waitFor(activity, "innerWidth > innerHeight && document.querySelector('[data-testid=comic-viewport]').getBoundingClientRect().height > 150");
            capture(activity, "comic-landscape");
            activity.onActivity(main -> main.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));
            waitFor(activity, "innerHeight > innerWidth");

            evaluate(activity, "location.hash = '#/main?page=image-processing'");
            waitFor(activity, "document.querySelector('.mobile-tool-trigger')?.getBoundingClientRect().width >= 40");
            waitFor(activity, "getComputedStyle(document.querySelector('.image-processing-editor .tool-rail')).display === 'none'");
            evaluate(activity, "document.querySelector('.mobile-tool-trigger').click()");
            waitFor(activity, "document.querySelectorAll('.mobile-tool-colors input[type=color]').length === 2");
            capture(activity, "image-processing");
            pressBack();
            waitFor(activity, "document.querySelector('.mobile-tool-colors') === null");

            evaluate(activity, "location.hash = '#/main?page=settings'");
            waitFor(activity, "Boolean(document.querySelector('[data-mobile-settings-header]'))");
            waitFor(activity, "Boolean(document.querySelector('[data-mobile-settings-section=appearance]'))");
            capture(activity, "settings");
            evaluate(activity, "document.querySelector('[data-mobile-settings-section=appearance]').click()");
            waitFor(activity, "location.hash.includes('section=appearance') && Boolean(document.querySelector('#settings-panel-appearance'))");
            capture(activity, "settings-detail");
            evaluate(activity, "document.querySelector('[data-mobile-settings-header] button').click()");
            waitFor(activity, "!location.hash.includes('section=')");
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
