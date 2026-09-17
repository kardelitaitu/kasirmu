package main

// maskLicenseKey renders a license key for logging without handing over the
// key itself.
//
// A license key is a bearer entitlement: whoever holds it can activate a
// kasir.mu instance against the tenant's subscription, so writing one to the
// server log — which is collected, shipped, and readable by whoever can run
// the container — leaks the entitlement, not just an identifier.
//
// Keys are minted by generateLicenseKey as "OZ-" + uppercased tier + 16
// characters drawn from a 32-symbol alphabet: a structured prefix followed
// by 80 bits of entropy.
//
// The TAIL is kept rather than the prefix, for two reasons:
//
//   - The prefix is "OZ-" plus the tier name. It is identical for every key
//     of that tier, and the tier is already present in the same log line as
//     tier=, so it carries no correlation value whatsoever.
//   - Eight tail characters identify one key among tens of thousands with
//     negligible collision, while leaving the rest unguessable. Note the
//     arithmetic for a generated key: the tail straddles a group separator,
//     so "XXX-XXXX" carries 7 random symbols, not 8 — 35 bits exposed and 45
//     still hidden, against a 32-symbol alphabet. 32^7 is about 3.4e10
//     buckets, which puts the chance of any collision near 0.15% at 10,000
//     keys. Against an activation endpoint guarded by keyFailTracker, 45
//     hidden bits is not a practical brute-force target.
//
// Anything at or below twice the tail is fully masked. A 10-character value
// rendered as "...23456789" would show 8 of its 10 characters — that is not
// masking, and the result is longer than the secret.
//
// This mirrors mask_token in crates/kasirmu-security/src/mask.rs deliberately: one
// convention across the Rust and Go halves of the product, so auditing logs
// means learning one shape rather than two.
func maskLicenseKey(key string) string {
	const tailChars = 8

	// Runes, not bytes. Callers pass request bodies (req.Key, body.Key), so
	// the input is attacker-controlled and may be multi-byte UTF-8; a byte
	// slice can split a rune and emit invalid UTF-8 into the log stream.
	r := []rune(key)
	if len(r) <= tailChars*2 {
		return "***"
	}
	return "..." + string(r[len(r)-tailChars:])
}
