import {clientServiceLogger} from "./Logging";
import {Message, MessageCommand, MessageCommandResult, MessageNotify} from "./Messages";
import {Registry} from "tc-events";

const kApiVersion = 1;

type ConnectionState = "disconnected" | "connecting" | "connected" | "reconnect-pending";
type PendingCommand = {
    resolve: (result: MessageCommandResult) => void,
    timeout: any
};

interface ClientServiceConnectionEvents {
    notify_state_changed: { oldState: ConnectionState, newState: ConnectionState },
    notify_notify_received: { notify: MessageNotify }
}

let tokenIndex = 0;
export class ClientServiceConnection {
    readonly events: Registry<ClientServiceConnectionEvents>;
    readonly reconnectInterval: number;

    private reconnectTimeout: any;
    private connectionState: ConnectionState;
    private connection: WebSocket;

    private pendingCommands: {[key: string]: PendingCommand} = {};

    constructor(reconnectInterval: number) {
        this.events = new Registry<ClientServiceConnectionEvents>();
        this.reconnectInterval = reconnectInterval;
    }

    destroy() {
        this.disconnect();
        this.events.destroy();
    }

    getState() : ConnectionState {
        return this.connectionState;
    }

    private setState(newState: ConnectionState) {
        if(this.connectionState === newState) {
            return;
        }

        const oldState = this.connectionState;
        this.connectionState = newState;
        this.events.fire("notify_state_changed", { oldState, newState })
    }

    connect() {
        this.disconnect();

        this.setState("connecting");

        let address;
        address = "client-services.teaspeak.de:27791";
        address = "localhost:1244";
        //address = "192.168.40.135:1244";

        this.connection = new WebSocket(`wss://${address}/ws-api/v${kApiVersion}`);
        this.connection.onclose = event => {
            clientServiceLogger.logTrace("Lost connection to statistics server (Connection closed). Reason: %s", event.reason ? `${event.reason} (${event.code})` : event.code);
            this.handleConnectionLost();
        };

        this.connection.onopen = () => {
            clientServiceLogger.logTrace("Connection established.");
            this.setState("connected");
        }

        this.connection.onerror = () => {
            if(this.connectionState === "connecting") {
                clientServiceLogger.logTrace("Failed to connect to target server.");
                this.handleConnectFail();
            } else {
                clientServiceLogger.logTrace("Received web socket error which indicates that the connection has been closed.");
                this.handleConnectionLost();
            }
        };

        this.connection.onmessage = event => {
            if(typeof event.data !== "string") {
                clientServiceLogger.logTrace("Receved non text message: %o", event.data);
                return;
            }

            this.handleServerMessage(event.data);
        };
    }

    disconnect() {
        if(this.connection) {
            this.connection.onclose = undefined;
            this.connection.onopen = undefined;
            this.connection.onmessage = undefined;
            this.connection.onerror = undefined;

            this.connection.close();
            this.connection = undefined;
        }

        for(const command of Object.values(this.pendingCommands)) {
            command.resolve({ type: "ConnectionClosed" });
        }
        this.pendingCommands = {};

        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = undefined;

        this.setState("disconnected");
    }

    cancelReconnect() {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = undefined;

        if(this.connectionState === "reconnect-pending") {
            this.setState("disconnected");
        }
    }

    async executeCommand(command: MessageCommand) : Promise<MessageCommandResult> {
        if(this.connectionState !== "connected") {
            return { type: "ConnectionClosed" };
        }

        const token = "tk-" + ++tokenIndex;
        try {
            this.connection.send(JSON.stringify({
                type: "Command",
                token: token,
                command: command
            } as Message));
        } catch (error) {
            clientServiceLogger.logTrace("Failed to send command: %o", error);
            return { type: "GenericError", error: "Failed to send command" };
        }

        return await new Promise(resolve => {
            const proxiedResolve = (result: MessageCommandResult) => {
                clearTimeout(this.pendingCommands[token]?.timeout);
                delete this.pendingCommands[token];
                resolve(result);
            };

            this.pendingCommands[token] = {
                resolve: proxiedResolve,
                timeout: setTimeout(() => proxiedResolve({ type: "ConnectionTimeout" }), 5000)
            };
        });
    }

    private handleConnectFail() {
        this.disconnect();
        this.executeReconnect();
    }

    private handleConnectionLost() {
        this.disconnect();
        this.executeReconnect();
    }

    private executeReconnect() {
        if(!this.reconnectInterval) {
            return;
        }

        clientServiceLogger.logTrace("Scheduling reconnect in %dms", this.reconnectInterval);
        this.reconnectTimeout = setTimeout(() => this.connect(), this.reconnectInterval);
        this.setState("reconnect-pending");
    }

    private handleServerMessage(message: string) {
        let data: Message;
        try {
            data = JSON.parse(message);
        } catch (_error) {
            clientServiceLogger.logTrace("Received message which isn't parsable as JSON.");
            return;
        }

        if(data.type === "Command") {
            clientServiceLogger.logTrace("Received message of type command. The server should not send these. Message: %o", data);
            /* Well this is odd. We should never receive such */
        } else if(data.type === "CommandResult") {
            if(data.token === null) {
                clientServiceLogger.logTrace("Received general error: %o", data.result);
            } else if(this.pendingCommands[data.token]) {
                /* The entry itself will be cleaned up by the resolve callback */
                this.pendingCommands[data.token].resolve(data.result);
            } else {
                clientServiceLogger.logWarn("Received command result for unknown token: %o", data.token);
            }
        } else if(data.type === "Notify") {
            this.events.fire("notify_notify_received", { notify: data.notify });
        } else {
            clientServiceLogger.logWarn("Received message with invalid type: %o", (data as any).type);
        }
    }
}
