import "dotenv/config";
import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import adminRoutes from "./routes/admin";
import bookingRoutes from "./routes/bookings";
import paymentRoutes, { webhookRouter } from "./routes/payments";
import serviceRoutes from "./routes/services";
import statsRoutes from "./routes/stats";
import userRoutes from "./routes/users";

const app = express();

const allowed = (process.env.CLIENT_URL || "http://localhost:3000")
  .split(",")
  .map((o) => o.trim().replace(/\/$/, ""))
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {

      if (!origin || allowed.includes(origin)) return cb(null, true);
      cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);


app.use("/api/payments/webhook", webhookRouter);
app.use(express.json());

app.get("/", (_req, res) => res.json({ name: "FixMate API", status: "ok" }));
app.get("/api", (_req, res) => res.json({ name: "FixMate API", status: "ok" }));

app.use("/api/services", serviceRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/users", userRoutes);
app.use("/api/stats", statsRoutes);

app.use((_req, res) => res.status(404).json({ message: "Route not found" }));


app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ message: err.message || "Internal server error" });
});

export default app;
