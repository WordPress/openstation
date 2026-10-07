import { buildHormones } from './dna';
import { currentHour } from './sky';
import type { Envelope, TreeSnapshot } from './types';

export const TUNER_CLICK_THRESHOLD = 20;

export const TUNER_CLICK_WINDOW_MS = 2500;

export type TunerKey =
	| 'siteAgeDays'
	| 'totalPosts'
	| 'totalPages'
	| 'totalCategories'
	| 'totalTags'
	| 'totalComments'
	| 'activeUsers'
	| 'traffic'
	| 'seoHealth'
	| 'performance';

export interface SliderDef {
	key: TunerKey;
	label: string;
	min: number;
	max: number;
	step: number;
}

export const SLIDER_DEFS: SliderDef[] = [
	{ key: 'siteAgeDays', label: 'Site age (days)', min: 0, max: 7300, step: 1 },
	{ key: 'totalPosts', label: 'Posts', min: 0, max: 3000, step: 1 },
	{ key: 'totalPages', label: 'Pages', min: 0, max: 300, step: 1 },
	{ key: 'totalCategories', label: 'Categories', min: 0, max: 300, step: 1 },
	{ key: 'totalTags', label: 'Tags', min: 0, max: 800, step: 1 },
	{ key: 'totalComments', label: 'Comments', min: 0, max: 8000, step: 1 },
	{ key: 'activeUsers', label: 'Online users', min: 0, max: 40, step: 1 },
	{ key: 'traffic', label: 'Traffic (views)', min: 0, max: 20000, step: 50 },
	{ key: 'seoHealth', label: 'SEO health', min: 0, max: 1, step: 0.01 },
	{ key: 'performance', label: 'Performance', min: 0, max: 1, step: 0.01 },
];

export function isDeveloperModeEnabled(): boolean {
	const api = window.wp?.os as
		| { getOsSettings?: () => { developerModeEnabled?: boolean } }
		| undefined;
	try {
		return api?.getOsSettings?.().developerModeEnabled === true;
	} catch {
		return false;
	}
}

export function createClickCounter(
	threshold: number,
	windowMs: number,
): { hit( now: number ): boolean; reset(): void } {
	let count = 0;
	let last = 0;
	return {
		hit( now: number ): boolean {
			if ( now - last > windowMs ) {
				count = 0;
			}
			last = now;
			count++;
			if ( count >= threshold ) {
				count = 0;
				return true;
			}
			return false;
		},
		reset(): void {
			count = 0;
		},
	};
}

export function isTrunkHit( lx: number, ly: number, env: Envelope ): boolean {
	const halfWidth = Math.max( 16, env.trunkBaseGirth * 3 );
	return Math.abs( lx ) <= halfWidth && ly <= 6 && ly >= -env.heightMax * 0.55;
}

export interface TrunkClickGestureOptions {

	isEnabled: () => boolean;

	toLocal: ( clientX: number, clientY: number ) => { lx: number; ly: number };

	isHit: ( lx: number, ly: number ) => boolean;

	onTrigger: () => void;

	now?: () => number;
}

export function createTrunkClickGesture(
	opts: TrunkClickGestureOptions,
): ( event: { clientX: number; clientY: number } ) => void {
	const counter = createClickCounter( TUNER_CLICK_THRESHOLD, TUNER_CLICK_WINDOW_MS );
	const now = opts.now ?? Date.now;
	return ( event ) => {
		if ( ! opts.isEnabled() ) {
			return;
		}
		const { lx, ly } = opts.toLocal( event.clientX, event.clientY );
		if ( ! opts.isHit( lx, ly ) ) {
			counter.reset();
			return;
		}
		if ( counter.hit( now() ) ) {
			opts.onTrigger();
		}
	};
}

function formatValue( def: SliderDef, value: number ): string {
	return def.step < 1 ? value.toFixed( 2 ) : String( Math.round( value ) );
}

function hormoneLine( snapshot: TreeSnapshot ): string {
	const h = buildHormones( snapshot );
	const f = ( v: number ): string => v.toFixed( 2 );
	return (
		`age ${ f( h.age01 ) } · vigor ${ f( h.vigor01 ) } · foliage ${ f( h.foliage01 ) } · ` +
		`health ${ f( h.health01 ) } · bloom ${ f( h.bloom01 ) } · ` +
		`struct ${ f( h.structure01 ) } · vitality ${ f( h.vitality01 ) } · ` +
		`wind ${ f( h.wind01 ) } · spark ${ h.spark }`
	);
}

export interface DebugPanelOptions {

	snapshot: TreeSnapshot;

	onChange: ( next: TreeSnapshot ) => void;

	onClose: () => void;

	hour?: number;

	onHourChange?: ( hour: number | null ) => void;
}

function formatHour( hours: number ): string {
	const h = Math.floor( hours );
	const m = Math.round( ( hours - h ) * 60 );
	const hh = String( ( h + Math.floor( m / 60 ) ) % 24 ).padStart( 2, '0' );
	const mm = String( m % 60 ).padStart( 2, '0' );
	return `${ hh }:${ mm }`;
}

