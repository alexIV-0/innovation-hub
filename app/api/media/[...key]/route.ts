import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse, type NextRequest } from "next/server";
import { getS3Bucket, getS3Prefix } from "@/lib/s3-config";
import { getS3Client } from "@/lib/s3-client";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ key?: string[] }>;
};

const SIGNED_URL_TTL_SECONDS = 3600;

function decodeKey(segments: string[] | undefined): string | null {
  if (!segments || segments.length === 0) return null;
  const parts: string[] = [];
  for (const segment of segments) {
    if (!segment) continue;
    // Reject path-traversal attempts pre-decode and post-decode.
    if (segment.includes("..")) return null;
    try {
      const decoded = decodeURIComponent(segment);
      if (decoded.includes("..") || decoded.includes("/")) return null;
      parts.push(decoded);
    } catch {
      return null;
    }
  }
  const key = parts.join("/");
  return key ? key : null;
}

export async function GET(_request: NextRequest, { params }: Params) {
  const key = decodeKey((await params).key);
  if (!key) {
    return NextResponse.json({ message: "Invalid media key." }, { status: 400 });
  }

  // Hard-scope the proxy to objects under our configured prefix. Without this,
  // any caller could mint a signed URL for any object in the bucket — including
  // siblings owned by other tenants/apps sharing the same bucket.
  const expectedPrefix = `${getS3Prefix()}/`;
  if (!key.startsWith(expectedPrefix)) {
    return NextResponse.json({ message: "Not found." }, { status: 404 });
  }

  try {
    const bucket = getS3Bucket();
    const client = getS3Client();
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    const signedGetUrl = await getSignedUrl(client, command, {
      expiresIn: SIGNED_URL_TTL_SECONDS,
    });
    const response = NextResponse.redirect(signedGetUrl, { status: 307 });
    // Allow shared CDN/browser caching of the redirect for a fraction of the
    // signed-URL TTL so we don't re-sign on every range request from <video>.
    response.headers.set("Cache-Control", `public, max-age=${Math.floor(SIGNED_URL_TTL_SECONDS / 2)}, must-revalidate`);
    return response;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unable to open media.";
    return NextResponse.json({ message: msg }, { status: 502 });
  }
}

export async function HEAD(request: NextRequest, context: Params) {
  return GET(request, context);
}
