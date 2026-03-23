export function getQualifiedMajorityFraction(disputeCount: number) {
	const normalizedDisputeCount = Number.isFinite(disputeCount) ? Math.max(0, Math.floor(disputeCount)) : 0
	const numerator = normalizedDisputeCount + 1
	const denominator = normalizedDisputeCount + 2

	return { numerator, denominator }
}

// An outcome must receive more than this fraction of all votes cast to auto-resolve.
// The threshold tightens with each dispute round:
// 0 disputes -> 1/2, 1 dispute -> 2/3, 2 disputes -> 3/4, 3 disputes -> 4/5, ...
export function getQualifiedMajorityThreshold(disputeCount: number) {
	const { numerator, denominator } = getQualifiedMajorityFraction(disputeCount)
	return numerator / denominator
}

export function formatQualifiedMajorityLabel(disputeCount: number) {
	const { numerator, denominator } = getQualifiedMajorityFraction(disputeCount)
	return `${numerator}/${denominator}`
}
