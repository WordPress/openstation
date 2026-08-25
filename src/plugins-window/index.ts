/**
 * Native Plugins window — render entry point.
 *
 * Lazy-loaded by the native-window sync the first time the
 * `desktop-mode-plugins` window opens. Wires the two-tab shell
 * (Installed / Discover) and the detail flyout against the template
 * echoed by `openstation_plugins_window_render_template()`.
 *
 * Web-component registrations: the main `desktop.min.js` ships only
 * the `<os-*>` tags it constructs itself. This bundle leaf-imports
 * the additional ones it needs (`<os-table>`, `<os-card>`,
 * `<os-badge>`). `defineComponent()` is idempotent so re-importing
 * a tag main also ships is safe (just inert).
 *
 * @public
 */

import { __ } from '../i18n';
// Side-effect imports — register the `<os-*>` components this
// bundle constructs that the main shell does not ship.
import '../ui/components/os-table/os-table';
import '../ui/components/os-card/os-card';
import '../ui/components/os-badge/os-badge';
// `<os-flyout data-os-plugins-flyout>` is emitted by the
// PHP template (`includes/plugins-window/window.php`), never built via
// `document.createElement` in this bundle — so the per-bundle lint
// rule that scans `createElement('os-*')` doesn't see it. Register
// the class explicitly so the server-rendered element upgrades.
import '../ui/components/os-flyout/os-flyout';
import { mountBrowseView } from './browse-view';
import { mountInstalledView } from './installed-view';
import { getConfig } from './rest';
import {
	consumePluginsWindowTab,
	subscribePluginsWindowTab,
	type PluginsWindowTab,
} from './tab-target';

/**
 * Tag every native-window registry slot the same way the recycle-bin
 * + posts-window bundles do. Returning a teardown is wired internally
 * via the `os-window-closed` event.
 */
type RenderCallback = ( body: HTMLElement ) => void;

declare global {
	interface Window {
		openStationNativeWindows?: Record< string, RenderCallback | undefined >;
	}
}

export type { PluginsWindowConfig } from './rest';

/**
 * Render entry. Called by the framework's native-window sync once
 * the template has been cloned into the body.
 */
function renderPluginsWindow( body: HTMLElement ): void {
	const root = body.querySelector< HTMLElement >(
		'[data-os-plugins-root]',
	);
	if ( ! root ) {
		body.innerHTML =
			'<p style="padding:20px;color:var(--os-ui-fg-muted,#666);">' +
			__( 'Plugins window template missing.', 'desktop-mode' ) +
			'</p>';
		return;
	}

	const config = getConfig();
	const tabs = root.querySelector< HTMLElement >(
		'[data-os-plugins-tabs]',
	);

	// ─── Installed tab ─────────────────────────────────────────────
	const installedHost = root.querySelector< HTMLElement >(
		'[data-os-plugins-installed-host]',
	);
	let installedTeardown: ( () => void ) | null = null;
	if ( installedHost ) {
		if ( config.caps.activate ) {
			installedTeardown = mountInstalledView( installedHost );
		} else {
			installedHost.replaceChildren();
			const msg = document.createElement( 'p' );
			msg.style.padding = '20px';
			msg.style.color = 'var(--os-ui-fg-muted, #666)';
			msg.textContent = __(
				'You do not have permission to manage plugins.',
				'desktop-mode',
			);
			installedHost.appendChild( msg );
		}
	}

	// ─── Discover tab ───────────────────────────────────────────────
	const browseHost = root.querySelector< HTMLElement >(
		'[data-os-plugins-browse-host]',
	);
	const flyout = root.querySelector< HTMLElement >(
		'[data-os-plugins-flyout]',
	);
	let browseTeardown: ( () => void ) | null = null;
	if ( browseHost && config.caps.install ) {
		browseTeardown = mountBrowseView( browseHost, flyout, body );
	}

	// ─── Tab routing ───────────────────────────────────────────────
	const applyTab = ( tab: PluginsWindowTab ): void => {
		if ( ! tabs ) {
			return;
		}
		// `featured` used to be a top-level tab. Keep it as an inbound
		// compatibility alias so third-party launchers land on the
		// curated shelf inside Discover instead of selecting a missing
		// tab panel.
		const target = tab === 'featured' ? 'browse' : tab;
		if ( target === 'browse' && ! config.caps.install ) {
			tabs.setAttribute( 'value', 'installed' );
			return;
		}
		tabs.setAttribute( 'value', target );
	};

	// The tabs live in the PHP template while their component classes
	// are registered by the already-running desktop bundle. Keep a
	// light-DOM click bridge here so a click still selects the panel if
	// the shadow button's internal `os-tab-pick` listener was stamped
	// before this lazy bundle mounted. Keyboard selection continues to
	// be owned by `<os-tabs>` itself.
	const onTabClick = ( ev: Event ): void => {
		const picked = ev
			.composedPath()
			.find(
				( node ): node is HTMLElement =>
					node instanceof HTMLElement && node.matches( 'os-tab[value]' ),
			);
		const value = picked?.getAttribute( 'value' );
		if ( value === 'installed' || value === 'browse' || value === 'featured' ) {
			applyTab( value );
		}
	};
	tabs?.addEventListener( 'click', onTabClick );

	const initialTab = consumePluginsWindowTab();
	if ( initialTab ) {
		applyTab( initialTab );
	}

	const unsubscribeTab = subscribePluginsWindowTab( ( state ) => {
		if ( state.tab ) {
			applyTab( state.tab );
		}
	} );

	// Cleanup on window close. The framework dispatches the event on
	// `document` with `detail.windowId` matching the window being torn
	// down — we only fire teardown for our own id.
	const onClosed = ( ev: Event ): void => {
		const detail = ( ev as CustomEvent< { windowId?: string } > ).detail;
		if ( detail?.windowId !== 'desktop-mode-plugins' ) {
			return;
		}
		document.removeEventListener( 'os-window-closed', onClosed );
		tabs?.removeEventListener( 'click', onTabClick );
		unsubscribeTab();
		if ( installedTeardown ) {
			installedTeardown();
			installedTeardown = null;
		}
		if ( browseTeardown ) {
			browseTeardown();
			browseTeardown = null;
		}
	};
	document.addEventListener( 'os-window-closed', onClosed );
}

const registry = ( window.openStationNativeWindows ??= {} );
registry[ 'desktop-mode-plugins' ] = ( body: HTMLElement ) => {
	renderPluginsWindow( body );
};
