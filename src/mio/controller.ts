import { MioResidency } from './residency';
import type { MioWindowContext, MioWindowLease } from './assistant/types';
import { addAction, applyFilters, doAction, HOOKS } from '../hooks';
import { loadVendorScript } from '../wallpapers/vendor-loader';
import { MIO_DEFAULTS, sanitizeMioConfig } from './config';
import { emptyMioLook, sanitizeMioLook, splitMioLook } from './look';
import type {
	MioAppearance,
	MioConfig,
	MioHandle,
	MioLook,
	MioLookPhysics,
	MioMountFn,
	PartialMioConfig,
} from './types';

const POSITION_KEY = 'desktop-mode-mio-position';

export const MIO_LAYER_ID = 'os-mio';

export const MIO_TILE_ID = 'os-mio-toggle';

export { MIO_TILE_ICON } from './icon';

export interface MioControllerOptions {

	shell: HTMLElement;
	focusedWindow?: () => string | null;

	chatAvailable?: () => boolean;
	wallpaperVisible?: () => boolean;

	bundleUrl: string;

	serverConfig?: unknown;

	enabled: boolean;

	persist: ( enabled: boolean ) => void;

	savedLook?: unknown;

	persistLook?: ( look: MioLook ) => void;
}

export interface MioApi {

	registerWindow: ( windowId: string, context: MioWindowContext ) => MioWindowLease;

	getWindowId: () => string | null;

	isEnabled: () => boolean;

	enable: () => Promise< void >;

	disable: () => void;

	toggle: () => Promise< void >;

	getPosition: () => { x: number; y: number } | null;

	setPosition: ( x: number, y: number ) => void;

	getConfig: () => MioConfig;

	setConfig: ( partial: PartialMioConfig ) => void;

	setStyle: ( partial: Partial< MioAppearance & MioLookPhysics > ) => void;

	getLook: () => MioLook;

	commitStyle: () => void;

	resetStyle: () => void;
}

export class MioController {
	private options: MioControllerOptions;
	private residency: MioResidency;
	private layer: HTMLElement | null = null;
	private handle: MioHandle | null = null;
	private mounting: { generation: number; promise: Promise<void> } | null = null;

	private parked: { handle: MioHandle; layer: HTMLElement } | null = null;
	private config: MioConfig;
	private enabled: boolean;

	private saved: boolean;

	private summoned = false;

	private heldSpot: { x: number; y: number } | null = null;

	private generation = 0;
	private loading: Promise< void > | null = null;

	private look: MioLook = emptyMioLook();

	public constructor( options: MioControllerOptions ) {
		this.options = options;
		this.residency = new MioResidency( {
			shell: options.shell,
			focused: options.focusedWindow ?? ( () => null ),
			layer: () => this.layer,
			handle: () => this.handle,
			enabled: () => this.enabled,
			chatAvailable: options.chatAvailable,
			wallpaperVisible: options.wallpaperVisible,
			held: () => this.summoned,
			ready: () => this.mount(),
		} );

		addAction( 'os.mio.owner-changed', 'openstation/mio-held-spot', () => this.applyHeldSpot() );
		this.enabled = options.enabled;
		this.saved = options.enabled;

		this.look = sanitizeMioLook( options.savedLook );
		this.config = this.resolveConfig();
	}

	public boot(): void {
		if ( this.enabled ) {
			void this.mount();
		}
	}

	public setAnchor( point: { x: number; y: number } | null ): void {
		this.heldSpot = point;
		this.handle?.setAnchor?.( point, true );
	}

	public syncEnabled( enabled: boolean ): void {
		this.saved = enabled;
		void this.setEnabled( enabled || this.summoned, false );
		this.residency.refresh();
	}

	public async summon(): Promise< void > {
		this.summoned = true;

		this.handle?.setFloating?.( true );
		await this.setEnabled( true, false );

		this.residency.refresh();
	}

