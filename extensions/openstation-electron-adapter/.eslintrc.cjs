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

		'jsdoc/require-param-type': 'off',
		'jsdoc/require-returns-type': 'off',
		'jsdoc/no-undefined-types': 'off',
		'jsdoc/require-jsdoc': 'off',

		'@wordpress/dependency-group': 'off',

		'no-console': [ 'error', { allow: [ 'warn', 'error', 'info' ] } ],
		'no-unused-vars': 'off',
		'@typescript-eslint/no-unused-vars': [
			'error',
			{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
		],
		'@typescript-eslint/explicit-module-boundary-types': 'off',
		indent: [ 'error', 'tab', { SwitchCase: 1 } ],
		'no-mixed-operators': 'off',

		'no-duplicate-imports': 'off',

		'no-useless-constructor': 'off',

		'@wordpress/i18n-text-domain': 'off',
		'@wordpress/i18n-no-variables': 'off',
	},
	overrides: [
		{

			files: [ 'src/**/*.ts' ],
			env: { browser: true, es2022: true },
			rules: {

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

			files: [ 'app/src/**/*.ts' ],
			env: { node: true, es2022: true },
			rules: {

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

			files: [ 'app/src/renderer/**/*.ts' ],
			env: { browser: true, node: false },
			rules: { 'no-restricted-globals': 'off' },
		},
		{

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

				'@typescript-eslint/no-explicit-any': 'off',
				'@typescript-eslint/no-non-null-assertion': 'off',

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
