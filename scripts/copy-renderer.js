// Копирует HTML-файлы рендерера из src/renderer/ в dist/renderer/
const fs = require('fs');
const path = require('path');

const src  = path.join(__dirname, '../src/renderer');
const dest = path.join(__dirname, '../dist/renderer');

fs.mkdirSync(dest, { recursive: true });

const files = fs.readdirSync(src);
for (const file of files) {
  fs.copyFileSync(path.join(src, file), path.join(dest, file));
  console.log(`  copied: ${file}`);
}
console.log('[build] Renderer files copied to dist/renderer/');
