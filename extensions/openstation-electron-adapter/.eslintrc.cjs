/**
 * ESLint configuration for the Electron Adapter.
 *
 * Same baseline as the OpenStation shell — WordPress's first-party rule
 * set plus `@typescript-eslint` — so code moving between the two reads
 * the same. What differs is what the two halves of this package are
 * allowed to touch, and that is enforced rather than trusted:
 *
 *   - `src/**` is **browser** code. It runs inside wp-admin, in the
 *     same realm as every other plugin. It must not import `electron`
 *     or Node built-ins, and it must go through the shell's public API
 *     rather than reaching into globals.
 *   - `app/src/**` is **Electron** code. Node is expected there, the
 *     DOM mostly is not, and the two preload boundaries have rules of
 *     their own: a preload that leaks `ipcRenderer` into the page
 *     hands a web page the ability to talk to Node, which is the whole
 *     failure mode `contextIsolation` exists to prevent.
 *
 * The custom `no-restricted-imports` / `no-restricted-globals` entries
 * below are the teeth. They are the difference between "we intend to
 * keep these separate" and "they are separate."
 */
module.exports = {
	root: true,
	parser: '@typescript-eslint/parser',
	parserOptions: {
		ecmaVersion: 2022,
		sourceType: 'module',
	},
	extends: [
		'plugin:@wordpress/eslint-plugin/recommended-with-formatting',
		'plugin:@typescript-eslint/recommended',
	],
	settings: {
		'import/resolver': {
			typescript: {},
			node: { extensions: [ '.js', '.ts' ] },
		},
	},
	rules: {
		// TS already checks types; JSDoc @param types are redundant
		// noise in a TypeScript-first codebase.
		'jsdoc/require-param-type': 'off',
		'jsdoc/require-returns-type': 'off',
		'jsdoc/no-undefined-types': 'off',
		'jsdoc/require-jsdoc': 'off',
		// This package has no @wordpress/* runtime dependencies, so
		// Gutenberg-style import grouping does not apply.
		'@wordpress/dependency-group': 'off',
		// `console.error` is how a preload or a main-process failure
		// reaches a developer running `npm start`. Keep it.
		'no-console': [ 'error', { allow: [ 'warn', 'error', 'info' ] } ],
		'no-unused-vars': 'off',
		'@typescript-eslint/no-unused-vars': [
			'error',
			{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
		],
		'@typescript-eslint/explicit-module-boundary-types': 'off',
		indent: [ 'error', 'tab', { SwitchCase: 1 } ],
		'no-mixed-operators': 'off',
		// `no-duplicate-imports` (the core rule) is supposed to allow a
		// value import alongside an `import type` from the same source,
		// and in ESLint 8.x it does not. That pairing is exactly the
		// shape a TypeScript module wants — same file, values and types
		// — so the rule is off rather than carried as a disable comment
		// on every module that imports both.
		'no-duplicate-imports': 'off',
		// A constructor whose only job is `private readonly deps` is
		// TypeScript's parameter-property shorthand, not a useless
		// constructor. The base rule cannot see the difference.
		'no-useless-constructor': 'off',
		// This package's user-facing strings are few and live in one
		// module, which reads `wp.i18n` off the page rather than
		// importing `@wordpress/i18n`. The domain is a module constant;
		// the rules want it inlined at every call site.
		'@wordpress/i18n-text-domain': 'off',
		'@wordpress/i18n-no-variables': 'off',
	},
	overrides: [
		{
			// Browser half — the WordPress admin realm.
			files: [ 'src/**/*.ts' ],
			env: { browser: true, es2022: true },
			rules: {
				// Same teeth the shell and the other extensions carry.
				// A site request that skips `wp.os.fetch` is invisible
				// to the window spinner and the activity bus. The
				// loopback calls to the desktop app are the documented
				// exception and carry a disable with the reason.
				'no-restricted-syntax': [
					'error',
					{
						selector: 'CallExpression[callee.name="fetch"]',
						message:
							'Use wp.os.fetch so OpenStation can track the request.',
					},
					{
						selector:
							'CallExpression[callee.object.name="window"][callee.property.name=/^(confirm|alert|prompt)$/]',
						message: 'Use a OpenStation dialog or status surface.',
					},
				],
				'no-restricted-imports': [
					'error',
					{
						paths: [
							{
								name: 'electron',
								message:
									'src/** is browser code loaded into wp-admin. Electron belongs in app/src/**; talk to it through the injected bridge instead.',
							},
						],
						patterns: [
							{
								group: [ 'node:*', 'fs', 'path', 'crypto', 'os', 'child_process' ],
								message:
									'src/** is browser code. Node built-ins belong in app/src/**.',
							},
						],
					},
				],
				'no-restricted-globals': [
					'error',
					{
						name: 'require',
						message:
							'src/** is bundled ES-module browser code — use an import.',
					},
					{
						name: 'process',
						message:
							'src/** is browser code and has no process. Read platform facts off the injected host bridge.',
					},
				],
			},
		},
		{
			// Electron half — main process and preloads.
			files: [ 'app/src/**/*.ts' ],
			env: { node: true, es2022: true },
			rules: {
				// `document` / `window` are legitimate in the renderer
				// entry only; everywhere else in app/src they would be
				// a sign of code that wandered into the wrong process.
				'no-restricted-globals': [
					'error',
					{
						name: 'document',
						message:
							'Main-process and preload code has no document. Renderer code belongs in app/src/renderer/.',
					},
				],
			},
		},
		{
			// The renderer entry is the one place in app/src that IS a
			// web page, so it gets the DOM back.
			files: [ 'app/src/renderer/**/*.ts' ],
			env: { browser: true, node: false },
			rules: { 'no-restricted-globals': 'off' },
		},
		{
			// Preloads are the security boundary. `contextBridge` is
			// the only sanctioned way across it: exposing `ipcRenderer`
			// itself would hand the page an unbounded channel to Node,
			// which is exactly what contextIsolation exists to stop.
			files: [ 'app/src/preload/**/*.ts' ],
			rules: {
				'no-restricted-syntax': [
					'error',
					{
						selector:
							'CallExpression[callee.object.name="contextBridge"][callee.property.name="exposeInMainWorld"] > Identifier[name="ipcRenderer"]',
						message:
							'Never expose ipcRenderer to the page. Expose named functions that invoke specific channels.',
					},
					{
						selector:
							'CallExpression[callee.object.name="contextBridge"][callee.property.name="exposeInMainWorld"] Property[key.name="ipcRenderer"]',
						message:
							'Never expose ipcRenderer to the page. Expose named functions that invoke specific channels.',
					},
				],
			},
		},
		{
			files: [ 'tests/**/*.ts' ],
			env: { node: true, browser: true, es2022: true },
			rules: {
				// Tests reach into private state and fake partial
				// interfaces on purpose; that is what makes them short.
				'@typescript-eslint/no-explicit-any': 'off',
				'@typescript-eslint/no-non-null-assertion': 'off',
				// A test helper's contract is the test that calls it,
				// three lines below. Requiring @param on each one buys
				// nothing and pushes the assertions off the screen.
				'jsdoc/require-param': 'off',
				'jsdoc/check-param-names': 'off',
			},
		},
		{
			files: [ 'vite.config.mjs', '.eslintrc.cjs', 'scripts/*.mjs' ],
			env: { node: true },
			parser: 'espree',
			rules: { '@typescript-eslint/no-var-requires': 'off' },
		},
	],
	ignorePatterns: [ 'assets/js/**', 'app/dist/**', 'node_modules/**' ],
};
