import type { Prisma } from '@prisma/client'
import { activeOrderWhere } from '@/lib/order-expiration'
import { roundMoney } from '@/lib/money'

function toNumber(value: unknown, fallback = 0): number {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : fallback
}

type TxClient = Prisma.TransactionClient

// ---------------------------------------------------------------------------
// Pure allocation computation (no DB I/O)
// ---------------------------------------------------------------------------

export type AskOrderInput = {
  id: string
  price: number
  remainingShares: number
  /** Current reservedAmount in DB (0 for a not-yet-created order) */
  currentReservedAmount: number
}

export type AskAllocationResult = {
  /** Total position shares locked across all orders (covering them without cash) */
  totalLockedShares: number
  /** Total balance (cash collateral) required for uncovered shares */
  totalRequiredBalance: number
  /** Per-order allocation details */
  orderAllocations: Array<{
    id: string
    /** Shares from the position that cover this order (no cash needed) */
    lockedShares: number
    /** Shares not covered by position (require cash collateral) */
    uncoveredShares: number
    /** Target reservedAmount = uncoveredShares * (1 - price) */
    targetReservedAmount: number
  }>
}

export type BidOrderInput = {
  id: string
  price: number
  remainingShares: number
  /** Current reservedAmount in DB (0 for a not-yet-created order) */
  currentReservedAmount: number
}

export type BidAllocationResult = {
  /** Total balance locked across all open BID orders */
  totalRequiredBalance: number
  /** Per-order allocation details in chronological execution order */
  orderAllocations: Array<{
    id: string
    /** Worst-case payment at limit price */
    grossPayment: number
    /** Collateral + ask reserve released if this order executes now */
    releasedBalance: number
    /** Target reservedAmount for this order */
    targetReservedAmount: number
  }>
}

function requiredShortCollateralForMarket(yesShares: number, noShares: number) {
  const shortYes = Math.max(0, -yesShares)
  const shortNo = Math.max(0, -noShares)
  return roundMoney(Math.max(shortYes, shortNo))
}

/**
 * Pure function: given the current long position and open ASK orders, compute
 * the optimal allocation.
 *
 * Rule: cover orders starting from the LOWEST price (ascending). This minimises
 * total balance locked because cheap orders carry the highest per-share
 * collateral rate (1 - lowPrice ≈ 1), so freeing those with shares saves the
 * most cash.
 */
export function computeAskAllocation(
  positionShares: number,
  orders: AskOrderInput[]
): AskAllocationResult {
  // Sort ascending by price; for equal prices use stable insertion order
  const sorted = [...orders].sort((a, b) => a.price - b.price)

  let remaining = Math.max(0, positionShares)
  let totalLocked = 0
  let totalRequired = 0
  const orderAllocations: AskAllocationResult['orderAllocations'] = []

  for (const order of sorted) {
    const shares = Math.max(0, order.remainingShares)
    const locked = Math.min(remaining, shares)
    remaining -= locked
    const uncovered = shares - locked
    const target = roundMoney(uncovered * (1 - order.price))

    totalLocked += locked
    totalRequired = roundMoney(totalRequired + target)

    orderAllocations.push({
      id: order.id,
      lockedShares: locked,
      uncoveredShares: uncovered,
      targetReservedAmount: target,
    })
  }

  return { totalLockedShares: totalLocked, totalRequiredBalance: totalRequired, orderAllocations }
}

/**
 * Pure function for BID reserve allocation.
 *
 * For each BID (oldest -> newest), reserve equals the net available-balance
 * reduction if that BID executes in full after all previous BIDs are executed:
 *
 *   reserve_i = max(0, grossPayment_i - releasedBalance_i)
 *
 * releasedBalance_i includes:
 * - short-collateral reduction from improved position
 * - ASK reserve reduction on the same outcome from increased long coverage
 */
