import { NextRequest } from 'next/server'
import type { Prisma, TradeOutcome } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAuth, apiError, apiSuccess } from '@/lib/api-helpers'
import { activeOrderWhere, expireStaleMarketOrders } from '@/lib/order-expiration'
import { z } from 'zod'

const placeOrderSchema = z.object({
	outcome: z.enum(['YES', 'NO']),
	side: z.enum(['BID', 'ASK']),
	orderType: z.enum(['GTC', 'GTD', 'FOK', 'FAK']).default('GTC'),
	price: z.number().gt(0).lt(1),
	shares: z.number().positive(),
	expiresAt: z.string().datetime().optional(),
})

const cancelOrderSchema = z.object({
	orderId: z.string().min(1),
})

type AuthUser = { userId: string; email: string; isAdmin: boolean }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const userOrResponse = await requireAuth(req)
	if ('status' in userOrResponse && !('userId' in userOrResponse)) {
		return userOrResponse
	}

	const authUser = userOrResponse as AuthUser

	try {
		const { id: marketId } = await params
		const body = await req.json()
		const parsed = placeOrderSchema.safeParse(body)
		if (!parsed.success) {
			return apiError(parsed.error.issues[0].message)
		}

		const { outcome, side, orderType, price, shares, expiresAt } = parsed.data
		const expiresAtDate = expiresAt ? new Date(expiresAt) : null

		if (orderType === 'GTD' && !expiresAtDate) {
			return apiError('expiresAt is required for GTD orders')
		}
		if (orderType !== 'GTD' && expiresAtDate) {
			return apiError('expiresAt is only supported for GTD orders')
		}

		const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
			await expireStaleMarketOrders(tx, marketId)

			const market = await tx.market.findUnique({ where: { id: marketId } })
			if (!market) throw new Error('Market not found')
			if (market.status !== 'OPEN') throw new Error('Market is not open for trading')
			if (new Date(market.endDate) <= new Date()) {
				throw new Error('Market has expired and is no longer accepting trades')
			}
			if (expiresAtDate) {
				if (expiresAtDate <= new Date()) {
					throw new Error('GTD expiration must be in the future')
				}
				if (expiresAtDate > new Date(market.endDate)) {
					throw new Error('GTD expiration cannot extend past the market end date')
				}
			}

			const user = await tx.user.findUnique({ where: { id: authUser.userId } })
			if (!user) throw new Error('User not found')

			const reserveAmount = side === 'BID' ? price * shares : 0
			if (side === 'BID' && user.balance < reserveAmount) {
				throw new Error('Insufficient balance')
			}

			let avgEntryPriceSnapshot = 0
			if (side === 'ASK') {
				const position = await tx.position.findUnique({
					where: { userId_marketId_outcome: { userId: authUser.userId, marketId, outcome } },
				})
				const reservedShares = await getReservedAskShares(tx, authUser.userId, marketId, outcome)
				const availableShares = (position?.shares ?? 0) - reservedShares

				if (!position || availableShares < shares) {
					throw new Error('Insufficient shares to place ask order')
				}

				avgEntryPriceSnapshot = position.avgEntryPrice
			}

			const now = new Date()
			const matchingOrders = await tx.marketOrder.findMany({
				where: {
					marketId,
					outcome,
					side: side === 'BID' ? 'ASK' : 'BID',
					userId: { not: authUser.userId },
					status: { in: ['OPEN', 'PARTIAL'] },
					remainingShares: { gt: 0 },
					price: side === 'BID' ? { lte: price } : { gte: price },
					...activeOrderWhere(now),
				},
				orderBy: side === 'BID'
					? [{ price: 'asc' }, { createdAt: 'asc' }]
					: [{ price: 'desc' }, { createdAt: 'asc' }],
			})

			const matchableShares = matchingOrders.reduce((total, order) => total + order.remainingShares, 0)
			if (orderType === 'FOK' && matchableShares + 0.0000001 < shares) {
				throw new Error('FOK order could not be fully matched immediately')
			}

			if (reserveAmount > 0) {
				await tx.user.update({
					where: { id: authUser.userId },
					data: { balance: { decrement: reserveAmount } },
				})
			}

			const order = await tx.marketOrder.create({
				data: {
					userId: authUser.userId,
					marketId,
					outcome,
					side,
					orderType,
					status: 'OPEN',
					price,
					initialShares: shares,
					remainingShares: shares,
					reservedAmount: reserveAmount,
					avgEntryPriceSnapshot,
					expiresAt: expiresAtDate,
				},
			})

			let remainingShares = shares
			let filledShares = 0
			let filledNotional = 0

			for (const match of matchingOrders) {
				if (remainingShares <= 0) break

				const fillShares = Math.min(remainingShares, match.remainingShares)
				const fillPrice = match.price
				const fillNotional = fillShares * fillPrice
				const makerRemainingShares = match.remainingShares - fillShares
				const makerStatus = makerRemainingShares <= 0 ? 'FILLED' : 'PARTIAL'

				await tx.marketOrder.update({
					where: { id: match.id },
					data: {
						remainingShares: makerRemainingShares,
						status: makerStatus,
						...(match.side === 'BID'
							? { reservedAmount: { decrement: fillNotional } }
							: {}),
					},
				})

				const buyerUserId = side === 'BID' ? authUser.userId : match.userId
				const sellerUserId = side === 'ASK' ? authUser.userId : match.userId
				const sellerCostBasis = side === 'ASK' ? avgEntryPriceSnapshot : match.avgEntryPriceSnapshot

				await tx.user.update({
					where: { id: sellerUserId },
					data: { balance: { increment: fillNotional } },
				})

				await increasePosition(tx, buyerUserId, marketId, outcome, fillShares, fillPrice)
				await decreasePosition(tx, sellerUserId, marketId, outcome, fillShares, fillNotional, sellerCostBasis)

				await tx.marketOrderFill.create({
					data: {
						marketId,
						makerOrderId: match.id,
						takerOrderId: order.id,
						outcome,
						price: fillPrice,
						shares: fillShares,
						makerUserId: match.userId,
						takerUserId: authUser.userId,
					},
				})

				await tx.trade.createMany({
					data: [
						{
							userId: buyerUserId,
							marketId,
							outcome,
							type: 'BUY',
							shares: fillShares,
							price: fillPrice,
							totalCost: fillNotional,
						},
						{
							userId: sellerUserId,
							marketId,
							outcome,
							type: 'SELL',
							shares: fillShares,
							price: fillPrice,
							totalCost: -fillNotional,
						},
					],
				})

				const impliedYesPrice = outcome === 'YES' ? fillPrice : 1 - fillPrice
				await tx.priceHistory.create({
					data: {
						marketId,
						yesPrice: impliedYesPrice,
						noPrice: 1 - impliedYesPrice,
						volume: fillNotional,
					},
				})

				remainingShares -= fillShares
				filledShares += fillShares
				filledNotional += fillNotional
			}

			const remainingReserve = side === 'BID' ? remainingShares * price : 0
			const refundAmount = side === 'BID' ? reserveAmount - filledNotional - remainingReserve : 0

			if (refundAmount > 0) {
				await tx.user.update({
					where: { id: authUser.userId },
					data: { balance: { increment: refundAmount } },
				})
			}

			const cancelRemainder = remainingShares > 0 && orderType === 'FAK'
			if (cancelRemainder && remainingReserve > 0) {
				await tx.user.update({
					where: { id: authUser.userId },
					data: { balance: { increment: remainingReserve } },
				})
			}

			const finalStatus = remainingShares <= 0
				? 'FILLED'
				: cancelRemainder
				? (filledShares > 0 ? 'PARTIAL' : 'CANCELLED')
				: filledShares > 0
				? 'PARTIAL'
				: 'OPEN'

			const updatedOrder = await tx.marketOrder.update({
				where: { id: order.id },
				data: {
					status: finalStatus,
					remainingShares: cancelRemainder ? 0 : remainingShares,
					reservedAmount: cancelRemainder ? 0 : remainingReserve,
				},
			})

			if (filledShares > 0) {
				await tx.market.update({
					where: { id: marketId },
					data: {
						totalVolume: { increment: filledNotional },
						exchangeVolume: { increment: filledNotional },
					},
				})
			}

			return {
				order: updatedOrder,
				filledShares,
				remainingShares,
			}
		})

		return apiSuccess(result)
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to place order'
		console.error('Place order error:', err)
		return apiError(message, 400)
	}
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const userOrResponse = await requireAuth(req)
	if ('status' in userOrResponse && !('userId' in userOrResponse)) {
		return userOrResponse
	}

	const authUser = userOrResponse as AuthUser

	try {
		const { id: marketId } = await params
		const body = await req.json()
		const parsed = cancelOrderSchema.safeParse(body)
		if (!parsed.success) {
			return apiError(parsed.error.issues[0].message)
		}

		const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
			await expireStaleMarketOrders(tx, marketId)

			const order = await tx.marketOrder.findUnique({ where: { id: parsed.data.orderId } })
			if (!order || order.marketId !== marketId) {
				throw new Error('Order not found')
			}
			if (order.userId !== authUser.userId) {
				throw new Error('You can only cancel your own orders')
			}
			if (!['OPEN', 'PARTIAL'].includes(order.status) || order.remainingShares <= 0) {
				throw new Error('Order is no longer open')
			}

			if (order.side === 'BID' && order.reservedAmount > 0) {
				await tx.user.update({
					where: { id: authUser.userId },
					data: { balance: { increment: order.reservedAmount } },
				})
			}

			const cancelledOrder = await tx.marketOrder.update({
				where: { id: order.id },
				data: {
					status: 'CANCELLED',
					remainingShares: 0,
					reservedAmount: 0,
				},
			})

			return { order: cancelledOrder }
		})

		return apiSuccess(result)
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to cancel order'
		console.error('Cancel order error:', err)
		return apiError(message, 400)
	}
}

