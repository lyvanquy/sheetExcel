"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticateToken = authenticateToken;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const JWT_SECRET = process.env.JWT_SECRET || "excel-cleaner-jwt-secret-key-999";
function authenticateToken(req, res, next) {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    if (!token) {
        return res.status(401).json({ error: "Yêu cầu đăng nhập. Không tìm thấy mã thông báo (Token)." });
    }
    jsonwebtoken_1.default.verify(token, JWT_SECRET, (err, decoded) => {
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
