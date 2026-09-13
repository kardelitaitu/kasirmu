package main

import "time"

// calculateExpiry returns the subscription expiration time for the given tier.
//
// Tier durations:
//   - free:       lifetime (100 years from now)
//   - plus:       1 year
//   - pro:        1 year
//   - premium:    1 year
//   - enterprise: 3 years (configurable per contract)
func calculateExpiry(tier string) time.Time {
	now := time.Now().UTC()
	switch tier {
	case "free":
		return now.AddDate(100, 0, 0) // effectively never expires
	case "plus", "pro", "premium":
		return now.AddDate(1, 0, 0)
	case "enterprise":
		return now.AddDate(3, 0, 0)
	default:
		return now.AddDate(1, 0, 0) // safe default: 1 year
	}
}

// offlineGraceDays returns the per-tier offline grace window in days
// (todo-global-saas-1.md §B, subscription-tiers.md §Numeric Limits, and
// the pricing page's "Offline grace period" row — the same table the
// Rust client's SubscriptionTier::offline_grace_days() enforces).
// This replaces the flat 14-day window inherited from ADR #5, which
// shortchanged Premium (30 promised) and Enterprise (60 promised) and
// over-credited Free (7 published).
func offlineGraceDays(tier string) int {
	switch tier {
	case "premium":
		return 30
	case "enterprise":
		return 60
	case "free":
		return 7
	default: // plus, pro — and unknown keys get the shortest window
		return 14
	}
}

// calculateGraceUntil returns the subscription's grace deadline:
// expires_at + the tier's published offline grace window.
func calculateGraceUntil(tier string, expiresAt time.Time) time.Time {
	return expiresAt.AddDate(0, 0, offlineGraceDays(tier))
}

// maxMachinesForTier returns the maximum number of machines allowed for
// the given tier. Returns 0 for unlimited (Enterprise).
// Machine limits mirror the subscription tier quotas:
//
//	Free:       1
//	Plus:       2
//	Pro:        3
//	Premium:    10
//	Enterprise: unlimited
func maxMachinesForTier(tier string) int {
	switch tier {
	case "free":
		return 1
	case "plus":
		return 2
	case "pro":
		return 3
	case "premium":
		return 10
	case "enterprise":
		return 0 // unlimited
	default:
		return 1 // conservative default
	}
}
