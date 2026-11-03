// android-manifest.test.ts: the Android app keeps its privacy promise in its manifest.
import fs from 'node:fs';
import {describe, expect, it} from 'vitest';

const manifest = fs.readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');

describe('Android manifest: documents never leave the device', () => {
    it('turns off backup (Android 11 and older)', () => {
        expect(manifest).toMatch(/android:allowBackup="false"/);
        expect(manifest).toMatch(/android:fullBackupContent="false"/);
    });

    it('turns off cloud backup and device-to-device copy on Android 12+', () => {
        // Regression (Nov 2026): allowBackup=false alone still let a new phone copy the
        // library during setup. Data extraction rules must exclude every domain.
        expect(manifest).toMatch(/android:dataExtractionRules="@xml\/data_extraction_rules"/);
        const rules = fs.readFileSync('android/app/src/main/res/xml/data_extraction_rules.xml', 'utf8');
        for (const section of ['cloud-backup', 'device-transfer']) {
            const body = rules.match(new RegExp(`<${section}>([\\s\\S]*?)</${section}>`))?.[1] || '';
            for (const domain of ['root', 'file', 'database', 'sharedpref', 'external']) {
                expect(body, `${section} must exclude ${domain}`).toContain(`domain="${domain}"`);
            }
        }
    });

    it('asks for no camera, storage or location permission', () => {
        expect(manifest).not.toMatch(/permission\.(CAMERA|READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|ACCESS_FINE_LOCATION)/);
    });
});

describe('Android launch screen', () => {
    it('is dark in the phone light mode too (the app has only a dark design)', () => {
        // Regression (Nov 2026): Android 12+ drew the splash white when the phone was in light mode.
        const styles = fs.readFileSync('android/app/src/main/res/values/styles.xml', 'utf8');
        const launch = styles.match(/<style name="AppTheme.NoActionBarLaunch"[\s\S]*?<\/style>/)?.[0] || '';
        expect(launch).toContain('<item name="windowSplashScreenBackground">@color/splash_background</item>');
        const colors = fs.readFileSync('android/app/src/main/res/values/splash.xml', 'utf8');
        expect(colors).toContain('<color name="splash_background">#0F172A</color>');
    });
});
