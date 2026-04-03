#!/usr/bin/env node
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');
if (!fs.existsSync(distDir)) fs.mkdirSync(distDir);

(async () => {
  console.log('Building JotterJS...');

  // Minified ESM bundle
  await esbuild.build({
    entryPoints: ['src/jotter.js'],
    bundle: true,
    minify: true,
    format: 'esm',
    outfile: 'dist/jotter.min.js',
    sourcemap: false,
  });

  // Minified IIFE bundle (browser global)
  await esbuild.build({
    entryPoints: ['src/jotter.js'],
    bundle: true,
    minify: true,
    format: 'iife',
    globalName: 'JotterJS',
    outfile: 'dist/jotter.iife.min.js',
    sourcemap: false,
  });

  // Minify CSS
  await esbuild.build({
    entryPoints: ['src/jotter.css'],
    bundle: true,
    minify: true,
    outfile: 'dist/jotter.min.css',
    loader: { '.woff2': 'file' },
    assetNames: 'fonts/[name]',
  });

  // Unminified ESM for development / inspection
  await esbuild.build({
    entryPoints: ['src/jotter.js'],
    bundle: true,
    minify: false,
    format: 'esm',
    outfile: 'dist/jotter.js',
  });

  const stat = fs.statSync('dist/jotter.min.js');
  const cssstat = fs.statSync('dist/jotter.min.css');
  console.log(`✓ dist/jotter.min.js       ${(stat.size / 1024).toFixed(1)} kB`);
  console.log(`✓ dist/jotter.iife.min.js  (IIFE browser global)`);
  console.log(`✓ dist/jotter.min.css      ${(cssstat.size / 1024).toFixed(1)} kB`);
  console.log(`✓ dist/jotter.js           (unminified)`);
  console.log('\nBuild complete.');
})();
