import { __, sprintf } from '../i18n';
import { getWorkArea, WORK_AREA_GAP } from '../work-area';
import type { WidgetDef } from './types';

interface OpenPickerOptions {

	anchor: HTMLElement;

	registry: () => WidgetDef[];
	enabledIds: () => string[];

	onAdd: ( id: string ) => void;

	onClose?: () => void;
}

let active: {
	panel: HTMLElement;
	options: OpenPickerOptions;
	onOutsidePointerDown: ( e: PointerEvent ) => void;
	onKeyDown: ( e: KeyboardEvent ) => void;
} | null = null;

export function openWidgetPicker( options: OpenPickerOptions ): void {
	if ( active ) {
		return;
	}

	const panel = document.createElement( 'div' );
	panel.className = 'os-widget-picker';
	panel.setAttribute( 'role', 'menu' );
	panel.setAttribute( 'aria-label', __( 'Add widget' ) );

	const title = document.createElement( 'div' );
	title.className = 'os-widget-picker__title';
	title.textContent = __( 'Add widget' );
	panel.appendChild( title );

	const list = document.createElement( 'div' );
	list.className = 'os-widget-picker__list';
	panel.appendChild( list );

	paintList( list, options );

	document.body.appendChild( panel );
	positionPanel( panel, options.anchor );

	const onOutsidePointerDown = ( e: PointerEvent ): void => {
		const target = e.target as Node | null;
		if ( ! target ) {
			return;
		}
		if ( panel.contains( target ) || options.anchor.contains( target ) ) {
			return;
		}
		closeWidgetPicker();
	};

	window.setTimeout( () => {
		document.addEventListener( 'pointerdown', onOutsidePointerDown, true );
	}, 0 );

	const onKeyDown = ( e: KeyboardEvent ): void => {
		if ( e.key === 'Escape' ) {
			closeWidgetPicker();
		}
	};
	document.addEventListener( 'keydown', onKeyDown );

	active = { panel, options, onOutsidePointerDown, onKeyDown };

	const first = list.querySelector<HTMLElement>(
		'button:not([disabled])',
	);
	first?.focus();
}

export function refreshWidgetPicker(): void {
	if ( ! active ) {
		return;
	}
	const list = active.panel.querySelector<HTMLElement>(
		'.os-widget-picker__list',
	);
	if ( list ) {
		paintList( list, active.options );
	}
}

export function closeWidgetPicker(): void {
	if ( ! active ) {
		return;
	}
	document.removeEventListener(
		'pointerdown',
		active.onOutsidePointerDown,
		true,
	);
	document.removeEventListener( 'keydown', active.onKeyDown );
	active.panel.remove();
	const { onClose } = active.options;
	active = null;
	onClose?.();
}

function paintList(
	list: HTMLElement,
	options: OpenPickerOptions,
): void {
	list.innerHTML = '';
	const enabled = new Set( options.enabledIds() );
	const defs = options.registry();

	if ( defs.length === 0 ) {
		const empty = document.createElement( 'div' );
		empty.className = 'os-widget-picker__empty';
		empty.textContent = __(
			'No widgets available. Activate a plugin that registers one, or see the docs for the registerWidget API.',
		);
		list.appendChild( empty );
		return;
	}

	for ( const def of defs ) {
		const entry = document.createElement( 'button' );
		entry.type = 'button';
		entry.className = 'os-widget-picker__entry';
		const isAdded = enabled.has( def.id );
		if ( isAdded ) {
			entry.classList.add(
				'os-widget-picker__entry--added',
			);
			entry.disabled = true;
			entry.setAttribute( 'aria-disabled', 'true' );
		}
		entry.setAttribute( 'role', 'menuitem' );
		let ariaLabel;
		if ( isAdded ) {
			ariaLabel = sprintf( __( '%s (already added)' ), def.label );
		} else {
			ariaLabel = sprintf( __( 'Add %s' ), def.label );
		}
		entry.setAttribute( 'aria-label', ariaLabel );

		const icon = document.createElement( 'span' );
		icon.className = `os-widget-picker__entry-icon dashicons ${ def.icon }`;
		icon.setAttribute( 'aria-hidden', 'true' );
		entry.appendChild( icon );

		const textWrap = document.createElement( 'span' );
		textWrap.className = 'os-widget-picker__entry-text';
		const label = document.createElement( 'span' );
		label.className = 'os-widget-picker__entry-label';
		label.textContent = def.label;
		textWrap.appendChild( label );
		if ( def.description ) {
			const desc = document.createElement( 'span' );
			desc.className =
				'os-widget-picker__entry-description';
			desc.textContent = def.description;
			textWrap.appendChild( desc );
		}
		entry.appendChild( textWrap );

		if ( isAdded ) {
			const status = document.createElement( 'span' );
			status.className = 'os-widget-picker__entry-status';
			status.textContent = __( 'Added' );
			entry.appendChild( status );
		}

		if ( ! isAdded ) {
			entry.addEventListener( 'click', ( e ) => {
				e.preventDefault();
				e.stopPropagation();

				options.onAdd( def.id );
			} );
		}

		list.appendChild( entry );
	}
}

interface ViewportBox {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

export interface WidgetPickerPlacement {
	left: number;
	top: number;

	maxHeight: number | null;
}

const ANCHOR_GAP = 6;

export function placeWidgetPicker(
	anchor: ViewportBox,
	size: { width: number; height: number },
	bounds: ViewportBox,
): WidgetPickerPlacement {
	const { width, height } = size;
	const roomAbove = anchor.top - ANCHOR_GAP - bounds.top;
	const roomBelow = bounds.bottom - ( anchor.bottom + ANCHOR_GAP );

	let top: number;
	let maxHeight: number | null = null;
	if ( height <= roomAbove ) {
		top = anchor.top - ANCHOR_GAP - height;
	} else if ( height <= roomBelow ) {
		top = anchor.bottom + ANCHOR_GAP;
	} else if ( roomAbove >= roomBelow ) {
		maxHeight = Math.max( 0, roomAbove );
		top = bounds.top;
	} else {
		maxHeight = Math.max( 0, roomBelow );
		top = anchor.bottom + ANCHOR_GAP;
	}

	let left = anchor.right - width;
	left = Math.min( left, bounds.right - width );
	left = Math.max( left, bounds.left );

	return { left, top, maxHeight };
}

function pickerBounds(): ViewportBox {
	const margin = WORK_AREA_GAP;
	const { viewport } = getWorkArea();
	const area =
		viewport.width > 0 && viewport.height > 0
			? viewport
			: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
	return {
		top: area.y + margin,
		right: area.x + area.width - margin,
		bottom: area.y + area.height - margin,
		left: area.x + margin,
	};
}

function positionPanel(
	panel: HTMLElement,
	anchor: HTMLElement,
): void {
	const rect = anchor.getBoundingClientRect();
	panel.style.position = 'fixed';

	panel.style.left = '0px';
	panel.style.top = '0px';
	panel.style.maxHeight = '';
	panel.style.visibility = 'hidden';
	const panelRect = panel.getBoundingClientRect();
	const placement = placeWidgetPicker(
		rect,
		{
			width: panelRect.width || 342,
			height: panelRect.height || 200,
		},
		pickerBounds(),
	);

	panel.style.left = `${ Math.round( placement.left ) }px`;
	panel.style.top = `${ Math.round( placement.top ) }px`;
	if ( placement.maxHeight !== null ) {
		panel.style.maxHeight = `${ Math.floor( placement.maxHeight ) }px`;
	}
	panel.style.visibility = '';
}
