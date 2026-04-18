require("dotenv").config();
const express = require("express");
const cors = require("cors");
const Replicate = require("replicate");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "50mb" }));

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_BASE_URL;

const POSES = [
  "standing straight, full body, facing forward",
  "side profile, full body, walking pose",
  "three quarter view, full body, relaxed standing",
  "sitting pose, upper body visible",
  "close-up, upper body, slight angle"
];

function buildPrompt(description, pose) {
  return `ultra realistic female model, ${description}, ${pose}, minimalist fashion, neutral tones, soft lighting, grey studio background, clean aesthetic, high fashion editorial, full body, no logos, no text on clothing, professional photography`;
}

// upload buffer para R2
async function uploadToR2(buffer, fileName, contentType) {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: fileName,
    Body: buffer,
    ContentType: contentType,
  });
  await s3.send(command);
  return `${R2_PUBLIC_URL}/${fileName}`;
}

// POST /generate-outfit
app.post("/generate-outfit", async (req, res) => {
  try {
    const { description, referenceImage } = req.body;

    if (!description || description.trim() === "") {
      return res.status(400).json({ error: "description is required" });
    }

    console.log("🚀 Gerando outfit para:", description);

    let referenceUrl = null;

    // 1. Se vier base64, faz upload para R2
    if (referenceImage && referenceImage.startsWith("data:")) {
      console.log("📤 Fazendo upload da imagem de referência para R2...");
      const matches = referenceImage.match(/^data:(.+);base64,(.+)$/);
      if (matches) {
        const contentType = matches[1];
        const buffer = Buffer.from(matches[2], "base64");
        const ext = contentType.split("/")[1];
        const fileName = `references/${uuidv4()}.${ext}`;
        referenceUrl = await uploadToR2(buffer, fileName, contentType);
        console.log("✅ Referência no R2:", referenceUrl);
      }
    } else if (referenceImage && referenceImage.startsWith("http")) {
      referenceUrl = referenceImage;
    }

    // 2. Gera 5 imagens em paralelo
    const promises = POSES.map((pose) => {
      const input = {
        prompt: buildPrompt(description.trim(), pose),
        num_inference_steps: 28,
        guidance_scale: 3.5,
        width: 768,
        height: 1344,
      };
      if (referenceUrl) {
        input.image = referenceUrl;
        input.strength = 0.75;
      }
      return replicate.run("black-forest-labs/flux-dev", { input });
    });

    const results = await Promise.all(promises);
    const replicateUrls = results.map((r) => (Array.isArray(r) ? r[0] : r));

    // 3. Faz upload das imagens geradas para R2
    console.log("📤 Fazendo upload das imagens geradas para R2...");
    const finalUrls = await Promise.all(
      replicateUrls.map(async (url, i) => {
        const response = await axios.get(url, { responseType: "arraybuffer" });
        const fileName = `outfits/${uuidv4()}.webp`;
        return uploadToR2(Buffer.from(response.data), fileName, "image/webp");
      })
    );

    console.log("✅ Imagens no R2:", finalUrls.length);
    return res.json({ images: finalUrls });

  } catch (err) {
    console.error("❌ Erro:", err.message);
    return res.status(500).json({ error: "Falha ao gerar imagens" });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Servidor rodando na porta ${PORT}`);
});
