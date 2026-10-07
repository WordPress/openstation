export interface DesktopWindow {
	readonly id: string;
	readonly config: { title?: string; icon?: string; url?: string };
	readonly element: HTMLElement;

	shake?(): void;
}

interface WindowManager {
	getAll(): DesktopWindow[];
	getById( id: string ): DesktopWindow | undefined;
}

interface DesktopApi {
	windowManager?: WindowManager;
}

function desktopApi(): DesktopApi | undefined {
	return ( window as unknown as { wp?: { os?: DesktopApi } } ).wp
		?.os;
}

export function listWindows(): DesktopWindow[] {
	try {
		return desktopApi()?.windowManager?.getAll() ?? [];
	} catch {
		return [];
	}
}

export function getWindow( id: string ): DesktopWindow | undefined {
	try {
		return desktopApi()?.windowManager?.getById( id );
	} catch {
		return undefined;
	}
}

export function shakeWindow( id: string ): boolean {
	const win = getWindow( id );
	if ( ! win || typeof win.shake !== 'function' ) {
		return false;
	}
	win.shake();
	return true;
}
