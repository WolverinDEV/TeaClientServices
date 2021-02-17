import {ClientServices} from "./ClientService";
import {ActionResult, createErrorResult, createResult} from "./Action";

export type InviteLinkInfo = {
    linkId: string,

    timestampCreated: number,
    timestampDeleted: number,


    amountViewed: number,
    amountClicked: number,

    propertiesConnect: {[key: string]: string},
    propertiesInfo: {[key: string]: string},
};
export class ClientServiceInvite {
    private readonly handle: ClientServices;

    constructor(handle: ClientServices) {
        this.handle = handle;
    }

    async createInviteLink(connectProperties: {[key: string]: string}, infoProperties: {[key: string]: string}, createNew: boolean) : Promise<ActionResult<{ linkId: string, adminToken: string }>> {
        const connection = this.handle.getConnection();

        const notify = connection.catchNotify("NotifyInviteCreated");
        const result = await connection.executeCommand("InviteCreate", {
            new_link: createNew,
            properties_connect: connectProperties,
            properties_info: infoProperties
        });
        const notifyResult = notify();

        if(result.type !== "Success") {
            return createErrorResult(result);
        }

        if(notifyResult.status === "fail") {
            return createErrorResult({ type: "GenericError", error: "failed to receive notify" });
        }

        return createResult({
            adminToken: notifyResult.value.admin_token,
            linkId: notifyResult.value.link_id
        });
    }

    async queryInviteLink(linkId: string, registerView: boolean) : Promise<ActionResult<InviteLinkInfo>> {
        const connection = this.handle.getConnection();

        const notify = connection.catchNotify("NotifyInviteInfo", notify => notify.link_id === linkId);
        const result = await connection.executeCommand("InviteQueryInfo", {
            link_id: linkId,
            register_view: registerView
        });
        const notifyResult = notify();

        if(result.type !== "Success") {
            return createErrorResult(result);
        }

        if(notifyResult.status === "fail") {
            return createErrorResult({ type: "GenericError", error: "failed to receive notify" });
        }

        return createResult({
            linkId: notifyResult.value.link_id,

            amountClicked: notifyResult.value.amount_clicked,
            amountViewed: notifyResult.value.amount_viewed,

            timestampCreated: notifyResult.value.timestamp_created,
            timestampDeleted: notifyResult.value.timestamp_deleted,

            propertiesConnect: notifyResult.value.properties_connect,
            propertiesInfo: notifyResult.value.properties_info,
        });
    }
}