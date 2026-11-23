import { Router } from "express";
import { cols, toObjectId } from "../db";
import { verifyCustomer, verifyTechnician, verifyToken, wrap } from "../middleware/auth";

const router = Router();

const TECH_TRANSITIONS: Record<string, string[]> = {
  requested: ["accepted", "rejected"],
  accepted: ["in-progress"],
  "in-progress": ["completed"],
};
const ACTIVE = ["requested", "accepted", "in-progress"];


router.post(
  "/",
  verifyToken,
  verifyCustomer,
  wrap(async (req, res) => {
    const { serviceId, customerPhone, address, preferredDate, problemDescription } = req.body || {};
    const errors: string[] = [];
    if (!String(customerPhone || "").trim()) errors.push("Phone is required");
    if (!String(address || "").trim()) errors.push("Address is required");
    if (String(problemDescription || "").trim().length < 20)
      errors.push("Problem description must be at least 20 characters");

    const date = new Date(preferredDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (!preferredDate || isNaN(date.getTime())) errors.push("Preferred date is required");
    else if (date < today) errors.push("Preferred date must be today or in the future");
    if (errors.length) return void res.status(400).json({ message: errors[0], errors });

    const _id = toObjectId(String(serviceId || ""));
    if (!_id) return void res.status(404).json({ message: "Service not found" });

    const { services, bookings } = await cols();
    const service = await services.findOne({ _id, approvalStatus: "approved", isAvailable: true });
    if (!service) return void res.status(404).json({ message: "Service not found or unavailable" });
    if (service.technicianEmail === req.user!.email)
      return void res.status(403).json({ message: "You cannot request your own service" });

    const duplicate = await bookings.findOne({
      serviceId: String(service._id),
      customerEmail: req.user!.email,
      status: { $in: ACTIVE },
    });
    if (duplicate)
      return void res
        .status(409)
        .json({ message: "You already have an active request for this service" });

    const now = new Date();
    const doc = {
      serviceId: String(service._id),
      serviceTitle: service.title,
      serviceImage: service.image,
      category: service.category,
      basePrice: service.basePrice,
      technicianName: service.technicianName,
      technicianEmail: service.technicianEmail,
      customerName: req.user!.name,
      customerEmail: req.user!.email,
      customerPhone: String(customerPhone).trim(),
      address: String(address).trim(),
      preferredDate: date,
      problemDescription: String(problemDescription).trim(),
      status: "requested",
      finalAmount: service.basePrice,
      paymentStatus: "unpaid",
      statusHistory: [{ status: "requested", changedAt: now }],
      createdAt: now,
    };
    const result = await bookings.insertOne(doc);
    res.status(201).json({ _id: result.insertedId, ...doc });
  })
);


router.get(
  "/my",
  verifyToken,
  verifyCustomer,
  wrap(async (req, res) => {
    const { bookings } = await cols();
    const items = await bookings
      .find({ customerEmail: req.user!.email })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(items);
  })
);


router.get(
  "/technician",
  verifyToken,
  verifyTechnician,
  wrap(async (req, res) => {
    const { bookings } = await cols();
    const filter: Record<string, unknown> = { technicianEmail: req.user!.email };
    if (typeof req.query.status === "string" && req.query.status) filter.status = req.query.status;
    const items = await bookings.find(filter).sort({ createdAt: -1 }).toArray();
    res.json(items);
  })
);


router.patch(
  "/:id/cancel",
  verifyToken,
  verifyCustomer,
  wrap(async (req, res) => {
    const _id = toObjectId(req.params.id);
    if (!_id) return void res.status(404).json({ message: "Booking not found" });
    const { bookings } = await cols();
    const booking = await bookings.findOne({ _id });
    if (!booking) return void res.status(404).json({ message: "Booking not found" });
    if (booking.customerEmail !== req.user!.email)
      return void res.status(403).json({ message: "Forbidden: not your booking" });
    if (booking.status !== "requested")
      return void res
        .status(400)
        .json({ message: "Only a requested job can be cancelled" });

    await bookings.updateOne(
      { _id, status: "requested" },
      {
        $set: { status: "cancelled" },
        $push: { statusHistory: { status: "cancelled", changedAt: new Date() } } as any,
      }
    );
    res.json({ message: "Booking cancelled" });
  })
);


router.patch(
  "/:id/status",
  verifyToken,
  verifyTechnician,
  wrap(async (req, res) => {
    const _id = toObjectId(req.params.id);
    if (!_id) return void res.status(404).json({ message: "Booking not found" });
    const { bookings } = await cols();
    const booking = await bookings.findOne({ _id });
    if (!booking) return void res.status(404).json({ message: "Booking not found" });
    if (booking.technicianEmail !== req.user!.email)
      return void res.status(403).json({ message: "Forbidden: this job is not yours" });

    const next = String(req.body?.status || "");
    const allowed = TECH_TRANSITIONS[booking.status] || [];
    if (!allowed.includes(next))
      return void res
        .status(400)
        .json({ message: `Invalid status change: ${booking.status} → ${next || "?"}` });

    const set: Record<string, unknown> = { status: next };
    if (next === "completed") {
      const amount = Number(req.body?.finalAmount);
      if (!Number.isFinite(amount) || amount <= 0)
        return void res.status(400).json({ message: "finalAmount must be a number greater than 0" });
      set.finalAmount = amount;
    }


    const result = await bookings.updateOne(
      { _id, status: booking.status },
      { $set: set, $push: { statusHistory: { status: next, changedAt: new Date() } } as any }
    );
    if (!result.matchedCount)
      return void res.status(409).json({ message: "Job was changed by someone else, refresh" });
    res.json({ message: `Job marked ${next}` });
  })
);


router.post(
  "/:id/review",
  verifyToken,
  verifyCustomer,
  wrap(async (req, res) => {
    const _id = toObjectId(req.params.id);
    if (!_id) return void res.status(404).json({ message: "Booking not found" });
    const rating = Number(req.body?.rating);
    const review = String(req.body?.review || "").trim().slice(0, 500);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5)
      return void res.status(400).json({ message: "Rating must be a whole number from 1 to 5" });

    const { bookings } = await cols();
    const booking = await bookings.findOne({ _id });
    if (!booking) return void res.status(404).json({ message: "Booking not found" });
    if (booking.customerEmail !== req.user!.email)
      return void res.status(403).json({ message: "Forbidden: not your booking" });
    if (booking.paymentStatus !== "paid")
      return void res.status(400).json({ message: "You can review a job only after paying" });
    if (booking.rating) return void res.status(409).json({ message: "You already reviewed this job" });

    await bookings.updateOne({ _id }, { $set: { rating, review, reviewedAt: new Date() } });
    res.json({ message: "Thanks for your review" });
  })
);

export default router;
