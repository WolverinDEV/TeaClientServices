export interface ClientServiceLogger {
    logTrace(message: string, ...args: any[]);
    logDebug(message: string, ...args: any[]);
    logInfo(message: string, ...args: any[]);
    logWarn(message: string, ...args: any[]);
    logError(message: string, ...args: any[]);
    logCritical(message: string, ...args: any[]);
}

export let clientServiceLogger: ClientServiceLogger;
clientServiceLogger = new class implements ClientServiceLogger {
    logCritical(message: string, ...args: any[]) {
        console.error("[Critical] " + message, ...args);
    }

    logError(message: string, ...args: any[]) {
        console.error("[Error] " + message, ...args);
    }

    logWarn(message: string, ...args: any[]) {
        console.warn("[Warn ] " + message, ...args);
    }

    logInfo(message: string, ...args: any[]) {
        console.info("[Info ] " + message, ...args);
    }

    logDebug(message: string, ...args: any[]) {
        console.debug("[Debug] " + message, ...args);
    }

    logTrace(message: string, ...args: any[]) {
        console.debug("[Trace] " + message, ...args);
    }
};

export function setClientServiceLogger(logger: ClientServiceLogger) {
    clientServiceLogger = logger;
}