package org.openwaqf.lens;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(PrivacyScreenPlugin.class);
        registerPlugin(SignerHandoffPlugin.class);
        registerPlugin(CameraCapturePlugin.class);
        super.onCreate(savedInstanceState);
        // Hidden in recent apps (Android 13+); screenshots blocked only with App Lock on.
        PrivacyScreenPlugin.apply(this);
    }
}