export function computeBidAllocation(params: {
  outcome: 'YES' | 'NO'
  yesShares: number
  noShares: number
  askOrdersSameOutcome: AskOrderInput[]
  bidsChronological: BidOrderInput[]
}): BidAllocationResult {
  const { outcome, askOrdersSameOutcome, bidsChronological } = params

  let yesShares = roundMoney(params.yesShares)
  let noShares = roundMoney(params.noShares)
  let totalRequiredBalance = 0
  const orderAllocations: BidAllocationResult['orderAllocations'] = []

  const getOutcomeShares = () => (outcome === 'YES' ? yesShares : noShares)

  let askRequiredBefore = computeAskAllocation(Math.max(0, getOutcomeShares()), askOrdersSameOutcome).totalRequiredBalance
  let shortRequiredBefore = requiredShortCollateralForMarket(yesShares, noShares)

  for (const bid of bidsChronological) {
    const shares = Math.max(0, bid.remainingShares)
    const grossPayment = roundMoney(shares * bid.price)

    // Simulate full execution of this bid before considering the next bid.
    if (outcome === 'YES') {
      yesShares = roundMoney(yesShares + shares)
    } else {
      noShares = roundMoney(noShares + shares)
    }

    const askRequiredAfter = computeAskAllocation(Math.max(0, getOutcomeShares()), askOrdersSameOutcome).totalRequiredBalance
    const shortRequiredAfter = requiredShortCollateralForMarket(yesShares, noShares)

    const askRelease = roundMoney(Math.max(0, askRequiredBefore - askRequiredAfter))
    const shortRelease = roundMoney(Math.max(0, shortRequiredBefore - shortRequiredAfter))
    const releasedBalance = roundMoney(askRelease + shortRelease)

    const targetReservedAmount = roundMoney(Math.max(0, grossPayment - releasedBalance))
    totalRequiredBalance = roundMoney(totalRequiredBalance + targetReservedAmount)

    orderAllocations.push({
      id: bid.id,
      grossPayment,
      releasedBalance,
      targetReservedAmount,
    })

    askRequiredBefore = askRequiredAfter
    shortRequiredBefore = shortRequiredAfter
  }

  return { totalRequiredBalance, orderAllocations }
}

// ---------------------------------------------------------------------------
// DB-backed rebalance
// ---------------------------------------------------------------------------

