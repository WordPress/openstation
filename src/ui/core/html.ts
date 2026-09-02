/**
 * os-ui — minimalistic tagged-template renderer.
 *
 * Inspired by lit-html; deliberately ~400 LOC instead of ~3000. Covers
 * the bindings we actually need:
 *
 *   - text:               `<div>${value}</div>`
 *   - nested template:    `<div>${html\`<span>…</span>\`}</div>`
 *   - array of values:    `<ul>${items.map(i => html\`<li>${i}</li>\`)}</ul>`
 *   - attribute:          `<div class=${value}>…</div>`
 *   - event:              `<button @click=${handler}>…</button>`
 *   - property:           `<input .value=${value}>`
 *   - boolean attr:       `<button ?disabled=${cond}>…</button>`
 *
 * A "text slot" — any `${}` between tags — can hold a primitive, a
 * `TemplateResult`, or an array of either. Arrays diff positionally:
 * matching lengths + matching child shapes update in place, otherwise
 * the slot tears down and remounts fresh. Good enough for the UI
 * we render; no keyed diffing for v1.
 */

/**
 * Opaque template result — identity is the `strings` array, so the
 * renderer can cache its parsed parts and diff only the `values`
 * across re-renders.
 */
export interface TemplateResult {
	readonly __wpdHtml: true;
	readonly strings: TemplateStringsArray;
	readonly values: readonly unknown[];
}

/** Tag for HTML templates. */
export function html(
	strings: TemplateStringsArray,
	...values: unknown[]
): TemplateResult {
	return { __wpdHtml: true, strings, values };
}

function isTemplateResult( v: unknown ): v is TemplateResult {
	return !! v && ( v as { __wpdHtml?: boolean } ).__wpdHtml === true;
}

/**
 * A placeholder marker inserted wherever a `${}` slot lives. After
 * `innerHTML`-parse we walk the tree, find markers, and build a
 * list of `Part`s that know how to update their slot on re-render.
 *
 * A slot in CHILD position is marked with a comment node, a slot
 * inside a tag (an attribute value) or inside a raw-text element
 * (`<style>`, `<script>`, `<textarea>`, `<title>`) with marker text.
 * The distinction is load-bearing for tables: the HTML parser
 * foster-parents stray TEXT out of `<table>`, `<tbody>` and `<tr>`,
 * so a text marker between two `<td>`s ended up after the table and
 * the cells rendered there with it. A comment is left where it is.
 */
const MARKER_PREFIX = '$$wpd$$';
const MARKER_RE = /\$\$wpd\$\$(\d+)\$\$/g;
/**
 * The child-position marker is its own spelling, so a slot an author
 * put INSIDE a comment (`<!-- ${ note } -->`, marked as text) can
 * never be mistaken for one of ours and rendered into the page.
 */
const COMMENT_MARKER_PREFIX = '$$wpd-node$$';
const COMMENT_MARKER_RE = /^\$\$wpd-node\$\$(\d+)\$\$$/;
const RAW_TEXT_TAGS = new Set( [ 'style', 'script', 'textarea', 'title' ] );

function joinWithMarkers( strings: TemplateStringsArray ): string {
	let out = '';
	// A small lexer over the static strings, enough to know whether
	// each slot sits inside a tag, inside a comment, or in text.
	let inTag = false;
	let quote: string | null = null;
	let inComment = false;
	/** The raw-text element being read, until its closing tag. */
	let rawText: string | null = null;
	/** The name of the tag being read, while `naming` — raw-text detection only. */
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
				// Only an opening tag's name matters (a closing tag or a
				// doctype never starts a raw-text run).
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

// ---------------------------------------------------------------
// Part types — one per binding discovered in the template.
// ---------------------------------------------------------------

/**
 * A "child part" owns a rendered region of DOM bracketed by an
 * end-anchor text node. Content is ALWAYS inserted as preceding
 * siblings before the anchor; the anchor never moves.
 *
 * State tracks what's currently rendered so re-renders can:
 *   - update text in place,
 *   - diff nested templates when their `strings` match,
 *   - diff arrays positionally when their length matches,
 * and fall back to dispose + remount when shape changes.
 */
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
		/** Top-level nodes mounted for this template — drives dispose. */
		nodes: Node[];
	}
	| { shape: 'array'; entries: ChildPart[] }
	/**
	 * Pre-built DOM node threaded through the template. Used when the
	 * caller wants a stable reference (focus preservation, scroll,
	 * existing event listeners). We hold the node exactly as given —
	 * no cloning — so the caller keeps their reference valid.
	 */
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
	/** Template fragments between markers, so `class="a ${b} c"` → [`a `, ` c`]. */
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

/** Compiled template — cached per unique `strings` array. */
interface Compiled {
	template: HTMLTemplateElement;
	buildParts: ( fragment: DocumentFragment ) => Part[];
}

