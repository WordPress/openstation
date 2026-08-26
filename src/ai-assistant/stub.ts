/**
 * OpenStation — AI Assistant lazy-load stub.
 *
 * Lives in the main `desktop.min.js` bundle. Holds the public
 * {@link AiAssistantApi} contract but defers loading of the 38 kB
 * implementation (`ai-assistant.min.js`) until the user actually
 * invokes it: first `open()` / `toggle()` / `ask()` triggers a
 * `<script>` injection, the impl bundle calls
 * `window.openStationCreateAiAssistant( config )` to mint a real
 * instance, and every subsequent call forwards to it.
 *
 * Plugins that call `wp.os.ai.open()` or `wp.os.ai.ask( … )`
 * synchronously after boot see no difference — the stub buffers the
 * constructor config and any late-bound `ask` function injected via
 * {@link attachAsk}, then replays the call once the impl arrives.
 *
 * Cost ledger:
 *   - Main bundle:   ~1 kB stub.
 *   - Lazy bundle:   ai-assistant.min.js, fetched on first use.
 *   - First-paint:   zero impact — no network call until invocation.
 */

import type { AskFn } from '../ai/ask';
import { ensureCommandPaletteAssets } from '../commands/palette-assets';
import { ensureDeferredStyle } from '../deferred-styles';
import {
	hidePalettePlaceholder,
	showPalettePlaceholder,
} from './loading-placeholder';
import type {
	AiAssistantApi,
	AiAssistantConfig,
	AiAssistantFactory,
} from './types';

declare global {
	interface Window {
		openStationCreateAiAssistant?: AiAssistantFactory;
	}
}

type LoadedAi = AiAssistantApi & { attachAsk( fn: AskFn ): void };

/**
 * Inject the impl script tag, await load, return the factory.
 *
 * Idempotent: subsequent callers reuse the in-flight Promise.
 * Re-resolution after load is a synchronous global lookup.
 */
function loadImpl( scriptUrl: string ): Promise< AiAssistantFactory > {
	if ( window.openStationCreateAiAssistant ) {
		return Promise.resolve( window.openStationCreateAiAssistant );
	}
	return new Promise( ( resolve, reject ) => {
		// If a tag with this URL is already in the DOM, hook its load
		// event rather than appending a duplicate. Matches the
		// reentrancy guarantee of `customElements.define`.
		const existing = document.querySelector< HTMLScriptElement >(
			`script[data-os-ai="1"]`,
		);
		const finish = (): void => {
			const factory = window.openStationCreateAiAssistant;
			if ( ! factory ) {
				reject(
					new Error(
						'[openstation] ai-assistant bundle loaded but did not register openStationCreateAiAssistant',
					),
				);
				return;
			}
			resolve( factory );
		};
		if ( existing ) {
			if ( window.openStationCreateAiAssistant ) {
				finish();
			} else {
				existing.addEventListener( 'load', finish );
				existing.addEventListener( 'error', () =>
					reject( new Error( 'failed to load ai-assistant bundle' ) ),
				);
			}
			return;
		}
		const s = document.createElement( 'script' );
		s.src = scriptUrl;
		s.async = true;
		s.dataset.osAi = '1';
		s.addEventListener( 'load', finish );
		s.addEventListener( 'error', () =>
			reject( new Error( 'failed to load ai-assistant bundle' ) ),
		);
		document.head.appendChild( s );
	} );
}

/**
 * Main-bundle implementation of {@link AiAssistantApi}.
 *
 * Methods that *render* (open / toggle) trigger the impl load and
 * forward once it resolves. Read-only state queries (`isOpen`) and
 * setters that just capture a callback (`attachAsk`) work without
 * loading the impl — important so `wp.os.ai.attachAsk( ... )`
 * during boot doesn't drag the bundle in.
 */
