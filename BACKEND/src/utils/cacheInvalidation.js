const fs = require('fs');
const path = require('path');

exports.clearImageCache = (filename) => {
  if (!filename) return;
  const cacheDir = path.join(__dirname, '../../..', 'uploads', 'cache');
  if (!fs.existsSync(cacheDir)) return;

  const baseName = path.parse(filename).name;
  
  // Read cache directory and delete all files starting with baseName + '_'
  fs.readdir(cacheDir, (err, files) => {
    if (err) {
      console.error('Error reading cache directory:', err);
      return;
    }
    files.forEach(file => {
      if (file.startsWith(baseName + '_')) {
        fs.unlink(path.join(cacheDir, file), (err) => {
          if (err) console.error('Error deleting cached image:', file, err);
        });
      }
    });
  });
};
