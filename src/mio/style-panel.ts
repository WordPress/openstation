/**
 * Desktop Mode — "Make it yours": Mio's right-click menu and the
 * style panel behind it.
 *
 * Right-clicking Mio opens a one-item context menu; the item opens a
 * `<wpd-modal>` of controls bound live to `wp.desktop.mio.setStyle()`.
 * Every control writes on input, so the desk companion changes under
 * the dialog while the user drags — there is no Apply button, because
 * the thing being edited is right there and the preview *is* the
 * product.
 *
 * **Style only.** The panel exposes `appearance` and nothing else. No
 * physics: those are the site's, they interact (stiffness against
 * damping against pressure), and a user who makes Mio unstable from a
 * slider has no way to know which slider did it. Not `radius` either —
 * how big the companion is on the desk is a layout decision, not a
 * look. What is left is colour, glow, iridescence, and the proportions
 * of the ring and eyes.
 *
 * The whole module lives in the lazy Mio bundle, so a shell whose user
 * has never switched Mio on never loads a byte of it.
 *
 * **Component sourcing is split on purpose.** `wpd-context-menu` and
 * `wpd-button` already ship in the shell-overlays bundle, which the
 * shell preloads after first paint — importing them here would put a
 * second copy in every Mio download. So both entry points go through
 * `openWithShellOverlays`, and only the components shell-overlays does
 * *not* carry are imported directly. That is worth roughly half this
 * module's compiled weight.
 */

import '../ui/components/wpd-modal/wpd-modal';
import '../ui/components/wpd-section/wpd-section';
import '../ui/components/wpd-range-field/wpd-range-field';
import '../ui/components/wpd-color-field/wpd-color-field';
import '../ui/components/wpd-checkbox/wpd-checkbox';

import { openWithShellOverlays } from '../shell-overlays/loader';
import { __ } from '../i18n';
import type { MioAppearance, MioConfig } from './types';

/** The slice of `wp.desktop.mio` this panel drives. */
interface MioStyleApi {
	getConfig: () => MioConfig;
	setStyle: ( partial: Partial< MioAppearance > ) => void;
	resetStyle: () => void;
}

function api(): MioStyleApi | null {
	const mio = ( window as unknown as { wp?: { desktop?: { mio?: MioStyleApi } } } )
		.wp?.desktop?.mio;
	return mio && typeof mio.setStyle === 'function' ? mio : null;
}

/** Class on the context menu, so the open/close helpers can find it. */
const MENU_CLASS = 'desktop-mode-mio-menu';
/** Class on the modal, so a second right-click doesn't stack them. */
const PANEL_CLASS = 'desktop-mode-mio-panel';

/* -------------------------------------------------------------------
 * Colour conversion.
 *
 * The config carries packed 24-bit ints (what Pixi takes);
 * `<wpd-color-field>` speaks `#rrggbb` (what an `<input type=color>`
 * takes). Neither side should have to know about the other.
 * ---------------------------------------------------------------- */

function intToHex( value: number ): string {
	const clamped = Math.max( 0, Math.min( 0xffffff, Math.floor( value ) ) );
	return `#${ clamped.toString( 16 ).padStart( 6, '0' ) }`;
}

function hexToInt( hex: string ): number | null {
	const match = /^#?([0-9a-f]{6})$/i.exec( hex.trim() );
	return match ? Number.parseInt( match[ 1 ], 16 ) : null;
}

/* -------------------------------------------------------------------
 * Controls.
 * ---------------------------------------------------------------- */

/** One slider, bound to a numeric appearance key. */
interface SliderSpec {
	key: keyof MioAppearance;
	label: string;
	min: number;
	max: number;
	step: number;
}

function slider(
	spec: SliderSpec,
	appearance: MioAppearance,
	onChange: ( partial: Partial< MioAppearance > ) => void,
): HTMLElement {
	const el = document.createElement( 'wpd-range-field' );
	el.setAttribute( 'label', spec.label );
	el.setAttribute( 'min', String( spec.min ) );
	el.setAttribute( 'max', String( spec.max ) );
	el.setAttribute( 'step', String( spec.step ) );
	el.setAttribute( 'value', String( appearance[ spec.key ] ) );
	el.addEventListener( 'wpd-range-change', ( e: Event ) => {
		const value = ( e as CustomEvent< { value?: number } > ).detail?.value;
		if ( typeof value === 'number' && Number.isFinite( value ) ) {
			onChange( { [ spec.key ]: value } as Partial< MioAppearance > );
		}
	} );
	return el;
}

