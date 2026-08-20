/**
 * OpenStation — "Make it yours": Mio's right-click menu and the
 * style panel behind it.
 *
 * Right-clicking Mio opens a one-item context menu; the item opens a
 * `<os-modal>` of controls bound live to `wp.os.mio.setStyle()`.
 * Every control writes on input, so the desk companion changes under
 * the dialog while the user drags — there is no Apply button, because
 * the thing being edited is right there and the preview *is* the
 * product.
 *
 * **Look only.** The panel exposes `appearance` plus the five *shape*
 * keys, and nothing else. No stiffnesses, no damping, no pressure:
 * those are the site's, they interact, and a user who makes Mio
 * unstable from a slider has no way to know which slider did it. A
 * silhouette cannot destabilise anything — it is a rest length the
 * same springs already chase — so it belongs with the colours. Not
 * `radius` either: how big the companion is on the desk is a layout
 * decision, not a look.
 *
 * **Where it is saved.** In the user's account, not this browser.
 * Every control writes through `setStyle` / `setShape`, which record
 * the change in the OS Settings blob on its way to user meta, and
 * closing the panel commits once more — so a Mio built on a laptop is
 * waiting on the phone.
 *
 * The whole module lives in the lazy Mio bundle, so a shell whose user
 * has never switched Mio on never loads a byte of it.
 *
 * **Component sourcing is split on purpose.** `os-context-menu` and
 * `os-button` already ship in the shell-overlays bundle, which the
 * shell preloads after first paint — importing them here would put a
 * second copy in every Mio download. So both entry points go through
 * `openWithShellOverlays`, and only the components shell-overlays does
 * *not* carry are imported directly. That is worth roughly half this
 * module's compiled weight.
 */

import '../ui/components/os-modal/os-modal';
import '../ui/components/os-section/os-section';
import '../ui/components/os-range-field/os-range-field';
import '../ui/components/os-color-field/os-color-field';
import '../ui/components/os-checkbox/os-checkbox';

import { openWithShellOverlays } from '../shell-overlays/loader';
import { __ } from '../i18n';
import { MIO_DEFAULTS } from './config';
import { randomMioLook } from './randomize';
import type {
	MioAppearance,
	MioConfig,
	MioLookPhysics,
	MioPhysics,
	MioShapePreset,
} from './types';

/** The slice of `wp.os.mio` this panel drives. */
interface MioStyleApi {
	getConfig: () => MioConfig;
	setStyle: ( partial: Partial< MioAppearance & MioLookPhysics > ) => void;
	commitStyle: () => void;
	resetStyle: () => void;
}

function api(): MioStyleApi | null {
	const mio = ( window as unknown as { wp?: { os?: { mio?: MioStyleApi } } } )
		.wp?.os?.mio;
	return mio &&
		typeof mio.setStyle === 'function' &&
		typeof mio.commitStyle === 'function'
		? mio
		: null;
}

/** Class on the context menu, so the open/close helpers can find it. */
const MENU_CLASS = 'os-mio-menu';
/** Class on the modal, so a second right-click doesn't stack them. */
const PANEL_CLASS = 'os-mio-panel';

/* -------------------------------------------------------------------
 * Colour conversion.
 *
 * The config carries packed 24-bit ints (what Pixi takes);
 * `<os-color-field>` speaks `#rrggbb` (what an `<input type=color>`
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

/** Everything the panel is allowed to write, in one flat bag. */
type LookPartial = Partial< MioAppearance & MioLookPhysics >;

/** The live values behind those keys, read straight off the config. */
type LookValues = MioAppearance & MioPhysics;

/** One slider, bound to a numeric key of the look. */
interface SliderSpec {
	key: keyof MioAppearance | keyof MioLookPhysics;
	label: string;
	min: number;
	max: number;
	step: number;
}

/**
 * Decimal places every readout in this panel shows.
 *
 * Fixed rather than derived from each slider's own step, so the column
 * of numbers down the right-hand side lines up instead of ragging in
 * and out as the values change. `<os-range-field>` sizes the box from
 * the range, so nothing shifts while dragging either.
 */
