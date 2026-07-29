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
	settings: {
		'import/resolver': {
			typescript: {},
		},
	},
	rules: {
		'@wordpress/dependency-group': 'off',
		'@wordpress/valid-sprintf': 'off',
		'jsdoc/require-jsdoc': 'off',
		'jsdoc/require-param': 'off',
		'jsdoc/require-param-type': 'off',
		'jsdoc/require-returns': 'off',
		'jsdoc/require-returns-type': 'off',
		'no-duplicate-imports': 'off',
		'func-call-spacing': 'off',
		'no-mixed-operators': 'off',
		'no-unused-vars': 'off',
		'@typescript-eslint/no-unused-vars': [
			'error',
			{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
		],
		'no-restricted-syntax': [
			'error',
			{
				selector: 'CallExpression[callee.name="fetch"]',
				message: 'Use wp.desktop.fetch so Desktop Mode can track the request.',
			},
			{
				selector:
					'CallExpression[callee.object.name="window"][callee.property.name=/^(confirm|alert|prompt)$/]',
				message: 'Use a Desktop Mode dialog or status surface.',
			},
		],
	},
};