	public dismiss(): void {
		if ( ! this.summoned ) {
			return;
		}
		this.summoned = false;
		this.heldSpot = null;

		this.handle?.setFloating?.( false );
		void this.setEnabled( this.saved, false );

		this.residency.refresh();
	}

	public refreshWindowAvailability(): void {
		this.residency.refresh();
	}

	public api(): MioApi {
		return {
			registerWindow: ( id, context ) => this.residency.register( id, context ),
			getWindowId: () => this.residency.getWindowId(),
			isEnabled: () => this.enabled,
			enable: () => this.setEnabled( true ),
			disable: () => {
				void this.setEnabled( false );
			},
			toggle: () => this.setEnabled( ! this.enabled ),
			getPosition: () => this.handle?.getPosition() ?? null,
			setPosition: ( x: number, y: number ) => this.handle?.setPosition( x, y ),
			getConfig: () => this.config,
			setConfig: ( partial: PartialMioConfig ) => {
				this.config = sanitizeMioConfig( partial, this.config );
				this.handle?.applyConfig( this.config );
			},
			setStyle: (
				partial: Partial< MioAppearance & MioLookPhysics >,
			) => {
				const next = splitMioLook( partial );
				this.look = {
					appearance: { ...this.look.appearance, ...next.appearance },
					physics: { ...this.look.physics, ...next.physics },
				};
				this.config = sanitizeMioConfig(
					{ appearance: next.appearance, physics: next.physics },
					this.config,
				);
				this.handle?.applyConfig( this.config );
				this.commitLook();
			},
			getLook: () => ( {
				appearance: { ...this.look.appearance },
				physics: { ...this.look.physics },
			} ),
			commitStyle: () => this.commitLook(),
			resetStyle: () => {
				this.look = emptyMioLook();
				this.config = this.resolveConfig();
				this.handle?.applyConfig( this.config );
				this.commitLook();
			},
		};
	}

	public async setEnabled( next: boolean, persist = true ): Promise< void > {
		if ( next === this.enabled ) {
			if ( persist && this.summoned ) {
				this.summoned = false;
				this.handle?.setFloating?.( false );
				this.saved = next;
				this.options.persist( next );
			}
			return;
		}
		this.enabled = next;
		this.generation++;
		if ( persist ) {
			this.saved = next;
			this.summoned = false;
			this.handle?.setFloating?.( false );
			this.options.persist( next );
		}
		doAction( next ? 'os.mio.enabled' : 'os.mio.disabled', {} );

		doAction( HOOKS.DOCK_REFRESH_ACTIVE, {} );
		if ( next ) {
			await this.mount();
		} else {
			this.unmount();
		}
	}

	private resolveConfig(): MioConfig {
		const fromServer = sanitizeMioConfig(
			this.options.serverConfig,
			MIO_DEFAULTS,
		);
		const filtered = applyFilters< MioConfig, [] >(
			'os.mio.config',
			fromServer,
		);

		const resolved = sanitizeMioConfig( filtered, fromServer );
		return sanitizeMioConfig(
			{ appearance: this.look.appearance, physics: this.look.physics },
			resolved,
		);
	}

	private commitLook(): void {
		this.options.persistLook?.( {
			appearance: { ...this.look.appearance },
			physics: { ...this.look.physics },
		} );
	}

	private ensureLayer(): HTMLElement {
		if ( this.layer && this.layer.isConnected ) {
			return this.layer;
		}
		const existing = document.getElementById( MIO_LAYER_ID );
		if ( existing ) {
			this.layer = existing;
			return existing;
		}
		const el = document.createElement( 'div' );
		el.id = MIO_LAYER_ID;
		el.className = 'os-mio';
		el.dataset.mioVisible = String( this.options.wallpaperVisible?.() ?? true );

		el.setAttribute( 'aria-hidden', 'true' );
		this.options.shell.appendChild( el );
		this.layer = el;
		return el;
	}

