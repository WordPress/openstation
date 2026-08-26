/**
 * Desktop-theme types shared across the shell bundle.
 *
 * Deliberately dependency-free so `src/desktop-themes/` can stay a
 * ~2–3 kB leaf of the always-on shell bundle. No lit, no `<os-*>`
 * imports — the heavy picker UI lives in the lazy OS Settings panel
 * bundle instead.
 */

/**
 * Presentation preferences a theme would like the user to be wearing
 * alongside it — the dock large, the layout unified, the corners
 * round.
 *
 * Every field is optional, and a field a theme doesn't name is simply
 * not touched. These are **recommendations**: the shell writes them
 * into the user's OS Settings once, the first time that user
 * activates the theme, and never again. A user who later changes any
 * of them keeps their choice, including across re-activations of the
 * same theme.
 *
 * Sanitized by PHP against
 * `openstation_desktop_theme_recommended_os_settings_schema()` and
 * re-checked in {@link normalizeEntry} — the payload passes through a
 * filter after sanitization, so the shell never treats it as trusted.
 *
 * @public
 */
export interface RecommendedOsSettings {
	/** `compact` | `default` | `large`. */
	dockSize?: string;
	/** `classic` | `unified`. */
	desktopLayout?: string;
	/**
	 * `bottom` | `left` | `right` — which edge the single dock sits on.
	 * Only the one-rail layouts read it; `classic` derives both of its
	 * rails from the layout.
	 */
	dockPlacement?: string;
	/** `sharp` | `default` | `round`. */
	windowRadius?: string;
	/**
	 * `static` | `dynamic` | `hidden` — how the WordPress admin bar
	 * presents above the shell. A theme that wants an edge-to-edge
	 * desk recommends `dynamic` (auto-hide, reveals on hover) or
	 * `hidden`.
	 */
	adminBarMode?: string;
	/**
	 * Dock rail-renderer id. Unlike the enums above, validity is
	 * only knowable at runtime — the apply pass drops this key when no
	 * renderer is registered under the id, rather than writing an
	 * unresolvable value into the user's settings.
	 */
	dockRailRenderer?: string;
	/**
	 * Window-reveal id — the transition that uncovers a window's
	 * content once it has loaded. Same runtime-validity story as
	 * {@link dockRailRenderer}: the apply pass drops the key when no
	 * reveal is registered under the id. `'none'` is always valid; it
	 * is the "no reveal" sentinel rather than a registration.
	 */
	windowReveal?: string;
	/**
	 * Global reveal duration in ms, overriding each reveal's own
	 * timing. The one numeric recommendation — clamped to 80–4000.
	 * Omit it (rather than recommending `0`) to leave the user's speed
	 * alone.
	 */
	windowRevealDuration?: number;
	/**
	 * Accent swatch id (OS Settings → Appearance). Same runtime-
	 * validity story as {@link dockRailRenderer}: the list is
	 * filterable in PHP, so the apply pass drops the key when the site
	 * offers no swatch under that id.
	 *
	 * This is the one recommendation a theme cannot express any other
	 * way. The accent is written as an inline style on the shell
	 * document, which outranks every stylesheet — so a palette can
	 * restyle the entire OS and still find WordPress blue on every
	 * focus ring and tab underline. Recommending it is how a theme
	 * says "and this hue with it".
	 */
	accent?: string;
}

/**
 * One entry in the desktop-theme library, as the shell sees it.
 *
 * PHP owns everything here. Uploaded themes carry a `cssUrl` (a real
 * compiled file on disk); code-registered themes carry `cssText`
 * instead, because there is no file to link.
 *
 * @public
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
	 * True on a BOOT-payload entry whose `cssText` / `tokens` were
	 * slimmed away (the active theme's stylesheet is server-delivered
	 * at boot; an inactive theme's CSS is only needed when picked).
	 * `ensureFullDesktopThemes()` fetches the full entries from
	 * `GET desktop-mode/v1/desktop-themes` and upserts them, which
	 * clears the flag. Distinguishes "slimmed" from "this theme
	 * genuinely ships no CSS".
	 */
	cssDeferred: boolean;
	/**
	 * Font families the theme bundles, in declaration order and
	 * de-duplicated across weights. Informational — the compiled
	 * stylesheet carries the `@font-face` rules that actually load
	 * them. Empty for a theme that ships no fonts.
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
	 */
	iconColors: Record< string, string >;
	/**
	 * Presentation preferences the theme recommends. Always an object
	 * — `{}` means "this theme recommends nothing", which is also what
	 * every manifest that omits the block produces.
	 */
	recommendedOsSettings: RecommendedOsSettings;
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
	 */
	activeIconColors: Record< string, string > | null;
}