/**
 * Cache keyed by the template `strings` array identity. Template
 * strings arrays are frozen + reused across render calls, so strict
 * equality is the correct key.
 */
const compiledCache = new WeakMap<TemplateStringsArray, Compiled>();

/** Compile `strings` once, then reuse forever. */
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

		// Iterate a snapshot of children so mutations don't confuse the
		// loop. Track `shift` so the recipe paths match the post-mutation
		// live-DOM positions (not the snapshot indices) — each text-node
		// split inserts `newNodes.length - 1` extra siblings.
		const children = Array.from( node.childNodes );
		let shift = 0;
		for ( let i = 0; i < children.length; i++ ) {
			const child = children[ i ];
			const liveIndex = i + shift;
			if ( child.nodeType === Node.COMMENT_NODE ) {
				// A child-position slot: swap the comment marker for the
				// empty text anchor every child part is bracketed by.
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
				// Net change in parent's child count: removed 1, added N.
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

// ---------------------------------------------------------------
// Render pipeline
// ---------------------------------------------------------------

interface MountState {
	strings: TemplateStringsArray;
	parts: Part[];
	/** Top-level nodes mounted into the container — see {@link mountIntact}. */
	nodes: Node[];
}

const mountState = new WeakMap<Element | DocumentFragment, MountState>();

/**
 * Whether the mounted top-level nodes are still children of the
 * container. Imperative code outside the renderer can wipe a previous
 * render's DOM (`container.innerHTML = ''`) while the cache entry for
 * the container survives; updating those detached parts would
 * silently render nothing, since insertion is anchored on text nodes
 * that no longer have a parent. Detect the wipe and fall through to a
 * fresh mount instead.
 */
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

/**
 * Render `result` into `container`. Idempotent — subsequent calls
 * with the same template compile just update the changed values.
 * A different template resets the container and re-mounts.
 */
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

/** Update each part to the new slot value if it actually changed. */
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

/**
 * Reconcile a `ChildPart` against a new value. Dispatches on the
 * value's shape (text / template / array / nullish) and either
 * updates in place or tears down + remounts.
 */
function updateChildPart( child: ChildPart, value: unknown ): void {
	if ( value === null || value === undefined || value === false ) {
		// Empty shape. Dispose whatever was there; leave nothing.
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

	// Primitive (string / number / boolean-true).
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
		// Compare the cached last-written string rather than reading
		// back `node.textContent`. Some test harnesses (vi.spyOn with
		// no mockImplementation) stub the property accessor entirely,
		// so the getter returns undefined and a naive `!== text`
		// check would always fire a write.
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
		// Prefix-stable reconciliation (still positional, not keyed):
		// shared slots update in place, a shorter array disposes only
		// the tail, a longer one appends fresh entries before the end
		// anchor. Tearing the whole list down on ANY length change —
		// the previous behaviour — recreated every node whenever an
		// infinite scroll appended a page, which repainted the entire
		// canvas (custom elements re-upgrade, images re-decode) as a
		// visible full-container blink.
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
	// Mount each item with its own anchor so future re-renders can
	// update in place. Anchors are inserted in order before this
	// child's end anchor.
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

/**
 * Insert the given nodes into the DOM just before `child.anchor`.
 * Works for both `DocumentFragment` (which empties on insert, so
 * its child count is pre-captured by callers) and plain `Node`s.
 */
function insertBeforeAnchor( child: ChildPart, nodes: Node[] ): void {
	const parent = child.anchor.parentNode;
	if ( ! parent ) {
		return;
	}
	for ( const node of nodes ) {
		parent.insertBefore( node, child.anchor );
	}
}

/**
 * Recursively remove every node that was mounted for the given
 * state. Event listeners on removed elements are GC'd with the
 * nodes; no explicit cleanup needed.
 */
function disposeChildState( state: ChildState ): void {
	if ( state.shape === 'text' ) {
		state.node.remove();
		return;
	}
	if ( state.shape === 'template' ) {
		// Dispose the instance's own child parts FIRST. A part whose
		// anchor sits at the template's top level inserts its content
		// as SIBLINGS of `state.nodes` (not descendants), so removing
		// only the originally cloned nodes leaks everything those
		// slots rendered — the "stale pane left behind after the slot
		// switched templates" bug.
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
	// Array — dispose each entry's state AND remove its anchor.
	for ( const entry of state.entries ) {
		if ( entry.state ) {
			disposeChildState( entry.state );
		}
		entry.anchor.remove();
	}
}

/** Coerce a primitive slot value to its text representation. */
function formatText( v: unknown ): string {
	if ( v === null || v === undefined || v === false ) {
		return '';
	}
	return String( v );
}