async function getReservedAskShares(
	tx: Prisma.TransactionClient,
	userId: string,
	marketId: string,
	outcome: TradeOutcome
) {
	const reservations = await tx.marketOrder.aggregate({
		where: {
			userId,
			marketId,
			outcome,
			side: 'ASK',
			status: { in: ['OPEN', 'PARTIAL'] },
			...activeOrderWhere(new Date()),
		},
		_sum: { remainingShares: true },
	})

	return reservations._sum.remainingShares ?? 0
}

async function increasePosition(
	tx: Prisma.TransactionClient,
	userId: string,
	marketId: string,
	outcome: TradeOutcome,
	shares: number,
	price: number
) {
	const existingPosition = await tx.position.findUnique({
		where: { userId_marketId_outcome: { userId, marketId, outcome } },
	})

	if (!existingPosition) {
		await tx.position.create({
			data: {
				userId,
				marketId,
				outcome,
				shares,
				avgEntryPrice: price,
			},
		})
		return
	}

	const totalShares = existingPosition.shares + shares
	const weightedCost = (existingPosition.avgEntryPrice * existingPosition.shares) + (price * shares)

	await tx.position.update({
		where: { id: existingPosition.id },
		data: {
			shares: totalShares,
			avgEntryPrice: weightedCost / totalShares,
		},
	})
}

async function decreasePosition(
	tx: Prisma.TransactionClient,
	userId: string,
	marketId: string,
	outcome: TradeOutcome,
	shares: number,
	proceeds: number,
	costBasis: number
) {
	const existingPosition = await tx.position.findUnique({
		where: { userId_marketId_outcome: { userId, marketId, outcome } },
	})

	if (!existingPosition || existingPosition.shares < shares) {
		throw new Error('Insufficient shares to settle exchange order')
	}

	const newShares = existingPosition.shares - shares
	const realizedPnl = proceeds - (costBasis * shares)

	if (newShares <= 0) {
		await tx.position.delete({ where: { id: existingPosition.id } })
		return
	}

	await tx.position.update({
		where: { id: existingPosition.id },
		data: {
			shares: newShares,
			realizedPnl: { increment: realizedPnl },
		},
	})
}
