"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const dotenv_1 = __importDefault(require("dotenv"));
const uuid_1 = require("uuid");
const db_1 = __importDefault(require("./db"));
const queue_1 = require("./services/queue");
const authRouter_1 = __importDefault(require("./routes/authRouter"));
const auth_1 = require("./middleware/auth");
// Load environment variables
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
// Middlewares
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Set up directories
const uploadDir = path_1.default.resolve(process.env.UPLOAD_DIR || "uploads");
const resultDir = path_1.default.resolve(process.env.RESULT_DIR || "results");
if (!fs_1.default.existsSync(uploadDir)) {
    fs_1.default.mkdirSync(uploadDir, { recursive: true });
}
if (!fs_1.default.existsSync(resultDir)) {
    fs_1.default.mkdirSync(resultDir, { recursive: true });
}
// Multer disk storage setup
const storage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        const fileId = (0, uuid_1.v4)();
        const destDir = path_1.default.join(uploadDir, fileId);
        if (!fs_1.default.existsSync(destDir)) {
            fs_1.default.mkdirSync(destDir, { recursive: true });
        }
        // Attach fileId to request object
        req.fileId = fileId;
        cb(null, destDir);
    },
    filename: (req, file, cb) => {
        // Keep exact original filename on disk!
        cb(null, file.originalname);
    },
});
const upload = (0, multer_1.default)({
    storage,
    limits: { fileSize: 200 * 1024 * 1024 }, // 200MB file size limit
});
// Initialize Background Workers
(0, queue_1.initQueue)();
// Mount Auth routes
app.use("/api/auth", authRouter_1.default);
/**
 * Helper to parse rules from request body or defaults
 */
function parseRules(body) {
    const mode = body.mode || "strike";
    const fillValue = body.fillValue || "N/A";
    const highlightColor = body.highlightColor || "#FFFF00"; // default yellow
    return {
        mode: mode,
        fillValue,
        highlightColor,
    };
}
/**
 * 1. POST /api/excel/upload
 * Uploads a file and adds it to the cleaning queue. Secures route with JWT check.
 */
app.post("/api/excel/upload", auth_1.authenticateToken, upload.single("file"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "Không tìm thấy file tải lên." });
        }
        const fileRules = parseRules(req.body);
        const originalUrl = path_1.default.relative(process.cwd(), req.file.path).replace(/\\/g, "/");
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Không tìm thấy thông tin định danh người dùng." });
        }
        const fileId = req.fileId;
        // Save metadata to DB
        const excelFile = await db_1.default.excelFile.create({
            data: {
                id: fileId,
                fileName: req.file.originalname,
                originalUrl: originalUrl,
                status: "PENDING",
                rules: JSON.stringify(fileRules),
                userId: userId,
            },
        });
        // Add to Queue
        await (0, queue_1.addJobToQueue)({
            fileId: excelFile.id,
            rules: fileRules,
        });
        return res.status(201).json({
            message: "Đã tải lên tệp tin và lên lịch xử lý dọn dẹp.",
            file: excelFile,
        });
    }
    catch (error) {
        console.error("Upload error:", error);
        return res.status(500).json({ error: error.message || "Không thể tải lên file" });
    }
});
/**
 * 2. GET /api/excel/files
 * Fetch processed files. Standard users only see their own files, Admins see all.
 */
app.get("/api/excel/files", auth_1.authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        const role = req.user?.role;
        if (!userId) {
            return res.status(401).json({ error: "Không được phép truy cập." });
        }
        const whereClause = role === "ADMIN" ? {} : { userId };
        const files = await db_1.default.excelFile.findMany({
            where: whereClause,
            orderBy: { createdAt: "desc" },
            include: {
                jobs: true,
            },
        });
        const formattedFiles = files.map((file) => {
            const emptyCells = file.jobs.reduce((sum, job) => sum + job.emptyCells, 0);
            const totalRows = file.jobs.reduce((sum, job) => sum + job.totalRows, 0);
            return {
                id: file.id,
                fileName: file.fileName,
                status: file.status,
                rules: file.rules ? JSON.parse(file.rules) : null,
                createdAt: file.createdAt,
                sheetCount: file.jobs.length,
                totalRows,
                emptyCells,
            };
        });
        return res.json(formattedFiles);
    }
    catch (error) {
        console.error("Fetch files error:", error);
        return res.status(500).json({ error: "Không thể lấy danh sách file" });
    }
});
/**
 * 3. GET /api/excel/files/:id
 * Retrieve details for a single file with ownership checks
 */
