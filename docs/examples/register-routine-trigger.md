# Example — register a routine trigger from your plugin

> **Status:** Stable since 0.22.0. See [docs/routines.md](../routines.md) for the full architecture.

You have a hook that fires when something interesting happens in your plugin. Declare it as a routine trigger and Desktop Mode users get a friendly entry in the trigger picker, payload autocomplete in the editor, and a sample payload they can dry-run against — without touching their site.

## The whole thing

```php
<?php
/**
 * Plugin: Acme CRM — Desktop Mode integration.
 */

add_action( 'init', function () {
    if ( ! function_exists( 'wp_register_desktop_routine_trigger' ) ) {
        return; // Desktop Mode not active — graceful no-op.
    }

    wp_register_desktop_routine_trigger( array(
        'id'             => 'acme_crm_lead_captured',
        'label'          => 'Acme CRM — Lead captured',
        'group'          => 'Acme CRM',
        'icon'           => 'dashicons-businessperson',
        'kind'           => 'hook',
        'priority'       => 10,
        'accepted_args'  => 1,
        'payload_schema' => array(
            'lead_id'      => array( 'type' => 'integer', 'description' => 'Lead post id' ),
            'lead.email'   => array( 'type' => 'string',  'description' => 'Lead email' ),
            'lead.source'  => array( 'type' => 'string',  'description' => 'Origin (web, import, …)' ),
            'lead.value'   => array( 'type' => 'number',  'description' => 'Estimated value in USD' ),
        ),
        'sample_payload' => array(
            'lead_id' => 1234,
            'lead'    => array(
                'email'  => 'jane@example.com',
                'source' => 'web',
                'value'  => 4200,
            ),
        ),
        'binder'         => 'acme_crm_bind_lead_payload',
    ) );
}, 5 );

/**
 * The binder receives the raw hook args and shapes them into the
 * payload your trigger declared. Routines see EXACTLY this shape;
 * what's not in the binder isn't reachable from `{{payload.…}}`.
 */
function acme_crm_bind_lead_payload( $lead_id ) {
    $post = get_post( (int) $lead_id );
    if ( ! $post ) {
        return array( 'lead_id' => (int) $lead_id );
    }
    return array(
        'lead_id' => (int) $lead_id,
        'lead'    => array(
            'email'  => (string) get_post_meta( $lead_id, '_email',  true ),
            'source' => (string) get_post_meta( $lead_id, '_source', true ),
            'value'  => (float)  get_post_meta( $lead_id, '_value',  true ),
        ),
    );
}
```

That's it. The next time the user opens the Routines window, your trigger appears in the picker under "Acme CRM" with a friendly label and a working dry-run sample.

## What if the user picks an undeclared hook?

It still works — the routine listener falls back to positional binding (`payload.arg0`, `payload.arg1`, …). They lose payload autocomplete and a sample payload, but the hook fires and the steps execute. Declaring the trigger is a *DX upgrade*, not a hard requirement.

## Pairing it with a starter recipe

Ship a recipe alongside so users get a one-click install:

```php
wp_register_desktop_routine_template( array(
    'id'          => 'acme-big-lead-alert',
    'title'       => 'Email me on big leads',
    'description' => 'When a lead worth more than $1000 lands, email the admin.',
    'icon'        => 'dashicons-email',
    'group'       => 'Acme CRM',
    'def'         => array(
        'version' => 1,
        'trigger' => array(
            'kind' => 'hook',
            'id'   => 'acme_crm_lead_captured',
        ),
        'conditions' => array(
            array( 'left' => '{{payload.lead.value}}', 'op' => 'gt', 'right' => 1000 ),
        ),
        'steps' => array(
            array(
                'kind' => 'email',
                'args' => array(
                    'subject' => 'Big lead: {{payload.lead.email}}',
                    'body'    => "{{payload.lead.email}} ({{payload.lead.source}}) — \${{payload.lead.value}}",
                ),
            ),
        ),
        'run_as' => 'system',
        'settings' => array(
            'rate_limit'    => array( 'max' => 0, 'per_seconds' => 60 ),
            'timeout_ms'    => 5000,
            'stop_on_error' => true,
        ),
    ),
) );
```

The user clicks "Browse templates" → "Install" → the recipe lands in their list as a *disabled* draft they can review and enable.
