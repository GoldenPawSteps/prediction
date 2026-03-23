import { prisma } from '@/lib/prisma'

export async function closeExpiredOpenMarkets() {
  return prisma.market.updateMany({
    where: {
      status: 'OPEN',
      endDate: { lte: new Date() },
    },
    data: { status: 'CLOSED' },
  })
}

export async function closeMarketIfExpired(marketId: string) {
  return prisma.market.updateMany({
    where: {
      id: marketId,
      status: 'OPEN',
      endDate: { lte: new Date() },
    },
    data: { status: 'CLOSED' },
  })
}