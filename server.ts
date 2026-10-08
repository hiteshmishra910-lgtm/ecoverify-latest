import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// CORS & JSON headers middleware for Capacitor Android APK and cross-origin clients
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  if (req.method === "OPTIONS") {
    return res.status(200).json({ success: true });
  }
  next();
});

// Increase payload limit for captured high-res camera images
app.use(express.json({ limit: "25mb" }));

// Supported image-capable Gemini models available to this API key
const PRIMARY_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const CANDIDATE_MODELS = Array.from(
  new Set([PRIMARY_MODEL, "gemini-flash-latest", "gemini-3.1-flash-lite", "gemini-3.8-flash"])
);

const ALLOWED_RESULTS = [
  "WET_WASTE",
  "DRY_WASTE",
  "PLASTIC",
  "POLYTHENE",
  "PAPER",
  "CARDBOARD",
  "METAL",
  "ALUMINIUM",
  "GLASS",
  "E_WASTE",
  "ORGANIC_WASTE",
  "OTHER",
  "NOT_WASTE",
  "HUMAN_DETECTED",
] as const;

type AllowedResultEnum = (typeof ALLOWED_RESULTS)[number];

const WASTE_TYPE_DISPLAY_LABELS: Record<AllowedResultEnum, string> = {
  WET_WASTE: "Wet Waste",
  DRY_WASTE: "Dry Waste",
  PLASTIC: "Plastic",
  POLYTHENE: "Polythene",
  PAPER: "Paper",
  CARDBOARD: "Cardboard",
  METAL: "Metal",
  ALUMINIUM: "Aluminium",
  GLASS: "Glass",
  E_WASTE: "E-Waste",
  ORGANIC_WASTE: "Organic Waste",
  OTHER: "Other",
  NOT_WASTE: "Not Waste",
  HUMAN_DETECTED: "Human Detected",
};

