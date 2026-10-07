export interface WpHooks {
	addFilter: (
		hookName: string,
		namespace: string,
		callback: ( ...args: unknown[] ) => unknown,
		priority?: number
	) => void;
	addAction: (
		hookName: string,
		namespace: string,
		callback: ( ...args: unknown[] ) => void,
		priority?: number
	) => void;
	removeFilter: ( hookName: string, namespace: string ) => number;
	removeAction: ( hookName: string, namespace: string ) => number;
	applyFilters: ( hookName: string, value: unknown, ...args: unknown[] ) => unknown;
	doAction: ( hookName: string, ...args: unknown[] ) => void;
	didAction: ( hookName: string ) => number;
	didFilter: ( hookName: string ) => number;
	hasAction: ( hookName: string, namespace?: string ) => boolean | number;
	hasFilter: ( hookName: string, namespace?: string ) => boolean | number;
}

declare global {
	interface WpGlobal {
		hooks?: WpHooks;
	}
	interface Window {
		wp?: WpGlobal;
	}
}

function getWpHooks(): WpHooks {
	const hooks = window.wp?.hooks;
	if ( ! hooks ) {
		throw new Error(
			'[openstation] `window.wp.hooks` is not available. The ' +
				'plugin declares `wp-hooks` as a script dependency; if ' +
				'you are seeing this error, verify the enqueue order.',
		);
	}
	return hooks;
}

export function addFilter<TValue, TArgs extends unknown[] = unknown[]>(
	hookName: string,
	namespace: string,
	callback: ( value: TValue, ...args: TArgs ) => TValue,
	priority?: number,
): void {
	getWpHooks().addFilter(
		hookName,
		namespace,
		callback as ( ...args: unknown[] ) => unknown,
		priority,
	);
}

export function addAction<TArgs extends unknown[] = unknown[]>(
	hookName: string,
	namespace: string,
	callback: ( ...args: TArgs ) => void,
	priority?: number,
): void {
	getWpHooks().addAction(
		hookName,
		namespace,
		callback as ( ...args: unknown[] ) => void,
		priority,
	);
}

export function removeAction( hookName: string, namespace: string ): number {
	return getWpHooks().removeAction( hookName, namespace ) as number;
}

export function removeFilter( hookName: string, namespace: string ): number {
	return getWpHooks().removeFilter( hookName, namespace ) as number;
}

export function applyFilters<TValue, TArgs extends unknown[] = unknown[]>(
	hookName: string,
	value: TValue,
	...args: TArgs
): TValue {
	return getWpHooks().applyFilters( hookName, value, ...args ) as TValue;
}

export function doAction<TArgs extends unknown[] = unknown[]>(
	hookName: string,
	...args: TArgs
): void {
	getWpHooks().doAction( hookName, ...args );
}

export function didAction( hookName: string ): number {
	return getWpHooks().didAction( hookName );
}

export function rawHooks(): WpHooks {
	return getWpHooks();
}

