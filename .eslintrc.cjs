/**
 * ESLint configuration for the wp-desktop-mode TypeScript shell.
 *
 * Baseline is WordPress's first-party rule set — `@wordpress/eslint-plugin`
 * — the same package Calypso uses (Calypso layers its own overrides on
 * top of it). That gives us WP coding-standard alignment (tabs,
 * snake_case vs camelCase, hook-namespacing, dependency groups) with
 * sane modern-JS hygiene out of the box. Then we add TypeScript on top
 * via `@typescript-eslint` so the same config covers .ts files.
 *
 * Scope: `src/**` only. We do NOT lint the built bundles under
 * `assets/js/` or vendor scripts under `assets/vendor/` — those are
 * Vite / Pixi output. Tests and docs aren't linted until we add them
 * to the include list deliberately.
 */
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
		// WP's JSDoc rules default to assuming every export has full
		// TSDoc-style typing. For a TS project that's redundant — the
		// compiler already checks types. We turn the doc requirements
		// down in `rules` below; this setting keeps WP's import/order
		// resolver TS-aware so it doesn't flag type-only imports.
		'import/resolver': {
			typescript: {},
			node: {
				extensions: [ '.js', '.jsx', '.ts', '.tsx' ],
			},
		},
	},
	rules: {
		// TS already checks types; JSDoc @param types are redundant
		// noise in a TypeScript-first codebase.
		'jsdoc/require-param-type': 'off',
		'jsdoc/require-returns-type': 'off',
		'jsdoc/no-undefined-types': 'off',
		// Public APIs are typed. Requiring a JSDoc block on every
		// internal helper creates churn without catching bugs.
		'jsdoc/require-jsdoc': 'off',
		'jsdoc/require-param': 'off',
		'jsdoc/require-returns': 'off',
		// @wordpress/* ships with @wordpress/dependency-group which is
		// meant for Gutenberg-style import ordering. We're a plugin
		// shell with no @wordpress/* runtime deps — turn it off.
		'@wordpress/dependency-group': 'off',
		// We deliberately use `console.warn` / `console.error` for
		// plugin-author diagnostics in hot paths (hooks registry, REST
		// failures). Keep those; silence the default no-console.
		'no-console': [ 'error', { allow: [ 'warn', 'error', 'info' ] } ],
		// camelCase mismatches: a lot of our code interfaces with
		// PHP-generated configs (currentPage, pluginUrl, defaultWindow)
		// that serialize to camelCase already — the rule isn't useful
		// here but WP's recommended flags e.g. REST response fields
		// like `source_url` and `wp_desktop_portal`. Allow snake_case
		// from known outside sources (REST payloads, URL params).
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
		// @typescript-eslint/no-unused-vars supersedes the base rule.
		'no-unused-vars': 'off',
		'@typescript-eslint/no-unused-vars': [
			'error',
			{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
		],
		// We store strings like `wp-desktop.window.opened` as hook IDs;
		// @wordpress/valid-sprintf fires false positives on them.
		'@wordpress/valid-sprintf': 'off',
		// The code has math-heavy paths (scene physics, dock geometry,
		// window-manager cascade) where `a * b + c` is standard-precedence
		// math, not ambiguous. Parenthesizing every intermediate op adds
		// noise without clarity — keep operator precedence implicit and
		// trust the reader knows multiplication binds tighter than
		// addition.
		'no-mixed-operators': 'off',
		// The WP/ESLint indent rule was tuned for JSX — it has special
		// handling for JSXElement / JSXExpressionContainer nodes so
		// ternaries indented deeper inside `prop={ cond ? x : y }` read
		// naturally. We use tagged-template DSLs (`html\`...\``) instead,
		// and the rule has no equivalent awareness there: ternaries
		// inside `${...}` get flattened against the enclosing block and
		// lose their visual alignment with the surrounding template. Opt
		// out inside template literals so the author's visual indent is
		// preserved; everything outside templates is still checked.
		indent: [ 'error', 'tab', {
			ignoredNodes: [ 'TemplateLiteral *' ],
			SwitchCase: 1,
		} ],
	},
	overrides: [
		{
			files: [ 'vite.config.js', '.eslintrc.cjs' ],
			env: { node: true },
			parser: 'espree',
			parserOptions: { project: null },
			rules: {
				// These config files aren't TS.
				'@typescript-eslint/no-var-requires': 'off',
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
