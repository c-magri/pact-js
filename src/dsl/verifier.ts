/**
 * Provider Verifier service
 * @module ProviderVerifier
 */
import pact from "@pact-foundation/pact-node";
import { qToPromise } from "../common/utils";
import { VerifierOptions as PactNodeVerifierOptions } from "@pact-foundation/pact-node";
import { omit, isEmpty } from "lodash";
import * as express from "express";
import * as http from "http";
const HttpProxy = require('http-proxy');
import logger from "../common/logger";
import { isFunction } from "util";
// import serviceFactory from "@pact-foundation/pact-node";

const bodyParser = require("body-parser");

export interface ProviderState {
  states?: [ string ];
}

// export type RequestFilter = (req: any, res: any, next: any) => Promise<any>;
interface StateHandlers { [name: string]: (state: string) => Promise<any>; }

interface StateOptions {
  requestFilter?: express.RequestHandler;
  stateHandlers?: StateHandlers;
}

export type VerifierOptions = PactNodeVerifierOptions & StateOptions

export class Verifier {
  constructor(private config: VerifierOptions) {
    // TODO: properly set log level for verification process

    // if (config.logLevel && !isEmpty(config.logLevel) ) {
    //   serviceFactory.logLevel(config.logLevel);
    //   logger.level(config.logLevel);
    // } else {
    //   logger.level();
    // }
  }

  /**
   * Verify a HTTP Provider
   */
  public verifyProvider(): Promise<any> {
    logger.info("Verifying provider");

    // Start the verification CLI proxy server
    const app = this.setupProxyApplication();
    const server = this.setupProxyServer(app);

    // Run the verification once the proxy server is available
    return this.waitForServerReady(server)
      .then(this.runProviderVerification())
      .then((result) => {
        server.close();
        return result;
      });
  }

  // Listens for the server start event
  // Converts event Emitter to a Promise
  private waitForServerReady(server: http.Server): Promise<http.Server> {
    return new Promise((resolve, reject) => {
      server.on("listening", () => resolve(server));
      server.on("error", () => reject());
    });
  }

  // Run the Verification CLI process
  private runProviderVerification() {
    return (server: http.Server) => {
      const opts = {
        ...omit(this.config, "handlers"),
        ...{ providerBaseUrl: "http://localhost:" + server.address().port },
        ...{ providerStatesSetupUrl: "http://localhost:" + server.address().port + "/setup" },
      } as VerifierOptions;

      // Run verification
      return qToPromise<any>(pact.verifyPacts(opts));
    };
  }

  // Get the API handler for the verification CLI process to invoke on POST /*
  // TODO: setup state handler middleware
  private setupStateHandler(req: express.Request, res: express.Response, next: express.NextFunction) {
      // Extract the message request from the API
      const message: ProviderState = req.body;

      // Invoke the handler, and return the JSON response body
      // wrapped in a Message
      this.setupStates(message)
        .then((o) => { next() })
        .catch((e) => res.status(500).send(e));
  }

  // Get the Proxy we'll pass to the CLI for verification
  private setupProxyServer( app: (request: http.IncomingMessage, response: http.ServerResponse) => void): http.Server {
    return http.createServer(app).listen();
  }

  // Get the Express app that will run on the HTTP Proxy
  private setupProxyApplication(): express.Express {
    const app = express();
    const proxy = new HttpProxy();

    // TODO: these should probably only go on the routes we intercept (e.g. /setup)
    //       ...make this path configurable / dynamic or on a separate port altogether
    app.use("/setup", bodyParser.json());
    app.use("/setup", bodyParser.urlencoded({ extended: true }));

    // Allow for request filtering
    if (this.config.requestFilter !== undefined) {
      app.use(this.config.requestFilter);
    }

    // TODO: Set this to simply run on a specific, pre-defined path
    //       ...possibly even run it on a different port to avoid conflicts??
    //       ...make this user configurable
    app.post("/setup", (req, res, next) => {
      const message: ProviderState = req.body;

      // Invoke the handler, return an error if promise fails
      this.setupStates(message)
        .then(() => res.sendStatus(200))
        .catch((e) => res.status(500).send(e));
    });

    // Proxy server will respond to Verifier process
    app.all("/*", (req, res) => {
      console.log('Proxing', req.path)
      // TODO: Write proxy bit, it should simply forward the request to the actual serve
      //       and return back the result without
      proxy.web(req, res, {
        target: this.config.providerBaseUrl,
      });
    });

    // TODO: This seems a bit shit, but maybe if we use middlewares that look at the
    //       body there's not much we can do?
    //       UPDATE: my assumption seemed to be true - body parser was interfering with this
    //               applying it only to the routes we intercept and take action on removes this need
    // https://github.com/nodejitsu/node-http-proxy/issues/1142
    // proxy.on('proxyReq', (proxyReq: any, req: any) => {
    //   if (req.body && req.complete) {

    //     // TODO: this is almost certainly not a good idea if things aren't JSON etc.
    //     const bodyData = JSON.stringify(req.body);
    //     proxyReq.setHeader('Content-Type', 'application/json');
    //     proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
    //     proxyReq.write(bodyData);
    //   }
    // });

    return app;
  }

  // Lookup the handler based on the description, or get the default handler
  private setupStates(message: ProviderState): Promise<any> {
    const promises: Array<Promise<any>> = new Array();

    if (message.states) {
      message.states.forEach((state) => {
        const handler = this.config.stateHandlers
          ? this.config.stateHandlers[state]
          : null;

        if (handler) {
          promises.push(handler(state));
        } else {
          logger.warn(`no state handler found for "${state}", ignorning`);
        }
      });
    }

    return Promise.all(promises);
  }
}