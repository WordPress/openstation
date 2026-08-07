/**
 * Cross-bundle layout single-source-of-truth.
 *
 * **Why this exists.** The layout dispatcher (`src/desktop-layout.ts`)
 * owns the dock instances and the rebuild logic for the three
 * top-level layouts (`classic`, `unified`, `spatial`). The OsSettings
 * snapshot owns the *current* selection. Until 0.8.1 there was no
 * cross-bundle helper for "what layout am I in right now?" — every
 * consumer (a feature bundle, a third-party plugin) had to thread
 * the snapshot in or read `data-os-layout` off the shell
 * root.
 *
 * This module is a tiny shared store keyed under
 * `desktop-mode/layout`. The shell publishes the active layout
 * here whenever it changes; any consumer that wants a synchronous
 * read can call `getCurrentLayout()` and any consumer that needs
 * change notifications calls `subscribeLayout()`.
 *
 * Backed by `createSharedStore` so a registration from one bundle
 * (the main shell) is visible to every other bundle (recycle bin,
 * posts window, plugin extras).
 */

import { createSharedStore } from '../shared-store';
import type { DesktopLayoutId } from './types';

interface LayoutState {
	layout: DesktopLayoutId;
}

const store = createSharedStore< LayoutState >( 'desktop-mode/layout', () => ( {
	// Default mirrors the OsSettingsSnapshot default; the shell
	// re-publishes the persisted value as soon as it boots.
	layout: 'classic',
} ) );

/**
 * Read the active layout synchronously.
 */
export function getCurrentLayout(): DesktopLayoutId {
	return store.state.layout;
}

/**
 * Publish the active layout. The shell calls this every time the
 * dispatcher rebuilds; plugin code should NOT call this — the
 * source of truth is OS Settings.
 *
 * @internal
 */
export function setCurrentLayout( layout: DesktopLayoutId ): void {
	if ( store.state.layout === layout ) {
		return;
	}
	store.state.layout = layout;
	store.notify();
}

/**
 * Subscribe to layout changes. Returns an unsubscribe function.
 *
 * The callback fires synchronously inside `setCurrentLayout` —
 * after the value has been written. Note the shell publishes here
 * after `os-layout-changed` has already been dispatched
 * on `document`.
 */
export function subscribeLayout(
	cb: ( layout: DesktopLayoutId ) => void,
): () => void {
	return store.subscribe( ( state ) => cb( state.layout ) );
}

export type { DesktopLayoutId } from './types';
