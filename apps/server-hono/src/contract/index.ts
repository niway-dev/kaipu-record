import { oc } from "@orpc/contract";
import { recordingContract } from "./recording.contract";

export const contract = oc.router({ recording: recordingContract });

export { recordingContract };

export type Contract = typeof contract;
