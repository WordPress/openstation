export interface TemplateResult {
	readonly __wpdHtml: true;
	readonly strings: TemplateStringsArray;
	readonly values: readonly unknown[];
}

export function html(
	strings: TemplateStringsArray,
	...values: unknown[]
): TemplateResult {
	return { __wpdHtml: true, strings, values };
}

function isTemplateResult( v: unknown ): v is TemplateResult {
	return !! v && ( v as { __wpdHtml?: boolean } ).__wpdHtml === true;
}

const MARKER_PREFIX = '$$wpd$$';
const MARKER_RE = /\$\$wpd\$\$(\d+)\$\$/g;

const COMMENT_MARKER_PREFIX = '$$wpd-node$$';
const COMMENT_MARKER_RE = /^\$\$wpd-node\$\$(\d+)\$\$$/;
const RAW_TEXT_TAGS = new Set( [ 'style', 'script', 'textarea', 'title' ] );

function joinWithMarkers( strings: TemplateStringsArray ): string {
	let out = '';

	let inTag = false;
	let quote: string | null = null;
	let inComment = false;

	let rawText: string | null = null;

	let tagName = '';
	let naming = false;
	for ( let i = 0; i < strings.length; i++ ) {
		const s = strings[ i ];
		out += s;
		for ( let j = 0; j < s.length; j++ ) {
			const ch = s[ j ];
			if ( inComment ) {
				if ( s.startsWith( '-->', j ) ) {
					inComment = false;
					j += 2;
				}
				continue;
			}
			if ( rawText !== null ) {
				const closes = ch === '<' && s[ j + 1 ] === '/' &&
					s.slice( j + 2, j + 2 + rawText.length ).toLowerCase() === rawText;
				if ( closes ) {
					j += 1 + rawText.length;
					rawText = null;
					inTag = true;
					naming = false;
					tagName = '';
				}
				continue;
			}
			if ( quote !== null ) {
				if ( ch === quote ) {
					quote = null;
				}
				continue;
			}
			if ( inTag ) {
				if ( ch === '"' || ch === "'" ) {
					quote = ch;
					naming = false;
				} else if ( ch === '>' ) {
					inTag = false;
					naming = false;
					if ( RAW_TEXT_TAGS.has( tagName ) ) {
						rawText = tagName;
					}
					tagName = '';
				} else if ( naming ) {
					if ( /[a-zA-Z0-9-]/.test( ch ) ) {
						tagName += ch.toLowerCase();
					} else {
						naming = false;
					}
				}
				continue;
			}
			if ( s.startsWith( '<!--', j ) ) {
				inComment = true;
				j += 3;
				continue;
			}
			const next = s[ j + 1 ] ?? '';
			if ( ch === '<' && /[a-zA-Z/!]/.test( next ) ) {
				inTag = true;
				tagName = '';

				naming = /[a-zA-Z]/.test( next );
			}
		}
		if ( i < strings.length - 1 ) {
			out += inTag || inComment || rawText !== null
				? `${ MARKER_PREFIX }${ i }$$`
				: `<!--${ COMMENT_MARKER_PREFIX }${ i }$$-->`;
		}
	}
	return out;
}

interface ChildPart {
	anchor: Text;
	state: ChildState | null;
}

type ChildState =
	| { shape: 'text'; node: Text; text: string }
	| {
		shape: 'template';
		strings: TemplateStringsArray;
		parts: Part[];

		nodes: Node[];
	}
	| { shape: 'array'; entries: ChildPart[] }

	| { shape: 'node'; node: Node };

interface NodePart {
	kind: 'node';
	valueIndex: number;
	child: ChildPart;
}

interface AttrPart {
	kind: 'attr';
	valueIndices: number[];
	element: Element;
	name: string;

	template: string[];
	last?: string;
}

interface EventPart {
	kind: 'event';
	valueIndex: number;
	element: Element;
	name: string;
	current?: EventListener;
}

interface PropPart {
	kind: 'prop';
	valueIndex: number;
	element: Element;
	name: string;
	last?: unknown;
}

interface BoolAttrPart {
	kind: 'bool';
	valueIndex: number;
	element: Element;
	name: string;
	last?: boolean;
}

type Part = NodePart | AttrPart | EventPart | PropPart | BoolAttrPart;

interface Compiled {
	template: HTMLTemplateElement;
	buildParts: ( fragment: DocumentFragment ) => Part[];
}

const compiledCache = new WeakMap<TemplateStringsArray, Compiled>();

