import { prisma } from "@/prisma/db";
import { hashPassword } from "@/lib/auth";
import { getCacheJson, setCacheJson } from "@/lib/redisCache";
import {
  SYSTEM_USER_AVATAR,
  SYSTEM_USER_EMAIL,
  SYSTEM_USER_USERNAME,
} from "@/lib/systemUser";

const HF_API_KEY = process.env.HUGGINGFACE_API_KEY;

const TOXICITY_MODEL = "unitary/multilingual-toxic-xlm-roberta";
const TOXICITY_THRESHOLD = 0.75;
const SENTIMENT_MODEL = "cardiffnlp/twitter-roberta-base-sentiment";
const TRANSLATION_MODEL = "Helsinki-NLP/opus-mt-mul-en";
const DIGEST_MODEL = "facebook/bart-large-cnn";
const MODERATION_TEXT_LIMIT = 1500;
const MINUTE_MS = 60 * 1000;
const AI_AUTO_FLAG_PREFIX = "Auto-flagged by AI";

function getPositiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = Number.parseInt(String(raw || ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const AI_CACHE_TTL_MS = {
  toxicity: getPositiveIntFromEnv("AI_CACHE_TTL_TOXICITY_MS", 30 * MINUTE_MS),
  sentiment: getPositiveIntFromEnv("AI_CACHE_TTL_SENTIMENT_MS", 30 * MINUTE_MS),
  translation: getPositiveIntFromEnv("AI_CACHE_TTL_TRANSLATION_MS", 24 * 60 * MINUTE_MS),
  digest: getPositiveIntFromEnv("AI_CACHE_TTL_DIGEST_MS", 30 * MINUTE_MS),
};

const inFlightCache = new Map<string, Promise<unknown>>();

async function readCache<T>(key: string): Promise<T | null> {
  return getCacheJson<T>(`ai:${key}`);
}

async function writeCache(key: string, value: unknown, ttlMs: number) {
  await setCacheJson(`ai:${key}`, value, ttlMs);
}

async function withCache<T>(key: string, ttlMs: number, factory: () => Promise<T>) {
  const cached = await readCache<T>(key);
  if (cached !== null) {
    return cached;
  }

  const existing = inFlightCache.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const promise = factory()
    .then(async (value) => {
      await writeCache(key, value, ttlMs);
      return value;
    })
    .finally(() => {
      inFlightCache.delete(key);
    });

  inFlightCache.set(key, promise as Promise<unknown>);
  return promise;
}

export async function checkToxicity(text: string) {
  const normalizedText = text?.trim() || "";

  return withCache(
    `toxicity:${normalizedText}`,
    AI_CACHE_TTL_MS.toxicity,
    async () => {
      if (!HF_API_KEY) {
        return {
          isToxic: false,
          score: 0,
          available: false,
          error: "HUGGINGFACE_API_KEY is not configured",
        };
      }

      try {
        const response = await fetch(
          `https://router.huggingface.co/hf-inference/models/${TOXICITY_MODEL}`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${HF_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ inputs: normalizedText }),
          }
        );

        if (!response.ok) {
          console.error("Hugging Face API error:", response.status);
          return {
            isToxic: false,
            score: 0,
            available: false,
            error: `Hugging Face API error: ${response.status}`,
          };
        }

        const result = await response.json();
        const toxicScore = extractToxicityScore(result);

        return {
          isToxic: toxicScore >= TOXICITY_THRESHOLD,
          score: toxicScore,
          available: true,
          error: null,
        };
      } catch (error) {
        console.error("Toxicity check failed:", error);
        return {
          isToxic: false,
          score: 0,
          available: false,
          error: "Toxicity check failed",
        };
      }
    }
  );
}

function describeToxicityBand(score: number) {
  if (score >= 0.9) return "very high";
  if (score >= TOXICITY_THRESHOLD) return "high";
  if (score >= 0.5) return "moderate";
  if (score >= 0.2) return "low";
  return "very low";
}

