const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function addColumn() {
  try {
    console.log('Adding currentGreetingStep column...');
    await prisma.$executeRaw`ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "currentGreetingStep" INTEGER`;
    console.log('✅ Column added successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error adding column:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

addColumn();
