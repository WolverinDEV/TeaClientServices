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
}

type NotifyPayloadType<K extends MessageNotify["type"]> = Extract<MessageNotify, { type: K }>["payload"];
type CommandPayloadType<K extends MessageCommand["type"]> = Extract<MessageCommand, { type: K }>["payload"];

let tokenIndex = 0;
export class ClientServiceConnection {
    readonly events: Registry<ClientServiceConnectionEvents>;
    readonly reconnectInterval: number;

    private reconnectTimeout: any;
    private connectionState: ConnectionState;
    private connection: WebSocket;

    private pendingCommands: {[key: string]: PendingCommand} = {};
    private notifyHandler: {[key: string]: ((event) => void)[]} = {};

    constructor(reconnectInterval: number) {
        this.events = new Registry<ClientServiceConnectionEvents>();
        this.reconnectInterval = reconnectInterval;
    }

    destroy() {
        this.disconnect();
        this.events.destroy();
        this.notifyHandler = {};
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

    async executeMessageCommand(command: MessageCommand) : Promise<MessageCommandResult> {
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

    async executeCommand<K extends MessageCommand["type"]>(command: K, payload: CommandPayloadType<K>) : Promise<MessageCommandResult> {
        return await this.executeMessageCommand({ type: command as any, payload: payload as any });
    }

    registerNotifyHandler<K extends MessageNotify["type"]>(notify: K, callback: (notify: NotifyPayloadType<K>) => void) : () => void {
        const handler = this.notifyHandler[notify] || (this.notifyHandler[notify] = []);
        handler.push(callback);

        return () => this.unregisterNotifyHandler(notify, callback as any);
    }

    unregisterNotifyHandler<K extends MessageNotify["type"]>(callback: (notify: NotifyPayloadType<K>) => void);
    unregisterNotifyHandler<K extends MessageNotify["type"]>(notify: K, callback: (notify: NotifyPayloadType<K>) => void);
    unregisterNotifyHandler(notifyOrCallback, callback?) {
        if(typeof notifyOrCallback === "string") {
            const handler = this.notifyHandler[notifyOrCallback];
            if(!handler) {
                return;
            }

            const index = handler.indexOf(callback);
            if(index === -1) {
                return;
            }

            handler.splice(index);
            if(handler.length === 0) {
                delete this.notifyHandler[notifyOrCallback];
            }
        } else {
            for(const key of Object.keys(this.notifyHandler)) {
                this.unregisterNotifyHandler(key as any, notifyOrCallback);
            }
        }
    }

    catchNotify<K extends MessageNotify["type"]>(notify: K, filter?: (value: NotifyPayloadType<K>) => boolean) : () => ({ status: "success", value: NotifyPayloadType<K> } | { status: "fail" }) {
        /*
         * Note:
         * The current implementation allows the user to forget about the callback without causing any memory leaks.
         * The memory might still leak if the registered notify never triggered.
         */
        const handlers = this.notifyHandler[notify] || (this.notifyHandler[notify] = []);
        const resultContainer = { result: null };

        const handler = notify => {
            if(filter && !filter(notify)) {
                return;
            }

            resultContainer.result = notify;
            unregisterHandler();
        };

        const unregisterHandler = () => {
            const index = handlers.indexOf(handler);
            if(index !== -1) {
                handlers.remove(handler);
            }
        }

        handlers.push(handler);
        return () => {
            unregisterHandler();
            if(resultContainer.result === null) {
                return {
                    status: "fail"
                };
            } else {
                return {
                    status: "success",
                    value: resultContainer.result
                };
            }
        }
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
            const handlers = this.notifyHandler[data.notify.type];
            if(typeof handlers !== "undefined") {
                for(const handler of [...handlers]) {
                    try {
                        handler(data.notify.payload);
                    } catch (error) {
                        clientServiceLogger.logError("Failed to invoke notify handler for %s: %o", data.notify, error);
                    }
                }
            }
        } else {
            clientServiceLogger.logWarn("Received message with invalid type: %o", (data as any).type);
        }
    }
}
