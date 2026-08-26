/**
 * Code Editor — Monaco PHP completion + hover providers.
 *
 * Phase 5a brings WordPress-aware autocomplete + hover docs for PHP
 * files. Backed by the server-side WP core symbol index (functions
 * + hooks). Hook-context detection is regex-based: when the cursor
 * sits inside `add_action( '|`, `add_filter( '|`, `do_action( '|`,
 * or `apply_filters( '|`, the completion request narrows to action
 * + filter kinds for surgically relevant suggestions.
 *
 * Both providers are debounced + AbortController-cancelled so a
 * burst of keystrokes coalesces to a single in-flight request,
 * cancellation rolls in-flight requests off when the user keeps
 * typing.
 *
 * @public
 */

import {
	fetchPhpSymbolDetail,
	fetchPhpSymbols,
	RestError,
	type PhpSymbolKind,
	type PhpSymbolMatch,
} from '../rest';

import type * as Monaco from 'monaco-editor';

/**
 * Host callback the provider calls when the user requests
 * `Go to Definition` on a workspace symbol — `index.ts` plumbs
 * its tab-open + scroll-to-line logic through here. Returning the
 * model from a successful open lets the provider return a
 * Location pointing at it; returning null tells Monaco to give
 * up gracefully.
 */
export interface PhpProviderHost {
	openFileAtLine: (
		path: string,
		line: number,
	) => Promise< Monaco.editor.ITextModel | null >;
}

/** Context the user's cursor sits in — drives the completion query. */
type EditorContext =
	| { kind: 'general'; prefix: string }
	| { kind: 'hook'; hookKind: 'action' | 'filter'; prefix: string };

/**
 * Detect a hook-name-string context. The line up to the cursor is
 * matched against the canonical WP hook-call shape; when the regex
 * fires the prefix is whatever the user has typed so far inside the
 * quoted string.
 */
