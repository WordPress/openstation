/**
 * Default submenu renderer — vertical list popover.
 *
 * The shipped baseline. Renders a simple `<ul>` of submenu links
 * anchored to the dock tile that triggered it, dismisses on outside
 * click / Escape / blur, and animates in/out with the standard
 * `prefers-reduced-motion`-aware transition. Plugin authors who want
 * a fancier UI register their own renderer (radial menu, hovering
 * cards, centered command-K-style overlay, etc.) — see
 * `docs/examples/submenu-renderer.md`.
 *
 * Implementation kept deliberately small so it doubles as the
 * reference implementation a plugin author can crib from. Every
 * non-obvious thing (positioning, dismissal, accessibility) has a
 * `// Why:` comment so the contract is unambiguous.
 *
 * @since 0.18.0
 */

import type {
	SubmenuController,
	SubmenuMountDeps,
	SubmenuRenderer,
} from './types';

const POPOVER_CLASS = 'wp-desktop-dock-submenu';
const POPOVER_GAP = 8; // gap (px) between dock tile and popover edge

export const defaultSubmenuRenderer: SubmenuRenderer = {
	id: 'default',
	label: 'List',
	description: 'Vertical menu of submenu links — the shipped baseline.',
	icon: 'dashicons-list-view',
	apiVersion: 1,
	mount( deps: SubmenuMountDeps ): SubmenuController {
		const popover = document.createElement( 'div' );
		popover.className = POPOVER_CLASS;
		popover.setAttribute( 'role', 'menu' );
		popover.setAttribute( 'aria-label', deps.item.title );

		// `tabindex=-1` so the popover itself is focusable for
		// programmatic focus + Escape handling, but doesn't steal
		// keyboard order from the inner items.
		popover.tabIndex = -1;

		const list = document.createElement( 'ul' );
		list.className = `${ POPOVER_CLASS }__list`;
		popover.appendChild( list );

		for ( const sub of deps.item.submenu ) {
			const li = document.createElement( 'li' );
			li.className = `${ POPOVER_CLASS }__item`;
			const btn = document.createElement( 'button' );
			btn.type = 'button';
			btn.className = `${ POPOVER_CLASS }__link`;
			btn.setAttribute( 'role', 'menuitem' );
			btn.textContent = sub.title;
			btn.addEventListener( 'click', () => {
				deps.onPick( sub );
			} );
			li.appendChild( btn );
			list.appendChild( li );
		}

		document.body.appendChild( popover );

		// Position after insertion so we can read `getBoundingClientRect`.
		positionAgainst( popover, deps.anchor, deps.orientation );

		// Reposition on viewport changes — small popovers get strange
		// otherwise on tablet rotations, mid-flight scroll, etc.
		const onWindowChange = (): void =>
			positionAgainst( popover, deps.anchor, deps.orientation );
		window.addEventListener( 'resize', onWindowChange );
		window.addEventListener( 'scroll', onWindowChange, { passive: true } );

		// Keyboard navigation — Escape closes; Arrow Up/Down moves
		// focus among items; Enter activates the focused item.
		const onKeyDown = ( e: KeyboardEvent ): void => {
			if ( e.key === 'Escape' ) {
				e.preventDefault();
				deps.onClose();
				return;
			}
			if ( e.key === 'ArrowDown' || e.key === 'ArrowUp' ) {
				e.preventDefault();
				moveFocus( popover, e.key === 'ArrowDown' ? 1 : -1 );
			}
		};
		popover.addEventListener( 'keydown', onKeyDown );

		// Outside-click dismissal. Uses the capture phase so a click
		// on a button inside the popover gets a chance to fire its
		// own `onPick` handler before this dismiss runs.
		const onDocumentPointer = ( e: Event ): void => {
			const target = e.target as Node | null;
			if ( ! target ) {
				return;
			}
			if ( popover.contains( target ) || deps.anchor.contains( target ) ) {
				return;
			}
			deps.onClose();
		};
		document.addEventListener( 'pointerdown', onDocumentPointer, true );

		// Animate in next frame so the transition has a starting state.
		requestAnimationFrame( () => {
			popover.classList.add( `${ POPOVER_CLASS }--visible` );
			// Move focus into the first item so keyboard users can
			// navigate immediately. Pointer users won't notice the
			// focus ring (none on hover-driven invocations) but
			// keyboard users get a clean entry point.
			const first = popover.querySelector< HTMLElement >(
				`.${ POPOVER_CLASS }__link`,
			);
			first?.focus();
		} );

		let destroyed = false;
		return {
			close(): void {
				if ( destroyed ) {
					return;
				}
				popover.classList.remove(
					`${ POPOVER_CLASS }--visible`,
				);
				// Defer destroy by a frame so the closing animation can
				// play. 200ms covers the standard transition duration
				// with a small buffer; matches dock tooltip dismissals.
				window.setTimeout( () => {
					this.destroy();
				}, 200 );
			},
			destroy(): void {
				if ( destroyed ) {
					return;
				}
				destroyed = true;
				window.removeEventListener( 'resize', onWindowChange );
				window.removeEventListener( 'scroll', onWindowChange );
				document.removeEventListener(
					'pointerdown',
					onDocumentPointer,
					true,
				);
				popover.remove();
			},
		};
	},
};

