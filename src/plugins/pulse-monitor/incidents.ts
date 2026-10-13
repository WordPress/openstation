/**
 * Pulse Monitor — the incident log.
 *
 * Every amber beat is a summary: "request · 404". The Issues window
 * needs the rest of the story — which URL, which window, when — so the
 * taps that draw a failed beat also file an incident here. One log per
 * page, on the shared hub, so the wallpaper, the widget and the Issues
 * window all read the same list.
 *
 * Everything in it was observed by this browser, about this browser's
 * own traffic, and never leaves the page. Server-side events arrive
 * through the Heartbeat feed without URLs or IPs (see
 * `includes/pulse-monitor.php`), so their incidents carry a kind and a
 * status only.
 */

/** One thing that went wrong. */
export interface Incident {
	/** Unix ms. */
	at: number;
	/** Signal source id — `requests`, `errors`, `heartbeat`, `visitors`… */
	source: string;
	/** Short reason, as the spike label prints it ("404", "TypeError: …"). */
	detail: string;
	/** HTTP status, when there was one. */
	status?: number;
	method?: string;
	url?: string;
	/** Owning window, for a report from inside one. */
	windowId?: string;
	/** Where a script error was thrown (`file:line`). */
	where?: string;
	/** True for an event the server feed relayed (another visitor, a bot…). */
	server?: boolean;
}

/** How many incidents are kept; older ones fall off. */
export const INCIDENT_MAX = 200;

type Listener = () => void;

export class IncidentLog {
	private items: Incident[] = [];
	private readonly listeners = new Set< Listener >();

	add( incident: Omit< Incident, 'at' > & { at?: number } ): void {
		this.items.push( { ...incident, at: incident.at ?? Date.now() } );
		if ( this.items.length > INCIDENT_MAX ) {
			this.items.splice( 0, this.items.length - INCIDENT_MAX );
		}
		this.notify();
	}

	/** Newest first. */
	list(): Incident[] {
		return this.items.slice().reverse();
	}

	clear(): void {
		this.items = [];
		this.notify();
	}

	/** Called after every change; returns the unsubscribe. */
	subscribe( listener: () => void ): () => void {
		this.listeners.add( listener );
		return () => {
			this.listeners.delete( listener );
		};
	}

	private notify(): void {
		for ( const listener of this.listeners ) {
			try {
				listener();
			} catch {
				/* a broken view must not stop the others */
			}
		}
	}
}
