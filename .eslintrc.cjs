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
	plugins: [ 'local-rules' ],
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
		// Steer authors away from raw browser globals that bypass
		// the framework. Use `wp.desktop.fetch` / `trackedFetch`
		// instead of `fetch()` so requests feed the loading
		// spinner + activity bus. Use `wp.desktop.confirm` /
		// `wpdConfirm()` instead of `window.confirm()` /
		// `window.prompt()` / `window.alert()` so prompts use
		// `<wpd-confirm-dialog>` and match the rest of the desktop
		// visually. Sites that genuinely need the raw global —
		// service worker, the framework wrapper itself, last-resort
		// fallbacks — can opt out with an inline `eslint-disable`.
		// `no-duplicate-imports` (the ESLint core rule) is supposed
		// to allow side-effect imports alongside named imports from
		// the same source, but v8.x flags
		//   import '../ui/components/wpd-foo/wpd-foo';
		//   import type { WpdFoo } from '../ui/components/wpd-foo/wpd-foo';
		// as a duplicate — which is exactly the shape our component
		// registration pattern needs (side-effect to trigger
		// `defineComponent`, plus `import type` for the type
		// surface). `@typescript-eslint`'s replacement
		// (`import/no-duplicates` with `prefer-inline`) isn't on the
		// dep tree, so we just turn the rule off rather than carry
		// disable comments on every component leaf-import block.
		'no-duplicate-imports': 'off',
		// Local rule — fails when a module calls
		// `document.createElement( 'wpd-foo' )` without also
		// side-effect-importing `'…/ui/components/wpd-foo/wpd-foo'`.
		// Catches the regression class that broke posts / pages /
		// users / plugins / comments / recycle-bin: a secondary
		// bundle does `import { WpdFoo } from '…'` purely for the
		// TS type, esbuild elides the import, the
		// `defineComponent( 'wpd-foo', WpdFoo )` side-effect never
		// runs, and `<wpd-foo>` renders as an inert un-upgraded
		// custom element. See the rule source for details.
		'local-rules/wpd-component-registration': 'error',
		'no-restricted-syntax': [
			'error',
			{
				selector: 'CallExpression[callee.name="fetch"]',
				message:
					'Use the framework fetch (`wp.desktop.fetch` or the `trackedFetch` helper from `src/tracked-fetch.ts`) so the request feeds the loading spinner + activity bus. If you really need the raw global, opt out with `// eslint-disable-next-line no-restricted-syntax` and a comment explaining why.',
			},
			{
				selector: 'MemberExpression[object.name="window"][property.name="fetch"]',
				message:
					'Use `wp.desktop.fetch` / `trackedFetch` instead of `window.fetch` so the request feeds the loading spinner + activity bus.',
			},
			{
				selector: 'CallExpression[callee.object.name="window"][callee.property.name="confirm"]',
				message:
					'Use `wp.desktop.confirm` (or `wpdConfirm()`) — the framework `<wpd-confirm-dialog>` — instead of `window.confirm()` so the prompt matches the rest of the desktop visually.',
			},
			{
				selector: 'CallExpression[callee.object.name="window"][callee.property.name="alert"]',
				message:
					'Use a toast (`wp.desktop.toasts`) or `wp.desktop.confirm` instead of `window.alert()` so users get framework-styled feedback.',
			},
			{
				selector: 'CallExpression[callee.object.name="window"][callee.property.name="prompt"]',
				message:
					'Build a small `<wpd-confirm-dialog>`-style modal with a `<wpd-text-field>` instead of `window.prompt()`.',
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
