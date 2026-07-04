import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "excel-cleaner-jwt-secret-key-999";

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
  };
}

export function authenticateToken(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Yêu cầu đăng nhập. Không tìm thấy mã thông báo (Token)." });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded: any) => {
    if (err) {
      return res.status(403).json({ error: "Mã thông báo không hợp lệ hoặc đã hết hạn." });
    }

    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role || "USER",
    };

    next();
  });
}