export class AiAssistantStub implements AiAssistantApi {
	private readonly _config: AiAssistantConfig;
	private readonly _scriptUrl: string;
	private _real: LoadedAi | null = null;
	private _loadPromise: Promise< LoadedAi > | null = null;
	private _pendingAsk: AskFn | null = null;
	/**
	 * Tracks "the user pressed open" before the impl resolved, so
	 * the impl's first action is to open. Synchronous reads of
	 * `isOpen` return this value until the impl takes over.
	 */
	private _intendOpen = false;

	constructor( config: AiAssistantConfig, scriptUrl: string ) {
		this._config = config;
		this._scriptUrl = scriptUrl;
	}

	private _ensure(): Promise< LoadedAi > {
		if ( this._loadPromise ) {
			return this._loadPromise;
		}
		// The assistant's stylesheet is a `deferredStyles` entry, not
		// a boot enqueue — inject it here so the `<link>` fetches in
		// parallel with the impl bundle below.
		ensureDeferredStyle( 'desktop-mode-ai-assistant' );
		// First palette invocation is also the moment the Core
		// command-palette runtime starts loading (the WP baseline
		// commands the palette lists). Fire-and-forget: the palette
		// opens immediately with the shell's own commands, and the
		// WP set pops in when the chain lands — the harvester
		// listens for `os-command-palette-ready`.
		ensureCommandPaletteAssets().catch( ( err ) => {
			// eslint-disable-next-line no-console -- a failed palette-runtime load would otherwise be silent; the palette still works with shell commands only.
			console.warn( '[openstation] command-palette runtime failed to load', err );
		} );
		this._loadPromise = loadImpl( this._scriptUrl ).then( ( factory ) => {
			const real = factory( this._config ) as LoadedAi;
			if ( this._pendingAsk ) {
				real.attachAsk( this._pendingAsk );
			}
			this._real = real;
			return real;
		} );
		return this._loadPromise;
	}

	open(): void {
		this._intendOpen = true;
		// Nothing is on screen yet: the impl bundle, its stylesheet and
		// the Core palette runtime are all still in flight on a first
		// open. Paint the placeholder in the panel's own position so
		// the keystroke visibly registers, and take it down whichever
		// way this resolves — including a failed load, where leaving a
		// spinner up forever would be the worst outcome.
		//
		// The cancel callback is what makes Escape work during that
		// window: it drops `_intendOpen`, so a panel the user has
		// already dismissed does not open behind them when the bundle
		// finally lands. Nothing else is listening for Escape yet —
		// the panel's own handler is bound to an element that does not
		// exist, and the palette cycle never listens for it.
		if ( ! this._real ) {
			showPalettePlaceholder( () => this.close() );
		}
		void this._ensure()
			.then( ( r ) => {
				hidePalettePlaceholder();
				if ( this._intendOpen ) {
					r.open();
				}
			} )
			.catch( ( err ) => {
				hidePalettePlaceholder();
				// eslint-disable-next-line no-console -- a failed impl load would otherwise leave ⌘K silently dead.
				console.warn( '[openstation] command palette failed to load', err );
			} );
	}

	close(): void {
		this._intendOpen = false;
		hidePalettePlaceholder();
		if ( this._real ) {
			this._real.close();
		}
	}

	toggle(): void {
		if ( this.isOpen ) {
			this.close();
		} else {
			this.open();
		}
	}

	get isOpen(): boolean {
		return this._real ? this._real.isOpen : this._intendOpen;
	}

	/**
	 * Late-bind the programmatic `ask` callback. Mirrors the real
	 * class's `attachAsk` signature so `desktop.ts`'s call site is
	 * identical whether it's wiring the stub or the impl.
	 */
	attachAsk( fn: AskFn ): void {
		this._pendingAsk = fn;
		if ( this._real ) {
			this._real.attachAsk( fn );
		}
	}

	/**
	 * Programmatic `ask` entry point. Forces the impl load (so the
	 * real `ask` — wired by `attachAsk` — is in place) and forwards.
	 */
	ask: AskFn = ( ( ...args: Parameters< AskFn > ) => {
		return this._ensure().then( ( r ) => r.ask( ...args ) );
	} ) as AskFn;
}
