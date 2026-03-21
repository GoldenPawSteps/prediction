import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { formatDistanceToNow, format } from 'date-fns'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

export function formatNumber(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`
  return value.toFixed(2)
}

export function timeUntil(date: string | Date): string {
  return formatDistanceToNow(new Date(date), { addSuffix: true })
}

export function formatDate(date: string | Date): string {
  return format(new Date(date), 'MMM d, yyyy')
}

export function formatDateTime(date: string | Date): string {
  return format(new Date(date), 'MMM d, yyyy HH:mm')
}

export function getStatusColor(status: string): string {
  switch (status) {
    case 'OPEN': return 'text-green-400'
    case 'CLOSED': return 'text-yellow-400'
    case 'RESOLVED': return 'text-blue-400'
    case 'INVALID': return 'text-red-400'
    default: return 'text-gray-400'
  }
}

export function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    Politics: 'bg-red-900/50 text-red-300',
    Crypto: 'bg-orange-900/50 text-orange-300',
    Sports: 'bg-green-900/50 text-green-300',
    Tech: 'bg-blue-900/50 text-blue-300',
    Entertainment: 'bg-purple-900/50 text-purple-300',
    Science: 'bg-cyan-900/50 text-cyan-300',
    Finance: 'bg-yellow-900/50 text-yellow-300',
    Other: 'bg-gray-700/50 text-gray-300',
  }
  return colors[category] || colors.Other
}
