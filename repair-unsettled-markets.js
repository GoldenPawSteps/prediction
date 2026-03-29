#!/usr/bin/env node
/**
 * One-time repair script for markets that were auto-resolved via voting but
 * whose settlement (payout / liquidity return) never ran due to the atomicity bug.
 *
 * Safe to run multiple times — it skips markets that are already fully settled
 * (i.e. no open positions remain).
 *
 * Usage:
 *   node repair-unsettled-markets.js
 *
 * Or to target a specific market:
 *   MARKET_ID=<id> node repair-unsettled-markets.js
 */

require('dotenv/config')
const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function settleMarket(tx, { marketId, outcome, creatorId, initialLiquidity }) {
  // ── Aggregate net trade cost BEFORE settlement trades are added ──────────
  const { _sum } = await tx.trade.aggregate({
    where: { marketId },
    _sum: { totalCost: true },
  })
  const netTradeCostBeforeSettlement = _sum.totalCost ?? 0

  let totalPayout = 0

  if (outcome !== 'INVALID') {
    const winningOutcome = outcome          // 'YES' or 'NO'
    const losingOutcome  = outcome === 'YES' ? 'NO' : 'YES'

    // Pay out winning positions
    const winningPositions = await tx.position.findMany({
      where: { marketId, outcome: winningOutcome, shares: { gt: 0 } },
    })
    for (const pos of winningPositions) {
      totalPayout += pos.shares
      await tx.user.update({
        where: { id: pos.userId },
        data: { balance: { increment: pos.shares } },
      })
      const pnl = pos.shares - pos.avgEntryPrice * pos.shares
      await tx.position.update({
        where: { id: pos.id },
        data: { realizedPnl: { increment: pnl } },
      })
      await tx.trade.create({
        data: {
          userId: pos.userId, marketId, outcome: pos.outcome,
          type: 'SELL', shares: pos.shares, price: 1.0, totalCost: pos.shares,
        },
      })
    }

    // Zero out losing positions
    const losingPositions = await tx.position.findMany({
      where: { marketId, outcome: losingOutcome, shares: { gt: 0 } },
    })
    for (const pos of losingPositions) {
      const pnl = -(pos.avgEntryPrice * pos.shares)
      await tx.position.update({
        where: { id: pos.id },
        data: { realizedPnl: { increment: pnl } },
      })
      await tx.trade.create({
        data: {
          userId: pos.userId, marketId, outcome: pos.outcome,
          type: 'SELL', shares: pos.shares, price: 0.0, totalCost: 0.0,
        },
      })
    }
  } else {
    // INVALID — refund everyone at avg entry price
    const positions = await tx.position.findMany({
      where: { marketId, shares: { gt: 0 } },
    })
    for (const pos of positions) {
      const refund = pos.avgEntryPrice * pos.shares
      totalPayout += refund
      await tx.user.update({
        where: { id: pos.userId },
        data: { balance: { increment: refund } },
      })
      await tx.trade.create({
        data: {
          userId: pos.userId, marketId, outcome: pos.outcome,
          type: 'SELL', shares: pos.shares, price: pos.avgEntryPrice, totalCost: refund,
        },
      })
    }
  }

  // Zero all positions for this market
  await tx.position.updateMany({ where: { marketId }, data: { shares: 0 } })

  // Return leftover liquidity to creator
  const refundedToCreator = Math.max(
    0,
    initialLiquidity + netTradeCostBeforeSettlement - totalPayout,
  )
  if (refundedToCreator > 0) {
    await tx.user.update({
      where: { id: creatorId },
      data: { balance: { increment: refundedToCreator } },
    })
  }

  return { totalPayout, netTradeCostBeforeSettlement, refundedToCreator }
}

async function main() {
  const targetId = process.env.MARKET_ID

  // Find resolved/invalid markets that still have open positions
  const where = {
    status: { in: ['RESOLVED', 'INVALID'] },
    ...(targetId ? { id: targetId } : {}),
  }

  const markets = await prisma.market.findMany({
    where,
    select: {
      id: true, title: true, status: true, resolution: true,
      creatorId: true, initialLiquidity: true,
    },
  })

  if (markets.length === 0) {
    console.log('No resolved/invalid markets found.')
    return
  }

  let repaired = 0

  for (const market of markets) {
    // Check for unsettled open positions
    const openPositions = await prisma.position.count({
      where: { marketId: market.id, shares: { gt: 0 } },
    })

    if (openPositions === 0) {
      console.log(`[SKIP]   ${market.id}  "${market.title}" — already settled`)
      continue
    }

    if (!market.resolution) {
      console.warn(`[WARN]   ${market.id}  "${market.title}" — RESOLVED but resolution field is null, skipping`)
      continue
    }

    console.log(
      `[REPAIR] ${market.id}  "${market.title}" — outcome: ${market.resolution}, ` +
      `${openPositions} open position(s), initialLiquidity: ${market.initialLiquidity}`
    )

    try {
      const result = await prisma.$transaction(async (tx) => {
        return settleMarket(tx, {
          marketId: market.id,
          outcome: market.resolution,
          creatorId: market.creatorId,
          initialLiquidity: market.initialLiquidity,
        })
      })

      console.log(
        `[OK]     totalPayout=${result.totalPayout.toFixed(2)}  ` +
        `netTradeCost=${result.netTradeCostBeforeSettlement.toFixed(2)}  ` +
        `refundedToCreator=${result.refundedToCreator.toFixed(2)}`
      )
      repaired++
    } catch (err) {
      console.error(`[ERROR]  ${market.id}  "${market.title}" — settlement failed:`, err.message)
    }
  }

  console.log(`\nDone. Repaired ${repaired} market(s).`)
}

main()
  .catch((err) => { console.error(err); process.exit(1) })
  .finally(() => prisma.$disconnect())
