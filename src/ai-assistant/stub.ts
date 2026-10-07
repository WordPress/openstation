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

type LoadedAi = ReturnType< AiAssistantFactory >;

function loadImpl( scriptUrl: string ): Promise< AiAssistantFactory > {
	if ( window.openStationCreateAiAssistant ) {
		return Promise.resolve( window.openStationCreateAiAssistant );
	}
	return new Promise( ( resolve, reject ) => {
		const existing = document.querySelector< HTMLScriptElement >(
			`script[data-os-ai="1"]`,
		);
		const finish = (): void => {
			const factory = window.openStationCreateAiAssistant;
			if ( ! factory ) {
				document.querySelector( 'script[data-os-ai="1"]' )?.remove();
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
		s.addEventListener( 'error', () => {
			s.remove();
			reject( new Error( 'failed to load ai-assistant bundle' ) );
		} );
		document.head.appendChild( s );
	} );
}

export class AiAssistantStub implements AiAssistantApi {
	private readonly _config: AiAssistantConfig;
	private readonly _scriptUrl: string;
	private _real: LoadedAi | null = null;
	private _loadPromise: Promise< LoadedAi > | null = null;
	private _pendingAsk: AskFn | null = null;

	private _runtime: 'idle' | 'loading' | 'ready' = 'idle';

	private _intendOpen = false;

	constructor( config: AiAssistantConfig, scriptUrl: string ) {
		this._config = config;
		this._scriptUrl = scriptUrl;
	}

	private _ensure(): Promise< LoadedAi > {
		if ( this._loadPromise ) {
			if ( this._real ) {
				this._loadPaletteRuntime( this._real );
			}
			return this._loadPromise;
		}

		ensureDeferredStyle( 'desktop-mode-ai-assistant' );
		const attempt = loadImpl( this._scriptUrl ).then( ( factory ) => {
			const real = factory( this._config );
			if ( this._pendingAsk ) {
				real.attachAsk( this._pendingAsk );
			}
			this._real = real;
			return real;
		} );
		this._loadPromise = attempt;

		attempt.catch( () => {
			if ( this._loadPromise === attempt ) {
				this._loadPromise = null;
			}
		} );

		void this._loadPromise.then(
			( real ) => this._loadPaletteRuntime( real ),

			() => undefined,
		);
		return this._loadPromise;
	}

	private _loadPaletteRuntime( real: LoadedAi ): void {
		if ( 'idle' !== this._runtime ) {
			return;
		}
		this._runtime = 'loading';
		real.setBaselineLoading( true );
		ensureCommandPaletteAssets()
			.then(
				() => {
					this._runtime = 'ready';
				},
				( err ) => {
					this._runtime = 'idle';

					console.warn( '[openstation] command-palette runtime failed to load', err );
				},
			)
			.finally( () => real.setBaselineLoading( false ) );
	}

	open(): void {
		this._intendOpen = true;

		if ( ! this._real ) {
			showPalettePlaceholder( () => this.close() );
		}
		void this._ensure()
			.then( ( r ) => {
				if ( this._intendOpen ) {
					r.open();
				}

				hidePalettePlaceholder( true );
			} )
			.catch( ( err ) => {
				this._intendOpen = false;
				hidePalettePlaceholder();

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

	attachAsk( fn: AskFn ): void {
		this._pendingAsk = fn;
		if ( this._real ) {
			this._real.attachAsk( fn );
		}
	}

	ask: AskFn = ( ( ...args: Parameters< AskFn > ) => {
		return this._ensure().then( ( r ) => r.ask( ...args ) );
	} ) as AskFn;
}
