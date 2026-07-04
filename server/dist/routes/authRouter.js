"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = __importDefault(require("../db"));
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
const JWT_SECRET = process.env.JWT_SECRET || "excel-cleaner-jwt-secret-key-999";
/**
 * POST /api/auth/register
 * Register a new user
 */
router.post("/register", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: "Vui lòng nhập đầy đủ email và mật khẩu." });
    }
    try {
        const existingUser = await db_1.default.user.findUnique({
            where: { email },
        });
        if (existingUser) {
            return res.status(400).json({ error: "Email đã tồn tại trên hệ thống." });
        }
        const hashedPassword = await bcrypt_1.default.hash(password, 10);
        // Automatically make admin@example.com an ADMIN
        const role = email.toLowerCase() === "admin@example.com" ? "ADMIN" : "USER";
        const user = await db_1.default.user.create({
            data: {
                email,
                password: hashedPassword,
                role,
            },
        });
        const token = jsonwebtoken_1.default.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
        return res.status(201).json({
            message: "Đăng ký tài khoản thành công",
            token,
            user: {
                id: user.id,
                email: user.email,
                role: user.role,
            },
        });
    }
    catch (error) {
        console.error("Register error:", error);
        return res.status(500).json({ error: "Không thể đăng ký tài khoản." });
    }
});
/**
 * POST /api/auth/login
 * Log in an existing user
 */
router.post("/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: "Vui lòng nhập đầy đủ email và mật khẩu." });
    }
    try {
        const user = await db_1.default.user.findUnique({
            where: { email },
        });
        if (!user) {
            return res.status(401).json({ error: "Email hoặc mật khẩu không chính xác." });
        }
        const isMatch = await bcrypt_1.default.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: "Email hoặc mật khẩu không chính xác." });
        }
        const token = jsonwebtoken_1.default.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
        return res.json({
            message: "Đăng nhập thành công",
            token,
            user: {
                id: user.id,
                email: user.email,
                role: user.role,
            },
        });
    }
    catch (error) {
        console.error("Login error:", error);
        return res.status(500).json({ error: "Không thể đăng nhập." });
    }
});
/**
 * GET /api/auth/me
 * Validate current token and return user profile
 */
router.get("/me", auth_1.authenticateToken, (req, res) => {
    return res.json({ user: req.user });
});
exports.default = router;
