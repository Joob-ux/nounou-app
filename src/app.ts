import express, { raw } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { logger } from "./lib/logger";
import { errorHandler, notFoundHandler } from "./middleware/error";
import { authRouter } from "./modules/auth/auth.routes";
import { nanniesRouter } from "./modules/nannies/nannies.routes";
import { parentsRouter } from "./modules/parents/parents.routes";
import { adminRouter } from "./modules/admin/admin.routes";
import { bookingsRouter } from "./modules/bookings/bookings.routes";
import { paymentsRouter } from "./modules/payments/payments.routes";
import { devRouter } from "./modules/dev/dev.routes";
import { env, testToolsEnabled } from "./config/env";

export function createApp() {
  const app = express();
  // Derriere le proxy de l'hebergeur (Render) : vraie IP pour la limitation de debit
  app.set("trust proxy", 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // blob: pour afficher les pieces (image / PDF) dans le back-office
          "img-src": ["'self'", "data:", "blob:"],
          "frame-src": ["'self'", "blob:"],
        },
      },
    }),
  );
  app.use(cors({ origin: true, credentials: true }));
  app.use(pinoHttp({ logger }));

  // Le webhook a besoin du corps brut pour verifier la signature :
  // on le lit en brut AVANT express.json(), qui ignore ensuite ce corps deja lu.
  app.use("/api/payments/webhook", raw({ type: "application/json" }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => res.json({ status: "ok", time: new Date().toISOString() }));
  // Ce que l'appli doit savoir au demarrage
  app.get("/api/config", (_req, res) =>
    res.json({ demo: testToolsEnabled, feePct: env.FRAIS_SERVICE_PCT, commissionPct: env.COMMISSION_PCT }),
  );

  app.use("/api/auth", authRouter);
  app.use("/api/parents", parentsRouter);
  app.use("/api/nannies", nanniesRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/bookings", bookingsRouter);
  app.use("/api/payments", paymentsRouter);

  if (testToolsEnabled) {
    app.use("/api/dev", devRouter);
    // Console technique : /console.html
    app.use(express.static("public"));
  }
  // L'appli (parents, nounous, back-office) : servie a la racine, en demo comme en production
  app.use(express.static("public/app"));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
