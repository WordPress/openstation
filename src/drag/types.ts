export interface DragPayload {

	type: string;

	source: HTMLElement;

	data: Record< string, unknown >;

	ghost?: GhostConfig;
}

export interface GhostConfig {

	element?: HTMLElement;

	offsetX: number;
	offsetY: number;

	hint?: GhostHintConfig;
}

export interface GhostHintConfig {

	hidden?: boolean;

	accept?: string;

	reject?: string;

	neutral?: string;
}

export type CancelReason =
	| 'escape'
	| 'blur'
	| 'visibility'
	| 'pointercancel'
	| 'no-target'
	| 'rejected'
	| 'caller';

export interface DragSession {
	readonly payload: DragPayload;

	isFinished(): boolean;

	cancel( reason?: CancelReason ): void;
}

export interface DropTarget {

	id: string;

	element: HTMLElement;

	accept( payload: DragPayload ): boolean;

	onEnter?( session: DragSession ): void;

	onLeave?( session: DragSession ): void;

	onDrop( session: DragSession, ev: { clientX: number; clientY: number } ): void | Promise< void >;

	acceptLabel?: string;
}

export interface DragManagerApi {

	start( opts: StartOpts ): DragSession | null;

	registerDropTarget( target: DropTarget ): () => void;

	isDragging(): boolean;

	recentlyEndedDrag( withinMs?: number ): boolean;

	getActive(): DragSession | null;

	debug(): {
		findOrphans(): Element[];
		listTargets(): readonly DropTarget[];
	};
}

export interface StartOpts {
	payload: DragPayload;

	origin: PointerEvent;

	onClickOnly?: () => void;

	onCancel?: ( reason: CancelReason ) => void;

	onCommit?: ( target: DropTarget ) => void;
}

export const DRAG_THRESHOLD_PX = 4;

export const DRAG_EVENTS = {
	START: 'os.drag.start',
	MOVE: 'os.drag.move',
	ENTER: 'os.drag.enter',
	LEAVE: 'os.drag.leave',
	REJECTED: 'os.drag.rejected',
	COMMIT: 'os.drag.commit',
	CANCEL: 'os.drag.cancel',
	END: 'os.drag.end',
} as const;
