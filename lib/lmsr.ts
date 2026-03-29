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

import Decimal from 'decimal.js'

Decimal.set({ precision: 64, rounding: Decimal.ROUND_HALF_UP })

function d(value: number): Decimal {
  return new Decimal(value)
}

export function lmsrCost(yesShares: number, noShares: number, b: number): number {
  const liquidity = d(b)
  const expYes = d(yesShares).div(liquidity).exp()
  const expNo = d(noShares).div(liquidity).exp()
  return liquidity.mul(expYes.plus(expNo).ln()).toNumber()
}

export function lmsrYesPrice(yesShares: number, noShares: number, b: number): number {
  const liquidity = d(b)
  const expYes = d(yesShares).div(liquidity).exp()
  const expNo = d(noShares).div(liquidity).exp()
  return expYes.div(expYes.plus(expNo)).toNumber()
}

export function lmsrNoPrice(yesShares: number, noShares: number, b: number): number {
  return d(1).minus(lmsrYesPrice(yesShares, noShares, b)).toNumber()
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
  const epsilon = d(1e-6)
  const p = Decimal.min(d(1).minus(epsilon), Decimal.max(epsilon, d(priorProbability)))
  const minOutcomeProb = Decimal.min(p, d(1).minus(p))
  return d(maxLoss).div(minOutcomeProb.ln().neg()).toNumber()
}

export function lmsrInitialSharesForPrior(priorProbability: number, b: number) {
  const epsilon = d(1e-6)
  const p = Decimal.min(d(1).minus(epsilon), Decimal.max(epsilon, d(priorProbability)))
  const logOdds = d(b).mul(p.div(d(1).minus(p)).ln())

  if (logOdds.greaterThanOrEqualTo(0)) {
    return { yesShares: logOdds.toNumber(), noShares: 0 }
  }

  return { yesShares: 0, noShares: logOdds.neg().toNumber() }
}
