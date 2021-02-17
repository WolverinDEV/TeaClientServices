import {
    ClientSessionType,
    CommandSessionInitializeAgent,
    CommandSessionUpdateLocale,
    MessageCommand,
    MessageCommandResult,
    NotifyClientsOnline
} from "./Messages";
import {geoLocationProvider} from "./GeoLocation";
import {clientServiceLogger} from "./Logging";
import {ClientServiceConnection} from "./Connection";
import {Registry} from "tc-events";

export type LocalAgent = {
    clientVersion: string,
    uiVersion: string,

    architecture: string,
    platform: string,
    platformVersion: string,
}

export interface ClientServiceConfig {
    getSelectedLocaleUrl() : string | null;
    getSessionType() : ClientSessionType;
    generateHostInfo() : LocalAgent;
}

export interface ClientServiceEvents {
    /** Client service session has successfully be initialized */
    notify_session_initialized: {},
    /** The current active client service session has been closed */
    notify_session_closed: {}
}

export class ClientServices {
    readonly config: ClientServiceConfig;
    readonly events: Registry<ClientServiceEvents>;
    private readonly connection: ClientServiceConnection;

    private sessionInitialized: boolean;
    private retryTimer: any;

    private initializeAgentId: number;
    private initializeLocaleId: number;

    constructor(config: ClientServiceConfig) {
        this.events = new Registry<ClientServiceEvents>();
        this.config = config;
        this.initializeAgentId = 0;
        this.initializeLocaleId = 0;

        this.sessionInitialized = false;
        this.connection = new ClientServiceConnection(5000);
        this.connection.events.on("notify_state_changed", event => {
            if(event.newState !== "connected") {
                if(this.sessionInitialized) {
                    this.events.fire("notify_session_closed");
                }
                this.sessionInitialized = false;
                return;
            }

            clientServiceLogger.logInfo("Connected successfully. Initializing session.");
            this.executeCommandWithRetry({ type: "SessionInitialize", payload: { anonymize_ip: false }}, 2500).then(result => {
                if(result.type !== "Success") {
                    if(result.type === "ConnectionClosed") {
                        return;
                    }

                    clientServiceLogger.logError( "Failed to initialize session. Retrying in 120 seconds. Result: %o", result);
                    this.scheduleRetry(120 * 1000);
                    return;
                }

                this.sendInitializeAgent().then(status => {
                    switch (status) {
                        case "aborted":
                            return;

                        case "error":
                            clientServiceLogger.logError("Failed to initialize session. Closing it and trying again in 60 seconds.");
                            this.scheduleRetry(60 * 1000);
                            return;

                        case "success":
                            this.sessionInitialized = true;
                            this.events.fire("notify_session_initialized");
                            return;
                    }
                });

                /* The locale does not really matter for the session so just run it async */
                this.sendLocaleUpdate().then(undefined);
            });
        });

        this.connection.registerNotifyHandler("NotifyClientsOnline", notify => {
            clientServiceLogger.logInfo("Received user count update: %o", notify);
        });
    }

    start() {
        this.connection.connect();
    }

    stop() {
        this.connection.disconnect();
        clearTimeout(this.retryTimer);

        this.initializeAgentId++;
        this.initializeLocaleId++;
    }

    getConnection() : ClientServiceConnection {
        return this.connection;
    }

    private scheduleRetry(time: number) {
        this.stop();

        this.retryTimer = setTimeout(() => this.connection.connect(), time);
    }

    /**
     * Returns as soon the result indicates that something else went wrong rather than transmitting.
     * Note: This will not throw an exception!
     * @param command
     * @param retryInterval
     */
    private async executeCommandWithRetry(command: MessageCommand, retryInterval: number) : Promise<MessageCommandResult> {
        while(true) {
            const result = await this.connection.executeMessageCommand(command);
            switch (result.type) {
                case "ServerInternalError":
                case "CommandEnqueueError":
                case "ClientSessionUninitialized":
                    const shouldRetry = await new Promise<boolean>(resolve => {
                        const timeout = setTimeout(() => {
                            listener();
                            resolve(true);
                        }, 2500);

                        const listener = this.connection.events.on("notify_state_changed", event => {
                            if(event.newState !== "connected") {
                                resolve(false);
                                clearTimeout(timeout);
                            }
                        })
                    });

                    if(shouldRetry) {
                        continue;
                    } else {
                        return result;
                    }

                default:
                    return result;
            }
        }
    }

    /**
     * @returns `true` if the session agent has been successfully initialized.
     */
    private async sendInitializeAgent() : Promise<"success" | "aborted" | "error"> {
        const taskId = ++this.initializeAgentId;

        const hostInfo = this.config.generateHostInfo();
        const payload: CommandSessionInitializeAgent = {
            session_type: this.config.getSessionType(),
            architecture: hostInfo.architecture,
            platform_version: hostInfo.platformVersion,
            platform: hostInfo.platform,
            client_version: hostInfo.clientVersion,
            ui_version: hostInfo.uiVersion
        };

        if(this.initializeAgentId !== taskId) {
            /* We don't want to send that stuff any more */
            return "aborted";
        }

        const result = await this.executeCommandWithRetry({ type: "SessionInitializeAgent", payload }, 2500);
        if(this.initializeAgentId !== taskId) {
            /* We don't want to send that stuff any more */
            return "aborted";
        }

        if(result.type === "Success") {
            clientServiceLogger.logTrace("Agent initialized", result);
            return "success";
        } else {
            clientServiceLogger.logTrace("Agent initialize result: %o", result);
            return "error";
        }
    }

    private async sendLocaleUpdate() {
        const taskId = ++this.initializeLocaleId;

        const payload: CommandSessionUpdateLocale = {
            ip_country: null,
            selected_locale: null,
            local_timestamp: Date.now()
        };

        const geoInfo = await geoLocationProvider.queryInfo(2500);
        payload.ip_country = geoInfo?.country?.toLowerCase() || null;
        payload.selected_locale = this.config.getSelectedLocaleUrl();

        if(this.initializeLocaleId !== taskId) {
            return;
        }

        const result = await this.connection.executeCommand("SessionUpdateLocale", payload);
        if(this.initializeLocaleId !== taskId) {
            return;
        }

        clientServiceLogger.logTrace("Agent local update result: %o", result);
    }
}