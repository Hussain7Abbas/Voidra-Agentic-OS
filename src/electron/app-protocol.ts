import { existsSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { net, protocol } from "electron";

export function registerAppScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "app",
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false },
    },
  ]);
}

export function installAppProtocol(exportRoot: string) {
  protocol.handle("app", (request) => {
    const url = new URL(request.url);
    let relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    if (!relative) relative = "index.html";
    if (relative.endsWith("/")) relative += "index.html";
    if (!extname(relative)) {
      const nestedIndex = resolve(exportRoot, relative, "index.html");
      relative = existsSync(nestedIndex) ? `${relative}/index.html` : `${relative}.html`;
    }
    const candidate = resolve(exportRoot, relative);
    if (candidate !== exportRoot && !candidate.startsWith(`${exportRoot}${sep}`)) {
      return new Response("Not found", { status: 404 });
    }
    return net.fetch(pathToFileURL(candidate).toString());
  });
}
