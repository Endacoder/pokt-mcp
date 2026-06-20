export const runtime = "nodejs";

/** Public WalletConnect project id — resolved at request time for Docker/runtime env. */
export async function GET() {
  const wcProjectId =
    process.env.NEXT_PUBLIC_WC_PROJECT_ID?.trim() ||
    process.env.WALLETCONNECT_PROJECT_ID?.trim() ||
    "";

  return Response.json({ wcProjectId });
}
