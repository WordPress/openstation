/**
 * Custom ESLint rule — `wpd-component-registration`.
 *
 * Catches the regression class that broke posts / pages / users /
 * plugins / comments / recycle-bin after Stage 1 of the bundle-size
 * work: a module constructs a `<wpd-foo>` element at runtime (via
 * `document.createElement('wpd-foo')` or a literal `'wpd-foo'`
 * argument to any `createElement` callee) yet does NOT side-effect-
 * import the matching `'<…>/wpd-foo/wpd-foo'` module — so the
 * `defineComponent( 'wpd-foo', WpdFoo )` side effect never reaches
 * the bundle.
 *
 * Why this matters
 * ----------------
 * Every `<wpd-*>` component file ends in a top-level
 * `defineComponent( 'wpd-foo', WpdFoo )` call that registers the
 * custom element. The registration is a *side effect of importing
 * the module*. TypeScript imports of the form
 *
 *     import { WpdFoo, WpdFooColumn } from '…/wpd-foo/wpd-foo';
 *
 * look like they pull the class in, but if every named binding is
 * only used in a type position (`const c: WpdFooColumn<...>`,
 * `querySelector< WpdFoo< … > >( … )`, …) esbuild / TS elide the
 * whole import. The side effect — and therefore the registration —
 * never reaches the bundle. `createElement( 'wpd-foo' )` then
 * returns an inert custom element with no upgrade, and the UI
 * silently renders nothing.
 *
 * Detection
 * ---------
 * Per file:
 *   1. Collect every `wpd-…` tag used in a runtime construction:
 *      any call whose callee identifier (or member-expression
 *      property) is `createElement` and whose first argument is a
 *      string literal `'wpd-…'`.
 *   2. Resolve which tags are *registered* in the same bundle by
 *      considering:
 *      a. `defineComponent( 'wpd-X', X )` calls in the current
 *         file (handles `wpd-foo/wpd-foo.ts` constructing its own
 *         tag, and components like `wpd-tabs.ts` that also
 *         register `<wpd-tab>` / `<wpd-tabpanel>`).
 *      b. Imports of the form `'<…>/wpd-X/wpd-X'` (or its `.ts`
 *         twin) — recursively read the imported file and harvest
 *         every `defineComponent( … )` call from it. A bare
 *         side-effect import counts unconditionally; a named-
 *         specifier import counts only if at least one of its
 *         non-`type`-modifier bindings is referenced in a value
 *         position (so we don't trust an import esbuild will
 *         elide).
 *   3. Any tag from step 1 that is not in the registered set from
 *      step 2 is reported on the `createElement` call site.
 *
 * Fix hint
 * --------
 * Add a leaf side-effect import next to the existing one:
 *
 *     import '…/wpd-foo/wpd-foo';
 *
 * `defineComponent` is idempotent, so it's always safe to side-
 * effect-import a tag — even if another bundle also registers it.
 */

'use strict';

const fs = require( 'node:fs' );
const path = require( 'node:path' );

/**
 * Tags whose component class lives in the lazy
 * `shell-overlays[.min].js` bundle and is registered globally
 * after `desktop.ts`'s post-first-paint preload.
 *
 * Any file that constructs one of these tags is expected to
 * `await openWithShellOverlays( … )` (or otherwise gate on
 * `ensureShellOverlaysLoaded()`) before the `createElement` call.
 * The rule doesn't enforce that gating today — it just accepts
 * the construction because the registration is guaranteed by
 * boot's preload, not by a per-file leaf import. Keep this list
 * in sync with `src/shell-overlays/entry.ts`.
 *
 * @since 0.8.4
 */
const SHELL_OVERLAYS_TAGS = new Set( [
	// Stage 9 — action-triggered overlays.
	'wpd-toast',
	'wpd-toast-container',
	'wpd-confirm-dialog',
	'wpd-context-menu',
	'wpd-context-menu-option',
	// Stage 10 — window chrome + folder-dialog components. All
	// constructed only after the user has triggered some action
	// (open a window, open a folder, open the rename dialog) so
	// the shell-overlays preload covers them.
	'wpd-menu',
	'wpd-menu-item',
	'wpd-window-button',
	'wpd-tab-chip',
	'wpd-save-status',
	'wpd-spinner',
	'wpd-button',
	'wpd-text-field',
	'wpd-select',
	'wpd-option',
] );

