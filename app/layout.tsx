import type { Metadata } from 'next'
import './globals.css'
import { Toaster } from 'react-hot-toast'
import { AuthProvider } from '@/context/AuthContext'
import { I18nProvider } from '@/context/I18nContext'
import { Navbar } from '@/components/Navbar'
import { NavProgressCleanup } from '@/components/NavProgressCleanup'

export const metadata: Metadata = {
  title: 'Predictify - Prediction Markets',
  description: 'Trade on real-world events with our prediction market platform',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head />
      <body className="font-sans bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100 min-h-screen transition-colors">
        <NavProgressCleanup />
        <I18nProvider>
          <AuthProvider>
            <Navbar />
            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
              {children}
            </main>
            <Toaster
              position="bottom-right"
              toastOptions={{
                style: {
                  background: 'var(--toast-bg)',
                  color: 'var(--toast-fg)',
                  border: '1px solid var(--toast-border)',
                },
              }}
            />
          </AuthProvider>
        </I18nProvider>
      </body>
    </html>
  )
}
