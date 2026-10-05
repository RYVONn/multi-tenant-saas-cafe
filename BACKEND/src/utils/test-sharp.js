const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

sharp.cache(false);

const originalDir = path.join(__dirname, '../..', 'uploads', 'products');
const cacheDir = path.join(__dirname, '../..', 'uploads', 'cache');

if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir, { recursive: true });
}

async function testOptimization() {
  const files = fs.readdirSync(originalDir);
  const imageFiles = files.filter(f => /\.(jpe?g|png|webp)$/i.test(f));
  
  if (imageFiles.length === 0) {
    console.log('No images found to test.');
    return;
  }

  const sampleFile = imageFiles[0];
  const originalPath = path.join(originalDir, sampleFile);
  const originalStat = fs.statSync(originalPath);
  const originalSizeKb = (originalStat.size / 1024).toFixed(2);

  console.log(`Original Image: ${sampleFile}`);
  console.log(`Original Size: ${originalSizeKb} KB`);

  const sizesToTest = [150, 400, 500, 800];

  for (const width of sizesToTest) {
    const ext = '.webp';
    const filename = path.parse(sampleFile).name;
    const cacheFilename = `${filename}_w${width}_q80${ext}`;
    const cachePath = path.join(cacheDir, cacheFilename);

    let transform = sharp(originalPath)
      .resize({ width, withoutEnlargement: true, fit: 'cover' })
      .webp({ quality: 80 });
      
    await transform.toFile(cachePath);

    const optimizedStat = fs.statSync(cachePath);
    const optimizedSizeKb = (optimizedStat.size / 1024).toFixed(2);
    const reduction = (((originalStat.size - optimizedStat.size) / originalStat.size) * 100).toFixed(2);

    console.log(`\nOptimized Size (${width}px): ${optimizedSizeKb} KB`);
    console.log(`Reduction: ${reduction}%`);
  }
}

testOptimization().catch(console.error);
