package main

// Sign-in method management for the account portal (ADR #54).
//
// The dashboard has to show which identities are linked and let the user unlink one,
// because §2.3 auto-links on a verified email and §5 promises a way back out. Both
// endpoints are scoped to the session's OWN tenant by construction: the tenant comes
// from the session, never from the request, so one account cannot address another's
// identities — and a foreign id answers 404 rather than 403, so the endpoint cannot be
// used to probe which ids exist.
//
// Unlinking is always safe, which is worth stating where it is relied on: the account's
// email is the root credential (request-otp works for any tenant on its own address),
// so removing the last linked identity cannot lock anyone out. There is deliberately no
// "last credential" guard here, because there is no state it could protect.
//
// Endpoints:
//
//	GET    /api/v1/web/identities      — linked sign-in methods for the tenant
//	DELETE /api/v1/web/identities/{id} — unlink one

import (
	"log"
	"net/http"

	"github.com/pocketbase/pocketbase/core"
)

// handleWebIdentities lists the session tenant's linked identities.
func handleWebIdentities(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		tenant, ok := resolveWebSession(app, e)
		if !ok {
			return nil // response already sent
		}

		rows, err := app.FindRecordsByFilter(identityCollection,
			"tenant = {:tid}", "-created", 0, 0,
			map[string]any{"tid": tenant.Id})
		if err != nil {
			log.Printf("/web/identities: query failed for tenant %q: %v", tenant.Id, err)
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": "could not load sign-in methods"})
		}

		identities := make([]map[string]any, 0, len(rows))
		for _, rec := range rows {
			identities = append(identities, map[string]any{
				"id":        rec.Id,
				"provider":  rec.GetString("provider"),
				"email":     rec.GetString("email_at_provider"),
				"lastLogin": rec.GetString("last_login"),
			})
		}
		return e.JSON(http.StatusOK, map[string]any{"identities": identities})
	}
}

// handleWebUnlinkIdentity removes one linked identity from the session tenant.
func handleWebUnlinkIdentity(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		tenant, ok := resolveWebSession(app, e)
		if !ok {
			return nil
		}

		id := e.Request.PathValue("id")
		if id == "" {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "identity id is required"})
		}
		record, err := app.FindRecordById(identityCollection, id)
		if err != nil {
			// Unknown and not-yours are the same answer on purpose.
			return e.JSON(http.StatusNotFound, map[string]any{"error": "sign-in method not found"})
		}
		if record.GetString("tenant") != tenant.Id {
			return e.JSON(http.StatusNotFound, map[string]any{"error": "sign-in method not found"})
		}

		if err := app.Delete(record); err != nil {
			log.Printf("/web/identities: delete failed for %q: %v", id, err)
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": "could not unlink that sign-in method"})
		}
		log.Printf("/web/identities: unlinked %s identity from tenant %s", record.GetString("provider"), tenant.Id)
		return e.JSON(http.StatusOK, map[string]any{"status": "unlinked"})
	}
}
