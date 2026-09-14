// Vercel Edge Middleware — gates every request behind HTTP Basic Auth,
// including /api/* (so generation can't be triggered without the site
// password either). Framework-agnostic: Vercel runs this on the Edge
// Network before serving any request, as long as it's a `middleware.js`
// at the root of the deployed project (this directory, web/).
//
// Reads SITE_USER / SITE_PASSWORD from the Vercel project's environment
// variables (Project Settings → Environment Variables) — never hardcode
// the password here.

export const config = {
  matcher: "/((?!_vercel/).*)",
};

function unauthorized() {
  return new Response("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Story Engine"' },
  });
}

export default function middleware(request) {
  const expectedUser = process.env.SITE_USER || "yan";
  const expectedPass = process.env.SITE_PASSWORD;

  if (!expectedPass) {
    // Misconfigured deploy (no password set) — fail closed rather than open.
    return unauthorized();
  }

  const header = request.headers.get("authorization");
  if (!header || !header.startsWith("Basic ")) {
    return unauthorized();
  }

  let decoded;
  try {
    decoded = atob(header.slice("Basic ".length));
  } catch {
    return unauthorized();
  }
  const sep = decoded.indexOf(":");
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);

  if (user !== expectedUser || pass !== expectedPass) {
    return unauthorized();
  }
  // Falls through — request proceeds to the static file.
}
