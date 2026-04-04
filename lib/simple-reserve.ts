import type { Prisma } from '@prisma/client'
import { activeOrderWhere } from '@/lib/order-expiration'

function toNumber(value: unknown, fallback = 0): number {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : fallback
}

export function canonicalizeShares(yesRaw: number, noRaw: number) {
  // Legacy compatibility: a negative YES behaves like extra NO and vice versa.
  const yes = Math.max(0, yesRaw) + Math.max(0, -noRaw)
  const no = Math.max(0, noRaw) + Math.max(0, -yesRaw)

  const s = Math.min(yes, no)
  return {
    yesShares: yes - s,
    noShares: no - s,
    collapsedPairs: s,
  }
}

export function computeMarketReserve(params: {
  yesShares: number
  noShares: number
  bidsYes: number
  asksNo: number
  bidsNo: number
  asksYes: number
}) {
  const { yesShares, noShares, bidsYes, asksNo, bidsNo, asksYes } = params

  const r1 = bidsYes + asksNo - noShares
  const r2 = bidsNo + asksYes - yesShares
  return Math.max(r1, r2, 0)
}

export function computeUserReserveFromRows(params: {
  positions: Array<{ marketId: string; outcome: 'YES' | 'NO'; shares: unknown }>
  openOrders: Array<{ marketId: string; outcome: 'YES' | 'NO'; side: 'BID' | 'ASK'; price: unknown; remainingShares: unknown }>
}) {
  const byMarket = new Map<
    string,
    { yesRaw: number; noRaw: number; bidsYes: number; asksNo: number; bidsNo: number; asksYes: number }
  >()

  for (const p of params.positions) {
    const entry = byMarket.get(p.marketId) ?? { yesRaw: 0, noRaw: 0, bidsYes: 0, asksNo: 0, bidsNo: 0, asksYes: 0 }
    if (p.outcome === 'YES') entry.yesRaw += toNumber(p.shares)
    else entry.noRaw += toNumber(p.shares)
    byMarket.set(p.marketId, entry)
  }

  for (const o of params.openOrders) {
    const entry = byMarket.get(o.marketId) ?? { yesRaw: 0, noRaw: 0, bidsYes: 0, asksNo: 0, bidsNo: 0, asksYes: 0 }
    const s = Math.max(0, toNumber(o.remainingShares))
    const p = toNumber(o.price)

    if (o.side === 'BID' && o.outcome === 'YES') entry.bidsYes += s * p
    if (o.side === 'ASK' && o.outcome === 'NO') entry.asksNo += s * (1 - p)
    if (o.side === 'BID' && o.outcome === 'NO') entry.bidsNo += s * p
    if (o.side === 'ASK' && o.outcome === 'YES') entry.asksYes += s * (1 - p)

    byMarket.set(o.marketId, entry)
  }

  let totalReserve = 0
  for (const entry of byMarket.values()) {
    const { yesShares, noShares } = canonicalizeShares(entry.yesRaw, entry.noRaw)
    totalReserve += computeMarketReserve({
      yesShares,
      noShares,
      bidsYes: entry.bidsYes,
      asksNo: entry.asksNo,
      bidsNo: entry.bidsNo,
      asksYes: entry.asksYes,
    })
  }

  return totalReserve
}

export async function computeUserReserve(
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date = new Date()
) {
  const [positions, openOrders] = await Promise.all([
    tx.position.findMany({
      where: { userId },
      select: { marketId: true, outcome: true, shares: true },
    }),
    tx.marketOrder.findMany({
      where: {
        userId,
        status: { in: ['OPEN', 'PARTIAL'] },
        remainingShares: { gt: 0 },
        ...activeOrderWhere(now),
      },
      select: {
        marketId: true,
        outcome: true,
        side: true,
        price: true,
        remainingShares: true,
      },
    }),
  ])

  return computeUserReserveFromRows({
    positions: positions as Array<{ marketId: string; outcome: 'YES' | 'NO'; shares: unknown }>,
    openOrders: openOrders as Array<{
      marketId: string
      outcome: 'YES' | 'NO'
      side: 'BID' | 'ASK'
      price: unknown
      remainingShares: unknown
    }>,
  })
}

export async function assertUserHasNonNegativeAvailable(
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date = new Date()
) {
  const [user, reserve] = await Promise.all([
    tx.user.findUnique({ where: { id: userId }, select: { balance: true } }),
    computeUserReserve(tx, userId, now),
  ])

  if (!user) throw new Error('User not found')

  const available = toNumber(user.balance) - reserve
  if (available < -0.000001) {
    throw new Error('Insufficient balance')
  }

  return { totalBalance: toNumber(user.balance), reserve, available }
}
