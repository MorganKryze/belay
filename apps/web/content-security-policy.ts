import type { Plugin } from "vite";

// The iPhone app loads this page from its own bundle, where no server sends the policy header,
// so the page carries it. In a browser the server's stricter header applies as well. The app
// talks to an instance at any https address; a development build (BELAY_LOOPBACK=1) may also
// reach a server on this machine over http, which a release never needs. Build only: the dev
// server injects inline scripts. First in the head: a policy in a meta tag only covers what comes
// after it.
export const contentSecurityPolicy = (loopback: boolean): Plugin => ({
  name: "content-security-policy",
  apply: "build",
  transformIndexHtml: () => [
    {
      tag: "meta",
      attrs: {
        "http-equiv": "Content-Security-Policy",
        content: [
          "default-src 'self'",
          "script-src 'self'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob:",
          "media-src 'self' blob:",
          `connect-src 'self' https:${loopback ? " http://localhost:* http://127.0.0.1:*" : ""}`,
          "worker-src 'self'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join("; "),
      },
      injectTo: "head-prepend",
    },
  ],
});