/**
 * Position the popover against the dock tile based on which edge
 * the parent dock hugs. CSS handles the visual offsets (arrow
 * decoration, transitions); this just sets the absolute coords.
 *
 * - bottom dock → popover sits ABOVE the tile, horizontally
 *   centered
 * - left dock   → popover sits to the RIGHT of the tile, vertically
 *   centered (clamped to viewport)
 * - right dock  → popover sits to the LEFT of the tile, vertically
 *   centered (clamped to viewport)
 *
 * Uses fixed positioning so the popover floats above any scrolling
 * desktop content. The shell's z-index custom property keeps it
 * above the dock and below modal overlays.
 */
function positionAgainst(
	popover: HTMLElement,
	anchor: HTMLElement,
	orientation: 'left' | 'right' | 'bottom',
): void {
	popover.style.position = 'fixed';
	popover.style.zIndex =
		'calc( var( --wp-desktop-z-dock, 100 ) + 2 )';

	const a = anchor.getBoundingClientRect();
	// Reset before measuring so a previous position doesn't bias
	// the measurement.
	popover.style.left = '0';
	popover.style.top = '0';
	const p = popover.getBoundingClientRect();

	let left = 0;
	let top = 0;
	if ( orientation === 'bottom' ) {
		left = a.left + a.width / 2 - p.width / 2;
		top = a.top - p.height - POPOVER_GAP;
	} else if ( orientation === 'right' ) {
		left = a.left - p.width - POPOVER_GAP;
		top = a.top + a.height / 2 - p.height / 2;
	} else {
		// left
		left = a.right + POPOVER_GAP;
		top = a.top + a.height / 2 - p.height / 2;
	}

	// Clamp to viewport with an 8px margin so the popover never
	// sticks off-screen on small viewports / when the tile is at
	// the very edge of the rail.
	const margin = 8;
	const maxLeft = window.innerWidth - p.width - margin;
	const maxTop = window.innerHeight - p.height - margin;
	left = Math.min( Math.max( margin, left ), maxLeft );
	top = Math.min( Math.max( margin, top ), maxTop );

	popover.style.left = `${ Math.round( left ) }px`;
	popover.style.top = `${ Math.round( top ) }px`;
}

/** Move focus among the popover's `[role=menuitem]` children. */
function moveFocus( popover: HTMLElement, delta: 1 | -1 ): void {
	const items = Array.from(
		popover.querySelectorAll< HTMLElement >(
			`.${ POPOVER_CLASS }__link`,
		),
	);
	if ( items.length === 0 ) {
		return;
	}
	const ownerDoc = popover.ownerDocument;
	const focused = ownerDoc.activeElement as HTMLElement | null;
	const idx = focused ? items.indexOf( focused ) : -1;
	let next: number;
	if ( idx === -1 ) {
		next = delta === 1 ? 0 : items.length - 1;
	} else {
		next = ( idx + delta + items.length ) % items.length;
	}
	items[ next ]?.focus();
}