export async function getModerationVerdict(
  text: string,
  { contentType = "content" }: { contentType?: string } = {}
) {
  const normalizedText = text?.trim();

  if (!normalizedText) {
    return {
      available: false,
      verdict: "UNAVAILABLE",
      isInappropriate: null,
      toxicityScore: null,
      threshold: TOXICITY_THRESHOLD,
      model: TOXICITY_MODEL,
      explanation: `No ${contentType} text was available for AI review.`,
    };
  }

  const toxicity = await checkToxicity(normalizedText);

  if (!toxicity.available) {
    return {
      available: false,
      verdict: "UNAVAILABLE",
      isInappropriate: null,
      toxicityScore: null,
      threshold: TOXICITY_THRESHOLD,
      model: TOXICITY_MODEL,
      explanation: toxicity.error || "AI moderation is currently unavailable.",
    };
  }

  const roundedScore = Number(toxicity.score.toFixed(3));
  const band = describeToxicityBand(toxicity.score);

  if (toxicity.isToxic) {
    return {
      available: true,
      verdict: "LIKELY_INAPPROPRIATE",
      isInappropriate: true,
      toxicityScore: roundedScore,
      threshold: TOXICITY_THRESHOLD,
      model: TOXICITY_MODEL,
      explanation: `The AI flagged this ${contentType} as likely inappropriate because the toxicity score is ${roundedScore}, which is above the ${TOXICITY_THRESHOLD} threshold and falls in the ${band} range.`,
    };
  }

  if (toxicity.score >= 0.5) {
    return {
      available: true,
      verdict: "REVIEW_RECOMMENDED",
      isInappropriate: false,
      toxicityScore: roundedScore,
      threshold: TOXICITY_THRESHOLD,
      model: TOXICITY_MODEL,
      explanation: `The AI did not cross the auto-flag threshold, but the ${contentType} has a ${band} toxicity score of ${roundedScore}, so a manual review is still recommended.`,
    };
  }

  return {
    available: true,
    verdict: "LIKELY_APPROPRIATE",
    isInappropriate: false,
    toxicityScore: roundedScore,
    threshold: TOXICITY_THRESHOLD,
    model: TOXICITY_MODEL,
    explanation: `The AI considers this ${contentType} likely appropriate because the toxicity score is ${roundedScore}, which is in the ${band} range and below the ${TOXICITY_THRESHOLD} threshold.`,
  };
}

