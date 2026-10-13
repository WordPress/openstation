/**
 * Pulse Monitor — the settings form.
 *
 * One form, two doors: the wallpaper's "Wallpaper settings" dialog in
 * OS Settings (`renderConfig`), and the widget's gear button. Each
 * edits its own settings — the wallpaper's `wp-pulse` bag, the widget's
 * per-widget store — through `ctx.setSettings`; `ctx.face: 'widget'`
 * leaves out the wallpaper-only layout.
 */

import { __ } from '../../i18n';
import '../../ui/components/os-range-field/os-range-field';
import '../../ui/components/os-color-field/os-color-field';
import '../../ui/components/os-button/os-button';
import '../../ui/components/os-switch/os-switch';
import '../../ui/components/os-segmented/os-segmented';
import {
	PULSE_DEFAULTS,
	PULSE_LIMITS,
	sanitizePulseSettings,
	serializeMuted,
	type PulseSettings,
} from './settings';
import { openIssues } from './issues';
import { SOURCE_IDS, sourceCatalog, type SourceId } from './sources';

/** What the form needs: the current values and a way to write. */
export interface PulseConfigContext {
	settings: Record< string, unknown >;
	setSettings( partial: Record< string, string | number | boolean > ): void;
	/** Which face the form edits; the widget has no wallpaper layout. Default `wallpaper`. */
	face?: 'wallpaper' | 'widget';
}

// Colours come from the surface's tokens (`<os-modal>` and OS Settings
// both set `--os-ui-fg` / `--os-ui-fg-muted`). Never inherit: wp-admin's
// `h1–h6 { color: #1d2327 }` would win and paint the headings near-black
// on a dark dialog.
function heading( text: string ): HTMLElement {
	const el = document.createElement( 'h3' );
	el.textContent = text;
	el.style.margin = '12px 0 0';
	el.style.font = 'inherit';
	el.style.fontWeight = '600';
	el.style.color = 'var( --os-ui-fg, currentColor )';
	return el;
}

function note( text: string ): HTMLElement {
	const el = document.createElement( 'p' );
	el.textContent = text;
	el.style.margin = '0';
	el.style.color = 'var( --os-ui-fg-muted, currentColor )';
	el.style.fontSize = '12px';
	return el;
}

function rangeField(
	label: string,
	limits: { min: number; max: number },
	step: number,
	value: number,
	onChange: ( next: number ) => void,
): HTMLElement {
	const field = document.createElement( 'os-range-field' );
	field.setAttribute( 'label', label );
	field.setAttribute( 'min', String( limits.min ) );
	field.setAttribute( 'max', String( limits.max ) );
	field.setAttribute( 'step', String( step ) );
	field.setAttribute( 'value', String( value ) );
	field.addEventListener( 'os-range-change', ( e: Event ) => {
		onChange( ( e as CustomEvent< { value: number } > ).detail.value );
	} );
	return field;
}

function colorField( label: string, value: string, onChange: ( next: string ) => void ): HTMLElement {
	const field = document.createElement( 'os-color-field' );
	field.setAttribute( 'label', label );
	field.setAttribute( 'value', value );
	field.addEventListener( 'os-color-change', ( e: Event ) => {
		onChange( ( e as CustomEvent< { value: string } > ).detail.value );
	} );
	return field;
}

function switchField(
	label: string,
	checked: boolean,
	onChange: ( next: boolean ) => void,
	description = '',
): HTMLElement {
	const field = document.createElement( 'os-switch' );
	field.setAttribute( 'label', label );
	field.setAttribute( 'block', '' );
	field.setAttribute( 'size', 'sm' );
	field.setAttribute( 'tone', 'accent' );
	if ( description ) {
		field.setAttribute( 'description', description );
	}
	if ( checked ) {
		field.setAttribute( 'checked', '' );
	}
	field.addEventListener( 'os-switch-change', ( e: Event ) => {
		onChange( ( e as CustomEvent< { checked: boolean } > ).detail.checked );
	} );
	return field;
}

function segmentedField(
	label: string,
	value: string,
	options: Array< [ string, string ] >,
	onChange: ( next: string ) => void,
): HTMLElement {
	const field = document.createElement( 'os-segmented' );
	field.setAttribute( 'label', label );
	field.setAttribute( 'value', value );
	for ( const [ optionValue, optionLabel ] of options ) {
		const option = document.createElement( 'os-segment' );
		option.setAttribute( 'value', optionValue );
		option.textContent = optionLabel;
		field.appendChild( option );
	}
	field.addEventListener( 'os-pick', ( e: Event ) => {
		onChange( ( e as CustomEvent< { value: string } > ).detail.value );
	} );
	return field;
}

/**
 * The settings form. Every control writes through `ctx.setSettings`
 * immediately and every mounted monitor live-applies, so the form
 * doubles as a tuning panel. Rebuilt in place on reset. Returns its
 * teardown (listeners die with the DOM, so it has nothing to do).
 */
