import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { config, s3Configured } from "../config.js";

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function hashHex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function amzDate(d = new Date()): { amz: string; day: string } {
  const iso = d.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amz: iso, day: iso.slice(0, 8) };
}

function endpointHost(): { base: string; host: string; pathStyle: boolean } {
  const endpoint = config.s3.endpoint.replace(/\/$/, "");
  const u = new URL(endpoint.includes("://") ? endpoint : `http://${endpoint}`);
  return {
    base: `${u.protocol}//${u.host}`,
    host: u.host,
    pathStyle: config.s3.forcePathStyle,
  };
}

function signingKey(
  secret: string,
  day: string,
  region: string,
  service: string
): Buffer {
  const kDate = hmac(`AWS4${secret}`, day);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

/**
 * Upload object via SigV4 PutObject (MinIO / S3 compatible).
 */
export async function putObject(
  key: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  if (!s3Configured()) throw new Error("S3 not configured (HERMES_S3_*)");
  const { base, host, pathStyle } = endpointHost();
  const bucket = config.s3.bucket;
  const region = config.s3.region || "us-east-1";
  const { amz, day } = amzDate();
  const canonicalUri = pathStyle
    ? `/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`
    : `/${key.split("/").map(encodeURIComponent).join("/")}`;
  const payloadHash = hashHex(body);
  const headers: Record<string, string> = {
    host: pathStyle ? host : `${bucket}.${host}`,
    "content-type": contentType,
    "content-length": String(body.length),
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amz,
  };
  const signedHeaderKeys = Object.keys(headers).sort();
  const signedHeaders = signedHeaderKeys.join(";");
  const canonicalHeaders = signedHeaderKeys
    .map((k) => `${k}:${headers[k]}\n`)
    .join("");
  const canonicalRequest = [
    "PUT",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${day}/${region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amz,
    credentialScope,
    hashHex(canonicalRequest),
  ].join("\n");
  const sig = hmac(
    signingKey(config.s3.secretKey, day, region, "s3"),
    stringToSign
  ).toString("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${sig}`;

  const url = pathStyle
    ? `${base}/${bucket}/${key}`
    : `${uProtocol(base)}://${bucket}.${host}/${key}`;
  const res = await fetch(url, {
    method: "PUT",
    headers,
    body: new Uint8Array(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`S3 PutObject ${res.status}: ${text.slice(0, 200)}`);
  }
}

function uProtocol(base: string): string {
  return base.startsWith("https") ? "https" : "http";
}

/** Presigned GET URL (query-string SigV4). */
export function presignGetUrl(key: string, expiresSec: number): string {
  if (!s3Configured()) throw new Error("S3 not configured (HERMES_S3_*)");
  const { base, host, pathStyle } = endpointHost();
  const bucket = config.s3.bucket;
  const region = config.s3.region || "us-east-1";
  const { amz, day } = amzDate();
  const credentialScope = `${day}/${region}/s3/aws4_request`;
  const credential = `${config.s3.accessKey}/${credentialScope}`;
  const canonicalUri = pathStyle
    ? `/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`
    : `/${key.split("/").map(encodeURIComponent).join("/")}`;
  const qs: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": credential,
    "X-Amz-Date": amz,
    "X-Amz-Expires": String(Math.max(60, expiresSec)),
    "X-Amz-SignedHeaders": "host",
  };
  const canonicalQuery = Object.keys(qs)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(qs[k]!)}`)
    .join("&");
  const hostHeader = pathStyle ? host : `${bucket}.${host}`;
  const canonicalRequest = [
    "GET",
    canonicalUri,
    canonicalQuery,
    `host:${hostHeader}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amz,
    credentialScope,
    hashHex(canonicalRequest),
  ].join("\n");
  const signature = hmac(
    signingKey(config.s3.secretKey, day, region, "s3"),
    stringToSign
  ).toString("hex");
  const urlBase = pathStyle
    ? `${base}/${bucket}/${key}`
    : `${uProtocol(base)}://${bucket}.${host}/${key}`;
  return `${urlBase}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export function traceObjectKey(jobId: string, when = new Date()): string {
  const y = when.getUTCFullYear();
  const m = String(when.getUTCMonth() + 1).padStart(2, "0");
  const id = (jobId || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  return `hermes/traces/${y}/${m}/${id}.zip`;
}

export async function uploadTraceZip(
  localPath: string,
  jobId: string
): Promise<{ traceUrl: string; traceObjectKey: string }> {
  const key = traceObjectKey(jobId);
  const body = await readFile(localPath);
  await putObject(key, body, "application/zip");
  const traceUrl = presignGetUrl(key, config.s3.urlTtlSec || 86400);
  return { traceUrl, traceObjectKey: key };
}
