import {defineConfig, devices} from '@playwright/test';

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
                        '--enable-features=FileSystemAccess', // Enable OPFS
                        '--disable-web-security'
                    ]
                }
            },
        },
        {
            name: 'Mobile Chrome',
            use: {...devices['Pixel 5']},
        },
    ],

    webServer: {
        command: 'npm run preview',
        url: 'http://localhost:4173',
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000,
    },
});