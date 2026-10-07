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
			'@openstation/app': resolve( __dirname, 'src/app-runtime/client.ts' ),
		},
	},
	test: {
		environment: 'jsdom',
		globals: false,

		setupFiles: [ './tests/vitest/setup.ts' ],

		include: [ 'tests/vitest/**/*.test.ts', 'src/**/*.test.ts', 'apps/**/*.test.ts' ],

		isolate: true,

		testTimeout: 2000,
	},
} );
