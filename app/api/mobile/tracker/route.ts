import { GET as trackerGET, POST as trackerPOST } from "@/app/api/tracker/route";
import { resolveBearerOwner } from "@/lib/mobile-auth";

export const dynamic = "force-dynamic";

const OWNER_HEADER = "oai-authenticated-user-email";

async function authorizedRequest(request: Request) {
  const session = await resolveBearerOwner(request);
  if (!session) return null;

  const headers = new Headers(request.headers);
  headers.set(OWNER_HEADER, session.ownerKey);
  headers.delete("authorization");

  if (request.method === "GET" || request.method === "HEAD") {
    return new Request(request.url, { method: request.method, headers });
  }

  const body = await request.text();
  return new Request(request.url, { method: request.method, headers, body });
}

export async function GET(request: Request) {
  try {
    const delegated = await authorizedRequest(request);
    if (!delegated) return Response.json({ error: "Invalid mobile session." }, { status: 401 });
    return trackerGET(delegated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load tracker.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const delegated = await authorizedRequest(request);
    if (!delegated) return Response.json({ error: "Invalid mobile session." }, { status: 401 });
    return trackerPOST(delegated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save tracker change.";
    return Response.json({ error: message }, { status: 500 });
  }
}
