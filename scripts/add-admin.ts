/**
 * Add admin account to Railway database
 * Usage: DATABASE_URL=<railway-db-url> npx tsx scripts/add-admin.ts
 */

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcryptjs'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('DATABASE_URL environment variable is required')
}

const adapter = new PrismaPg({ connectionString: databaseUrl })
const prisma = new PrismaClient({ adapter })

async function main() {
  try {
    console.log('🔐 Adding admin account to Railway database...')

    const adminPassword = await bcrypt.hash('admin1234', 12)
    const admin = await prisma.user.upsert({
      where: { email: 'admin@predictify.com' },
      update: { isAdmin: true },
      create: {
        email: 'admin@predictify.com',
        username: 'admin',
        passwordHash: adminPassword,
        balance: 10000,
        isAdmin: true,
        bio: 'Platform administrator',
      },
    })

    console.log('✅ Admin account created/updated successfully!')
    console.log(`📧 Email: ${admin.email}`)
    console.log(`👤 Username: ${admin.username}`)
    console.log(`💰 Balance: $${admin.balance}`)
    console.log(`🔑 Password: admin1234`)
    console.log(`🛡️  Is Admin: ${admin.isAdmin}`)
  } catch (error) {
    console.error('❌ Error adding admin account:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()
