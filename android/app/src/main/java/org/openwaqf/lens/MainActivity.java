package org.openwaqf.lens;

import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(MirrorBackupPlugin.class);
        super.onCreate(savedInstanceState);
        // QA-SEC-001: Prevent screenshots and hide content in task switcher
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
    }
}
