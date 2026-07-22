import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// This API only ever returns JSON, so a strict default-src is safe and adds
// baseline hardening (X-Content-Type-Options, X-Frame-Options, HSTS, etc.)
// at no risk to existing responses. The frontend is built and served
// separately (see README) and should set its own CSP at that layer.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        connectSrc: ["'self'"],
      },
    },
  }),
);

// CORS_ORIGIN: comma-separated allowlist of origins permitted to call this
// API (e.g. "https://app.example.com,https://admin.example.com"). Left
// unset, all origins are allowed, matching this project's previous
// behavior — set it in production deployments.
const corsOrigin = process.env.CORS_ORIGIN;
const allowedOrigins = corsOrigin
  ? corsOrigin.split(",").map((origin) => origin.trim()).filter(Boolean)
  : undefined;

if (process.env.NODE_ENV === "production" && !allowedOrigins) {
  logger.warn(
    "CORS_ORIGIN is not set in production; all origins are currently allowed. Set CORS_ORIGIN to a comma-separated allowlist.",
  );
}

app.use(cors({ origin: allowedOrigins ?? true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
