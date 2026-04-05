#!/usr/bin/env tsx
import assert from 'node:assert/strict'
import {
  buildMatchCandidates,
  getOppositeOutcome,
  getMatchableShares,
  isCrossPriceEligible,
} from '@/lib/exchange-matching'

type SnapshotOrder = {
  id: string
  price: number
  remainingShares?: number
  createdAt: Date
}

function approxEqual(actual: number, expected: number, tolerance = 0.000001) {
  return Math.abs(actual - expected) <= tolerance
}

function run() {
  assert.equal(getOppositeOutcome('YES'), 'NO')
  assert.equal(getOppositeOutcome('NO'), 'YES')

  assert.equal(
    isCrossPriceEligible({ takerSide: 'BID', takerLimitPrice: 0.40, makerOppositePrice: 0.60 }),
    true,
    'BID cross should pass at exact boundary (0.40 + 0.60 = 1)'
  )
  assert.equal(
    isCrossPriceEligible({ takerSide: 'BID', takerLimitPrice: 0.40, makerOppositePrice: 0.59 }),
    false,
    'BID cross should fail below boundary (0.40 + 0.59 < 1)'
  )

  assert.equal(
    isCrossPriceEligible({ takerSide: 'ASK', takerLimitPrice: 0.60, makerOppositePrice: 0.40 }),
    true,
    'ASK cross should pass at exact boundary (0.60 + 0.40 = 1)'
  )
  assert.equal(
    isCrossPriceEligible({ takerSide: 'ASK', takerLimitPrice: 0.60, makerOppositePrice: 0.41 }),
    false,
    'ASK cross should fail above boundary (0.60 + 0.41 > 1)'
  )

  const directOrders: SnapshotOrder[] = [
    { id: 'direct-early', price: 0.31, createdAt: new Date('2026-01-01T00:00:00.000Z') },
    { id: 'direct-late', price: 0.31, createdAt: new Date('2026-01-01T00:00:02.000Z') },
  ]
  const crossOrders: SnapshotOrder[] = [
    { id: 'cross-best', price: 0.72, createdAt: new Date('2026-01-01T00:00:01.000Z') },
  ]

  const bidCandidates = buildMatchCandidates({
    takerOutcome: 'NO',
    takerSide: 'BID',
    directOrders,
    crossOrders,
  })

  assert.equal(bidCandidates[0].order.id, 'cross-best', 'BID should prioritize lower taker execution price')
  assert.equal(bidCandidates[0].mode, 'CROSS')
  assert(approxEqual(bidCandidates[0].takerPrice, 0.28), 'Cross taker price should be complement of maker price')
  assert.equal(bidCandidates[0].makerOutcome, 'YES')

  assert.equal(bidCandidates[1].order.id, 'direct-early', 'Time priority should break ties on equal price')
  assert.equal(bidCandidates[2].order.id, 'direct-late', 'Later order should come after earlier tie-price order')

  const askCandidates = buildMatchCandidates({
    takerOutcome: 'YES',
    takerSide: 'ASK',
    directOrders: [
      { id: 'ask-direct', price: 0.61, createdAt: new Date('2026-01-01T00:00:01.000Z') },
    ],
    crossOrders: [
      { id: 'ask-cross', price: 0.33, createdAt: new Date('2026-01-01T00:00:00.000Z') },
    ],
  })

  assert.equal(askCandidates[0].order.id, 'ask-cross', 'ASK should prioritize higher taker execution price')
  assert.equal(askCandidates[1].order.id, 'ask-direct')
  assert(approxEqual(askCandidates[0].takerPrice, 0.67), 'ASK cross taker price should be 1 - maker price')
  assert.equal(askCandidates[0].makerOutcome, 'NO')

  const fokCandidates = buildMatchCandidates({
    takerOutcome: 'YES',
    takerSide: 'BID',
    directOrders: [
      { id: 'fok-direct', price: 0.40, remainingShares: 1.25, createdAt: new Date('2026-01-01T00:00:00.000Z') },
    ],
    crossOrders: [
      { id: 'fok-cross', price: 0.70, remainingShares: 0.75, createdAt: new Date('2026-01-01T00:00:01.000Z') },
    ],
  })

  assert(
    approxEqual(getMatchableShares(fokCandidates), 2),
    'FOK liquidity should count both direct and cross candidates using remainingShares'
  )

  console.log('PASS cross matching logic test')
}

run()