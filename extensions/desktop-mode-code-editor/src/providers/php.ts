import {
	fetchPhpSymbolDetail,
	fetchPhpSymbols,
	RestError,
	type PhpSymbolKind,
	type PhpSymbolMatch,
} from '../rest';

import type * as Monaco from 'monaco-editor';

export interface PhpProviderHost {
	openFileAtLine: (
		path: string,
		line: number,
	) => Promise< Monaco.editor.ITextModel | null >;
}

type EditorContext =
	| { kind: 'general'; prefix: string }
	| { kind: 'hook'; hookKind: 'action' | 'filter'; prefix: string };

function detectHookContext( textBefore: string ): EditorContext | null {

	const action = textBefore.match(
		/(add_action|do_action|do_action_ref_array)\s*\(\s*(['"])([^'"]*)$/,
	);
	if ( action ) {
		return { kind: 'hook', hookKind: 'action', prefix: action[ 3 ] };
	}

	const filter = textBefore.match(
		/(add_filter|apply_filters|apply_filters_ref_array)\s*\(\s*(['"])([^'"]*)$/,
	);
	if ( filter ) {
		return { kind: 'hook', hookKind: 'filter', prefix: filter[ 3 ] };
	}
	return null;
}

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

		documentation: undefined,

		sortText:
			context.kind === 'hook' && isHook ? `0_${ entry.name }` : `1_${ entry.name }`,
	};
}

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

let activeHost: PhpProviderHost | null = null;

export function setPhpProviderHost( host: PhpProviderHost | null ): void {
	activeHost = host;
}

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
