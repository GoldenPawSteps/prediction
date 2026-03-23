// With a 66.7% threshold, 3 voters trivially resolve (2/3 = exactly 66.7%).
// 5 is the minimum where the quorum and the threshold are independently meaningful:
// you need at least 4 out of 5 votes to agree at quorum, not just 2.
export const MIN_RESOLUTION_VOTES = 5

export function getQualifiedMajorityFraction(disputeCount: number) {
	const normalizedDisputeCount = Number.isFinite(disputeCount) ? Math.max(0, Math.floor(disputeCount)) : 0
	const numerator = normalizedDisputeCount + 2
	const denominator = normalizedDisputeCount + 3

	return { numerator, denominator }
}

// An outcome must receive at least this fraction of all votes cast to auto-resolve.
// The threshold tightens with each dispute round:
// 0 disputes -> 2/3, 1 dispute -> 3/4, 2 disputes -> 4/5, ...
export function getQualifiedMajorityThreshold(disputeCount: number) {
	const { numerator, denominator } = getQualifiedMajorityFraction(disputeCount)
	return numerator / denominator
}

export function formatQualifiedMajorityLabel(disputeCount: number) {
	const { numerator, denominator } = getQualifiedMajorityFraction(disputeCount)
	return `${numerator}/${denominator}`
}
