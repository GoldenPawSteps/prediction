export type BinaryOutcome = 'YES' | 'NO'
export type ExchangeSide = 'BID' | 'ASK'

function toNumber(value: unknown, fallback: number = 0): number {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : fallback
}

export function getOppositeOutcome(outcome: BinaryOutcome): BinaryOutcome {
  return outcome === 'YES' ? 'NO' : 'YES'
}

export function isCrossPriceEligible(params: {
  takerSide: ExchangeSide
  takerLimitPrice: number
  makerOppositePrice: number
}) {
  const { takerSide, takerLimitPrice, makerOppositePrice } = params
  return takerSide === 'BID'
    ? makerOppositePrice >= 1 - takerLimitPrice
    : makerOppositePrice <= 1 - takerLimitPrice
}

export type MatchCandidate<TOrder> = {
  mode: 'DIRECT' | 'CROSS'
  order: TOrder
  takerPrice: number
  makerPrice: number
  takerOutcome: BinaryOutcome
  makerOutcome: BinaryOutcome
}

export function buildMatchCandidates<
  TOrder extends { price: unknown; createdAt: Date }
>(params: {
  takerOutcome: BinaryOutcome
  takerSide: ExchangeSide
  directOrders: TOrder[]
  crossOrders: TOrder[]
}) {
  const { takerOutcome, takerSide, directOrders, crossOrders } = params
  const oppositeOutcome = getOppositeOutcome(takerOutcome)

  const candidates: MatchCandidate<TOrder>[] = [
    ...directOrders.map((order) => {
      const directPrice = toNumber(order.price)
      return {
        mode: 'DIRECT' as const,
        order,
        takerPrice: directPrice,
        makerPrice: directPrice,
        takerOutcome,
        makerOutcome: takerOutcome,
      }
    }),
    ...crossOrders.map((order) => {
      const makerPrice = toNumber(order.price)
      return {
        mode: 'CROSS' as const,
        order,
        takerPrice: 1 - makerPrice,
        makerPrice,
        takerOutcome,
        makerOutcome: oppositeOutcome,
      }
    }),
  ]

  candidates.sort((a, b) => {
    if (takerSide === 'BID') {
      if (a.takerPrice !== b.takerPrice) return a.takerPrice - b.takerPrice
    } else {
      if (a.takerPrice !== b.takerPrice) return b.takerPrice - a.takerPrice
    }
    return a.order.createdAt.getTime() - b.order.createdAt.getTime()
  })

  return candidates
}

export function getMatchableShares<TOrder extends { remainingShares: unknown }>(
  candidates: Array<{ order: TOrder }>
) {
  return candidates.reduce((total, candidate) => total + Math.max(0, toNumber(candidate.order.remainingShares)), 0)
}