function colour(
	key: 'bodyColor' | 'eyeColor',
	label: string,
	appearance: MioAppearance,
	onChange: ( partial: Partial< MioAppearance > ) => void,
): HTMLElement {
	const el = document.createElement( 'wpd-color-field' );
	el.setAttribute( 'label', label );
	el.setAttribute( 'value', intToHex( appearance[ key ] ) );
	el.addEventListener( 'wpd-color-change', ( e: Event ) => {
		const raw = ( e as CustomEvent< { value?: string } > ).detail?.value;
		const packed = typeof raw === 'string' ? hexToInt( raw ) : null;
		if ( packed !== null ) {
			onChange( { [ key ]: packed } as Partial< MioAppearance > );
		}
	} );
	return el;
}

function toggle(
	label: string,
	checked: boolean,
	onChange: ( next: boolean ) => void,
): HTMLElement {
	const el = document.createElement( 'wpd-checkbox' );
	el.setAttribute( 'label', label );
	if ( checked ) {
		el.setAttribute( 'checked', '' );
	}
	el.addEventListener( 'wpd-checkbox-change', ( e: Event ) => {
		const detail = ( e as CustomEvent< { checked?: boolean } > ).detail;
		onChange( detail?.checked === true );
	} );
	return el;
}

function section( heading: string, children: HTMLElement[] ): HTMLElement {
	const el = document.createElement( 'wpd-section' );
	el.setAttribute( 'heading', heading );
	for ( const child of children ) {
		el.appendChild( child );
	}
	return el;
}

/* -------------------------------------------------------------------
 * The panel.
 * ---------------------------------------------------------------- */

/** Close any open style panel. */
export function closeMioStylePanel(): void {
	document
		.querySelectorAll( `.${ PANEL_CLASS }` )
		.forEach( ( el ) => el.remove() );
}

/**
 * Open the "Make it yours" panel.
 *
 * Rebuilt from the live config every time it opens, so it always
 * reflects what Mio currently looks like — including a style the user
 * set, closed the panel, and came back to.
 */
export function openMioStylePanel(): void {
	const gen = ++panelGeneration;
	openWithShellOverlays(
		() => gen === panelGeneration,
		() => openMioStylePanelImmediate(),
	);
}

/** Guards against a second open landing while the loader is in flight. */
let panelGeneration = 0;
let menuGeneration = 0;

function openMioStylePanelImmediate(): void {
	const mio = api();
	if ( ! mio ) {
		return;
	}
	closeMioStylePanel();

	const modal = document.createElement( 'wpd-modal' );
	modal.classList.add( PANEL_CLASS );
	modal.setAttribute( 'title', __( 'Make it yours' ) );
	modal.setAttribute( 'size', 'md' );
	modal.setAttribute( 'open', '' );

	const body = document.createElement( 'div' );
	const paint = (): void => {
		const appearance = mio.getConfig().appearance;
		const set = ( partial: Partial< MioAppearance > ): void =>
			mio.setStyle( partial );

		body.replaceChildren(
			section( __( 'Colour' ), [
				slider(
					{
						key: 'hueStart',
						label: __( 'Hue' ),
						min: 0,
						max: 360,
						step: 1,
					},
					appearance,
					set,
				),
				slider(
					{
						key: 'hueSpan',
						label: __( 'Hue spread' ),
						min: -360,
						max: 360,
						step: 1,
					},
					appearance,
					set,
				),
				slider(
					{
						key: 'saturation',
						label: __( 'Saturation' ),
						min: 0,
						max: 1,
						step: 0.01,
					},
					appearance,
					set,
				),
				slider(
					{
						key: 'lightness',
						label: __( 'Brightness' ),
						min: 0.15,
						max: 1,
						step: 0.01,
					},
					appearance,
					set,
				),
			] ),
			section( __( 'Ring' ), [
				slider(
					{
						key: 'outlineWidth',
						label: __( 'Thickness' ),
						min: 0.5,
						max: 24,
						step: 0.5,
					},
					appearance,
					set,
				),
				slider(
					{
						key: 'glow',
						label: __( 'Glow' ),
						min: 0,
						max: 3,
						step: 0.05,
					},
					appearance,
					set,
				),
				toggle( __( 'Soften the glow' ), appearance.glowBlur, ( next ) =>
					set( { glowBlur: next } ),
				),
			] ),
			section( __( 'Gradient' ), [
				slider(
					{
						key: 'hueAngle',
						label: __( 'Gradient angle' ),
						min: 0,
						max: 360,
						step: 1,
					},
					appearance,
					set,
				),
				toggle(
					__( 'Loop the gradient (no seam)' ),
					appearance.hueLoop,
					( next ) => set( { hueLoop: next } ),
				),
				slider(
					{
						key: 'hueSpin',
						label: __( 'Spin the gradient' ),
						min: -60,
						max: 60,
						step: 1,
					},
					appearance,
					set,
				),
				slider(
					{
						key: 'hueDrift',
						label: __( 'Cycle the colours' ),
						min: -60,
						max: 60,
						step: 1,
					},
					appearance,
					set,
				),
			] ),
			section( __( 'Hologram' ), [
				toggle(
					__( 'Holographic' ),
					appearance.iridescence > 0,
					( next ) => {
						// Coming back on lands at the strength the
						// effect was designed around; the slider below
						// is there for anyone who wants another. Repaint
						// after, or that slider keeps showing the value
						// this toggle just replaced.
						set( { iridescence: next ? 0.7 : 0 } );
						paint();
					},
				),
				slider(
					{
						key: 'iridescence',
						label: __( 'Iridescence' ),
						min: 0,
						max: 2,
						step: 0.05,
					},
					appearance,
					set,
				),
			] ),
			section( __( 'Body' ), [
				colour( 'bodyColor', __( 'Body colour' ), appearance, set ),
				slider(
					{
						key: 'bodyAlpha',
						label: __( 'Body opacity' ),
						min: 0,
						max: 1,
						step: 0.01,
					},
					appearance,
					set,
				),
			] ),
			section( __( 'Eyes' ), [
				colour( 'eyeColor', __( 'Eye colour' ), appearance, set ),
				slider(
					{
						key: 'eyeScale',
						label: __( 'Eye size' ),
						min: 0.05,
						max: 0.6,
						step: 0.01,
					},
					appearance,
					set,
				),
			] ),
		);
	};
	paint();
	modal.appendChild( body );

	// Footer. "Restore Mio" repaints the whole panel rather than just
	// resetting the config, because every control's value is now stale.
	const restore = document.createElement( 'wpd-button' );
	restore.setAttribute( 'slot', 'footer' );
	restore.setAttribute( 'variant', 'secondary' );
	restore.textContent = __( 'Restore Mio' );
	restore.addEventListener( 'click', () => {
		mio.resetStyle();
		paint();
	} );

	const done = document.createElement( 'wpd-button' );
	done.setAttribute( 'slot', 'footer' );
	done.setAttribute( 'variant', 'primary' );
	done.textContent = __( 'Done' );
	done.addEventListener( 'click', () => closeMioStylePanel() );

	modal.appendChild( restore );
	modal.appendChild( done );
	modal.addEventListener( 'wpd-modal-cancel', () => closeMioStylePanel() );

	document.body.appendChild( modal );
}

