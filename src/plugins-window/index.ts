/**
 * Native Plugins window — render entry point.
 *
 * Lazy-loaded by the native-window sync the first time the
 * `desktop-mode-plugins` window opens. Wires the two-tab shell
 * (Installed / Browse) and the detail flyout against the template
 * echoed by `desktop_mode_plugins_window_render_template()`.
 *
 * The `<wpd-*>` web components are defined by the main desktop
 * bundle; this module only consumes them. Avoid any side-effect
 * imports from `src/ui/` so loading this bundle never tries to
 * re-`customElements.define()` an existing tag.
 *
 * @public
 * @since 0.9.0
 */

import { trackedFetch } from '../tracked-fetch';
import { __ } from '../i18n';
import { mountBrowseView } from './browse-view';
import { mountInstalledView } from './installed-view';
import { getConfig, type PluginsWindowConfig } from './rest';
import {
	consumePluginsWindowTab,
	subscribePluginsWindowTab,
	type PluginsWindowTab,
} from './tab-target';

/**
 * Tag every native-window registry slot the same way the recycle-bin
 * + posts-window bundles do. Returning a teardown is wired internally
 * via the `desktop-mode-window-closed` event.
 */
type RenderCallback = ( body: HTMLElement ) => void;

declare global {
	interface Window {
		desktopModeNativeWindows?: Record< string, RenderCallback | undefined >;
	}
}

export type { PluginsWindowConfig } from './rest';

/**
 * Render entry. Called by the framework's native-window sync once
 * the template has been cloned into the body.
 */
function renderPluginsWindow( body: HTMLElement ): void {
	const root = body.querySelector< HTMLElement >(
		'[data-desktop-mode-plugins-root]',
	);
	if ( ! root ) {
		body.innerHTML =
			'<p style="padding:20px;color:var(--wpd-fg-muted,#666);">' +
			__( 'Plugins window template missing.', 'desktop-mode' ) +
			'</p>';
		return;
	}

	const config = getConfig();
	const tabs = root.querySelector< HTMLElement >(
		'[data-desktop-mode-plugins-tabs]',
	);

	// ─── Installed tab ─────────────────────────────────────────────
	const installedHost = root.querySelector< HTMLElement >(
		'[data-desktop-mode-plugins-installed-host]',
	);
	let installedTeardown: ( () => void ) | null = null;
	if ( installedHost ) {
		if ( config.caps.activate ) {
			installedTeardown = mountInstalledView( installedHost );
		} else {
			installedHost.replaceChildren();
			const msg = document.createElement( 'p' );
			msg.style.padding = '20px';
			msg.style.color = 'var(--wpd-fg-muted, #666)';
			msg.textContent = __(
				'You do not have permission to manage plugins.',
				'desktop-mode',
			);
			installedHost.appendChild( msg );
		}
	}

	// ─── Browse tab ─────────────────────────────────────────────────
	const browseHost = root.querySelector< HTMLElement >(
		'[data-desktop-mode-plugins-browse-host]',
	);
	const flyout = root.querySelector< HTMLElement >(
		'[data-desktop-mode-plugins-flyout]',
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
		// Browse hidden when the viewer can't install — never auto-flip
		// the tab somewhere they can't see.
		if ( tab === 'browse' && ! config.caps.install ) {
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
		document.removeEventListener( 'desktop-mode-window-closed', onClosed );
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
	document.addEventListener( 'desktop-mode-window-closed', onClosed );

	// First-open intro — gated on `config.introSeen`. Lazy-loaded
	// (the dialog ships a chunk of inline-styled markup that we only
	// pay for when the dialog actually fires) so cold opens after
	// the first stay snappy.
	void maybeShowIntro( config );
}

/**
 * Module-scoped guard — block the dialog from re-opening within the same shell session
 *  if the user already dismissed it but the REST POST hasn't echoed back yet.
 */
let _introShown = false;

async function maybeShowIntro( config: PluginsWindowConfig ): Promise< void > {
	if ( _introShown || config.introSeen ) {
		return;
	}
	_introShown = true;
	try {
		const { showPluginsIntroDialog } = await import( './intro-dialog' );
		const result = await showPluginsIntroDialog();
		// `cancel` (Escape / backdrop click) intentionally does NOT
		// mark seen — it's our testing escape hatch so design
		// iteration doesn't require resetting OS Settings between
		// runs.
		if ( result === 'cancel' ) {
			_introShown = false;
			return;
		}
		void markIntroSeen( config );
		if ( result === 'settings' ) {
			openOsSettingsFeatures();
		}
	} catch {
		// Dialog mount failed; allow a re-open to retry.
		_introShown = false;
	}
}

async function markIntroSeen( config: PluginsWindowConfig ): Promise< void > {
	if ( ! config.introUrl ) {
		return;
	}
	try {
		await trackedFetch(
			config.introUrl,
			{
				method: 'POST',
				credentials: 'same-origin',
				headers: {
					'Content-Type': 'application/json',
					'X-WP-Nonce': config.restNonce,
				},
				body: JSON.stringify( { slug: 'plugins' } ),
			},
			{
				windowId: 'desktop-mode-plugins',
				source: 'plugins-window/intro',
			},
		);
		// Mirror the server flag locally so a re-open inside the
		// same shell session doesn't re-fire the dialog.
		( config as { introSeen: boolean } ).introSeen = true;
	} catch {
		// Swallow — worst case is showing the intro once more.
	}
}

function openOsSettingsFeatures(): void {
	const api = ( window as unknown as {
		wp?: { desktop?: { openOsSettings?: ( tab?: string ) => void } };
	} ).wp?.desktop;
	if ( typeof api?.openOsSettings === 'function' ) {
		api.openOsSettings( 'features' );
	}
}

const registry = ( window.desktopModeNativeWindows ??= {} );
registry[ 'desktop-mode-plugins' ] = ( body: HTMLElement ) => {
	renderPluginsWindow( body );
};
