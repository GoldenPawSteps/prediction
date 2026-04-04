#!/usr/bin/env node

const EPS = 1e-9
let passed = 0
let failed = 0

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 1000000) / 1000000
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function assertApprox(actual, expected, message, tolerance = 1e-6) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message} (expected ${expected}, got ${actual})`)
  }
}

function heading(title) {
  console.log(`\nScenario: ${title}`)
}

function check(title, fn) {
  try {
    fn()
    passed += 1
    console.log(`  PASS ${title}`)
  } catch (err) {
    failed += 1
    console.log(`  FAIL ${title}`)
    console.log(`       ${err.message}`)
  }
}

function computePositionOffset(beforeYesShares, beforeNoShares, deltaYes, deltaNo) {
  const syPrime = roundMoney(beforeYesShares + deltaYes)
  const snPrime = roundMoney(beforeNoShares + deltaNo)
  const m = Math.min(syPrime, snPrime)

  return {
    finalYesShares: roundMoney(syPrime - m),
    finalNoShares: roundMoney(snPrime - m),
    m: roundMoney(m),
  }
}

function computeReserve(currentBalance, balYa, balYb, balNa, balNb) {
  const minBalance = Math.min(balYa, balYb, balNa, balNb)
  return roundMoney(Math.max(0, currentBalance - minBalance))
}

function availableBalance(currentBalance, reserve) {
  return roundMoney(currentBalance - reserve)
}

function runOffsetModelScenarios() {
  heading('Offset model keeps one-sided position')

  check('buying NO offsets existing YES and credits m', () => {
    const beforeYes = 10
    const beforeNo = 0
    const deltaYes = 0
    const deltaNo = 4

    const result = computePositionOffset(beforeYes, beforeNo, deltaYes, deltaNo)
    assertApprox(result.finalYesShares, 6, 'YES shares should reduce by m')
    assertApprox(result.finalNoShares, 0, 'NO shares should net to zero after offset')
    assertApprox(result.m, 4, 'offset amount m should be credited')
  })

  check('exact opposite purchase fully closes position', () => {
    const result = computePositionOffset(7.5, 0, 0, 7.5)
    assertApprox(result.finalYesShares, 0, 'YES should close exactly')
    assertApprox(result.finalNoShares, 0, 'NO should close exactly')
    assertApprox(result.m, 7.5, 'm should equal matched shares')
  })

  check('selling only one side keeps nonnegative one-sided invariant', () => {
    const result = computePositionOffset(5, 0, -2, 0)
    assert(result.finalYesShares >= -EPS, 'YES must remain nonnegative')
    assert(result.finalNoShares >= -EPS, 'NO must remain nonnegative')
    assertApprox(result.finalYesShares, 3, 'YES should reduce by sell amount')
    assertApprox(result.finalNoShares, 0, 'NO should remain zero')
  })
}

function runReserveFormulaScenarios() {
  heading('Reserve formula uses worst simulated branch')

  check('reserve uses min of four branch balances', () => {
    const currentBalance = 10
    const balYa = 9.2
    const balYb = 6.7
    const balNa = 8.9
    const balNb = 7.3

    const reserve = computeReserve(currentBalance, balYa, balYb, balNa, balNb)
    assertApprox(reserve, 3.3, 'reserve must be current - min(branches)')

    const avail = availableBalance(currentBalance, reserve)
    assertApprox(avail, 6.7, 'available should equal the worst-case branch balance')
  })

  check('reserve is zero when all branch balances are above current balance', () => {
    const reserve = computeReserve(5, 5.1, 5.4, 5.3, 5.2)
    assertApprox(reserve, 0, 'reserve should not be negative')
    assertApprox(availableBalance(5, reserve), 5, 'available equals current balance when reserve is zero')
  })
}

function runOrderAdmissionScenarios() {
  heading('Order admission from available balance')

  check('order is rejected when available balance would become negative', () => {
    const currentBalance = 3
    const balYa = 2.8
    const balYb = -0.2
    const balNa = 2.5
    const balNb = 1.1

    const reserve = computeReserve(currentBalance, balYa, balYb, balNa, balNb)
    const avail = availableBalance(currentBalance, reserve)
    assert(avail < 0, 'available balance should be negative in this case')
  })

  check('order is allowed when available balance remains nonnegative', () => {
    const currentBalance = 3
    const balYa = 2.2
    const balYb = 1.1
    const balNa = 2.7
    const balNb = 1.4

    const reserve = computeReserve(currentBalance, balYa, balYb, balNa, balNb)
    const avail = availableBalance(currentBalance, reserve)
    assert(avail >= -EPS, 'available balance should stay nonnegative')
  })
}

function main() {
  runOffsetModelScenarios()
  runReserveFormulaScenarios()
  runOrderAdmissionScenarios()

  console.log('\n' + '='.repeat(64))
  console.log(`RESULTS: ${passed} passed, ${failed} failed`)
  console.log('='.repeat(64))

  if (failed > 0) {
    process.exit(1)
  }
}

main()
