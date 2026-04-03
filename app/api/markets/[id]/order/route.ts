import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, apiError, apiSuccess } from '@/lib/api-helpers'
import { activeOrderWhere, expireStaleMarketOrders } from '@/lib/order-expiration'
import { applySignedPositionTrade } from '@/lib/position-accounting'
import { rebalanceAskReservesForOutcome } from '@/lib/order-reserve-rebalance'
import { z } from 'zod'

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

function toNumber(value: unknown, fallback: number = 0): number {
	const numericValue = Number(value)
	return Number.isFinite(numericValue) ? numericValue : fallback
}

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

async function getReservedAskShares(
	tx: TxClient,
	userId: string,
	marketId: string,
	outcome: 'YES' | 'NO'
) {
	const reserved = await tx.marketOrder.aggregate({
		where: {
			userId,
			marketId,
			outcome,
			side: 'ASK',
			status: { in: ['OPEN', 'PARTIAL'] },
			remainingShares: { gt: 0 },
			...activeOrderWhere(new Date()),
		},
		_sum: { remainingShares: true },
	})

	return toNumber(reserved._sum.remainingShares)
}

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

		const result = await prisma.$transaction(async (tx: TxClient) => {
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

			let reserveAmount = side === 'BID' ? price * shares : 0
			if (side === 'ASK') {
				const position = await tx.position.findUnique({
					where: { userId_marketId_outcome: { userId: authUser.userId, marketId, outcome } },
					select: { shares: true },
				})
				const currentLongShares = Math.max(0, toNumber(position?.shares))
				const alreadyReservedAskShares = await getReservedAskShares(tx, authUser.userId, marketId, outcome)
				const availableLongShares = Math.max(0, currentLongShares - alreadyReservedAskShares)
				const shortOrderShares = Math.max(0, shares - availableLongShares)
				reserveAmount = shortOrderShares * (1 - price)
			}

			if (toNumber(user.balance) < reserveAmount) {
				throw new Error('Insufficient balance')
			}

			const avgEntryPriceSnapshot = 0

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

			const matchableShares = matchingOrders.reduce((total, order) => total + toNumber(order.remainingShares), 0)
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
			let takerAskReserveRemaining = side === 'ASK' ? reserveAmount : 0
			const usersToRebalance = new Set<string>()

			for (const match of matchingOrders) {
				if (remainingShares <= 0) break

				const fillShares = Math.min(remainingShares, toNumber(match.remainingShares))
				const fillPrice = toNumber(match.price)
				const fillNotional = fillShares * fillPrice
				const fillAskReserveRelease = fillShares * (1 - fillPrice)
				const makerRemainingShares = toNumber(match.remainingShares) - fillShares
				const makerStatus = makerRemainingShares <= 0 ? 'FILLED' : 'PARTIAL'
				const makerAskReserveRelease = match.side === 'ASK'
					? Math.min(toNumber(match.reservedAmount), fillAskReserveRelease)
					: 0

				await tx.marketOrder.update({
					where: { id: match.id },
					data: {
						remainingShares: makerRemainingShares,
						status: makerStatus,
						...(match.side === 'BID'
							? { reservedAmount: { decrement: fillNotional } }
							: match.side === 'ASK'
							? { reservedAmount: { decrement: makerAskReserveRelease } }
							: {}),
					},
				})

				if (makerAskReserveRelease > 0) {
					await tx.user.update({
						where: { id: match.userId },
						data: { balance: { increment: makerAskReserveRelease } },
					})
				}

				const buyerUserId = side === 'BID' ? authUser.userId : match.userId
				const sellerUserId = side === 'ASK' ? authUser.userId : match.userId
				const sellerCashDelta = fillNotional

				if (side === 'ASK') {
					const takerAskReserveRelease = Math.min(takerAskReserveRemaining, fillAskReserveRelease)
					takerAskReserveRemaining -= takerAskReserveRelease
					if (takerAskReserveRelease > 0) {
						await tx.user.update({
							where: { id: authUser.userId },
							data: { balance: { increment: takerAskReserveRelease } },
						})
					}
				}

				await applySignedPositionTrade(tx, {
					userId: buyerUserId,
					marketId,
					outcome,
					deltaShares: fillShares,
					executionPrice: fillPrice,
					cashDelta: 0,
				})
				usersToRebalance.add(buyerUserId)

				await applySignedPositionTrade(tx, {
					userId: sellerUserId,
					marketId,
					outcome,
					deltaShares: -fillShares,
					executionPrice: fillPrice,
					cashDelta: sellerCashDelta,
				})
				usersToRebalance.add(sellerUserId)

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

			const remainingReserve = side === 'BID' ? remainingShares * price : takerAskReserveRemaining
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
				for (const userId of usersToRebalance) {
					await rebalanceAskReservesForOutcome(tx, userId, marketId, outcome)
				}

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

		const result = await prisma.$transaction(async (tx: TxClient) => {
			await expireStaleMarketOrders(tx, marketId)

			const order = await tx.marketOrder.findUnique({ where: { id: parsed.data.orderId } })
			if (!order || order.marketId !== marketId) {
				throw new Error('Order not found')
			}
			if (order.userId !== authUser.userId) {
				throw new Error('You can only cancel your own orders')
			}
			if (!['OPEN', 'PARTIAL'].includes(order.status) || toNumber(order.remainingShares) <= 0) {
				throw new Error('Order is no longer open')
			}

			if (toNumber(order.reservedAmount) > 0) {
				await tx.user.update({
					where: { id: authUser.userId },
					data: { balance: { increment: toNumber(order.reservedAmount) } },
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

