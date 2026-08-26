/**
 * Native Plugins window — render entry point.
 *
 * Lazy-loaded by the native-window sync the first time the
 * `desktop-mode-plugins` window opens. Wires the two-tab shell
 * (Installed / Browse) and the detail flyout against the template
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
import { mountFeaturedView } from './featured-view';
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

	// ─── Browse tab ─────────────────────────────────────────────────
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

	// ─── Featured tab ───────────────────────────────────────────────
	const featuredHost = root.querySelector< HTMLElement >(
		'[data-os-plugins-featured-host]',
	);
	let featuredTeardown: ( () => void ) | null = null;
	if ( featuredHost && config.caps.install ) {
		featuredTeardown = mountFeaturedView( featuredHost, flyout );
	}

	// ─── Tab routing ───────────────────────────────────────────────
	const applyTab = ( tab: PluginsWindowTab ): void => {
		if ( ! tabs ) {
			return;
		}
		// Browse + Featured share the `caps.install` gate — never auto-
		// flip the tab somewhere the viewer can't see.
		if (
			( tab === 'browse' || tab === 'featured' ) &&
			! config.caps.install
		) {
			tabs.setAttribute( 'value', 'installed' );
			return;
		}
		tabs.setAttribute( 'value', tab );
	};

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
		unsubscribeTab();
		if ( installedTeardown ) {
			installedTeardown();
			installedTeardown = null;
		}
		if ( browseTeardown ) {
			browseTeardown();
			browseTeardown = null;
		}
		if ( featuredTeardown ) {
			featuredTeardown();
			featuredTeardown = null;
		}
	};
	document.addEventListener( 'os-window-closed', onClosed );
}

const registry = ( window.openStationNativeWindows ??= {} );
registry[ 'desktop-mode-plugins' ] = ( body: HTMLElement ) => {
	renderPluginsWindow( body );
};
