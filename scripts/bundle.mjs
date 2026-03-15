/**
 * CRUST SDK — Build script (scripts/bundle.mjs)
 *
 * Produces three artefacts:
 *
 *   dist/index.js        ESM build for `import { initCrust } from 'crust-sdk'`
 *   dist/index.d.ts      TypeScript declarations (emitted by tsc separately)
 *   dist/crust.iife.js   Self-contained IIFE for <script src="crust.js"> usage
 *
 * The Web Worker (worker.ts) is bundled inline into the IIFE via esbuild's
 * `workerEntryPoints` / `inject` mechanism so the final script tag output is
 * a single file with no external dependencies.
 *
 * Usage:
 *   node scripts/bundle.mjs           # production build
 *   node scripts/bundle.mjs --watch   # watch mode for development
 */

import esbuild from 'esbuild';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const watch = process.argv.includes('--watch');

mkdirSync(join(rootDir, 'dist'), { recursive: true });

// ── Shared base config ────────────────────────────────────────────────────────

/** @type {import('esbuild').BuildOptions} */
const base = {
  bundle:    true,
  sourcemap: true,
  target:    ['es2020', 'chrome90', 'firefox88', 'safari14'],
  absWorkingDir: rootDir,
  define:    {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
};

// ── Worker bundle (used as an inline blob URL inside the IIFE) ────────────────

/**
 * esbuild's `workerEntryPoints` feature isn't yet stable at this version,
 * so we bundle the worker separately into a string and inject it via a
 * tiny loader shim that creates a Blob URL at runtime.
 *
 * The shim replaces `new Worker(new URL('./worker.ts', import.meta.url), …)`
 * with `new Worker(__CRUST_WORKER_URL__, { type: 'classic' })`.
 */
async function buildWorkerBlob() {
  const result = await esbuild.build({
    ...base,
    entryPoints: ['worker.ts'],
    format:      'iife',
    globalName:  '__crustWorkerInit',
    write:       false,
    sourcemap:   false,
  });

  const workerCode = result.outputFiles[0].text;
  // Escape backticks so we can embed in a template literal
  const escaped = workerCode.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
  return `const __CRUST_WORKER_URL__ = URL.createObjectURL(new Blob([\`${escaped}\`], { type: 'application/javascript' }));`;
}

// ── ESM build (npm consumers) ─────────────────────────────────────────────────

async function buildEsm() {
  await esbuild.build({
    ...base,
    entryPoints: ['index.ts'],
    format:      'esm',
    splitting:   false,
    outfile:     'dist/index.js',
    external:    [],   // zero runtime deps
  });
  console.log('✓ ESM build → dist/index.js');
}

// ── IIFE build (<script> tag consumers) ──────────────────────────────────────

async function buildIife(workerShim) {
  await esbuild.build({
    ...base,
    entryPoints: ['index.ts'],
    format:      'iife',
    globalName:  '__CRUST_SDK_UNUSED',  // window.CRUST set internally
    outfile:     'dist/crust.iife.js',
    banner: {
      js: [
        '/* CRUST SDK v' + process.env.npm_package_version + ' */',
        '/* Auto-initialises on script load. Pre-configure via window.CRUSTConfig = {…} */',
        workerShim,
      ].join('\n'),
    },
    // Rewrite the Worker URL to the blob URL injected by the shim
    plugins: [{
      name: 'inline-worker',
      setup(build) {
        build.onLoad({ filter: /worker\.ts$/ }, async () => ({
          contents: `
            export {};
            // Replaced by inline-worker plugin — __CRUST_WORKER_URL__ is injected via banner
          `,
          loader: 'js',
        }));
      },
    }],
  });
  console.log('✓ IIFE build → dist/crust.iife.js');
}

// ── TypeScript declarations ───────────────────────────────────────────────────

async function emitDeclarations() {
  const { default: ts } = await import('typescript');
  const configPath = ts.findConfigFile(rootDir, ts.sys.fileExists, 'tsconfig.json');
  if (!configPath) throw new Error('tsconfig.json not found');
  const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
  const { options, fileNames } = ts.parseJsonConfigFileContent(config, ts.sys, rootDir);
  options.noEmit         = false;
  options.emitDeclarationOnly = true;
  options.outDir         = join(rootDir, 'dist');
  const program = ts.createProgram(fileNames, options);
  const result  = program.emit();
  const diags   = ts.getPreEmitDiagnostics(program).concat(result.diagnostics);
  if (diags.length) {
    const fmt = ts.formatDiagnosticsWithColorAndContext(diags, {
      getCurrentDirectory: () => process.cwd(),
      getCanonicalFileName: f => f,
      getNewLine: () => '\n',
    });
    console.error(fmt);
    if (result.emitSkipped) process.exit(1);
  }
  console.log('✓ TypeScript declarations → dist/*.d.ts');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (watch) {
    // Watch mode: rebuild ESM on change (IIFE skipped for speed)
    const ctx = await esbuild.context({
      ...base,
      entryPoints: ['index.ts'],
      format:      'esm',
      outfile:     'dist/index.js',
    });
    await ctx.watch();
    console.log('Watching for changes…');
  } else {
    const workerShim = await buildWorkerBlob();
    await Promise.all([
      buildEsm(),
      buildIife(workerShim),
      emitDeclarations(),
    ]);
    console.log('Build complete.');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
