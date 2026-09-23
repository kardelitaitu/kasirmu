package main

// Quota-effect detection — the server-side half of ADR #57 §2.4.
//
// **Why this is the strongest control in the record.** §2.4’s point is that a
// patched client can skip its LOCAL quota gates without the server noticing, so
// detection must read the EFFECT from data the server already holds rather than
// trust the client’s claim. Nothing here inspects what a device SAYS; it
// compares what the tenant HAS against what their tier allows.
//
// Key functions:
// - findTenantsOverPosQuota — active devices vs the tier’s max_pos_instances.
//
// Scope, stated because the ADR names four signals and this file builds ONE:
// the POS-instance axis is the one fully computable from the LICENCE server’s
// own tables (tenant_machines + subscriptions). The product/staff/location
// counts the ADR also lists are not held here — they live in the tenant’s
// local SQLite and reach only the CLOUD server, and only for products/users.
// Building a partial detector that silently covered one axis while the record
// implied four would be the exact overclaim §3.3 exists to prevent, so the
// others are named as unbuilt rather than faked.

import (
	"log"

	"github.com/pocketbase/pocketbase/core"
)

// tenantOverQuota is one tenant whose active device count exceeds its cap.
type tenantOverQuota struct {
	tenantID string
	email    string
	active   int
	cap      int
	tierKey  string
}

// findTenantsOverPosQuota returns tenants whose ACTIVE devices exceed their
// subscription’s `max_pos_instances` (ADR #57 §2.4, signal 2).
//
// **The comparison is server-held on both sides.** `tenant_machines` is written
// when a device activates, and `max_pos_instances` is stored on the
// subscription record — so a client that skips its local gate still shows up
// here the moment its terminal registers. That immunity to client tampering is
// the whole reason §2.4 prefers this to any client-reported check.
//
// **A cap of 0 means UNLIMITED, not zero**, and is skipped. The codebase reads
// 0 that way throughout (`effective_max_locations`: "0 reads as unlimited"), so
// treating it as a cap would report every unlimited tenant as a violation — a
// false-positive flood that would make the alert worthless.
//
// **Revoked devices do not count.** A revoked machine is no longer a terminal
// the tenant is running, so counting it would report a tenant as over quota for
// a device an operator had already locked out.
func findTenantsOverPosQuota(app core.App) []tenantOverQuota {
	subs, err := app.FindRecordsByFilter("subscriptions",
		"status = 'active'", "", 0, 0)
	if err != nil {
		log.Printf("quota-effect: subscription query failed: %v", err)
		return nil
	}

	out := make([]tenantOverQuota, 0)
	for _, sub := range subs {
		tenantID := sub.GetString("tenant_id")
		if tenantID == "" {
			continue
		}
		cap := sub.GetInt("max_pos_instances")
		if cap <= 0 {
			// Unlimited on this axis; nothing to exceed.
			continue
		}

		// Active = not revoked, scoped to this tenant. The same predicate the
		// fleet-wide count at admin_stats.go:254 uses ("revoked_at IS NULL"),
		// with the tenant scope added, so the two cannot disagree about what
		// "an active device" means.
		//
		// Two PocketBase-specific details, both found by watching this query
		// return zero rows against seeded data:
		//
		// 1. tenant_id is a RELATION field, so the {:tid} placeholder resolves to
		//    the relation's stored id. An interpolated literal silently matches
		//    nothing.
		// 2. Null comparison is `= null`, NOT SQL's `IS NULL`. The latter is a
		//    filter SYNTAX error ("expected a sign operator, got IS"), so the
		//    query fails outright rather than merely matching less.
		//
		// Either mistake reads as "no tenant is ever over quota" — the worst
		// failure this detector can have, and invisible without a test that
		// seeds the condition.
		machines, err := app.FindRecordsByFilter("tenant_machines",
			"tenant_id = {:tid} && revoked_at = null", "", 0, 0,
			map[string]any{"tid": tenantID})
		if err != nil {
			log.Printf("quota-effect: device query failed for tenant %q: %v", tenantID, err)
			continue
		}
		active := len(machines)
		if active <= cap {
			continue
		}

		out = append(out, tenantOverQuota{
			tenantID: tenantID,
			email:    tenantEmailFor(app, tenantID),
			active:   active,
			cap:      cap,
			tierKey:  sub.GetString("tier_key"),
		})
	}
	return out
}
