import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";
import { isPublicAuthRequest } from "@/lib/auth-public-surface.ts";

const handlers = toNextJsHandler(auth);

function refused(): Response {
  return new Response("Not Found", {
    status: 404,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

async function forward(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", request: Request) {
  if (!isPublicAuthRequest(method, new URL(request.url).pathname)) return refused();
  return handlers[method](request);
}

export const GET = (request: Request) => forward("GET", request);
export const POST = (request: Request) => forward("POST", request);
export const PUT = (request: Request) => forward("PUT", request);
export const PATCH = (request: Request) => forward("PATCH", request);
export const DELETE = (request: Request) => forward("DELETE", request);
