/**
 * Desktop Mode — built-in dock-peek thumbnail renderers.
 *
 * The generic mini-window card (faux titlebar + ghosted content
 * lines) is fine for admin-page windows where the only signal
 * worth showing is "this window is open." Native shell apps —
 * OS Settings, Recycle Bin — are different: they have a visual
 * identity and a useful piece of state worth surfacing on hover.
 *
 * This module hooks `desktop-mode.dock.peek-card-content` once and,
 * for each known built-in window id, returns a custom body element
 * instead of the default ghosted lines. The renderer set is closed
 * to shell-owned windows; third-party plugins use the public
 * filter directly to register their own.
 *
 * Bootstrapped from `desktop.ts` once the hook bus is up.
 */

import { __ } from '../i18n';
import type { Window as WPWindow } from '../window';

/** Window id used by the OS Settings native window. Shared with `desktop.ts`. */
const OS_SETTINGS_ID = 'desktop-mode-os-settings';

/** Window id used by the Recycle Bin native window. Shared with `recycle-bin/badge.ts`. */
const RECYCLE_BIN_ID = 'desktop-mode-recycle-bin';

/**
 * Reader for the live recycle-bin count. Delayed-bound at registration
 * time because `desktop.ts` imports this module before the recycle-bin
 * module has finished bootstrapping its store; trying to import the
 * count getter at module top would create a load-order dependency we
 * don't want to enforce.
 */
type CountReader = () => number;

/**
 * Filter context — shape mirrors `DockPeekCardContext` from
 * `src/dock-peek/index.ts`. Duplicated here as a structural type
 * to avoid the circular import.
 */
interface PeekCardContext {
	window: WPWindow;
	item: { id: string; title: string; icon: string; url: string };
}

interface RegisterOpts {
	/**
	 * Returns the current recycle-bin count. Called every time the
	 * peek opens — fresh value, no staleness. The Recycle Bin
	 * module passes its `_currentRecycleBinBadge` getter.
	 */
	getRecycleBinCount: CountReader;
}

/**
 * Wire the built-in peek renderers. Idempotent: calling twice
 * registers the filter twice, so guard at the call site.
 */
export function registerBuiltInPeekRenderers( opts: RegisterOpts ): void {
	const wpHooks = getWpHooks();
	if ( ! wpHooks ) {
		return;
	}
	wpHooks.addFilter(
		'desktop-mode.dock.peek-card-content',
		'desktop-mode/built-in-peek-renderers',
		( body: unknown, ctx: unknown ): HTMLElement => {
			const context = ctx as PeekCardContext;
			const id = context.window.id;
			if ( id === OS_SETTINGS_ID ) {
				return renderOsSettings( context );
			}
			if ( id === RECYCLE_BIN_ID ) {
				return renderRecycleBin( context, opts.getRecycleBinCount );
			}
			return body as HTMLElement;
		},
	);
}

/* ──────────────────────────────────────────────────────────────────
   OS Settings renderer.

   Visual: large dashicon + a mosaic of three "tab tiles" beneath
   the big icon, hinting at the Settings tabs (Appearance, AI,
   Help — interleaved with whatever a plugin's added). Accent color
   inherits from the user's WP profile scheme via
   `--wp-admin-theme-color`.
   ────────────────────────────────────────────────────────────────── */

function renderOsSettings( _ctx: PeekCardContext ): HTMLElement {
	const root = document.createElement( 'span' );
	root.className =
		'desktop-mode-dock-peek__card-body desktop-mode-dock-peek__card-body--os-settings';
	root.setAttribute( 'aria-hidden', 'true' );

	const hero = document.createElement( 'span' );
	hero.className = 'desktop-mode-dock-peek__os-hero dashicons dashicons-admin-generic';
	root.appendChild( hero );

	const subtitle = document.createElement( 'span' );
	subtitle.className = 'desktop-mode-dock-peek__os-subtitle';
	subtitle.textContent = __( 'System Preferences' );
	root.appendChild( subtitle );

	const tabs = document.createElement( 'span' );
	tabs.className = 'desktop-mode-dock-peek__os-tabs';
	for ( const cls of [
		'dashicons-art',
		'dashicons-admin-customizer',
		'dashicons-editor-help',
	] ) {
		const tab = document.createElement( 'span' );
		tab.className = `desktop-mode-dock-peek__os-tab dashicons ${ cls }`;
		tabs.appendChild( tab );
	}
	root.appendChild( tabs );

	return root;
}

/* ──────────────────────────────────────────────────────────────────
   Recycle Bin renderer.

   Visual: trash dashicon — open lid when empty, closed lid with a
   stack of "items" peeking out when full — plus a live count
   badge when ≥1 item exists. The count is read fresh on every
   peek build via the injected `getRecycleBinCount` getter, so the
   thumbnail always reflects current state without subscriptions.
   ────────────────────────────────────────────────────────────────── */

function renderRecycleBin(
	_ctx: PeekCardContext,
	getCount: CountReader,
): HTMLElement {
	const root = document.createElement( 'span' );
	root.className =
		'desktop-mode-dock-peek__card-body desktop-mode-dock-peek__card-body--recycle-bin';
	root.setAttribute( 'aria-hidden', 'true' );

	const count = Math.max( 0, Math.floor( getCount() || 0 ) );
	root.dataset.empty = count === 0 ? 'true' : 'false';

	const stage = document.createElement( 'span' );
	stage.className = 'desktop-mode-dock-peek__bin-stage';

	// "Stack" — three layered slips representing trashed items.
	// Hidden when empty; revealed (with a slight stagger) when full.
	const stack = document.createElement( 'span' );
	stack.className = 'desktop-mode-dock-peek__bin-stack';
	for ( let i = 0; i < 3; i++ ) {
		const slip = document.createElement( 'span' );
		slip.className = 'desktop-mode-dock-peek__bin-slip';
		stack.appendChild( slip );
	}
	stage.appendChild( stack );

	const icon = document.createElement( 'span' );
	icon.className = `desktop-mode-dock-peek__bin-icon dashicons ${
		count === 0 ? 'dashicons-trash' : 'dashicons-trash'
	}`;
	stage.appendChild( icon );

	root.appendChild( stage );

	const label = document.createElement( 'span' );
	label.className = 'desktop-mode-dock-peek__bin-label';
	if ( count === 0 ) {
		label.textContent = __( 'Trash — empty' );
	} else if ( count === 1 ) {
		label.textContent = __( '1 item' );
	} else if ( count > 99 ) {
		label.textContent = '99+ items';
	} else {
		// translators: %d is the number of items in the recycle bin.
		label.textContent = `${ count } items`;
	}
	root.appendChild( label );

	return root;
}

/* ──────────────────────────────────────────────────────────────────
   Hook bus accessor — duplicated from `src/hooks.ts` so this module
   doesn't pull the full hooks framework into the load path. The bus
   is mounted on `window.wp.hooks` by the time we're called from
   `desktop.ts`.
   ────────────────────────────────────────────────────────────────── */

interface FakeWpHooks {
	addFilter: (
		hookName: string,
		ns: string,
		cb: ( ...a: unknown[] ) => unknown,
	) => void;
}

function getWpHooks(): FakeWpHooks | null {
	const wp = ( window as unknown as { wp?: { hooks?: FakeWpHooks } } ).wp;
	return wp?.hooks ?? null;
}
