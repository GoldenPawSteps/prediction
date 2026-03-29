import Decimal from 'decimal.js'

// Keep internal market/accounting precision consistent across writes.
export const MONEY_SCALE = 6

export function roundMoney(value: Decimal.Value, scale: number = MONEY_SCALE): number {
  return new Decimal(value).toDecimalPlaces(scale, Decimal.ROUND_HALF_UP).toNumber()
}

export function roundPrice(value: Decimal.Value): number {
  return roundMoney(value, 6)
}
