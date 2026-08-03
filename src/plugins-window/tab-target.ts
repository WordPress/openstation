/**
 * Tiny shared-store holder for the Plugins window's pending initial
 * tab hint.
 *
 * The dock-click URL remap fires BEFORE the window opens. When the
 * remap matches `plugin-install.php` we want the window to land on
 * the "Browse" tab, not "Installed" — but `openById` doesn't carry
 * per-open state. We stash the hint in a shared store the render
 * callback reads back on first paint, then clear so the next open
 * without an explicit hint defaults to "installed".
 *
 * Shared via `wp.os.createSharedStore` (see CLAUDE.md
 * "Cross-bundle state") so the same module loaded into different
 * bundles is the single source of truth.
 */

interface SharedStoreApi< T > {
	state: T;
	notify(): void;
	subscribe( cb: ( state: T ) => void ): () => void;
}

interface DesktopFacade {
	createSharedStore?: < T >(
		key: string,
		initial: () => T,
	) => SharedStoreApi< T >;
}

export type PluginsWindowTab = 'installed' | 'browse' | 'featured';

interface TabTargetState {
	tab: PluginsWindowTab | null;
	requestedAt: number;
}

const _initial: TabTargetState = {
	tab: null,
	requestedAt: 0,
};

let _store: SharedStoreApi< TabTargetState > | null = null;
function getStore(): SharedStoreApi< TabTargetState > | null {
	if ( _store ) {
		return _store;
	}
	const w = window as unknown as { wp?: { os?: DesktopFacade } };
	const factory = w.wp?.os?.createSharedStore;
	if ( typeof factory !== 'function' ) {
		return null;
	}
	_store = factory< TabTargetState >(
		'desktop-mode/plugins-window/tab-target',
		() => ( { ..._initial } ),
	);
	return _store;
}

/**
 * Set the tab the next window open should land on. Must be called
 * BEFORE `openById( 'desktop-mode-plugins' )`.
 */
export function setPluginsWindowTab( tab: PluginsWindowTab ): void {
	const store = getStore();
	if ( store ) {
		store.state.tab = tab;
		store.state.requestedAt = Date.now();
		store.notify();
		return;
	}
	const w = window as unknown as { _wpdPluginsWindowTab?: TabTargetState };
	w._wpdPluginsWindowTab = { tab, requestedAt: Date.now() };
}

/**
 * Read (and consume) the pending tab hint. Returns `null` when no
 * hint was set — the caller should default to "installed".
 */
export function consumePluginsWindowTab(): PluginsWindowTab | null {
	const store = getStore();
	if ( store ) {
		const tab = store.state.tab;
		if ( tab !== null ) {
			store.state.tab = null;
			store.state.requestedAt = 0;
			store.notify();
		}
		return tab;
	}
	const w = window as unknown as { _wpdPluginsWindowTab?: TabTargetState };
	const prev = w._wpdPluginsWindowTab;
	if ( prev ) {
		w._wpdPluginsWindowTab = { tab: null, requestedAt: 0 };
		return prev.tab;
	}
	return null;
}

/**
 * Subscribe to tab-target changes — used by the render callback so
 * a second click on the dock with a different hint can flip the tab
 * without reopening the window.
 */
export function subscribePluginsWindowTab(
	cb: ( state: TabTargetState ) => void,
): () => void {
	const store = getStore();
	if ( ! store ) {
		return () => {};
	}
	return store.subscribe( ( state ) => cb( { ...state } ) );
}