function compile( strings: TemplateStringsArray ): Compiled {
	const cached = compiledCache.get( strings );
	if ( cached ) {
		return cached;
	}

	const template = document.createElement( 'template' );
	template.innerHTML = joinWithMarkers( strings );

	interface Recipe {
		path: number[];
		kind: Part[ 'kind' ];
		valueIndex?: number;
		name?: string;
		valueIndices?: number[];
		template?: string[];
	}
	const recipes: Recipe[] = [];

	const walk = ( node: Node, path: number[] ): void => {
		if ( node.nodeType === Node.ELEMENT_NODE ) {
			const el = node as Element;
			for ( const attr of Array.from( el.attributes ) ) {
				const rawName = attr.name;
				const rawValue = attr.value;
				const prefix = rawName[ 0 ];
				if ( MARKER_RE.test( rawValue ) ) {
					MARKER_RE.lastIndex = 0;
					if ( prefix === '@' ) {
						const match = MARKER_RE.exec( rawValue );
						MARKER_RE.lastIndex = 0;
						recipes.push( {
							path,
							kind: 'event',
							name: rawName.slice( 1 ),
							valueIndex: match ? Number( match[ 1 ] ) : 0,
						} );
						el.removeAttribute( rawName );
					} else if ( prefix === '.' ) {
						const match = MARKER_RE.exec( rawValue );
						MARKER_RE.lastIndex = 0;
						recipes.push( {
							path,
							kind: 'prop',
							name: rawName.slice( 1 ),
							valueIndex: match ? Number( match[ 1 ] ) : 0,
						} );
						el.removeAttribute( rawName );
					} else if ( prefix === '?' ) {
						const match = MARKER_RE.exec( rawValue );
						MARKER_RE.lastIndex = 0;
						recipes.push( {
							path,
							kind: 'bool',
							name: rawName.slice( 1 ),
							valueIndex: match ? Number( match[ 1 ] ) : 0,
						} );
						el.removeAttribute( rawName );
					} else {
						const fragments: string[] = [];
						const indices: number[] = [];
						let lastEnd = 0;
						let m;
						MARKER_RE.lastIndex = 0;
						while ( ( m = MARKER_RE.exec( rawValue ) ) !== null ) {
							fragments.push( rawValue.slice( lastEnd, m.index ) );
							indices.push( Number( m[ 1 ] ) );
							lastEnd = m.index + m[ 0 ].length;
						}
						fragments.push( rawValue.slice( lastEnd ) );
						recipes.push( {
							path,
							kind: 'attr',
							name: rawName,
							template: fragments,
							valueIndices: indices,
						} );
						el.setAttribute( rawName, '' );
					}
				}
			}
		}

		const children = Array.from( node.childNodes );
		let shift = 0;
		for ( let i = 0; i < children.length; i++ ) {
			const child = children[ i ];
			const liveIndex = i + shift;
			if ( child.nodeType === Node.COMMENT_NODE ) {
				const m = COMMENT_MARKER_RE.exec( ( child as Comment ).data );
				if ( m ) {
					const placeholder = document.createTextNode( '' );
					child.parentNode!.replaceChild( placeholder, child );
					recipes.push( {
						path: [ ...path, liveIndex ],
						kind: 'node',
						valueIndex: Number( m[ 1 ] ),
					} );
				}
				continue;
			}
			if ( child.nodeType === Node.TEXT_NODE ) {
				const text = child.textContent || '';
				if ( ! MARKER_RE.test( text ) ) {
					MARKER_RE.lastIndex = 0;
					continue;
				}
				MARKER_RE.lastIndex = 0;
				const parent = child.parentNode!;
				let lastEnd = 0;
				let m;
				const newNodes: Node[] = [];
				const newRecipes: Recipe[] = [];
				MARKER_RE.lastIndex = 0;
				while ( ( m = MARKER_RE.exec( text ) ) !== null ) {
					if ( m.index > lastEnd ) {
						newNodes.push( document.createTextNode( text.slice( lastEnd, m.index ) ) );
					}
					const placeholder = document.createTextNode( '' );
					newNodes.push( placeholder );
					newRecipes.push( {
						path: [ ...path, liveIndex + newNodes.length - 1 ],
						kind: 'node',
						valueIndex: Number( m[ 1 ] ),
					} );
					lastEnd = m.index + m[ 0 ].length;
				}
				if ( lastEnd < text.length ) {
					newNodes.push( document.createTextNode( text.slice( lastEnd ) ) );
				}
				for ( const nn of newNodes ) {
					parent.insertBefore( nn, child );
				}
				parent.removeChild( child );

				shift += newNodes.length - 1;
				recipes.push( ...newRecipes );
			} else {
				walk( child, [ ...path, liveIndex ] );
			}
		}
	};

	walk( template.content, [] );

	const buildParts = ( fragment: DocumentFragment ): Part[] => {
		const out: Part[] = [];
		for ( const r of recipes ) {
			let node: Node = fragment;
			for ( const idx of r.path ) {
				node = node.childNodes[ idx ];
			}
			if ( r.kind === 'node' ) {
				out.push( {
					kind: 'node',
					valueIndex: r.valueIndex!,
					child: {
						anchor: node as Text,
						state: null,
					},
				} );
			} else if ( r.kind === 'attr' ) {
				out.push( {
					kind: 'attr',
					element: node as Element,
					name: r.name!,
					template: r.template!,
					valueIndices: r.valueIndices!,
				} );
			} else if ( r.kind === 'event' ) {
				out.push( {
					kind: 'event',
					valueIndex: r.valueIndex!,
					element: node as Element,
					name: r.name!,
				} );
			} else if ( r.kind === 'prop' ) {
				out.push( {
					kind: 'prop',
					valueIndex: r.valueIndex!,
					element: node as Element,
					name: r.name!,
				} );
			} else if ( r.kind === 'bool' ) {
				out.push( {
					kind: 'bool',
					valueIndex: r.valueIndex!,
					element: node as Element,
					name: r.name!,
				} );
			}
		}
		return out;
	};

	const entry: Compiled = { template, buildParts };
	compiledCache.set( strings, entry );
	return entry;
}

