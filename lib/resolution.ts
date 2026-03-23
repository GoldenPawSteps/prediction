// With a 66.7% threshold, 3 voters trivially resolve (2/3 = exactly 66.7%).
// 5 is the minimum where the quorum and the threshold are independently meaningful:
// you need at least 4 out of 5 votes to agree at quorum, not just 2.
export const MIN_RESOLUTION_VOTES = 5
// An outcome must receive at least this fraction of ALL votes cast to auto-resolve
export const QUALIFIED_MAJORITY_THRESHOLD = 2 / 3 // ≈66.7%
// During disputes, require a stricter supermajority before auto-resolution.
export const DISPUTE_QUALIFIED_MAJORITY_THRESHOLD = 3 / 4 // 75%

export function getQualifiedMajorityThreshold(marketStatus: string) {
	return marketStatus === 'DISPUTED'
		? DISPUTE_QUALIFIED_MAJORITY_THRESHOLD
		: QUALIFIED_MAJORITY_THRESHOLD
}
