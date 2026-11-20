package one.tch.ububall;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        boolean needsOtaWatchdog = OtaUpdaterPlugin.prepareOnLaunch(this);
        registerPlugin(OtaUpdaterPlugin.class);
        super.onCreate(savedInstanceState);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        if (needsOtaWatchdog) {
            OtaUpdaterPlugin.armBootWatchdog(this, getBridge());
        }
    }
}
