package cc.idlecloud.nai.local;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** 给共享 Rust 工作区提供应用私有目录与 Android Keystore。 */
final class AndroidCore {
    private static final String KEY_ALIAS = "novelai-local-credentials";
    private static boolean initialized;

    static { System.loadLibrary("novelai_local"); }

    /** 准备打包的标签词库，并在应用进程内只初始化一次。 */
    static synchronized void open(Context context) throws IOException {
        if (initialized) return;
        File root = new File(context.getNoBackupFilesDir(), "workspace");
        File resources = new File(context.getNoBackupFilesDir(), "runtime");
        File tags = new File(resources, "prompt_tags");
        if (!tags.isDirectory() && !tags.mkdirs()) throw new IOException("LOCAL_DIRECTORY_ERROR");
        for (String name : context.getAssets().list("prompt_tags")) {
            AtomicFile entry = new AtomicFile(new File(tags, name));
            try (InputStream input = context.getAssets().open("prompt_tags/" + name)) {
                FileOutputStream output = entry.startWrite();
                try {
                    copy(input, output);
                    entry.finishWrite(output);
                } catch (IOException error) {
                    entry.failWrite(output);
                    throw error;
                }
            }
        }
        String failure = initialize(root.getPath(), resources.getPath(), context.getApplicationInfo().nativeLibraryDir);
        if (failure != null) throw new IOException(failure);
        initialized = true;
    }

    static void copy(InputStream input, java.io.OutputStream output) throws IOException {
        byte[] buffer = new byte[65536];
        int count;
        while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
    }

    private static native String initialize(String root, String resources, String nativeLibraries);
    static native String request(String method, String path, String body);
    static native String asset(String path);

    private static SecretKey getKey(boolean create) throws GeneralSecurityException, IOException {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        SecretKey key = (SecretKey) store.getKey(KEY_ALIAS, null);
        if (key != null) return key;
        if (!create) throw new GeneralSecurityException("KEYSTORE_KEY_MISSING");
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build());
        return generator.generateKey();
    }

    // JNI 调用的两个方法只在原生进程间接触明文，设备密钥由 Keystore 持有。
    private static synchronized byte[] protect(byte[] input) throws GeneralSecurityException, IOException {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getKey(true));
        byte[] iv = cipher.getIV();
        byte[] encrypted = cipher.doFinal(input);
        byte[] payload = Arrays.copyOf(iv, iv.length + encrypted.length);
        System.arraycopy(encrypted, 0, payload, iv.length, encrypted.length);
        return payload;
    }

    private static synchronized byte[] unprotect(byte[] input) throws GeneralSecurityException, IOException {
        if (input.length < 28) throw new GeneralSecurityException("INVALID_CREDENTIAL");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, getKey(false), new GCMParameterSpec(128, input, 0, 12));
        return cipher.doFinal(input, 12, input.length - 12);
    }
}