// Normalize natural labels or enum variants returned by Gemini into canonical enums
function normalizeCategoryResult(
  rawResult: string,
  rawObject: string,
  humanDetected: boolean,
  isGarbage: boolean
): AllowedResultEnum | null {
  // Rule 7: Clear person is the main subject and no garbage is visible -> HUMAN_DETECTED
  if (humanDetected && !isGarbage) {
    return "HUMAN_DETECTED";
  }

  const cleaned = String(rawResult || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if ((ALLOWED_RESULTS as readonly string[]).includes(cleaned)) {
    if (cleaned === "HUMAN_DETECTED" && isGarbage) {
      // Garbage + person's hand or partial person in background -> allow analysis
    } else {
      return cleaned as AllowedResultEnum;
    }
  }

  const directMap: Record<string, AllowedResultEnum> = {
    PLASTIC: "PLASTIC",
    PLASTIC_WASTE: "PLASTIC",
    PLASTIC_BOTTLE: "PLASTIC",
    PLASTIC_CONTAINER: "PLASTIC",
    POLYTHENE: "POLYTHENE",
    POLYTHENE_BAG: "POLYTHENE",
    PLASTIC_BAG: "POLYTHENE",
    POLYBAG: "POLYTHENE",
    WET: "WET_WASTE",
    WET_WASTE: "WET_WASTE",
    WET_GARBAGE: "WET_WASTE",
    FOOD_WASTE: "WET_WASTE",
    KITCHEN_WASTE: "WET_WASTE",
    DRY: "DRY_WASTE",
    DRY_WASTE: "DRY_WASTE",
    DRY_GARBAGE: "DRY_WASTE",
    ORGANIC: "ORGANIC_WASTE",
    ORGANIC_WASTE: "ORGANIC_WASTE",
    BIODEGRADABLE: "ORGANIC_WASTE",
    PAPER: "PAPER",
    PAPER_WASTE: "PAPER",
    NEWSPAPER: "PAPER",
    CARDBOARD: "CARDBOARD",
    CARDBOARD_BOX: "CARDBOARD",
    CARTON: "CARDBOARD",
    METAL: "METAL",
    METAL_WASTE: "METAL",
    TIN: "METAL",
    STEEL: "METAL",
    ALUMINIUM: "ALUMINIUM",
    ALUMINUM: "ALUMINIUM",
    ALUMINIUM_CAN: "ALUMINIUM",
    ALUMINUM_CAN: "ALUMINIUM",
    FOIL: "ALUMINIUM",
    GLASS: "GLASS",
    GLASS_BOTTLE: "GLASS",
    GLASS_WASTE: "GLASS",
    E_WASTE: "E_WASTE",
    EWASTE: "E_WASTE",
    ELECTRONIC_WASTE: "E_WASTE",
    ELECTRONICS: "E_WASTE",
    BATTERY: "E_WASTE",
    OTHER: "OTHER",
    MIXED_WASTE: "OTHER",
    GENERAL_WASTE: "OTHER",
    TRASH: "OTHER",
    GARBAGE: "OTHER",
    NOT_WASTE: "NOT_WASTE",
    NO_WASTE: "NOT_WASTE",
    NO_GARBAGE: "NOT_WASTE",
    NONE: "NOT_WASTE",
    HUMAN_DETECTED: "HUMAN_DETECTED",
    PERSON_DETECTED: "HUMAN_DETECTED",
    HUMAN: "HUMAN_DETECTED",
    PERSON: "HUMAN_DETECTED",
  };

  if (directMap[cleaned]) {
    if (directMap[cleaned] === "HUMAN_DETECTED" && isGarbage) {
      // Fall through to object inspection when garbage is visible alongside a hand/person
    } else {
      return directMap[cleaned];
    }
  }

  if (!isGarbage) {
    return humanDetected ? "HUMAN_DETECTED" : "NOT_WASTE";
  }

  const combined = `${cleaned} ${String(rawObject || "").toUpperCase()}`;
  if (combined.includes("POLYTHENE") || combined.includes("PLASTIC BAG") || combined.includes("CARRY BAG")) {
    return "POLYTHENE";
  }
  if (combined.includes("PLASTIC") || combined.includes("PET BOTTLE")) {
    return "PLASTIC";
  }
  if (combined.includes("CARDBOARD") || combined.includes("CARTON") || combined.includes("CORRUGATED")) {
    return "CARDBOARD";
  }
  if (combined.includes("PAPER") || combined.includes("NEWSPAPER") || combined.includes("TISSUE") || combined.includes("MAGAZINE")) {
    return "PAPER";
  }
  if (combined.includes("ALUMINIUM") || combined.includes("ALUMINUM") || combined.includes("SODA CAN") || combined.includes("FOIL")) {
    return "ALUMINIUM";
  }
  if (combined.includes("METAL") || combined.includes("TIN CAN") || combined.includes("IRON") || combined.includes("STEEL")) {
    return "METAL";
  }
  if (combined.includes("GLASS") || combined.includes("JAR")) {
    return "GLASS";
  }
  if (
    combined.includes("E_WASTE") ||
    combined.includes("EWASTE") ||
    combined.includes("ELECTRONIC") ||
    combined.includes("BATTERY") ||
    combined.includes("CIRCUIT") ||
    combined.includes("CABLE") ||
    combined.includes("CHARGER")
  ) {
    return "E_WASTE";
  }
  if (
    combined.includes("WET") ||
    combined.includes("FOOD") ||
    combined.includes("VEGETABLE") ||
    combined.includes("FRUIT") ||
    combined.includes("LEFTOVER")
  ) {
    return "WET_WASTE";
  }
  if (
    combined.includes("ORGANIC") ||
    combined.includes("LEAF") ||
    combined.includes("LEAVES") ||
    combined.includes("GARDEN") ||
    combined.includes("COMPOST")
  ) {
    return "ORGANIC_WASTE";
  }
  if (combined.includes("DRY")) {
    return "DRY_WASTE";
  }

  if (isGarbage) {
    return "OTHER";
  }

  return null;
}

const WASTE_ANALYSIS_PROMPT = `You are an AI waste classification system for EcoVerify.

Analyze the attached image carefully.

1. Human detection rules:
- Do NOT reject an image simply because a hand, finger, arm, or small part of a person appears in the image.
- Examples:
  * Garbage + person's hand -> ALLOW analysis (set "humanDetected": false, "isGarbage": true).
  * Garbage + partial person in background -> ALLOW analysis (set "humanDetected": false, "isGarbage": true).
  * Clear person is the main subject and NO garbage is visible -> return "result": "HUMAN_DETECTED", "humanDetected": true, "isGarbage": false.

2. Garbage classification:
Classify the visible waste into one of:
- "Wet Waste" (or "WET_WASTE")
- "Dry Waste" (or "DRY_WASTE")
- "Plastic" (or "PLASTIC")
- "Polythene" (or "POLYTHENE")
- "Paper" (or "PAPER")
- "Cardboard" (or "CARDBOARD")
- "Metal" (or "METAL")
- "Aluminium" (or "ALUMINIUM")
- "Glass" (or "GLASS")
- "E-Waste" (or "E_WASTE")
- "Organic Waste" (or "ORGANIC_WASTE")
- "Other" (or "OTHER")
- "NOT_WASTE" (if no garbage is present and it is not a person)
- "HUMAN_DETECTED" (if a clear person is the main subject and no garbage is visible)

Do not guess. Never return Plastic unless plastic waste is actually visible.

Return JSON only:
{
  "result": "PLASTIC",
  "object": "plastic bottle",
  "confidence": 0.94,
  "humanDetected": false,
  "isGarbage": true,
  "reason": "Plastic bottle waste detected"
}`;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err: any = new Error(`${label} timed out after ${timeoutMs}ms`);
      err.status = 504;
      err.code = "TIMEOUT";
      reject(err);
    }, timeoutMs);

    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

