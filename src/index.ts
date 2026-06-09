// cf-flickr-proxy — rust-flickr (Cloud Run) を front に公開する
// REST proxy / CORS edge Worker。Refs ippoan/cf-flickr-proxy#1

import type { Env } from "./env";
import { handleRequest } from "./proxy";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
} satisfies ExportedHandler<Env>;
