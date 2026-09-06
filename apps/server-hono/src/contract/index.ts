import { oc } from "@orpc/contract";
import { meContract } from "./me.contract";
import { recordingContract } from "./recording.contract";

export const contract = oc.router({ me: meContract, recording: recordingContract });

export { meContract, recordingContract };

export type Contract = typeof contract;
