import { build } from 'esbuild';
import fs from 'fs';
const mock = process.argv.includes('--mock');
const out = mock ? 'dist-test' : 'dist';
const version = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
await build({ entryPoints: [mock ? 'src/main-mock.js' : 'src/main.js'], bundle: true, minify: true, format: 'esm', target: ['es2020', 'safari15'], outfile: `${out}/app.js` });
for (const f of fs.readdirSync('public')) {
  const src = `public/${f}`;
  if (/\.(html|js|webmanifest)$/.test(f)) fs.writeFileSync(`${out}/${f}`, fs.readFileSync(src, 'utf8').replaceAll('__VERSION__', version));
  else fs.copyFileSync(src, `${out}/${f}`);
}
fs.writeFileSync(`${out}/.nojekyll`, '');
console.log(out, version, (fs.statSync(`${out}/app.js`).size / 1024).toFixed(0) + ' KB');
