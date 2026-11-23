import { NextFunction, Request, RequestHandler, Response } from "express";
import jwt from "jsonwebtoken";
import { cols } from "../db";

export type Role = "customer" | "technician" | "admin";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** Wraps async handlers so rejected promises reach the error handler. */
export const wrap =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

/** 401 when the token is missing/invalid. The role is always re-read from the database. */
export const verifyToken: RequestHandler = wrap(async (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return void res.status(401).json({ message: "Unauthorized: token missing" });

  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET as string) as jwt.JwtPayload;
  } catch {
    return void res.status(401).json({ message: "Unauthorized: invalid or expired token" });
  }

  const email = typeof payload.email === "string" ? payload.email : "";
  if (!email) return void res.status(401).json({ message: "Unauthorized: invalid token" });

  const { users } = await cols();
  const user = await users.findOne({ email });
  if (!user) return void res.status(401).json({ message: "Unauthorized: user not found" });

  req.user = {
    id: String(user._id),
    email: user.email,
    name: user.name,
    role: (user.role as Role) || "customer",
  };
  next();
});

const requireRole =
  (role: Role): RequestHandler =>
  (req, res, next) => {
    if (!req.user) return void res.status(401).json({ message: "Unauthorized" });
    if (req.user.role !== role) {
      return void res.status(403).json({ message: `Forbidden: ${role} access only` });
    }
    next();
  };

export const verifyCustomer = requireRole("customer");
export const verifyTechnician = requireRole("technician");
export const verifyAdmin = requireRole("admin");
