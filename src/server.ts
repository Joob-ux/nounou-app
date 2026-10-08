import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";
import { releaseDueFunds } from "./modules/bookings/bookings.service";

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info(`API demarree sur le port ${env.PORT} (${env.NODE_ENV})`);
});

// Liberation des fonds en sequestre, toutes les 15 minutes.
// A remplacer par une file de taches (BullMQ) quand le trafic augmentera.
const interval = setInterval(() => {
  releaseDueFunds()
    .then((n) => n > 0 && logger.info(`${n} mission(s) liberee(s)`))
    .catch((err) => logger.error({ err }, "Echec de la liberation des fonds"));
}, 15 * 60_000);

async function shutdown(signal: string) {
  logger.info(`${signal} recu, arret en cours`);
  clearInterval(interval);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
