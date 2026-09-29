import { OAuth2Server } from "oauth2-mock-server";

export async function startIdp() {
  const idp = new OAuth2Server();
  await idp.issuer.keys.generate("RS256");
  await idp.start(0, "localhost");
  return idp;
}
