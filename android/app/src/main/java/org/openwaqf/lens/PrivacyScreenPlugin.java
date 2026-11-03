package org.openwaqf.lens;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.view.WindowManager;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * What other apps and the system can see of Lens.
 *
 * - Android 13+: Lens is always hidden in the recent-apps screen, but the user can take
 *   screenshots of their own scans.
 * - App Lock on: screenshots and screen recording are blocked too (FLAG_SECURE), on every
 *   Android version.
 *
 * Before Nov 2026 FLAG_SECURE was always on, so nobody could screenshot their own scan.
 * The choice is stored here, so it applies when the app starts, before the web page loads.
 */
@CapacitorPlugin(name = "PrivacyScreen")
public class PrivacyScreenPlugin extends Plugin {
    private static final String PREFS = "lens_privacy_screen";
    private static final String KEY_LOCK = "app_lock_enabled";

    /** Called from MainActivity.onCreate. */
    static void apply(Activity activity) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            activity.setRecentsScreenshotEnabled(false);
        }
        boolean lock = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_LOCK, false);
        setSecure(activity, lock);
    }

    private static void setSecure(Activity activity, boolean secure) {
        if (secure) {
            activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        } else {
            activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
        }
    }

    @PluginMethod
    public void setLockEnabled(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        prefs.edit().putBoolean(KEY_LOCK, enabled).apply();
        Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            setSecure(activity, enabled);
            call.resolve();
        });
    }
}