/* -------------------------------------------------------------------
 * The context menu.
 * ---------------------------------------------------------------- */

/** Close Mio's context menu, if one is open. */
export function closeMioMenu(): void {
	document.querySelectorAll( `.${ MENU_CLASS }` ).forEach( ( el ) => el.remove() );
	document.removeEventListener( 'pointerdown', onOutside, true );
	document.removeEventListener( 'keydown', onKeydown, true );
}

function onOutside( e: Event ): void {
	const target = e.target as HTMLElement | null;
	if ( ! target?.closest( `.${ MENU_CLASS }` ) ) {
		closeMioMenu();
	}
}

function onKeydown( e: KeyboardEvent ): void {
	if ( e.key === 'Escape' ) {
		closeMioMenu();
	}
}

/**
 * Open Mio's right-click menu at viewport coordinates.
 *
 * One entry for now. It is a menu rather than a straight-to-dialog
 * right-click because this is the seam where Mio's own actions will
 * accumulate, and teaching users that Mio has a context menu is worth
 * more than saving them a click.
 */
export function openMioMenu( pos: { x: number; y: number } ): void {
	closeMioMenu();
	const gen = ++menuGeneration;
	openWithShellOverlays(
		() => gen === menuGeneration,
		() => openMioMenuImmediate( pos ),
	);
}

function openMioMenuImmediate( pos: { x: number; y: number } ): void {
	const menu = document.createElement( 'wpd-context-menu' );
	menu.classList.add( MENU_CLASS );
	menu.setAttribute( 'open', '' );
	menu.style.left = `${ pos.x }px`;
	menu.style.top = `${ pos.y }px`;

	const option = document.createElement( 'wpd-context-menu-option' );
	option.setAttribute( 'value', 'make-it-yours' );
	option.setAttribute( 'icon', 'dashicons-art' );
	option.dataset.menuItemId = 'make-it-yours';
	option.textContent = __( 'Make it yours' );
	menu.appendChild( option );

	menu.addEventListener( 'wpd-context-menu-pick', () => {
		closeMioMenu();
		openMioStylePanel();
	} );

	document.body.appendChild( menu );
	document.addEventListener( 'pointerdown', onOutside, true );
	document.addEventListener( 'keydown', onKeydown, true );
}
