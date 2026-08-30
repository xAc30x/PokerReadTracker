import { createPairingCode } from "@/lib/mobile-auth";

export const dynamic = "force-dynamic";

const OWNER_HEADER = "oai-authenticated-user-email";

export async function POST(request: Request) {
  const owner = request.headers.get(OWNER_HEADER)?.trim().toLowerCase();
  if (!owner) return Response.json({ error: "Sign in is required." }, { status: 401 });

  try {
    return Response.json(await createPairingCode(owner));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create pairing code.";
    return Response.json({ error: message }, { status: 500 });
  }
}
