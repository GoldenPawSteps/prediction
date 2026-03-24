/**
 * LMSR (Logarithmic Market Scoring Rule) Implementation
 *
 * Cost function: C(q) = b * ln(e^(q_yes/b) + e^(q_no/b))
 * Price of YES: p_yes = e^(q_yes/b) / (e^(q_yes/b) + e^(q_no/b))
 *
 * Where:
 *   q_yes = total YES shares outstanding
 *   q_no  = total NO shares outstanding
 *   b     = liquidity parameter (higher = more liquidity, less price impact)
 */

export function lmsrCost(yesShares: number, noShares: number, b: number): number {
  const expYes = Math.exp(yesShares / b)
  const expNo = Math.exp(noShares / b)
  return b * Math.log(expYes + expNo)
}

export function lmsrYesPrice(yesShares: number, noShares: number, b: number): number {
  const expYes = Math.exp(yesShares / b)
  const expNo = Math.exp(noShares / b)
  return expYes / (expYes + expNo)
}

export function lmsrNoPrice(yesShares: number, noShares: number, b: number): number {
  return 1 - lmsrYesPrice(yesShares, noShares, b)
}

export function lmsrTradeCost(
  currentYes: number,
  currentNo: number,
  newYes: number,
  newNo: number,
  b: number
): number {
  return lmsrCost(newYes, newNo, b) - lmsrCost(currentYes, currentNo, b)
}

export function lmsrSharesForCost(
  currentYes: number,
  currentNo: number,
  outcome: 'YES' | 'NO',
  maxCost: number,
  b: number
): number {
  // Binary search for number of shares buyable with maxCost
  let low = 0
  let high = maxCost * 10 + 1000
  const tolerance = 0.0001

  for (let i = 0; i < 100; i++) {
    const mid = (low + high) / 2
    const newYes = outcome === 'YES' ? currentYes + mid : currentYes
    const newNo = outcome === 'NO' ? currentNo + mid : currentNo
    const cost = lmsrTradeCost(currentYes, currentNo, newYes, newNo, b)

    if (Math.abs(cost - maxCost) < tolerance) break
    if (cost < maxCost) low = mid
    else high = mid
  }

  return (low + high) / 2
}

export function getMarketProbabilities(yesShares: number, noShares: number, b: number) {
  return {
    yes: lmsrYesPrice(yesShares, noShares, b),
    no: lmsrNoPrice(yesShares, noShares, b),
  }
}

export function lmsrLiquidityParamForMaxLoss(maxLoss: number, priorProbability: number) {
  const epsilon = 1e-6
  const p = Math.min(1 - epsilon, Math.max(epsilon, priorProbability))
  const minOutcomeProb = Math.min(p, 1 - p)
  return maxLoss / -Math.log(minOutcomeProb)
}

export function lmsrInitialSharesForPrior(priorProbability: number, b: number) {
  const epsilon = 1e-6
  const p = Math.min(1 - epsilon, Math.max(epsilon, priorProbability))
  const logOdds = b * Math.log(p / (1 - p))

  if (logOdds >= 0) {
    return { yesShares: logOdds, noShares: 0 }
  }

  return { yesShares: 0, noShares: -logOdds }
}
