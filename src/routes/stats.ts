import { Router } from "express";
import { cols } from "../db";
import { verifyToken, wrap } from "../middleware/auth";

const router = Router();

const countBy = (rows: { status?: string }[]) => {
  const out: Record<string, number> = {};
  rows.forEach((r) => {
    const k = r.status || "unknown";
    out[k] = (out[k] || 0) + 1;
  });
  return out;
};

/** GET /api/stats/overview - role-aware numbers + chart data for the dashboard overview pages. */
router.get(
  "/overview",
  verifyToken,
  wrap(async (req, res) => {
    const { users, services, bookings, payments } = await cols();
    const { role, email } = req.user!;

    if (role === "customer") {
      const mine = await bookings.find({ customerEmail: email }).toArray();
      const paid = await payments.find({ customerEmail: email }).toArray();
      return void res.json({
        role,
        totalRequests: mine.length,
        activeJobs: mine.filter((b) => ["requested", "accepted", "in-progress"].includes(b.status)).length,
        completedJobs: mine.filter((b) => b.status === "completed").length,
        totalSpent: paid.reduce((s, p) => s + (p.amount || 0), 0),
        byStatus: countBy(mine),
      });
    }

    if (role === "technician") {
      const myServices = await services.find({ technicianEmail: email }).toArray();
      const jobs = await bookings.find({ technicianEmail: email }).toArray();
      const earned = await payments.find({ technicianEmail: email }).toArray();
      return void res.json({
        role,
        totalServices: myServices.length,
        approvedServices: myServices.filter((s) => s.approvalStatus === "approved").length,
        pendingRequests: jobs.filter((j) => j.status === "requested").length,
        earnings: earned.reduce((s, p) => s + (p.amount || 0), 0),
        byStatus: countBy(jobs),
      });
    }

    // admin
    const allBookings = await bookings.find({}).toArray();
    const allServices = await services.find({}).toArray();
    const allPayments = await payments.find({}).toArray();
    const byCategory: Record<string, number> = {};
    allServices.forEach((s) => (byCategory[s.category] = (byCategory[s.category] || 0) + 1));
    const revenueByDay: Record<string, number> = {};
    allPayments.forEach((p) => {
      const d = new Date(p.paidAt).toISOString().slice(0, 10);
      revenueByDay[d] = (revenueByDay[d] || 0) + (p.amount || 0);
    });
    res.json({
      role,
      totalUsers: await users.countDocuments({}),
      totalTechnicians: await users.countDocuments({ role: "technician" }),
      pendingServices: allServices.filter((s) => s.approvalStatus === "pending").length,
      totalRevenue: allPayments.reduce((s, p) => s + (p.amount || 0), 0),
      byStatus: countBy(allBookings),
      servicesByCategory: byCategory,
      revenueByDay,
    });
  })
);

/** GET /api/stats/public - landing page numbers (no auth). */
router.get(
  "/public",
  wrap(async (_req, res) => {
    const { users, bookings, services } = await cols();
    res.json({
      technicians: await users.countDocuments({ role: "technician" }),
      completedJobs: await bookings.countDocuments({ status: "completed" }),
      services: await services.countDocuments({ approvalStatus: "approved", isAvailable: true }),
    });
  })
);

export default router;
