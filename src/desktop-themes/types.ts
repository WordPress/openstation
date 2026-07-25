/**
 * Desktop-theme types shared across the shell bundle.
 *
 * Deliberately dependency-free so `src/desktop-themes/` can stay a
 * ~2–3 kB leaf of the always-on shell bundle. No lit, no `<wpd-*>`
 * imports — the heavy picker UI lives in the lazy OS Settings panel
 * bundle instead.
 *
 * @since 0.9.7
 */

/**
 * One entry in the desktop-theme library, as the shell sees it.
 *
 * PHP owns everything here. Uploaded themes carry a `cssUrl` (a real
 * compiled file on disk); code-registered themes carry `cssText`
 * instead, because there is no file to link.
 *
 * @public
 * @since 0.9.7
 */
export interface DesktopThemeEntry {
	/** Manifest id — `neon-glass` or `vendor/neon-glass`. */
	id: string;
	/** Storage slug: the id with `/` flattened to `-`. */
	slug: string;
	/** Display name. */
	name: string;
	/** Author-declared version string. May be empty. */
	version: string;
	/** Author name. May be empty. */
	author: string;
	/** Short description. May be empty. */
	description: string;
	/** Absolute URL of the preview image, or `''`. */
	previewUrl: string;
	/** Absolute URL of the compiled stylesheet (uploaded themes). */
	cssUrl: string;
	/** Compiled stylesheet text (code-registered themes). */
	cssText: string;
	/** Compiled design tokens, informational (the CSS is authoritative). */
	tokens: Record< string, string >;
	/**
	 * Font families the theme bundles, in declaration order and
	 * de-duplicated across weights. Informational — the compiled
	 * stylesheet carries the `@font-face` rules that actually load
	 * them. Empty for a theme that ships no fonts.
	 *
	 * @since 0.9.8
	 */
	fonts: string[];
	/**
	 * Slot => paintable icon string. Values are either a
	 * `dashicons-*` class or an absolute `http(s)` / `data:image/`
	 * URL. Slots this theme doesn't override are simply absent —
	 * that absence IS the "fall back to the system default" contract.
	 */
	icons: Record< string, string >;
	/**
	 * Slot => fill colour, for the slots the theme wants tinted. A
	 * slot absent from this map keeps its default rendering; a slot
	 * present in it is painted as a tinted CSS mask (images) or with
	 * that `color` (dashicons). The literal `currentColor` defers to
	 * whatever the surface is already using for text.
	 *
	 * @since 0.9.8
	 */
	iconColors: Record< string, string >;
	/** Unix timestamp of installation (uploads only; `0` for code). */
	installedAt: number;
	/** Where the theme came from. */
	source: 'upload' | 'code';
}

/** Shape of the shared registry state. */
export interface DesktopThemeState {
	/** The library, in the order PHP shipped it. */
	themes: DesktopThemeEntry[];
	/**
	 * Slug of the active theme, or `null` for the system default.
	 *
	 * `null` is the hot-path sentinel: {@link resolveThemedIcon}
	 * checks `activeIcons === null` and returns immediately, so an
	 * unthemed shell pays one strict-equality check per icon render.
	 */
	activeId: string | null;
	/** Icon map of the active theme, or `null` when unthemed. */
	activeIcons: Record< string, string > | null;
	/**
	 * Icon tint map of the active theme, or `null` when unthemed.
	 * Same null-is-the-fast-path contract as {@link activeIcons}.
	 *
	 * @since 0.9.8
	 */
	activeIconColors: Record< string, string > | null;
}
