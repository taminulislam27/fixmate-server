import { Router } from "express";
import { cols, toObjectId } from "../db";
import { verifyTechnician, verifyToken, wrap } from "../middleware/auth";

export const CATEGORIES = [
  "Smartphone",
  "Laptop & PC",
  "AC",
  "Refrigerator",
  "TV",
  "Washing Machine",
  "Electrical",
] as const;
const MODES = ["Home Visit", "Shop Drop-off"] as const;

const router = Router();

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Average rating + count per service id, computed from reviewed bookings. */
async function ratingMap(serviceIds: string[]) {
  const { bookings } = await cols();
  const rows = await bookings
    .aggregate([
      { $match: { serviceId: { $in: serviceIds }, rating: { $gte: 1 } } },
      { $group: { _id: "$serviceId", avg: { $avg: "$rating" }, count: { $sum: 1 } } },
    ])
    .toArray();
  const map = new Map<string, { avgRating: number; reviewCount: number }>();
  rows.forEach((r) =>
    map.set(String(r._id), { avgRating: Math.round(r.avg * 10) / 10, reviewCount: r.count })
  );
  return map;
}

function validateServiceBody(body: any) {
  const errors: string[] = [];
  const title = String(body.title || "").trim();
  const description = String(body.description || "").trim();
  const basePrice = Number(body.basePrice);
  if (title.length < 3) errors.push("Title must be at least 3 characters");
  if (!CATEGORIES.includes(body.category)) errors.push("Invalid category");
  if (description.length < 10) errors.push("Description must be at least 10 characters");
  if (!Number.isFinite(basePrice) || basePrice <= 0) errors.push("Base price must be a positive number");
  if (!String(body.estimatedDuration || "").trim()) errors.push("Estimated duration is required");
  if (!MODES.includes(body.serviceMode)) errors.push("Invalid service mode");
  if (!String(body.serviceArea || "").trim()) errors.push("Service area is required");
  if (!String(body.image || "").trim()) errors.push("Service image is required");
  return {
    errors,
    data: {
      title,
      category: body.category,
      description,
      image: String(body.image || "").trim(),
      basePrice,
      estimatedDuration: String(body.estimatedDuration || "").trim(),
      serviceMode: body.serviceMode,
      serviceArea: String(body.serviceArea || "").trim(),
    },
  };
}

/** GET /api/services - public. Search, filter, sort and (optional) pagination all run in MongoDB. */
router.get(
  "/",
  wrap(async (req, res) => {
    const { services } = await cols();
    const { q, category, mode, sort, page, limit } = req.query as Record<string, string | undefined>;

    const filter: Record<string, unknown> = { approvalStatus: "approved", isAvailable: true };
    if (q && q.trim()) {
      const rx = new RegExp(escapeRegex(q.trim()), "i");
      filter.$or = [{ title: rx }, { category: rx }];
    }
    if (category && CATEGORIES.includes(category as any)) filter.category = category;
    if (mode && MODES.includes(mode as any)) filter.serviceMode = mode;

    const sortMap: Record<string, Record<string, 1 | -1>> = {
      "price-asc": { basePrice: 1, createdAt: -1 },
      "price-desc": { basePrice: -1, createdAt: -1 },
      newest: { createdAt: -1 },
    };
    const sortBy = sortMap[sort || "newest"] || sortMap.newest;

    const pageSize = Math.min(Math.max(parseInt(limit || "0", 10) || 0, 0), 50);
    const pageNum = Math.max(parseInt(page || "1", 10) || 1, 1);

    const total = await services.countDocuments(filter);
    let cursor = services.find(filter).sort(sortBy);
    if (pageSize) cursor = cursor.skip((pageNum - 1) * pageSize).limit(pageSize);
    const items = await cursor.toArray();

    const ratings = await ratingMap(items.map((s) => String(s._id)));
    const withRatings = items.map((s) => ({
      ...s,
      avgRating: ratings.get(String(s._id))?.avgRating ?? 0,
      reviewCount: ratings.get(String(s._id))?.reviewCount ?? 0,
    }));

    res.json({
      items: withRatings,
      total,
      page: pageNum,
      totalPages: pageSize ? Math.max(Math.ceil(total / pageSize), 1) : 1,
    });
  })
);

