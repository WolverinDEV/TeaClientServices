import {initializeGeoService} from "./GeoLocation";

export { ClientServiceLogger, setClientServiceLogger } from "./Logging";
export { ActionResult } from "./Action";

export { ClientServiceConnection } from "./Connection";

export { ClientSessionType } from "./Messages";
export * as Messages from "./Messages";

export { ClientServiceInvite, InviteLinkInfo } from "./ClientServiceInvite";
export { ClientServiceConfig, ClientServices, LocalAgent } from "./ClientService";

export function initializeClientServices() {
    initializeGeoService();
}