/**
 * Window-chrome customization framework — public re-exports.
 *
 * Plugin authors typically reach this surface through `wp.desktop.*`
 * (the desktop bundle's runtime) rather than importing the modules
 * directly. This barrel keeps the framework's TS API discoverable
 * for in-tree consumers (the desktop bundle, the iframe bridge,
 * tests) without forcing every consumer to know the directory
 * layout.
 *
 * The four layers compose:
 *
 *   - **Themes** (Layer 1) — per-window CSS-variable maps. Stable.
 *   - **Controls** (Layer 2) — close/minimize/maximize + custom
 *     buttons in a single registry. Stable.
 *   - **Slots** (Layer 3) — named title-bar regions plugins can
 *     replace. Stable.
 *   - **Chrome** (Layer 4) — full title-bar render replacement.
 *     Experimental — signature may change.
 *
 * @since 0.6.0
 */

export {
	registerWindowTheme,
	unregisterWindowTheme,
	unregisterWindowThemesByOwner,
	listWindowThemes,
	resolveWindowTheme,
	subscribeWindowThemes,
	_resetWindowThemeRegistryForTests,
	type WindowThemeDef,
} from './themes/registry';

export {
	registerWindowControl,
	unregisterWindowControl,
	unregisterWindowControlsByOwner,
	listWindowControls,
	controlsForWindow,
	subscribeWindowControls,
	_resetWindowControlRegistryForTests,
	type WindowControlDef,
	type WindowControlPlacement,
} from './controls/registry';

export {
	registerWindowSlot,
	unregisterWindowSlot,
	unregisterWindowSlotsByOwner,
	listWindowSlots,
	slotsForWindow,
	subscribeWindowSlots,
	_resetWindowSlotRegistryForTests,
	type WindowSlotDef,
	type WindowSlotName,
	type WindowSlotRenderContext,
	type WindowSlotTeardown,
} from './slots/registry';

export {
	registerWindowChrome,
	unregisterWindowChrome,
	unregisterWindowChromesByOwner,
	listWindowChromes,
	getWindowChrome,
	subscribeWindowChromes,
	_resetWindowChromeRegistryForTests,
	type WindowChromeDef,
	type ChromeRenderContext,
	type ChromeRenderHandle,
	type ChromeRenderState,
} from './chrome/registry';
