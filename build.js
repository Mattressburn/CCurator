// build.js - A simple Node script to package for both browsers
const fs = require('fs-extra');

async function buildExtension() {
    const srcDir = './src/content';
    const chromeDist = './dist/chrome';
    const firefoxDist = './dist/firefox';

    // Clear previous builds
    await fs.emptyDir(chromeDist);
    await fs.emptyDir(firefoxDist);

    // Copy all files to both
    await fs.copy(srcDir, chromeDist);
    await fs.copy(srcDir, firefoxDist);

    // Firefox-specific Manifest adjustment
    const manifest = await fs.readJson(`${srcDir}/manifest.json`);

    // Firefox prefers background.scripts over service_worker in many MV3 setups
    const firefoxManifest = { ...manifest };
    firefoxManifest.background = {
        scripts: ["background.js"],
        type: "module"
    };

    await fs.writeJson(`${firefoxDist}/manifest.json`, firefoxManifest, { spaces: 2 });
    console.log("Builds complete for Chrome and Firefox.");
}

buildExtension();