const express = require("express");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

const DOWNLOAD_DIR = path.join(__dirname, "downloads");
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

const jobs = new Map();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/downloads", express.static(DOWNLOAD_DIR));

function validURL(url) {
    return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be|tiktok\.com)\//i.test(url);
}

app.post("/info", (req, res) => {
    const url = (req.body.url || "").trim();

    if (!url || !validURL(url)) {
        return res.status(400).json({
            success: false,
            message: "সঠিক YouTube বা TikTok URL দিন।"
        });
    }

    const args = [
        "--no-playlist",
        "--dump-single-json",
        "--skip-download",
        "--no-warnings",
        url
    ];

    const p = spawn("yt-dlp", args);
    let output = "";
    let error = "";

    p.stdout.on("data", d => output += d.toString());
    p.stderr.on("data", d => error += d.toString());

    p.on("close", code => {
        if (code !== 0) {
            return res.status(500).json({
                success: false,
                message: "ভিডিওর তথ্য পাওয়া যায়নি।"
            });
        }

        try {
            const data = JSON.parse(output);

            res.json({
                success: true,
                title: data.title || "Tuktuki Video",
                thumbnail: data.thumbnail || "",
                duration: data.duration || 0,
                uploader: data.uploader || data.channel || ""
            });
        } catch {
            res.status(500).json({
                success: false,
                message: "ভিডিও তথ্য পড়া যাচ্ছে না।"
            });
        }
    });
});

app.post("/download", (req, res) => {
    const url = (req.body.url || "").trim();

    if (!url || !validURL(url)) {
        return res.status(400).json({
            success: false,
            message: "সঠিক YouTube বা TikTok URL দিন।"
        });
    }

    const id = Date.now().toString();
    const filename = `tuktuki_${id}.mp4`;
    const output = path.join(DOWNLOAD_DIR, filename);

    jobs.set(id, {
        progress: 0,
        status: "processing",
        filename: null,
        message: "ভিডিও প্রসেস হচ্ছে..."
    });

    res.json({
        success: true,
        jobId: id
    });

    const args = [
        "--no-playlist",
        "--newline",
        "--progress",
        "-f",
        "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
        "--merge-output-format",
        "mp4",
        "-o",
        output,
        url
    ];

    const p = spawn("yt-dlp", args);

    let errorText = "";

    p.stdout.on("data", data => {
        const text = data.toString();
        const match = text.match(/(\d+(?:\.\d+)?)%/);

        if (match) {
            jobs.get(id).progress = Math.min(100, parseFloat(match[1]));
        }
    });

    p.stderr.on("data", data => {
        const text = data.toString();
        errorText += text;

        const match = text.match(/(\d+(?:\.\d+)?)%/);
        if (match) {
            jobs.get(id).progress = Math.min(100, parseFloat(match[1]));
        }
    });

    p.on("close", code => {
        const job = jobs.get(id);
        if (!job) return;

        if (code === 0 && fs.existsSync(output)) {
            job.progress = 100;
            job.status = "complete";
            job.filename = `/downloads/${filename}`;
            job.message = "ভিডিও প্রস্তুত হয়েছে।";
        } else {
            console.error(errorText);
            job.status = "error";
            job.message = "ভিডিও ডাউনলোড করা যায়নি। লিংকটি বৈধ ও অনুমোদিত কিনা পরীক্ষা করুন।";
        }
    });
});

app.get("/progress/:id", (req, res) => {
    const job = jobs.get(req.params.id);

    if (!job) {
        return res.status(404).json({
            success: false,
            message: "Download job পাওয়া যায়নি।"
        });
    }

    res.json({
        success: true,
        ...job
    });

    if (job.status === "complete" || job.status === "error") {
        setTimeout(() => jobs.delete(req.params.id), 10 * 60 * 1000);
    }
});

app.listen(PORT, "0.0.0.0", () => {
    console.log("======================================");
    console.log("       🎬 TUKTUKI DOWNLOADER");
    console.log("======================================");
    console.log(`🌐 http://localhost:${PORT}`);
    console.log("======================================");
});
