import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS);
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN;
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN;

export async function hashPassword(password: string): Promise<string> {
  return await bcrypt.hash(password, SALT_ROUNDS);
}

export async function comparePassword(password: string, hashedPassword: string): Promise<boolean> {
  return await bcrypt.compare(password, hashedPassword);
}

export function generateAccessToken(payload: object): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: (JWT_EXPIRES_IN) as jwt.SignOptions["expiresIn"] });
}

export function generateRefreshToken(payload: object): string {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET!, { expiresIn: (JWT_REFRESH_EXPIRES_IN) as jwt.SignOptions["expiresIn"] });
}

export function verifyAccessToken(token: string): jwt.JwtPayload | null {
  try {
    return jwt.verify(token, process.env.JWT_SECRET!) as jwt.JwtPayload;
  } catch {
    return null;
  }
}

export function verifyRefreshToken(token: string): jwt.JwtPayload | null {
  try {
    return jwt.verify(token, process.env.JWT_REFRESH_SECRET!) as jwt.JwtPayload;
  } catch {
    return null;
  }
}