app.get("/api/health", (_req, res) => {
  res.setHeader("Content-Type", "application/json");
  return res.status(200).json({
    success: true,
    status: "OK",
    model: PRIMARY_MODEL,
  });
});

app.post("/api/analyze-garbage", async (req, res) => {
  res.setHeader("Content-Type", "application/json");

  const attemptNumber = Number(req.body?.attempt || 1);
  const { imageBase64, mimeType } = req.body || {};

  console.log("AI MODEL:", PRIMARY_MODEL);
  console.log("AI REQUEST START:", {
    attemptNumber,
    timestamp: new Date().toISOString(),
  });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === "" || apiKey === "MY_GEMINI_API_KEY") {
    console.error("AI RESPONSE STATUS:", 401, "Missing or placeholder GEMINI_API_KEY");
    return res.status(401).json({
      success: false,
      error: "AI_AUTH_ERROR",
      status: "AUTH_ERROR",
      result: "AI_ANALYSIS_FAILED",
      errorCode: 401,
      errorCategory: "API key/authentication problem",
      message: "AI service authentication/configuration error: GEMINI_API_KEY is not configured.",
    });
  }

  if (!imageBase64 || typeof imageBase64 !== "string") {
    console.error("AI RESPONSE STATUS:", 400, "Missing imageBase64 payload");
    return res.status(400).json({
      success: false,
      error: "INVALID_IMAGE",
      status: "BAD_REQUEST",
      result: "AI_ANALYSIS_FAILED",
      errorCode: 400,
      errorCategory: "Invalid request/image",
      message: "Invalid image or request. Please capture a clear photo of the waste.",
    });
  }

  const dataUrlMatch = imageBase64.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,/);
  const resolvedMimeType =
    (dataUrlMatch && dataUrlMatch[1]) ||
    (mimeType && typeof mimeType === "string" ? mimeType : "image/jpeg");

  const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, "").trim();
  const imageByteSize = Buffer.byteLength(cleanBase64, "base64");

  console.log("IMAGE SIZE:", imageByteSize);
  console.log("IMAGE MIME TYPE:", resolvedMimeType);

  if (!cleanBase64 || imageByteSize < 100) {
    console.error("AI RESPONSE STATUS:", 400, "Image byte size too small:", imageByteSize);
    return res.status(400).json({
      success: false,
      error: "INVALID_IMAGE",
      status: "BAD_REQUEST",
      result: "AI_ANALYSIS_FAILED",
      errorCode: 400,
      errorCategory: "Invalid request/image",
      message: "Captured image payload is empty or corrupted. Please retake the photo.",
    });
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });

  let lastError: any = null;
  let usedModel = PRIMARY_MODEL;
  let response: any = null;

  for (const candidateModel of CANDIDATE_MODELS) {
    usedModel = candidateModel;
    try {
      console.log("AI MODEL:", candidateModel);

      response = await withTimeout(
        ai.models.generateContent({
          model: candidateModel,
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType: resolvedMimeType,
                  data: cleanBase64,
                },
              },
              { text: WASTE_ANALYSIS_PROMPT },
            ],
          },
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                result: {
                  type: Type.STRING,
                  description:
                    "Waste category: PLASTIC, POLYTHENE, PAPER, CARDBOARD, METAL, ALUMINIUM, GLASS, E_WASTE, WET_WASTE, DRY_WASTE, ORGANIC_WASTE, OTHER, NOT_WASTE, or HUMAN_DETECTED",
                },
                object: {
                  type: Type.STRING,
                  description: "Specific object identified (e.g., plastic bottle, cardboard box, newspaper, person)",
                },
                confidence: {
                  type: Type.NUMBER,
                  description: "Confidence score from 0.00 to 1.00",
                },
                humanDetected: {
                  type: Type.BOOLEAN,
                  description: "True only if a human/person is the main subject and no clear garbage is visible",
                },
                isGarbage: {
                  type: Type.BOOLEAN,
                  description: "True if actual waste/garbage is visible in the image",
                },
                reason: {
                  type: Type.STRING,
                  description: "Concise explanation of what was detected in the image",
                },
              },
              required: ["result", "object", "confidence", "humanDetected", "isGarbage", "reason"],
            },
          },
        }),
        22000,
        `Gemini vision call (${candidateModel})`
      );

      if (response) {
        break;
      }
    } catch (err: any) {
      lastError = err;
      const errMsg = String(err?.message || err || "");
      const lowerErrMsg = errMsg.toLowerCase();

      const isModelNotFound =
        err?.status === 404 ||
        errMsg.includes("404") ||
        lowerErrMsg.includes("not found") ||
        lowerErrMsg.includes("no longer available") ||
        lowerErrMsg.includes("not supported");

      const isModelOverloaded =
        err?.status === 503 ||
        errMsg.includes("503") ||
        errMsg.includes("UNAVAILABLE") ||
        lowerErrMsg.includes("high demand") ||
        lowerErrMsg.includes("overloaded") ||
        err?.code === "TIMEOUT" ||
        lowerErrMsg.includes("timed out");

      if (isModelNotFound || isModelOverloaded) {
        console.warn(
          `[AI Waste Analysis] Model ${candidateModel} returned ${err?.status || err?.code || "error"}, trying next supported vision model...`
        );
        continue;
      }

      break;
    }
  }

  if (!response) {
    const rawMsg = String(lastError?.message || lastError || "AI service is temporarily unavailable.");
    const lowerMsg = rawMsg.toLowerCase();

    let statusFromError = Number(lastError?.status || lastError?.statusCode || lastError?.code) || 503;
    if (lastError?.code === "TIMEOUT" || lowerMsg.includes("timed out") || statusFromError === 504) {
      statusFromError = 504;
    } else if (
      statusFromError === 503 ||
      rawMsg.includes("503") ||
      rawMsg.includes("UNAVAILABLE") ||
      lowerMsg.includes("high demand") ||
      lowerMsg.includes("overloaded")
    ) {
      statusFromError = 503;
    } else if (
      statusFromError === 429 ||
      rawMsg.includes("429") ||
      rawMsg.includes("RESOURCE_EXHAUSTED") ||
      lowerMsg.includes("quota") ||
      lowerMsg.includes("rate limit")
    ) {
      statusFromError = 429;
    } else if (
      statusFromError === 401 ||
      statusFromError === 403 ||
      rawMsg.includes("401") ||
      rawMsg.includes("403") ||
      lowerMsg.includes("api key") ||
      lowerMsg.includes("api_key_invalid") ||
      lowerMsg.includes("permission_denied") ||
      lowerMsg.includes("unauthenticated")
    ) {
      statusFromError = 401;
    } else if (statusFromError === 400 || rawMsg.includes("400") || lowerMsg.includes("invalid argument")) {
      statusFromError = 400;
    }

    console.error("AI RESPONSE STATUS:", statusFromError, {
      model: usedModel,
      attemptNumber,
      errorMessage: rawMsg,
    });

    return res.status(statusFromError).json({
      success: false,
      error: "AI_ANALYSIS_UNAVAILABLE",
      status: statusFromError === 503 ? "UNAVAILABLE" : "AI_ANALYSIS_FAILED",
      result: "AI_ANALYSIS_FAILED",
      errorCode: statusFromError,
      errorCategory:
        statusFromError === 503
          ? "Temporary service unavailable"
          : statusFromError === 429
          ? "Rate limit"
          : statusFromError === 401 || statusFromError === 403
          ? "API key/authentication problem"
          : statusFromError === 504
          ? "Timeout"
          : "AI service error",
      message: "AI service is temporarily unavailable. Please retry.",
      detail: rawMsg,
    });
  }

  try {
    const rawText = (response.text || "").trim();
    console.log("AI RESPONSE STATUS:", 200);
    console.log("AI RESPONSE RECEIVED:", rawText);

    let cleanedJsonText = rawText
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    const firstBrace = cleanedJsonText.indexOf("{");
    const lastBrace = cleanedJsonText.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      cleanedJsonText = cleanedJsonText.slice(firstBrace, lastBrace + 1);
    }

    let parsed: any;
    try {
      parsed = JSON.parse(cleanedJsonText);
    } catch (parseErr: any) {
      console.error("[AI Waste Analysis] JSON Parse failure:", parseErr?.message, "Raw:", rawText);
      return res.status(422).json({
        success: false,
        error: "AI_ANALYSIS_UNAVAILABLE",
        status: "AI_ANALYSIS_FAILED",
        result: "AI_ANALYSIS_FAILED",
        errorCode: 422,
        errorCategory: "Response parse error",
        message: "AI service is temporarily unavailable. Please retry.",
      });
    }

    const humanDetected = Boolean(parsed.humanDetected);
    const isGarbage = parsed.isGarbage !== undefined ? Boolean(parsed.isGarbage) : true;
    const objectLabel = String(parsed.object || "").trim() || "Waste item";

    const normalizedResult = normalizeCategoryResult(
      parsed.result,
      objectLabel,
      humanDetected,
      isGarbage
    );

    if (!normalizedResult) {
      return res.status(422).json({
        success: false,
        error: "AI_ANALYSIS_UNAVAILABLE",
        status: "AI_ANALYSIS_FAILED",
        result: "AI_ANALYSIS_FAILED",
        errorCode: 422,
        errorCategory: "Unrecognized classification category",
        message: "AI service is temporarily unavailable. Please retry.",
      });
    }

    let normalizedConfidence = Number(parsed.confidence);
    if (Number.isNaN(normalizedConfidence)) {
      normalizedConfidence = 0.85;
    } else if (normalizedConfidence > 1) {
      normalizedConfidence = normalizedConfidence / 100;
    }
    normalizedConfidence = Math.max(0, Math.min(1, normalizedConfidence));

    // Rule 7: Clear person is the main subject and no garbage is visible
    const isHumanOnly =
      normalizedResult === "HUMAN_DETECTED" || (humanDetected && !isGarbage);

    if (isHumanOnly) {
      const humanPayload = {
        success: false,
        error: "HUMAN_DETECTED",
        status: "HUMAN_DETECTED",
        model: usedModel,
        result: "HUMAN_DETECTED" as const,
        wasteType: "Human Detected",
        object: objectLabel,
        confidence: normalizedConfidence,
        humanDetected: true,
        garbageDetected: false,
        isGarbage: false,
        message: "Please capture a clear image of the garbage.",
        reason: String(parsed.reason || "").trim() || "Please capture a clear image of the garbage.",
      };
      console.log("AI PARSE SUCCESS:", humanPayload);
      return res.status(200).json(humanPayload);
    }

    const finalResult: AllowedResultEnum = normalizedResult;
    const finalIsGarbage = finalResult !== "NOT_WASTE" && isGarbage;
    const displayWasteType = WASTE_TYPE_DISPLAY_LABELS[finalResult] || "Other";

    const responsePayload = {
      success: finalIsGarbage,
      status: "OK",
      model: usedModel,
      wasteType: displayWasteType,
      result: finalResult,
      object: objectLabel,
      confidence: normalizedConfidence,
      humanDetected: false,
      garbageDetected: finalIsGarbage,
      isGarbage: finalIsGarbage,
      message: finalIsGarbage
        ? `${displayWasteType} waste detected`
        : String(parsed.reason || "No clear garbage detected in the image."),
      reason:
        String(parsed.reason || "").trim() ||
        (finalIsGarbage ? `${displayWasteType} waste detected` : "No clear garbage detected."),
    };

    console.log("AI PARSE SUCCESS:", responsePayload);

    return res.status(200).json(responsePayload);
  } catch (unexpectedErr: any) {
    console.error("[AI Waste Analysis] Unexpected processing error:", unexpectedErr);
    return res.status(500).json({
      success: false,
      error: "AI_ANALYSIS_UNAVAILABLE",
      status: "AI_ANALYSIS_FAILED",
      result: "AI_ANALYSIS_FAILED",
      errorCode: 500,
      errorCategory: "AI processing error",
      message: "AI service is temporarily unavailable. Please retry.",
    });
  }
});

// Catch-all for any unknown /api/* route so it ALWAYS returns valid JSON and never HTML
app.all("/api/*all", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  return res.status(404).json({
    success: false,
    error: "API_ENDPOINT_NOT_FOUND",
    message: `API endpoint ${req.method} ${req.originalUrl} not found.`,
  });
});

// Express error handler for malformed JSON bodies or payload size errors on /api/*
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.path.startsWith("/api")) {
    res.setHeader("Content-Type", "application/json");
    return res.status(err?.status || 500).json({
      success: false,
      error: "AI_ANALYSIS_UNAVAILABLE",
      message: err?.message || "Invalid API request payload.",
    });
  }
  next(err);
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      if (req.path.startsWith("/api")) {
        res.setHeader("Content-Type", "application/json");
        return res.status(404).json({
          success: false,
          error: "API_NOT_FOUND",
          message: "API route not found.",
        });
      }
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT} (Primary Gemini Model: ${PRIMARY_MODEL})`);
  });
}

startServer();