export async function rebalanceAskReservesForOutcome(
  tx: TxClient,
  userId: string,
  marketId: string,
  outcome: 'YES' | 'NO'
) {
  const now = new Date()

  const [position, openAskOrders, user] = await Promise.all([
    tx.position.findUnique({
      where: { userId_marketId_outcome: { userId, marketId, outcome } },
      select: { shares: true },
    }),
    tx.marketOrder.findMany({
      where: {
        userId,
        marketId,
        outcome,
        side: 'ASK',
        status: { in: ['OPEN', 'PARTIAL'] },
        remainingShares: { gt: 0 },
        ...activeOrderWhere(now),
      },
      // Ordering handled by computeAskAllocation; keep consistent retrieval order
      orderBy: [{ price: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        price: true,
        remainingShares: true,
        reservedAmount: true,
      },
    }),
    tx.user.findUnique({
      where: { id: userId },
      select: { balance: true },
    }),
  ])

  if (!user || openAskOrders.length === 0) return

  const positionShares = Math.max(0, toNumber(position?.shares))
  const inputs: AskOrderInput[] = openAskOrders.map((o) => ({
    id: o.id,
    price: toNumber(o.price),
    remainingShares: toNumber(o.remainingShares),
    currentReservedAmount: toNumber(o.reservedAmount),
  }))

  const { orderAllocations } = computeAskAllocation(positionShares, inputs)

  const updates: Array<{ id: string; targetReservedAmount: number; currentReservedAmount: number }> = []
  let totalReserveDelta = 0

  for (const alloc of orderAllocations) {
    const currentReservedAmount = inputs.find((o) => o.id === alloc.id)!.currentReservedAmount
    const delta = roundMoney(alloc.targetReservedAmount - currentReservedAmount)
    if (Math.abs(delta) > 0.0000001) {
      updates.push({ id: alloc.id, targetReservedAmount: alloc.targetReservedAmount, currentReservedAmount })
      totalReserveDelta = roundMoney(totalReserveDelta + delta)
    }
  }

  if (updates.length === 0) return

  if (totalReserveDelta > 0 && toNumber(user.balance) + 0.0000001 < totalReserveDelta) {
    throw new Error('Insufficient balance to maintain short ask collateral')
  }

  for (const update of updates) {
    await tx.marketOrder.update({
      where: { id: update.id },
      data: { reservedAmount: update.targetReservedAmount },
    })
  }

  if (totalReserveDelta > 0) {
    await tx.user.update({
      where: { id: userId },
      data: { balance: { decrement: totalReserveDelta } },
    })
  } else if (totalReserveDelta < 0) {
    await tx.user.update({
      where: { id: userId },
      data: { balance: { increment: Math.abs(totalReserveDelta) } },
    })
  }
}

export async function rebalanceBidReservesForOutcome(
  tx: TxClient,
  userId: string,
  marketId: string,
  outcome: 'YES' | 'NO'
) {
  const now = new Date()

  const [positions, openAskOrders, openBidOrders, user] = await Promise.all([
    tx.position.findMany({
      where: { userId, marketId, outcome: { in: ['YES', 'NO'] } },
      select: { outcome: true, shares: true },
    }),
    tx.marketOrder.findMany({
      where: {
        userId,
        marketId,
        outcome,
        side: 'ASK',
        status: { in: ['OPEN', 'PARTIAL'] },
        remainingShares: { gt: 0 },
        ...activeOrderWhere(now),
      },
      orderBy: [{ price: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        price: true,
        remainingShares: true,
        reservedAmount: true,
      },
    }),
    tx.marketOrder.findMany({
      where: {
        userId,
        marketId,
        outcome,
        side: 'BID',
        status: { in: ['OPEN', 'PARTIAL'] },
        remainingShares: { gt: 0 },
        ...activeOrderWhere(now),
      },
      // Chronological rebalance requirement: oldest -> newest
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        price: true,
        remainingShares: true,
        reservedAmount: true,
      },
    }),
    tx.user.findUnique({ where: { id: userId }, select: { balance: true } }),
  ])

  if (!user || openBidOrders.length === 0) return

  let yesShares = 0
  let noShares = 0
  for (const p of positions) {
    if (p.outcome === 'YES') yesShares = toNumber(p.shares)
    if (p.outcome === 'NO') noShares = toNumber(p.shares)
  }

  const askInputs: AskOrderInput[] = openAskOrders.map((o) => ({
    id: o.id,
    price: toNumber(o.price),
    remainingShares: toNumber(o.remainingShares),
    currentReservedAmount: toNumber(o.reservedAmount),
  }))

  const bidInputs: BidOrderInput[] = openBidOrders.map((o) => ({
    id: o.id,
    price: toNumber(o.price),
    remainingShares: toNumber(o.remainingShares),
    currentReservedAmount: toNumber(o.reservedAmount),
  }))

  const { orderAllocations } = computeBidAllocation({
    outcome,
    yesShares,
    noShares,
    askOrdersSameOutcome: askInputs,
    bidsChronological: bidInputs,
  })

  const updates: Array<{ id: string; targetReservedAmount: number }> = []
  let totalReserveDelta = 0

  for (const alloc of orderAllocations) {
    const currentReservedAmount = bidInputs.find((o) => o.id === alloc.id)!.currentReservedAmount
    const delta = roundMoney(alloc.targetReservedAmount - currentReservedAmount)
    if (Math.abs(delta) > 0.0000001) {
      updates.push({ id: alloc.id, targetReservedAmount: alloc.targetReservedAmount })
      totalReserveDelta = roundMoney(totalReserveDelta + delta)
    }
  }

  if (updates.length === 0) return

  if (totalReserveDelta > 0 && toNumber(user.balance) + 0.0000001 < totalReserveDelta) {
    throw new Error('Insufficient balance to maintain bid collateral')
  }

  for (const update of updates) {
    await tx.marketOrder.update({
      where: { id: update.id },
      data: { reservedAmount: update.targetReservedAmount },
    })
  }

  if (totalReserveDelta > 0) {
    await tx.user.update({
      where: { id: userId },
      data: { balance: { decrement: totalReserveDelta } },
    })
  } else if (totalReserveDelta < 0) {
    await tx.user.update({
      where: { id: userId },
      data: { balance: { increment: Math.abs(totalReserveDelta) } },
    })
  }
}
