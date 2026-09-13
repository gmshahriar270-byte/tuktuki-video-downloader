const express = require("express");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

const DOWNLOAD_DIR = path.join(__dirname, "downloads");

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/downloads", express.static(DOWNLOAD_DIR));

app.post("/download", (req, res) => {
    const url = (req.body.url || "").trim();

    if (!url) {
        return res.status(400).json({
            success: false,
            message: "ভিডিও লিংক দিন।"
        });
    }

    if (
        !url.includes("youtube.com") &&
        !url.includes("youtu.be") &&
        !url.includes("tiktok.com")
    ) {
        return res.status(400).json({
            success: false,
            message: "YouTube বা TikTok URL দিন।"
        });
    }

    const filename = `video_${Date.now()}.mp4`;
    const output = path.join(DOWNLOAD_DIR, filename);

    const args = [
        "--no-playlist",
        "-f",
        "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
        "--merge-output-format",
        "mp4",
        "-o",
        output,
        url
    ];

    const process = spawn("yt-dlp", args);

    let errorText = "";

    process.stderr.on("data", data => {
        errorText += data.toString();
    });

    process.on("close", code => {
        if (code === 0 && fs.existsSync(output)) {
            res.json({
                success: true,
                message: "ভিডিও প্রস্তুত হয়েছে।",
                download: `/downloads/${filename}`
            });
        } else {
            console.error(errorText);

            res.status(500).json({
                success: false,
                message: "ভিডিও ডাউনলোড করা যায়নি। লিংকটি বৈধ ও অনুমোদিত কিনা পরীক্ষা করুন।"
            });
        }
    });
});

app.listen(PORT, "0.0.0.0", () => {
    console.log("");
    console.log("======================================");
    console.log("       🎬 VIDEO DOWNLOADER");
    console.log("======================================");
    console.log(`🌐 http://localhost:${PORT}`);
    console.log("======================================");
});
