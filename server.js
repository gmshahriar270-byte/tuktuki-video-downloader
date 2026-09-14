const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const youtubedl = require("youtube-dl-exec");

const app = express();

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

const DOWNLOAD_DIR = path.join(__dirname, "downloads");

if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const jobs = new Map();

function extractURL(text) {
    const match = String(text || "").match(
        /https?:\/\/[^\s<>"']+/i
    );

    if (!match) return "";

    return match[0]
        .replace(/[),.!?]+$/, "")
        .trim();
}

function validURL(url) {
    try {
        const u = new URL(url);

        const host = u.hostname.toLowerCase();

        return (
            host === "youtube.com" ||
            host.endsWith(".youtube.com") ||
            host === "youtu.be" ||
            host === "tiktok.com" ||
            host.endsWith(".tiktok.com")
        );
    } catch {
        return false;
    }
}

function parseProgress(text) {
    const match = String(text).match(/(\d+(?:\.\d+)?)%/);

    if (!match) return null;

    const value = Number(match[1]);

    if (Number.isNaN(value)) return null;

    return Math.max(0, Math.min(100, value));
}

function findDownloadedFile(jobId) {
    const files = fs.readdirSync(DOWNLOAD_DIR);

    const file = files.find(name =>
        name.startsWith(jobId + ".")
    );

    return file ? path.join(DOWNLOAD_DIR, file) : null;
}

/* =========================
   HEALTH CHECK
========================= */

app.get("/health", (req, res) => {
    res.json({
        ok: true,
        service: "Tuktuki Video Downloader"
    });
});

/* =========================
   VIDEO INFO
========================= */

app.post("/info", async (req, res) => {
    try {
        const url = extractURL(req.body.url || "");

        if (!url || !validURL(url)) {
            return res.status(400).json({
                error: "Valid YouTube/TikTok URL দিন।"
            });
        }

        const result = await youtubedl(url, {
            dumpSingleJson: true,
            noWarnings: true,
            noPlaylist: true,
            skipDownload: true,
            noCheckCertificates: true
        });

        const data =
            typeof result === "string"
                ? JSON.parse(result)
                : result;

        res.json({
            success: true,
            title: data.title || "Unknown Video",
            thumbnail: data.thumbnail || "",
            duration: data.duration || 0,
            uploader: data.uploader || ""
        });

    } catch (error) {
        console.error("INFO ERROR:", error);

        res.status(500).json({
            error: "ভিডিও তথ্য পাওয়া যাচ্ছে না।",
            message: error.message || "Unknown error",
            details: error.message || "Unknown error"
        });
    }
});

/* =========================
   START DOWNLOAD
========================= */

app.post("/download", async (req, res) => {
    const url = extractURL(req.body.url || "");

    if (!url || !validURL(url)) {
        return res.status(400).json({
            error: "Valid YouTube/TikTok URL দিন।",
            message: "Valid YouTube/TikTok URL দিন।"
        });
    }

    const jobId = crypto.randomBytes(8).toString("hex");

    const outputTemplate = path.join(
        DOWNLOAD_DIR,
        `${jobId}.%(ext)s`
    );

    jobs.set(jobId, {
        status: "starting",
        progress: 0,
        url,
        file: null,
        error: null
    });

    res.json({
        success: true,
        jobId
    });

    try {
        const process = youtubedl.exec(url, {
            noPlaylist: true,
            newline: true,
            progress: true,
            noWarnings: true,
            noCheckCertificates: true,

            format:
                "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",

            mergeOutputFormat: "mp4",

            output: outputTemplate
        });

        process.on("error", error => {
            console.error("PROCESS ERROR:", error);

            const job = jobs.get(jobId);

            if (job) {
                job.status = "error";
                job.error =
                    error.message || "Download process failed";
            }
        });

        const handleOutput = chunk => {
            const text = chunk.toString();

            console.log(`[${jobId}] ${text}`);

            const progress = parseProgress(text);

            const job = jobs.get(jobId);

            if (!job) return;

            if (progress !== null) {
                job.progress = progress;
                job.status = "downloading";
            }
        };

        if (process.stdout) {
            process.stdout.on("data", handleOutput);
        }

        if (process.stderr) {
            process.stderr.on("data", handleOutput);
        }

        try {
            await process;

            const file = findDownloadedFile(jobId);
            const job = jobs.get(jobId);

            if (!job) return;

            if (!file) {
                job.status = "error";
                job.error = "Downloaded file পাওয়া যায়নি।";
                return;
            }

            job.status = "completed";
            job.progress = 100;
            job.file = `/download-file/${jobId}`;

            console.log(`[${jobId}] DOWNLOAD COMPLETE`);

        } catch (error) {
            console.error("DOWNLOAD ERROR:", error);

            const job = jobs.get(jobId);

            if (job) {
                job.status = "error";
                job.error =
                    error.shortMessage ||
                    error.message ||
                    "Download failed";
            }
        }

    } catch (error) {
        console.error("START ERROR:", error);

        const job = jobs.get(jobId);

        if (job) {
            job.status = "error";
            job.error =
                error.message || "Could not start downloader";
        }
    }
});

/* =========================
   DOWNLOAD PROGRESS
========================= */

app.get("/progress/:id", (req, res) => {
    const job = jobs.get(req.params.id);

    if (!job) {
        return res.status(404).json({
            error: "Job পাওয়া যায়নি।",
            message: "Job পাওয়া যায়নি।"
        });
    }

    res.json({
        success: true,
        status: job.status,
        progress: job.progress,
        file: job.file,
        error: job.error
    });
});

/* =========================
   DOWNLOAD FILE
========================= */

app.get("/download-file/:id", (req, res) => {
    const job = jobs.get(req.params.id);

    if (!job || job.status !== "completed") {
        return res.status(404).send("File not ready");
    }

    const file = findDownloadedFile(req.params.id);

    if (!file || !fs.existsSync(file)) {
        return res.status(404).send("File not found");
    }

    res.download(file, path.basename(file), error => {
        if (error) {
            console.error("SEND FILE ERROR:", error);
        }
    });
});

/* =========================
   CLEAN OLD JOBS
========================= */

setInterval(() => {
    const now = Date.now();

    for (const [id, job] of jobs.entries()) {
        if (!job.createdAt) {
            job.createdAt = now;
        }

        if (now - job.createdAt > 30 * 60 * 1000) {
            jobs.delete(id);
        }
    }
}, 10 * 60 * 1000);

/* =========================
   START SERVER
========================= */

app.listen(PORT, HOST, () => {
    console.log("╔══════════════════════════════════════╗");
    console.log("║        TUKTUKI VIDEO DOWNLOADER     ║");
    console.log("╚══════════════════════════════════════╝");
    console.log(`Server running on port ${PORT}`);
});