function detectHookContext( textBefore: string ): EditorContext | null {
	// Action: add_action / do_action / do_action_ref_array.
	const action = textBefore.match(
		/(add_action|do_action|do_action_ref_array)\s*\(\s*(['"])([^'"]*)$/,
	);
	if ( action ) {
		return { kind: 'hook', hookKind: 'action', prefix: action[ 3 ] };
	}
	// Filter: add_filter / apply_filters / apply_filters_ref_array.
	const filter = textBefore.match(
		/(add_filter|apply_filters|apply_filters_ref_array)\s*\(\s*(['"])([^'"]*)$/,
	);
	if ( filter ) {
		return { kind: 'hook', hookKind: 'filter', prefix: filter[ 3 ] };
	}
	return null;
}

/**
 * Pull the identifier prefix immediately to the left of the cursor.
 * The empty string means "the user just typed `(` or `;` or
 * something else non-identifier" — Monaco re-fires the provider
 * frequently, so we don't want to flood the server with empty-prefix
 * requests; the caller short-circuits when prefix is too short.
 */
function detectIdentifierPrefix( textBefore: string ): string {
	const m = textBefore.match( /([A-Za-z_][A-Za-z0-9_]*)$/ );
	return m ? m[ 1 ] : '';
}

function detectContext( textBefore: string ): EditorContext | null {
	const hook = detectHookContext( textBefore );
	if ( hook ) {
		return hook;
	}
	const prefix = detectIdentifierPrefix( textBefore );
	if ( ! prefix ) {
		return null;
	}
	return { kind: 'general', prefix };
}

/**
 * Convert a server-side symbol entry into a Monaco completion item.
 *
 * Hooks complete *inside* a quoted string — `insertText` is the
 * raw hook name (no quotes); the editor's existing quote stays.
 * Functions complete in PHP code — `insertText` is the function
 * name with `($0)` so the snippet's final tab-stop lands inside
 * the parens for the next argument.
 */
function entryToCompletionItem(
	monaco: typeof Monaco,
	entry: PhpSymbolMatch,
	range: Monaco.IRange,
	context: EditorContext,
): Monaco.languages.CompletionItem {
	const isHook = entry.kind === 'action' || entry.kind === 'filter';

	let detail = entry.signature;
	if ( entry.kind !== 'function' ) {
		const label = entry.kind === 'action' ? 'Action' : 'Filter';
		detail = entry.since ? `${ label } · since ${ entry.since }` : label;
	}

	const insertText = isHook
		? entry.name
		: `${ entry.name }($0)`;

	const insertTextRules = isHook
		? monaco.languages.CompletionItemInsertTextRule.None
		: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;

	const kind =
		entry.kind === 'function'
			? monaco.languages.CompletionItemKind.Function
			: monaco.languages.CompletionItemKind.Event;

	return {
		label: entry.name,
		kind,
		detail,
		insertText,
		insertTextRules,
		range,
		// Defer doc fetch to resolution time so the dropdown isn't
		// blocked on N hover-doc roundtrips. Monaco calls
		// `resolveCompletionItem` only when the user actually
		// selects/hovers a row.
		documentation: undefined,
		// Sort hooks above functions when in a hook context so the
		// list reflects what the user is actually typing toward.
		sortText:
			context.kind === 'hook' && isHook ? `0_${ entry.name }` : `1_${ entry.name }`,
	};
}

/** A tiny throttle: replace the in-flight controller, abort the old one. */
class CancellableLatest< T > {
	private active: AbortController | null = null;

	async run( fn: ( signal: AbortSignal ) => Promise< T > ): Promise< T | null > {
		this.active?.abort();
		const ac = new AbortController();
		this.active = ac;
		try {
			const result = await fn( ac.signal );
			if ( ac.signal.aborted ) {
				return null;
			}
			return result;
		} catch ( err ) {
			if ( ( err as Error ).name === 'AbortError' ) {
				return null;
			}
			throw err;
		} finally {
			if ( this.active === ac ) {
				this.active = null;
			}
		}
	}
}

/**
 * Mutable host slot shared by the registered providers. Each editor
 * mount calls {@link setPhpProviderHost} to point the providers at
 * its tab-open / scroll-to-line plumbing — re-registering Monaco
 * providers per editor-open would stack them and Monaco would
 * aggregate stale results.
 */
let activeHost: PhpProviderHost | null = null;

/**
 * Point the provider's `Go to Definition` callback at this host.
 * Pass `null` on teardown to detach.
 */
export function setPhpProviderHost( host: PhpProviderHost | null ): void {
	activeHost = host;
}

/**
 * Register the Monaco PHP providers. Idempotent — first call wires
 * completion / hover / definition once per Monaco instance; all
 * subsequent calls no-op.
 *
 * The definition provider reads from {@link activeHost} at request
 * time, so callers don't need to re-register when the editor host
 * changes — they just call {@link setPhpProviderHost}.
 */
export function registerPhpProviders( monaco: typeof Monaco ): void {
	const w = window as unknown as { __wpdcPhpProvidersRegistered?: boolean };
	if ( w.__wpdcPhpProvidersRegistered ) {
		return;
	}
	w.__wpdcPhpProvidersRegistered = true;
	registerStatelessProviders( monaco );
	registerDefinitionProvider( monaco );
}

function registerStatelessProviders( monaco: typeof Monaco ): void {
	const completionLatest = new CancellableLatest< PhpSymbolMatch[] >();
	const detailLatest = new CancellableLatest< { doc: string; signature: string; since: string } | null >();

	monaco.languages.registerCompletionItemProvider( 'php', {
		// Trigger after every keystroke that could continue an
		// identifier, plus the quote characters that open hook names.
		triggerCharacters: [
			'_',
			'\'',
			'"',
			...'abcdefghijklmnopqrstuvwxyz'.split( '' ),
		],
		async provideCompletionItems( model, position ) {
			const textBefore = model.getValueInRange( {
				startLineNumber: position.lineNumber,
				startColumn: 1,
				endLineNumber: position.lineNumber,
				endColumn: position.column,
			} );

			const ctx = detectContext( textBefore );
			if ( ! ctx ) {
				return { suggestions: [] };
			}

			// Don't bombard the server on every keystroke — wait
			// until the user has typed at least 2 chars. Hook
			// context has no minimum: completions fire as soon as
			// the quote opens, since the dropdown is the only
			// signal of what hooks exist.
			const minLen = ctx.kind === 'hook' ? 0 : 2;
			if ( ctx.prefix.length < minLen ) {
				return { suggestions: [] };
			}

			const word = model.getWordUntilPosition( position );
			const range: Monaco.IRange = {
				startLineNumber: position.lineNumber,
				endLineNumber: position.lineNumber,
				startColumn: word.startColumn,
				endColumn: word.endColumn,
			};

			let kinds: PhpSymbolKind[] = [];
			if ( ctx.kind === 'hook' ) {
				kinds = ctx.hookKind === 'action' ? [ 'action' ] : [ 'filter' ];
			}

			const matches = await completionLatest.run( ( signal ) =>
				fetchPhpSymbols( ctx.prefix, kinds, signal ).then(
					( r ) => r.matches,
				),
			);
			if ( ! matches ) {
				return { suggestions: [] };
			}

			return {
				suggestions: matches.map( ( entry ) =>
					entryToCompletionItem( monaco, entry, range, ctx ),
				),
				incomplete: matches.length >= 50,
			};
		},
		async resolveCompletionItem( item ) {
			// Fetch the full PHPDoc only when Monaco asks to resolve
			// the row (hover or first arrow-select). Avoids the
			// N-roundtrip dropdown.
			try {
				const label = typeof item.label === 'string' ? item.label : item.label.label;
				const detail = await fetchPhpSymbolDetail( label );
				let documentation = item.documentation;
				if ( detail.doc ) {
					const sincePrefix = detail.since
						? `_Since ${ detail.since }._\n\n`
						: '';
					const sourceSuffix = detail.source
						? `\n\n— \`${ detail.source }\``
						: '';
					documentation = {
						value: sincePrefix + detail.doc + sourceSuffix,
					};
				}
				return {
					...item,
					detail: detail.signature || item.detail,
					documentation,
				};
			} catch {
				return item;
			}
		},
	} );

	monaco.languages.registerHoverProvider( 'php', {
		async provideHover( model, position ) {
			const word = model.getWordAtPosition( position );
			if ( ! word || ! word.word ) {
				return null;
			}

			const detail = await detailLatest.run( ( signal ) =>
				fetchPhpSymbolDetail( word.word, signal )
					.then( ( d ) => ( {
						doc: d.doc,
						signature: d.signature,
						since: d.since,
					} ) )
					.catch( ( err ) => {
						// 404 = symbol unknown to the index.
						// Return null so Monaco falls through to
						// other hover sources.
						if ( err instanceof RestError && err.status === 404 ) {
							return null;
						}
						throw err;
					} ),
			);

			if ( ! detail ) {
				return null;
			}

			return {
				range: {
					startLineNumber: position.lineNumber,
					endLineNumber: position.lineNumber,
					startColumn: word.startColumn,
					endColumn: word.endColumn,
				},
				contents: [
					{ value: '```php\n' + detail.signature + '\n```' },
					...( detail.since
						? [ { value: `_Since ${ detail.since }._` } ]
						: [] ),
					...( detail.doc ? [ { value: detail.doc } ] : [] ),
				],
			};
		},
	} );
}

/**
 * Definition provider — drives `Go to Definition` (Cmd/Ctrl-click,
 * F12, "Reveal Definition" command palette).
 *
 * Workflow when the user invokes it on a workspace symbol:
 *   1. Look up the symbol detail; if it carries `file` + `line`,
 *      that's a workspace symbol we can navigate to.
 *   2. Ask the host (index.ts) to open the file as a tab. The host
 *      returns the now-existing Monaco model.
 *   3. Return a `Location` pointing at the symbol's declaration line
 *      of that model — Monaco switches the editor to it and scrolls
 *      there.
 *
 * For WP-core symbols the source is a `wp-includes/foo.php` file
 * outside the workspace, so we don't try to navigate. Hover docs +
 * the source link in the popup carry the user the rest of the way.
 */
function registerDefinitionProvider( monaco: typeof Monaco ): void {
	monaco.languages.registerDefinitionProvider( 'php', {
		async provideDefinition( model, position ) {
			const host = activeHost;
			if ( ! host ) {
				return null;
			}
			const word = model.getWordAtPosition( position );
			if ( ! word || ! word.word ) {
				return null;
			}
			let detail;
			try {
				detail = await fetchPhpSymbolDetail( word.word );
			} catch ( err ) {
				if ( err instanceof RestError && err.status === 404 ) {
					return null;
				}
				throw err;
			}

			const file = ( detail as unknown as { file?: string } ).file;
			const line = ( detail as unknown as { line?: number } ).line;
			if ( typeof file !== 'string' || ! file || typeof line !== 'number' ) {
				// WP-core symbol — no workspace path to jump to.
				return null;
			}

			const target = await host.openFileAtLine( file, line );
			if ( ! target ) {
				return null;
			}

			return [
				{
					uri: target.uri,
					range: {
						startLineNumber: Math.max( 1, line ),
						endLineNumber: Math.max( 1, line ),
						startColumn: 1,
						endColumn: 1,
					},
				},
			];
		},
	} );
}
