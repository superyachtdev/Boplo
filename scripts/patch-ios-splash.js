/* Copies the splash-screen fix into node_modules before `cap sync`.
   Capacitor compiles that package from disk. The stock plugin disables every touch
   until a hide animation finishes, and that completion is skipped while the page loads. */
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'node_modules/@capacitor/splash-screen/ios/Sources/SplashScreenPlugin/SplashScreen.swift');
if (!existsSync(dest)) {
  console.log('splash-screen package is not installed; skipping the touch fix');
  process.exit(0);
}
copyFileSync(join(root, 'native/patches/SplashScreen.swift'), dest);
console.log('patched Capacitor splash screen so a cancelled hide cannot leave the desk untappable');
