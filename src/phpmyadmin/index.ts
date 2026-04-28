/**
 * phpMyAdmin window — render-callback entry.
 *
 * Mounts an `<iframe>` pointing at the bundled phpMyAdmin install
 * (`assets/vendor/phpmyadmin/index.php`). All UI / DB query handling
 * happens server-side inside that iframe — this shell does nothing
 * more than position the frame, hand it the URL the server localized,
 * and surface a friendly error if the bundle is missing.
 *
 * Same render-callback contract as the Code editor: registers a
 * function on `window.wpDesktopNativeWindows['wpdc-phpmyadmin']`; the
 * native-window manager invokes it the first time the user opens the
 * window, after the PHP-rendered template has been cloned into the
 * window body.
 *
 * @public
 * @since 0.19.0
 */

// Empty export turns this file into a TypeScript module — required for
// the `declare global` augmentation below to be picked up. The file has
// no other imports today; the IIFE bundle output stays the same shape.
export {};

type RenderCallback = ( body: HTMLElement ) => void;

interface PhpMyAdminConfig {
	vendorUrl: string;
}

declare global {
	interface Window {
		wpDesktopNativeWindows?: Record< string, RenderCallback | undefined >;
		wpDesktopPhpMyAdminConfig?: PhpMyAdminConfig;
	}
}

const ROOT_SELECTOR = '[data-wpdc-phpmyadmin-root]';

function getConfig(): PhpMyAdminConfig | null {
	const cfg = window.wpDesktopPhpMyAdminConfig;
	if ( ! cfg || typeof cfg.vendorUrl !== 'string' || cfg.vendorUrl === '' ) {
		return null;
	}
	return cfg;
}

function renderError( root: HTMLElement, message: string ): void {
	root.innerHTML = '';
	const wrap = document.createElement( 'div' );
	wrap.className = 'wpdc-phpmyadmin__error';
	wrap.textContent = message;
	root.appendChild( wrap );
}

function renderPhpMyAdmin( body: HTMLElement ): void {
	const root = body.querySelector< HTMLElement >( ROOT_SELECTOR );
	if ( ! root ) {
		return;
	}
	const cfg = getConfig();
	if ( ! cfg ) {
		renderError(
			root,
			'phpMyAdmin is not available — bundle missing or configuration not loaded.',
		);
		return;
	}

	root.innerHTML = '';
	const iframe = document.createElement( 'iframe' );
	iframe.className = 'wpdc-phpmyadmin__frame';
	// Cache-bust: phpMyAdmin's response varies based on which DbiMysqli
	// adapter is in place (stock vs. our SQLite overlay), but the URL
	// stays the same. Without a buster, browsers serve stale iframe
	// HTML from a previous environment after the user moves the plugin
	// between installs (e.g. SQLite-backed → MySQL).
	iframe.src = cfg.vendorUrl + '/index.php?_=' + Date.now();
	iframe.title = 'phpMyAdmin';
	// Same-origin (plugin URL) — allow scripts/forms/popups so phpMyAdmin
	// works as if loaded directly. allow-same-origin keeps cookies and
	// session storage available for its own auth state.
	iframe.setAttribute(
		'sandbox',
		'allow-scripts allow-forms allow-same-origin allow-popups allow-modals allow-downloads',
	);
	root.appendChild( iframe );
}

const registry = ( window.wpDesktopNativeWindows ??
	( window.wpDesktopNativeWindows = {} ) ) as Record<
	string,
	RenderCallback | undefined
>;
registry[ 'wpdc-phpmyadmin' ] = ( body: HTMLElement ) => {
	renderPhpMyAdmin( body );
};
