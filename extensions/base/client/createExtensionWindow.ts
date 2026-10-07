export interface CreateExtensionWindowOptions< Config > {

	id: string;

	configGlobal: string;

	render: ( ctx: { container: HTMLElement; config: Config; windowId: string } ) => void;
}

interface NativeWindowsBag {
	[ id: string ]: ( container: HTMLElement, ctx: { windowId: string } ) => void;
}

interface ExtensionWindow {
	[ k: string ]: unknown;
	openStationNativeWindows?: NativeWindowsBag;
}

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
