/**
 * OpenStation — service-worker caching policy.
 *
 * Pure decision logic for the SW's shared admin-asset cache, split out
 * of `sw.ts` so it can be unit-tested (the SW bundle itself runs in a
 * worker global scope vitest can't host). No SW globals in here — every
 * function takes plain values and returns a verdict; `sw.ts` owns the
 * Cache Storage side effects.
 *
 * The admin-asset cache is the layer that makes every window share one
 * origin-wide cache: the root-scope SW sees asset requests from the
 * shell AND from every chromeless iframe, so a stylesheet fetched by
 * one window is served from Cache Storage to every later window.
 */

/**
 * Runtime configuration handed to the SW by the PHP endpoint that
 * serves it (`openstation_pwa_serve_service_worker()`), as a
 * `self.__OS_SW_CONFIG = {...};` preamble ahead of the bundle bytes.
 */
export interface SwConfig {
	/**
	 * Whether the shared admin-asset cache is on. Off by default —
	 * operators opt in via the `openstation_pwa_admin_asset_cache`
	 * PHP filter.
	 */
	adminAssetCache: boolean;
	/**
	 * Whether hover prewarming is on for this user. Gates the
	 * speculative-document hand-off: the shell asks for a screen on
	 * hover, the worker fetches and holds it, and the iframe's
	 * navigation is answered from those bytes.
	 */
	windowPrewarm: boolean;
	/**
	 * Absolute URL of the plugin directory (trailing slash). Lets the
	 * SW resolve its own asset paths on hosts with a non-default
	 * `wp-content` layout (Bedrock, moved `WP_CONTENT_DIR`, …).
	 */
	pluginUrl: string;
}

/**
 * How the fetch handler should treat a same-origin GET:
 *
 *   - `own-plugin` — this plugin's own asset; the pre-existing
 *     precache / network-first / stale-while-revalidate branches own
 *     it. Classified here so the precedence is pinned by tests.
 *   - `core-cache-first` — a Core-shipped static asset (or a
 *     `load-scripts.php` / `load-styles.php` concat blob). The URL
 *     embeds `ver=<wp_version>`, so the bytes behind a given URL only
 *     change when the URL changes — the same immutability contract
 *     Core itself expresses by serving the loader endpoints with
 *     `Cache-Control: public, max-age=31536000`. Exact-URL cache-first.
 *   - `content-swr` — another plugin's or a theme's versioned static
 *     asset. Same `?ver=` contract in principle, but authors edit
 *     files without bumping versions often enough that cache-first
 *     would pin stale bytes until the SW version bumps. Stale-while-
 *     revalidate serves instantly from cache and self-heals next load.
 *   - `bypass` — everything else: HTML, REST, AJAX, uploads,
 *     unversioned URLs. The SW leaves these entirely alone.
 */
export type AdminAssetClass =
	| 'own-plugin'
	| 'core-cache-first'
	| 'content-swr'
	| 'bypass';

const STATIC_EXTENSION_RE =
	/\.(css|js|png|jpg|jpeg|svg|webp|woff2?|ttf|gif|ico)$/i;

const LOADER_ENDPOINT_RE = /\/wp-admin\/load-(scripts|styles)\.php$/;

/**
 * Parses the `self.__OS_SW_CONFIG` preamble value defensively.
 *
 * A SW body cached before the preamble existed (or a mangled encode)
 * must still boot with the feature off and the conventional plugin
 * path — never throw, never enable anything by accident.
 *
 * @param raw               Whatever `self.__OS_SW_CONFIG` holds.
 * @param fallbackPluginUrl Plugin URL used when the preamble is
 *                          absent or unusable.
 */
export function readSwConfig(
	raw: unknown,
	fallbackPluginUrl: string,
): SwConfig {
	const cfg: SwConfig = {
		adminAssetCache: false,
		windowPrewarm: false,
		pluginUrl: fallbackPluginUrl,
	};
	if ( ! raw || typeof raw !== 'object' ) {
		return cfg;
	}
	const obj = raw as Record< string, unknown >;
	cfg.adminAssetCache = obj.adminAssetCache === true;
	cfg.windowPrewarm = obj.windowPrewarm === true;
	if (
		typeof obj.pluginUrl === 'string' &&
		obj.pluginUrl.startsWith( 'http' )
	) {
		try {
			// Validate it parses; keep the string form.
			void new URL( obj.pluginUrl );
			cfg.pluginUrl = obj.pluginUrl.endsWith( '/' )
				? obj.pluginUrl
				: obj.pluginUrl + '/';
		} catch {
			// Keep the fallback.
		}
	}
	return cfg;
}

/**
 * Classifies a same-origin GET URL for the shared admin-asset cache.
 *
 * Path matching uses `includes()` rather than `startsWith()` so
 * subdirectory installs (`/site2/wp-admin/…`, WP in `/wp/`) classify
 * the same as root installs — consistent with the existing own-plugin
 * matcher in `sw.ts`.
 *
 * @param url           Parsed request URL (same-origin, GET).
 * @param ownPluginPath Pathname fragment of this plugin's directory
 *                      (e.g. `/wp-content/plugins/desktop-mode/`).
 */
export function classifyAdminAssetRequest(
	url: URL,
	ownPluginPath: string,
): AdminAssetClass {
	const path = url.pathname;

	if ( path.includes( ownPluginPath ) ) {
		return 'own-plugin';
	}

	// The concat loader endpoints are PHP, but their URL embeds the
	// handle list and `ver=<wp_version>` — cacheable exactly like a
	// static file, per Core's own response headers.
	if ( LOADER_ENDPOINT_RE.test( path ) && url.searchParams.has( 'ver' ) ) {
		return 'core-cache-first';
	}

	if ( ! STATIC_EXTENSION_RE.test( path ) ) {
		return 'bypass';
	}
	if ( ! url.searchParams.has( 'ver' ) ) {
		// No cache-buster → no immutability contract → not ours to
		// cache. The browser HTTP cache still applies as usual.
		return 'bypass';
	}
	if ( path.includes( '/wp-content/uploads/' ) ) {
		// Media dominates quota and churns outside the `?ver=`
		// contract (thumbnail regeneration keeps the URL). Excluded.
		return 'bypass';
	}
	if ( path.includes( '/wp-admin/' ) || path.includes( '/wp-includes/' ) ) {
		return 'core-cache-first';
	}
	if (
		path.includes( '/wp-content/plugins/' ) ||
		path.includes( '/wp-content/themes/' )
	) {
		return 'content-swr';
	}
	return 'bypass';
}

/**
 * Whether a fetched response is safe to put in the admin-asset cache.
 *
 * Rejects partial content (`cache.put` throws on 206, but we don't
 * rely on the throw), redirects (caching the redirect target under
 * the original URL desyncs later loads), opaque/error types, and
 * anything the origin explicitly marked uncacheable.
 *
 * @param status       `Response.status`.
 * @param type         `Response.type`.
 * @param redirected   `Response.redirected`.
 * @param cacheControl The response's `Cache-Control` header, if any.
 */
export function isCacheableResponse(
	status: number,
	type: string,
	redirected: boolean,
	cacheControl: string | null,
): boolean {
	if ( status !== 200 || redirected ) {
		return false;
	}
	if ( type !== 'basic' && type !== 'default' ) {
		return false;
	}
	if ( cacheControl ) {
		const cc = cacheControl.toLowerCase();
		if ( cc.includes( 'no-store' ) || cc.includes( 'private' ) ) {
			return false;
		}
	}
	return true;
}
