function normalizeDisputeCount(disputeCount: number) {
	return Number.isFinite(disputeCount) ? Math.max(0, Math.floor(disputeCount)) : 0
}

export function isImmediateResolutionRound(disputeCount: number) {
	return normalizeDisputeCount(disputeCount) === 0
}

export function getResolutionQuorum(disputeCount: number) {
	const normalizedDisputeCount = normalizeDisputeCount(disputeCount)
	return normalizedDisputeCount === 0 ? 1 : normalizedDisputeCount + 1
}

export function getQualifiedMajorityFraction(disputeCount: number) {
	const normalizedDisputeCount = normalizeDisputeCount(disputeCount)
	const numerator = normalizedDisputeCount === 0 ? 0 : normalizedDisputeCount
	const denominator = normalizedDisputeCount === 0 ? 1 : normalizedDisputeCount + 1

	return { numerator, denominator }
}

// Initial resolution resolves on the first vote.
// For the i-th dispute round, an outcome must receive more than i/(i+1)
// of all votes cast, with a minimum quorum of i+1 total votes.
export function getQualifiedMajorityThreshold(disputeCount: number) {
	const { numerator, denominator } = getQualifiedMajorityFraction(disputeCount)
	return numerator / denominator
}

export function formatQualifiedMajorityLabel(disputeCount: number) {
	if (isImmediateResolutionRound(disputeCount)) {
		return 'first vote resolves'
	}

	const { numerator, denominator } = getQualifiedMajorityFraction(disputeCount)
	return `${numerator}/${denominator}`
}
