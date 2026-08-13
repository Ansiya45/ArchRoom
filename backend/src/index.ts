import { createHTTPServer } from '@trpc/server/adapters/standalone';
import { createContext } from './trpc/context.js';
import { appRouter } from './trpc/router.js';

const port = Number(process.env.PORT || 3001);

const server = createHTTPServer({
  router: appRouter,
  createContext,
});

server.listen(port, () => {
  console.log(`ArchRoom tRPC backend listening on http://localhost:${port}`);
});
