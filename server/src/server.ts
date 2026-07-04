import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { v4 as uuidv4 } from "uuid";
import prisma from "./db";
import { initQueue, addJobToQueue } from "./services/queue";
import { analyzeExcelFile } from "./services/excelService";
import authRouter from "./routes/authRouter";
import { authenticateToken, AuthRequest } from "./middleware/auth";

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(cors());
app.use(express.json());

// Set up directories
const uploadDir = path.resolve(process.env.UPLOAD_DIR || "uploads");
const resultDir = path.resolve(process.env.RESULT_DIR || "results");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
if (!fs.existsSync(resultDir)) {
  fs.mkdirSync(resultDir, { recursive: true });
}

// Multer disk storage setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const fileId = uuidv4();
    const destDir = path.join(uploadDir, fileId);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    // Attach fileId to request object
    (req as any).fileId = fileId;
    cb(null, destDir);
  },
  filename: (req, file, cb) => {
    // Keep exact original filename on disk, decoded to UTF-8 to support Vietnamese characters!
    const decodedName = Buffer.from(file.originalname, "latin1").toString("utf8");
    cb(null, decodedName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB file size limit
});

// Initialize Background Workers
initQueue();

// Mount Auth routes
app.use("/api/auth", authRouter);

/**
 * Helper to parse rules from request body or defaults
 */
function parseRules(body: any) {
  const mode = body.mode || "strike";
  const fillValue = body.fillValue || "N/A";
  const highlightColor = body.highlightColor || "#FFFF00"; // default yellow
  return {
    mode: mode as any,
    fillValue,
    highlightColor,
  };
}

/**
 * 1. POST /api/excel/upload
 * Uploads a file and adds it to the cleaning queue. Secures route with JWT check.
 */
app.post("/api/excel/upload", authenticateToken as any, upload.single("file"), async (req: AuthRequest, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Không tìm thấy file tải lên." });
    }

    const fileRules = parseRules(req.body);
    const originalUrl = path.relative(process.cwd(), req.file.path).replace(/\\/g, "/");
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Không tìm thấy thông tin định danh người dùng." });
    }

    const fileId = (req as any).fileId;

    // Save metadata to DB
    const excelFile = await prisma.excelFile.create({
      data: {
        id: fileId,
        fileName: Buffer.from(req.file.originalname, "latin1").toString("utf8"),
        originalUrl: originalUrl,
        status: "PENDING",
        rules: JSON.stringify(fileRules),
        userId: userId,
      },
    });

    // Add to Queue
    await addJobToQueue({
      fileId: excelFile.id,
      rules: fileRules,
    });

    return res.status(201).json({
      message: "Đã tải lên tệp tin và lên lịch xử lý dọn dẹp.",
      file: excelFile,
    });
  } catch (error: any) {
    console.error("Upload error:", error);
    return res.status(500).json({ error: error.message || "Không thể tải lên file" });
  }
});

/**
 * 1b. POST /api/excel/upload-and-analyze
 * Uploads a file and immediately analyzes it to return sheets and detected tables metadata.
 */
app.post("/api/excel/upload-and-analyze", authenticateToken as any, upload.single("file"), async (req: AuthRequest, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Không tìm thấy file tải lên." });
    }

    const originalUrl = path.relative(process.cwd(), req.file.path).replace(/\\/g, "/");
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Không tìm thấy thông tin định danh người dùng." });
    }

    const fileId = (req as any).fileId;

    // Save metadata to DB
    const excelFile = await prisma.excelFile.create({
      data: {
        id: fileId,
        fileName: Buffer.from(req.file.originalname, "latin1").toString("utf8"),
        originalUrl: originalUrl,
        status: "PENDING_CONFIG",
        userId: userId,
      },
    });

    const analysis = await analyzeExcelFile(excelFile.id);

    return res.status(201).json({
      message: "Đã tải lên tệp tin và phân tích cấu trúc bảng.",
      fileId: excelFile.id,
      fileName: excelFile.fileName,
      analysis,
    });
  } catch (error: any) {
    console.error("Upload and analyze error:", error);
    return res.status(500).json({ error: error.message || "Không thể phân tích file" });
  }
});

/**
 * 1c. POST /api/excel/files/:id/process
 * Submits custom rules configuration and adds the file processing job to the queue.
 */
