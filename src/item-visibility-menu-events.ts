/**
 * Event name shared between the item-visibility menu and the hover
 * surfaces that have to get out of its way.
 *
 * A leaf module on purpose. The constant used to live in
 * `./item-visibility-menu`, which is the entry of a lazy bundle: the
 * dock's constellation and peek layouts import nothing but this
 * string, and importing it from there pulled the menu's whole
 * implementation — plus `<os-confirm-dialog>`, which the menu
 * imports for its "hide this item?" prompt — into `desktop.min.js`.
 * A component class reaching the main bundle is not just weight; it
 * also registers the tag at boot, which is exactly how the
 * shell-overlays loader's old tag-based readiness check ended up
 * lying. See `src/shell-overlays/loader.ts`.
 *
 * `item-visibility-menu.ts` re-exports this name, so the original
 * import path keeps working.
 */

/**
 * Event fired on `document` the moment a tile menu is asked for, before
 * anything is painted.
 *
 * It exists because a tile can carry two surfaces at once: the menu,
 * and whichever hover affordance the active layout gives it (the
 * constellation flyout, the peek card). Both anchor to the same tile,
 * so opening one over the other leaves two panels fighting for the same
 * corner of the screen. Rather than teach the menu about every hover
 * surface that might exist — or teach each surface to sniff for
 * right-clicks — the menu announces itself and the hover surfaces
 * decide to get out of the way.
 *
 * Deliberately named for the intent rather than the input: a menu
 * opened from the keyboard has the same collision, and a plugin that
 * opens one programmatically should dismiss hover surfaces too.
 *
 * @see docs/javascript-reference.md
 */
export const ITEM_MENU_OPENING_EVENT = 'os-item-menu-opening';
