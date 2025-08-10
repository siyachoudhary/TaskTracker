import jwt from "jsonwebtoken";
import { env } from "./env";

export function issueJwt(userId: string) {
  return jwt.sign({ sub: userId }, env.JWT_SECRET, { expiresIn: "7d" });
}

export function auth(req: any, _res: any, next: any) {
  const token = req.cookies?.token || req.headers.authorization?.split(" ")[1];
  if (!token) return next();
  try { req.user = jwt.verify(token, env.JWT_SECRET); } catch {}
  next();
}