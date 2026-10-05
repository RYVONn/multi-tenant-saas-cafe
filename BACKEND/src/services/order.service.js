const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.createOrder = async (data) => {
  return await prisma.orders.create({
    data: {
      ...data,

      status: "pending", // 🔥 أهم سطر

      order_items: {
        create: data.items
      }
    }
  });
};

exports.getOrders = async () => {
  return await prisma.orders.findMany({
    include: {
      order_items: true
    },
    orderBy: {
      created_at: 'desc'
    }
  });
};

exports.updateStatus = async (id, status) => {
  return await prisma.orders.update({
    where: { id },
    data: { status }
  });
};