	private mount(): Promise<void> {
		if ( this.mounting?.generation === this.generation ) {
			return this.mounting.promise;
		}
		const promise = this.mountInstance().finally( () => {
			if ( this.mounting?.promise === promise ) {
				this.mounting = null;
			}
		} );
		this.mounting = { generation: this.generation, promise };
		return promise;
	}

	private async mountInstance(): Promise< void > {
		const generation = this.generation;
		if ( this.handle ) {
			return;
		}

		const parked = this.parked;
		if ( parked ) {
			this.parked = null;
			parked.layer.style.removeProperty( 'display' );
			parked.handle.applyConfig( this.config );
			parked.handle.setAnimating( true );
			this.handle = parked.handle;
			this.layer = parked.layer;
			this.residency.refresh();
			this.applyHeldSpot();
			return;
		}
		try {
			await this.loadBundle();
		} catch ( err ) {
			console.warn( '[desktop-mode/mio] bundle failed to load.', err );
			return;
		}
		if ( generation !== this.generation || ! this.enabled ) {
			return;
		}
		const mount: MioMountFn | undefined = window.openStationMountMio;
		if ( typeof mount !== 'function' ) {
			console.warn(
				'[desktop-mode/mio] bundle loaded but did not publish window.openStationMountMio.',
			);
			return;
		}
		const handle = await mount( {
			host: this.ensureLayer(),
			config: this.config,
			position: readPosition(),
			savePosition: ( pos ) => {
				if ( ! this.residency.getWindowId() ) {
					writePosition( pos );
				}
			},
		} );
		if ( ! handle ) {
			this.layer?.remove();
			this.layer = null;
			return;
		}

		if ( generation !== this.generation || ! this.enabled ) {
			const layer = this.layer;
			this.layer = null;
			handle.setAnimating( false );
			if ( layer ) {
				layer.style.display = 'none';
				this.parked = { handle, layer };
			} else {
				handle.destroy();
			}
			return;
		}
		this.handle = handle;
		this.residency.refresh();
		this.applyHeldSpot();
	}

	private applyHeldSpot(): void {
		this.handle?.setFloating?.( this.summoned );
		if ( this.summoned && this.heldSpot ) {
			this.handle?.setAnchor?.( this.heldSpot, true );
		}
	}

	private unmount(): void {
		const wasResident = this.residency.getWindowId() !== null;
		this.residency.closeChat();
		const handle = this.handle;
		const layer = this.layer;
		this.handle = null;
		this.layer = null;
		this.residency.refresh();
		if ( ! handle || ! layer ) {
			layer?.remove();
			return;
		}
		const resting = handle.getPosition();
		if ( resting && ! wasResident ) {
			writePosition( resting );
		}
		handle.setAnimating( false );
		layer.style.display = 'none';
		this.parked = { handle, layer };
	}

	private loadBundle(): Promise< void > {
		if ( typeof window.openStationMountMio === 'function' ) {
			return Promise.resolve();
		}
		if ( ! this.loading ) {
			if ( ! this.options.bundleUrl ) {
				return Promise.reject(
					new Error( 'No Mio bundle URL in the shell config.' ),
				);
			}
			this.loading = loadVendorScript( this.options.bundleUrl ).catch(
				( err ) => {
					this.loading = null;
					throw err;
				},
			);
		}
		return this.loading;
	}
}

function readPosition(): { x: number; y: number } | null {
	try {
		const raw = window.localStorage.getItem( POSITION_KEY );
		if ( ! raw ) {
			return null;
		}
		const parsed = JSON.parse( raw ) as { x?: unknown; y?: unknown };
		if (
			typeof parsed?.x !== 'number' ||
			typeof parsed?.y !== 'number' ||
			! Number.isFinite( parsed.x ) ||
			! Number.isFinite( parsed.y )
		) {
			return null;
		}
		return { x: parsed.x, y: parsed.y };
	} catch {
		return null;
	}
}

function writePosition( pos: { x: number; y: number } ): void {
	try {
		window.localStorage.setItem( POSITION_KEY, JSON.stringify( pos ) );
	} catch {

	}
}
