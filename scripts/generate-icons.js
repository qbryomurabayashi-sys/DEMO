// public/icon.svg から、ホーム画面・インストール用の PNG を作る。
// 実行: node scripts/generate-icons.js（sharp は devDependencies）
// 読み書きは fs で行う（フォルダ名に日本語があっても確実に通すため）。
import sharp from 'sharp';
import fs from 'fs';
import {fileURLToPath} from 'url';

const inPublic = (name) => fileURLToPath(new URL(`../public/${name}`, import.meta.url));

const svg = fs.readFileSync(inPublic('icon.svg'));

// [ファイル名, 一辺(px), 透明をなくすか]
const targets = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['manifest-icon-192.maskable.png', 192, false],
  ['manifest-icon-512.maskable.png', 512, false],
  // iPhone のホーム画面用。透明を持たせない（紺で埋めて RGB で出す）。
  ['apple-icon-180.png', 180, true],
];

try {
  for (const [name, size, opaque] of targets) {
    let image = sharp(svg).resize(size, size);
    if (opaque) image = image.flatten({background: '#00004B'});
    fs.writeFileSync(inPublic(name), await image.png().toBuffer());
    console.log(`Generated ${name} (${size}x${size})`);
  }
} catch (err) {
  console.error(err);
  process.exitCode = 1;
}
