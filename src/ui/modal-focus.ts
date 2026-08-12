/**
 * Modal focus scope for light-DOM dialogs.
 *
 * `<os-modal>` and `<os-confirm-dialog>` each carry their own trap
 * because their controls live in a shadow root and the selector only
 * ever has to match what the component itself rendered. The first-run
 * intro dialogs are the other shape: hand-built `<div role="dialog">`
 * subtrees appended straight to `<body>`, so the trap has to work
 * against arbitrary author markup. This module is that trap, shared by
 * all of them so "modal" means the same thing in every native app.
 *
 * What a scope guarantees while it is open:
 *
 * - Focus starts inside the dialog. A modal the user has to click
 *   before Escape works is a modal keyboard users cannot dismiss.
 * - Tab and Shift+Tab wrap at the ends instead of walking out the back.
 * - Focus that lands outside anyway — a background click, a stray
 *   `focus()` from a late-arriving widget, the browser handing `<body>`
 *   focus after a text selection — is pulled back to where it was.
 * - Releasing hands focus to somewhere deliberate: the caller's chosen
 *   context first, then whatever had focus when the scope opened.
 *
 * The listeners live on the document in the capture phase so the
 * shell's own global key handlers (command palette, window shortcuts)
 * never see a Tab the dialog is about to consume, and they self-heal:
 * a root that leaves the document some other way (a plugin replacing
 * the body, a test resetting the DOM) unbinds on the next event
 * instead of swallowing Tab for the rest of the session.
 *
 * **Only one scope is live at a time.** Two open scopes each see the
 * other's dialog as "behind the scrim", and each pull-back is a real
 * focus change that re-triggers the other's — mutual recursion that
 * blows the stack rather than settling. Nothing stops two first-run
 * dialogs from mounting at once (each window gates its own intro
 * independently, so opening two never-seen windows back to back opens
 * two), so scopes go on a stack and only the topmost acts. The ones
 * underneath stay mounted and inert until it releases, which is also
 * what makes `isTopmost()` the right question for a dialog's own
 * Escape handler to ask before closing.
 *
 * That stack is cross-bundle state: `posts-window`, `plugins-window`
 * and `comments-window` are separate Vite IIFEs, each with its own
 * compiled copy of this module, so a module-level array would give
 * every bundle a private stack and coordinate nothing. It lives in a
 * `createSharedStore` slot for exactly that reason.
 */

import { createSharedStore } from '../shared-store';

/**
 * Everything the trap treats as a stop in the tab order.
 *
 * Attribute-only, deliberately: visibility would need layout, and the
 * dialogs this serves render offscreen-free markup into a scrim that
 * is on screen by construction. `[hidden]` and `aria-hidden` cover the
 * one case that does arise — a control the dialog renders but has not
 * turned on yet.
 */
const FOCUSABLE = [
	'a[href]',
	'button:not([disabled])',
	'input:not([disabled])',
	'select:not([disabled])',
	'textarea:not([disabled])',
	'[tabindex]:not([tabindex="-1"])',
]
	.map( ( sel ) => `${ sel }:not([hidden]):not([aria-hidden="true"])` )
	.join( ', ' );

export interface ModalFocusOptions {
	/**
	 * The dialog subtree. Focus is confined to it, and the scope
	 * unbinds itself once it leaves the document.
	 */
	root: HTMLElement;
	/**
	 * What to focus on open. Defaults to the first focusable control
	 * in `root`, then `root` itself.
	 */
	initialFocus?: HTMLElement | null;
	/**
	 * Where focus goes on release, ahead of whatever had it when the
	 * scope opened.
	 *
	 * The intro dialogs need this: they open themselves as the window
	 * paints, so the element that "opened" them is whatever the user
	 * last touched — a dock icon, a desktop tile, nothing at all.
	 * Handing focus back there would park the user outside the window
	 * they just opened. Passing the window's own root instead lands
	 * them in the app the dialog was introducing. A dialog with a real
	 * launcher should omit this and get the standard return-to-opener.
	 */
	returnFocusTo?: HTMLElement | null;
}

