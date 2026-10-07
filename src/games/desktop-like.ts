export interface DesktopLike {
	loadModules?: ( ids: string[] ) => Promise< void >;
	onWindow?: (
		id: string,
		handlers: { blurred?: () => void; focused?: () => void },
	) => () => void;
	confirm?: ( opts: {
		title?: string;
		message: string;
		confirmLabel?: string;
		cancelLabel?: string;
	} ) => Promise< boolean >;
}

export function desktopGlobal(): DesktopLike {
	return (
		( window.wp as { os?: DesktopLike } | undefined )?.os ?? {}
	);
}