app.post("/api/excel/files/:id/process", authenticateToken as any, async (req: AuthRequest, res) => {
  try {
    const file = await prisma.excelFile.findUnique({
      where: { id: req.params.id },
    });

    if (!file) {
      return res.status(404).json({ error: "Không tìm thấy file" });
    }

    // RBAC check
    if (req.user?.role !== "ADMIN" && file.userId !== req.user?.id) {
      return res.status(403).json({ error: "Bạn không có quyền xử lý tệp này." });
    }

    const { crossType, crossColor, crossThickness, sheets } = req.body;
    const processRules = {
      mode: "cross_out",
      crossType: crossType || "greater_than",
      crossColor: crossColor || "#0000FF",
      crossThickness: Number(crossThickness) || 4,
      sheets,
    };

    // Update status to PENDING and save rules
    const updatedFile = await prisma.excelFile.update({
      where: { id: file.id },
      data: {
        status: "PENDING",
        rules: JSON.stringify(processRules),
      },
    });

    // Delete existing job reports for this file so we refresh stats
    await prisma.processingJob.deleteMany({
      where: { fileId: file.id },
    });

    // Add to Queue
    await addJobToQueue({
      fileId: file.id,
      rules: processRules as any,
    });

    return res.json({
      message: "Đã bắt đầu xử lý tệp tin Excel với cấu hình tùy chỉnh.",
      file: updatedFile,
    });
  } catch (error: any) {
    console.error("Process file error:", error);
    return res.status(500).json({ error: error.message || "Không thể xử lý file" });
  }
});

/**
 * 2. GET /api/excel/files
 * Fetch processed files. Standard users only see their own files, Admins see all.
 */
app.get("/api/excel/files", authenticateToken as any, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;

    if (!userId) {
      return res.status(401).json({ error: "Không được phép truy cập." });
    }

    const whereClause = role === "ADMIN" ? {} : { userId };

    const files = await prisma.excelFile.findMany({
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
  } catch (error: any) {
    console.error("Fetch files error:", error);
    return res.status(500).json({ error: "Không thể lấy danh sách file" });
  }
});

/**
 * 3. GET /api/excel/files/:id
 * Retrieve details for a single file with ownership checks
 */
app.get("/api/excel/files/:id", authenticateToken as any, async (req: AuthRequest, res) => {
  try {
    const file = await prisma.excelFile.findUnique({
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
  } catch (error: any) {
    console.error("Get file error:", error);
    return res.status(500).json({ error: "Không thể lấy chi tiết file" });
  }
});

/**
 * 4. GET /api/excel/files/:id/download
 * Downloads processed file with ownership check.
 */
app.get("/api/excel/files/:id/download", authenticateToken as any, async (req: AuthRequest, res) => {
  try {
    const file = await prisma.excelFile.findUnique({
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
      filePath = path.resolve(file.resultUrl);
      downloadName = file.fileName;
    } else {
      filePath = path.resolve(file.originalUrl);
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Tệp vật lý không tồn tại trên hệ thống." });
    }

    return res.download(filePath, downloadName);
  } catch (error: any) {
    console.error("Download error:", error);
    return res.status(500).json({ error: "Lỗi tải xuống tệp" });
  }
});

/**
 * 5. POST /api/excel/files/:id/retry
 * Retries the cleaning process with optionally new rules
 */
app.post("/api/excel/files/:id/retry", authenticateToken as any, async (req: AuthRequest, res) => {
  try {
    const file = await prisma.excelFile.findUnique({
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
    const updatedFile = await prisma.excelFile.update({
      where: { id: file.id },
      data: {
        status: "PENDING",
        rules: JSON.stringify(rules),
      },
    });

    // Delete existing job reports for this file so we refresh stats
    await prisma.processingJob.deleteMany({
      where: { fileId: file.id },
    });

    // Add back to queue
    await addJobToQueue({
      fileId: file.id,
      rules,
    });

    return res.json({
      message: "Đã thiết lập chạy lại quy trình xử lý tệp.",
      file: updatedFile,
    });
  } catch (error: any) {
    console.error("Retry job error:", error);
    return res.status(500).json({ error: "Không thể thực hiện lại công việc này" });
  }
});

/**
 * 6. DELETE /api/excel/files/:id
 * Delete record and files from disk
 */
app.delete("/api/excel/files/:id", authenticateToken as any, async (req: AuthRequest, res) => {
  try {
    const file = await prisma.excelFile.findUnique({
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
    const origPath = path.resolve(file.originalUrl);
    if (fs.existsSync(origPath)) {
      try {
        fs.rmSync(path.dirname(origPath), { recursive: true, force: true });
      } catch (e) {
        console.error("Error deleting original file directory:", e);
      }
    }

    if (file.resultUrl) {
      const resPath = path.resolve(file.resultUrl);
      if (fs.existsSync(resPath)) {
        try {
          fs.rmSync(path.dirname(resPath), { recursive: true, force: true });
        } catch (e) {
          console.error("Error deleting result file directory:", e);
        }
      }
    }

    // Delete database records (Cascade deletes jobs)
    await prisma.excelFile.delete({
      where: { id: file.id },
    });

    return res.json({ message: "Đã xóa thành công tệp tin và các báo cáo liên quan." });
  } catch (error: any) {
    console.error("Delete file error:", error);
    return res.status(500).json({ error: "Không thể xóa tệp tin" });
  }
});

// Start Express Server
app.listen(PORT, () => {
  console.log(`Excel Cleaner API Server listening at http://localhost:${PORT}`);
  console.log(`Prisma schema connecting using DATABASE_URL configuration.`);
});
