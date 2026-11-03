import type {CapacitorConfig} from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'org.openwaqf.lens',
    appName: 'Sahifah Lens',
    webDir: 'dist',
    plugins: {
        // Light icons on both system bars: the app has only a dark design. With the phone in
        // light mode the default turned the status bar icons dark on the dark app, almost
        // invisible (seen on a phone, Nov 2026). Signer has the opposite setting (light app).
        SystemBars: {
            style: 'DARK',
        },
    },
};

export default config;