const TS_TYPE_POSITION_PARENT = new Set( [
	'TSTypeReference',
	'TSTypeQuery',
	'TSExpressionWithTypeArguments',
	'TSInterfaceHeritage',
	'TSClassImplements',
	'TSImportType',
	'TSTypeAnnotation',
	'TSTypeAliasDeclaration',
	'TSInterfaceDeclaration',
	'TSQualifiedName',
] );

function isCreateElementCallee( node ) {
	if ( ! node ) return false;
	if ( node.type === 'Identifier' ) return node.name === 'createElement';
	if ( node.type === 'MemberExpression' ) {
		const prop = node.property;
		if ( ! prop ) return false;
		if ( prop.type === 'Identifier' ) return prop.name === 'createElement';
		if ( prop.type === 'Literal' ) return prop.value === 'createElement';
	}
	return false;
}

function bindingIsValueReferenced( variable ) {
	if ( ! variable || ! variable.references ) return false;
	for ( const ref of variable.references ) {
		const id = ref.identifier;
		const parent = id && id.parent;
		if ( ! parent ) continue;
		if ( TS_TYPE_POSITION_PARENT.has( parent.type ) ) continue;
		return true;
	}
	return false;
}

/**
 * Cache: absolute file path → set of tags the file registers via
 * top-level `defineComponent( 'wpd-X', X )` calls.
 */
const tagsRegisteredByFileCache = new Map();