export function renderPulseConfig( container: HTMLElement, ctx: PulseConfigContext ): () => void {
	let current = sanitizePulseSettings( ctx.settings );

	const set = ( partial: Partial< PulseSettings > ): void => {
		current = { ...current, ...partial };
		const { muted, ...scalars } = partial;
		ctx.setSettings( {
			...( scalars as Record< string, string | number | boolean > ),
			...( muted ? { muted: serializeMuted( muted ) } : {} ),
		} );
	};

	const build = (): void => {
		container.replaceChildren();
		const add = ( ...els: HTMLElement[] ): void => {
			for ( const el of els ) {
				container.appendChild( el );
			}
		};

		const issues = document.createElement( 'os-button' );
		issues.setAttribute( 'variant', 'secondary' );
		issues.style.alignSelf = 'flex-start';
		issues.textContent = __( 'Explore issues…' );
		issues.addEventListener( 'click', openIssues );
		add(
			issues,
			note( __( 'What is holding the health score down, and every failed request, error and timeout with its URL and window.' ) ),
		);

		if ( ctx.face !== 'widget' ) {
			add( heading( __( 'Wallpaper layout' ) ) );
			add(
				segmentedField( __( 'Trace area' ), current.layout, [
					[ 'full', __( 'Whole wallpaper' ) ],
					[ 'band', __( 'Reserved top band' ) ],
				], ( v ) => set( { layout: v === 'band' ? 'band' : 'full' } ) ),
				rangeField( __( 'Band height' ), PULSE_LIMITS.bandHeight, 4, current.bandHeight, ( v ) => set( { bandHeight: Math.round( v ) } ) ),
				note( __( 'A reserved band is kept for the trace and its numbers: windows, icons and widgets stay below it, even when moved by hand, and clicking the numbers opens the issues. Not used on phones.' ) ),
			);
		}

		add( heading( __( 'Monitor' ) ) );
		add(
			segmentedField( __( 'Trace' ), current.style, [
				[ 'sweep', __( 'Sweep' ) ],
				[ 'scroll', __( 'Scroll' ) ],
			], ( v ) => set( { style: v === 'scroll' ? 'scroll' : 'sweep' } ) ),
			colorField( __( 'Line color' ), current.lineColor, ( v ) => set( { lineColor: sanitizePulseSettings( { lineColor: v } ).lineColor } ) ),
			colorField( __( 'Background color' ), current.background, ( v ) => set( { background: sanitizePulseSettings( { background: v } ).background } ) ),
			colorField( __( 'Failed beat color' ), current.errorColor, ( v ) => set( { errorColor: sanitizePulseSettings( { errorColor: v } ).errorColor } ) ),
			note( __( 'Beats in this colour failed, and their label says why: a status ("request · 404"), an error message, or — when the site’s health changes the rhythm — the rhythm and its cause ("PVC: slow responses").' ) ),
			rangeField( __( 'Speed' ), PULSE_LIMITS.speed, 10, current.speed, ( v ) => set( { speed: v } ) ),
			rangeField( __( 'Intensity' ), PULSE_LIMITS.intensity, 0.05, current.intensity, ( v ) => set( { intensity: v } ) ),
			rangeField( __( 'Line width' ), PULSE_LIMITS.lineWidth, 0.5, current.lineWidth, ( v ) => set( { lineWidth: v } ) ),
			rangeField( __( 'Glow' ), PULSE_LIMITS.glow, 0.05, current.glow, ( v ) => set( { glow: v } ) ),
			rangeField( __( 'Line height' ), PULSE_LIMITS.baseline, 1, current.baseline, ( v ) => set( { baseline: v } ) ),
			rangeField( __( 'Echo lines' ), PULSE_LIMITS.echoes, 1, current.echoes, ( v ) => set( { echoes: Math.round( v ) } ) ),
			switchField( __( 'ECG paper grid' ), current.grid, ( v ) => set( { grid: v } ) ),
			switchField( __( 'Numbers (requests/min, ping, errors, visits/min)' ), current.readout, ( v ) => set( { readout: v } ) ),
			switchField( __( 'Name each spike (request, visit, comment…)' ), current.labels, ( v ) => set( { labels: v } ) ),
			switchField( __( 'Beep on every beat' ), current.sound, ( v ) => set( { sound: v } ), __( 'Also sounds the alarm when the site flatlines.' ) ),
		);

		add( heading( __( 'Rhythm' ) ) );
		add(
			rangeField( __( 'Resting heart rate (0 = flatline when quiet)' ), PULSE_LIMITS.restingBpm, 1, current.restingBpm, ( v ) => set( { restingBpm: Math.round( v ) } ) ),
			switchField(
				__( 'Diagnose site health' ),
				current.diagnose,
				( v ) => set( { diagnose: v } ),
				__( 'Failed requests, slow responses, JavaScript errors, Site Health issues and overdue cron change the rhythm: PVCs, fibrillation, tachycardia, flatline.' ),
			),
		);

		const catalog = sourceCatalog();
		const sourceSwitches = ( group: 'client' | 'server' ): HTMLElement[] =>
			catalog
				.filter( ( s ) => s.group === group )
				.map( ( s ) =>
					switchField( s.label, ! current.muted.includes( s.id as SourceId ), ( on ) => {
						const next = new Set( current.muted );
						if ( on ) {
							next.delete( s.id as SourceId );
						} else {
							next.add( s.id as SourceId );
						}
						set( { muted: SOURCE_IDS.filter( ( id ) => next.has( id ) ) } );
					} ),
				);

		add( heading( __( 'Listening to — this browser' ) ) );
		add( ...sourceSwitches( 'client' ) );
		add( heading( __( 'Listening to — the whole site' ) ) );
		add(
			note( __( 'Relayed over Heartbeat, so they arrive in batches and replay at their real spacing. Administrators only.' ) ),
			...sourceSwitches( 'server' ),
		);

		const reset = document.createElement( 'os-button' );
		reset.setAttribute( 'variant', 'ghost' );
		reset.style.alignSelf = 'flex-start';
		reset.style.marginTop = '8px';
		reset.textContent = __( 'Reset to defaults' );
		reset.addEventListener( 'click', () => {
			set( { ...PULSE_DEFAULTS } );
			build();
		} );
		add( reset );
	};

	build();
	return () => undefined;
}

