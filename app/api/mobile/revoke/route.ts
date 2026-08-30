import { revokeBearerSession } from "@/lib/mobile-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const revoked = await revokeBearerSession(request);
    if (!revoked) return Response.json({ error: "Invalid mobile session." }, { status: 401 });
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to revoke mobile session.";
    return Response.json({ error: message }, { status: 500 });
  }
}
