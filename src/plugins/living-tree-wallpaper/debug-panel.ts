/**
 * The Living Tree — hidden DNA tuner (developer mode only).
 *
 * Click the trunk 20 times (with developer mode ON in OS Settings →
 * Features) and a slider panel opens for every snapshot metric — posts,
 * pages, terms, comments, age, traffic, presence, health — regrowing the
 * tree instantly on every drag. Purely a client-side debugging lens: it
 * never writes anything, never touches the server snapshot, and closes
 * back to the real DNA.
 *
 * The panel is bespoke DOM with raw `<input type="range">` on purpose:
 * the `<wpd-*>` field components live in the lazily-loaded OS Settings
 * bundle and aren't guaranteed upgraded inside a wallpaper's document
 * context — a dev tool must not depend on another bundle having loaded.
 *
 * @since 0.9.4
 */

import { buildHormones } from './dna';
import type { Envelope, TreeSnapshot } from './types';

/** Trunk clicks required to open the tuner. */
export const TUNER_CLICK_THRESHOLD = 20;

/** Max gap between consecutive trunk clicks before the count resets. */
export const TUNER_CLICK_WINDOW_MS = 2500;

/** Snapshot fields the tuner exposes. */
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

/**
 * Whether the OS Settings developer-mode toggle is on. Read live on
 * every trunk click so flipping the toggle needs no wallpaper remount.
 */
export function isDeveloperModeEnabled(): boolean {
	const api = window.wp?.desktop as
		| { getOsSettings?: () => { developerModeEnabled?: boolean } }
		| undefined;
	try {
		return api?.getOsSettings?.().developerModeEnabled === true;
	} catch {
		return false;
	}
}

/**
 * Consecutive-click counter with a per-gap timeout. `hit()` returns true
 * exactly on the threshold-th click of an unbroken run.
 *
 * @param threshold Clicks required.
 * @param windowMs  Max gap between clicks before the run resets.
 */
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

/**
 * Whether a point (in tree reference space — root at origin, up = -y)
 * lands on the trunk column.
 *
 * @param lx  Reference-space x.
 * @param ly  Reference-space y.
 * @param env The active envelope (trunk girth + height).
 */
export function isTrunkHit( lx: number, ly: number, env: Envelope ): boolean {
	const halfWidth = Math.max( 16, env.trunkBaseGirth * 3 );
	return Math.abs( lx ) <= halfWidth && ly <= 6 && ly >= -env.heightMax * 0.55;
}

function formatValue( def: SliderDef, value: number ): string {
	return def.step < 1 ? value.toFixed( 2 ) : String( Math.round( value ) );
}

function hormoneLine( snapshot: TreeSnapshot ): string {
	const h = buildHormones( snapshot );
	const f = ( v: number ): string => v.toFixed( 2 );
	return (
		`age ${ f( h.age01 ) } · vigor ${ f( h.vigor01 ) } · foliage ${ f( h.foliage01 ) } · ` +
		`health ${ f( h.health01 ) } · div ${ f( h.diversity01 ) } · bloom ${ f( h.bloom01 ) } · ` +
		`struct ${ f( h.structure01 ) } · vitality ${ f( h.vitality01 ) } · ` +
		`wind ${ f( h.wind01 ) } · spark ${ h.spark }`
	);
}

export interface DebugPanelOptions {
	/** The DNA currently rendered — seeds the sliders. */
	snapshot: TreeSnapshot;
	/** Fired (debounced) with a fresh snapshot on every slider move. */
	onChange: ( next: TreeSnapshot ) => void;
	/** Fired when the user closes the panel via its own button. */
	onClose: () => void;
}

/**
 * Open the tuner panel. Returns a disposer (used by scene teardown); the
 * panel's close button also calls `onClose` after disposing itself.
 *
 * The panel mounts on `document.body`, NOT inside the wallpaper layer:
 * the wallpaper sits at the very bottom of the shell's stack under the
 * desktop-icons/files layers, so anything inside it is visible but never
 * hit-testable. `position:fixed` + a debug-grade z-index float the panel
 * above the whole shell — it's a dev tool; sitting over windows is fine.
 */
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
