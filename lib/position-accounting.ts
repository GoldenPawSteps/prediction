import type { Prisma } from '@prisma/client'
import { roundMoney, roundPrice } from '@/lib/money'

type TradeOutcome = 'YES' | 'NO'

function toNumber(value: unknown, fallback: number = 0): number {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : fallback
}

function nearZero(value: number, epsilon: number = 0.0000001): boolean {
  return Math.abs(value) <= epsilon
}

function requiredShortCollateralForMarket(yesShares: number, noShares: number) {
  const shortYes = Math.max(0, -yesShares)
  const shortNo = Math.max(0, -noShares)
  return roundMoney(Math.max(shortYes, shortNo))
}

type PositionTransition = {
  newShares: number
  newAvgEntryPrice: number
  realizedPnlDelta: number
}

function calculatePositionTransition(
  currentSharesRaw: number,
  currentAvgEntryRaw: number,
  deltaSharesRaw: number,
  executionPriceRaw: number
): PositionTransition {
  const currentShares = roundMoney(currentSharesRaw)
  const currentAvgEntry = roundPrice(currentAvgEntryRaw)
  const deltaShares = roundMoney(deltaSharesRaw)
  const executionPrice = roundPrice(executionPriceRaw)

  const nextSharesRaw = currentShares + deltaShares
  const nextShares = nearZero(nextSharesRaw) ? 0 : roundMoney(nextSharesRaw)

  if (nearZero(currentShares)) {
    return {
      newShares: nextShares,
      newAvgEntryPrice: nextShares === 0 ? 0 : executionPrice,
      realizedPnlDelta: 0,
    }
  }

  const sameDirection = Math.sign(currentShares) === Math.sign(deltaShares)
  if (sameDirection) {
    const currentAbs = Math.abs(currentShares)
    const deltaAbs = Math.abs(deltaShares)
    const totalAbs = currentAbs + deltaAbs

    return {
      newShares: nextShares,
      newAvgEntryPrice: totalAbs > 0
        ? roundPrice(((currentAvgEntry * currentAbs) + (executionPrice * deltaAbs)) / totalAbs)
        : 0,
      realizedPnlDelta: 0,
    }
  }

  const reducedWithoutCrossing =
    (currentShares > 0 && deltaShares < 0 && nextShares >= 0) ||
    (currentShares < 0 && deltaShares > 0 && nextShares <= 0)

  if (reducedWithoutCrossing) {
    const closedShares = Math.abs(deltaShares)
    const realizedPnlDelta = currentShares > 0
      ? roundMoney((executionPrice - currentAvgEntry) * closedShares)
      : roundMoney((currentAvgEntry - executionPrice) * closedShares)

    return {
      newShares: nextShares,
      newAvgEntryPrice: nextShares === 0 ? 0 : currentAvgEntry,
      realizedPnlDelta,
    }
  }

  const closedShares = Math.abs(currentShares)
  const realizedPnlDelta = currentShares > 0
    ? roundMoney((executionPrice - currentAvgEntry) * closedShares)
    : roundMoney((currentAvgEntry - executionPrice) * closedShares)

  return {
    newShares: nextShares,
    newAvgEntryPrice: nextShares === 0 ? 0 : executionPrice,
    realizedPnlDelta,
  }
}

type ApplySignedPositionTradeParams = {
  userId: string
  marketId: string
  outcome: TradeOutcome
  deltaShares: number
  executionPrice: number
  cashDelta: number
}

export async function applySignedPositionTrade(
  tx: Prisma.TransactionClient,
  params: ApplySignedPositionTradeParams
) {
  const positions = await tx.position.findMany({
    where: {
      userId: params.userId,
      marketId: params.marketId,
      outcome: { in: ['YES', 'NO'] },
    },
    select: {
      id: true,
      outcome: true,
      shares: true,
      avgEntryPrice: true,
      realizedPnl: true,
    },
  })

  const yesPosition = positions.find((p) => p.outcome === 'YES')
  const noPosition = positions.find((p) => p.outcome === 'NO')
  const targetPosition = params.outcome === 'YES' ? yesPosition : noPosition

  const beforeYesShares = toNumber(yesPosition?.shares)
  const beforeNoShares = toNumber(noPosition?.shares)
  const beforeCollateral = requiredShortCollateralForMarket(beforeYesShares, beforeNoShares)

  const transition = calculatePositionTransition(
    toNumber(targetPosition?.shares),
    toNumber(targetPosition?.avgEntryPrice),
    params.deltaShares,
    params.executionPrice
  )

  const afterYesShares = params.outcome === 'YES' ? transition.newShares : beforeYesShares
  const afterNoShares = params.outcome === 'NO' ? transition.newShares : beforeNoShares
  const afterCollateral = requiredShortCollateralForMarket(afterYesShares, afterNoShares)
  const collateralDelta = roundMoney(afterCollateral - beforeCollateral)
  const netBalanceDelta = roundMoney(params.cashDelta - collateralDelta)

  if (!nearZero(netBalanceDelta)) {
    const user = await tx.user.findUnique({
      where: { id: params.userId },
      select: { balance: true },
    })

    if (!user) {
      throw new Error('User not found')
    }

    const resultingBalance = roundMoney(toNumber(user.balance) + netBalanceDelta)
    if (resultingBalance < -0.000001) {
      throw new Error('Insufficient balance for short collateral')
    }

    await tx.user.update({
      where: { id: params.userId },
      data: { balance: { increment: netBalanceDelta } },
    })
  }

  if (targetPosition) {
    if (transition.newShares === 0) {
      await tx.position.delete({ where: { id: targetPosition.id } })
    } else {
      await tx.position.update({
        where: { id: targetPosition.id },
        data: {
          shares: transition.newShares,
          avgEntryPrice: transition.newAvgEntryPrice,
          realizedPnl: { increment: transition.realizedPnlDelta },
        },
      })
    }
  } else if (transition.newShares !== 0) {
    await tx.position.create({
      data: {
        userId: params.userId,
        marketId: params.marketId,
        outcome: params.outcome,
        shares: transition.newShares,
        avgEntryPrice: transition.newAvgEntryPrice,
      },
    })
  }

  return {
    collateralDelta,
    netBalanceDelta,
  }
}

export function getRequiredShortCollateralFromPositions(
  positions: Array<{ marketId: string; outcome: TradeOutcome; shares: number }>
) {
  const byMarket = new Map<string, { yesShares: number; noShares: number }>()

  for (const position of positions) {
    const entry = byMarket.get(position.marketId) ?? { yesShares: 0, noShares: 0 }
    if (position.outcome === 'YES') entry.yesShares = position.shares
    else entry.noShares = position.shares
    byMarket.set(position.marketId, entry)
  }

  let total = 0
  for (const market of byMarket.values()) {
    total = roundMoney(total + requiredShortCollateralForMarket(market.yesShares, market.noShares))
  }

  return total
}
