import {defineConfig, devices} from '@playwright/test';

const proxyServer = process.env.E2E_PROXY_SERVER;
const networkQuietArgs = [
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-domain-reliability',
    '--disable-sync',
    '--metrics-recording-only',
];

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: 'html',

    use: {
        baseURL: 'http://localhost:4173',
        trace: 'on-first-retry',
        proxy: proxyServer ? {server: proxyServer} : undefined,
        // Permissions needed for clipboard and file system
        permissions: ['clipboard-read', 'clipboard-write'],
    },

    projects: [
        {
            name: 'Desktop Chrome',
            use: {
                ...devices['Desktop Chrome'],
                launchOptions: {
                    args: [
                        ...networkQuietArgs,
                        '--enable-features=FileSystemAccess', // Enable OPFS
                        '--disable-web-security'
                    ]
                }
            },
        },
        {
            name: 'Mobile Chrome',
            use: {
                ...devices['Pixel 5'],
                launchOptions: {
                    args: [...networkQuietArgs]
                }
            },
        },
    ],

    webServer: {
        command: 'npm run preview',
        url: 'http://localhost:4173',
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000,
    },
});
