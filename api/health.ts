export function GET(): Response {
  return new Response(
    JSON.stringify({
      ok: true,
      runtime: 'vercel-serverless',
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    },
  );
}
