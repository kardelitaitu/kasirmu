package main

import (
	"fmt"
	"log"

	"github.com/pocketbase/pocketbase/core"
)

// ensureBuildIntegrityReports creates the per-device build-integrity store
// (ADR #57 §2.4).
//
// **Why a table rather than only the queue list.** §2.4’s `NeedsAttention`
// entry is a DERIVED view; this is the durable evidence behind it. The queue
// is capped at 20 rows and recomputed per request, so a violation that scrolls
// out of it would leave no trace at all — and "how long has this device been
// failing?" is precisely the question §Q4’s repeated-`unknown` rule asks.
//
// **Only non-`valid` verdicts are stored** (see recordBuildIntegrity), because a
// `valid` report carries no signal and storing it would bury a real violation
// in noise.
//
// **Not the report itself as a free-text blob.** The fingerprint is stored
// normalised, so it joins against `release_channels.accepted_pins` without the
// caller re-deriving the spelling.
func ensureBuildIntegrityReports(app core.App) error {
	if existing, err := app.FindCollectionByNameOrId(buildIntegrityCollection); err == nil {
		return ensureSuperuserOnlyRules(app, existing)
	}
	tenantsColl, err := app.FindCollectionByNameOrId("tenants")
	if err != nil {
		return fmt.Errorf("tenants collection not found (required before creating %s): %w", buildIntegrityCollection, err)
	}
	coll := core.NewBaseCollection(buildIntegrityCollection)
	coll.Fields.Add(&core.RelationField{Name: "tenant_id", Required: true, CollectionId: tenantsColl.Id, MaxSelect: 1})
	// The device that made the report. Empty for a client that sent a
	// fingerprint without a machine_id — kept as a plain text field rather than
	// a relation, because tenant_machines is not guaranteed to hold the row
	// (a report can arrive from a device that never activated).
	coll.Fields.Add(&core.TextField{Name: "machine_id", Max: 128})
	coll.Fields.Add(&core.TextField{Name: "reported_fingerprint", Max: 64})
	// `valid` is never written here; see the doc comment.
	coll.Fields.Add(&core.SelectField{Name: "verdict", Required: true, MaxSelect: 1, Values: []string{buildVerdictMismatch, buildVerdictUnknown}})
	// How many pins existed when the verdict was taken. A `mismatch` against a
	// three-pin set means something different from one against a single pin, and
	// without this the history is unreadable after a rotation.
	coll.Fields.Add(&core.NumberField{Name: "pinned_count"})
	// created/updated are NOT implicit on a programmatically-built collection —
	// NewBaseCollection starts with only the id. The index below references
	// created, so these must be added first.
	coll.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	coll.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	// Superuser-only: these rows name tenants and devices, and an empty-string
	// rule would be PUBLIC in PocketBase (LSE-5).
	coll.ListRule = nil
	coll.ViewRule = nil
	coll.CreateRule = nil
	coll.UpdateRule = nil
	coll.DeleteRule = nil
	// The read this collection exists for: "what has this tenant been reporting,"
	// newest first. §Q4’s repeated-unknown rule is a count over a date range,
	// which this index serves directly.
	coll.Indexes = append(coll.Indexes,
		"CREATE INDEX idx_build_integrity_tenant ON build_integrity_reports (tenant_id, created)")
	if err := app.Save(coll); err != nil {
		return fmt.Errorf("failed to create %s collection: %w", buildIntegrityCollection, err)
	}
	log.Printf("migrated: created %s collection (ADR #57 §2.4 build-integrity reports)", buildIntegrityCollection)
	return nil
}
