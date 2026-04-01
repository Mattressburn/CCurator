// build.js
// Packages the extension for Chrome and Firefox and guarantees
// that Firefox MV3 output contains browser_specific_settings.gecko.id.

const fs = require('fs-extra');
const path = require('path');

async function buildExtension() {
  const srcDir = path.resolve('./src/content');
  const chromeDist = path.resolve('./dist/chrome');
  const firefoxDist = path.resolve('./dist/firefox');
  const manifestPath = path.join(srcDir, 'manifest.json');

  // Clear previous builds
  await fs.emptyDir(chromeDist);
  await fs.emptyDir(firefoxDist);

  // Copy all source files to both targets
  await fs.copy(srcDir, chromeDist);
  await fs.copy(srcDir, firefoxDist);

  // Load source manifest
  const manifest = await fs.readJson(manifestPath);

  // -----------------------------
  // Chrome manifest
  // -----------------------------
  // Chrome does not need Firefox-specific settings.
  const chromeManifest = { ...manifest };
  delete chromeManifest.browser_specific_settings;

  await fs.writeJson(
    path.join(chromeDist, 'manifest.json'),
    chromeManifest,
    { spaces: 2 }
  );

  // -----------------------------
  // Firefox manifest
  // -----------------------------
  // Firefox MV3 requires an add-on ID for signing/submission.
  const firefoxManifest = { ...manifest };

  firefoxManifest.background = {
    scripts: ['background.js'],
    type: 'module'
  };

  firefoxManifest.browser_specific_settings = {
    ...(firefoxManifest.browser_specific_settings || {}),
    gecko: {
      ...((firefoxManifest.browser_specific_settings || {}).gecko || {}),
      id:
        ((firefoxManifest.browser_specific_settings || {}).gecko || {}).id ||
        'ccurate-tool@yourdomain.com'
    }
  };

  await fs.writeJson(
    path.join(firefoxDist, 'manifest.json'),
    firefoxManifest,
    { spaces: 2 }
  );

  console.log('Builds complete for Chrome and Firefox.');
  console.log(`Chrome manifest:  ${path.join(chromeDist, 'manifest.json')}`);
  console.log(`Firefox manifest: ${path.join(firefoxDist, 'manifest.json')}`);
  console.log(
    `Firefox add-on ID: ${firefoxManifest.browser_specific_settings.gecko.id}`
  );
}

buildExtension().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});