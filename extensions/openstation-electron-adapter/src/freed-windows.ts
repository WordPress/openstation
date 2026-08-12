/**
 * Electron Adapter — freed-window bookkeeping, shell side.
 *
 * ## The state that has to stay true
 *
 * A window is either **in the shell** or **freed onto the desktop**,
 * never both and never neither. Two processes can change that — the
 * user picking the ⋯ menu row, and the user closing the native window
 * over there — so "freed" is one fact with two writers rather than two
 * flags that have to agree.
 *
 * This module owns that fact. It is deliberately free of the host
 * bridge and of `wp.os`: it takes a tiny window-manager port and calls
 * back out, which is what lets `tests/freed-windows.test.ts` drive
 * every transition — free, dock, close-from-the-OS, redirect,
 * re-adopt-after-reload — without an Electron runtime or a shell.
 *
 * ## Why minimize, not hide
 *
 * Minimizing is a state the manager, the dock, the switcher and every
 * plugin already understand, so a freed window keeps its place in all
 * of them instead of becoming an invisible special case. The redirect
 * below is what stops that shared understanding from restoring it
 * behind the host's back: without it, clicking Posts in the dock while
 * Posts is out on the desktop would restore a second copy inside the
 * shell, and the user would have two Posts windows that know nothing
 * about each other.
 */

/** The slice of a window this module touches. */
export interface ManagedWindow {
	id: string;
	state: string;
	element: {
		classList: { add( c: string ): void; remove( c: string ): void };
		setAttribute( name: string, value: string ): void;
		removeAttribute( name: string ): void;
	};
	minimize(): void;
	restore(): void;
}

/** The slice of the window manager this module needs. */
export interface WindowManagerPort {
	getById( id: string ): ManagedWindow | undefined | null;
	focus( win: ManagedWindow ): void;
}

export interface FreedWindowsDeps {
	manager: WindowManagerPort;
	/** Raise the native window for this id. */
	focusNative: ( windowId: string ) => void;
	/** Ask the host to close the native window for this id. */
	closeNative: ( windowId: string ) => void;
	/** Fired after a window goes out to the desktop. */
	onFreed?: ( windowId: string ) => void;
	/** Fired after a window comes back into the shell. */
	onDocked?: ( windowId: string ) => void;
}

export class FreedWindows {
	private readonly ids = new Set< string >();

	/**
	 * @param deps Injected collaborators.
	 */
	constructor( private readonly deps: FreedWindowsDeps ) {}

	/** @return Ids currently out on the real desktop. */
	list(): string[] {
		return Array.from( this.ids );
	}

	/**
	 * @param windowId Window id.
	 * @return Whether it is out on the desktop.
	 */
	has( windowId: string ): boolean {
		return this.ids.has( windowId );
	}

	/**
	 * Adopt ids the host already had open — a shell reload does not
	 * close native windows, so boot is not a clean slate.
	 *
	 * Silent by design: nothing *changed*, the adapter is only
	 * catching up with what was already true, and firing "freed" for
	 * each would tell subscribers about transitions that never
	 * happened.
	 *
	 * @param windowIds Ids reported by the host.
	 */
	adoptExisting( windowIds: readonly string[] ): void {
		for ( const id of windowIds ) {
			if ( id ) {
				this.ids.add( id );
			}
		}
	}

	/**
	 * Mark a window as out on the desktop and get it off the desk.
	 *
	 * @param windowId Window id.
	 */
	adopt( windowId: string ): void {
		if ( ! windowId || this.ids.has( windowId ) ) {
			return;
		}
		this.ids.add( windowId );
		const win = this.deps.manager.getById( windowId );
		if ( win ) {
			win.element.classList.add( 'os-window--freed' );
			win.element.setAttribute( 'data-os-freed', '1' );
			if ( 'minimized' !== win.state ) {
				win.minimize();
			}
		}
		this.deps.onFreed?.( windowId );
	}

	/**
	 * Restore a window that is no longer out on the desktop.
	 *
	 * @param windowId Window id.
	 */
	release( windowId: string ): void {
		if ( ! this.ids.delete( windowId ) ) {
			return;
		}
		const win = this.deps.manager.getById( windowId );
		if ( win ) {
			win.element.classList.remove( 'os-window--freed' );
			win.element.removeAttribute( 'data-os-freed' );
			if ( 'minimized' === win.state ) {
				win.restore();
			}
			this.deps.manager.focus( win );
		}
		this.deps.onDocked?.( windowId );
	}

	/**
	 * Anything that would surface a freed window inside the shell
	 * raises the native window instead.
	 *
	 * @param windowId Window id.
	 */
	redirect( windowId: string ): void {
		if ( ! this.ids.has( windowId ) ) {
			return;
		}
		const win = this.deps.manager.getById( windowId );
		if ( win && 'minimized' !== win.state ) {
			win.minimize();
		}
		this.deps.focusNative( windowId );
	}

	/**
	 * A window the user closed for real is no longer anyone's problem —
	 * take its native counterpart down with it.
	 *
	 * @param windowId Window id.
	 */
	forget( windowId: string ): void {
		if ( this.ids.delete( windowId ) ) {
			this.deps.closeNative( windowId );
		}
	}
}
