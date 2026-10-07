module.exports = {
	root: true,
	parser: '@typescript-eslint/parser',
	parserOptions: {
		ecmaVersion: 2020,
		sourceType: 'module',
		project: './tsconfig.json',
	},
	env: {
		browser: true,
		es2020: true,
	},
	extends: [
		'plugin:@wordpress/eslint-plugin/recommended-with-formatting',
		'plugin:@typescript-eslint/recommended',
	],
	plugins: [ 'local-rules' ],
	settings: {

		'import/resolver': {
			typescript: {},
			node: {
				extensions: [ '.js', '.jsx', '.ts', '.tsx' ],
			},
		},
	},
	rules: {

		'jsdoc/require-param-type': 'off',
		'jsdoc/require-returns-type': 'off',
		'jsdoc/no-undefined-types': 'off',

		'jsdoc/require-jsdoc': 'off',
		'jsdoc/require-param': 'off',
		'jsdoc/require-returns': 'off',

		'@wordpress/dependency-group': 'off',

		'no-console': [ 'error', { allow: [ 'warn', 'error', 'info' ] } ],

		camelcase: [
			'error',
			{
				allow: [
					'^_wp',
					'^wp_',
					'^source_url$',
					'^media_details$',
					'^alt_text$',
					'^post_type$',
					'^per_page$',
					'^rendered$',
				],
				properties: 'never',
				ignoreDestructuring: true,
			},
		],

		'no-unused-vars': 'off',
		'@typescript-eslint/no-unused-vars': [
			'error',
			{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
		],

		'@wordpress/valid-sprintf': 'off',

		'no-mixed-operators': 'off',

		indent: [ 'error', 'tab', {
			ignoredNodes: [ 'TemplateLiteral *' ],
			SwitchCase: 1,
		} ],

		'no-duplicate-imports': 'off',

		'local-rules/os-component-registration': 'error',

		'local-rules/os-file-length': [ 'warn', { max: 1000, idealMin: 300, idealMax: 600 } ],
		'no-restricted-syntax': [
			'error',
			{
				selector: 'CallExpression[callee.name="fetch"]',
				message:
					'Use the framework fetch (`wp.os.fetch` or the `trackedFetch` helper from `src/tracked-fetch.ts`) so the request feeds the loading spinner + activity bus. If you really need the raw global, opt out with `// eslint-disable-next-line no-restricted-syntax` and a comment explaining why.',
			},
			{
				selector: 'MemberExpression[object.name="window"][property.name="fetch"]',
				message:
					'Use `wp.os.fetch` / `trackedFetch` instead of `window.fetch` so the request feeds the loading spinner + activity bus.',
			},
			{
				selector: 'CallExpression[callee.object.name="window"][callee.property.name="confirm"]',
				message:
					'Use `wp.os.confirm` (or `osConfirm()`) — the framework `<os-confirm-dialog>` — instead of `window.confirm()` so the prompt matches the rest of the desktop visually.',
			},
			{
				selector: 'CallExpression[callee.object.name="window"][callee.property.name="alert"]',
				message:
					'Use a toast (`wp.os.toasts`) or `wp.os.confirm` instead of `window.alert()` so users get framework-styled feedback.',
			},
			{
				selector: 'CallExpression[callee.object.name="window"][callee.property.name="prompt"]',
				message:
					'Build a small `<os-confirm-dialog>`-style modal with a `<os-text-field>` instead of `window.prompt()`.',
			},
		],
	},
	overrides: [
		{
			files: [ 'vite.config.js', '.eslintrc.cjs' ],
			env: { node: true },
			parser: 'espree',
			parserOptions: { project: null },
			rules: {

				'@typescript-eslint/no-var-requires': 'off',
			},
		},
		{

			files: [ 'src/chromeless-bridge.js' ],
			env: { browser: true },
			parser: 'espree',
			parserOptions: { project: null, ecmaVersion: 2020 },
			rules: {

				'@typescript-eslint/no-explicit-any': 'off',
				'@typescript-eslint/explicit-module-boundary-types': 'off',

				'no-restricted-syntax': 'off',

				'no-var': 'off',
				'object-shorthand': 'off',
				'space-before-function-paren': 'off',
				'brace-style': 'off',
				'comma-dangle': 'off',
				curly: 'off',
				'no-multi-spaces': 'off',
				'operator-linebreak': 'off',
				'key-spacing': 'off',
				'wrap-iife': 'off',
				'func-call-spacing': 'off',
				'@typescript-eslint/no-this-alias': 'off',

				'react-hooks/exhaustive-deps': 'off',

				'@wordpress/no-global-active-element': 'off',
			},
		},
	],
	ignorePatterns: [
		'assets/js/**',
		'assets/vendor/**',
		'node_modules/**',
		'dist/**',
		'build/**',
	],
};
