package org.openwaqf.lens;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * "Sign with Signer": hand a PDF straight to Open Waqf Signer, without the share sheet.
 * Signer receives it like a normal share (ACTION_SEND) and opens it ready to sign.
 * The apps Lens may look for are listed in AndroidManifest.xml (<queries>).
 */
@CapacitorPlugin(name = "SignerHandoff")
public class SignerHandoffPlugin extends Plugin {
    private static final String SIGNER = "org.openwaqf.signer";
    private static final String SIGNER_DEV = "org.openwaqf.signer.dev";

    private boolean installed(String pkg) {
        try {
            getContext().getPackageManager().getPackageInfo(pkg, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    /** Lens Dev prefers Signer Dev, the store app prefers the store Signer. */
    private String signerPackage() {
        boolean dev = getContext().getPackageName().endsWith(".dev");
        String first = dev ? SIGNER_DEV : SIGNER;
        String second = dev ? SIGNER : SIGNER_DEV;
        if (installed(first)) return first;
        if (installed(second)) return second;
        return null;
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject out = new JSObject();
        out.put("available", signerPackage() != null);
        call.resolve(out);
    }

    /** path: a file in the app's cache folder, e.g. "share/1793703235098/Invoice.pdf". */
    @PluginMethod
    public void open(PluginCall call) {
        String path = call.getString("path");
        String pkg = signerPackage();
        if (path == null || pkg == null) {
            call.reject("signer_unavailable");
            return;
        }
        File file = new File(getContext().getCacheDir(), path);
        if (!file.exists()) {
            call.reject("file_missing");
            return;
        }
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
        Intent intent = new Intent(Intent.ACTION_SEND);
        intent.setType("application/pdf");
        intent.putExtra(Intent.EXTRA_STREAM, uri);
        intent.setClipData(android.content.ClipData.newRawUri(file.getName(), uri));
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.setPackage(pkg);
        try {
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("open_failed:" + e.getMessage());
        }
    }
}
