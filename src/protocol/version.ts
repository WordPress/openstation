/**
 * OpenStation bridge protocol version.
 *
 * Reserved version constant for the bridge protocol. Messages do
 * not yet carry it; once outgoing messages are stamped with this
 * value, peers (other iframes, native windows, third-party
 * extensions) can negotiate or warn on incompatibility.
 *
 * Bumping rules (independent of the plugin version):
 *   - **Patch** — additive only: new optional fields, new message
 *     variants. Old peers ignore unknown variants safely.
 *   - **Minor** — backwards-compatible removal: a message type
 *     stops being sent but is still accepted on the receiver.
 *   - **Major** — breaking: a payload shape changes or a required
 *     field is removed. Bump whenever a long-lived peer could be
 *     in the wild that still speaks the old shape.
 */

export const PROTOCOL_VERSION = '0.8.1' as const;

export type ProtocolVersion = typeof PROTOCOL_VERSION;
