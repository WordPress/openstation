/**
 * OpenStation — Widget picker popover.
 *
 * A tiny singleton popover the user opens via the `+` tile at the
 * bottom of the widget column. Lists every registered widget; each
 * entry either clicks to add or shows "Added" if already on screen.
 *
 * Intentionally NOT a native window — native windows carry titlebar
 * chrome that'd feel over-engineered for a 1-click add. A
 * self-contained floating panel with Esc + outside-click dismiss
 * matches the overview top-bar's tile-add vocabulary the user
 * already recognises.
 */

import { __, sprintf } from '../i18n';
import type { WidgetDef } from './types';

/** Options handed to `openWidgetPicker` by the layer on each open. */
interface OpenPickerOptions {
	/** Element the picker positions itself against (the + tile). */
	anchor: HTMLElement;
	/** Snapshot-returning getters so filter changes between open calls reflect. */
	registry: () => WidgetDef[];
	enabledIds: () => string[];
	/** Click handler — layer persists + mounts on call. */
	onAdd: ( id: string ) => void;
	/**
	 * Fired once when the picker closes. The layer uses it to drop
	 * the "keep the + pill visible" flag it sets on open.
	 */
	onClose?: () => void;
}

/**
 * Module-scoped singleton — only one picker open at a time.
 * Tracked so `refreshWidgetPicker()` can repaint the "Added" state
 * without the caller having to thread a handle.
 */
let active: {
	panel: HTMLElement;
	options: OpenPickerOptions;
	onOutsidePointerDown: ( e: PointerEvent ) => void;
	onKeyDown: ( e: KeyboardEvent ) => void;
} | null = null;

/** Open the picker. No-op if one is already open. */
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

	// Position the panel just above the anchor, right-aligned so it
	// hugs the widget column. Absolute-positioned inside the body
	// because the desktop area clips overflow and we want the panel
	// free to extend upward past the column's top edge.
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
	// Deferred so the same pointerdown that opened the picker (on
	// the + tile) doesn't immediately close it.
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

	// Focus the first enabled entry for keyboard users.
	const first = list.querySelector<HTMLElement>(
		'button:not([disabled])',
	);
	first?.focus();
}

/**
 * Repaint the active picker's list. Called by the layer after an
 * add/remove so the "Added" markers stay accurate without having
 * to close + re-open.
 */
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

/** Close the active picker. No-op if none is open. */
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

// ------------------------------------------------------------------
// Internal
// ------------------------------------------------------------------

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
			// translators: %s is the widget label
			ariaLabel = sprintf( __( '%s (already added)' ), def.label );
		} else {
			// translators: %s is the widget label
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
				// Whether a pick closes the picker is the layer's
				// call, not this component's — it owns the anchor
				// and knows what happens to it afterwards.
				options.onAdd( def.id );
			} );
		}

		list.appendChild( entry );
	}
}

/**
 * Position the panel so its bottom-right corner sits just above
 * the anchor's top edge with a 6 px gap. Absolute-positioned in
 * viewport coords because the desktop area clips overflow.
 */
function positionPanel(
	panel: HTMLElement,
	anchor: HTMLElement,
): void {
	const rect = anchor.getBoundingClientRect();
	panel.style.position = 'fixed';
	// Paint once to measure — panel has `visibility: hidden` first
	// via CSS until we commit position, avoiding a flash at (0,0).
	// But jsdom doesn't implement layout so we fall back to the
	// computed rect; either way this resolves before paint.
	panel.style.left = '0px';
	panel.style.top = '0px';
	panel.style.visibility = 'hidden';
	// Force a layout pass so offsetWidth / offsetHeight reflect.
	const panelRect = panel.getBoundingClientRect();
	const width = panelRect.width || 320;
	const height = panelRect.height || 200;
	const gap = 6;

	let left = rect.right - width;
	let top = rect.top - height - gap;

	// Clamp to viewport so a small-window placement doesn't push
	// the panel off screen.
	if ( left < 8 ) {
		left = 8;
	}
	if ( top < 8 ) {
		// Not enough headroom — flip below the anchor instead.
		top = rect.bottom + gap;
	}

	panel.style.left = `${ Math.round( left ) }px`;
	panel.style.top = `${ Math.round( top ) }px`;
	panel.style.visibility = '';
}
