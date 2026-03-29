import net from "node:net";

type RedisScalar = string | number | null;

type ParsedRedisValue =
  | { value: RedisScalar; nextOffset: number }
  | { error: Error; nextOffset: number };

const REDIS_TIMEOUT_MS = 5000;

function getRedisConfig() {
  const raw = process.env.REDIS_URL?.trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    return {
      host: url.hostname,
      port: url.port ? Number(url.port) : 6379,
      password: url.password || null,
    };
  } catch (error) {
    console.error("Invalid REDIS_URL:", error);
    return null;
  }
}

function encodeRedisCommand(parts: string[]) {
  return `*${parts.length}\r\n${parts
    .map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`)
    .join("")}`;
}

function parseRedisResponse(buffer: Buffer, offset = 0): ParsedRedisValue | null {
  if (offset >= buffer.length) return null;

  const prefix = String.fromCharCode(buffer[offset]);
  const lineEnd = buffer.indexOf("\r\n", offset);
  if (lineEnd === -1) return null;

  const line = buffer.toString("utf8", offset + 1, lineEnd);
  const nextLineOffset = lineEnd + 2;

  if (prefix === "+") {
    return { value: line, nextOffset: nextLineOffset };
  }

  if (prefix === "-") {
    return { error: new Error(line), nextOffset: nextLineOffset };
  }

  if (prefix === ":") {
    return { value: Number.parseInt(line, 10), nextOffset: nextLineOffset };
  }

  if (prefix === "$") {
    const length = Number.parseInt(line, 10);
    if (length === -1) {
      return { value: null, nextOffset: nextLineOffset };
    }

    const payloadEnd = nextLineOffset + length;
    if (buffer.length < payloadEnd + 2) return null;

    const value = buffer.toString("utf8", nextLineOffset, payloadEnd);
    return {
      value,
      nextOffset: payloadEnd + 2,
    };
  }

  return {
    error: new Error(`Unsupported Redis response prefix: ${prefix}`),
    nextOffset: nextLineOffset,
  };
}

async function sendRedisCommand(command: string[]): Promise<RedisScalar> {
  const config = getRedisConfig();
  if (!config) return null;

  return new Promise<RedisScalar>((resolve, reject) => {
    const socket = net.createConnection({
      host: config.host,
      port: config.port,
    });

    let settled = false;
    let awaitingAuth = Boolean(config.password);
    let buffer = Buffer.alloc(0);

    const finish = (handler: () => void) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.end();
      handler();
    };

    socket.setTimeout(REDIS_TIMEOUT_MS);

    socket.on("connect", () => {
      if (config.password) {
        socket.write(encodeRedisCommand(["AUTH", config.password]));
        return;
      }

      socket.write(encodeRedisCommand(command));
    });

    socket.on("timeout", () => {
      finish(() => reject(new Error("Redis connection timed out")));
    });

    socket.on("error", (error) => {
      finish(() => reject(error));
    });

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      while (true) {
        const parsed = parseRedisResponse(buffer);
        if (!parsed) return;

        buffer = buffer.subarray(parsed.nextOffset);

        if ("error" in parsed) {
          finish(() => reject(parsed.error));
          return;
        }

        if (awaitingAuth) {
          awaitingAuth = false;
          socket.write(encodeRedisCommand(command));
          continue;
        }

        finish(() => resolve(parsed.value));
        return;
      }
    });
  });
}

export async function getCacheJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await sendRedisCommand(["GET", key]);
    if (typeof raw !== "string") return null;
    return JSON.parse(raw) as T;
  } catch (error) {
    console.error("Redis GET failed:", error);
    return null;
  }
}

export async function setCacheJson(
  key: string,
  value: unknown,
  ttlMs: number
): Promise<boolean> {
  try {
    const response = await sendRedisCommand([
      "SET",
      key,
      JSON.stringify(value),
      "PX",
      String(ttlMs),
    ]);
    return response === "OK";
  } catch (error) {
    console.error("Redis SET failed:", error);
    return false;
  }
}
