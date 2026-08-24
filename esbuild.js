/* eslint-disable @typescript-eslint/no-var-requires */
const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const extensionOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const webviewOptions = {
  entryPoints: ['src/webview/index.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  outfile: 'dist/webview.js',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

async function main() {
  const contexts = [extensionOptions, webviewOptions];

  if (watch) {
    const ctxs = await Promise.all(contexts.map((opts) => esbuild.context(opts)));
    await Promise.all(ctxs.map((ctx) => ctx.watch()));
    console.log('[esbuild] watching for changes...');
    return;
  }

  await Promise.all(contexts.map((opts) => esbuild.build(opts)));
  console.log('[esbuild] build complete');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