const READOUT_DECIMALS = '2';

function slider(
	spec: SliderSpec,
	values: LookValues,
	onChange: ( partial: LookPartial ) => void,
): HTMLElement {
	const el = document.createElement( 'os-range-field' );
	el.setAttribute( 'label', spec.label );
	el.setAttribute( 'min', String( spec.min ) );
	el.setAttribute( 'max', String( spec.max ) );
	el.setAttribute( 'step', String( spec.step ) );
	el.setAttribute( 'decimals', READOUT_DECIMALS );
	el.setAttribute( 'value', String( values[ spec.key ] ) );
	el.addEventListener( 'os-range-change', ( e: Event ) => {
		const value = ( e as CustomEvent< { value?: number } > ).detail?.value;
		if ( typeof value === 'number' && Number.isFinite( value ) ) {
			onChange( { [ spec.key ]: value } as LookPartial );
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
	const el = document.createElement( 'os-color-field' );
	el.setAttribute( 'label', label );
	el.setAttribute( 'value', intToHex( appearance[ key ] ) );
	el.addEventListener( 'os-color-change', ( e: Event ) => {
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
	const el = document.createElement( 'os-checkbox' );
	el.setAttribute( 'label', label );
	// `block`, because every other control in this panel is a
	// block-level row. A shrink-to-fit checkbox between two sliders
	// stops short of the panel edge for no reason the user can see.
	el.setAttribute( 'block', '' );
	if ( checked ) {
		el.setAttribute( 'checked', '' );
	}
	el.addEventListener( 'os-checkbox-change', ( e: Event ) => {
		const detail = ( e as CustomEvent< { checked?: boolean } > ).detail;
		onChange( detail?.checked === true );
	} );
	return el;
}

/**
 * The silhouettes offered in the picker, in the order they appear.
 *
 * Round things first, then the figurative ones, then the parametric
 * escape hatch — a list someone scans top to bottom rather than an
 * alphabetical one they have to read.
 *
 * Labels are built lazily inside a function because `__()` needs the
 * translations to have loaded, and this module is imported at bundle
 * evaluation time.
 */
function shapeOptions(): { value: MioShapePreset; label: string }[] {
	return [
		{ value: 'blob', label: __( 'Blob' ) },
		{ value: 'circle', label: __( 'Circle' ) },
		{ value: 'potato', label: __( 'Potato' ) },
		{ value: 'ghost', label: __( 'Ghost' ) },
		{ value: 'star', label: __( 'Star' ) },
		{ value: 'flower', label: __( 'Flower' ) },
		{ value: 'heart', label: __( 'Heart' ) },
		{ value: 'diamond', label: __( 'Diamond' ) },
		{ value: 'drop', label: __( 'Teardrop' ) },
		{ value: 'cloud', label: __( 'Cloud' ) },
		{ value: 'custom', label: __( 'Polygon' ) },
	];
}

/** The silhouette picker. */
function shapePicker(
	current: MioShapePreset,
	onPick: ( preset: MioShapePreset ) => void,
): HTMLElement {
	const el = document.createElement( 'os-select' );
	el.setAttribute( 'label', __( 'Shape' ) );
	el.setAttribute( 'value', current );
	for ( const option of shapeOptions() ) {
		const item = document.createElement( 'os-option' );
		item.setAttribute( 'value', option.value );
		item.textContent = option.label;
		el.appendChild( item );
	}
	el.addEventListener( 'os-pick', ( e: Event ) => {
		const value = ( e as CustomEvent< { value?: string } > ).detail?.value;
		if ( value ) {
			onPick( value as MioShapePreset );
		}
	} );
	return el;
}

function section( heading: string, children: HTMLElement[] ): HTMLElement {
	const el = document.createElement( 'os-section' );
	el.setAttribute( 'heading', heading );
	for ( const child of children ) {
		el.appendChild( child );
	}
	return el;
}

/* -------------------------------------------------------------------
 * The panel.
 * ---------------------------------------------------------------- */

/**
 * Close any open style panel, saving the look on the way out.
 *
 * Every control already writes through `setStyle` / `setShape`, so the
 * look is never only in the DOM — this final commit is about *when*
 * rather than *whether*. Closing the dialog is the moment a user
 * thinks of themselves as having finished, and it is the moment worth
 * making sure their account agrees.
 *
 * Only commits when a panel was actually open: this is also the
 * dedupe call at the top of `openMioStylePanelImmediate()` and the
 * teardown call in `mio.ts`, and neither should cost a write.
 */
export function closeMioStylePanel(): void {
	const open = document.querySelectorAll( `.${ PANEL_CLASS }` );
	if ( ! open.length ) {
		return;
	}
	open.forEach( ( el ) => el.remove() );
	api()?.commitStyle();
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

	const modal = document.createElement( 'os-modal' );
	modal.classList.add( PANEL_CLASS );
	modal.setAttribute( 'title', __( 'Make it yours' ) );
	modal.setAttribute( 'size', 'md' );
	modal.setAttribute( 'open', '' );

	const body = document.createElement( 'div' );
	const paint = (): void => {
		const config = mio.getConfig();
		const appearance = config.appearance;
		const physics = config.physics;
		// One bag to read from, because one setter writes it. The two
		// groups share no key names, so the merge is lossless and the
		// split on the way back out is unambiguous.
		const current: LookValues = { ...appearance, ...physics };
		const set = ( partial: LookPartial ): void => mio.setStyle( partial );

		// Only the polygon reads `shapeLobes`, so only the polygon gets
		// the slider — a control that does nothing for ten of the
		// eleven shapes teaches people to ignore it.
		const corners: HTMLElement[] =
			physics.shapePreset === 'custom'
				? [
					slider(
						{
							key: 'shapeLobes',
							label: __( 'Corners' ),
							min: 2,
							max: 8,
							step: 1,
						},
						current,
						set,
					),
				]
				: [];

		body.replaceChildren(
			section( __( 'Shape' ), [
				shapePicker( physics.shapePreset, ( preset ) => {
					set( { shapePreset: preset } );
					// The corner slider appears and disappears with the
					// polygon, and every other control's value has just
					// been superseded.
					paint();
				} ),
				...corners,
				slider(
					{
						key: 'shapeAmount',
						label: __( 'Shape strength' ),
						min: 0,
						max: 1.4,
						step: 0.05,
					},
					current,
					set,
				),
				slider(
					{
						key: 'shapeAngle',
						label: __( 'Rotation' ),
						min: 0,
						max: 360,
						step: 1,
					},
					current,
					set,
				),
				toggle(
					__( 'Change shape on its own' ),
					physics.shapeShuffle > 0,
					( next ) => {
						// Off is `0`; on goes back to the shipped minute,
						// which is also what the site's own config would
						// have said if the user had never touched this.
						set( {
							shapeShuffle: next
								? MIO_DEFAULTS.physics.shapeShuffle
								: 0,
						} );
					},
				),
			] ),
			section( __( 'Idle' ), [
				toggle(
					__( 'Wobble when idle' ),
					physics.idleWobble > 0,
					( next ) => {
						// Unticked, Mio holds a still silhouette instead of
						// breathing. The two sliders below go with it, so
						// repaint — they would otherwise sit there showing
						// values that no longer do anything.
						set( {
							idleWobble: next
								? MIO_DEFAULTS.physics.idleWobble
								: 0,
						} );
						paint();
					},
				),
				...( physics.idleWobble > 0
					? [
						slider(
							{
								key: 'idleWobble',
								label: __( 'Wobble strength' ),
								min: 0,
								max: 0.4,
								step: 0.005,
							},
							current,
							set,
						),
						slider(
							{
								key: 'idleWobbleSpeed',
								label: __( 'Wobble speed' ),
								min: 0,
								max: 4,
								step: 0.05,
							},
							current,
							set,
						),
					]
					: [] ),
			] ),
			section( __( 'Colour' ), [
				slider(
					{
						key: 'hueStart',
						label: __( 'Hue' ),
						min: 0,
						max: 360,
						step: 1,
					},
					current,
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
					current,
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
					current,
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
					current,
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
					current,
					set,
				),
				slider(
					{
						key: 'glow',
						label: __( 'Glow' ),
						min: 0,
						max: 20,
						// Coarser than the other sliders because the
						// range is twenty times longer. At `0.05` a drag
						// from end to end would be four hundred steps of
						// a change nobody can see.
						step: 0.1,
					},
					current,
					set,
				),
				// No "soften the glow" toggle. `glowBlur` stays on.
				//
				// It was briefly a checkbox, on the reasoning that a
				// crisp halo is a different look and a cheaper render.
				// That reasoning belonged to a halo drawn as one flat
				// band, where the blur was decoration. It is not one
				// any more: each glow pass is a ramp of concentric
				// shells, and a flat shell against a flat shell is a
				// hard edge — unblurred, the ramp shows as the handful
				// of contour rings it is built from. Off is not the
				// crisp version of this glow, it is the unfinished one.
				//
				// The key survives for `openstation_mio_config`, which
				// is where a site that needs the two filter passes back
				// for performance can still drop them.
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
					current,
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
					current,
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
					current,
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
				...( appearance.iridescence > 0
					? [
						slider(
							{
								key: 'iridescence',
								label: __( 'Iridescence' ),
								min: 0,
								max: 2,
								step: 0.05,
							},
							current,
							set,
						),
					]
					: [] ),
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
					current,
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
					current,
					set,
				),
			] ),
		);
	};
	paint();
	modal.appendChild( body );

	// Footer. Both of the first two repaint the whole panel rather than
	// only writing the config, because every control's value is now
	// stale.
	//
	// "Surprise me" sits next to "Restore Mio" on purpose: they are the
	// two ends of the same idea, and having the undo in arm's reach is
	// what makes a randomizer worth pressing twice.
	const surprise = document.createElement( 'os-button' );
	surprise.setAttribute( 'slot', 'footer' );
	surprise.setAttribute( 'variant', 'secondary' );
	surprise.textContent = __( 'Surprise me' );
	surprise.addEventListener( 'click', () => {
		const look = randomMioLook();
		mio.setStyle( { ...look.appearance, ...look.physics } );
		paint();
	} );

	const restore = document.createElement( 'os-button' );
	restore.setAttribute( 'slot', 'footer' );
	restore.setAttribute( 'variant', 'secondary' );
	restore.textContent = __( 'Restore Mio' );
	restore.addEventListener( 'click', () => {
		mio.resetStyle();
		paint();
	} );

	const done = document.createElement( 'os-button' );
	done.setAttribute( 'slot', 'footer' );
	done.setAttribute( 'variant', 'primary' );
	done.textContent = __( 'Done' );
	done.addEventListener( 'click', () => closeMioStylePanel() );

	modal.appendChild( surprise );
	modal.appendChild( restore );
	modal.appendChild( done );
	modal.addEventListener( 'os-modal-cancel', () => closeMioStylePanel() );

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
	const menu = document.createElement( 'os-context-menu' );
	menu.classList.add( MENU_CLASS );
	menu.setAttribute( 'open', '' );
	menu.style.left = `${ pos.x }px`;
	menu.style.top = `${ pos.y }px`;

	const option = document.createElement( 'os-context-menu-option' );
	option.setAttribute( 'value', 'make-it-yours' );
	option.setAttribute( 'icon', 'dashicons-art' );
	option.dataset.menuItemId = 'make-it-yours';
	option.textContent = __( 'Make it yours' );
	menu.appendChild( option );

	menu.addEventListener( 'os-context-menu-pick', () => {
		closeMioMenu();
		openMioStylePanel();
	} );

	document.body.appendChild( menu );
	document.addEventListener( 'pointerdown', onOutside, true );
	document.addEventListener( 'keydown', onKeydown, true );
}