function tagsRegisteredByFile( absPath ) {
	if ( tagsRegisteredByFileCache.has( absPath ) ) {
		return tagsRegisteredByFileCache.get( absPath );
	}
	const out = new Set();
	let source;
	try {
		source = fs.readFileSync( absPath, 'utf8' );
	} catch {
		tagsRegisteredByFileCache.set( absPath, out );
		return out;
	}
	// Strip line + block comments so we don't match
	// `// defineComponent('wpd-foo', …)` text in a JSDoc example.
	const stripped = source
		.replace( /\/\*[\s\S]*?\*\//g, '' )
		.replace( /\/\/.*$/gm, '' );
	const re = /defineComponent\s*\(\s*['"](wpd-[a-z0-9-]+)['"]/g;
	let m;
	while ( ( m = re.exec( stripped ) ) !== null ) {
		out.add( m[ 1 ] );
	}
	tagsRegisteredByFileCache.set( absPath, out );
	return out;
}

/**
 * Resolve an import specifier (relative or @-aliased) to the
 * absolute filesystem path of the corresponding `.ts` source.
 *
 * Only handles the project's two flavours of import paths:
 *   - relative (`./foo`, `../foo`)
 *   - the `@<alias>/` paths set up in `vite.config.js` /
 *     `tsconfig.json`. The aliases all root under `src/`.
 *
 * Returns `null` for bare module specifiers (`'pixi.js'`, …) or
 * paths that don't resolve to an existing `.ts` file under `src/`.
 */
const ALIAS_PREFIXES = [
	[ '@/', 'src/' ],
	[ '@api/', 'src/api/' ],
	[ '@boot/', 'src/boot/' ],
	[ '@core/', 'src/core/' ],
	[ '@features/', 'src/features/' ],
	[ '@layout/', 'src/layout/' ],
	[ '@protocol/', 'src/protocol/' ],
	[ '@ui/', 'src/ui/' ],
	[ '@window-system/', 'src/window-system/' ],
];

function resolveImportPath( fromFile, source, projectRoot ) {
	if ( ! source ) return null;
	let abs;
	if ( source.startsWith( '.' ) ) {
		abs = path.resolve( path.dirname( fromFile ), source );
	} else {
		const aliased = ALIAS_PREFIXES.find( ( [ prefix ] ) =>
			source.startsWith( prefix ),
		);
		if ( ! aliased ) return null;
		const [ prefix, replacement ] = aliased;
		abs = path.resolve(
			projectRoot,
			replacement + source.slice( prefix.length ),
		);
	}
	for ( const ext of [ '', '.ts', '.tsx', '/index.ts' ] ) {
		const candidate = abs + ext;
		try {
			const stat = fs.statSync( candidate );
			if ( stat.isFile() ) return candidate;
		} catch {
			// not found; keep trying
		}
	}
	return null;
}

module.exports = {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Require a side-effect or value-reachable import of the matching `<…>/wpd-foo/wpd-foo` module for every `createElement( "wpd-foo" )` call in the file. Catches the silent contract violation where a TypeScript type-only import gets elided and the corresponding custom element never registers.',
		},
		schema: [],
		messages: {
			missingRegistration:
				'`createElement( "{{tag}}" )` runs in this module, but nothing here registers `{{tag}}` in the same bundle. The `<{{tag}}>` element will render as an inert (un-upgraded) custom element. Add `import "<…>/ui/components/{{tag}}/{{tag}}";` or, for a compound component, an import of the owning module. `defineComponent` is idempotent — safe even if another bundle also ships the tag.',
		},
	},

	create( context ) {
		const filename = context.getFilename();
		// Test files have their own jsdom + customElements setup;
		// registration there isn't gated on bundle wiring.
		if ( /\.test\.tsx?$/.test( filename ) ) {
			return {};
		}
		// Project root = nearest ancestor containing `package.json`.
		let projectRoot = path.dirname( filename );
		while (
			projectRoot !== path.dirname( projectRoot ) &&
			! fs.existsSync( path.join( projectRoot, 'package.json' ) )
		) {
			projectRoot = path.dirname( projectRoot );
		}

		const tagsConstructed = new Map(); // tag → reporting node
		const tagsRegistered = new Set();

		// Tags this file itself registers via top-level
		// `defineComponent( 'wpd-X', … )` calls. Important for both
		// the component file itself (`wpd-foo/wpd-foo.ts` defining
		// `<wpd-foo>`) and compound modules (`wpd-tabs.ts` also
		// registers `<wpd-tab>` / `<wpd-tabpanel>`).
		for ( const tag of tagsRegisteredByFile( filename ) ) {
			tagsRegistered.add( tag );
		}

		return {
			CallExpression( node ) {
				if ( ! isCreateElementCallee( node.callee ) ) return;
				const first = node.arguments[ 0 ];
				if ( ! first || first.type !== 'Literal' ) return;
				const tag = first.value;
				if ( typeof tag !== 'string' || ! tag.startsWith( 'wpd-' ) ) return;
				// Tags shipped in the lazy `shell-overlays[.min].js`
				// bundle and pre-registered globally at boot — the
				// per-file leaf-import contract doesn't apply here.
				if ( SHELL_OVERLAYS_TAGS.has( tag ) ) return;
				if ( ! tagsConstructed.has( tag ) ) {
					tagsConstructed.set( tag, node );
				}
			},

			ImportDeclaration( node ) {
				const source = node.source && node.source.value;
				if ( typeof source !== 'string' ) return;
				const resolved = resolveImportPath(
					filename,
					source,
					projectRoot,
				);
				if ( ! resolved ) return;

				// Bare side-effect import always registers everything
				// the imported file defines.
				if ( node.specifiers.length === 0 ) {
					for ( const tag of tagsRegisteredByFile( resolved ) ) {
						tagsRegistered.add( tag );
					}
					return;
				}
				// `import type { … } from '…';` never registers.
				if ( node.importKind === 'type' ) return;

				// Mixed / value imports: defer to `Program:exit` so
				// every binding's value-vs-type usage is known.
				node._wpdResolved = resolved;
				node._wpdScope = context.getScope();
			},

			'Program:exit': function ( program ) {
				for ( const decl of program.body ) {
					if ( decl.type !== 'ImportDeclaration' ) continue;
					if ( ! decl._wpdResolved ) continue;
					const scope = decl._wpdScope || context.getScope();
					let referenced = false;
					for ( const spec of decl.specifiers ) {
						if ( spec.importKind === 'type' ) continue;
						const local = spec.local;
						if ( ! local ) continue;
						const variable = scope.variables.find(
							( v ) => v.name === local.name,
						);
						if ( bindingIsValueReferenced( variable ) ) {
							referenced = true;
							break;
						}
					}
					if ( ! referenced ) continue;
					for ( const tag of tagsRegisteredByFile( decl._wpdResolved ) ) {
						tagsRegistered.add( tag );
					}
				}

				for ( const [ tag, node ] of tagsConstructed ) {
					if ( tagsRegistered.has( tag ) ) continue;
					context.report( {
						node,
						messageId: 'missingRegistration',
						data: { tag },
					} );
				}
			},
		};
	},
};
