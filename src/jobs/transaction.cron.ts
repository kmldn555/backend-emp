import cron from "node-cron";
import { sweepOverdueTransactions } from "../services/transaction.service.js";

export const startTransactionCronJob = () => {
  console.log("[Cron] Transaction sweeper initialized (runs every 1 minute)");

  // 1. Run once immediately when the server starts so you don't wait 60s
  sweepOverdueTransactions()
    .then(({ expiredCount, canceledCount }) => {
      console.log(
        `[Cron Startup Sweep] Expired: ${expiredCount}, Canceled: ${canceledCount}`,
      );
    })
    .catch((err) => console.error("[Cron Startup Error]:", err));

  // 2. Schedule to run every 1 minute ("* * * * *")
  cron.schedule("* * * * *", async () => {
    try {
      const { expiredCount, canceledCount } = await sweepOverdueTransactions();
      console.log(
        `[Cron Tick ${new Date().toISOString()}] Expired: ${expiredCount}, Canceled: ${canceledCount}`,
      );
    } catch (error) {
      console.error("[Cron] Error sweeping overdue transactions:", error);
    }
  });
};
