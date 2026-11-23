import { Router } from "express";
import { cols } from "../db";
import { verifyToken, wrap } from "../middleware/auth";

const router = Router();

/** PATCH /api/users/profile - any logged-in user; email and role can never be changed here. */
router.patch(
  "/profile",
  verifyToken,
  wrap(async (req, res) => {
    const { name, phone, area, bio, image } = req.body || {};
    const set: Record<string, string> = {};
    if (name !== undefined) {
      const n = String(name).trim();
      if (n.length < 2) return void res.status(400).json({ message: "Name must be at least 2 characters" });
      set.name = n;
    }
    if (phone !== undefined) set.phone = String(phone).trim();
    if (area !== undefined) set.area = String(area).trim();
    if (bio !== undefined) set.bio = String(bio).trim().slice(0, 400);
    if (image !== undefined) set.image = String(image).trim();
    if (!Object.keys(set).length) return void res.status(400).json({ message: "Nothing to update" });

    const { users } = await cols();
    await users.updateOne({ email: req.user!.email }, { $set: { ...set, updatedAt: new Date() } });
    res.json({ message: "Profile updated", ...set });
  })
);

export default router;
