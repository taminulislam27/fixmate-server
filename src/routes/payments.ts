import express, { Router } from "express";
import Stripe from "stripe";
import { cols, toObjectId } from "../db";
import { verifyCustomer, verifyToken, wrap } from "../middleware/auth";

const router = Router();

const stripe = () => new Stripe(process.env.STRIPE_SECRET_KEY as string);

/**
 * Saves the payment for a paid Checkout Session exactly once.
 * Used by both the success-page verification and the webhook; the unique index on
 * stripeSessionId plus the paymentStatus guard make a double save impossible.
 */
export async function savePaidSession(session: Stripe.Checkout.Session) {
  if (session.payment_status !== "paid") return { saved: false as const, reason: "unpaid" };
  const bookingIdStr = session.metadata?.bookingId || "";
  const _id = toObjectId(bookingIdStr);
  if (!_id) return { saved: false as const, reason: "bad-booking" };

  const { bookings, payments } = await cols();
  const existing = await payments.findOne({ stripeSessionId: session.id });
  if (existing) return { saved: false as const, reason: "duplicate", payment: existing };

  const booking = await bookings.findOne({ _id });
  if (!booking) return { saved: false as const, reason: "no-booking" };

  const doc = {
    bookingId: bookingIdStr,
    serviceTitle: booking.serviceTitle,
    customerName: booking.customerName,
    customerEmail: booking.customerEmail,
    technicianName: booking.technicianName,
    technicianEmail: booking.technicianEmail,
    amount: (session.amount_total ?? 0) / 100,
    currency: "usd",
    transactionId:
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id || "",
    stripeSessionId: session.id,
    paymentStatus: "paid",
    paidAt: new Date(),
  };

  try {
    await payments.insertOne(doc);
  } catch (err: any) {
    if (err?.code === 11000) {
      return { saved: false as const, reason: "duplicate", payment: await payments.findOne({ stripeSessionId: session.id }) };
    }
    throw err;
  }
  await bookings.updateOne(
    { _id, paymentStatus: "unpaid" },
    { $set: { paymentStatus: "paid" }, $push: { statusHistory: { status: "paid", changedAt: new Date() } } as any }
  );
  return { saved: true as const, payment: doc };
}

/** POST /api/payments/create-checkout-session - amount always comes from the DB. */
router.post(
  "/create-checkout-session",
  verifyToken,
  verifyCustomer,
  wrap(async (req, res) => {
    const _id = toObjectId(String(req.body?.bookingId || ""));
    if (!_id) return void res.status(404).json({ message: "Booking not found" });
    const { bookings } = await cols();
    const booking = await bookings.findOne({ _id });
    if (!booking) return void res.status(404).json({ message: "Booking not found" });
    if (booking.customerEmail !== req.user!.email)
      return void res.status(403).json({ message: "Forbidden: not your booking" });
    if (booking.status !== "completed" || booking.paymentStatus !== "unpaid")
      return void res.status(400).json({ message: "Only completed, unpaid jobs can be paid" });

    const client = (process.env.CLIENT_URL || "").split(",")[0].trim();
    const session = await stripe().checkout.sessions.create({
      mode: "payment",
      customer_email: req.user!.email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: Math.round(Number(booking.finalAmount) * 100),
            product_data: { name: booking.serviceTitle, description: `Repair job by ${booking.technicianName}` },
          },
        },
      ],
      metadata: { bookingId: String(booking._id), customerEmail: req.user!.email },
      success_url: `${client}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${client}/payment/cancel`,
    });
    res.json({ url: session.url, sessionId: session.id });
  })
);

/** GET /api/payments/verify?session_id= - saves the payment after Stripe confirms it. */
router.get(
  "/verify",
  verifyToken,
  verifyCustomer,
  wrap(async (req, res) => {
    const sessionId = String(req.query.session_id || "");
    if (!sessionId) return void res.status(400).json({ message: "session_id is required" });
    const session = await stripe().checkout.sessions.retrieve(sessionId);
    if (session.metadata?.customerEmail !== req.user!.email)
      return void res.status(403).json({ message: "Forbidden: not your payment" });
    if (session.payment_status !== "paid")
      return void res.status(400).json({ message: "Payment not completed" });

    const result = await savePaidSession(session);
    const { payments } = await cols();
    const payment = (result as any).payment || (await payments.findOne({ stripeSessionId: sessionId }));
    if (!payment) return void res.status(500).json({ message: "Could not record payment" });
    res.json(payment);
  })
);

/** GET /api/payments/my - payment history for the logged-in customer. */
router.get(
  "/my",
  verifyToken,
  verifyCustomer,
  wrap(async (req, res) => {
    const { payments } = await cols();
    res.json(await payments.find({ customerEmail: req.user!.email }).sort({ paidAt: -1 }).toArray());
  })
);

/** Stripe webhook router. Mounted in app.ts BEFORE express.json() because it needs the raw body. */
export const webhookRouter = Router();
webhookRouter.post(
  "/",
  express.raw({ type: "application/json" }),
  wrap(async (req, res) => {
    const sig = req.headers["stripe-signature"] as string;
    let event: Stripe.Event;
    try {
      event = stripe().webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET as string);
    } catch {
      return void res.status(400).send("Webhook signature verification failed");
    }
    if (event.type === "checkout.session.completed") {
      await savePaidSession(event.data.object as Stripe.Checkout.Session);
    }
    res.json({ received: true });
  })
);

export default router;