export interface ModalFocusScope {
	/**
	 * Tear the scope down and hand focus back. Idempotent — the
	 * dialogs call it from a `cleanup()` that several paths reach.
	 */
	release(): void;
	/**
	 * Whether this is the frontmost live scope.
	 *
	 * A dialog binds its own Escape handler on the document, so with
	 * two dialogs open one keypress reaches both and closes both —
	 * the user dismissed the one they could see and the one behind it
	 * went too, marked seen without ever being read. Gate that
	 * handler on this.
	 */
	isTopmost(): boolean;
}

/** One entry per live scope. Identity is all we need from it. */
interface ScopeToken {
	root: HTMLElement;
}

/**
 * The stack of live scopes, shared across every bundle that traps
 * focus. See the module docblock for why this cannot be a plain
 * module-level array.
 */
const scopeStack = createSharedStore< { stack: ScopeToken[] } >(
	'openstation/modal-focus',
	() => ( { stack: [] } ),
);

/**
 * The genuinely focused element, walking down through shadow roots.
 * `document.activeElement` stops at the outermost host, which in this
 * shell is almost always an `<os-*>` wrapper rather than the control
 * the user actually pressed.
 */
export function deepActiveElement( doc: Document ): HTMLElement | null {
	let el = doc.activeElement as HTMLElement | null;
	while ( el?.shadowRoot?.activeElement ) {
		el = el.shadowRoot.activeElement as HTMLElement;
	}
	return el && el !== doc.body ? el : null;
}

/** Every focusable control inside `root`, in tab order. */
function focusablesIn( root: HTMLElement ): HTMLElement[] {
	return Array.from( root.querySelectorAll< HTMLElement >( FOCUSABLE ) );
}

/**
 * Focus an element that may not be focusable on its own.
 *
 * A `<div class="dialog">` or a window root has no tab stop, and
 * `focus()` on it is a silent no-op that leaves focus wherever it was
 * — which for a modal means behind the scrim. Give it the programmatic
 * -1 stop first; that keeps it out of the tab order while making it a
 * legal focus target.
 */
function focusEvenIfInert( el: HTMLElement ): void {
	if ( ! el.hasAttribute( 'tabindex' ) && ! el.matches( FOCUSABLE ) ) {
		el.setAttribute( 'tabindex', '-1' );
	}
	el.focus();
}

/** Whether `el` is inside `root`, crossing shadow boundaries. */
function contains( root: HTMLElement, el: EventTarget | null ): boolean {
	let node = el as Node | null;
	while ( node ) {
		if ( node === root ) {
			return true;
		}
		const parent = node.parentNode;
		node = parent instanceof ShadowRoot ? parent.host : parent;
	}
	return false;
}

/** Whether `token` is the frontmost entry on the shared stack. */
function isTopmostToken( token: ScopeToken ): boolean {
	const { stack } = scopeStack.state;
	return stack.length > 0 && stack[ stack.length - 1 ] === token;
}

/** Drop `token` wherever it sits — scopes can release out of order. */
function dropToken( token: ScopeToken ): void {
	const { stack } = scopeStack.state;
	const at = stack.indexOf( token );
	if ( at === -1 ) {
		return;
	}
	stack.splice( at, 1 );
	scopeStack.notify();
}

/**
 * Confine focus to `root` until the returned scope is released.
 */
