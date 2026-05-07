/**
 * Desktop Mode bridge protocol version.
 *
 * Outgoing messages from this build identify themselves with this
 * version so peers (other iframes, native windows, third-party
 * extensions) can negotiate or warn on incompatibility.
 *
 * Bumping rules:
 *   - **Patch (1.0.x)** — additive only: new optional fields, new
 *     message variants. Old peers ignore unknown variants safely.
 *   - **Minor (1.x.0)** — backwards-compatible removal: a message
 *     type stops being sent but is still accepted on the receiver.
 *   - **Major (X.0.0)** — breaking: a payload shape changes or a
 *     required field is removed. Bump whenever a long-lived peer
 *     could be in the wild that still speaks the old shape.
 *
 * @since 1.0.0
 */

export const PROTOCOL_VERSION = '1.0.0' as const;

export type ProtocolVersion = typeof PROTOCOL_VERSION;
