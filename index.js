require("dotenv").config();
const express = require("express");
const cors = require("cors");
const Replicate = require("replicate");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "50mb" }));

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// =============================
// POSES
// =============================
const POSES = [
  "standing straight, full body, facing forward",
  "side profile, full body, walking pose",
  "three quarter view, full body, relaxed standing",
  "sitting pose, upper body visible",
  "close-up, upper body, slight angle"
];

// =============================
// PROMPT BUILDER
// =============================
function buildPrompt(description, pose) {
  return `ultra realistic female model, ${description}, ${pose}, minimalist fashion, neutral tones, soft lighting, grey studio background, clean aesthetic, high fashion editorial, full body, no logos, no text on clothing, professional photography`;
}

// =============================
// POST /generate-outfit
// =============================
app.post("/generate-outfit", async (req, res) => {
  try {
    const { description, referenceImage } = req.body;

    if (!description || description.trim() === "") {
      return res.status(400).json({ error: "description is required" });
    }

    console.log("🚀 Gerando outfit para:", description);
    console.log("📸 Imagem de referência:", referenceImage ? "sim" : "não");

    // gera 5 imagens em paralelo, uma por pose
    const promises = POSES.map((pose) => {
      const prompt = buildPrompt(description.trim(), pose);

      const input = {
        prompt,
        num_inference_steps: 28,
        guidance_scale: 3.5,
        width: 768,
        height: 1344,
      };

      // se tiver imagem de referência, inclui
      if (referenceImage) {
        input.image = referenceImage;
        input.strength = 0.75;
      }

      return replicate.run("black-forest-labs/flux-dev", { input });
    });

    const results = await Promise.all(promises);

    // cada resultado é um array com 1 URL
    const images = results.map((r) => (Array.isArray(r) ? r[0] : r));

    console.log("✅ Imagens geradas:", images.length);

    return res.json({ images });

  } catch (err) {
    console.error("❌ Erro:", err.message);
    return res.status(500).json({ error: "Falha ao gerar imagens" });
  }
});

// =============================
app.listen(PORT, () => {
  console.log(`✅ Servidor rodando na porta ${PORT}`);
});
