import { findScriptByPath, isScriptInDocument } from '../script-presence';

const pending = new Map<string, Promise<void>>();

const replayedAliases = new Set< string >();

export interface ScriptExtras {

	handle?: string;

	translations?: string;

	l10n?: string[];

	before?: string[];

	after?: string[];

	deps?: Array< { url: string } & ScriptExtras >;
}

export function loadVendorScript(
	url: string,
	extras?: ScriptExtras,
): Promise<void> {
	const existing = pending.get( url );
	if ( existing ) {
		return existing;
	}

	const deps = extras?.deps;
	if ( deps && deps.length > 0 ) {
		const loadDep = ( dep: { url: string } & ScriptExtras ) => {
			if ( isScriptInDocument( dep ) ) {
				return Promise.resolve();
			}
			if ( ! dep.url ) {
				replayAlias( dep );
				return Promise.resolve();
			}
			return loadVendorScript( dep.url, { ...dep, deps: undefined } );
		};
		const withDeps = deps
			.reduce(
				( prev, dep ) => prev.then( () => loadDep( dep ) ),
				Promise.resolve< void >( undefined ),
			)

			.then( () => injectScriptTag( url, extras ) );
		pending.set( url, withDeps );
		return withDeps;
	}

	const promise = injectScriptTag( url, extras );
	pending.set( url, promise );
	return promise;
}

function replayAlias( dep: ScriptExtras ): void {
	if ( dep.handle ) {
		if ( replayedAliases.has( dep.handle ) ) {
			return;
		}
		replayedAliases.add( dep.handle );
	}
	for ( const code of dep.l10n ?? [] ) {
		injectInline( code );
	}
	for ( const code of dep.before ?? [] ) {
		injectInline( code );
	}
	for ( const code of dep.after ?? [] ) {
		injectInline( code );
	}
}

function injectScriptTag( url: string, extras?: ScriptExtras ): Promise< void > {
	return new Promise<void>( ( resolve, reject ) => {
		const selector = `script[data-os-vendor="${ cssEscape( url ) }"]`;
		const preexisting = document.querySelector<HTMLScriptElement>( selector );
		if ( preexisting ) {
			if ( preexisting.dataset.loaded === '1' ) {
				resolve();
				return;
			}
			preexisting.addEventListener( 'load', () => resolve(), { once: true } );
			preexisting.addEventListener(
				'error',
				() => reject( new Error( `Failed to load ${ url }` ) ),
				{ once: true },
			);
			return;
		}

		const alreadyInDocument = findScriptByPath( url );
		if ( alreadyInDocument ) {
			alreadyInDocument.dataset.osVendor = url;
			alreadyInDocument.dataset.loaded = '1';
			resolve();
			return;
		}

		if ( isScriptInDocument( { handle: extras?.handle } ) ) {
			resolve();
			return;
		}

		if ( extras?.translations ) {
			injectInline( extras.translations );
		}
		for ( const code of extras?.l10n ?? [] ) {
			injectInline( code );
		}
		for ( const code of extras?.before ?? [] ) {
			injectInline( code );
		}

		const script = document.createElement( 'script' );
		script.src = url;
		script.async = true;
		script.dataset.osVendor = url;
		script.addEventListener(
			'load',
			() => {
				script.dataset.loaded = '1';

				for ( const code of extras?.after ?? [] ) {
					injectInline( code );
				}
				resolve();
			},
			{ once: true },
		);
		script.addEventListener(
			'error',
			() => {
				pending.delete( url );
				script.remove();
				reject( new Error( `Failed to load ${ url }` ) );
			},
			{ once: true },
		);
		document.head.appendChild( script );
	} );
}

function injectInline( code: string ): void {
	if ( ! code ) {
		return;
	}
	const tag = document.createElement( 'script' );
	tag.textContent = code;
	tag.dataset.osVendorInline = '1';
	document.head.appendChild( tag );
}

export function injectInlineScript( code: string ): void {
	injectInline( code );
}

function cssEscape( value: string ): string {
	if ( typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ) {
		return CSS.escape( value );
	}
	return value.replace( /["\\]/g, '\\$&' );
}