export function trapFocus( options: ModalFocusOptions ): ModalFocusScope {
	const { root } = options;
	const doc = root.ownerDocument;
	const opener = deepActiveElement( doc );

	// Frontmost from here on. Anything already open goes inert rather
	// than fighting this scope for focus.
	const token: ScopeToken = { root };
	scopeStack.state.stack.push( token );
	scopeStack.notify();

	// Where to put focus when it escapes. Starts as the initial
	// target and tracks the last legal position after that, so a pull-
	// back returns the user to the control they were on rather than to
	// the top of the dialog.
	let lastInside: HTMLElement =
		options.initialFocus ?? focusablesIn( root )[ 0 ] ?? root;
	focusEvenIfInert( lastInside );

	let released = false;

	const onKeyDown = ( e: KeyboardEvent ): void => {
		if ( ! root.isConnected ) {
			detach();
			return;
		}
		if ( ! isTopmostToken( token ) || e.key !== 'Tab' ) {
			return;
		}
		const items = focusablesIn( root );
		if ( items.length === 0 ) {
			// Nothing to move between — keep focus on the container
			// rather than letting Tab walk onto the desk behind.
			e.preventDefault();
			focusEvenIfInert( root );
			return;
		}
		const first = items[ 0 ];
		const last = items[ items.length - 1 ];
		const active = deepActiveElement( doc );
		// Both branches test containment, not just the Shift one:
		// selecting text inside the dialog leaves focus on `<body>`,
		// and from there neither end matches, so an unguarded forward
		// Tab hands focus to the first control behind the scrim.
		const loose = ! contains( root, active );
		if ( e.shiftKey && ( loose || active === first ) ) {
			e.preventDefault();
			last.focus();
		} else if ( ! e.shiftKey && ( loose || active === last ) ) {
			e.preventDefault();
			first.focus();
		}
	};

	const onFocusIn = ( e: FocusEvent ): void => {
		if ( ! root.isConnected ) {
			detach();
			return;
		}
		if ( contains( root, e.target ) ) {
			const target = e.target;
			if ( target instanceof HTMLElement ) {
				lastInside = target;
			}
			return;
		}
		// A scope underneath an open one records where focus went but
		// does not chase it — the scope on top owns that decision, and
		// two scopes both pulling would bounce focus between them until
		// the stack overflows.
		if ( ! isTopmostToken( token ) ) {
			return;
		}
		// Focus reached something behind the scrim — a background
		// click, an iframe window taking focus, a widget calling
		// `focus()` on mount. Pull it back. Re-focusing lands inside
		// the root, so this cannot recurse.
		focusEvenIfInert(
			lastInside.isConnected ? lastInside : focusablesIn( root )[ 0 ] ?? root,
		);
	};

	/**
	 * Unbind and leave the stack. Also the self-heal path for a root
	 * that left the document some other way — a scope that can no
	 * longer act must not go on blocking the one underneath it.
	 */
	function detach(): void {
		doc.removeEventListener( 'keydown', onKeyDown, true );
		doc.removeEventListener( 'focusin', onFocusIn, true );
		dropToken( token );
	}

	doc.addEventListener( 'keydown', onKeyDown, true );
	doc.addEventListener( 'focusin', onFocusIn, true );

	return {
		isTopmost(): boolean {
			return isTopmostToken( token );
		},
		release(): void {
			if ( released ) {
				return;
			}
			released = true;
			// Leave the stack before moving focus: whatever scope is
			// underneath is live again from here, and the focus this
			// hands out is its to reclaim if its dialog is still up.
			detach();
			/*
			 * Only take focus back if the dialog still had it. A
			 * dismissal that happened while the user was elsewhere (a
			 * background timer clearing the dialog) should not yank
			 * the caret out of whatever they moved on to.
			 *
			 * `null` — focus on `<body>`, i.e. nowhere — counts as
			 * ours to hand back, not as somewhere the user moved to.
			 * Clicking the backdrop lands exactly there, and leaving
			 * focus on `<body>` is the failure this scope exists to
			 * prevent. Only a real live element outside the dialog
			 * means the user went somewhere deliberately.
			 */
			const active = deepActiveElement( doc );
			if ( active !== null && ! contains( root, active ) ) {
				return;
			}
			// Caller's context first, the element that had focus when
			// the scope opened second — see `returnFocusTo`.
			if ( options.returnFocusTo?.isConnected === true ) {
				focusEvenIfInert( options.returnFocusTo );
				return;
			}
			if ( opener?.isConnected === true ) {
				focusEvenIfInert( opener );
			}
		},
	};
}
