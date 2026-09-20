// Federated identity linking (ADR #54).
//
// One collection records which external identity belongs to which tenant, keyed
// by (provider, subject) and never by email: a Google address can change, and the
// account email is itself changeable from the dashboard. resolveIdentity is the
// ADR's §2.3 decision in one funnel, called by both the web redirect flow and the
// desktop device-link flow, so the two cannot drift apart.
//
// Ordering matters and is the reason this is one function: the deployment admin
// identity is refused BEFORE the email-link step (creation is guarded inside
// createTenant, linking was not, and the admin row exists with
// email_verified=false — a link attempt would attach an identity to it and flip it
// verified). See docs/decisions/2026-09-19-adr54-google-sign-in.md §2.3.
package main

import (
	"fmt"
	"log"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// identityCollection records federated identities.
const identityCollection = "tenant_identities"

// providerGoogle is the only provider today; GitHub and Apple are rows, not
// migrations (ADR #54 §2.2).
const providerGoogle = "google"

// IdentityOutcome classifies a resolution so callers can map it to a response.
// The set is the §2.3 matrix: a caller that has to re-decide anything is a
// caller that can drift from this table.
type IdentityOutcome string

const (
	// IdentityBound: the subject was already linked to this tenant (idempotent re-sign-in).
	IdentityBound IdentityOutcome = "bound"
	// IdentityLinked: linked to the tenant the email identified.
	IdentityLinked IdentityOutcome = "linked"
	// IdentityCreated: no account existed, so one was created and then linked.
	IdentityCreated IdentityOutcome = "created"
	// IdentityRefusedReserved: the deployment admin identity is never linked or created.
	IdentityRefusedReserved IdentityOutcome = "refused_reserved"
	// IdentityRefusedUnverified: the provider did not assert the address.
	IdentityRefusedUnverified IdentityOutcome = "refused_unverified"
	// IdentityRefusedMismatch: the device-claimed tenant is not this identity’s account.
	IdentityRefusedMismatch IdentityOutcome = "refused_mismatch"
	// IdentityConflict: the subject is already linked to a DIFFERENT tenant.
	IdentityConflict IdentityOutcome = "conflict"
)

// ensureTenantIdentitiesCollection creates the identity collection when it is
// missing and repairs its rules when it exists.
//
// Programmatic rather than a pb_schema.json entry on purpose: a fresh boot calls
// this right after ensureCollections, so one code path covers both a fresh volume
// and an existing one, and the collection definition cannot drift from the code
// that reads it.
func ensureTenantIdentitiesCollection(app core.App) error {
	existing, err := app.FindCollectionByNameOrId(identityCollection)
	if err == nil {
		// Superuser-only (LSE-5): nil rules; "" would be PUBLIC guest access, and an
		// anonymous write here would forge an identity link.
		return ensureSuperuserOnlyRules(app, existing)
	}

	tenantsColl, err := app.FindCollectionByNameOrId("tenants")
	if err != nil {
		return fmt.Errorf("tenants collection not found: %w", err)
	}

	collection := core.NewBaseCollection(identityCollection)
	// Superuser-only (LSE-5): an identity link is security state, not user data.
	collection.ListRule = nil
	collection.ViewRule = nil
	collection.CreateRule = nil
	collection.UpdateRule = nil
	collection.DeleteRule = nil

	collection.Fields.Add(&core.TextField{Name: "provider", Required: true, Max: 32})
	collection.Fields.Add(&core.TextField{Name: "subject", Required: true, Max: 255})
	// Provenance only: never a join key (ADR #54 §2.2).
	collection.Fields.Add(&core.TextField{Name: "email_at_provider", Required: false, Max: 255})
	collection.Fields.Add(&core.RelationField{
		Name:         "tenant",
		Required:     true,
		CollectionId: tenantsColl.Id,
		MaxSelect:    1,
	})
	collection.Fields.Add(&core.DateField{Name: "last_login", Required: false})
	// Autodate mirrors every other collection in the schema: without it a
	// "-created" sort — which the dashboard list uses — fails at query time.
	collection.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	collection.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	collection.Indexes = append(collection.Indexes,
		"CREATE UNIQUE INDEX idx_tenant_identities_subject ON tenant_identities (provider, subject)")

	return app.Save(collection)
}

// findIdentity returns the record linking a provider subject, or nil when the
// subject is not linked yet.
func findIdentity(app core.App, provider, subject string) (*core.Record, error) {
	records, err := app.FindRecordsByFilter(identityCollection,
		"provider = {:provider} && subject = {:subject}", "", 1, 0,
		map[string]any{"provider": provider, "subject": subject})
	if err != nil {
		return nil, fmt.Errorf("identity lookup failed: %w", err)
	}
	if len(records) == 0 {
		return nil, nil
	}
	return records[0], nil
}

// linkIdentity records that a provider subject belongs to a tenant.
//
// A unique-index race returns the winner rather than failing the sign-in: two
// concurrent callbacks for the same subject are a duplicate, not an error.
func linkIdentity(app core.App, tenantID, provider, subject, email string) (*core.Record, error) {
	coll, err := app.FindCollectionByNameOrId(identityCollection)
	if err != nil {
		return nil, fmt.Errorf("%s collection not found: %w", identityCollection, err)
	}
	record := core.NewRecord(coll)
	record.Set("tenant", tenantID)
	record.Set("provider", provider)
	record.Set("subject", subject)
	record.Set("email_at_provider", email)
	record.Set("last_login", time.Now().UTC())
	if saveErr := app.Save(record); saveErr != nil {
		existing, lookupErr := findIdentity(app, provider, subject)
		if lookupErr != nil || existing == nil {
			return nil, fmt.Errorf("failed to link %s identity: %w", provider, saveErr)
		}
		return existing, nil
	}
	return record, nil
}

// touchIdentity records the last sign-in, best-effort: a failure here must not
// deny a sign-in that has already been decided.
func touchIdentity(app core.App, record *core.Record) {
	record.Set("last_login", time.Now().UTC())
	if err := app.Save(record); err != nil {
		log.Printf("identity: could not record last_login for %s/%s: %v",
			record.GetString("provider"), record.GetString("subject"), err)
	}
}

// resolveIdentity maps a provider identity onto a tenant (ADR #54 §2.3).
//
// claimedTenantID is the tenant a device proved it holds (the desktop link flow);
// pass "" for the web flow, where the email decides. emailVerified must be the
// provider's own assertion — an unproven address never links and never creates.
func resolveIdentity(app core.App, provider, subject, email string, emailVerified bool, claimedTenantID string) (*core.Record, IdentityOutcome, error) {
	email = normalizeEmail(email)

	// (1) A binding is authoritative and survives an email change at the provider
	// or at the dashboard, which is why (provider, subject) is the key.
	if existing, err := findIdentity(app, provider, subject); err != nil {
		return nil, "", err
	} else if existing != nil {
		boundID := existing.GetString("tenant")
		// (2) The same subject naming a different tenant is a conflict, never a
		// rebind: a device that proves one tenant must not be able to move an
		// identity off another.
		if claimedTenantID != "" && claimedTenantID != boundID {
			return nil, IdentityConflict, nil
		}
		tenant, err := app.FindRecordById("tenants", boundID)
		if err != nil {
			return nil, "", fmt.Errorf("linked tenant %q not found: %w", boundID, err)
		}
		touchIdentity(app, existing)
		return tenant, IdentityBound, nil
	}

	// (3) The deployment admin identity is refused BEFORE the link step below.
	// Creation is guarded inside createTenant; linking was not, and the admin row
	// already exists with email_verified=false — so this check is what stops a
	// link attempt from attaching an identity to it and marking it verified.
	if reservedAdminEmails()[email] {
		return nil, IdentityRefusedReserved, nil
	}

	// (4) The provider must have proven the address before it can identify an
	// account: linking or creating on an unproven one hands the account to
	// whoever can assert it.
	if !emailVerified {
		return nil, IdentityRefusedUnverified, nil
	}

	// (5) Desktop link flow: the device proved WHICH tenant, so the identity has
	// to be that tenant's own account (ADR #55 §2.5).
	if claimedTenantID != "" {
		tenant, err := app.FindRecordById("tenants", claimedTenantID)
		if err != nil {
			return nil, "", fmt.Errorf("claimed tenant %q not found: %w", claimedTenantID, err)
		}
		if normalizeEmail(tenant.GetString("email")) != email {
			return nil, IdentityRefusedMismatch, nil
		}
		if _, err := linkIdentity(app, tenant.Id, provider, subject, email); err != nil {
			return nil, "", err
		}
		return tenant, IdentityLinked, nil
	}

	// (6) Web flow: the verified email identifies the account, so a second door
	// always lands in the same account as the first.
	if tenant, lookupErr := app.FindFirstRecordByData("tenants", "email", email); lookupErr == nil && tenant != nil {
		if !tenant.GetBool("email_verified") {
			tenant.Set("email_verified", true)
			if saveErr := app.Save(tenant); saveErr != nil {
				return nil, "", fmt.Errorf("failed to mark %q verified: %w", email, saveErr)
			}
		}
		if _, err := linkIdentity(app, tenant.Id, provider, subject, email); err != nil {
			return nil, "", err
		}
		return tenant, IdentityLinked, nil
	}

	// (7) No account: create one through the shared creation path and link it.
	// createTenantForEmail carries the established shape (status active, empty
	// password, its own reservation guard) so both signup doors stay identical.
	tenant, err := createTenantForEmail(app, email)
	if err != nil {
		return nil, "", fmt.Errorf("failed to create tenant for %q: %w", email, err)
	}
	// The provider proved the mailbox, so the OTP round-trip is redundant.
	tenant.Set("email_verified", true)
	if err := app.Save(tenant); err != nil {
		return nil, "", fmt.Errorf("failed to verify created tenant %q: %w", email, err)
	}
	if _, err := linkIdentity(app, tenant.Id, provider, subject, email); err != nil {
		return nil, "", err
	}
	return tenant, IdentityCreated, nil
}
