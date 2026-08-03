/**
 * Vitest configuration for the openstation TypeScript test suite.
 *
 * Mirrors the existing Vite build in key ways — same TypeScript
 * target, same module resolution — while swapping in a jsdom
 * environment so tests can exercise DOM-manipulating code (window,
 * registries that touch `document`, toast lifecycle).
 *
 * Tests live under `tests/vitest/` — parallel to `tests/phpunit/`.
 * They import the real modules from `src/` rather than mocking the
 * shell, so we're testing what actually ships.
 */
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig( {
	resolve: {
		alias: {
			'@/':              resolve( __dirname, 'src/' ) + '/',
			'@api/':           resolve( __dirname, 'src/api/' ) + '/',
			'@boot/':          resolve( __dirname, 'src/boot/' ) + '/',
			'@core/':          resolve( __dirname, 'src/core/' ) + '/',
			'@features/':      resolve( __dirname, 'src/features/' ) + '/',
			'@layout/':        resolve( __dirname, 'src/layout/' ) + '/',
			'@protocol/':      resolve( __dirname, 'src/protocol/' ) + '/',
			'@ui/':            resolve( __dirname, 'src/ui/' ) + '/',
			'@window-system/': resolve( __dirname, 'src/window-system/' ) + '/',
		},
	},
	test: {
		environment: 'jsdom',
		globals: false,
		// Pre-register every `<os-*>` component class that production
		// code loads via the `shell-overlays[.min].js` lazy bundle
		// (toast / confirm / context-menu). Production main bundle
		// does NOT eager-import them anymore (Stage 9); the setup
		// file is in `tests/vitest/` so it never reaches a production
		// build.
		setupFiles: [ './tests/vitest/setup.ts' ],
		// Two include paths:
		// - `tests/vitest/` for cross-module integration / shell tests
		// - `src/**/*.test.ts` for component-local specs that live
		//   next to the code they test (one folder per component
		//   keeps styles + logic + tests together)
		include: [ 'tests/vitest/**/*.test.ts', 'src/**/*.test.ts' ],
		// A fresh module graph per test file keeps registry state
		// (hooks, wallpapers, modules) from leaking between
		// top-level describes in different files.
		isolate: true,
		// Short timeout — these are pure unit tests, nothing should
		// take longer than a few ms. Helps catch accidental awaits.
		testTimeout: 2000,
	},
} );
