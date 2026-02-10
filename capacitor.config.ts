import type {CapacitorConfig} from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'org.openwaqf.lens',
    appName: 'Sahifah Lens',
    webDir: 'dist',

    plugins: {
        LocalNotifications: {
            smallIcon: "ic_stat_lens", // This matches your filename (no .png)
            iconColor: "#10B981",      // This turns the white icon Emerald Green!
            sound: "beep.wav",
        },
        PushNotifications: {
            presentationOptions: ["badge", "sound", "alert"],
        },
    },
};

export default config;