app.get("/api/excel/files/:id", auth_1.authenticateToken, async (req, res) => {
    try {
        const file = await db_1.default.excelFile.findUnique({
            where: { id: req.params.id },
            include: {
                jobs: true,
            },
        });
        if (!file) {
            return res.status(404).json({ error: "Không tìm thấy file" });
        }
        // RBAC check
        if (req.user?.role !== "ADMIN" && file.userId !== req.user?.id) {
            return res.status(403).json({ error: "Bạn không có quyền truy cập tệp của người dùng khác." });
        }
        const rules = file.rules ? JSON.parse(file.rules) : null;
        return res.json({
            ...file,
            rules,
        });
    }
    catch (error) {
        console.error("Get file error:", error);
        return res.status(500).json({ error: "Không thể lấy chi tiết file" });
    }
});
/**
 * 4. GET /api/excel/files/:id/download
 * Downloads processed file with ownership check.
 */
app.get("/api/excel/files/:id/download", auth_1.authenticateToken, async (req, res) => {
    try {
        const file = await db_1.default.excelFile.findUnique({
            where: { id: req.params.id },
        });
        if (!file) {
            return res.status(404).json({ error: "Không tìm thấy thông tin tệp." });
        }
        // RBAC check
        if (req.user?.role !== "ADMIN" && file.userId !== req.user?.id) {
            return res.status(403).json({ error: "Bạn không có quyền tải xuống tệp này." });
        }
        let filePath = "";
        let downloadName = file.fileName;
        if (file.status === "COMPLETED" && file.resultUrl) {
            filePath = path_1.default.resolve(file.resultUrl);
            downloadName = file.fileName;
        }
        else {
            filePath = path_1.default.resolve(file.originalUrl);
        }
        if (!fs_1.default.existsSync(filePath)) {
            return res.status(404).json({ error: "Tệp vật lý không tồn tại trên hệ thống." });
        }
        return res.download(filePath, downloadName);
    }
    catch (error) {
        console.error("Download error:", error);
        return res.status(500).json({ error: "Lỗi tải xuống tệp" });
    }
});
/**
 * 5. POST /api/excel/files/:id/retry
 * Retries the cleaning process with optionally new rules
 */
app.post("/api/excel/files/:id/retry", auth_1.authenticateToken, async (req, res) => {
    try {
        const file = await db_1.default.excelFile.findUnique({
            where: { id: req.params.id },
        });
        if (!file) {
            return res.status(404).json({ error: "Không tìm thấy tệp" });
        }
        // RBAC Check
        if (req.user?.role !== "ADMIN" && file.userId !== req.user?.id) {
            return res.status(403).json({ error: "Bạn không có quyền thực hiện lại tệp này." });
        }
        const rules = parseRules(req.body);
        // Update rules and reset status
        const updatedFile = await db_1.default.excelFile.update({
            where: { id: file.id },
            data: {
                status: "PENDING",
                rules: JSON.stringify(rules),
            },
        });
        // Delete existing job reports for this file so we refresh stats
        await db_1.default.processingJob.deleteMany({
            where: { fileId: file.id },
        });
        // Add back to queue
        await (0, queue_1.addJobToQueue)({
            fileId: file.id,
            rules,
        });
        return res.json({
            message: "Đã thiết lập chạy lại quy trình xử lý tệp.",
            file: updatedFile,
        });
    }
    catch (error) {
        console.error("Retry job error:", error);
        return res.status(500).json({ error: "Không thể thực hiện lại công việc này" });
    }
});
/**
 * 6. DELETE /api/excel/files/:id
 * Delete record and files from disk
 */
app.delete("/api/excel/files/:id", auth_1.authenticateToken, async (req, res) => {
    try {
        const file = await db_1.default.excelFile.findUnique({
            where: { id: req.params.id },
        });
        if (!file) {
            return res.status(404).json({ error: "Không tìm thấy tệp." });
        }
        // RBAC Check
        if (req.user?.role !== "ADMIN" && file.userId !== req.user?.id) {
            return res.status(403).json({ error: "Bạn không có quyền xóa tệp của người khác." });
        }
        // Delete physically from disk if exists
        const origPath = path_1.default.resolve(file.originalUrl);
        if (fs_1.default.existsSync(origPath)) {
            try {
                fs_1.default.rmSync(path_1.default.dirname(origPath), { recursive: true, force: true });
            }
            catch (e) {
                console.error("Error deleting original file directory:", e);
            }
        }
        if (file.resultUrl) {
            const resPath = path_1.default.resolve(file.resultUrl);
            if (fs_1.default.existsSync(resPath)) {
                try {
                    fs_1.default.rmSync(path_1.default.dirname(resPath), { recursive: true, force: true });
                }
                catch (e) {
                    console.error("Error deleting result file directory:", e);
                }
            }
        }
        // Delete database records (Cascade deletes jobs)
        await db_1.default.excelFile.delete({
            where: { id: file.id },
        });
        return res.json({ message: "Đã xóa thành công tệp tin và các báo cáo liên quan." });
    }
    catch (error) {
        console.error("Delete file error:", error);
        return res.status(500).json({ error: "Không thể xóa tệp tin" });
    }
});
// Start Express Server
app.listen(PORT, () => {
    console.log(`Excel Cleaner API Server listening at http://localhost:${PORT}`);
    console.log(`Prisma schema connecting using DATABASE_URL configuration.`);
});
