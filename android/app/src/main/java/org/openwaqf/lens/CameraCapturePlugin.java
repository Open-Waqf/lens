package org.openwaqf.lens;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.provider.MediaStore;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

/**
 * Takes one photo with the phone's own camera app (the fallback when Google's document
 * scanner is not on the phone). Lens needs no camera permission for this: the camera app
 * takes the picture and writes it into Lens's cache through the FileProvider.
 */
@CapacitorPlugin(name = "CameraCapture")
public class CameraCapturePlugin extends Plugin {
    private File pending;

    @PluginMethod
    public void takePhoto(PluginCall call) {
        File dir = new File(getContext().getCacheDir(), "camera");
        if (!dir.exists() && !dir.mkdirs()) {
            call.reject("Could not make the camera folder", "IO");
            return;
        }
        pending = new File(dir, "photo-" + System.currentTimeMillis() + ".jpg");
        Uri out = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", pending);
        Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        intent.putExtra(MediaStore.EXTRA_OUTPUT, out);
        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            startActivityForResult(call, intent, "photoTaken");
        } catch (ActivityNotFoundException e) {
            call.reject("No camera app on this phone", "NO_CAMERA");
        }
    }

    @ActivityCallback
    private void photoTaken(PluginCall call, ActivityResult result) {
        if (call == null) return;
        File file = pending;
        pending = null;
        if (result.getResultCode() != Activity.RESULT_OK || file == null || !file.exists() || file.length() == 0) {
            if (file != null) file.delete();
            call.reject("User cancelled the camera", "USER_CANCELLED");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("path", file.getAbsolutePath());
        call.resolve(ret);
    }
}
