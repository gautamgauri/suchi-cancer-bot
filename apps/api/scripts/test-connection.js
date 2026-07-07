const { PrismaClient } = require('@prisma/client');

async function testConnection() {
  const prisma = new PrismaClient();
  try {
    const result = await prisma.$queryRaw`SELECT 1 as test`;
    console.log('✓ Connection successful:', result);
    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    console.error('✗ Connection failed:', error.message);
    await prisma.$disconnect();
    process.exit(1);
  }
}

testConnection();
