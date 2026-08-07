/**
 * OpenStation — Extension client-side window helper.
 *
 * Companion JS-side helper to the PHP `OpenStation_Extension_Window`
 * base. Removes the per-extension boilerplate that fetches the
 * config blob from the bundle's global, registers the render
 * callback against `window.openStationNativeWindows[ id ]`, and
 * wires the `wp.os.openWindow()` flow.
 */

export interface CreateExtensionWindowOptions< Config > {
	/** Window id — must match the PHP `window_id()` value. */
	id: string;
	/**
	 * Name of the global the bundle reads its config from. Must
	 * match the PHP `config_global()` value (e.g.
	 * `'openStationMyExtConfig'`).
	 */
	configGlobal: string;
	/** Render callback invoked when the window opens. */
	render: ( ctx: { container: HTMLElement; config: Config; windowId: string } ) => void;
}

interface NativeWindowsBag {
	[ id: string ]: ( container: HTMLElement, ctx: { windowId: string } ) => void;
}

interface ExtensionWindow {
	[ k: string ]: unknown;
	openStationNativeWindows?: NativeWindowsBag;
}

/**
 * Register a native window's render callback. Picks up the
 * config from the global the PHP bundle injected and passes it
 * into `render()`. Idempotent — re-calling overwrites the prior
 * registration.
 */
export function createExtensionWindow< Config >(
	opts: CreateExtensionWindowOptions< Config >,
): void {
	const w = window as unknown as ExtensionWindow;
	const bag: NativeWindowsBag = ( w.openStationNativeWindows ??= {} );
	bag[ opts.id ] = ( container, ctx ) => {
		const config = ( window as Record< string, unknown > )[
			opts.configGlobal
		] as Config | undefined;
		if ( ! config ) {
			if ( typeof console !== 'undefined' ) {
				console.error(
					`[desktop-mode/extension] config global "${ opts.configGlobal }" is missing — bundle wiring broken`,
				);
			}
			return;
		}
		opts.render( {
			container,
			config,
			windowId: ctx.windowId,
		} );
	};
}
