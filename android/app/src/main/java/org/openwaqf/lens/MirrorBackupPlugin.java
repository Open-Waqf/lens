package org.openwaqf.lens;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.util.Base64;

import androidx.documentfile.provider.DocumentFile;

import com.getcapacitor.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;

@CapacitorPlugin(name = "MirrorBackup")
public class MirrorBackupPlugin extends Plugin {
    private static final String PREFS_NAME = "sahifah_mirror_backup";
    private static final String KEY_TREE_URI = "tree_uri";

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS_NAME, Activity.MODE_PRIVATE);
    }

    private String getTreeUriString() {
        return prefs().getString(KEY_TREE_URI, null);
    }

    private void setTreeUriString(String uri) {
        prefs().edit().putString(KEY_TREE_URI, uri).apply();
    }

    @PluginMethod
    public void isSupported(PluginCall call) {
        JSObject out = new JSObject();
        out.put("supported", true);
        call.resolve(out);
    }

    @PluginMethod
    public void hasDirectory(PluginCall call) {
        String uri = getTreeUriString();
        JSObject out = new JSObject();
        out.put("hasDirectory", uri != null && !uri.isEmpty());
        call.resolve(out);
    }

    @PluginMethod
    public void pickDirectory(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        intent.addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        intent.addFlags(Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        startActivityForResult(call, intent, "pickDirectoryResult");
    }

    @ActivityCallback
    private void pickDirectoryResult(PluginCall call, ActivityResult result) {
        if (call == null) return;

        JSObject out = new JSObject();
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            out.put("ok", false);
            call.resolve(out);
            return;
        }

        Uri uri = result.getData().getData();
        int flags = result.getData().getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        try {
            getContext().getContentResolver().takePersistableUriPermission(uri, flags);
        } catch (Exception ignored) {
            // Some devices may already have persisted permission.
        }

        setTreeUriString(uri.toString());
        out.put("ok", true);
        out.put("uri", uri.toString());
        call.resolve(out);
    }

    @PluginMethod
    public void writeBackup(PluginCall call) {
        String displayName = call.getString("displayName");
        String base64 = call.getString("base64");
        if (displayName == null || displayName.trim().isEmpty() || base64 == null) {
            call.reject("invalid_args");
            return;
        }

        String treeUriString = getTreeUriString();
        if (treeUriString == null || treeUriString.isEmpty()) {
            call.reject("no_directory");
            return;
        }

        Uri treeUri = Uri.parse(treeUriString);
        DocumentFile root = DocumentFile.fromTreeUri(getContext(), treeUri);
        if (root == null || !root.canWrite()) {
            call.reject("permission_denied");
            return;
        }

        try {
            DocumentFile existing = root.findFile(displayName);
            if (existing != null) {
                existing.delete();
            }

            DocumentFile outFile = root.createFile("application/octet-stream", displayName);
            if (outFile == null) {
                call.reject("create_failed");
                return;
            }

            byte[] data = Base64.decode(base64, Base64.DEFAULT);
            try (OutputStream os = getContext().getContentResolver().openOutputStream(outFile.getUri(), "w")) {
                if (os == null) {
                    call.reject("open_failed");
                    return;
                }
                os.write(data);
                os.flush();
            }

            JSObject out = new JSObject();
            out.put("ok", true);
            out.put("filename", displayName);
            call.resolve(out);
        } catch (Exception e) {
            call.reject("write_failed:" + e.getMessage());
        }
    }
}