function normalizeModerationLabel(label: string) {
  return String(label || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function matchesModerationToken(label: string, token: string) {
  if (label === token) {
    return true;
  }

  const labelParts = label.split("_").filter(Boolean);
  const tokenParts = token.split("_").filter(Boolean);

  if (tokenParts.length === 1) {
    return labelParts.includes(token);
  }

  return false;
}

function flattenLabelScores(result: unknown): { label: string; score: number }[] {
  if (Array.isArray(result)) {
    if (
      result.length > 0 &&
      Array.isArray(result[0]) &&
      (result[0] as unknown[]).every(
        (entry) =>
          typeof entry === "object" &&
          entry !== null &&
          "label" in (entry as Record<string, unknown>) &&
          "score" in (entry as Record<string, unknown>)
      )
    ) {
      return (result[0] as Record<string, unknown>[])
        .filter((entry) => typeof entry.label === "string" && typeof entry.score === "number")
        .map((entry) => ({ label: String(entry.label), score: Number(entry.score) }));
    }

    if (
      result.every(
        (entry) =>
          typeof entry === "object" &&
          entry !== null &&
          "label" in (entry as Record<string, unknown>) &&
          "score" in (entry as Record<string, unknown>)
      )
    ) {
      return (result as Record<string, unknown>[])
        .filter((entry) => typeof entry.label === "string" && typeof entry.score === "number")
        .map((entry) => ({ label: String(entry.label), score: Number(entry.score) }));
    }
  }

  if (
    typeof result === "object" &&
    result !== null &&
    "label" in (result as Record<string, unknown>) &&
    "score" in (result as Record<string, unknown>)
  ) {
    const entry = result as Record<string, unknown>;
    if (typeof entry.label === "string" && typeof entry.score === "number") {
      return [{ label: entry.label, score: entry.score }];
    }
  }

  return [];
}

function extractToxicityScore(result: unknown) {
  const scores = flattenLabelScores(result);
  if (scores.length === 0) {
    return 0;
  }

  const harmfulTokens = [
    "toxic",
    "toxicity",
    "severe_toxic",
    "obscene",
    "threat",
    "insult",
    "identity_hate",
    "hate",
    "offensive",
    "abusive",
    "abuse",
    "harassment",
    "sexual_explicit",
    "violent",
    "violence",
    "racist",
    "sexist",
    "homophobic",
    "transphobic",
    "label_1",
  ];
  const benignTokens = [
    "non_toxic",
    "not_toxic",
    "acceptable",
    "neutral",
    "safe",
    "clean",
    "label_0",
  ];

  const normalizedScores = scores.map((entry) => ({
    ...entry,
    normalizedLabel: normalizeModerationLabel(entry.label),
  }));

  const harmfulScores = normalizedScores
    .filter((entry) => {
      const isBenign = benignTokens.some((token) => matchesModerationToken(entry.normalizedLabel, token));
      return !isBenign && harmfulTokens.some((token) => matchesModerationToken(entry.normalizedLabel, token));
    })
    .map((entry) => entry.score);

  if (harmfulScores.length > 0) {
    return Math.max(...harmfulScores);
  }

  if (normalizedScores.length === 2) {
    const nonBenign = normalizedScores.filter(
      (entry) => !benignTokens.some((token) => matchesModerationToken(entry.normalizedLabel, token))
    );
    if (nonBenign.length === 1) {
      return nonBenign[0].score;
    }
  }

  const topScore = normalizedScores.reduce(
    (current, entry) => (entry.score > current.score ? entry : current),
    normalizedScores[0]
  );

  if (benignTokens.some((token) => matchesModerationToken(topScore.normalizedLabel, token))) {
    return 0;
  }

  return topScore.score;
}

export function buildThreadModerationText({
  title,
  body,
  pollQuestion,
  pollOptions = [],
}: {
  title?: string | null;
  body?: string | null;
  pollQuestion?: string | null;
  pollOptions?: string[];
}) {
  return [
    title?.trim() || null,
    body?.trim() || null,
    pollQuestion?.trim() || null,
    pollOptions.length > 0 ? `Poll options:\n${pollOptions.join("\n")}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function getModerationSystemUserId() {
  const passwordHash = await hashPassword(`system-${Date.now()}`);
  const systemUser = await prisma.user.upsert({
    where: { email: SYSTEM_USER_EMAIL },
    update: {
      username: SYSTEM_USER_USERNAME,
      avatar: SYSTEM_USER_AVATAR,
      role: "USER",
      status: "ACTIVE",
    },
    create: {
      email: SYSTEM_USER_EMAIL,
      username: SYSTEM_USER_USERNAME,
      passwordHash,
      avatar: SYSTEM_USER_AVATAR,
      role: "USER",
      status: "ACTIVE",
    },
    select: { id: true },
  });

  return systemUser.id;
}

function buildAutoFlagReason({
  verdict,
  contentType,
  source,
}: {
  verdict: Awaited<ReturnType<typeof getModerationVerdict>>;
  contentType: string;
  source: string;
}) {
  return [
    `${AI_AUTO_FLAG_PREFIX} for ${contentType}`,
    `source: ${source}`,
    `model: ${verdict.model}`,
    `toxicity score: ${verdict.toxicityScore ?? "n/a"}`,
    verdict.explanation,
  ].join("; ");
}

export async function syncAutoModerationReport({
  targetType,
  postId,
  threadId,
  text,
  contentType,
  source,
}: {
  targetType: "POST" | "THREAD";
  postId?: number;
  threadId?: number;
  text: string;
  contentType: string;
  source: string;
}) {
  const verdict = await getModerationVerdict(text, { contentType });
  const reporterId = await getModerationSystemUserId();
  if ((targetType === "POST" && !postId) || (targetType === "THREAD" && !threadId)) {
    return verdict;
  }
  const targetWhere = targetType === "POST" ? { postId: postId as number } : { threadId: threadId as number };

  const pendingAiReportWhere = {
    reporterId,
    targetType,
    status: "PENDING" as const,
    reason: { startsWith: AI_AUTO_FLAG_PREFIX },
    ...targetWhere,
  };

  if (verdict.isInappropriate) {
    const existingReport = await prisma.report.findFirst({
      where: pendingAiReportWhere,
      select: { id: true },
    });
    const reason = buildAutoFlagReason({ verdict, contentType, source });

    if (existingReport) {
      await prisma.report.update({
        where: { id: existingReport.id },
        data: { reason },
      });
    } else {
      await prisma.report.create({
        data: {
          reporterId,
          targetType,
          reason,
          ...targetWhere,
        },
      });
    }
  } else {
    await prisma.report.updateMany({
      where: pendingAiReportWhere,
      data: {
        status: "DISMISSED",
        reason: `${AI_AUTO_FLAG_PREFIX} cleared after re-evaluation; source: ${source}; model: ${verdict.model}; toxicity score: ${verdict.toxicityScore ?? "n/a"}`,
      },
    });
  }

  return verdict;
}

export async function prepareTextForModeration(text: string) {
  const normalizedText = text?.trim();

  if (!normalizedText) {
    return {
      originalText: "",
      truncatedText: "",
      translatedText: null,
      textForToxicity: "",
      wasTruncated: false,
      usedTranslation: false,
    };
  }

  const truncatedText = normalizedText.slice(0, MODERATION_TEXT_LIMIT);
  const translatedText = await translateToEnglish(truncatedText);

  return {
    originalText: normalizedText,
    truncatedText,
    translatedText,
    textForToxicity: translatedText?.trim() || truncatedText,
    wasTruncated: normalizedText.length > MODERATION_TEXT_LIMIT,
    usedTranslation: Boolean(translatedText?.trim()),
  };
}

export async function checkToxicityWithTranslation(text: string) {
  const moderationInput = await prepareTextForModeration(text);

  if (!moderationInput.textForToxicity) {
    return {
      isToxic: false,
      score: 0,
      available: false,
      error: "No text available for toxicity check",
      ...moderationInput,
    };
  }

  const toxicity = await checkToxicity(moderationInput.textForToxicity);

  return {
    ...toxicity,
    ...moderationInput,
  };
}

async function analyzeSingleSentiment(text: string) {
  const normalizedText = text?.trim() || "";
  const cacheKey = `sentiment:v2:${normalizedText}`;

  function normalizeSentimentResponse(result: unknown) {
    const normalized = flattenLabelScores(result);
    if (normalized.length > 0) {
      return normalized;
    }

    return [{ label: "LABEL_1", score: 1 }];
  }

  return withCache(cacheKey, AI_CACHE_TTL_MS.sentiment, async () => {
    if (!normalizedText) {
      return [{ label: "LABEL_1", score: 1 }];
    }

    if (!HF_API_KEY) {
      return [{ label: "LABEL_1", score: 1 }];
    }

    try {
      const response = await fetch(
        `https://router.huggingface.co/hf-inference/models/${SENTIMENT_MODEL}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${HF_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ inputs: normalizedText }),
        }
      );

      if (!response.ok) {
        console.error("Hugging Face sentiment error:", response.status);
        return [{ label: "LABEL_1", score: 1 }];
      }

      return normalizeSentimentResponse(await response.json());
    } catch (error) {
      console.error("Sentiment analysis failed:", error);
      return [{ label: "LABEL_1", score: 1 }];
    }
  });
}

