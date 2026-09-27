import tailwindcss from '@tailwindcss/vite';
import fs from 'fs';
import {defineConfig} from 'vite';

// 版の出どころは public/version.json の1か所だけ。
// 画面の版表示（#appVersion）と「更新しました」のお知らせは、ここで埋め込む __APP_VERSION__ を読む。
const {version} = JSON.parse(
  fs.readFileSync(new URL('./public/version.json', import.meta.url), 'utf-8'),
);

export default defineConfig({
  plugins: [tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
});
