const Module = require('module');
const originalRequire = Module.prototype.require;

// Intercept requires to mock DB
Module.prototype.require = function(path) {
  if (path === '@prisma/client') {
    return {
      PrismaClient: class {
        constructor() {
          this.shift = {
            findFirst: async () => null,
            create: async ({ data }) => ({ id: 'shift_test', ...data }),
            update: async ({ data }) => ({ id: 'shift_test', type: 'morning', ...data }),
            findUnique: async () => ({ id: 'shift_test', status: 'open', type: 'morning', consumptions: [], issuances: [], stockRequests: [] })
          };
          this.shiftStockSnapshot = { create: async () => {} };
          this.stockItem = { findMany: async () => [] };
          this.stockRequest = { count: async () => 0 };
          this.stockAuditLog = { create: async () => {} };
          this.notification = {
            create: async ({ data }) => {
              console.log(`[DB] Notification.create | recipientRole: ${data.recipientRole} | isBroadcast: ${data.recipientId === 'broadcast'}`);
              return { id: Math.random().toString(), ...data };
            }
          };
          this.push_subscriptions = {
            findMany: async ({ where }) => {
              console.log(`[DB] push_subscriptions.findMany | user_role: ${where.user_role}`);
              return [];
            }
          };
          this.$transaction = async (cb) => await cb(this);
        }
      }
    };
  }
  return originalRequire.apply(this, arguments);
};

const shiftsCtrl = require('../../src/controllers/shifts.controller');
const pushCtrl = require('../../src/controllers/push.controller');

// Mock console to capture logs clearly
const _log = console.log;

// Let's hook pushCtrl.sendGenericPush to see how many times it's called
let pushCount = 0;
const originalSendGenericPush = pushCtrl.sendGenericPush;
pushCtrl.sendGenericPush = async function(notif) {
  pushCount++;
  _log(`[PUSH] sendGenericPush called (Execution #${pushCount}) for role: ${notif.recipientRole}`);
  return originalSendGenericPush.apply(this, arguments);
};

async function run() {
  _log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  _log('AUDITING SHIFT OPENED');
  _log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const reqOpen = {
    body: { type: 'morning' },
    user: { id: 'staff_1', name: 'Test Staff', role: 'morning_staff' },
    query: {},
    app: {
      get: (key) => {
        if (key === 'io') return {
          emit: () => {},
          to: () => ({ emit: () => {} })
        };
      }
    }
  };
  const resOpen = { status: () => resOpen, json: () => {} };
  
  await shiftsCtrl.openShift(reqOpen, resOpen);
  
  _log(`\nTotal pushes triggered for openShift: ${pushCount}\n`);
  pushCount = 0;

  _log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  _log('AUDITING SHIFT CLOSED');
  _log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const reqClose = {
    body: { handoverNote: 'All good' },
    params: { id: 'shift_test' },
    user: { id: 'staff_1', name: 'Test Staff', role: 'owner' },
    app: reqOpen.app
  };
  const resClose = { status: () => resClose, json: () => {} };

  await shiftsCtrl.closeShift(reqClose, resClose);
  _log(`\nTotal pushes triggered for closeShift: ${pushCount}\n`);
}

run();
