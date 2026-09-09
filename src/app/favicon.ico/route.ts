const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="16" fill="#b45309"/>
  <path d="M18 18h28v28H18z" fill="none" stroke="#fff7ed" stroke-width="4"/>
  <path d="M24 30h16M24 38h10" stroke="#fff7ed" stroke-width="4" stroke-linecap="round"/>
</svg>`;

export function GET() {
  return new Response(FAVICON, {
    headers: {
      "Cache-Control": "public, max-age=86400, immutable",
      "Content-Type": "image/svg+xml",
    },
  });
}