export async function analyzeSentiment(texts: string | string[]) {
  if (Array.isArray(texts)) {
    return Promise.all(texts.map((text) => analyzeSingleSentiment(text)));
  }

  return analyzeSingleSentiment(texts);
}

export async function translateToEnglish(text: string) {
  const normalizedText = text?.trim() || "";

  return withCache(
    `translation:${normalizedText}`,
    AI_CACHE_TTL_MS.translation,
    async () => {
      try {
        const response = await fetch(
          `https://router.huggingface.co/hf-inference/models/${TRANSLATION_MODEL}`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${HF_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ inputs: normalizedText }),
          }
        );

        if (!response.ok) {
          console.error("Translation API error:", response.status);
          return null;
        }

        const result = await response.json();
        return result?.[0]?.translation_text || null;
      } catch (error) {
        console.error("Translation failed:", error);
        return null;
      }
    }
  );
}

export async function generateDigest(prompt: string) {
  const normalizedPrompt = prompt?.trim() || "";

  return withCache(
    `digest:${normalizedPrompt}`,
    AI_CACHE_TTL_MS.digest,
    async () => {
      try {
        const response = await fetch(
          `https://router.huggingface.co/hf-inference/models/${DIGEST_MODEL}`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${HF_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              inputs: normalizedPrompt,
              parameters: { max_new_tokens: 500, temperature: 0.7 },
            }),
          }
        );

        if (!response.ok) {
          console.error("Digest generation error:", response.status);
          return null;
        }

        const result = await response.json();
        return result?.[0]?.summary_text || result?.[0]?.generated_text || null;
      } catch (error) {
        console.error("Digest generation failed:", error);
        return null;
      }
    }
  );
}
