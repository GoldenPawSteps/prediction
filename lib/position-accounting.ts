import type { Prisma } from '@prisma/client'
import { roundMoney, roundPrice } from '@/lib/money'
import { canonicalizeShares } from '@/lib/simple-reserve'

type TradeOutcome = 'YES' | 'NO'

function toNumber(value: unknown, fallback: number = 0): number {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : fallback
}

function nearZero(value: number, epsilon: number = 0.0000001): boolean {
  return Math.abs(value) <= epsilon
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
  const beforeYesRaw = toNumber(yesPosition?.shares)
  const beforeNoRaw = toNumber(noPosition?.shares)

  // Apply delta on raw side first; then canonicalize so the user never ends
  // with both YES and NO open simultaneously for this market.
  let yesRaw = beforeYesRaw
  let noRaw = beforeNoRaw
  if (params.outcome === 'YES') yesRaw = roundMoney(yesRaw + params.deltaShares)
  else noRaw = roundMoney(noRaw + params.deltaShares)

  const canonical = canonicalizeShares(yesRaw, noRaw)
  const netBalanceDelta = roundMoney(params.cashDelta + canonical.collapsedPairs)

  if (!nearZero(netBalanceDelta)) {
    const user = await tx.user.findUnique({
      where: { id: params.userId },
      select: { balance: true },
    })

    if (!user) {
      throw new Error('User not found')
    }

    await tx.user.update({
      where: { id: params.userId },
      data: { balance: { increment: netBalanceDelta } },
    })
  }

  const upsertPosition = async (
    existing: { id: string; avgEntryPrice: unknown; realizedPnl: unknown } | undefined,
    outcome: TradeOutcome,
    shares: number
  ) => {
    if (nearZero(shares)) {
      if (existing) await tx.position.delete({ where: { id: existing.id } })
      return
    }

    if (existing) {
      await tx.position.update({
        where: { id: existing.id },
        data: {
          shares,
        },
      })
    } else {
      await tx.position.create({
        data: {
          userId: params.userId,
          marketId: params.marketId,
          outcome,
          shares,
          avgEntryPrice: roundPrice(params.executionPrice),
        },
      })
    }
  }

  await upsertPosition(yesPosition, 'YES', roundMoney(canonical.yesShares))
  await upsertPosition(noPosition, 'NO', roundMoney(canonical.noShares))

  return {
    netBalanceDelta,
    collapsedPairs: canonical.collapsedPairs,
  }
}

export function getRequiredShortCollateralFromPositions(
  positions: Array<{ marketId: string; outcome: TradeOutcome; shares: number }>
) {
  void positions
  // In the simplified model there is no separate short-collateral lock.
  return 0
}
