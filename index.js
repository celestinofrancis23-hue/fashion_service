const express = require("express");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const axios = require("axios");

const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { v4: uuidv4 } = require("uuid");

require("dotenv").config();

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT"],
  allowedHeaders: ["Content-Type"]
}));
app.use(express.json({ limit: "50mb" }));

// =============================
// CONFIG R2
// =============================
const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

// =============================
// 🔗 ROUTE 1: GENERATE SIGNED URL
// =============================
app.post("/generate-upload-url", async (req, res) => {
console.log("🔥 RECEBEU REQUEST");
  console.log(req.body);  
try {
    const { fileType } = req.body;

    if (!fileType) {
      return res.status(400).json({ error: "fileType is required" });
    }

    let extension = "jpg";
    if (fileType.includes("png")) extension = "png";
    if (fileType.includes("mp4")) extension = "mp4";

    const fileName = `uploads/${uuidv4()}.${extension}`;

    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: fileName,
      ContentType: fileType,
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

    const fileUrl = `${process.env.R2_PUBLIC_BASE_URL}/${fileName}`;

    res.json({
      uploadUrl,
      fileUrl,
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to generate URL" });
  }
});

// =============================
// 🎬 ROUTE 2: RENDER VIDEO
// =============================
app.post("/render-video", async (req, res) => {
  try {
    const { description, images } = req.body;

    if (!images || images.length === 0) {
      return res.status(400).json({ error: "No images provided" });
    }

    console.log("Descrição:", description);
    console.log("Imagens:", images);

    // 🔥 criar pasta temp
    const tempDir = path.join(__dirname, "temp");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }

    const imagePaths = [];

    // 🔥 baixar imagens do R2
    for (let i = 0; i < images.length; i++) {
      const url = images[i];
      const filePath = path.join(tempDir, `img_${i}.png`);

      const response = await axios({
        url,
        method: "GET",
        responseType: "arraybuffer",
      });

      fs.writeFileSync(filePath, response.data);
      imagePaths.push(filePath);
    }

    const outputPath = path.join(__dirname, "output.mp4");

    // 🎬 criar vídeo slideshow
    const command = ffmpeg();

    imagePaths.forEach((img) => {
      command.addInput(img).inputOptions(["-loop 1", "-t 2"]);
    });

    command
      .outputOptions([
        "-vf scale=1080:1920",
        "-pix_fmt yuv420p",
        "-r 30"
      ])
      .on("end", () => {
        console.log("Vídeo criado com sucesso");

        res.json({
          status: "done",
          video: "output.mp4"
        });
      })
      .on("error", (err) => {
        console.error("Erro FFmpeg:", err);
        res.status(500).json({ error: "FFmpeg error" });
      })
      .mergeToFile(outputPath);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// =============================
app.listen(3000, () => {
  console.log("Render service running on port 3000");
});
