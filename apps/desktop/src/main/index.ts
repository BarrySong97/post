/**
 * @purpose Boot the Electron main process through focused bootstrap modules.
 * @role    Minimal application entrypoint for privileged protocol registration and lifecycle startup.
 * @deps    Main bootstrap app lifecycle and post-file protocol registration.
 * @gotcha  Privileged protocol schemes must be registered before Electron app readiness.
 */

import { bootApplication } from "./bootstrap/app-lifecycle";
import { registerPrivilegedProtocols } from "./presentation/protocols/post-file.protocol";

registerPrivilegedProtocols();
bootApplication();
