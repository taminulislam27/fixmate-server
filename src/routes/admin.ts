import { Router } from "express";
import { cols, toObjectId } from "../db";
import { verifyAdmin, verifyToken, wrap } from "../middleware/auth";

const router = Router();
router.use(verifyToken, verifyAdmin);

const ROLES = ["customer", "technician", "admin"];

router.get(
  "/users",
  wrap(async (_req, res) => {
    const { users } = await cols();
    const items = await users
      .find({}, { projection: { name: 1, email: 1, image: 1, role: 1, createdAt: 1 } })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(items.map((u) => ({ ...u, role: u.role || "customer" })));
  })
);

router.patch(
  "/users/:id/role",
  wrap(async (req, res) => {
    const _id = toObjectId(req.params.id);
    if (!_id) return void res.status(404).json({ message: "User not found" });
    const role = String(req.body?.role || "");
    if (!ROLES.includes(role)) return void res.status(400).json({ message: "Invalid role" });
    if (String(_id) === req.user!.id)
      return void res.status(400).json({ message: "You cannot change your own role" });
    const { users } = await cols();
    const result = await users.updateOne({ _id }, { $set: { role } });
    if (!result.matchedCount) return void res.status(404).json({ message: "User not found" });
    res.json({ message: `Role changed to ${role}` });
  })
);

router.get(
  "/services",
  wrap(async (req, res) => {
    const { services } = await cols();
    const filter: Record<string, unknown> = {};
    if (typeof req.query.status === "string" && req.query.status) filter.approvalStatus = req.query.status;
    // pending first, then newest
    const items = await services.find(filter).toArray();
    const order: Record<string, number> = { pending: 0, approved: 1, rejected: 2 };
    items.sort(
      (a, b) =>
        (order[a.approvalStatus] ?? 9) - (order[b.approvalStatus] ?? 9) ||
        +new Date(b.createdAt) - +new Date(a.createdAt)
    );
    res.json(items);
  })
);

router.patch(
  "/services/:id/approval",
  wrap(async (req, res) => {
    const _id = toObjectId(req.params.id);
    if (!_id) return void res.status(404).json({ message: "Service not found" });
    const status = String(req.body?.approvalStatus || "");
    if (!["approved", "rejected"].includes(status))
      return void res.status(400).json({ message: "approvalStatus must be approved or rejected" });
    const { services } = await cols();
    const result = await services.updateOne({ _id }, { $set: { approvalStatus: status } });
    if (!result.matchedCount) return void res.status(404).json({ message: "Service not found" });
    res.json({ message: `Service ${status}` });
  })
);

router.get(
  "/bookings",
  wrap(async (req, res) => {
    const { bookings } = await cols();
    const filter: Record<string, unknown> = {};
    if (typeof req.query.status === "string" && req.query.status) filter.status = req.query.status;
    res.json(await bookings.find(filter).sort({ createdAt: -1 }).toArray());
  })
);

router.get(
  "/payments",
  wrap(async (_req, res) => {
    const { payments } = await cols();
    const items = await payments.find({}).sort({ paidAt: -1 }).toArray();
    const totalRevenue = items.reduce((sum, p) => sum + (p.amount || 0), 0);
    res.json({ items, totalRevenue });
  })
);

export default router;
