# Dependencies: what ships, what is a tool, and what is pinned

## Two kinds of dependencies

| Kind | Where in package.json | Reaches users? | Examples |
|---|---|---|---|
| **Shipped** | `dependencies` | Yes: bundled into the web app or built into the Android app | lit, dexie, pdf-lib, tesseract.js, jszip, fflate, @capacitor/core and plugins, @capacitor/android |
| **Tools** | `devDependencies` | No: they only run on your machine or in CI | vite, vite-plugin-pwa, typescript, vitest, @playwright/test, @capacitor/cli, @capacitor/assets |

Rule: if a package is not imported by `src/` and not compiled into the Android app, it is a
tool and belongs in `devDependencies`. A package the app loads at run time must be a direct
dependency, never something that happens to arrive through another package.

## Security alerts: which ones matter

- `npm audit --omit=dev` lists alerts in **shipped** code. These reach users. Fix them quickly,
  with the full test suite and a check on the phone.
- `npm audit` (no flag) also lists alerts in **tools** (today: @capacitor/cli, @capacitor/assets
  and vite-plugin-pwa pull in xmldom, sharp, brace-expansion and similar). They run only on
  your machine with your own files, so they are not urgent. Take the fixes when Dependabot
  offers them, never with `npm audit fix --force` (it downgrades major versions).

## Updates (Dependabot)

Once a month, Dependabot (`.github/dependabot.yml`) opens at most:
- one pull request for all Capacitor packages together,
- one pull request with all other npm minor and patch updates,
- separate pull requests for npm major versions,
- one pull request for the GitHub Actions versions.

Merge a pull request only if its checks pass. Capacitor and plugin updates also need the
phone flows (Quick Scan, share, backup, app lock) before a release.

## Pinned versions and why

Do not upgrade these with a tool. Decline Dependabot pull requests for them.

| What | Kind | Stay on | Why | How to upgrade |
|---|---|---|---|---|
| `typescript` | Tool | `6.0.x` | TypeScript 7 ships no `tsserver`, so IntelliJ loses type checking. | When IntelliJ supports TypeScript 7. |
| `tesseract.js` | Shipped | `7.0.0` | `public/tesseract/worker.min.js` and `tesseract-core.wasm.js` are copies of the package files and must match its version. | Upgrade, then copy `node_modules/tesseract.js/dist/worker.min.js` and `node_modules/tesseract.js-core/tesseract-core.wasm.js` into `public/tesseract/`. If the `.traineddata` files change, update the SHA-256 hashes in `src/lib/ocr.ts`. Run an Arabic and an English OCR on the phone. |
| `@types/node` | Tool | `25.x` | Types must match the Node we run (22 on GitHub, 24 here). Newer types let code use APIs that do not exist on that Node. | Together with a Node upgrade (`.nvmrc`). |
| `@playwright/test` | Tool | exact version | Browser builds are tied to the version. | Bump, then `npx playwright install chromium`. |

`pdf-lib` 1.17.1 and `@pdf-lib/fontkit` 1.1.1 have had no release since 2022. They are
stable and Signer uses the same versions. Nothing to upgrade.

## Upgrade notes (things that broke once, and how they were fixed)

- **Vitest 5** refuses `vi.mock()` written inside `beforeEach` or a test. Write every
  `vi.mock()` at the top level of the test file (it always ran there anyway).
- **Capacitor 8.0 to 8.3.4** has a critical advisory (remote content loaded at the app
  origin). Never go back below 8.3.5.
- **fflate before 0.8.3** can loop forever on a malformed ZIP64 file. Keep 0.8.3 or newer.

## Traps to keep

- Node 22 or newer (`.nvmrc`, `engines` in `package.json`): the Capacitor 8 CLI and Vitest 5
  need it.
- Keep all `@capacitor/*` packages on the same minor version (for example all 8.6.x), and run
  `npx cap sync android` after any change to them.

## Removed on purpose (Nov 2026)

| Package | Why |
|---|---|
| `@capacitor/camera` | Never imported. Quick Scan uses ML Kit; manual scan uses the browser camera. |
| `vite-plugin-compression`, `vite-plugin-progress`, `rollup-plugin-visualizer` | Not configured, or only cosmetic. |
| `@types/jszip` | jszip ships its own types. |