export const HOOKS = {

	INIT: 'os.init',

	WALLPAPERS: 'os.wallpapers',

	GAMES: 'os.games',

	UNFOCUS_EFFECTS: 'os.unfocus-effects',

	WINDOW_REVEALS: 'os.window-reveals',

	WALLPAPER_MOUNTING: 'os.wallpaper.mounting',

	WALLPAPER_MOUNTED: 'os.wallpaper.mounted',

	WALLPAPER_UNMOUNTING: 'os.wallpaper.unmounting',

	WALLPAPER_MOUNT_FAILED: 'os.wallpaper.mount-failed',

	WALLPAPER_VISIBILITY: 'os.wallpaper.visibility',

	WALLPAPER_SUSPEND: 'os.wallpaper.suspend',

	WALLPAPER_PREVIEW_PARAMS: 'os.wallpaper.preview-params',

	WALLPAPER_SETTINGS_CHANGED: 'os.wallpaper.settings-changed',

	IFRAME_READY: 'os.iframe.ready',

	IFRAME_ERROR: 'os.iframe.error',

	IFRAME_NETWORK_COMPLETED: 'os.iframe.network-completed',

	SHELL_ERROR: 'os.shell.error',

	BROADCAST: 'os.broadcast',

	MONITOR_ENTRY: 'os.monitor.entry',

	WALLPAPER_SURFACES: 'os.wallpaper.surfaces',

	DESKTOP_THEME_CHANGED: 'os.os-theme.changed',

	DESKTOP_THEME_ICON: 'os.os-theme.icon',

	DESKTOP_THEME_ICON_COLOR: 'os.os-theme.icon-color',

	WALLPAPERS_SERVER_CHANGED: 'os.wallpapers.server-changed',

	EXTENDED_OPTIONS_CHANGED: 'os.extended-options.changed',

	WINDOW_GEOMETRY: 'os.window.geometry',

	WINDOW_OPENED: 'os.window.opened',

	WINDOW_CONTENT_LOADING: 'os.window.content-loading',

	WINDOW_CONTENT_LOADED: 'os.window.content-loaded',

	WINDOW_LOADING_OVERLAY: 'os.window.loading-overlay',

	WINDOW_REOPENED: 'os.window.reopened',

	WINDOW_MENU_OPENED: 'os.window.menu-opened',

	WINDOW_CLOSING: 'os.window.closing',

	WINDOW_CLOSED: 'os.window.closed',

	WINDOW_FOCUSED: 'os.window.focused',

	WINDOW_BLURRED: 'os.window.blurred',

	WINDOW_MINIMIZED: 'os.window.minimized',

	WINDOW_RESTORED: 'os.window.restored',

	WINDOW_CHILD_BLOCKED: 'os.window.child-blocked',

	WINDOW_MAXIMIZED: 'os.window.maximized',

	WINDOW_UNMAXIMIZED: 'os.window.unmaximized',

	WINDOW_FULLSCREEN_ENTERED: 'os.window.fullscreen-entered',

	WINDOW_FULLSCREEN_EXITED: 'os.window.fullscreen-exited',

	WINDOW_AUTO_EXIT_FULLSCREEN: 'os.window.auto-exit-fullscreen',

	WINDOW_FOCUS_ON_DRAG_HOVER: 'os.window.focus-on-drag-hover',

	WINDOW_BOUNDS_CHANGED: 'os.window.bounds-changed',

	WINDOW_MOVED: 'os.window.moved',

	WINDOW_RESIZED: 'os.window.resized',

	WINDOW_DRAG_START: 'os.window.drag-start',

	WINDOW_DRAG_END: 'os.window.drag-end',

	WINDOW_RESIZE_START: 'os.window.resize-start',

	WINDOW_RESIZE_END: 'os.window.resize-end',

	WINDOW_DETACHED: 'os.window.detached',

	WINDOW_RELOADED: 'os.window.reloaded',

	WINDOW_TITLE_CHANGED: 'os.window.title-changed',

	WINDOW_HIGHLIGHT_CHANGED: 'os.window.highlight-changed',

	WINDOW_BODY_RESIZED: 'os.window.body-resized',

	NATIVE_WINDOW_BEFORE_RENDER: 'os.native-window.before-render',

	NATIVE_WINDOW_AFTER_RENDER: 'os.native-window.after-render',

	NATIVE_WINDOW_BEFORE_CLOSE: 'os.native-window.before-close',

	WINDOW_CHROME_THEME: 'os.window.chrome.theme',

	WINDOW_CHROME_CONTROLS: 'os.window.chrome.controls',

	WINDOW_CHROME_SLOT: 'os.window.chrome.slot',

	WINDOW_CHROME_RENDER: 'os.window.chrome.render',

	WINDOW_CHROME_APPLIED: 'os.window.chrome.applied',

	WINDOW_CHROME_THEME_CHANGED: 'os.window.chrome.theme-changed',

	DESKTOP_ICON_CLICKED: 'os.os-icon.clicked',

	DESKTOP_ICONS_RENDERED: 'os.os-icons.rendered',

	ICON_BADGE_CHANGED: 'os.icon.badge-changed',

	COMPONENTS_REGISTERED: 'os.components.registered',

	DOCK_ITEM_APPENDED: 'os.dock.item-appended',

	DOCK_ITEM_REMOVED: 'os.dock.item-removed',

	DOCK_BEFORE_RENDER: 'os.dock.before-render',

	DOCK_AFTER_RENDER: 'os.dock.after-render',

	DOCK_REFRESH_ACTIVE: 'os.dock.refresh-active',

	DOCK_TILE_CLASS: 'os.dock.tile-class',

	DOCK_TILE_ELEMENT: 'os.dock.tile-element',

	DOCK_TILE_RENDERED: 'os.dock.tile-rendered',

	DOCK_TILE_TOOLTIP: 'os.dock.tile-tooltip',

	DOCK_PEEK_CARD_CONTENT: 'os.dock.peek-card-content',

	DOCK_PEEK_CARD_ELEMENT: 'os.dock.peek-card-element',

	CONSTELLATION_PANEL: 'os.constellation.panel',

	CONSTELLATION_OPENED: 'os.constellation.opened',

	CONSTELLATION_CLOSED: 'os.constellation.closed',

	OVERVIEW_ENTERING: 'os.overview.entering',

	OVERVIEW_ENTERED: 'os.overview.entered',

	OVERVIEW_EXITING: 'os.overview.exiting',

	OVERVIEW_EXITED: 'os.overview.exited',

	OVERVIEW_WINDOW_HOVER: 'os.overview.window-hover',

	OVERVIEW_WINDOW_UNHOVER: 'os.overview.window-unhover',

	OVERVIEW_WINDOW_CLICK: 'os.overview.window-click',

	WORK_AREA_CHANGED: 'os.work-area.changed',

	ARRANGE_CASCADE_STARTING: 'os.arrange.cascade.starting',

	ARRANGE_CASCADE_APPLIED: 'os.arrange.cascade.applied',

	ARRANGE_TILE_STARTING: 'os.arrange.tile.starting',

	ARRANGE_TILE_APPLIED: 'os.arrange.tile.applied',

	ARRANGE_TILE_DIMENSIONS: 'os.arrange.tile.dimensions',

	ARRANGE_COLUMNS_STARTING: 'os.arrange.columns.starting',

	ARRANGE_COLUMNS_APPLIED: 'os.arrange.columns.applied',

	ARRANGE_FOCUS_SPLIT: 'os.arrange.focus.split',

	ARRANGE_FOCUS_STARTING: 'os.arrange.focus.starting',

	ARRANGE_FOCUS_APPLIED: 'os.arrange.focus.applied',

	ARRANGE_SNAP_CHANGED: 'os.arrange.snap.changed',

	ARRANGE_SNAP_CELL_SIZE: 'os.arrange.snap.cell-size',

	POINTER_SHAKE: 'os.pointer.shake',

	GRID_SNAP_DIMENSIONS: 'os.grid-snap.dimensions',

	GRID_SNAP_ARMED: 'os.grid-snap.armed',

	GRID_SNAP_CHANGED: 'os.grid-snap.changed',

	GRID_SNAP_ANCHOR_RESET: 'os.grid-snap.anchor-reset',

	GRID_SNAP_CANCELED: 'os.grid-snap.canceled',

	GRID_SNAP_COMMITTED: 'os.grid-snap.committed',

	GRID_SNAP_REFLOWED: 'os.grid-snap.reflowed',

	SNAP_ZONE_PENDING: 'os.snap.zone-pending',

	SNAP_ZONE_CANCELED: 'os.snap.zone-canceled',

	SNAP_ZONE_COMMITTED: 'os.snap.zone-committed',

	SNAP_SPLIT_FILLED: 'os.snap.split-filled',

	WIDGETS: 'os.widgets',

	WIDGET_MOUNTING: 'os.widget.mounting',

	WIDGET_MOUNTED: 'os.widget.mounted',

	WIDGET_UNMOUNTING: 'os.widget.unmounting',

	WIDGET_MOUNT_FAILED: 'os.widget.mount-failed',

	WIDGET_ADDED: 'os.widget.added',

	WIDGET_REMOVED: 'os.widget.removed',

	DESKTOP_CREATED: 'os.os.created',

	DESKTOP_CLOSED: 'os.os.closed',

	DESKTOP_SWITCHED: 'os.os.switched',

	DESKTOP_RENAMED: 'os.os.renamed',

	WINDOW_DESKTOP_CHANGED: 'os.os.window-moved',

	PRIMARY_DESKTOP_ID: 'os.primary-desktop-id',

	WORKSPACE_PRESETS: 'os.workspaces.presets',

	WORKSPACE_PROFILE: 'os.workspaces.profile',

	WORKSPACE_UPDATED: 'os.workspaces.updated',

	WORKSPACE_PROVISIONED: 'os.workspaces.provisioned',

	WINDOWS_BEFORE_CLOSE_ALL: 'os.windows.before-close-all',

	WINDOWS_CLOSE_ALL: 'os.windows.close-all',

	WINDOWS_AFTER_CLOSE_ALL: 'os.windows.after-close-all',

	COMMAND_BEFORE_RUN: 'os.command.before-run',

	COMMAND_AFTER_RUN: 'os.command.after-run',

	COMMAND_ERROR: 'os.command.error',

	SHELL_RESIZED: 'os.shell.resized',

	SHELL_VISIBILITY: 'os.shell.visibility',

	CONNECTION_OPENED: 'os.connection.opened',

	CONNECTION_CLOSED: 'os.connection.closed',

	CONNECTION_MESSAGE: 'os.connection.message',

	IFRAME_CONNECTION_REQUEST: 'os.iframe.connection-request',

	WINDOW_CONTENT_CHANGED: 'os.window-links.content-changed',

	WINDOW_LINK_GROUPS_CHANGED: 'os.window-links.groups-changed',

	WINDOW_LINKS_CONTENT: 'os.window-links.content',

	WINDOW_LINK_GROUPS: 'os.window-links.groups',

	WINDOW_LINK_EDGES: 'os.window-links.edges',

	RELATED_ENTITIES_ITEMS: 'os.related-entities.items',

	WINDOW_LINK_RENDERERS: 'os.window-links.renderers',

	WINDOW_LINK_RENDERER: 'os.window-links.renderer',

	EDITOR_PREVIEW_WINDOW_CONFIG: 'os.editor-preview.window-config',

	EDITOR_PREVIEW_LIVE: 'os.editor-preview.live',

	EDITOR_PREVIEW_OPENED: 'os.editor-preview.opened',

	EDITOR_PREVIEW_CLOSED: 'os.editor-preview.closed',

	REVISIONS_WINDOW_CONFIG: 'os.revisions.window-config',

	REVISIONS_OPENED: 'os.revisions.opened',

	FILE_DROP_FILES_DETECTED: 'os.drop.files-detected',

	FILE_DROP_FILES_REJECTED: 'os.drop.files-rejected',

	FILE_DROP_DIALOG_FIELDS: 'os.drop.dialog-fields',

	FILE_DROP_BEFORE_UPLOAD: 'os.drop.before-upload',

	FILE_DROP_UPLOAD_STARTED: 'os.drop.upload-started',

	FILE_DROP_UPLOAD_PROGRESS: 'os.drop.upload-progress',

	FILE_DROP_AFTER_UPLOAD: 'os.drop.after-upload',

	FILE_DROP_UPLOAD_FAILED: 'os.drop.upload-failed',

	AUTH_LOST: 'os.auth.lost',

	AUTH_RESTORED: 'os.auth.restored',

	MODE_CHANGED: 'os.mode.changed',

	SESSION_SNAPSHOT: 'os.session.snapshot',
} as const;

let _whenReadySeq = 0;

export function whenReady( cb: () => void ): void {
	if ( didAction( HOOKS.INIT ) > 0 ) {
		Promise.resolve().then( cb );
		return;
	}
	const ns = `desktop-mode/when-ready-${ ++_whenReadySeq }`;
	addAction( HOOKS.INIT, ns, cb );
}

export function isReady(): boolean {
	return didAction( HOOKS.INIT ) > 0;
}
