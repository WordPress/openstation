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

export interface WindowManagerPort {
	getById( id: string ): ManagedWindow | undefined | null;
	focus( win: ManagedWindow ): void;
}

export interface FreedWindowsDeps {
	manager: WindowManagerPort;

	focusNative: ( windowId: string ) => void;

	closeNative: ( windowId: string ) => void;

	onFreed?: ( windowId: string ) => void;

	onDocked?: ( windowId: string ) => void;
}

export class FreedWindows {
	private readonly ids = new Set< string >();

	constructor( private readonly deps: FreedWindowsDeps ) {}

	list(): string[] {
		return Array.from( this.ids );
	}

	has( windowId: string ): boolean {
		return this.ids.has( windowId );
	}

	adoptExisting( windowIds: readonly string[] ): void {
		for ( const id of windowIds ) {
			if ( id ) {
				this.ids.add( id );
			}
		}
	}

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

	forget( windowId: string ): void {
		if ( this.ids.delete( windowId ) ) {
			this.deps.closeNative( windowId );
		}
	}
}
