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

const MENU_CLASS = 'os-mio-menu';

const PANEL_CLASS = 'os-mio-panel';

function intToHex( value: number ): string {
	const clamped = Math.max( 0, Math.min( 0xffffff, Math.floor( value ) ) );
	return `#${ clamped.toString( 16 ).padStart( 6, '0' ) }`;
}

function hexToInt( hex: string ): number | null {
	const match = /^#?([0-9a-f]{6})$/i.exec( hex.trim() );
	return match ? Number.parseInt( match[ 1 ], 16 ) : null;
}

type LookPartial = Partial< MioAppearance & MioLookPhysics >;

type LookValues = MioAppearance & MioPhysics;

interface SliderSpec {
	key: keyof MioAppearance | keyof MioLookPhysics;
	label: string;
	min: number;
	max: number;
	step: number;
}

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
	key: 'bodyColor' | 'eyeColor' | 'linerColor',
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

export function closeMioStylePanel(): void {
	const open = document.querySelectorAll( `.${ PANEL_CLASS }` );
	if ( ! open.length ) {
		return;
	}
	open.forEach( ( el ) => el.remove() );
	api()?.commitStyle();
}

export function openMioStylePanel(): void {
	const gen = ++panelGeneration;
	openWithShellOverlays(
		() => gen === panelGeneration,
		() => openMioStylePanelImmediate(),
	);
}

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

		const current: LookValues = { ...appearance, ...physics };
		const set = ( partial: LookPartial ): void => mio.setStyle( partial );

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
			section( __( 'Desktop' ), [
				toggle( __( 'Show MIO on wallpaper' ), window.wp?.os?.getOsSettings?.().mioShowOnWallpaper !== false,
					( shown ) => window.wp?.os?.updateOsSettings?.( { mioShowOnWallpaper: shown } ),
				),
			] ),
			section( __( 'Shape' ), [
				shapePicker( physics.shapePreset, ( preset ) => {
					set( { shapePreset: preset } );

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
						key: 'linerWidth',
						label: __( 'Inner line' ),
						min: 0,
						max: 12,
						step: 0.5,
					},
					current,
					set,
				),
				colour( 'linerColor', __( 'Inner line colour' ), appearance, set ),
				slider(
					{
						key: 'glow',
						label: __( 'Glow' ),
						min: 0,
						max: 20,

						step: 0.1,
					},
					current,
					set,
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
