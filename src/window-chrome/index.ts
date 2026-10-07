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
