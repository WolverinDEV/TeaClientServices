/* Basic message declarations */
export type Message =
    | { type: "Command"; token: string; command: MessageCommand }
    | { type: "CommandResult"; token: string | null; result: MessageCommandResult }
    | { type: "Notify"; notify: MessageNotify };

export type MessageCommand =
    | { type: "SessionInitialize"; payload: CommandSessionInitialize }
    | { type: "SessionInitializeAgent"; payload: CommandSessionInitializeAgent }
    | { type: "SessionUpdateLocale"; payload: CommandSessionUpdateLocale }
    | { type: "InviteQueryInfo"; payload: CommandInviteQueryInfo }
    | { type: "InviteLogAction"; payload: CommandInviteLogAction }
    | { type: "InviteCreate"; payload: CommandInviteCreate };

export type MessageCommandResult =
    | { type: "Success" }
    | { type: "GenericError"; error: string }
    | { type: "ConnectionTimeout" }
    | { type: "ConnectionClosed" }
    | { type: "ClientSessionUninitialized" }
    | { type: "ServerInternalError" }
    | { type: "ParameterInvalid"; parameter: string }
    | { type: "CommandParseError"; error: string }
    | { type: "CommandEnqueueError"; fields: string }
    | { type: "CommandNotFound" }
    | { type: "CommandNotImplemented" }
    | { type: "SessionAlreadyInitialized" }
    | { type: "SessionAgentAlreadyInitialized" }
    | { type: "SessionNotInitialized" }
    | { type: "SessionAgentNotInitialized" }
    | { type: "SessionInvalidType" }
    | { type: "InviteSessionNotInitialized" }
    | { type: "InviteSessionAlreadyInitialized" }
    | { type: "InviteKeyInvalid"; fields: string }
    | { type: "InviteKeyNotFound" };

export type MessageCommandErrorResult = Exclude<MessageCommandResult, { type: "Success" }>;

export type MessageNotify =
    | { type: "NotifyClientsOnline"; payload: NotifyClientsOnline }
    | { type: "NotifyInviteCreated"; payload: NotifyInviteCreated }
    | { type: "NotifyInviteInfo"; payload: NotifyInviteInfo };

/* Some command data payload */
export enum ClientSessionType {
    WebClient = 0,
    TeaClient = 1,
    InviteWebSite = 16,
}

/* All commands */
export type CommandSessionInitialize = { anonymize_ip: boolean };

export type CommandSessionInitializeAgent = { session_type: ClientSessionType; platform: string | null; platform_version: string | null; architecture: string | null; client_version: string | null; ui_version: string | null };

export type CommandSessionUpdateLocale = { ip_country: string | null; selected_locale: string | null; local_timestamp: number };

export type CommandInviteQueryInfo = { link_id: string, register_view: boolean };

export type CommandInviteLogAction = { click_type: number };

export type CommandInviteCreate = { new_link: boolean; properties_connect: { [key: string]: string }; properties_info: { [key: string]: string } };

/* Notifies */
export type NotifyClientsOnline = { users_online: { [key: number]: number }; unique_users_online: { [key: number]: number }; total_users_online: number; total_unique_users_online: number };

export type NotifyInviteCreated = { link_id: string; admin_token: string | null };

export type NotifyInviteInfo = { link_id: string; timestamp_created: number; timestamp_deleted: number; amount_viewed: number; amount_clicked: number; properties_connect: { [key: string]: string }; properties_info: { [key: string]: string } };