interface MountState {
	strings: TemplateStringsArray;
	parts: Part[];

	nodes: Node[];
}

const mountState = new WeakMap<Element | DocumentFragment, MountState>();

function mountIntact(
	state: MountState,
	container: Element | DocumentFragment,
): boolean {
	for ( const node of state.nodes ) {
		if ( node.parentNode !== container ) {
			return false;
		}
	}
	return true;
}

export function render(
	result: TemplateResult,
	container: Element | DocumentFragment,
): void {
	const existing = mountState.get( container );
	if (
		existing &&
		existing.strings === result.strings &&
		mountIntact( existing, container )
	) {
		applyValues( existing.parts, result.values );
		return;
	}

	const compiled = compile( result.strings );
	const fragment = compiled.template.content.cloneNode( true ) as DocumentFragment;
	const parts = compiled.buildParts( fragment );
	const nodes = Array.from( fragment.childNodes );

	while ( container.firstChild ) {
		container.removeChild( container.firstChild );
	}
	container.appendChild( fragment );

	applyValues( parts, result.values );
	mountState.set( container, { strings: result.strings, parts, nodes } );
}

function applyValues( parts: Part[], values: readonly unknown[] ): void {
	for ( const part of parts ) {
		if ( part.kind === 'node' ) {
			updateChildPart( part.child, values[ part.valueIndex ] );
		} else if ( part.kind === 'attr' ) {
			let composed = part.template[ 0 ];
			for ( let i = 0; i < part.valueIndices.length; i++ ) {
				composed += formatText( values[ part.valueIndices[ i ] ] );
				composed += part.template[ i + 1 ];
			}
			if ( composed !== part.last ) {
				part.last = composed;
				if ( composed === '' ) {
					part.element.removeAttribute( part.name );
				} else {
					part.element.setAttribute( part.name, composed );
				}
			}
		} else if ( part.kind === 'event' ) {
			const next = values[ part.valueIndex ] as EventListener | undefined;
			if ( next !== part.current ) {
				if ( part.current ) {
					part.element.removeEventListener( part.name, part.current );
				}
				if ( next ) {
					part.element.addEventListener( part.name, next );
				}
				part.current = next;
			}
		} else if ( part.kind === 'prop' ) {
			const next = values[ part.valueIndex ];
			if ( next !== part.last ) {
				part.last = next;
				( part.element as unknown as Record<string, unknown> )[ part.name ] =
					next;
			}
		} else if ( part.kind === 'bool' ) {
			const next = !! values[ part.valueIndex ];
			if ( next !== part.last ) {
				part.last = next;
				if ( next ) {
					part.element.setAttribute( part.name, '' );
				} else {
					part.element.removeAttribute( part.name );
				}
			}
		}
	}
}

