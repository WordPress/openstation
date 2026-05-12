/**
 * About — full-canvas PixiJS particle scene.
 *
 * The "wow effect" tab. The entire tabpanel is a single Pixi canvas
 * — credit text, title, version, and the AUTOMATTIC logotype
 * (formed by particles) are all rendered inside the same WebGL
 * surface. No HTML header.
 *
 * The heavy lifting lives in {@link mountAboutScene}; this module's
 * job is to:
 *
 *   - render a full-size canvas host into the tabpanel
 *   - kick off `wp.desktop.loadModules(['pixijs'])` so the vendor
 *     script is in memory before the scene mounts
 *   - mount on first attach, tear down when the wrapper leaves the
 *     DOM (panel re-render, OS Settings window closed). We watch for
 *     removal via a `MutationObserver` on `document.body` so we don't
 *     leak the WebGL context across re-renders triggered by the
 *     settings-tab registry, save-failure rollbacks, or a Reset.
 *
 * @since 0.8.0
 */

import { __ } from '../../i18n';
import { html, render } from '../../ui/core';
import {
	mountAboutSceneLazy,
	type AboutScene,
} from './about-scene-loader';

interface DesktopGlobalShape {
	pluginUrl?: string;
	pluginVersion?: string;
	aboutSceneBundleUrl?: string;
}

interface DesktopApiShape {
	loadModules?: ( ids: string[] ) => Promise<void>;
}

/**
 * Resolve once `el` has a non-zero content box. Uses a `ResizeObserver`
 * to wake up on the first measurable size (covers the `display:none →
 * block` tab-switch flip) and falls back to a synchronous resolve when
 * the element is already sized at call time.
 */
function waitForSize( el: HTMLElement ): Promise<void> {
	if ( el.clientWidth > 0 && el.clientHeight > 0 ) {
		return Promise.resolve();
	}
	return new Promise( ( resolve ) => {
		const observer = new ResizeObserver( () => {
			if ( el.clientWidth > 0 && el.clientHeight > 0 ) {
				observer.disconnect();
				resolve();
			}
		} );
		observer.observe( el );
	} );
}

/**
 * Builder — returns the About section element ready to drop into the
 * OS Settings tabpanel. The Pixi mount is deferred until the wrapper
 * is in the DOM (next animation frame), so the section can be safely
 * embedded inside a hidden tabpanel without spinning up a canvas on
 * a zero-size host. A ResizeObserver picks up the visibility flip
 * once the user activates the tab.
 */
export function buildAboutSection(): HTMLElement {
	const wrapper = document.createElement( 'div' );
	wrapper.classList.add( 'desktop-mode-os-settings__about' );

	const config = (
		window as unknown as { desktopModeConfig?: DesktopGlobalShape }
	).desktopModeConfig ?? {};
	const pluginUrl = config.pluginUrl ?? '';
	const version = config.pluginVersion ?? '';
	const aboutSceneBundleUrl = config.aboutSceneBundleUrl ?? '';

	const desktopApi = ( window.wp as { desktop?: DesktopApiShape } | undefined )
		?.desktop;

	render(
		html`
			<div
				class="desktop-mode-os-settings__about-stage-host"
				data-about-stage
			></div>
		`,
		wrapper,
	);

	let scene: AboutScene | null = null;
	let aborted = false;

	const tearDown = (): void => {
		aborted = true;
		if ( scene ) {
			try {
				scene.destroy();
			} catch {
				// best-effort
			}
			scene = null;
		}
	};

	const mount = async (): Promise<void> => {
		if ( aborted || ! wrapper.isConnected ) {
			return;
		}
		const host = wrapper.querySelector< HTMLElement >( '[data-about-stage]' );
		if ( ! host ) {
			return;
		}
		try {
			if ( desktopApi?.loadModules ) {
				await desktopApi.loadModules( [ 'pixijs' ] );
			}
			if ( aborted || ! wrapper.isConnected ) {
				return;
			}
			// Wait until the host has a real layout box before letting
			// Pixi init. About is usually built inside a `display: none`
			// tabpanel (Appearance is the default tab) — initialising
			// Pixi against a zero-size container makes its `resizeTo`
			// fall back to 1×1, and the subsequent `display:none → block`
			// flip doesn't always trigger a ResizeObserver fire in time,
			// leaving the scene stuck at a single pixel.
			await waitForSize( host );
			if ( aborted || ! wrapper.isConnected ) {
				return;
			}
			const built = await mountAboutSceneLazy(
				{
					container: host,
					logoUrl: `${ pluginUrl }/assets/images/automattic-logotype-color.png`,
					prefersReducedMotion:
						typeof window.matchMedia === 'function' &&
						window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches,
					labels: {
						eyebrow: __( 'WordPress Desktop Mode' ),
						title: __( 'Crafted with curiosity' ),
						byline: __( 'an experiment by Automattic' ),
						version: version
							? `${ __( 'Version' ) } ${ version }`
							: '',
						hint: __( 'Move your cursor through the swarm · click for a spark' ),
					},
				},
				aboutSceneBundleUrl,
			);
			if ( aborted || ! wrapper.isConnected ) {
				built.destroy();
				return;
			}
			scene = built;
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				// eslint-disable-next-line no-console
				console.error( '[desktop-mode/about] scene mount failed:', err );
			}
		}
	};

	// Defer the Pixi mount until the wrapper is in the DOM. The OS
	// Settings panel renders the section synchronously into a
	// tabpanel, but the panel itself isn't attached yet at the moment
	// `buildAboutSection()` runs — we'd be measuring a zero-size host.
	requestAnimationFrame( () => {
		void mount();
	} );

	// Tear down when the wrapper leaves the DOM. The settings panel
	// re-renders on Reset, on save-failure rollback, and on every
	// settings-tab registry mutation; without this, every re-render
	// would leak a Pixi.Application and its WebGL context.
	const observer = new MutationObserver( () => {
		if ( ! wrapper.isConnected ) {
			tearDown();
			observer.disconnect();
		}
	} );
	observer.observe( document.body, { childList: true, subtree: true } );

	return wrapper;
}
