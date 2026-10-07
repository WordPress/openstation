'use strict';

const fs = require( 'node:fs' );
const path = require( 'node:path' );

const SHELL_OVERLAYS_TAGS = new Set( [

	'os-toast',
	'os-toast-container',
	'os-confirm-dialog',
	'os-context-menu',
	'os-context-menu-option',

	'os-menu',
	'os-menu-item',
	'os-window-button',
	'os-tab-chip',
	'os-save-status',
	'os-spinner',
	'os-button',
	'os-text-field',
	'os-select',
	'os-option',
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

	const stripped = source
		.replace( /\/\*[\s\S]*?\*\//g, '' )
		.replace( /\/\/.*$/gm, '' );
	const re = /defineComponent\s*\(\s*['"](os-[a-z0-9-]+)['"]/g;
	let m;
	while ( ( m = re.exec( stripped ) ) !== null ) {
		out.add( m[ 1 ] );
	}
	tagsRegisteredByFileCache.set( absPath, out );
	return out;
}

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

		}
	}
	return null;
}

module.exports = {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Require a side-effect or value-reachable import of the matching `<…>/os-foo/os-foo` module for every `createElement( "os-foo" )` call in the file. Catches the silent contract violation where a TypeScript type-only import gets elided and the corresponding custom element never registers.',
		},
		schema: [],
		messages: {
			missingRegistration:
				'`createElement( "{{tag}}" )` runs in this module, but nothing here registers `{{tag}}` in the same bundle. The `<{{tag}}>` element will render as an inert (un-upgraded) custom element. Add `import "<…>/ui/components/{{tag}}/{{tag}}";` or, for a compound component, an import of the owning module. `defineComponent` is idempotent — safe even if another bundle also ships the tag.',
		},
	},

	create( context ) {
		const filename = context.getFilename();

		if ( /\.test\.tsx?$/.test( filename ) ) {
			return {};
		}

		let projectRoot = path.dirname( filename );
		while (
			projectRoot !== path.dirname( projectRoot ) &&
			! fs.existsSync( path.join( projectRoot, 'package.json' ) )
		) {
			projectRoot = path.dirname( projectRoot );
		}

		const tagsConstructed = new Map();
		const tagsRegistered = new Set();

		for ( const tag of tagsRegisteredByFile( filename ) ) {
			tagsRegistered.add( tag );
		}

		return {
			CallExpression( node ) {
				if ( ! isCreateElementCallee( node.callee ) ) return;
				const first = node.arguments[ 0 ];
				if ( ! first || first.type !== 'Literal' ) return;
				const tag = first.value;
				if ( typeof tag !== 'string' || ! tag.startsWith( 'os-' ) ) return;

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

				if ( node.specifiers.length === 0 ) {
					for ( const tag of tagsRegisteredByFile( resolved ) ) {
						tagsRegistered.add( tag );
					}
					return;
				}

				if ( node.importKind === 'type' ) return;

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
