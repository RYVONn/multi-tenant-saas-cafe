const fs = require('fs');
const path = require('path');

const cacheDir = path.join(__dirname, '../..', 'uploads', 'cache');
const originalDir = path.join(__dirname, '../..', 'uploads', 'products');

if (!fs.existsSync(cacheDir)) {
  console.log('Cache directory does not exist.');
  process.exit(0);
}
if (!fs.existsSync(originalDir)) {
  console.log('Original directory does not exist.');
  process.exit(0);
}

const cacheFiles = fs.readdirSync(cacheDir);
let deletedCount = 0;

cacheFiles.forEach(file => {
  const match = file.match(/^(.*)_w(\d+|auto)_q\d+\.webp$/);
  if (match) {
    const baseName = match[1];
    const originalFiles = fs.readdirSync(originalDir);
    const hasOriginal = originalFiles.some(orig => {
      const origBase = path.parse(orig).name;
      return origBase === baseName;
    });
    
    if (!hasOriginal) {
      fs.unlinkSync(path.join(cacheDir, file));
      console.log(`Deleted orphaned cache file: ${file}`);
      deletedCount++;
    }
  }
});

console.log(`Cleaned up ${deletedCount} orphaned cache files.`);
