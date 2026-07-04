"use client";

import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import {
  Upload,
  Settings,
  Trash2,
  Download,
  RefreshCw,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  Clock,
  Sparkles,
  Info,
  Layers,
  Search,
  Database,
  Grid,
  Lock,
  Mail,
  User as UserIcon,
  LogOut,
  Plus,
  ChevronRight,
  Check,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";

// API Base URL
const API_URL = "http://localhost:3001/api";

interface TableConfig {
  startRow: number;
  endRow: number;
  startCol?: number;
  endCol?: number;
  lastDataRow?: number;
}

interface SheetConfig {
  sheetName: string;
  enabled: boolean;
  mode: "auto" | "manual";
  tables: TableConfig[];
}

interface SheetJob {
  id: string;
  sheetName: string;
  totalRows: number;
  emptyCells: number; // Represents rows crossed out
  createdAt: string;
}

interface ExcelFile {
  id: string;
  fileName: string;
  status: "PENDING" | "PENDING_CONFIG" | "PROCESSING" | "COMPLETED" | "FAILED";
  rules: string | null; // Stores JSON rules string
  createdAt: string;
  sheetCount?: number;
  totalRows?: number;
  emptyCells?: number; // total rows crossed out
  jobs?: SheetJob[];
}

interface LoggedUser {
  id: string;
  email: string;
  role: string;
}

interface BatchFile {
  id: string;
  fileName: string;
  status: "PENDING" | "PENDING_CONFIG" | "PROCESSING" | "COMPLETED" | "FAILED";
  analysis: any[];
  crossedRows?: number;
  sheetsProcessed?: number;
}

export default function ExcelCrossOutDashboard() {
  // Authentication states
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<LoggedUser | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authEmail, setAuthEmail] = useState<string>("");
  const [authPassword, setAuthPassword] = useState<string>("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(false);

  // Application general views
  const [activeTab, setActiveTab] = useState<"new_process" | "history">("new_process");
  const [files, setFiles] = useState<ExcelFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<ExcelFile | null>(null);
  const [loadingFiles, setLoadingFiles] = useState<boolean>(true);
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [filterQuery, setFilterQuery] = useState<string>("");

  // Step wizard states
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadStatusText, setUploadStatusText] = useState<string>("");

  // Batch files list (Step 1 Upload multiple files)
  const [batchFiles, setBatchFiles] = useState<BatchFile[]>([]);
  
  // Custom cross-out rules state (Step 2 configuration)
  const [crossType, setCrossType] = useState<"greater_than" | "single_diagonal_up" | "single_diagonal_down">("greater_than");
  const [crossColor, setCrossColor] = useState<string>("#1B365D"); // Default construction navy blue
  const [crossThickness, setCrossThickness] = useState<number>(4);
  const [sheetsConfig, setSheetsConfig] = useState<SheetConfig[]>([]);
  const [selectedSheetIndex, setSelectedSheetIndex] = useState<number>(0);

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Sync token and login state
  useEffect(() => {
    const storedToken = localStorage.getItem("ec_token");
    const storedUser = localStorage.getItem("ec_user");
    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser));
    }
  }, []);

  // Fetch file list (History Tab)
  const fetchFiles = async (silent = false) => {
    if (!token) return;
    if (!silent) setLoadingFiles(true);
    try {
      const response = await axios.get(`${API_URL}/excel/files`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setFiles(response.data);
      setApiOnline(true);
    } catch (error) {
      console.error("Error fetching files:", error);
      setApiOnline(false);
    } finally {
      if (!silent) setLoadingFiles(false);
    }
  };

  useEffect(() => {
    if (token) {
      fetchFiles();
    }
  }, [token]);

  // Polling for active batch jobs in Step 3
  useEffect(() => {
    const isBatchActive = batchFiles.some(
      (f) => f.status === "PENDING" || f.status === "PROCESSING"
    );

    if (token && currentStep === 3 && isBatchActive) {
      pollIntervalRef.current = setInterval(async () => {
        const updatedBatch = [...batchFiles];
        let hasChanges = false;

        for (let i = 0; i < updatedBatch.length; i++) {
          const file = updatedBatch[i];
          if (file.status === "PENDING" || file.status === "PROCESSING") {
            try {
              const res = await axios.get(`${API_URL}/excel/files/${file.id}`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              const freshData: ExcelFile = res.data;
              
              if (freshData.status !== file.status) {
                updatedBatch[i].status = freshData.status as any;
                if (freshData.status === "COMPLETED") {
                  updatedBatch[i].crossedRows = freshData.jobs?.reduce((sum, j) => sum + j.emptyCells, 0) || 0;
                  updatedBatch[i].sheetsProcessed = freshData.jobs?.length || 0;
                }
                hasChanges = true;
              }
            } catch (err) {
              console.error(`Error polling file ID ${file.id}:`, err);
            }
          }
        }

        if (hasChanges) {
          setBatchFiles(updatedBatch);
          fetchFiles(true); // silent refresh history
        }
      }, 2000);
    }

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [token, batchFiles, currentStep]);

  // Auth Handlers
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);

    const endpoint = authMode === "login" ? "/auth/login" : "/auth/register";
    try {
      const response = await axios.post(`${API_URL}${endpoint}`, {
        email: authEmail,
        password: authPassword,
      });

      const { token: receivedToken, user: receivedUser } = response.data;
      localStorage.setItem("ec_token", receivedToken);
      localStorage.setItem("ec_user", JSON.stringify(receivedUser));

      setToken(receivedToken);
      setUser(receivedUser);
      setAuthError(null);
      fetchFiles();
    } catch (err: any) {
      console.error("Authentication error:", err);
      setAuthError(err.response?.data?.error || "Không thể kết nối máy chủ backend.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("ec_token");
    localStorage.removeItem("ec_user");
    setToken(null);
    setUser(null);
    setFiles([]);
    setSelectedFile(null);
    resetWizard();
  };

  const resetWizard = () => {
    setCurrentStep(1);
    setBatchFiles([]);
    setSheetsConfig([]);
    setUploading(false);
    setUploadProgress(0);
    setUploadStatusText("");
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
  };

  // Drag & Drop Handlers for File Selection
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await handleBatchUploadAndAnalyze(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await handleBatchUploadAndAnalyze(Array.from(e.target.files));
    }
  };

  // Upload and analyze Excel files in a batch
  const handleBatchUploadAndAnalyze = async (filesToUpload: File[]) => {
    const validFiles = filesToUpload.filter((file) => {
      const ext = file.name.split(".").pop()?.toLowerCase();
      return ext === "xlsx" || ext === "xlsm" || ext === "xls";
    });

    if (validFiles.length === 0) {
      alert("Hệ thống chỉ hỗ trợ các định dạng Excel (.xlsx, .xlsm, .xls).");
      return;
    }

    if (uploading || !token) return;
    setUploading(true);
    setUploadProgress(0);
    setBatchFiles([]);

    const uploadedResults: BatchFile[] = [];
    
    try {
      for (let i = 0; i < validFiles.length; i++) {
        const file = validFiles[i];
        setUploadStatusText(`Đang tải lên: ${file.name} (${i + 1}/${validFiles.length})`);
        
        const percentStart = Math.round((i / validFiles.length) * 100);
        const percentEnd = Math.round(((i + 1) / validFiles.length) * 100);
        setUploadProgress(percentStart);

        const formData = new FormData();
        formData.append("file", file);

        const res = await axios.post(`${API_URL}/excel/upload-and-analyze`, formData, {
          headers: {
            "Content-Type": "multipart/form-data",
            Authorization: `Bearer ${token}`,
          },
        });

        const { fileId, fileName, analysis } = res.data;
        uploadedResults.push({
          id: fileId,
          fileName: fileName,
          status: "PENDING_CONFIG",
          analysis,
        });

        setUploadProgress(percentEnd);
      }

      setBatchFiles(uploadedResults);

      // Prepopulate sheets configuration based on the first file's sheets (representative sample)
      if (uploadedResults.length > 0) {
        const representativeFile = uploadedResults[0];
        const parsedConfig: SheetConfig[] = representativeFile.analysis.map((sheet: any) => ({
          sheetName: sheet.sheetName,
          enabled: true,
          mode: "auto",
          tables: sheet.tables.map((t: any) => ({
            startRow: t.startRow,
            endRow: t.endRow,
            startCol: t.startCol,
            endCol: t.endCol,
            lastDataRow: t.lastDataRow,
          })),
        }));

        setSheetsConfig(parsedConfig);
        setSelectedSheetIndex(0);
        setCurrentStep(2); // Go to configure
      }
    } catch (err: any) {
      console.error("Batch upload and analyze error:", err);
      alert(`Lỗi khi tải hoặc phân tích lô tệp: ${err.response?.data?.error || err.message}`);
      resetWizard();
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Submit batch rules and start queue process (Step 2 -> Step 3)
  const handleStartBatchProcessing = async () => {
    if (!token || batchFiles.length === 0) return;

    const anyEnabled = sheetsConfig.some((s) => s.enabled);
    if (!anyEnabled) {
      alert("Vui lòng chọn ít nhất một sheet để xử lý.");
      return;
    }

    for (const sheet of sheetsConfig) {
      if (sheet.enabled && sheet.tables.length === 0) {
        alert(`Sheet "${sheet.sheetName}" chưa cấu hình bất kỳ bảng biểu nào.`);
        return;
      }
    }

    try {
      setCurrentStep(3);
      const updatedBatch = [...batchFiles];

      for (let i = 0; i < updatedBatch.length; i++) {
        const file = updatedBatch[i];
        updatedBatch[i].status = "PENDING";
        
        // Post rules configuration to each file
        await axios.post(
          `${API_URL}/excel/files/${file.id}/process`,
          {
            crossType,
            crossColor,
            crossThickness,
            sheets: sheetsConfig,
          },
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );
      }

      setBatchFiles(updatedBatch);
    } catch (error: any) {
      console.error("Error starting batch processing:", error);
      alert(`Không thể bắt đầu xử lý hàng loạt: ${error.response?.data?.error || error.message}`);
      setCurrentStep(2);
    }
  };

  // Delete file from history
  const handleDelete = async (fileId: string) => {
    if (!confirm("Bạn có chắc chắn muốn xóa tệp này và các báo cáo liên quan không?")) return;
    if (!token) return;
    try {
      await axios.delete(`${API_URL}/excel/files/${fileId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setFiles(files.filter((f) => f.id !== fileId));
      if (selectedFile?.id === fileId) {
        setSelectedFile(null);
      }
      setBatchFiles(batchFiles.filter((f) => f.id !== fileId));
    } catch (error) {
      console.error("Delete error:", error);
      alert("Không thể xóa tệp tin.");
    }
  };

  // Authenticated file download
  const handleDownload = async (fileId: string, fileName: string) => {
    if (!token) return;
    try {
      const response = await axios.get(`${API_URL}/excel/files/${fileId}/download`, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: "blob",
      });

      const blobUrl = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = blobUrl;
      link.setAttribute("download", fileName);
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error("Download error:", error);
      alert("Không thể tải tệp tin xuống.");
    }
  };

  // Loop and download all completed files in the batch
  const handleDownloadAll = async () => {
    const completedFiles = batchFiles.filter((f) => f.status === "COMPLETED");
    if (completedFiles.length === 0) return;

    for (const file of completedFiles) {
      await handleDownload(file.id, file.fileName);
      // Wait a short bit between downloads to let browser queue them cleanly
      await new Promise((r) => setTimeout(r, 600));
    }
  };

  // View file details report (History Tab)
  const viewFileDetails = async (fileId: string) => {
    if (!token) return;
    try {
      const response = await axios.get(`${API_URL}/excel/files/${fileId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSelectedFile(response.data);
    } catch (error) {
      console.error("Error fetching file details:", error);
      alert("Không thể lấy thông tin chi tiết tệp.");
    }
  };

  // Table Configuration Helpers (Step 2 Edit)
  const handleToggleSheet = (index: number) => {
    const next = [...sheetsConfig];
    next[index].enabled = !next[index].enabled;
    setSheetsConfig(next);
  };

  const handleChangeSheetMode = (index: number, mode: "auto" | "manual") => {
    const next = [...sheetsConfig];
    next[index].mode = mode;
    setSheetsConfig(next);
  };

  const handleUpdateTableRange = (sheetIdx: number, tableIdx: number, field: "startRow" | "endRow", value: number) => {
    const next = [...sheetsConfig];
    next[sheetIdx].tables[tableIdx][field] = value;
    
    if (next[sheetIdx].tables[tableIdx].lastDataRow) {
      delete next[sheetIdx].tables[tableIdx].lastDataRow;
    }
    setSheetsConfig(next);
  };

  const handleAddTable = (sheetIdx: number) => {
    const next = [...sheetsConfig];
    let startRow = 1;
    let endRow = 20;
    const len = next[sheetIdx].tables.length;
    if (len > 0) {
      startRow = next[sheetIdx].tables[len - 1].endRow + 10;
      endRow = startRow + 20;
    }
    
    next[sheetIdx].tables.push({
      startRow,
      endRow,
    });
    setSheetsConfig(next);
  };

  const handleRemoveTable = (sheetIdx: number, tableIdx: number) => {
    const next = [...sheetsConfig];
    next[sheetIdx].tables.splice(tableIdx, 1);
    setSheetsConfig(next);
  };

  // Filtered files list for search
  const filteredFiles = files.filter((f) =>
    f.fileName.toLowerCase().includes(filterQuery.toLowerCase())
  );

  // Calculate batch metrics
  const completedBatchCount = batchFiles.filter((f) => f.status === "COMPLETED").length;
  const failedBatchCount = batchFiles.filter((f) => f.status === "FAILED").length;
  const isBatchFinished = completedBatchCount + failedBatchCount === batchFiles.length;

  // Authentication UI Overlay
  if (!token) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col items-center justify-center relative px-4">
        {/* Ambient Glows */}
        <div className="absolute top-1/4 w-[350px] h-[350px] bg-cyan-600/10 rounded-full blur-[90px] pointer-events-none" />
        <div className="absolute bottom-1/4 w-[350px] h-[350px] bg-purple-650/10 rounded-full blur-[90px] pointer-events-none" />

        <div className="w-full max-w-md bg-slate-900/50 backdrop-blur-md border border-slate-800 rounded-3xl p-8 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-cyan-500 via-sky-500 to-purple-650" />
          
          <div className="flex flex-col items-center text-center mb-8">
            <div className="bg-gradient-to-tr from-cyan-500 to-purple-650 p-3 rounded-2xl shadow-lg shadow-cyan-500/20 mb-3 animate-bounce-subtle">
              <FileSpreadsheet className="w-6 h-6 text-white" />
            </div>
            <h2 className="text-2xl font-bold text-white bg-gradient-to-r from-cyan-400 via-sky-400 to-purple-400 bg-clip-text text-transparent">
              Excel Cross-Out Tool
            </h2>
            <p className="text-slate-400 text-xs mt-1">
              Phần mềm gạch chéo bảng thừa, nghiệm thu xây dựng hàng loạt
            </p>
          </div>

          <form onSubmit={handleAuthSubmit} className="space-y-5">
            {authError && (
              <div className="flex items-center gap-2 p-3 bg-red-950/40 border border-red-900/30 rounded-xl text-red-400 text-xs">
                <XCircle className="w-4.5 h-4.5 shrink-0" />
                <span>{authError}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-450 uppercase tracking-wider">
                Tài khoản Email
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <Mail className="w-4 h-4" />
                </span>
                <input
                  type="email"
                  required
                  placeholder="user@example.com"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500 transition-colors"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-450 uppercase tracking-wider">
                Mật khẩu đăng nhập
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <Lock className="w-4 h-4" />
                </span>
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500 transition-colors"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={authLoading}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-cyan-500 via-sky-500 to-sky-600 hover:from-cyan-400 hover:to-sky-500 text-slate-950 font-bold transition-all shadow-lg shadow-cyan-550/15 text-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {authLoading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : authMode === "login" ? (
                "Đăng nhập hệ thống"
              ) : (
                "Đăng ký tài khoản"
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => {
                setAuthMode(authMode === "login" ? "register" : "login");
                setAuthError(null);
              }}
              className="text-xs text-cyan-400 hover:underline font-semibold"
            >
              {authMode === "login"
                ? "Chưa có tài khoản? Đăng ký ngay"
                : "Đã có tài khoản? Đăng nhập tại đây"}
            </button>
          </div>
        </div>

        {/* Support Accounts Badge */}
        <div className="mt-6 text-slate-500 text-[10px] flex items-center gap-1.5 bg-slate-900/30 px-4 py-1.5 rounded-full border border-slate-850">
          <Info className="w-3.5 h-3.5 text-cyan-500" />
          <span>Tài khoản test: <strong>user@example.com</strong> / <strong>password123</strong> hoặc <strong>admin@example.com</strong> / <strong>admin123</strong></span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-cyan-500 selection:text-slate-950 pb-16 relative overflow-hidden">
      {/* Visual background decorations */}
      <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-cyan-600/5 rounded-full blur-[130px] pointer-events-none" />
      <div className="absolute top-1/3 right-1/4 w-[500px] h-[500px] bg-purple-650/5 rounded-full blur-[120px] pointer-events-none" />

      {/* Header */}
      <header className="sticky top-0 z-45 backdrop-blur-md bg-slate-950/80 border-b border-slate-850">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-tr from-cyan-500 to-purple-650 p-2.5 rounded-2xl shadow-lg shadow-cyan-555/20">
              <FileSpreadsheet className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight bg-gradient-to-r from-cyan-400 via-sky-400 to-purple-400 bg-clip-text text-transparent">
                Excel Cross-Out Tool
              </h1>
              <p className="text-[10px] text-slate-400 font-bold tracking-wide uppercase">
                Gạch chéo tự động biên bản nghiệm thu xây dựng hàng loạt
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* User Profile */}
            <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-slate-900 border border-slate-800 text-xs">
              <UserIcon className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-slate-200 font-semibold">{user?.email}</span>
              <span className={`px-2 py-0.5 text-[9px] font-extrabold rounded-full ${
                user?.role === "ADMIN" 
                  ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" 
                  : "bg-slate-800 text-slate-450 border border-slate-750"
              }`}>
                {user?.role === "ADMIN" ? "ADMIN" : "USER"}
              </span>
              
              <div className="w-px h-3.5 bg-slate-800 mx-1" />

              <button
                onClick={handleLogout}
                className="p-1 text-slate-400 hover:text-red-400 transition-colors cursor-pointer"
                title="Đăng xuất"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Status indicator */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900 border border-slate-800 text-xs">
              <span className={`w-2 h-2 rounded-full ${apiOnline ? "bg-emerald-500 shadow shadow-emerald-500/40 animate-pulse" : "bg-red-500 shadow shadow-red-500/40 animate-pulse"}`} />
              <span className="text-slate-350 font-medium">
                {apiOnline ? "Máy chủ Kết nối" : "Ngoại tuyến"}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8">
        
        {/* Navigation Tabs */}
        <div className="flex items-center border-b border-slate-850 gap-2 mb-8">
          <button
            onClick={() => { setActiveTab("new_process"); resetWizard(); }}
            className={`py-3 px-5 text-sm font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === "new_process"
                ? "border-cyan-500 text-cyan-400"
                : "border-transparent text-slate-450 hover:text-slate-200"
            }`}
          >
            <Sparkles className="w-4.5 h-4.5" />
            Xử lý tệp mới (Hàng loạt)
          </button>
          <button
            onClick={() => { setActiveTab("history"); fetchFiles(); }}
            className={`py-3 px-5 text-sm font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === "history"
                ? "border-cyan-500 text-cyan-400"
                : "border-transparent text-slate-450 hover:text-slate-200"
            }`}
          >
            <Clock className="w-4.5 h-4.5" />
            Lịch sử đã gạch
          </button>
        </div>

        {/* TAB 1: NEW PROCESS WIZARD */}
        {activeTab === "new_process" && (
          <section className="space-y-8 animate-fade-in">
            {/* Step Wizard Header */}
            <div className="grid grid-cols-3 bg-slate-900/40 border border-slate-850/80 rounded-2xl p-4 max-w-2xl mx-auto text-center text-xs font-semibold relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-0.5 bg-slate-800" />
              
              <div className={`flex flex-col items-center gap-1.5 relative ${currentStep >= 1 ? "text-cyan-400" : "text-slate-500"}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center font-bold border ${currentStep >= 1 ? "bg-cyan-950/50 border-cyan-500" : "border-slate-700 bg-slate-950"}`}>
                  1
                </div>
                <span>Chọn File(s) Excel</span>
              </div>

              <div className={`flex flex-col items-center gap-1.5 relative ${currentStep >= 2 ? "text-cyan-400" : "text-slate-500"}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center font-bold border ${currentStep >= 2 ? "bg-cyan-950/50 border-cyan-500" : "border-slate-700 bg-slate-950"}`}>
                  2
                </div>
                <span>Cấu hình chung</span>
              </div>

              <div className={`flex flex-col items-center gap-1.5 relative ${currentStep >= 3 ? "text-cyan-400" : "text-slate-500"}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center font-bold border ${currentStep >= 3 ? "bg-cyan-950/50 border-cyan-500" : "border-slate-700 bg-slate-950"}`}>
                  3
                </div>
                <span>Xuất File Hàng Loạt</span>
              </div>
            </div>

            {/* STEP 1: FILE UPLOAD */}
            {currentStep === 1 && (
              <div className="max-w-xl mx-auto space-y-6">
                <div
                  onDragEnter={handleDrag}
                  onDragOver={handleDrag}
                  onDragLeave={handleDrag}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-3xl p-12 flex flex-col items-center justify-center cursor-pointer transition-all ${
                    dragActive
                      ? "border-cyan-500 bg-cyan-950/15 shadow-xl shadow-cyan-500/5"
                      : "border-slate-800 hover:border-slate-700 bg-slate-900/30 hover:bg-slate-900/50"
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx, .xlsm, .xls"
                    multiple
                    className="hidden"
                    onChange={handleFileChange}
                    disabled={uploading}
                  />
                  
                  <div className="bg-slate-900/90 p-5 rounded-full border border-slate-800 mb-5 shadow-inner">
                    <Upload className="w-8 h-8 text-cyan-400 animate-bounce-subtle" />
                  </div>
                  
                  <h3 className="font-bold text-lg text-slate-200 text-center">
                    Tải tệp Excel cần gạch chéo
                  </h3>
                  <p className="text-xs text-slate-450 text-center mt-1.5 max-w-sm">
                    Kéo thả hoặc click để tải lên **một hoặc nhiều tệp tin Excel** cùng lúc để xử lý hàng loạt nhanh chóng.
                  </p>

                  {uploading && (
                    <div className="w-full max-w-xs mt-8 space-y-2">
                      <div className="flex items-center justify-between text-xs font-semibold text-slate-350">
                        <span className="truncate max-w-[200px]" title={uploadStatusText}>
                          {uploadStatusText || "Đang tải tệp..."}
                        </span>
                        <span>{uploadProgress}%</span>
                      </div>
                      <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden border border-slate-800">
                        <div 
                          className="bg-cyan-500 h-full rounded-full transition-all duration-300"
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="bg-slate-900/30 border border-slate-850 rounded-2xl p-5 text-xs text-slate-400 space-y-2 max-w-md mx-auto">
                  <div className="flex items-center gap-1.5 text-cyan-400 font-bold mb-1">
                    <Info className="w-4 h-4" />
                    <span>Hỗ trợ xử lý tệp tiếng Việt:</span>
                  </div>
                  <p>
                    Hệ thống tự động phát hiện và sửa mã hóa cho các tệp có ký tự tiếng Việt có dấu dài phức tạp (UTF-8), giúp đảm bảo định dạng file xuất ra không bị lỗi font hoặc hỏng tên tệp.
                  </p>
                </div>
              </div>
            )}

            {/* STEP 2: PREVIEW AND CONFIGURATION */}
            {currentStep === 2 && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-slide-up">
                
                {/* CONFIGURATION SIDEBAR (LEFT) */}
                <div className="lg:col-span-4 space-y-6">
                  <div className="bg-slate-900/40 border border-slate-850 rounded-2xl p-6 shadow-lg">
                    <h3 className="font-bold text-base text-white flex items-center gap-2 mb-2">
                      <Settings className="w-4.5 h-4.5 text-cyan-400" />
                      Tham số gạch hàng loạt
                    </h3>
                    <p className="text-[10px] text-slate-450 font-medium mb-5">
                      Cài đặt này sẽ được áp dụng đồng thời cho tất cả <strong>{batchFiles.length} tệp</strong> trong lô xử lý.
                    </p>

                    <div className="space-y-6">
                      {/* Cross Type selection */}
                      <div className="space-y-2.5">
                        <label className="block text-xs font-semibold text-slate-455 uppercase tracking-wider">
                          Mẫu kiểu gạch chéo
                        </label>
                        <div className="grid grid-cols-1 gap-2.5">
                          <button
                            type="button"
                            onClick={() => setCrossType("greater_than")}
                            className={`flex items-center justify-between p-3.5 rounded-xl border transition-all text-left ${
                              crossType === "greater_than"
                                ? "bg-cyan-950/30 border-cyan-500 text-cyan-400"
                                : "bg-slate-950 border-slate-850 text-slate-400 hover:border-slate-750 hover:text-slate-200"
                            }`}
                          >
                            <div>
                              <span className="text-sm font-bold block">Đường mũi tên kiểu &quot;&gt;&quot;</span>
                              <span className="text-[10px] opacity-75 mt-0.5 block">Nghiệm thu công trình (Khuyên dùng)</span>
                            </div>
                            <span className="text-lg font-bold select-none">&gt;</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setCrossType("single_diagonal_up")}
                            className={`flex items-center justify-between p-3.5 rounded-xl border transition-all text-left ${
                              crossType === "single_diagonal_up"
                                ? "bg-cyan-950/30 border-cyan-500 text-cyan-400"
                                : "bg-slate-950 border-slate-850 text-slate-400 hover:border-slate-750 hover:text-slate-200"
                            }`}
                          >
                            <div>
                              <span className="text-sm font-bold block">Đường chéo đơn dưới lên &quot;/&quot;</span>
                              <span className="text-[10px] opacity-75 mt-0.5 block">Đường gạch chéo từ góc trái lên phải</span>
                            </div>
                            <span className="text-lg font-bold select-none">/</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setCrossType("single_diagonal_down")}
                            className={`flex items-center justify-between p-3.5 rounded-xl border transition-all text-left ${
                              crossType === "single_diagonal_down"
                                ? "bg-cyan-950/30 border-cyan-500 text-cyan-400"
                                : "bg-slate-950 border-slate-850 text-slate-400 hover:border-slate-750 hover:text-slate-200"
                            }`}
                          >
                            <div>
                              <span className="text-sm font-bold block">Đường chéo đơn trên xuống &quot;\&quot;</span>
                              <span className="text-[10px] opacity-75 mt-0.5 block">Đường gạch chéo từ góc trái xuống phải</span>
                            </div>
                            <span className="text-lg font-bold select-none">\</span>
                          </button>
                        </div>
                      </div>

                      {/* Pen Color selection */}
                      <div className="space-y-2">
                        <label className="block text-xs font-semibold text-slate-455 uppercase tracking-wider mb-2">
                          Màu mực gạch chéo
                        </label>
                        <div className="flex items-center gap-3">
                          <input
                            type="color"
                            value={crossColor}
                            onChange={(e) => setCrossColor(e.target.value)}
                            className="w-12 h-10 rounded border border-slate-700 bg-transparent cursor-pointer p-0.5"
                          />
                          <input
                            type="text"
                            value={crossColor.toUpperCase()}
                            onChange={(e) => setCrossColor(e.target.value)}
                            className="bg-slate-950 border border-slate-850 rounded-lg py-2 px-3 text-sm text-slate-200 flex-1 font-mono focus:outline-none focus:border-cyan-500 uppercase"
                          />
                        </div>
                        <div className="flex gap-2 mt-2">
                          {[
                            { name: "Xanh lục", value: "#1B365D" }, // Navy
                            { name: "Xanh lam", value: "#0040FF" }, // Royal Blue
                            { name: "Đỏ", value: "#FF0000" }, // Red
                            { name: "Đen", value: "#000000" }, // Black
                          ].map((col) => (
                            <button
                              key={col.value}
                              type="button"
                              onClick={() => setCrossColor(col.value)}
                              className="px-2.5 py-1 text-[10px] bg-slate-950 border border-slate-850 hover:border-slate-750 rounded text-slate-355"
                            >
                              {col.name}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Line Thickness */}
                      <div className="space-y-2.5">
                        <div className="flex justify-between text-xs font-semibold text-slate-455 uppercase tracking-wider">
                          <span>Độ dày nét vẽ</span>
                          <span className="text-cyan-400 font-bold">{crossThickness} px</span>
                        </div>
                        <input
                          type="range"
                          min="1"
                          max="10"
                          value={crossThickness}
                          onChange={(e) => setCrossThickness(Number(e.target.value))}
                          className="w-full accent-cyan-500 bg-slate-950 cursor-pointer h-1 rounded-lg"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Actions buttons */}
                  <div className="flex items-center gap-3">
                    <button
                      onClick={resetWizard}
                      className="flex-1 py-3 border border-slate-800 hover:bg-slate-900 rounded-xl font-bold text-sm text-slate-350 cursor-pointer transition-colors"
                    >
                      Hủy bỏ
                    </button>
                    <button
                      onClick={handleStartBatchProcessing}
                      className="flex-1.5 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-sky-600 hover:from-cyan-400 hover:to-sky-550 text-slate-950 font-bold transition-all shadow-lg shadow-cyan-500/10 text-sm flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      Chạy hàng loạt
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* SHEETS BREAKDOWN & PREVIEW (RIGHT) */}
                <div className="lg:col-span-8 space-y-6">
                  
                  {/* Batch Files Summary Box */}
                  <div className="bg-slate-900/40 border border-slate-850 rounded-2xl p-5 shadow-lg space-y-3">
                    <h3 className="font-bold text-sm text-white flex items-center gap-2">
                      <FileSpreadsheet className="w-4.5 h-4.5 text-cyan-400" />
                      Danh sách tệp đang cấu hình ({batchFiles.length} tệp)
                    </h3>
                    <div className="text-xs text-slate-400 max-h-24 overflow-y-auto divide-y divide-slate-850/40 font-mono pr-1 bg-slate-950/40 p-2.5 rounded-lg border border-slate-900">
                      {batchFiles.map((file, idx) => (
                        <div key={file.id} className="py-1 flex justify-between">
                          <span className="truncate max-w-[320px]">{file.fileName}</span>
                          <span className="text-slate-500 text-[10px]">Tệp {idx + 1}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Sheets List Card */}
                  <div className="bg-slate-900/40 border border-slate-850 rounded-2xl p-5 shadow-lg">
                    <h3 className="font-bold text-base text-white flex items-center gap-2 mb-4">
                      <Layers className="w-4.5 h-4.5 text-cyan-400" />
                      Cấu hình theo Sheets (Xem mẫu từ tệp 1)
                    </h3>

                    {/* Sheet Tabs list */}
                    <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto p-1 bg-slate-950 rounded-xl border border-slate-900">
                      {sheetsConfig.map((sheet, index) => (
                        <div
                          key={sheet.sheetName}
                          onClick={() => setSelectedSheetIndex(index)}
                          className={`flex items-center gap-2.5 px-3.5 py-2 rounded-lg cursor-pointer transition-all border text-xs font-semibold ${
                            selectedSheetIndex === index
                              ? "bg-slate-900 border-cyan-500/60 text-cyan-400"
                              : "bg-transparent border-transparent text-slate-450 hover:text-slate-200"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={sheet.enabled}
                            onChange={(e) => {
                              e.stopPropagation();
                              handleToggleSheet(index);
                            }}
                            className="w-3.5 h-3.5 accent-cyan-500 cursor-pointer"
                          />
                          <span>{sheet.sheetName}</span>
                          {sheet.enabled && (
                            <span className="ml-1 bg-cyan-950 border border-cyan-800 text-cyan-400 text-[9px] px-1.5 py-0.2 rounded-full font-mono font-bold">
                              {sheet.tables.length}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Table boundaries editor for current selected sheet */}
                  {sheetsConfig[selectedSheetIndex] && (
                    <div className="bg-slate-900/40 border border-slate-850 rounded-2xl p-6 shadow-lg space-y-6">
                      
                      {/* Sheet Name and Toggle Mode */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-850 pb-4">
                        <div>
                          <h3 className="font-bold text-lg text-white">
                            Sheet: {sheetsConfig[selectedSheetIndex].sheetName}
                          </h3>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {!sheetsConfig[selectedSheetIndex].enabled ? (
                              <span className="text-red-400 font-semibold flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Sheet này đang BỊ TẮT không xử lý.</span>
                            ) : (
                              "Cấu hình và kiểm tra phạm vi bảng biểu cần gạch."
                            )}
                          </p>
                        </div>

                        {sheetsConfig[selectedSheetIndex].enabled && (
                          <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-850 text-xs">
                            <button
                              type="button"
                              onClick={() => handleChangeSheetMode(selectedSheetIndex, "auto")}
                              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                                sheetsConfig[selectedSheetIndex].mode === "auto"
                                  ? "bg-slate-900 text-cyan-400 shadow"
                                  : "text-slate-400 hover:text-slate-200"
                              }`}
                            >
                              Nhận diện Tự động (Mode A)
                            </button>
                            <button
                              type="button"
                              onClick={() => handleChangeSheetMode(selectedSheetIndex, "manual")}
                              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                                sheetsConfig[selectedSheetIndex].mode === "manual"
                                  ? "bg-slate-900 text-cyan-400 shadow"
                                  : "text-slate-400 hover:text-slate-200"
                              }`}
                            >
                              Thủ công (Mode B)
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Tables configuration List */}
                      {sheetsConfig[selectedSheetIndex].enabled && (
                        <div className="space-y-4">
                          {sheetsConfig[selectedSheetIndex].tables.length === 0 ? (
                            <div className="p-8 text-center text-slate-500 border border-dashed border-slate-800 rounded-xl text-sm">
                              Không tìm thấy bảng biểu nào.
                              {sheetsConfig[selectedSheetIndex].mode === "manual" && (
                                <p className="text-xs mt-1">Vui lòng nhấp vào &quot;Thêm bảng mới&quot; để gạch tay.</p>
                              )}
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {sheetsConfig[selectedSheetIndex].tables.map((table, tIdx) => {
                                const isAuto = sheetsConfig[selectedSheetIndex].mode === "auto";
                                const start = table.startRow;
                                const end = table.endRow;
                                const last = table.lastDataRow;
                                const willCross = last !== undefined && last < end;

                                return (
                                  <div
                                    key={tIdx}
                                    className="bg-slate-950 border border-slate-850 p-4 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all hover:border-slate-800"
                                  >
                                    {/* Left: Row inputs */}
                                    <div className="flex items-center gap-3 flex-wrap">
                                      <div className="bg-slate-900 border border-slate-800 text-[10px] font-bold text-slate-400 px-2 py-1 rounded-md">
                                        Bảng {tIdx + 1}
                                      </div>

                                      <div className="flex items-center gap-2 text-xs">
                                        <span className="text-slate-400">Dòng bắt đầu:</span>
                                        <input
                                          type="number"
                                          disabled={isAuto}
                                          value={start}
                                          min="1"
                                          onChange={(e) =>
                                            handleUpdateTableRange(
                                              selectedSheetIndex,
                                              tIdx,
                                              "startRow",
                                              Number(e.target.value)
                                            )
                                          }
                                          className="w-16 bg-slate-900 border border-slate-800 rounded px-2 py-1 focus:outline-none focus:border-cyan-500 disabled:opacity-60 text-center font-semibold font-mono"
                                        />
                                      </div>

                                      <div className="flex items-center gap-2 text-xs">
                                        <span className="text-slate-400">Dòng kết thúc:</span>
                                        <input
                                          type="number"
                                          disabled={isAuto}
                                          value={end}
                                          min="1"
                                          onChange={(e) =>
                                            handleUpdateTableRange(
                                              selectedSheetIndex,
                                              tIdx,
                                              "endRow",
                                              Number(e.target.value)
                                            )
                                          }
                                          className="w-16 bg-slate-900 border border-slate-800 rounded px-2 py-1 focus:outline-none focus:border-cyan-500 disabled:opacity-60 text-center font-semibold font-mono"
                                        />
                                      </div>
                                    </div>

                                    {/* Middle: Calculated info (Preview info) */}
                                    <div className="text-xs space-y-1 text-slate-450 border-l border-slate-850 pl-4 flex-1">
                                      {last !== undefined ? (
                                        <>
                                          <div>Dữ liệu thực tế đến: <strong className="text-slate-350">{last}</strong></div>
                                          <div>
                                            Trạng thái:{" "}
                                            {willCross ? (
                                              <span className="text-cyan-400 font-bold">
                                                Gạch thừa dòng {last + 1} → {end}
                                              </span>
                                            ) : (
                                              <span className="text-slate-500 font-medium">Bảng đầy (Không cần gạch)</span>
                                            )}
                                          </div>
                                        </>
                                      ) : (
                                        <div>
                                          Trạng thái:{" "}
                                          <span className="text-cyan-400/80 italic font-medium">
                                            Sẽ tự quét dữ liệu rồi gạch đến {end}
                                          </span>
                                        </div>
                                      )}
                                    </div>

                                    {/* Right: Remove button */}
                                    {!isAuto && (
                                      <button
                                        onClick={() => handleRemoveTable(selectedSheetIndex, tIdx)}
                                        className="p-1.5 rounded-lg hover:bg-slate-900 text-slate-400 hover:text-red-400 transition-colors self-end md:self-auto cursor-pointer"
                                        title="Xóa khoảng bảng"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* Add manual table button */}
                          {sheetsConfig[selectedSheetIndex].mode === "manual" && (
                            <button
                              type="button"
                              onClick={() => handleAddTable(selectedSheetIndex)}
                              className="w-full py-2.5 border border-dashed border-slate-800 hover:border-slate-700 bg-slate-950/20 hover:bg-slate-950/50 rounded-xl text-xs font-bold text-cyan-400 flex items-center justify-center gap-1.5 cursor-pointer transition-all"
                            >
                              <Plus className="w-4 h-4" />
                              Thêm bảng thủ công mới (Ví dụ: 16 → 40)
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

              </div>
            )}

            {/* STEP 3: QUEUE PROCESSING & DOWNLOAD */}
            {currentStep === 3 && (
              <div className="max-w-xl mx-auto space-y-6 animate-slide-up">
                
                <div className="bg-slate-900/40 border border-slate-850 rounded-3xl p-6 shadow-2xl space-y-5">
                  <div className="flex items-center justify-between border-b border-slate-850 pb-3">
                    <h3 className="font-bold text-base text-white flex items-center gap-2">
                      {isBatchFinished ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-400 animate-scale-up" />
                      ) : (
                        <RefreshCw className="w-5 h-5 text-cyan-400 animate-spin" />
                      )}
                      <span>Xử lý lô hàng loạt ({completedBatchCount}/{batchFiles.length} hoàn tất)</span>
                    </h3>

                    {isBatchFinished && completedBatchCount > 0 && (
                      <button
                        onClick={handleDownloadAll}
                        className="py-1.5 px-3 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-555 rounded-lg text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-all shadow-md shadow-emerald-500/10"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Tải xuống tất cả ({completedBatchCount} tệp)
                      </button>
                    )}
                  </div>

                  {/* Processing files status grid */}
                  <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                    {batchFiles.map((file, idx) => (
                      <div
                        key={file.id}
                        className="p-3 bg-slate-950 border border-slate-900 rounded-xl flex items-center justify-between text-xs"
                      >
                        <div className="min-w-0 flex-1 mr-4">
                          <h4 className="font-bold text-slate-200 truncate" title={file.fileName}>
                            {file.fileName}
                          </h4>
                          {file.status === "COMPLETED" && file.crossedRows !== undefined && (
                            <span className="text-[10px] text-cyan-400 font-bold mt-1 inline-block">
                              Đã gạch {file.crossedRows} dòng ({file.sheetsProcessed} sheet)
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-3">
                          <span className={`px-2 py-0.5 text-[9px] font-extrabold rounded-full ${
                            file.status === "COMPLETED"
                              ? "bg-emerald-500/10 text-emerald-450 border border-emerald-500/20"
                              : file.status === "FAILED"
                              ? "bg-red-500/10 text-red-450 border border-red-550/20"
                              : file.status === "PROCESSING"
                              ? "bg-yellow-500/10 text-yellow-400 border border-yellow-550/20 animate-pulse"
                              : "bg-slate-800 text-slate-400 border border-slate-750"
                          }`}>
                            {file.status === "COMPLETED" && "Hoàn thành"}
                            {file.status === "FAILED" && "Lỗi"}
                            {file.status === "PROCESSING" && "Đang gạch..."}
                            {file.status === "PENDING" && "Đang chờ..."}
                          </span>

                          {file.status === "COMPLETED" && (
                            <button
                              onClick={() => handleDownload(file.id, file.fileName)}
                              className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-cyan-400 transition-colors cursor-pointer"
                              title="Tải tệp này"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Bottom batch actions */}
                  {isBatchFinished && (
                    <div className="flex items-center gap-3 pt-3 border-t border-slate-850">
                      <button
                        onClick={resetWizard}
                        className="w-full py-3 border border-slate-800 hover:bg-slate-900 rounded-xl font-bold text-sm text-slate-350 cursor-pointer transition-colors"
                      >
                        Xử lý đợt khác
                      </button>
                    </div>
                  )}
                </div>

              </div>
            )}
          </section>
        )}

        {/* TAB 2: EXCEL PROCESS HISTORY */}
        {activeTab === "history" && (
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-fade-in">
            
            {/* Left side: Files list */}
            <div className="lg:col-span-6 space-y-4">
              <div className="bg-slate-900/40 border border-slate-850 rounded-2xl p-5 shadow-xl">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
                  <h3 className="font-bold text-base text-white">Lịch sử tệp đã gạch</h3>
                  
                  {/* Search filter */}
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                      <Search className="w-3.5 h-3.5" />
                    </span>
                    <input
                      type="text"
                      placeholder="Tìm tên tệp..."
                      value={filterQuery}
                      onChange={(e) => setFilterQuery(e.target.value)}
                      className="bg-slate-950 border border-slate-850 rounded-xl pl-9 pr-4 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500 w-full sm:w-48"
                    />
                  </div>
                </div>

                {loadingFiles ? (
                  <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                    <RefreshCw className="w-7 h-7 animate-spin text-cyan-400 mb-2" />
                    <p className="text-xs">Đang tải lịch sử...</p>
                  </div>
                ) : filteredFiles.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-slate-550 text-center">
                    <Info className="w-8 h-8 text-slate-700 mb-2" />
                    <p className="text-xs font-bold text-slate-400">Chưa có tệp nào được xử lý</p>
                    <p className="text-[10px] max-w-xs mt-1">
                      Nhấp vào tab &quot;Xử lý tệp mới&quot; phía trên để bắt đầu gạch chéo.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                    {filteredFiles.map((file) => (
                      <div
                        key={file.id}
                        onClick={() => viewFileDetails(file.id)}
                        className={`p-3 flex items-center justify-between hover:bg-slate-900/60 rounded-xl border transition-all cursor-pointer ${
                          selectedFile?.id === file.id
                            ? "bg-slate-900 border-cyan-500/60 pl-4"
                            : "bg-transparent border-slate-900"
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1 mr-4">
                          <div className={`p-2 rounded-lg border ${
                            file.status === "COMPLETED"
                              ? "bg-emerald-950/30 text-emerald-455 border-emerald-900/20"
                              : file.status === "FAILED"
                              ? "bg-red-950/30 text-red-455 border-red-900/20"
                              : "bg-slate-950 text-slate-555 border-slate-850"
                          }`}>
                            <FileSpreadsheet className="w-4 h-4" />
                          </div>

                          <div className="min-w-0">
                            <h4 className="font-semibold text-xs text-slate-200 truncate" title={file.fileName}>
                              {file.fileName}
                            </h4>
                            <div className="flex items-center gap-2.5 text-[9px] text-slate-450 mt-1">
                              <span className="flex items-center gap-1 font-mono">
                                <Clock className="w-2.5 h-2.5" />
                                {new Date(file.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {new Date(file.createdAt).toLocaleDateString()}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Status tag and quick actions */}
                        <div className="flex items-center gap-2.5" onClick={(e) => e.stopPropagation()}>
                          <span className={`px-2 py-0.5 text-[8px] font-extrabold rounded-full ${
                            file.status === "COMPLETED"
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/10"
                              : file.status === "FAILED"
                              ? "bg-red-500/10 text-red-400 border border-red-500/10"
                              : file.status === "PROCESSING"
                              ? "bg-yellow-500/10 text-yellow-400 border border-yellow-500/10 animate-pulse"
                              : "bg-slate-800 text-slate-400 border border-slate-700"
                          }`}>
                            {file.status === "COMPLETED" && "Xong"}
                            {file.status === "FAILED" && "Lỗi"}
                            {file.status === "PROCESSING" && "Đang gạch"}
                            {file.status === "PENDING" && "Đang chờ"}
                            {file.status === "PENDING_CONFIG" && "Chờ cài đặt"}
                          </span>

                          <div className="flex items-center gap-1">
                            {file.status === "COMPLETED" && (
                              <button
                                onClick={() => handleDownload(file.id, file.fileName)}
                                className="p-1 rounded hover:bg-slate-800 text-slate-455 hover:text-cyan-400 transition-colors cursor-pointer"
                                title="Tải xuống"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              onClick={() => handleDelete(file.id)}
                              className="p-1 rounded hover:bg-slate-800 text-slate-455 hover:text-red-400 transition-colors cursor-pointer"
                              title="Xóa"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right side: Selected File Report Details */}
            <div className="lg:col-span-6">
              {selectedFile ? (
                <div className="bg-slate-900/40 border border-slate-850 rounded-2xl p-6 shadow-xl space-y-6 animate-slide-up">
                  
                  {/* File Metadata */}
                  <div className="flex items-center justify-between border-b border-slate-850 pb-4">
                    <div>
                      <h3 className="font-bold text-sm text-white truncate max-w-[280px]" title={selectedFile.fileName}>
                        Báo cáo: {selectedFile.fileName}
                      </h3>
                      <p className="text-[10px] font-mono text-slate-450 mt-0.5">ID: {selectedFile.id}</p>
                    </div>

                    {selectedFile.status === "COMPLETED" && (
                      <button
                        onClick={() => handleDownload(selectedFile.id, selectedFile.fileName)}
                        className="py-1.5 px-3 bg-gradient-to-r from-cyan-500 to-sky-600 hover:from-cyan-400 hover:to-sky-550 rounded-lg text-slate-950 font-bold text-xs flex items-center gap-1 cursor-pointer transition-all shadow-md shadow-cyan-500/10"
                      >
                        <Download className="w-3 h-3" /> Tải về
                      </button>
                    )}
                  </div>

                  {/* Config settings applied */}
                  {selectedFile.rules && (
                    <div className="bg-slate-950 p-4 rounded-xl border border-slate-850 text-xs space-y-2">
                      <h4 className="font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 mb-2">
                        <Settings className="w-3.5 h-3.5 text-cyan-400" />
                        Cấu hình đã dùng
                      </h4>
                      {(() => {
                        try {
                          const parsed = JSON.parse(selectedFile.rules || "{}");
                          return (
                            <div className="grid grid-cols-2 gap-y-2 text-slate-350">
                              <div>Kiểu gạch:</div>
                              <div className="font-bold text-slate-200">
                                {parsed.crossType === "greater_than" && "Mũi tên kiểu '>'"}
                                {parsed.crossType === "single_diagonal_up" && "Đường chéo lên '/'"}
                                {parsed.crossType === "single_diagonal_down" && "Đường chéo xuống '\\'"}
                              </div>

                              <div>Màu sắc:</div>
                              <div className="flex items-center gap-1 font-mono font-bold text-slate-250">
                                <span className="w-2.5 h-2.5 rounded-full border border-slate-700 inline-block" style={{ backgroundColor: parsed.crossColor }} />
                                {parsed.crossColor?.toUpperCase()}
                              </div>

                              <div>Độ dày nét:</div>
                              <div className="font-bold text-slate-250">{parsed.crossThickness} px</div>
                            </div>
                          );
                        } catch (e) {
                          return <div className="text-slate-500">Quy tắc cũ: {selectedFile.rules}</div>;
                        }
                      })()}
                    </div>
                  )}

                  {/* Sheet breakdown statistics */}
                  <div className="space-y-2">
                    <h4 className="font-bold text-xs text-slate-350 uppercase tracking-wider flex items-center gap-1.5">
                      <Grid className="w-3.5 h-3.5 text-cyan-455" />
                      Chi tiết gạch chéo từng Sheet
                    </h4>

                    {!selectedFile.jobs || selectedFile.jobs.length === 0 ? (
                      <div className="p-6 text-center text-slate-500 text-xs border border-slate-850 rounded-xl">
                        Chưa có dữ liệu thống kê chi tiết cho từng sheet.
                      </div>
                    ) : (
                      <div className="border border-slate-850 rounded-xl overflow-hidden bg-slate-950/30">
                        <table className="min-w-full divide-y divide-slate-850">
                          <thead className="bg-slate-950">
                            <tr className="text-slate-500 text-[10px] font-bold uppercase">
                              <th className="px-4 py-2.5 text-left">Tên Sheet</th>
                              <th className="px-4 py-2.5 text-right">Tổng dòng</th>
                              <th className="px-4 py-2.5 text-right text-cyan-400">Đã gạch</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-850 text-xs text-slate-300">
                            {selectedFile.jobs.map((sheet, index) => (
                              <tr key={index} className="hover:bg-slate-900/30">
                                <td className="px-4 py-2.5 font-semibold text-slate-200">{sheet.sheetName}</td>
                                <td className="px-4 py-2.5 text-right font-mono text-slate-400">{sheet.totalRows}</td>
                                <td className="px-4 py-2.5 text-right font-mono font-extrabold text-cyan-400">
                                  {sheet.emptyCells} dòng
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="h-full border border-dashed border-slate-850 rounded-2xl p-12 flex flex-col items-center justify-center text-center text-slate-500">
                  <Info className="w-8 h-8 text-slate-755 mb-3" />
                  <h4 className="font-bold text-sm text-slate-455">Chi tiết báo cáo tệp</h4>
                  <p className="text-[10px] max-w-xs mt-1 leading-relaxed">
                    Chọn một tệp từ danh sách lịch sử bên trái để xem thống kê cài đặt và chi tiết gạch chéo của từng sheet.
                  </p>
                </div>
              )}
            </div>

          </section>
        )}

      </main>
    </div>
  );
}