/** GET /api/services/my - technician's own services (declared before /:id). */
router.get(
  "/my",
  verifyToken,
  verifyTechnician,
  wrap(async (req, res) => {
    const { services } = await cols();
    const items = await services
      .find({ technicianEmail: req.user!.email })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(items);
  })
);

/** GET /api/services/:id - public, only approved + available services. */
router.get(
  "/:id",
  wrap(async (req, res) => {
    const _id = toObjectId(req.params.id);
    if (!_id) return void res.status(404).json({ message: "Service not found" });
    const { services, users, bookings } = await cols();
    const service = await services.findOne({ _id, approvalStatus: "approved", isAvailable: true });
    if (!service) return void res.status(404).json({ message: "Service not found" });

    const tech = await users.findOne(
      { email: service.technicianEmail },
      { projection: { name: 1, image: 1, area: 1, bio: 1, email: 1 } }
    );
    const ratings = await ratingMap([String(service._id)]);
    const reviews = await bookings
      .find({ serviceId: String(service._id), rating: { $gte: 1 } })
      .sort({ reviewedAt: -1 })
      .limit(10)
      .project({ customerName: 1, rating: 1, review: 1, reviewedAt: 1 })
      .toArray();

    res.json({
      ...service,
      avgRating: ratings.get(String(service._id))?.avgRating ?? 0,
      reviewCount: ratings.get(String(service._id))?.reviewCount ?? 0,
      reviews,
      technician: {
        name: tech?.name || service.technicianName,
        image: tech?.image || "",
        area: tech?.area || service.serviceArea,
        bio: tech?.bio || "",
      },
    });
  })
);

/** POST /api/services - technician creates a service (pending approval). */
router.post(
  "/",
  verifyToken,
  verifyTechnician,
  wrap(async (req, res) => {
    const { errors, data } = validateServiceBody(req.body);
    if (errors.length) return void res.status(400).json({ message: errors[0], errors });
    const { services } = await cols();
    const doc = {
      ...data,
      technicianName: req.user!.name,
      technicianEmail: req.user!.email,
      approvalStatus: "pending",
      isAvailable: true,
      createdAt: new Date(),
    };
    const result = await services.insertOne(doc);
    res.status(201).json({ _id: result.insertedId, ...doc });
  })
);

/** PATCH /api/services/:id - owner edits; goes back to pending. */
router.patch(
  "/:id",
  verifyToken,
  verifyTechnician,
  wrap(async (req, res) => {
    const _id = toObjectId(req.params.id);
    if (!_id) return void res.status(404).json({ message: "Service not found" });
    const { services } = await cols();
    const existing = await services.findOne({ _id });
    if (!existing) return void res.status(404).json({ message: "Service not found" });
    if (existing.technicianEmail !== req.user!.email) {
      return void res.status(403).json({ message: "Forbidden: you do not own this service" });
    }

    // Availability-only toggle does not need re-approval
    if (Object.keys(req.body).length === 1 && typeof req.body.isAvailable === "boolean") {
      await services.updateOne({ _id }, { $set: { isAvailable: req.body.isAvailable } });
      return void res.json({ message: "Availability updated", isAvailable: req.body.isAvailable });
    }

    const { errors, data } = validateServiceBody({ ...existing, ...req.body });
    if (errors.length) return void res.status(400).json({ message: errors[0], errors });
    await services.updateOne({ _id }, { $set: { ...data, approvalStatus: "pending" } });
    res.json({ message: "Service updated and sent for re-approval" });
  })
);

/** DELETE /api/services/:id - owner deletes. */
router.delete(
  "/:id",
  verifyToken,
  verifyTechnician,
  wrap(async (req, res) => {
    const _id = toObjectId(req.params.id);
    if (!_id) return void res.status(404).json({ message: "Service not found" });
    const { services } = await cols();
    const existing = await services.findOne({ _id });
    if (!existing) return void res.status(404).json({ message: "Service not found" });
    if (existing.technicianEmail !== req.user!.email) {
      return void res.status(403).json({ message: "Forbidden: you do not own this service" });
    }
    await services.deleteOne({ _id });
    res.json({ message: "Service deleted" });
  })
);

export default router;
