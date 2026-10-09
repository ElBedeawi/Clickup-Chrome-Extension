// The same smoke scenes as ui.test.mjs, run in headless Firefox over WebDriver BiDi.
// Needs Firefox 128+ (set FIREFOX=/path if it isn't found). Run: npm run test:smoke:firefox
process.env.SMOKE_BROWSER = 'firefox';
await import('./ui.test.mjs');