function updateChildPart( child: ChildPart, value: unknown ): void {
	if ( value === null || value === undefined || value === false ) {
		if ( child.state ) {
			disposeChildState( child.state );
			child.state = null;
		}
		return;
	}

	if ( Array.isArray( value ) ) {
		updateArrayChild( child, value );
		return;
	}

	if ( isTemplateResult( value ) ) {
		updateTemplateChild( child, value );
		return;
	}

	if ( value instanceof Node ) {
		updateNodeChild( child, value );
		return;
	}

	updateTextChild( child, formatText( value ) );
}

function updateNodeChild( child: ChildPart, node: Node ): void {
	const old = child.state;
	if ( old?.shape === 'node' && old.node === node ) {
		return;
	}
	if ( old ) {
		disposeChildState( old );
	}
	insertBeforeAnchor( child, [ node ] );
	child.state = { shape: 'node', node };
}

function updateTextChild( child: ChildPart, text: string ): void {
	const old = child.state;
	if ( old?.shape === 'text' ) {
		if ( old.text !== text ) {
			old.node.textContent = text;
			old.text = text;
		}
		return;
	}
	if ( old ) {
		disposeChildState( old );
	}
	const node = document.createTextNode( text );
	insertBeforeAnchor( child, [ node ] );
	child.state = { shape: 'text', node, text };
}

function updateTemplateChild( child: ChildPart, result: TemplateResult ): void {
	const old = child.state;
	if ( old?.shape === 'template' && old.strings === result.strings ) {
		applyValues( old.parts, result.values );
		return;
	}
	if ( old ) {
		disposeChildState( old );
	}
	const compiled = compile( result.strings );
	const fragment = compiled.template.content.cloneNode( true ) as DocumentFragment;
	const parts = compiled.buildParts( fragment );
	const topNodes = Array.from( fragment.childNodes );
	insertBeforeAnchor( child, [ fragment ] );
	applyValues( parts, result.values );
	child.state = {
		shape: 'template',
		strings: result.strings,
		parts,
		nodes: topNodes,
	};
}

function updateArrayChild( child: ChildPart, arr: readonly unknown[] ): void {
	const old = child.state;
	if ( old?.shape === 'array' ) {
		const shared = Math.min( old.entries.length, arr.length );
		for ( let i = 0; i < shared; i++ ) {
			updateChildPart( old.entries[ i ], arr[ i ] );
		}
		if ( arr.length < old.entries.length ) {
			for ( let i = arr.length; i < old.entries.length; i++ ) {
				const entry = old.entries[ i ];
				if ( entry.state ) {
					disposeChildState( entry.state );
				}
				entry.anchor.remove();
			}
			old.entries.length = arr.length;
		} else {
			for ( let i = old.entries.length; i < arr.length; i++ ) {
				const entryAnchor = document.createTextNode( '' );
				insertBeforeAnchor( child, [ entryAnchor ] );
				const entry: ChildPart = { anchor: entryAnchor, state: null };
				updateChildPart( entry, arr[ i ] );
				old.entries.push( entry );
			}
		}
		return;
	}
	if ( old ) {
		disposeChildState( old );
	}

	const entries: ChildPart[] = [];
	for ( const v of arr ) {
		const entryAnchor = document.createTextNode( '' );
		insertBeforeAnchor( child, [ entryAnchor ] );
		const entry: ChildPart = { anchor: entryAnchor, state: null };
		updateChildPart( entry, v );
		entries.push( entry );
	}
	child.state = { shape: 'array', entries };
}

function insertBeforeAnchor( child: ChildPart, nodes: Node[] ): void {
	const parent = child.anchor.parentNode;
	if ( ! parent ) {
		return;
	}
	for ( const node of nodes ) {
		parent.insertBefore( node, child.anchor );
	}
}

function disposeChildState( state: ChildState ): void {
	if ( state.shape === 'text' ) {
		state.node.remove();
		return;
	}
	if ( state.shape === 'template' ) {
		for ( const part of state.parts ) {
			if ( part.kind === 'node' && part.child.state ) {
				disposeChildState( part.child.state );
				part.child.state = null;
			}
		}
		for ( const node of state.nodes ) {
			if ( node.parentNode ) {
				node.parentNode.removeChild( node );
			}
		}
		return;
	}
	if ( state.shape === 'node' ) {
		if ( state.node.parentNode ) {
			state.node.parentNode.removeChild( state.node );
		}
		return;
	}

	for ( const entry of state.entries ) {
		if ( entry.state ) {
			disposeChildState( entry.state );
		}
		entry.anchor.remove();
	}
}

function formatText( v: unknown ): string {
	if ( v === null || v === undefined || v === false ) {
		return '';
	}
	return String( v );
}
