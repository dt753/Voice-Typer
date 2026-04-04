/**
 * afterPack hook для electron-builder.
 * Запускается после сборки .app (до создания DMG).
 * На macOS выполняет ad-hoc подпись — без Developer ID,
 * но достаточно чтобы macOS корректно обрабатывала разрешения (микрофон и т.д.)
 */

const { execSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productName;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  console.log(`[SIGN] Ad-hoc подпись: ${appPath}`);

  try {
    execSync(`codesign --deep --force --sign - "${appPath}"`, { stdio: 'inherit' });
    console.log('[SIGN] ✓ Готово');
  } catch (err) {
    console.error('[SIGN] Ошибка подписи:', err.message);
    console.error('[SIGN] Убедитесь, что Xcode Command Line Tools установлены: xcode-select --install');
  }
};
