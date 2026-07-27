/**
 * Desktop Mode — deferred release of captured window textures.
 *
 * Every window effect animates a frozen copy of its window, captured
 * into a render texture. Those textures are large (a full window at
 * device resolution), so they have to be freed — but freeing them at the
 * wrong moment, or without warning the renderer first, breaks PixiJS in
 * two distinct ways. Both are handled here so the engine can just say
 * "done with this one".
 *
 * @since 0.9.8
 */

/**
 * How long a finished effect's texture is kept alive before release.
 *
 * Removing a display object from the scene graph does NOT retract the
 * draw instructions the renderer has already built, and those
 * instructions can outlive the object by more than a frame. Trying to
 * time the release exactly — same tick, then one frame later — failed
 * both times. A second is imperceptible for memory and puts the release
 * far beyond any instruction set that could still name the texture.
 */
export const TEXTURE_RETIRE_MS = 1000;

/** The subset of `EventEmitter` we need off a Pixi texture resource. */
interface ChangeEmitter {
	removeAllListeners?( event?: string ): unknown;
}

/** The subset of Pixi's `Texture` this module touches. */
export interface RetirableTexture {
	destroy( source?: boolean ): void;
	source?: ( ChangeEmitter & { style?: ChangeEmitter | null } ) | null;
}

/**
 * Textures waiting to be freed, so a burst of effects cannot pile up
 * unbounded if something goes wrong with the timers.
 */
const retiring = new Set< RetirableTexture >();

/**
 * Stop a Pixi texture resource from announcing its own destruction.
 *
 * **This is a workaround for a PixiJS lifetime bug, and without it the
 * cloth effect kills the renderer's entire mesh pipeline on the first
 * drag.** The mechanism, in `pixi.js@8.19.0`:
 *
 * 1. `GlMeshAdaptor` owns ONE `Shader`, built once in `init()` and kept
 *    for the renderer's whole life. Every mesh that does not carry its
 *    own shader draws through it, and `execute()` rebinds it per draw:
 *
 *        shader.resources.uTexture = texture.source;
 *        shader.resources.uSampler = texture.source.style;
 *
 * 2. Each assignment lands in `BindGroup.setResource()`, which subscribes
 *    the bind group to that resource: `resource.on( 'change', … )`.
 *
 * 3. `TextureSource.destroy()` emits `'change'` (via `unload()`) and then
 *    destroys its style, which emits `'change'` too — both AFTER setting
 *    `destroyed = true`.
 *
 * 4. `BindGroup.onResourceChange()` reads that flag and, on a destroyed
 *    resource, calls `this.destroy()` — nulling its own `resources` map.
 *
 * That is a fair assumption for a bind group whose lifetime is tied to
 * one object, and a fatal one for a renderer-lifetime singleton. The
 * shared mesh shader's bind group never comes back, so the very next
 * mesh draw throws inside `setResource`:
 *
 *     Cannot read properties of null (reading '0')
 *
 * and keeps throwing every frame, taking the stage's render loop down
 * with it. Symptom: cloth works on exactly one drag — the first — and
 * then no window can be dragged again until the page is reloaded.
 *
 * Severing `'change'` leaves `'destroy'` and `'unload'` intact, so the
 * GPU memory is still freed on schedule; the bind group simply never
 * hears about it, and its stale entry is overwritten by the next
 * `setResource` call anyway.
 *
 * Sprite-only effects never hit this: batched sprites bind through
 * per-texture-set bind groups that are cached by texture uid, and uids
 * are never reused, so a suicided one is simply never looked up again.
 * The mesh path is the one with a singleton.
 *
 * @param resource A `TextureSource` or `TextureStyle`, or nothing.
 */
function detachChangeListeners(
	resource: ChangeEmitter | null | undefined,
): void {
	if ( resource && typeof resource.removeAllListeners === 'function' ) {
		resource.removeAllListeners( 'change' );
	}
}

/**
 * Queue a captured texture for release.
 *
 * Safe to call twice with the same texture; the second call is ignored.
 *
 * @param texture The render texture an effect has finished with.
 */
export function retireTexture( texture: RetirableTexture ): void {
	if ( retiring.has( texture ) ) {
		return;
	}
	retiring.add( texture );
	setTimeout( () => {
		retiring.delete( texture );
		try {
			// Order matters: the style has to be silenced before
			// `destroy()` reaches it, because the source destroys its own
			// style on the way down.
			detachChangeListeners( texture.source );
			detachChangeListeners( texture.source?.style );
			texture.destroy( true );
		} catch {
			// Already gone, or never fully created.
		}
	}, TEXTURE_RETIRE_MS );
}

/**
 * Drop every pending retirement without destroying anything.
 *
 * Test-only: the module-level set would otherwise leak across cases.
 *
 * @internal
 */
export function _resetRetiringForTests(): void {
	retiring.clear();
}
