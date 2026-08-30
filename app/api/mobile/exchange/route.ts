import { exchangePairingCode } from "@/lib/mobile-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { code?: string; deviceName?: string };
  try {
    body = (await request.json()) as { code?: string; deviceName?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body.code !== "string") {
    return Response.json({ error: "Pairing code is required." }, { status: 400 });
  }

  try {
    const result = await exchangePairingCode(body.code, typeof body.deviceName === "string" ? body.deviceName : "iPhone");
    if (!result) return Response.json({ error: "Invalid or expired pairing code." }, { status: 401 });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to pair device.";
    return Response.json({ error: message }, { status: 500 });
  }
}