export function openDebugPanel( opts: DebugPanelOptions ): () => void {
	const state: TreeSnapshot = { ...opts.snapshot };
	let pending: ReturnType< typeof setTimeout > | null = null;

	const panel = document.createElement( 'div' );
	panel.dataset.livingTreeTuner = '1';
	panel.style.cssText = [
		'position:fixed',
		'top:48px',
		'right:18px',
		'width:300px',
		'max-height:calc(100vh - 72px)',
		'overflow-y:auto',
		'box-sizing:border-box',
		'padding:14px 16px 16px',
		'background:rgba(13, 17, 26, 0.85)',
		'backdrop-filter:blur(14px)',
		'border:1px solid rgba(255, 255, 255, 0.14)',
		'border-radius:14px',
		'box-shadow:0 12px 40px rgba(0, 0, 0, 0.45)',
		'color:#e8ecf3',
		'font:12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
		'pointer-events:auto',
		'z-index:2147483000',
	].join( ';' );

	const header = document.createElement( 'div' );
	header.style.cssText =
		'display:flex;align-items:center;justify-content:space-between;margin-bottom:2px';
	const title = document.createElement( 'strong' );
	title.textContent = '🌳 Living Tree — DNA tuner';
	title.style.cssText = 'font-size:13px';
	const closeButton = document.createElement( 'button' );
	closeButton.type = 'button';
	closeButton.textContent = '✕';
	closeButton.setAttribute( 'aria-label', 'Close DNA tuner' );
	closeButton.style.cssText =
		'background:none;border:0;color:#9aa3b2;cursor:pointer;font-size:14px;padding:2px 4px';
	header.appendChild( title );
	header.appendChild( closeButton );
	panel.appendChild( header );

	const note = document.createElement( 'div' );
	note.textContent = 'Debug preview only — nothing is saved.';
	note.style.cssText = 'color:#9aa3b2;margin-bottom:8px';
	panel.appendChild( note );

	const hormones = document.createElement( 'div' );
	hormones.style.cssText =
		'font-family:ui-monospace, Menlo, monospace;font-size:10.5px;color:#8fd3a8;' +
		'margin-bottom:10px;word-break:break-word';
	hormones.textContent = hormoneLine( state );
	panel.appendChild( hormones );

	if ( opts.onHourChange ) {
		const onHourChange = opts.onHourChange;
		const row = document.createElement( 'label' );
		row.style.cssText =
			'display:block;margin-bottom:10px;padding-bottom:10px;' +
			'border-bottom:1px solid rgba(255, 255, 255, 0.1)';
		const caption = document.createElement( 'div' );
		caption.style.cssText = 'display:flex;justify-content:space-between;align-items:center';
		const name = document.createElement( 'span' );
		name.textContent = 'Time of day';
		const right = document.createElement( 'span' );
		right.style.cssText = 'display:flex;align-items:center;gap:6px';
		const value = document.createElement( 'span' );
		value.style.cssText = 'color:#9aa3b2;font-variant-numeric:tabular-nums';
		const liveButton = document.createElement( 'button' );
		liveButton.type = 'button';
		liveButton.textContent = 'live';
		liveButton.setAttribute( 'aria-label', 'Follow the real clock again' );
		liveButton.style.cssText =
			'background:rgba(255, 255, 255, 0.1);border:1px solid rgba(255, 255, 255, 0.2);' +
			'border-radius:6px;color:#cfd6e0;cursor:pointer;font-size:10px;padding:1px 7px';
		right.appendChild( value );
		right.appendChild( liveButton );
		caption.appendChild( name );
		caption.appendChild( right );

		const input = document.createElement( 'input' );
		input.type = 'range';
		input.min = '0';
		input.max = '24';
		input.step = '0.05';
		input.dataset.livingTreeHour = '1';
		input.value = String( opts.hour ?? 12 );
		value.textContent = formatHour( Number( input.value ) );
		input.style.cssText = 'width:100%;margin:2px 0 0;accent-color:#e8c56f';
		input.addEventListener( 'input', () => {
			value.textContent = formatHour( Number( input.value ) );
			onHourChange( Number( input.value ) );
		} );
		liveButton.addEventListener( 'click', () => {
			onHourChange( null );
			input.value = String( currentHour() );
			value.textContent = formatHour( Number( input.value ) );
		} );

		row.appendChild( caption );
		row.appendChild( input );
		panel.appendChild( row );
	}

	const schedule = (): void => {
		if ( pending !== null ) {
			clearTimeout( pending );
		}
		pending = setTimeout( () => {
			pending = null;
			hormones.textContent = hormoneLine( state );
			opts.onChange( { ...state } );
		}, 60 );
	};

	for ( const def of SLIDER_DEFS ) {
		const row = document.createElement( 'label' );
		row.style.cssText = 'display:block;margin-bottom:8px';
		const caption = document.createElement( 'div' );
		caption.style.cssText = 'display:flex;justify-content:space-between';
		const name = document.createElement( 'span' );
		name.textContent = def.label;
		const value = document.createElement( 'span' );
		value.style.cssText = 'color:#9aa3b2;font-variant-numeric:tabular-nums';
		value.textContent = formatValue( def, state[ def.key ] );
		caption.appendChild( name );
		caption.appendChild( value );

		const input = document.createElement( 'input' );
		input.type = 'range';
		input.min = String( def.min );
		input.max = String( def.max );
		input.step = String( def.step );
		input.value = String( state[ def.key ] );
		input.style.cssText = 'width:100%;margin:2px 0 0;accent-color:#6fbf8f';
		input.addEventListener( 'input', () => {
			state[ def.key ] = Number( input.value );
			value.textContent = formatValue( def, state[ def.key ] );
			schedule();
		} );

		row.appendChild( caption );
		row.appendChild( input );
		panel.appendChild( row );
	}

	const dispose = (): void => {
		if ( pending !== null ) {
			clearTimeout( pending );
			pending = null;
		}
		panel.remove();
	};
	closeButton.addEventListener( 'click', () => {
		dispose();
		opts.onClose();
	} );

	document.body.appendChild( panel );
	return dispose;
}
